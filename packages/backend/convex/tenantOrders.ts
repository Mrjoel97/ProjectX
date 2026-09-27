import {
  type CatalogueItem,
  expireInventory,
  type InventoryState,
  releaseInventory,
  reserveInventory,
} from "@pikar/core/tenantInventory";
import {
  hashOrderQuote,
  type OrderLineRequest,
  type OrderPolicy,
  quoteOrder,
  transitionOrder,
} from "@pikar/core/tenantOrder";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import { tenantMutation, tenantQuery } from "./lib/functions";

const CART_TTL_MS = 30 * 60_000;
const EXPIRY_PAGE_SIZE = 5;
const expireDueRef = makeFunctionReference<
  "mutation",
  { tenantId: string; orderId: Id<"tenantOrders"> },
  null
>("tenantOrders:expireDue");
const lineValidator = v.object({
  presentationItemId: v.string(),
  productId: v.id("tenantProducts"),
  quantity: v.number(),
  expectedProductRevision: v.number(),
  expectedUnitMinor: v.number(),
});
const linesValidator = v.array(lineValidator);
const hash = (value: string) => `sha256:${sha256Bytes(new TextEncoder().encode(value))}`;
const ref = (value: string) =>
  typeof value === "string" && value.length <= 128 && value.trim().length > 0;
const cartLines = (lines: readonly OrderLineRequest[]) => {
  if (
    lines.length < 1 ||
    lines.length > 50 ||
    new Set(lines.map((line) => line.productId)).size !== lines.length ||
    lines.some(
      (line) =>
        !ref(line.presentationItemId) ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > 100 ||
        !Number.isSafeInteger(line.expectedProductRevision) ||
        line.expectedProductRevision < 1 ||
        !Number.isSafeInteger(line.expectedUnitMinor) ||
        line.expectedUnitMinor <= 0,
    )
  )
    throw new Error("INVALID_CART");
};
async function projectFor(ctx: MutationCtx, tenantId: string, projectId: Id<"webProjects">) {
  const project = await ctx.db.get(projectId);
  if (!project || project.tenantId !== tenantId || project.kind !== "storefront")
    throw new Error("PROJECT_UNAVAILABLE");
  return project;
}
function stockFrom(row: Doc<"tenantStock">): InventoryState {
  return row.kind === "finite"
    ? {
        kind: "finite",
        tenantId: row.tenantId,
        productId: row.productId,
        onHand: row.onHand ?? -1,
        reserved: row.reserved ?? -1,
        revision: row.revision,
        reservationTtlMs: row.reservationTtlMs,
      }
    : {
        kind: "untracked",
        tenantId: row.tenantId,
        productId: row.productId,
        approved: row.approvedUntracked === true,
        revision: row.revision,
      };
}
function productFrom(row: Doc<"tenantProducts">): CatalogueItem {
  return {
    id: row._id,
    tenantId: row.tenantId,
    sku: row.sku,
    variant: row.variant,
    currency: row.currency,
    priceMinor: row.priceMinor,
    status: row.status,
    goodsKind: row.goodsKind,
    revision: row.revision,
  };
}
function policyFrom(row: Doc<"tenantCommercePolicies">): OrderPolicy {
  return {
    id: row._id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    revision: row.revision,
    sellerOfRecordRef: row.sellerOfRecordRef,
    currency: row.currency,
    countries: row.countries,
    taxRounding: row.taxRounding as "half_up",
    physical: row.physical,
    digital: row.digital,
  };
}
async function refsAudit(
  ctx: MutationCtx,
  tenantId: string,
  eventType: string,
  orderId: string,
  attemptId: string,
  snapshotHash: string,
) {
  await appendAudit(ctx, {
    tenantId,
    correlationId: `tenant-order:${orderId}:${attemptId}`,
    eventType,
    actor: "tenant-commerce-local",
    payload: { orderId, attemptId, snapshotHash },
  });
}

