import type {
  MerchantCheckoutAttempt,
  MerchantFulfilment,
  MerchantRefundAttempt,
  NormalizedMerchantRefundReceipt,
} from "@pikar/contracts/tenantCommerce";
import {
  merchantFulfilmentActionHash,
  merchantRefundActionHash,
  prepareMerchantFulfilment,
  prepareMerchantNotice,
  prepareMerchantRefund,
  transitionMerchantFulfilment,
  transitionMerchantRefund,
} from "@pikar/core/tenantMerchant";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { appendAudit } from "./audit";
import { tenantAction, tenantMutation } from "./lib/functions";
import { merchantClient, wire } from "./lib/merchantProviderClient";
import {
  assertTenantWritable,
  internalAction,
  internalMutation,
  lifecycleActionContext,
} from "./lib/tenantLifecycle";
import { refreshMerchantForTenant } from "./merchantProvider";
import { sealedIn } from "./vaultFolders";

const mutationRef = (name: string) =>
  makeFunctionReference<"mutation">(`merchantOperations:${name}`);
const queryRef = (name: string) => makeFunctionReference<"query">(`merchantOperations:${name}`);
const hash = (bytes: Uint8Array) => `sha256:${sha256Bytes(bytes)}`;
function storageDigest(value: string) {
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  try {
    const decoded = atob(value);
    return decoded.length === 32 && btoa(decoded) === value
      ? Array.from(decoded, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
      : null;
  } catch {
    return null;
  }
}
const MAX_DIGITAL_BYTES = 10 * 1024 * 1024;
async function ownedPayment(
  ctx: Pick<QueryCtx, "db">,
  tenantId: string,
  id: Id<"tenantMerchantPayments">,
) {
  const payment = await ctx.db.get(id);
  if (!payment || payment.tenantId !== tenantId) throw Error("MERCHANT_PAYMENT_UNAVAILABLE");
  return payment;
}
async function operations(ctx: Pick<QueryCtx, "db">, payment: Doc<"tenantMerchantPayments">) {
  const rows = await ctx.db
    .query("tenantMerchantOperations")
    .withIndex("by_tenant_order", (q) =>
      q.eq("tenantId", payment.tenantId).eq("orderId", payment.orderId),
    )
    .take(101);
  if (rows.length > 100) throw Error("MERCHANT_OPERATION_BOUND_EXCEEDED");
  return rows;
}
async function notice(
  ctx: MutationCtx,
  payment: Doc<"tenantMerchantPayments">,
  template:
    | "payment_received"
    | "merchant_review"
    | "shipment_dispatched"
    | "digital_ready"
    | "refund_completed",
  evidence: string,
  fulfilment?: MerchantFulfilment,
  refund?: MerchantRefundAttempt,
) {
  const prepared = prepareMerchantNotice(payment.state, {
    customerRef: payment._id,
    policyRef: "merchant-buyer-portal-v1",
    stateEvidenceRef: evidence,
    template,
    fulfilment,
    refund,
  });
  if (!prepared.ok) throw Error(`MERCHANT_NOTICE_${prepared.reason}`);
  const key = prepared.value.idempotencyKey;
  const previous = await ctx.db
    .query("tenantMerchantOperations")
    .withIndex("by_tenant_key", (q) => q.eq("tenantId", payment.tenantId).eq("idempotencyKey", key))
    .unique();
  if (!previous)
    await ctx.db.insert("tenantMerchantOperations", {
      tenantId: payment.tenantId,
      projectId: payment.projectId,
      orderId: payment.orderId,
      paymentId: payment._id,
      kind: "buyer_notice",
      state: prepared.value,
      idempotencyKey: key,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
}

/** Only the merchant may explicitly release a ready owned Vault file for sale. */
export type BindDigitalDeliveryInput = {
  productId: Id<"tenantProducts">;
  expectedRevision: number;
  documentId: Id<"vaultDocuments">;
  releaseForSaleConsent: true;
};
export async function bindDigitalDeliveryForTenant(
  ctx: MutationCtx,
  tenantId: string,
  args: BindDigitalDeliveryInput,
) {
  await assertTenantWritable(ctx, tenantId);
  const product = await ctx.db.get(args.productId),
    source = await ctx.db.get(args.documentId);
  if (
    !product ||
    product.tenantId !== tenantId ||
    product.goodsKind !== "digital" ||
    product.revision !== args.expectedRevision
  )
    throw Error("MERCHANT_PRODUCT_STALE_OR_UNAVAILABLE");
  if (
    !source ||
    source.tenantId !== tenantId ||
    source.status !== "ready" ||
    !source.storageId ||
    (await sealedIn(ctx, [source])).has(source._id)
  )
    throw Error("MERCHANT_DIGITAL_SOURCE_UNAVAILABLE");
  const metadata = await ctx.db.system.get(source.storageId);
  if (!metadata || metadata.size < 1 || metadata.size > MAX_DIGITAL_BYTES)
    throw Error("MERCHANT_DIGITAL_SOURCE_INVALID");
  const binding = hash(
    new TextEncoder().encode(
      JSON.stringify([
        source._id,
        source.storageId,
        source.contentHash,
        metadata.sha256,
        metadata.size,
      ]),
    ),
  );
  await ctx.db.patch(product._id, {
    digitalDeliveryDocumentId: source._id,
    digitalDeliverySourceHash: binding,
    revision: product.revision + 1,
    updatedAt: Date.now(),
  });
  return { revision: product.revision + 1 };
}
export const configureDigitalDelivery = tenantMutation({
  args: {
    productId: v.id("tenantProducts"),
    expectedRevision: v.number(),
    documentId: v.id("vaultDocuments"),
    releaseForSaleConsent: v.literal(true),
  },
  handler: (ctx, args) => bindDigitalDeliveryForTenant(ctx, ctx.tenantId, args),
});

/** Verified payment schedules bounded, policy-authorized delivery; it never authorizes refunds. */
export const afterPayment = internalMutation({
  args: { tenantId: v.string(), paymentId: v.id("tenantMerchantPayments") },
  handler: async (ctx, args) => {
    const payment = await ownedPayment(ctx, args.tenantId, args.paymentId);
    const state = payment.state as MerchantCheckoutAttempt;
    if (state.status !== "paid" && state.status !== "merchant_review") return null;
    await notice(
      ctx,
      payment,
      state.status === "paid" ? "payment_received" : "merchant_review",
      `payment:${payment._id}:${payment.revision}`,
    );
    if (state.status !== "paid") return null;
    const existing = await operations(ctx, payment);
    if (existing.some((op) => op.kind === "refund" && op.state.status !== "failed")) return null;
    const automation = await ctx.db
      .query("tenantMerchantAutomation")
      .withIndex("by_tenant_project", (q) =>
        q.eq("tenantId", args.tenantId).eq("projectId", payment.projectId),
      )
      .unique();
    if (!automation?.autoDigitalDelivery) return null;
    const order = await ctx.db.get(payment.orderId);
    if (!order || order.tenantId !== args.tenantId) throw Error("MERCHANT_ORDER_UNAVAILABLE");
    for (const line of order.snapshot.lines) {
      const productId = ctx.db.normalizeId("tenantProducts", line.productId);
      if (!productId) throw Error("MERCHANT_ORDER_PRODUCT_INVALID");
      const product = await ctx.db.get(productId);
      if (
        !product ||
        product.tenantId !== args.tenantId ||
        product.goodsKind !== "digital" ||
        product.revision !== line.productRevision ||
        !product.digitalDeliveryDocumentId ||
        !product.digitalDeliverySourceHash
      )
        continue;
      const fulfilmentId = `digital:${payment._id}:${product._id}`;
      if (
        existing.some(
          (op) => op.kind === "digital_entitlement" && op.state.fulfilmentId === fulfilmentId,
        )
      )
        continue;
      const now = Date.now(),
        expiresAt = now + automation.digitalValidityDays * 86400000;
      const action = {
        tenantId: args.tenantId,
        orderId: payment.orderId,
        fulfilmentId,
        kind: "digital_entitlement" as const,
        policyRef: automation.policyRef,
        targetRef: product._id,
        expiresAt,
      };
      const prepared = prepareMerchantFulfilment(state, {
        ...action,
        goodsKind: "digital",
        refundedMinor: 0,
        now,
        authorization: {
          kind: "standing_policy",
          ref: `${automation._id}:${automation.revision}`,
          tenantId: args.tenantId,
          operation: "digital_entitlement",
          subjectRef: payment.orderId,
          actionHash: merchantFulfilmentActionHash(action),
          expiresAt: now + 60000,
        },
      });
      if (!prepared.ok) throw Error(`MERCHANT_DELIVERY_${prepared.reason}`);
      const operationId = await ctx.db.insert("tenantMerchantOperations", {
        tenantId: args.tenantId,
        projectId: payment.projectId,
        orderId: payment.orderId,
        paymentId: payment._id,
        kind: "digital_entitlement",
        state: prepared.value,
        idempotencyKey: prepared.value.idempotencyKey,
        sourceDocumentId: product.digitalDeliveryDocumentId,
        sourceHash: product.digitalDeliverySourceHash,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"action">("merchantOperations:deliverDigital"),
        { tenantId: args.tenantId, operationId },
      );
    }
    return null;
  },
});
export const claimDigital = internalMutation({
  args: { tenantId: v.string(), operationId: v.id("tenantMerchantOperations") },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (
      !op ||
      op.tenantId !== args.tenantId ||
      op.kind !== "digital_entitlement" ||
      op.state.status !== "prepared"
    )
      return null;
    const payment = await ownedPayment(ctx, args.tenantId, op.paymentId),
      rows = await operations(ctx, payment);
    if (
      payment.state.status !== "paid" ||
      rows.some((row) => row.kind === "refund" && row.state.status !== "failed")
    )
      throw Error("MERCHANT_DELIVERY_REVIEW_REQUIRED");
    const source = op.sourceDocumentId ? await ctx.db.get(op.sourceDocumentId) : null;
    if (
      !source ||
      source.tenantId !== args.tenantId ||
      source.status !== "ready" ||
      (await sealedIn(ctx, [source])).has(source._id) ||
      !source.storageId
    )
      throw Error("MERCHANT_DIGITAL_SOURCE_UNAVAILABLE");
    const metadata = await ctx.db.system.get(source.storageId);
    if (!metadata || metadata.size < 1 || metadata.size > MAX_DIGITAL_BYTES)
      throw Error("MERCHANT_DIGITAL_SOURCE_INVALID");
    const binding = hash(
      new TextEncoder().encode(
        JSON.stringify([
          source._id,
          source.storageId,
          source.contentHash,
          metadata.sha256,
          metadata.size,
        ]),
      ),
    );
    if (binding !== op.sourceHash) throw Error("MERCHANT_DIGITAL_SOURCE_CHANGED");
    await ctx.db.patch(op._id, {
      state: { ...op.state, status: "pending" },
      updatedAt: Date.now(),
    });
    return {
      storageId: source.storageId,
      sourceHash: binding,
      size: metadata.size,
      storageHash: metadata.sha256,
    };
  },
});
export const completeDigital = internalMutation({
  args: {
    tenantId: v.string(),
    operationId: v.id("tenantMerchantOperations"),
    storageId: v.optional(v.id("_storage")),
    sourceHash: v.optional(v.string()),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (
      !op ||
      op.tenantId !== args.tenantId ||
      op.kind !== "digital_entitlement" ||
      op.state.status !== "pending"
    )
      throw Error("MERCHANT_OPERATION_STALE");
    const payment = await ownedPayment(ctx, args.tenantId, op.paymentId),
      rows = await operations(ctx, payment);
    const source = op.sourceDocumentId ? await ctx.db.get(op.sourceDocumentId) : null,
      sourceMetadata = source?.storageId ? await ctx.db.system.get(source.storageId) : null;
    const currentBinding =
      source && sourceMetadata
        ? hash(
            new TextEncoder().encode(
              JSON.stringify([
                source._id,
                source.storageId,
                source.contentHash,
                sourceMetadata.sha256,
                sourceMetadata.size,
              ]),
            ),
          )
        : null;
    const copiedMetadata = args.storageId ? await ctx.db.system.get(args.storageId) : null;
    const valid =
      !args.failed &&
      args.storageId &&
      args.sourceHash === op.sourceHash &&
      source?.tenantId === args.tenantId &&
      source.status === "ready" &&
      !(await sealedIn(ctx, [source])).has(source._id) &&
      currentBinding === op.sourceHash &&
      copiedMetadata?.sha256 === sourceMetadata?.sha256 &&
      copiedMetadata?.size === sourceMetadata?.size &&
      payment.state.status === "paid" &&
      !rows.some((row) => row.kind === "refund" && row.state.status !== "failed");
    const transitioned = transitionMerchantFulfilment(op.state, {
      tenantId: args.tenantId,
      orderId: op.orderId,
      fulfilmentId: op.state.fulfilmentId,
      status: valid ? "succeeded" : "failed",
      evidenceRef: valid ? `storage:${args.storageId}` : "digital-copy-unavailable",
    });
    if (!transitioned.ok) throw Error("MERCHANT_DELIVERY_TRANSITION_INVALID");
    await ctx.db.patch(op._id, {
      state: transitioned.value,
      ...(valid ? { storageId: args.storageId } : {}),
      updatedAt: Date.now(),
    });
    if (valid)
      await appendAudit(ctx, {
        tenantId: args.tenantId,
        correlationId: `merchant-operation:${op._id}`,
        eventType: "tenant_merchant.digital_granted",
        actor: "merchant-digital-delivery",
        payload: {
          orderId: op.orderId,
          operationId: op._id,
          sourceHash: op.sourceHash,
          expiresAt: op.expiresAt,
        },
      });
    if (valid)
      await notice(ctx, payment, "digital_ready", `operation:${op._id}`, transitioned.value);
    return { attached: !!valid };
  },
});
export const deliverDigital = internalAction({
  args: { tenantId: v.string(), operationId: v.id("tenantMerchantOperations") },
  handler: async (ctx, args) => {
    const source = (await ctx.runMutation(mutationRef("claimDigital"), args)) as {
      storageId: Id<"_storage">;
      sourceHash: string;
      size: number;
      storageHash: string;
    } | null;
    if (!source) return;
    let copy: Id<"_storage"> | undefined;
    try {
      const blob = await ctx.storage.get(source.storageId);
      if (!blob || blob.size !== source.size || blob.size > MAX_DIGITAL_BYTES)
        throw Error("MERCHANT_DIGITAL_SOURCE_INVALID");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (sha256Bytes(bytes) !== storageDigest(source.storageHash))
        throw Error("MERCHANT_DIGITAL_SOURCE_CHANGED");
      copy = await lifecycleActionContext(ctx, args.tenantId).storage.store(
        new Blob([bytes], { type: "application/octet-stream" }),
      );
      const result = (await ctx.runMutation(mutationRef("completeDigital"), {
        ...args,
        storageId: copy,
        sourceHash: source.sourceHash,
      })) as { attached: boolean };
      if (result.attached) return;
    } catch {
      await ctx.runMutation(mutationRef("completeDigital"), { ...args, failed: true });
    }
    if (copy)
      await ctx.runMutation(makeFunctionReference<"mutation">("webAssets:discardCopy"), {
        tenantId: args.tenantId,
        storageId: copy,
      });
  },
});

export const operationContext = internalQuery({
  args: { tenantId: v.string(), paymentId: v.id("tenantMerchantPayments") },
  handler: async (ctx, args) => {
    const payment = await ownedPayment(ctx, args.tenantId, args.paymentId);
    return { payment, operations: await operations(ctx, payment) };
  },
});
export const prepareRefund = internalMutation({
  args: {
    tenantId: v.string(),
    paymentId: v.id("tenantMerchantPayments"),
    expectedRevision: v.number(),
    amountMinor: v.number(),
    requestKey: v.string(),
  },
  handler: async (ctx, args) => {
    const payment = await ownedPayment(ctx, args.tenantId, args.paymentId);
    if (
      payment.revision !== args.expectedRevision ||
      !/^[A-Za-z0-9_-]{8,80}$/.test(args.requestKey)
    )
      throw Error("MERCHANT_REFUND_STALE_OR_INVALID");
    const account = await ctx.db.get(payment.merchantAccountId);
    if (!account || account.tenantId !== args.tenantId) throw Error("MERCHANT_ACCOUNT_UNAVAILABLE");
    const rows = await operations(ctx, payment),
      existing = rows.find((op) => op.kind === "refund" && op.state.refundId === args.requestKey);
    if (existing) return { operation: existing, created: false };
    const refunds = rows.filter((op) => op.kind === "refund"),
      now = Date.now(),
      state = payment.state as MerchantCheckoutAttempt;
    const action = {
      ...state,
      paymentRef: state.paymentRef!,
      refundId: args.requestKey,
      amountMinor: args.amountMinor,
    };
    const prepared = prepareMerchantRefund(state, {
      capability: account.capability,
      refundId: args.requestKey,
      amountMinor: args.amountMinor,
      alreadyRefundedMinor: refunds
        .filter((op) => op.state.status === "succeeded")
        .reduce((sum, op) => sum + op.state.amountMinor, 0),
      reservedRefundMinor: refunds
        .filter((op) => op.state.status === "pending" || op.state.status === "unknown")
        .reduce((sum, op) => sum + op.state.amountMinor, 0),
      now,
      authorization: {
        kind: "merchant_admin",
        ref: `owner:${args.requestKey}`,
        tenantId: args.tenantId,
        operation: "refund",
        subjectRef: payment.orderId,
        actionHash: merchantRefundActionHash(action),
        expiresAt: now + 60000,
      },
    });
    if (!prepared.ok) throw Error(`MERCHANT_REFUND_${prepared.reason}`);
    const id = await ctx.db.insert("tenantMerchantOperations", {
      tenantId: args.tenantId,
      projectId: payment.projectId,
      orderId: payment.orderId,
      paymentId: payment._id,
      kind: "refund",
      state: prepared.value,
      idempotencyKey: prepared.value.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });
    return { operation: (await ctx.db.get(id))!, created: true };
  },
});
export const applyRefund = internalMutation({
  args: {
    tenantId: v.string(),
    operationId: v.id("tenantMerchantOperations"),
    receipt: v.optional(v.any()),
    unknown: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (!op || op.tenantId !== args.tenantId || op.kind !== "refund")
      throw Error("MERCHANT_REFUND_UNAVAILABLE");
    if (args.unknown) {
      if (op.state.status !== "succeeded")
        await ctx.db.patch(op._id, {
          state: { ...op.state, status: "unknown" },
          updatedAt: Date.now(),
        });
      return;
    }
    const transitioned = transitionMerchantRefund(
      op.state,
      args.receipt as NormalizedMerchantRefundReceipt,
    );
    if (!transitioned.ok) throw Error(`MERCHANT_REFUND_${transitioned.reason}`);
    await ctx.db.patch(op._id, { state: transitioned.value.attempt, updatedAt: Date.now() });
    if (transitioned.value.newlyRefundedMinor > 0) {
      const payment = await ownedPayment(ctx, args.tenantId, op.paymentId);
      for (const grant of await operations(ctx, payment)) {
        if (grant.kind === "digital_entitlement" && grant.state.status === "succeeded") {
          await ctx.db.patch(grant._id, {
            state: { ...grant.state, status: "revoked", evidenceRef: `refund:${op._id}` },
            updatedAt: Date.now(),
          });
        }
      }
      await notice(
        ctx,
        payment,
        "refund_completed",
        `refund:${op._id}`,
        undefined,
        transitioned.value.attempt,
      );
    }
  },
});
export const refund = tenantAction({
  args: {
    paymentId: v.id("tenantMerchantPayments"),
    expectedRevision: v.number(),
    amountMinor: v.number(),
    requestKey: v.string(),
  },
  handler: async (ctx, args) => {
    const context = (await ctx.runQuery(queryRef("operationContext"), {
      tenantId: ctx.tenantId,
      paymentId: args.paymentId,
    })) as { payment: Doc<"tenantMerchantPayments"> };
    const refreshed = await refreshMerchantForTenant(
      ctx,
      ctx.tenantId,
      context.payment.projectId,
      context.payment.provider,
    );
    if (!refreshed.ok) return refreshed;
    const prepared = (await ctx.runMutation(mutationRef("prepareRefund"), {
      ...args,
      tenantId: ctx.tenantId,
    })) as { operation: Doc<"tenantMerchantOperations">; created: boolean };
    if (!prepared.created)
      return {
        ok: false,
        reason: "existing_refund_requires_reconciliation",
        status: prepared.operation.state.status,
      };
    const state = prepared.operation.state as MerchantRefundAttempt,
      client = merchantClient(state.provider);
    try {
      let value: Record<string, unknown>,
        providerRefundRef: string,
        outcome: "succeeded" | "pending" | "failed";
      if (state.provider === "stripe") {
        value = await client.stripe(
          "/v1/refunds",
          "POST",
          new URLSearchParams({
            payment_intent: state.paymentRef,
            amount: String(state.amountMinor),
          }),
          state.providerAccountRef,
          state.idempotencyKey,
        );
        if (
          value.amount !== state.amountMinor ||
          String(value.currency).toUpperCase() !== state.currency ||
          value.payment_intent !== state.paymentRef ||
          typeof value.id !== "string"
        )
          throw Error("MERCHANT_REFUND_BINDING_INVALID");
        providerRefundRef = value.id;
        outcome =
          value.status === "succeeded"
            ? "succeeded"
            : value.status === "failed" || value.status === "canceled"
              ? "failed"
              : "pending";
      } else {
        value = await client.paypal(
          `/v2/payments/captures/${encodeURIComponent(state.paymentRef)}/refund`,
          "POST",
          {
            amount: { currency_code: state.currency, value: (state.amountMinor / 100).toFixed(2) },
          },
          state.providerAccountRef,
          state.idempotencyKey.slice(-38),
        );
        const amount = wire(value.amount);
        if (
          amount.currency_code !== state.currency ||
          amount.value !== (state.amountMinor / 100).toFixed(2) ||
          typeof value.id !== "string"
        )
          throw Error("MERCHANT_REFUND_BINDING_INVALID");
        providerRefundRef = value.id;
        outcome =
          value.status === "COMPLETED"
            ? "succeeded"
            : value.status === "FAILED" || value.status === "CANCELLED"
              ? "failed"
              : "pending";
      }
      const receipt: NormalizedMerchantRefundReceipt = {
        ...state,
        providerRefundRef,
        eventRef: `refund-read:${providerRefundRef}:${outcome}`,
        outcome,
        verification: {
          method: "provider_read",
          evidenceRef: `${state.provider}:refund:${providerRefundRef}`,
        },
      };
      await ctx.runMutation(mutationRef("applyRefund"), {
        tenantId: ctx.tenantId,
        operationId: prepared.operation._id,
        receipt,
      });
      return { ok: true, status: outcome };
    } catch {
      await ctx.runMutation(mutationRef("applyRefund"), {
        tenantId: ctx.tenantId,
        operationId: prepared.operation._id,
        unknown: true,
      });
      return { ok: false, reason: "refund_requires_reconciliation" };
    }
  },
});

/** Records a real merchant handoff; it does not claim a carrier integration dispatched a parcel. */
export const recordShipment = tenantMutation({
  args: {
    paymentId: v.id("tenantMerchantPayments"),
    productId: v.id("tenantProducts"),
    requestKey: v.string(),
    carrier: v.string(),
    trackingReference: v.string(),
    handoffEvidenceRef: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !/^[A-Za-z0-9_-]{8,80}$/.test(args.requestKey) ||
      [args.carrier, args.trackingReference, args.handoffEvidenceRef].some(
        (value) => !value.trim() || value.length > 160,
      )
    )
      throw Error("MERCHANT_HANDOFF_INVALID");
    const payment = await ownedPayment(ctx, ctx.tenantId, args.paymentId),
      order = await ctx.db.get(payment.orderId),
      product = await ctx.db.get(args.productId);
    if (
      !order ||
      !order.snapshot.lines.some((line) => line.productId === args.productId) ||
      !product ||
      product.tenantId !== ctx.tenantId ||
      product.goodsKind !== "physical"
    )
      throw Error("MERCHANT_PHYSICAL_LINE_REQUIRED");
    if (!payment.buyerAddress || payment.deliveryReviewReason)
      throw Error("MERCHANT_VERIFIED_DELIVERY_ADDRESS_REQUIRED");
    const rows = await operations(ctx, payment);
    if (
      rows.some(
        (op) => op.kind === "physical_shipment" && op.state.fulfilmentId === args.requestKey,
      )
    )
      return { duplicate: true };
    if (
      rows.some(
        (op) =>
          op.kind === "physical_shipment" &&
          op.state.targetRef === product._id &&
          op.state.status !== "failed",
      )
    )
      throw Error("MERCHANT_SHIPMENT_ALREADY_RECORDED");
    if (rows.some((op) => op.kind === "refund" && op.state.status !== "failed"))
      throw Error("MERCHANT_DELIVERY_REVIEW_REQUIRED");
    const now = Date.now(),
      action = {
        tenantId: ctx.tenantId,
        orderId: payment.orderId,
        fulfilmentId: args.requestKey,
        kind: "physical_shipment" as const,
        policyRef: "merchant-recorded-handoff-v1",
        targetRef: product._id,
      };
    const prepared = prepareMerchantFulfilment(payment.state, {
      ...action,
      goodsKind: "physical",
      refundedMinor: 0,
      now,
      authorization: {
        kind: "merchant_admin",
        ref: args.handoffEvidenceRef,
        tenantId: ctx.tenantId,
        operation: "physical_shipment",
        subjectRef: payment.orderId,
        actionHash: merchantFulfilmentActionHash(action),
        expiresAt: now + 60000,
      },
    });
    if (!prepared.ok) throw Error(`MERCHANT_SHIPMENT_${prepared.reason}`);
    const transitioned = transitionMerchantFulfilment(prepared.value, {
      tenantId: ctx.tenantId,
      orderId: payment.orderId,
      fulfilmentId: args.requestKey,
      status: "succeeded",
      evidenceRef: args.handoffEvidenceRef,
    });
    if (!transitioned.ok) throw Error("MERCHANT_HANDOFF_INVALID");
    await ctx.db.insert("tenantMerchantOperations", {
      tenantId: ctx.tenantId,
      projectId: payment.projectId,
      orderId: payment.orderId,
      paymentId: payment._id,
      kind: "physical_shipment",
      state: transitioned.value,
      idempotencyKey: prepared.value.idempotencyKey,
      shipmentDetails: { carrier: args.carrier, trackingReference: args.trackingReference },
      createdAt: now,
      updatedAt: now,
    });
    await notice(ctx, payment, "shipment_dispatched", args.handoffEvidenceRef, transitioned.value);
    return { duplicate: false };
  },
});

/** Remove expired buyer material without rewriting retained financial history. */
export const purgeExpiredBuyerData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now(),
      payments = await ctx.db
        .query("tenantMerchantPayments")
        .withIndex("by_buyer_purge", (q) => q.gt("buyerPurgeAt", 0).lte("buyerPurgeAt", now))
        .take(50);
    for (const payment of payments) {
      await ctx.db.patch(payment._id, {
        buyerAddress: undefined,
        buyerEmail: undefined,
        buyerTokenHash: undefined,
        buyerPurgeAt: undefined,
        updatedAt: now,
      });
    }
    const grants = await ctx.db
      .query("tenantMerchantOperations")
      .withIndex("by_expiry", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
      .take(50);
    for (const op of grants) {
      if (op.kind !== "digital_entitlement") continue;
      if (op.storageId) {
        await ctx.storage.delete(op.storageId);
        await ctx.db.patch(op._id, {
          storageId: undefined,
          state: { ...op.state, status: "revoked", evidenceRef: "digital-validity-expired" },
          expiresAt: undefined,
          updatedAt: now,
        });
      } else await ctx.db.patch(op._id, { expiresAt: undefined, updatedAt: now });
    }
    return { payments: payments.length, grants: grants.length };
  },
});
