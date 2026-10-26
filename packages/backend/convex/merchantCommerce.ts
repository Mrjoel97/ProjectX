import { appendAudit } from "./audit";
import { sha256Bytes } from "@pikar/core/webRuntime";
import type { WebDocument, WebNode } from "@pikar/contracts/webRuntime";
import type {
  MerchantCapability,
  MerchantCheckoutAttempt,
  MerchantInventoryOutcome,
  NormalizedMerchantPaymentReceipt,
} from "@pikar/contracts/tenantCommerce";
import {
  admitMerchantCheckout,
  prepareMerchantCheckout,
  transitionMerchantPayment,
  validateMerchantPaymentReceipt,
} from "@pikar/core/tenantMerchant";
import {
  consumeInventory,
  releaseInventory,
  type InventoryState,
} from "@pikar/core/tenantInventory";
import { hashOrderQuote } from "@pikar/core/tenantOrder";
import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { internalMutation, assertTenantWritable } from "./lib/tenantLifecycle";
import { missingMerchantConfiguration } from "./lib/merchantProviderClient";

const provider = v.union(v.literal("stripe"), v.literal("paypal"));
type Db = QueryCtx | MutationCtx;
export async function merchantProject(ctx: Db, tenantId: string, projectId: Id<"webProjects">) {
  const project = await ctx.db.get(projectId);
  if (!project || project.tenantId !== tenantId || project.kind !== "storefront")
    throw Error("MERCHANT_PROJECT_UNAVAILABLE");
  const lifecycle = await ctx.db
    .query("authRevocations")
    .withIndex("by_userId", (q) => q.eq("userId", tenantId))
    .unique();
  if (lifecycle?.state) throw Error("MERCHANT_TENANT_UNAVAILABLE");
  return project;
}
/** Stable commercial facts; normal reservations and completed sales do not retire owner approval. */
export function merchantProductConfigRef(
  product: Pick<
    Doc<"tenantProducts">,
    | "_id"
    | "currency"
    | "goodsKind"
    | "priceMinor"
    | "status"
    | "digitalDeliveryDocumentId"
    | "digitalDeliverySourceHash"
  >,
  presentationItemId: string,
) {
  return `${presentationItemId}:${product._id}#${sha256Bytes(new TextEncoder().encode(JSON.stringify([product.currency, product.goodsKind ?? null, product.priceMinor, product.status, product.digitalDeliveryDocumentId ?? null, product.digitalDeliverySourceHash ?? null])))}`;
}
export async function merchantReadiness(
  ctx: Db,
  tenantId: string,
  projectId: Id<"webProjects">,
  targetVersion?: number,
) {
  const project = await merchantProject(ctx, tenantId, projectId);
  const blockers: string[] = [];
  const policy = await ctx.db
    .query("tenantCommercePolicies")
    .withIndex("by_tenant_project_revision", (q) =>
      q.eq("tenantId", tenantId).eq("projectId", projectId),
    )
    .order("desc")
    .first();
  const mappings = await ctx.db
    .query("tenantCommerceMappings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .take(201);
  if (mappings.length >= 201) blockers.push("catalogue_review_bound_exceeded");
  const projectMappings = mappings.filter((row) => row.projectId === projectId);
  if (!policy) blockers.push("merchant_policy_required");
  if (!projectMappings.length) blockers.push("confirmed_product_price_and_mapping_required");
  const versionNumber =
    targetVersion ?? project.publishedVersion ?? project.approvedVersion ?? project.draftVersion;
  const version =
    versionNumber === undefined
      ? null
      : await ctx.db
          .query("webProjectVersions")
          .withIndex("by_tenant_project_version", (q) =>
            q.eq("tenantId", tenantId).eq("projectId", projectId).eq("version", versionNumber),
          )
          .unique();
  const catalogueIds: string[] = [];
  const visit = (nodes: readonly WebNode[]) => {
    for (const node of nodes) {
      if (node.kind === "catalogue") catalogueIds.push(...node.items.map((item) => item.id));
      if (node.kind === "section") visit(node.children);
    }
  };
  if (version) for (const page of (version.document as WebDocument).pages) visit(page.nodes);
  if (
    !catalogueIds.length ||
    catalogueIds.length > 50 ||
    new Set(catalogueIds).size !== catalogueIds.length
  )
    blockers.push("current_catalogue_version_required");
  const productConfigRefs: string[] = [];
  for (const id of catalogueIds) {
    const mapping = projectMappings.find((row) => row.presentationItemId === id);
    const product = mapping ? await ctx.db.get(mapping.productId) : null;
    if (
      !product ||
      product.tenantId !== tenantId ||
      product.status !== "active" ||
      !product.goodsKind ||
      !Number.isSafeInteger(product.priceMinor) ||
      product.priceMinor <= 0
    ) {
      blockers.push("active_classified_product_required");
      continue;
    }
    productConfigRefs.push(merchantProductConfigRef(product, id));
    if (product.currency !== policy?.currency) blockers.push("product_policy_currency_mismatch");
    if (
      (product.goodsKind === "physical" && !policy?.physical) ||
      (product.goodsKind === "digital" && !policy?.digital)
    )
      blockers.push("goods_policy_required");
    const stock = await ctx.db
      .query("tenantStock")
      .withIndex("by_tenant_product", (q) =>
        q.eq("tenantId", tenantId).eq("productId", product._id),
      )
      .unique();
    if (!stock || (stock.kind === "untracked" && !stock.approvedUntracked))
      blockers.push("stock_policy_required");
    if (
      product.goodsKind === "digital" &&
      (!product.digitalDeliveryDocumentId || !product.digitalDeliverySourceHash)
    )
      blockers.push("digital_delivery_source_required");
  }
  const events = await ctx.db
    .query("tenantMerchantEvents")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .take(501);
  if (events.length >= 501) blockers.push("provider_proof_review_bound_exceeded");
  const providers = [];
  for (const name of ["stripe", "paypal"] as const) {
    const account = await ctx.db
      .query("tenantMerchantAccounts")
      .withIndex("by_tenant_project_provider", (q) =>
        q.eq("tenantId", tenantId).eq("projectId", projectId).eq("provider", name),
      )
      .unique();
    const missingKeyNames = missingMerchantConfiguration(name);
    const capability = account?.capability as MerchantCapability | undefined;
    const ready =
      account?.status === "ready" &&
      capability?.status === "verified" &&
      capability.expiresAt > Date.now();
    const reasons = [
      ...(missingKeyNames.length ? ["provider_configuration_required"] : []),
      ...(!ready ? [account?.lastFailure ?? "merchant_onboarding_required"] : []),
    ];
    if (capability && policy) {
      for (const country of policy.countries) {
        const admitted = admitMerchantCheckout(capability, {
          tenantId,
          provider: name,
          environment: "test",
          sellerCountry: account!.sellerCountry,
          buyerCountry: country,
          currency: policy.currency,
          settlementCurrency: account!.currency,
          now: Date.now(),
        });
        if (!admitted.ok) reasons.push(`capability_${admitted.reason}`);
      }
    }
    // This proof can only be written by the internal exact-account provider reconciliation path.
    const matching = [];
    for (const event of events.filter(
      (row) => row.provider === name && row.outcome === "succeeded",
    )) {
      const payment = await ctx.db.get(event.paymentId);
      const state = payment?.state as MerchantCheckoutAttempt | undefined;
      const order = payment ? await ctx.db.get(payment.orderId) : null;
      if (
        payment?.tenantId === tenantId &&
        payment.projectId === projectId &&
        payment.provider === name &&
        payment.merchantAccountId === account?._id &&
        state?.status === "paid" &&
        state.provider === name &&
        state.environment === "test" &&
        state.merchantAccountRef === account?._id &&
        state.providerAccountRef === account?.providerAccountId &&
        state.totalMinor > 0 &&
        state.currency === policy?.currency &&
        order?.tenantId === tenantId &&
        order.snapshotHash === state.quoteHash &&
        order.snapshot.totalMinor === state.totalMinor &&
        state.events.some(
          (observed) =>
            observed.eventRef === event.eventRef && observed.fingerprint === event.fingerprint,
        )
      ) {
        const { hash, ...body } = order.snapshot;
        if (hash === order.snapshotHash && hashOrderQuote(body) === hash) matching.push(event);
      }
    }
    if (!matching.length) reasons.push("verified_test_payment_required");
    // Owner decision 2026-10-24: Stripe sandbox first; PayPal remains independently gated/deferred.
    if (name === "stripe") blockers.push(...reasons.map((reason) => `${name}:${reason}`));
    providers.push({
      provider: name,
      requiredForRelease: name === "stripe",
      configured: missingKeyNames.length === 0,
      canConnect: missingKeyNames.length === 0,
      status: account?.status ?? "not_connected",
      missingKeyNames,
      blockers: reasons,
      ...(ready
        ? {
            connectionContext: {
              sellerCountry: account!.sellerCountry,
              currency: account!.currency,
            },
          }
        : {}),
    });
  }
  const automation = await ctx.db
    .query("tenantMerchantAutomation")
    .withIndex("by_tenant_project", (q) => q.eq("tenantId", tenantId).eq("projectId", projectId))
    .unique();
  const approvals = await ctx.db
    .query("audit")
    .withIndex("by_tenant_event_ts", (q) =>
      q.eq("tenantId", tenantId).eq("eventType", "online_presence.shop_setup_approved"),
    )
    .order("desc")
    .take(21);
  const approval = approvals.find(
    (row) =>
      row.actor === "online-presence-shop-owner-review" &&
      (row.payload as { projectId?: unknown })?.projectId === projectId,
  );
  const receipt = approval?.payload as
    | {
        version?: unknown;
        contentHash?: unknown;
        packageHash?: unknown;
        policyId?: unknown;
        policyRevision?: unknown;
        automationRevision?: unknown;
        productIds?: unknown;
        productConfigRefs?: unknown;
      }
    | undefined;
  const approvedProducts = catalogueIds
    .map((id) => projectMappings.find((mapping) => mapping.presentationItemId === id)?.productId)
    .filter(Boolean)
    .sort();
  if (
    approvals.length > 20 ||
    !receipt ||
    receipt.version !== version?.version ||
    receipt.contentHash !== version?.contentHash ||
    receipt.policyId !== policy?._id ||
    receipt.policyRevision !== policy?.revision ||
    receipt.automationRevision !== automation?.revision ||
    typeof receipt.packageHash !== "string" ||
    !Array.isArray(receipt.productIds) ||
    JSON.stringify([...receipt.productIds].sort()) !== JSON.stringify(approvedProducts) ||
    !Array.isArray(receipt.productConfigRefs) ||
    JSON.stringify([...receipt.productConfigRefs].sort()) !==
      JSON.stringify(productConfigRefs.sort())
  )
    blockers.push("exact_native_shop_setup_review_required");
  return {
    projectId,
    environment: "test" as const,
    testOnly: true,
    releaseProviders: ["stripe"] as const,
    publicCheckoutReady: blockers.length === 0,
    blockers: [...new Set(blockers)],
    providers,
    automation: automation
      ? {
          revision: automation.revision,
          autoDigitalDelivery: automation.autoDigitalDelivery,
          digitalValidityDays: automation.digitalValidityDays,
          buyerRetentionDays: automation.buyerRetentionDays,
          policyRef: automation.policyRef,
        }
      : null,
  };
}
export const status = tenantQuery({
  args: { projectId: v.id("webProjects"), version: v.optional(v.number()) },
  handler: (ctx, args) => merchantReadiness(ctx, ctx.tenantId, args.projectId, args.version),
});
const configureAutomationArgs = {
  projectId: v.id("webProjects"),
  expectedRevision: v.number(),
  autoDigitalDelivery: v.boolean(),
  digitalValidityDays: v.number(),
  buyerRetentionDays: v.number(),
  policyRef: v.string(),
};
const configureAutomationValidator = v.object(configureAutomationArgs);
export type ConfigureAutomationInput = Infer<typeof configureAutomationValidator>;
/** Trusted atomic tenant-derived adapter seam; no authenticated-context fabrication. */
export async function configureAutomationForTenant(
  ctx: MutationCtx,
  tenantId: string,
  args: ConfigureAutomationInput,
) {
  await assertTenantWritable(ctx, tenantId);
  await merchantProject(ctx, tenantId, args.projectId);
  if (
    ![args.digitalValidityDays, args.buyerRetentionDays].every(
      (n) => Number.isSafeInteger(n) && n >= 1 && n <= 30,
    ) ||
    !args.policyRef.trim() ||
    args.policyRef.length > 256
  )
    throw Error("MERCHANT_AUTOMATION_POLICY_INVALID");
  const previous = await ctx.db
    .query("tenantMerchantAutomation")
    .withIndex("by_tenant_project", (q) =>
      q.eq("tenantId", tenantId).eq("projectId", args.projectId),
    )
    .unique();
  if ((previous?.revision ?? 0) !== args.expectedRevision) throw Error("STALE_REVISION");
  const { expectedRevision, ...settings } = args;
  const now = Date.now();
  const revision = expectedRevision + 1;
  if (previous) await ctx.db.patch(previous._id, { ...settings, revision, updatedAt: now });
  else
    await ctx.db.insert("tenantMerchantAutomation", {
      ...settings,
      tenantId: tenantId,
      revision,
      createdAt: now,
      updatedAt: now,
    });
  return { revision };
}

export const configureAutomation = tenantMutation({
  args: configureAutomationArgs,
  handler: (ctx, args) => configureAutomationForTenant(ctx, ctx.tenantId, args),
});
export const orders = tenantQuery({
  args: { projectId: v.id("webProjects") },
  handler: async (ctx, args) => {
    await merchantProject(ctx, ctx.tenantId, args.projectId);
    const payments = await ctx.db
      .query("tenantMerchantPayments")
      .withIndex("by_tenant_project", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", args.projectId),
      )
      .order("desc")
      .take(101);
    const out = [];
    for (const payment of payments.slice(0, 100)) {
      const order = await ctx.db.get(payment.orderId);
      if (!order || order.tenantId !== ctx.tenantId) continue;
      const operations = await ctx.db
        .query("tenantMerchantOperations")
        .withIndex("by_tenant_order", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("orderId", order._id),
        )
        .take(101);
      const state = payment.state as MerchantCheckoutAttempt;
      out.push({
        paymentId: payment._id,
        orderId: order._id,
        items: order.snapshot.lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          goodsKind: line.goodsKind,
          quantity: line.quantity,
        })),
        revision: payment.revision,
        status: order.status,
        paymentStatus: state.status,
        provider: payment.provider,
        currency: order.snapshot.currency,
        totalMinor: order.snapshot.totalMinor,
        createdAt: order.createdAt,
        reviewRequired: state.status === "merchant_review" || !!payment.deliveryReviewReason,
        ...(payment.buyerAddress ? { shippingDestination: payment.buyerAddress } : {}),
        ...(payment.deliveryReviewReason
          ? { deliveryReviewReason: payment.deliveryReviewReason }
          : {}),
        refundedMinor: operations
          .filter((op) => op.kind === "refund" && op.state.status === "succeeded")
          .reduce((sum, op) => sum + op.state.amountMinor, 0),
        fulfilments: operations
          .filter((op) => op.kind === "physical_shipment" || op.kind === "digital_entitlement")
          .map((op) => ({ kind: op.kind, status: op.state.status })),
        buyerNoticeStates: operations
          .filter((op) => op.kind === "buyer_notice")
          .map((op) => ({ template: op.state.template, status: op.state.status })),
      });
    }
    return { orders: out, truncated: payments.length > 100 };
  },
});
export const accountContext = internalQuery({
  args: { tenantId: v.string(), projectId: v.id("webProjects"), provider },
  handler: async (ctx, args) => {
    const project = await merchantProject(ctx, args.tenantId, args.projectId);
    const account = await ctx.db
      .query("tenantMerchantAccounts")
      .withIndex("by_tenant_project_provider", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("projectId", args.projectId)
          .eq("provider", args.provider),
      )
      .unique();
    const userId = ctx.db.normalizeId("users", args.tenantId);
    const user = userId ? await ctx.db.get(userId) : null;
    const policy = await ctx.db
      .query("tenantCommercePolicies")
      .withIndex("by_tenant_project_revision", (q) =>
        q.eq("tenantId", args.tenantId).eq("projectId", args.projectId),
      )
      .order("desc")
      .first();
    return {
      project,
      account,
      email: user?.emailVerificationTime ? user.email : undefined,
      policy,
    };
  },
});
export const beginAccount = internalMutation({
  args: {
    tenantId: v.string(),
    projectId: v.id("webProjects"),
    provider,
    sellerCountry: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await merchantProject(ctx, args.tenantId, args.projectId);
    if (
      (args.sellerCountry !== undefined && !/^[A-Z]{2}$/.test(args.sellerCountry)) ||
      (args.currency !== undefined && !["USD", "EUR", "GBP"].includes(args.currency))
    )
      throw Error("MERCHANT_COUNTRY_CURRENCY_INVALID");
    const previous = await ctx.db
      .query("tenantMerchantAccounts")
      .withIndex("by_tenant_project_provider", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("projectId", args.projectId)
          .eq("provider", args.provider),
      )
      .unique();
    if (previous) {
      if (previous.lastFailure === "MERCHANT_PROVIDER_OUTCOME_UNKNOWN")
        throw Error("MERCHANT_UNKNOWN_ACCOUNT_REQUIRES_RECONCILIATION");
      return previous;
    }
    const now = Date.now();
    const id = await ctx.db.insert("tenantMerchantAccounts", {
      ...args,
      sellerCountry: args.sellerCountry ?? "",
      currency: args.currency ?? "",
      environment: "test",
      status: "connecting",
      revision: 1,
      trackingId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    return (await ctx.db.get(id))!;
  },
});
export const updateAccount = internalMutation({
  args: {
    tenantId: v.string(),
    accountId: v.id("tenantMerchantAccounts"),
    expectedRevision: v.number(),
    providerAccountId: v.optional(v.string()),
    onboardingUrl: v.optional(v.string()),
    capability: v.optional(v.any()),
    failure: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (
      !account ||
      account.tenantId !== args.tenantId ||
      account.revision !== args.expectedRevision
    )
      throw Error("MERCHANT_ACCOUNT_STALE");
    if (
      account.providerAccountId &&
      args.providerAccountId &&
      account.providerAccountId !== args.providerAccountId
    )
      throw Error("MERCHANT_ACCOUNT_REBIND_FORBIDDEN");
    const capability = args.capability as MerchantCapability | undefined;
    if (
      capability &&
      (capability.tenantId !== args.tenantId ||
        capability.merchantAccountRef !== account._id ||
        capability.provider !== account.provider ||
        capability.providerAccountRef !== (args.providerAccountId ?? account.providerAccountId) ||
        capability.environment !== "test")
    )
      throw Error("MERCHANT_CAPABILITY_BINDING_INVALID");
    await ctx.db.patch(account._id, {
      ...(args.providerAccountId ? { providerAccountId: args.providerAccountId } : {}),
      ...(args.onboardingUrl ? { onboardingUrl: args.onboardingUrl } : {}),
      ...(capability
        ? {
            capability,
            sellerCountry: capability.sellerCountry,
            currency: capability.settlementCurrencies[0]!,
          }
        : {}),
      status: args.failure ? "unavailable" : capability ? "ready" : "connecting",
      lastFailure: args.failure,
      revision: account.revision + 1,
      updatedAt: Date.now(),
    });
    return { revision: account.revision + 1 };
  },
});
export const checkoutContext = internalQuery({
  args: { tenantId: v.string(), orderId: v.id("tenantOrders"), provider },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || order.tenantId !== args.tenantId) throw Error("MERCHANT_ORDER_UNAVAILABLE");
    const account = await ctx.db
      .query("tenantMerchantAccounts")
      .withIndex("by_tenant_project_provider", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("projectId", order.projectId)
          .eq("provider", args.provider),
      )
      .unique();
    const payment = await ctx.db
      .query("tenantMerchantPayments")
      .withIndex("by_tenant_order", (q) => q.eq("tenantId", args.tenantId).eq("orderId", order._id))
      .unique();
    return { order, account, payment };
  },
});
export const prepareCheckout = internalMutation({
  args: { tenantId: v.string(), orderId: v.id("tenantOrders"), provider },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || order.tenantId !== args.tenantId) throw Error("MERCHANT_ORDER_UNAVAILABLE");
    const account = await ctx.db
      .query("tenantMerchantAccounts")
      .withIndex("by_tenant_project_provider", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("projectId", order.projectId)
          .eq("provider", args.provider),
      )
      .unique();
    if (!account || account.status !== "ready") throw Error("MERCHANT_ONBOARDING_REQUIRED");
    const local = await ctx.db
      .query("tenantOrderAttempts")
      .withIndex("by_tenant_order", (q) => q.eq("tenantId", args.tenantId).eq("orderId", order._id))
      .unique();
    if (!local || local.snapshotHash !== order.snapshotHash)
      throw Error("MERCHANT_ORDER_INTEGRITY_INVALID");
    const previous = await ctx.db
      .query("tenantMerchantPayments")
      .withIndex("by_tenant_order", (q) => q.eq("tenantId", args.tenantId).eq("orderId", order._id))
      .unique();
    const prepared = prepareMerchantCheckout({
      capability: account.capability as MerchantCapability,
      tenantId: args.tenantId,
      provider: args.provider,
      environment: "test",
      sellerCountry: account.sellerCountry,
      buyerCountry: order.snapshot.country,
      currency: order.snapshot.currency,
      settlementCurrency: account.currency,
      now: Date.now(),
      orderId: order._id,
      attemptId: local._id,
      quoteHash: order.snapshotHash,
      totalMinor: order.snapshot.totalMinor,
      expiresAt: order.expiresAt,
      ...(previous ? { existingAttempt: previous.state as MerchantCheckoutAttempt } : {}),
    });
    if (!prepared.ok) throw Error(`MERCHANT_CHECKOUT_${prepared.reason}`);
    if (previous) {
      if (!previous.providerOrderId) throw Error("MERCHANT_CHECKOUT_IN_FLIGHT_OR_UNKNOWN");
      return previous;
    }
    const now = Date.now();
    const id = await ctx.db.insert("tenantMerchantPayments", {
      tenantId: args.tenantId,
      projectId: order.projectId,
      orderId: order._id,
      localAttemptId: local._id,
      merchantAccountId: account._id,
      provider: args.provider,
      state: prepared.value,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    return (await ctx.db.get(id))!;
  },
});
export const updateCheckout = internalMutation({
  args: {
    tenantId: v.string(),
    paymentId: v.id("tenantMerchantPayments"),
    providerOrderId: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
    buyerTokenHash: v.optional(v.string()),
    unknown: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.tenantId !== args.tenantId) throw Error("MERCHANT_PAYMENT_UNAVAILABLE");
    if (
      payment.providerOrderId &&
      args.providerOrderId &&
      payment.providerOrderId !== args.providerOrderId
    )
      throw Error("MERCHANT_PAYMENT_REBIND_FORBIDDEN");
    if (
      payment.buyerTokenHash &&
      args.buyerTokenHash &&
      payment.buyerTokenHash !== args.buyerTokenHash
    )
      throw Error("MERCHANT_BUYER_REBIND_FORBIDDEN");
    await ctx.db.patch(payment._id, {
      ...(args.providerOrderId ? { providerOrderId: args.providerOrderId } : {}),
      ...(args.checkoutUrl ? { checkoutUrl: args.checkoutUrl } : {}),
      ...(args.buyerTokenHash ? { buyerTokenHash: args.buyerTokenHash } : {}),
      ...(args.unknown ? { state: { ...payment.state, status: "unknown" } } : {}),
      revision: payment.revision + 1,
      updatedAt: Date.now(),
    });
  },
});
export const providerPayment = internalQuery({
  args: { provider, providerOrderId: v.string(), providerAccountId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const payment = await ctx.db
      .query("tenantMerchantPayments")
      .withIndex("by_provider_order", (q) =>
        q.eq("provider", args.provider).eq("providerOrderId", args.providerOrderId),
      )
      .unique();
    if (
      !payment ||
      (args.providerAccountId !== undefined &&
        payment.state.providerAccountRef !== args.providerAccountId)
    )
      return null;
    return payment;
  },
});
export const paymentForTenant = internalQuery({
  args: { tenantId: v.string(), paymentId: v.id("tenantMerchantPayments") },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.tenantId !== args.tenantId) throw Error("MERCHANT_PAYMENT_UNAVAILABLE");
    return payment;
  },
});
export const applyPayment = internalMutation({
  args: {
    tenantId: v.string(),
    paymentId: v.id("tenantMerchantPayments"),
    receipt: v.any(),
    buyerEmail: v.optional(v.string()),
    buyerAddress: v.optional(
      v.object({
        name: v.string(),
        line1: v.string(),
        line2: v.optional(v.string()),
        city: v.string(),
        region: v.optional(v.string()),
        postalCode: v.string(),
        country: v.string(),
      }),
    ),
    deliveryReviewReason: v.optional(
      v.union(v.literal("buyer_address_missing"), v.literal("buyer_country_mismatch")),
    ),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.tenantId !== args.tenantId) throw Error("MERCHANT_PAYMENT_UNAVAILABLE");
    const state = payment.state as MerchantCheckoutAttempt,
      receipt = args.receipt as NormalizedMerchantPaymentReceipt;
    const checked = validateMerchantPaymentReceipt(state, receipt);
    if (!checked.ok) throw Error(`MERCHANT_RECEIPT_${checked.reason}`);
    if (checked.value.duplicate) return { duplicate: true, status: state.status };
    const prior = await ctx.db
      .query("tenantMerchantEvents")
      .withIndex("by_provider_event", (q) =>
        q.eq("provider", payment.provider).eq("eventRef", receipt.eventRef),
      )
      .unique();
    if (
      prior &&
      (prior.tenantId !== args.tenantId ||
        prior.paymentId !== payment._id ||
        prior.fingerprint !== checked.value.fingerprint)
    )
      throw Error("MERCHANT_EVENT_CONFLICT");
    const order = await ctx.db.get(payment.orderId);
    if (!order || order.tenantId !== args.tenantId || order.snapshotHash !== state.quoteHash)
      throw Error("MERCHANT_ORDER_INTEGRITY_INVALID");
    const { hash, ...quotedBody } = order.snapshot;
    if (hash !== order.snapshotHash || hashOrderQuote(quotedBody) !== hash)
      throw Error("MERCHANT_QUOTE_INTEGRITY_INVALID");
    let outcome: MerchantInventoryOutcome | undefined;
    if (
      receipt.outcome === "succeeded" &&
      state.status !== "paid" &&
      state.status !== "merchant_review"
    ) {
      const holds = await ctx.db
        .query("tenantReservations")
        .withIndex("by_tenant_order", (q) =>
          q.eq("tenantId", args.tenantId).eq("orderId", order._id),
        )
        .take(51);
      if (holds.length !== order.snapshot.lines.length || holds.length > 50)
        throw Error("MERCHANT_HOLD_INTEGRITY_INVALID");
      const changes = [];
      for (const line of order.snapshot.lines) {
        const hold = holds.find((row) => row.productId === line.productId);
        if (
          !hold ||
          hold.attemptId !== payment.localAttemptId ||
          hold.quantity !== line.quantity ||
          hold.expiresAt !== order.expiresAt
        )
          throw Error("MERCHANT_HOLD_INTEGRITY_INVALID");
        const stock = await ctx.db
          .query("tenantStock")
          .withIndex("by_tenant_product", (q) =>
            q.eq("tenantId", args.tenantId).eq("productId", hold.productId),
          )
          .unique();
        if (!stock) throw Error("MERCHANT_STOCK_UNAVAILABLE");
        const stockState: InventoryState =
          stock.kind === "finite"
            ? {
                kind: "finite",
                tenantId: args.tenantId,
                productId: stock.productId,
                onHand: stock.onHand!,
                reserved: stock.reserved!,
                revision: stock.revision,
                reservationTtlMs: stock.reservationTtlMs,
              }
            : {
                kind: "untracked",
                tenantId: args.tenantId,
                productId: stock.productId,
                approved: stock.approvedUntracked === true,
                revision: stock.revision,
              };
        const reservation = {
          id: hold._id,
          tenantId: hold.tenantId,
          productId: hold.productId,
          quantity: hold.quantity,
          status: hold.status,
          expiresAt: hold.expiresAt,
        };
        const result = consumeInventory(stockState, reservation, Date.now(), stock.revision);
        changes.push({ hold, stock, stockState, reservation, result });
      }
      outcome = changes.find((row) => row.result.kind !== "consumed")?.result.kind ?? "consumed";
      for (const row of changes) {
        const result =
          outcome !== "consumed" && row.result.kind === "consumed"
            ? releaseInventory(row.stockState, row.reservation, row.stock.revision)
            : row.result;
        await ctx.db.patch(row.hold._id, {
          status: result.reservation.status,
          updatedAt: Date.now(),
        });
        await ctx.db.patch(row.stock._id, {
          revision: result.stock.revision,
          ...(result.stock.kind === "finite"
            ? { onHand: result.stock.onHand, reserved: result.stock.reserved }
            : {}),
          updatedAt: Date.now(),
        });
      }
    }
    const transitioned = transitionMerchantPayment(state, receipt, outcome);
    if (!transitioned.ok) throw Error(`MERCHANT_RECEIPT_${transitioned.reason}`);
    const automation = await ctx.db
      .query("tenantMerchantAutomation")
      .withIndex("by_tenant_project", (q) =>
        q.eq("tenantId", args.tenantId).eq("projectId", payment.projectId),
      )
      .unique();
    await ctx.db.patch(payment._id, {
      state: transitioned.value.attempt,
      ...(args.buyerAddress ? { buyerAddress: args.buyerAddress } : {}),
      ...(args.buyerAddress || args.buyerEmail
        ? { buyerPurgeAt: Date.now() + (automation?.buyerRetentionDays ?? 30) * 86400000 }
        : {}),
      ...(args.buyerEmail ? { buyerEmail: args.buyerEmail } : {}),
      ...(args.deliveryReviewReason ? { deliveryReviewReason: args.deliveryReviewReason } : {}),
      revision: payment.revision + 1,
      updatedAt: Date.now(),
    });
    if (receipt.outcome === "succeeded")
      await ctx.db.patch(order._id, {
        status:
          transitioned.value.merchantReviewRequired || args.deliveryReviewReason
            ? "paid_needs_review"
            : "paid",
        updatedAt: Date.now(),
      });
    if (!prior)
      await ctx.db.insert("tenantMerchantEvents", {
        tenantId: args.tenantId,
        provider: payment.provider,
        eventRef: receipt.eventRef,
        paymentId: payment._id,
        fingerprint: checked.value.fingerprint,
        outcome: receipt.outcome,
        createdAt: Date.now(),
      });
    await appendAudit(ctx, {
      tenantId: args.tenantId,
      correlationId: `merchant-payment:${payment._id}`,
      eventType: "tenant_merchant.payment_observed",
      actor: "merchant-provider-reconciliation",
      payload: {
        paymentId: payment._id,
        orderId: order._id,
        eventRef: receipt.eventRef,
        quoteHash: state.quoteHash,
        status: transitioned.value.attempt.status,
      },
    });
    const ref = makeFunctionReference<
      "mutation",
      { tenantId: string; paymentId: Id<"tenantMerchantPayments"> },
      null
    >("merchantOperations:afterPayment");
    if (receipt.outcome === "succeeded")
      await ctx.scheduler.runAfter(0, ref, { tenantId: args.tenantId, paymentId: payment._id });
    return { duplicate: false, status: transitioned.value.attempt.status };
  },
});