/** Authenticated operator config; source refs are explicit tenant declarations, not tax/legal verification. */
export const configurePolicy = tenantMutation({
  args: {
    projectId: v.id("webProjects"),
    expectedRevision: v.number(),
    sellerOfRecordRef: v.string(),
    currency: v.string(),
    countries: v.array(v.string()),
    taxRounding: v.literal("half_up"),
    physical: v.optional(
      v.object({
        shippingSourceRef: v.string(),
        shippingMinor: v.number(),
        returnsPolicyRef: v.string(),
        taxSourceRef: v.string(),
        taxBasisPoints: v.number(),
        refundPolicyRef: v.string(),
        buyerRetentionRef: v.string(),
      }),
    ),
    digital: v.optional(
      v.object({
        deliveryRef: v.string(),
        revocationRef: v.string(),
        noShipping: v.literal(true),
        taxSourceRef: v.string(),
        taxBasisPoints: v.number(),
        refundPolicyRef: v.string(),
        buyerRetentionRef: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await projectFor(ctx, ctx.tenantId, args.projectId);
    const latest = await ctx.db
      .query("tenantCommercePolicies")
      .withIndex("by_tenant_project_revision", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", args.projectId),
      )
      .order("desc")
      .first();
    if ((latest?.revision ?? 0) !== args.expectedRevision) throw new Error("STALE_REVISION");
    const branch = (value: {
      taxSourceRef: string;
      taxBasisPoints: number;
      refundPolicyRef: string;
      buyerRetentionRef: string;
    }) =>
      ref(value.taxSourceRef) &&
      Number.isSafeInteger(value.taxBasisPoints) &&
      value.taxBasisPoints >= 0 &&
      value.taxBasisPoints <= 10_000 &&
      ref(value.refundPolicyRef) &&
      ref(value.buyerRetentionRef);
    if (
      !ref(args.sellerOfRecordRef) ||
      !/^[A-Z]{3}$/.test(args.currency) ||
      args.countries.length < 1 ||
      args.countries.length > 249 ||
      !args.countries.every((country) => /^[A-Z]{2}$/.test(country)) ||
      new Set(args.countries).size !== args.countries.length ||
      (!args.physical && !args.digital) ||
      (args.physical &&
        (!branch(args.physical) ||
          !ref(args.physical.shippingSourceRef) ||
          !Number.isSafeInteger(args.physical.shippingMinor) ||
          args.physical.shippingMinor < 0 ||
          !ref(args.physical.returnsPolicyRef))) ||
      (args.digital &&
        (!branch(args.digital) ||
          args.digital.noShipping !== true ||
          !ref(args.digital.deliveryRef) ||
          !ref(args.digital.revocationRef)))
    )
      throw new Error("POLICY_REQUIRED");
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0 ||
      args.expectedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("INVALID_REVISION");
    const revision = args.expectedRevision + 1;
    const { expectedRevision: _expectedRevision, ...fields } = args;
    const policyId = await ctx.db.insert("tenantCommercePolicies", {
      ...fields,
      tenantId: ctx.tenantId,
      revision,
      createdAt: Date.now(),
    });
    return { policyId, revision };
  },
});

export const mapProduct = tenantMutation({
  args: {
    projectId: v.id("webProjects"),
    presentationItemId: v.string(),
    productId: v.id("tenantProducts"),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    await projectFor(ctx, ctx.tenantId, args.projectId);
    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== ctx.tenantId) throw new Error("PRODUCT_UNAVAILABLE");
    if (
      !ref(args.presentationItemId) ||
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0 ||
      args.expectedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("INVALID_MAPPING");
    const existing = await ctx.db
      .query("tenantCommerceMappings")
      .withIndex("by_tenant_project_item", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("projectId", args.projectId)
          .eq("presentationItemId", args.presentationItemId),
      )
      .unique();
    if ((existing?.revision ?? 0) !== args.expectedRevision) throw new Error("STALE_REVISION");
    const revision = args.expectedRevision + 1;
    const now = Date.now();
    if (existing)
      await ctx.db.patch(existing._id, { productId: args.productId, revision, updatedAt: now });
    else
      await ctx.db.insert("tenantCommerceMappings", {
        tenantId: ctx.tenantId,
        projectId: args.projectId,
        presentationItemId: args.presentationItemId,
        productId: args.productId,
        revision,
        createdAt: now,
        updatedAt: now,
      });
    return { revision };
  },
});

export const createCart = tenantMutation({
  args: { projectId: v.id("webProjects"), lines: linesValidator, addressCountry: v.string() },
  handler: async (ctx, args) => {
    await projectFor(ctx, ctx.tenantId, args.projectId);
    cartLines(args.lines);
    if (!/^[A-Z]{2}$/.test(args.addressCountry)) throw new Error("INVALID_ADDRESS_COUNTRY");
    const now = Date.now();
    const cartId = await ctx.db.insert("tenantCarts", {
      tenantId: ctx.tenantId,
      projectId: args.projectId,
      lines: args.lines,
      addressCountry: args.addressCountry,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + CART_TTL_MS,
    });
    return { cartId, revision: 1, expiresAt: now + CART_TTL_MS };
  },
});

export const updateCart = tenantMutation({
  args: {
    cartId: v.id("tenantCarts"),
    expectedRevision: v.number(),
    lines: linesValidator,
    addressCountry: v.string(),
  },
  handler: async (ctx, args) => {
    const cart = await ctx.db.get(args.cartId);
    if (!cart || cart.tenantId !== ctx.tenantId) throw new Error("CART_UNAVAILABLE");
    if (Date.now() >= cart.expiresAt) throw new Error("CART_EXPIRED");
    if (cart.revision !== args.expectedRevision) throw new Error("STALE_REVISION");
    cartLines(args.lines);
    if (!/^[A-Z]{2}$/.test(args.addressCountry) || cart.revision >= Number.MAX_SAFE_INTEGER)
      throw new Error("INVALID_CART");
    const now = Date.now();
    await ctx.db.patch(cart._id, {
      lines: args.lines,
      addressCountry: args.addressCountry,
      revision: cart.revision + 1,
      updatedAt: now,
      expiresAt: now + CART_TTL_MS,
    });
    return { revision: cart.revision + 1, expiresAt: now + CART_TTL_MS };
  },
});

/** One Convex transaction journals the immutable quote, attempt and every stock hold. */
export const placeOrder = tenantMutation({
  args: { cartId: v.id("tenantCarts"), expectedCartRevision: v.number(), retryKey: v.string() },
  handler: async (ctx, args) => {
    if (!ref(args.retryKey)) throw new Error("INVALID_RETRY_KEY");
    const cart = await ctx.db.get(args.cartId);
    if (!cart || cart.tenantId !== ctx.tenantId) throw new Error("CART_UNAVAILABLE");
    const retryKeyHash = hash(args.retryKey);
    const prior = await ctx.db
      .query("tenantOrderAttempts")
      .withIndex("by_tenant_cart_retry", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("cartId", args.cartId).eq("retryKeyHash", retryKeyHash),
      )
      .unique();
    if (prior) {
      if (prior.cartRevision !== args.expectedCartRevision || cart.revision !== prior.cartRevision)
        throw new Error("RETRY_KEY_CONFLICT");
      return {
        orderId: prior.orderId,
        attemptId: prior._id,
        status: prior.status,
        snapshotHash: prior.snapshotHash,
      };
    }
    if (Date.now() >= cart.expiresAt) throw new Error("CART_EXPIRED");
    if (cart.revision !== args.expectedCartRevision) throw new Error("STALE_REVISION");
    const existingRevision = await ctx.db
      .query("tenantOrderAttempts")
      .withIndex("by_tenant_cart_revision", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("cartId", cart._id).eq("cartRevision", cart.revision),
      )
      .unique();
    if (existingRevision) throw new Error("CART_ATTEMPT_EXISTS");
    await projectFor(ctx, ctx.tenantId, cart.projectId);
    // Demand-driven bounded sweep: expired holds on products in this cart cannot strand sellable
    // finite stock. A backlog beyond one transaction's ceiling refuses; reconcileExpiredProduct
    // drains it in explicit bounded pages before checkout can retry.
    const now = Date.now();
    const expired = [];
    for (const productId of new Set(cart.lines.map((line) => line.productId))) {
      const page = await ctx.db
        .query("tenantReservations")
        .withIndex("by_tenant_product_status_expiry", (q) =>
          q
            .eq("tenantId", ctx.tenantId)
            .eq("productId", productId)
            .eq("status", "held")
            .lt("expiresAt", now + 1),
        )
        .take(EXPIRY_PAGE_SIZE + 1);
      expired.push(...page);
      if (expired.length > EXPIRY_PAGE_SIZE) throw new Error("EXPIRY_BACKLOG");
    }
    await expireHeldRows(ctx, ctx.tenantId, expired, now);
    const policy = await ctx.db
      .query("tenantCommercePolicies")
      .withIndex("by_tenant_project_revision", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("projectId", cart.projectId),
      )
      .order("desc")
      .first();
    if (!policy) throw new Error("CONFIGURATION_REQUIRED");
    const live = [];
    for (const line of cart.lines) {
      const mapping = await ctx.db
        .query("tenantCommerceMappings")
        .withIndex("by_tenant_project_item", (q) =>
          q
            .eq("tenantId", ctx.tenantId)
            .eq("projectId", cart.projectId)
            .eq("presentationItemId", line.presentationItemId),
        )
        .unique();
      if (!mapping || mapping.productId !== line.productId) throw new Error("MAPPING_STALE");
      const product = await ctx.db.get(mapping.productId);
      if (!product || product.tenantId !== ctx.tenantId) throw new Error("PRODUCT_UNAVAILABLE");
      const stock = await ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("productId", product._id),
        )
        .unique();
      if (!stock) throw new Error("STOCK_UNAVAILABLE");
      live.push({
        presentationItemId: line.presentationItemId,
        productId: product._id,
        product: productFrom(product),
        stock: stockFrom(stock),
        stockRow: stock,
      });
    }
    const result = quoteOrder({
      tenantId: ctx.tenantId,
      projectId: cart.projectId,
      addressCountry: cart.addressCountry,
      lines: cart.lines,
      mappings: live,
      policy: policyFrom(policy),
    });
    if (!result.ok) throw new Error(`QUOTE_${result.reason.toUpperCase()}`);
    // Cart expiry decides whether checkout may begin; it must not truncate a hold that starts now.
    // For a mixed cart, the earliest actual stock hold still sets the shared order deadline.
    const expiry = Math.min(
      ...live.map(
        ({ stock }) => now + (stock.kind === "finite" ? stock.reservationTtlMs! : 24 * 60 * 60_000),
      ),
    );
    const orderId = await ctx.db.insert("tenantOrders", {
      tenantId: ctx.tenantId,
      projectId: cart.projectId,
      cartId: cart._id,
      cartRevision: cart.revision,
      snapshot: { ...result.snapshot, lines: [...result.snapshot.lines] },
      snapshotHash: result.snapshot.hash,
      status: "pending",
      expiresAt: expiry,
      createdAt: now,
      updatedAt: now,
    });
    const attemptId = await ctx.db.insert("tenantOrderAttempts", {
      tenantId: ctx.tenantId,
      orderId,
      cartId: cart._id,
      cartRevision: cart.revision,
      retryKeyHash,
      snapshotHash: result.snapshot.hash,
      status: "local_pending",
      createdAt: now,
      updatedAt: now,
    });
    for (const line of cart.lines) {
      const item = live.find((entry) => entry.productId === line.productId)!;
      const held = reserveInventory(
        item.product,
        ctx.tenantId,
        item.stock,
        "pending-reservation",
        line.quantity,
        now,
        item.stock.revision,
      );
      await ctx.db.insert("tenantReservations", {
        tenantId: ctx.tenantId,
        productId: line.productId,
        orderId,
        attemptId,
        quantity: line.quantity,
        status: "held",
        expiresAt: expiry,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(item.stockRow._id, {
        revision: held.stock.revision,
        ...(held.stock.kind === "finite" ? { reserved: held.stock.reserved } : {}),
        updatedAt: now,
      });
    }
    // The timer is journaled with the order transaction. A cancelled or demand-expired order
    // makes the eventual callback idempotent; an idle catalogue still releases stock at TTL.
    await ctx.scheduler.runAt(expiry, expireDueRef, { tenantId: ctx.tenantId, orderId });
    await refsAudit(
      ctx,
      ctx.tenantId,
      "tenant.order.local_pending",
      orderId,
      attemptId,
      result.snapshot.hash,
    );
    return {
      orderId,
      attemptId,
      status: "local_pending" as const,
      snapshotHash: result.snapshot.hash,
    };
  },
});

async function closeHeld(
  ctx: MutationCtx,
  order: Doc<"tenantOrders">,
  now: number,
  mode: "expire" | "cancel",
) {
  // New quotes hash canonical JSON. The original local quotes hashed insertion-order JSON;
  // retain that verifier so their still-held reservations can close without migration.
  // Rebuild their quote-time field order because Convex may reorder keys on read.
  const snapshot = order.snapshot;
  const quotedBody = {
    tenantId: snapshot.tenantId,
    projectId: snapshot.projectId,
    currency: snapshot.currency,
    country: snapshot.country,
    policyId: snapshot.policyId,
    policyRevision: snapshot.policyRevision,
    sellerOfRecordRef: snapshot.sellerOfRecordRef,
    taxRounding: snapshot.taxRounding,
    ...(snapshot.physicalPolicy ? { physicalPolicy: snapshot.physicalPolicy } : {}),
    ...(snapshot.digitalPolicy ? { digitalPolicy: snapshot.digitalPolicy } : {}),
    lines: snapshot.lines.map((line) => ({
      presentationItemId: line.presentationItemId,
      productId: line.productId,
      sku: line.sku,
      goodsKind: line.goodsKind,
      taxSourceRef: line.taxSourceRef,
      refundPolicyRef: line.refundPolicyRef,
      buyerRetentionRef: line.buyerRetentionRef,
      productRevision: line.productRevision,
      stockRevision: line.stockRevision,
      unitMinor: line.unitMinor,
      quantity: line.quantity,
      lineMinor: line.lineMinor,
    })),
    subtotalMinor: snapshot.subtotalMinor,
    taxMinor: snapshot.taxMinor,
    shippingMinor: snapshot.shippingMinor,
    totalMinor: snapshot.totalMinor,
  };
  if (
    snapshot.hash !== order.snapshotHash ||
    (snapshot.hash !== hashOrderQuote(quotedBody) &&
      snapshot.hash !== hash(JSON.stringify(quotedBody))) ||
    snapshot.tenantId !== order.tenantId ||
    snapshot.projectId !== order.projectId
  )
    throw new Error("RESERVATION_LINK_INCOMPLETE");
  const reservations = await ctx.db
    .query("tenantReservations")
    .withIndex("by_tenant_order", (q) => q.eq("tenantId", order.tenantId).eq("orderId", order._id))
    .take(51);
  if (reservations.length !== order.snapshot.lines.length)
    throw new Error("RESERVATION_LINK_INCOMPLETE");
  const attempts = await ctx.db
    .query("tenantOrderAttempts")
    .withIndex("by_tenant_order", (q) => q.eq("tenantId", order.tenantId).eq("orderId", order._id))
    .take(2);
  if (
    attempts.length !== 1 ||
    attempts[0]?.snapshotHash !== order.snapshotHash ||
    attempts[0]?.cartId !== order.cartId ||
    attempts[0]?.cartRevision !== order.cartRevision ||
    attempts[0]?.status !== "local_pending"
  )
    throw new Error("RESERVATION_LINK_INCOMPLETE");
  const attemptId = attempts[0]._id;
  const expectedLines = new Map(
    order.snapshot.lines.map((line) => [line.productId, line.quantity]),
  );
  if (
    expectedLines.size !== order.snapshot.lines.length ||
    reservations.some(
      (reservation) =>
        reservation.status !== "held" ||
        reservation.attemptId !== attemptId ||
        reservation.expiresAt !== order.expiresAt ||
        expectedLines.get(reservation.productId) !== reservation.quantity,
    ) ||
    new Set(reservations.map((reservation) => reservation.productId)).size !== reservations.length
  ) {
    throw new Error("RESERVATION_LINK_INCOMPLETE");
  }
  for (const reservation of reservations) {
    const stock = await ctx.db
      .query("tenantStock")
      .withIndex("by_tenant_product", (q) =>
        q.eq("tenantId", order.tenantId).eq("productId", reservation.productId),
      )
      .unique();
    if (!stock) throw new Error("STOCK_UNAVAILABLE");
    const state = stockFrom(stock);
    const hold = {
      id: reservation._id,
      tenantId: reservation.tenantId,
      productId: reservation.productId,
      quantity: reservation.quantity,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
    } as const;
    const result =
      mode === "expire" && now >= reservation.expiresAt
        ? expireInventory(state, hold, now, state.revision)
        : releaseInventory(state, hold, state.revision);
    await ctx.db.patch(stock._id, {
      revision: result.stock.revision,
      ...(result.stock.kind === "finite" ? { reserved: result.stock.reserved } : {}),
      updatedAt: now,
    });
    await ctx.db.patch(reservation._id, {
      status: mode === "expire" ? "expired" : "released",
      updatedAt: now,
    });
  }
}

async function expireOrderInTx(ctx: MutationCtx, order: Doc<"tenantOrders">, now: number) {
  if (order.status !== "pending" || now < order.expiresAt) return;
  await closeHeld(ctx, order, now, "expire");
  await ctx.db.patch(order._id, {
    status: transitionOrder(order.status, "expire"),
    updatedAt: now,
  });
  const attempts = await ctx.db
    .query("tenantOrderAttempts")
    .withIndex("by_tenant_order", (q) => q.eq("tenantId", order.tenantId).eq("orderId", order._id))
    .take(2);
  for (const attempt of attempts)
    await ctx.db.patch(attempt._id, { status: "expired", updatedAt: now });
}

async function expireHeldRows(
  ctx: MutationCtx,
  tenantId: string,
  rows: readonly Doc<"tenantReservations">[],
  now: number,
) {
  const visited = new Set<string>();
  for (const reservation of rows) {
    if (reservation.orderId) {
      if (visited.has(reservation.orderId)) continue;
      visited.add(reservation.orderId);
      const order = await ctx.db.get(reservation.orderId);
      if (!order || order.tenantId !== tenantId) throw new Error("ORDER_LINK_INVALID");
      await expireOrderInTx(ctx, order, now);
      continue;
    }
    const stock = await ctx.db
      .query("tenantStock")
      .withIndex("by_tenant_product", (q) =>
        q.eq("tenantId", tenantId).eq("productId", reservation.productId),
      )
      .unique();
    if (!stock) throw new Error("STOCK_UNAVAILABLE");
    const next = expireInventory(
      stockFrom(stock),
      {
        id: reservation._id,
        tenantId,
        productId: reservation.productId,
        quantity: reservation.quantity,
        status: reservation.status,
        expiresAt: reservation.expiresAt,
      },
      now,
      stock.revision,
    );
    await ctx.db.patch(stock._id, {
      revision: next.stock.revision,
      ...(next.stock.kind === "finite" ? { reserved: next.stock.reserved } : {}),
      updatedAt: now,
    });
    await ctx.db.patch(reservation._id, { status: "expired", updatedAt: now });
  }
}

/** Durable timer landing. Only its exact persisted order/tenant pair may be changed. */
export const expireDue = internalMutation({
  args: { tenantId: v.string(), orderId: v.id("tenantOrders") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || order.tenantId !== args.tenantId) return null;
    await expireOrderInTx(ctx, order, Date.now());
    return null;
  },
});

/** Explicit bounded drain for a busy product; checkout also invokes one batch automatically. */
export const reconcileExpiredProduct = tenantMutation({
  args: { productId: v.id("tenantProducts") },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== ctx.tenantId) throw new Error("PRODUCT_UNAVAILABLE");
    const now = Date.now();
    const page = await ctx.db
      .query("tenantReservations")
      .withIndex("by_tenant_product_status_expiry", (q) =>
        q
          .eq("tenantId", ctx.tenantId)
          .eq("productId", args.productId)
          .eq("status", "held")
          .lt("expiresAt", now + 1),
      )
      .take(EXPIRY_PAGE_SIZE + 1);
    await expireHeldRows(ctx, ctx.tenantId, page.slice(0, EXPIRY_PAGE_SIZE), now);
    return {
      processed: Math.min(page.length, EXPIRY_PAGE_SIZE),
      hasMore: page.length > EXPIRY_PAGE_SIZE,
    };
  },
});

export const expireOrder = tenantMutation({
  args: { orderId: v.id("tenantOrders") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || order.tenantId !== ctx.tenantId) throw new Error("ORDER_UNAVAILABLE");
    if (order.status !== "pending") return { status: order.status };
    const now = Date.now();
    if (now < order.expiresAt) throw new Error("ORDER_NOT_EXPIRED");
    await expireOrderInTx(ctx, order, now);
    return { status: "expired" as const };
  },
});

export const cancelOrder = tenantMutation({
  args: { orderId: v.id("tenantOrders") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order || order.tenantId !== ctx.tenantId) throw new Error("ORDER_UNAVAILABLE");
    const next = transitionOrder(order.status, "cancel");
    if (order.status === "pending") await closeHeld(ctx, order, Date.now(), "cancel");
    if (next !== order.status)
      await ctx.db.patch(order._id, { status: next, updatedAt: Date.now() });
    if (next === "cancelled" && next !== order.status) {
      const attempts = await ctx.db
        .query("tenantOrderAttempts")
        .withIndex("by_tenant_order", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("orderId", order._id),
        )
        .take(2);
      for (const attempt of attempts)
        await ctx.db.patch(attempt._id, { status: "refused", updatedAt: Date.now() });
    }
    return { status: next };
  },
});

export const getOrder = tenantQuery({
  args: { orderId: v.id("tenantOrders") },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    return order?.tenantId === ctx.tenantId ? order : null;
  },
});
