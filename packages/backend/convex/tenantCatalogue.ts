import {
  adjustFiniteStock,
  type CatalogueItem,
  configureInventoryPolicy,
  createCatalogueItem,
  editCatalogueItem,
  expireInventory,
  type InventoryState,
  releaseInventory,
  reserveInventory,
  type StockReservation,
  validateInventory,
} from "@pikar/core/tenantInventory";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";

const status = v.union(v.literal("draft"), v.literal("active"), v.literal("retired"));
const goodsKind = v.union(v.literal("physical"), v.literal("digital"));
const stockInput = v.union(
  v.object({
    kind: v.literal("finite"),
    onHand: v.number(),
    reservationTtlMs: v.optional(v.number()),
  }),
  v.object({ kind: v.literal("untracked"), approved: v.boolean() }),
);
const expireReservationDueRef = makeFunctionReference<
  "mutation",
  { tenantId: string; productId: Id<"tenantProducts">; reservationId: Id<"tenantReservations"> },
  null
>("tenantCatalogue:expireReservationDue");

function itemFrom(row: Doc<"tenantProducts">): CatalogueItem {
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

function stockFrom(row: Doc<"tenantStock">): InventoryState {
  if (row.kind === "finite") {
    return {
      kind: "finite",
      tenantId: row.tenantId,
      productId: row.productId,
      onHand: row.onHand ?? -1,
      reserved: row.reserved ?? -1,
      revision: row.revision,
      reservationTtlMs: row.reservationTtlMs,
    };
  }
  return {
    kind: "untracked",
    tenantId: row.tenantId,
    productId: row.productId,
    approved: row.approvedUntracked === true,
    revision: row.revision,
  };
}

function reservationFrom(row: Doc<"tenantReservations">): StockReservation {
  return {
    id: row._id,
    tenantId: row.tenantId,
    productId: row.productId,
    quantity: row.quantity,
    status: row.status,
    expiresAt: row.expiresAt,
  };
}

async function productFor(ctx: MutationCtx, tenantId: string, productId: Id<"tenantProducts">) {
  const product = await ctx.db.get(productId);
  if (!product || product.tenantId !== tenantId) throw new Error("PRODUCT_UNAVAILABLE");
  return product;
}

async function stockFor(ctx: MutationCtx, tenantId: string, productId: Id<"tenantProducts">) {
  const stock = await ctx.db
    .query("tenantStock")
    .withIndex("by_tenant_product", (q) => q.eq("tenantId", tenantId).eq("productId", productId))
    .unique();
  if (!stock) throw new Error("STOCK_UNAVAILABLE");
  return stock;
}

async function stockAudit(
  ctx: MutationCtx,
  tenantId: string,
  actor: string,
  eventType: string,
  productId: string,
  stockRevision: number,
  payload: { reservationId?: string; delta?: number; quantity?: number; status?: string },
) {
  await appendAudit(ctx, {
    tenantId,
    correlationId: `tenant-stock:${productId}:${stockRevision}`,
    eventType,
    actor,
    payload: { productId, stockRevision, ...payload },
  });
}

/** Authenticated tenant operator surface. No anonymous checkout route is exposed here. */
export type CreateProductInput = {
  sku: string;
  variant: string;
  currency: string;
  priceMinor: number;
  status: "draft" | "active" | "retired";
  goodsKind?: "physical" | "digital";
  stock:
    | { kind: "finite"; onHand: number; reservationTtlMs?: number }
    | { kind: "untracked"; approved: boolean };
};
/** Trusted tenant-derived adapter seam; no public identity override. */
export async function createProductForTenant(
  ctx: MutationCtx,
  tenantId: string,
  args: CreateProductInput,
) {
  await assertTenantWritable(ctx, tenantId);
  const duplicate = await ctx.db
    .query("tenantProducts")
    .withIndex("by_tenant_sku_variant", (q) =>
      q.eq("tenantId", tenantId).eq("sku", args.sku).eq("variant", args.variant),
    )
    .first();
  if (duplicate) throw new Error("DUPLICATE_SKU");
  const pendingId = "pending-product";
  const stock: InventoryState =
    args.stock.kind === "finite"
      ? {
          kind: "finite",
          tenantId: tenantId,
          productId: pendingId,
          onHand: args.stock.onHand,
          reserved: 0,
          reservationTtlMs: args.stock.reservationTtlMs,
          revision: 1,
        }
      : {
          kind: "untracked",
          tenantId: tenantId,
          productId: pendingId,
          approved: args.stock.approved,
          revision: 1,
        };
  const validated = createCatalogueItem(
    {
      tenantId: tenantId,
      sku: args.sku,
      variant: args.variant,
      currency: args.currency,
      priceMinor: args.priceMinor,
      status: args.status,
      goodsKind: args.goodsKind,
    },
    stock,
    pendingId,
  );
  const now = Date.now();
  const productId = await ctx.db.insert("tenantProducts", {
    tenantId: tenantId,
    sku: validated.sku,
    variant: validated.variant,
    currency: validated.currency,
    priceMinor: validated.priceMinor,
    status: validated.status,
    goodsKind: validated.goodsKind,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("tenantStock", {
    tenantId: tenantId,
    productId,
    kind: stock.kind,
    ...(stock.kind === "finite"
      ? {
          onHand: stock.onHand,
          reserved: stock.reserved,
          reservationTtlMs: stock.reservationTtlMs,
        }
      : { approvedUntracked: stock.approved }),
    revision: 1,
    updatedAt: now,
  });
  await stockAudit(ctx, tenantId, tenantId, "tenant.catalogue.created", productId, 1, {
    status: validated.status,
  });
  return { productId, revision: 1, stockRevision: 1 };
}

export const createProduct = tenantMutation({
  args: {
    sku: v.string(),
    variant: v.string(),
    currency: v.string(),
    priceMinor: v.number(),
    status,
    goodsKind: v.optional(goodsKind),
    stock: stockInput,
  },
  handler: (ctx, args) => createProductForTenant(ctx, ctx.tenantId, args),
});

export const editProduct = tenantMutation({
  args: {
    productId: v.id("tenantProducts"),
    expectedRevision: v.number(),
    priceMinor: v.optional(v.number()),
    status: v.optional(status),
    goodsKind: v.optional(goodsKind),
  },
  handler: async (ctx, args) => {
    const product = await productFor(ctx, ctx.tenantId, args.productId);
    const stock = await stockFor(ctx, ctx.tenantId, args.productId);
    const next = editCatalogueItem(
      itemFrom(product),
      ctx.tenantId,
      args.expectedRevision,
      {
        ...(args.priceMinor === undefined ? {} : { priceMinor: args.priceMinor }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.goodsKind === undefined ? {} : { goodsKind: args.goodsKind }),
      },
      stockFrom(stock),
    );
    await ctx.db.patch(product._id, {
      priceMinor: next.priceMinor,
      status: next.status,
      goodsKind: next.goodsKind,
      revision: next.revision,
      updatedAt: Date.now(),
    });
    await stockAudit(
      ctx,
      ctx.tenantId,
      ctx.userId,
      "tenant.catalogue.edited",
      product._id,
      stock.revision,
      { status: next.status },
    );
    return { revision: next.revision };
  },
});

export type UpdateProductForSetupInput = {
  productId: Id<"tenantProducts">;
  expectedRevision: number;
  expectedStockRevision: number;
  currency: string;
  goodsKind: "physical" | "digital";
  priceMinor: number;
  /** Omission preserves current counts, including stock sold since the original setup. */
  stock?: CreateProductInput["stock"];
};
/** Trusted exact-package native approval seam. No public RPC or agent execution grant. */
export async function updateProductForSetup(
  ctx: MutationCtx,
  tenantId: string,
  args: UpdateProductForSetupInput,
) {
  await assertTenantWritable(ctx, tenantId);
  const product = await productFor(ctx, tenantId, args.productId);
  const stock = await stockFor(ctx, tenantId, args.productId);
  if (product.revision !== args.expectedRevision || stock.revision !== args.expectedStockRevision)
    throw Error("STALE_REVISION");
  // An existing identity may already belong to immutable paid/pending quotes or delivered goods.
  if (product.currency !== args.currency || product.goodsKind !== args.goodsKind)
    throw Error("SETUP_IDENTITY_CHANGE_REQUIRES_NEW_SKU");
  validateInventory(stockFrom(stock), tenantId, product._id);
  let nextStock = stockFrom(stock);
  if (args.stock) {
    const proposed: InventoryState =
      args.stock.kind === "finite"
        ? {
            tenantId,
            productId: product._id,
            kind: "finite",
            onHand: args.stock.onHand,
            reserved: stock.kind === "finite" ? (stock.reserved ?? 0) : 0,
            reservationTtlMs: args.stock.reservationTtlMs,
            revision: stock.revision + 1,
          }
        : {
            tenantId,
            productId: product._id,
            kind: "untracked",
            approved: args.stock.approved,
            revision: stock.revision + 1,
          };
    validateInventory(proposed, tenantId, product._id);
    const changed =
      proposed.kind !== stock.kind ||
      (proposed.kind === "finite"
        ? proposed.onHand !== stock.onHand || proposed.reservationTtlMs !== stock.reservationTtlMs
        : proposed.approved !== stock.approvedUntracked);
    if (changed) {
      const held = await ctx.db
        .query("tenantReservations")
        .withIndex("by_tenant_product_status_expiry", (q) =>
          q.eq("tenantId", tenantId).eq("productId", product._id).eq("status", "held"),
        )
        .first();
      if (held || (stock.kind === "finite" && (stock.reserved ?? 0) > 0))
        throw Error("SETUP_STOCK_CHANGE_WITH_HELD_RESERVATIONS");
      nextStock = proposed;
    }
  }
  const productChanged = product.priceMinor !== args.priceMinor || product.status !== "active";
  const next = editCatalogueItem(
    itemFrom(product),
    tenantId,
    args.expectedRevision,
    { priceMinor: args.priceMinor, status: "active" },
    nextStock,
  );
  if (productChanged)
    await ctx.db.patch(product._id, {
      priceMinor: next.priceMinor,
      status: next.status,
      revision: next.revision,
      updatedAt: Date.now(),
    });
  if (nextStock.revision !== stock.revision)
    await ctx.db.patch(stock._id, {
      kind: nextStock.kind,
      onHand: nextStock.kind === "finite" ? nextStock.onHand : undefined,
      reserved: nextStock.kind === "finite" ? nextStock.reserved : undefined,
      reservationTtlMs: nextStock.kind === "finite" ? nextStock.reservationTtlMs : undefined,
      approvedUntracked: nextStock.kind === "untracked" ? nextStock.approved : undefined,
      revision: nextStock.revision,
      updatedAt: Date.now(),
    });
  if (productChanged || nextStock.revision !== stock.revision)
    await stockAudit(
      ctx,
      tenantId,
      tenantId,
      "tenant.catalogue.setup_updated",
      product._id,
      nextStock.revision,
      { status: next.status },
    );
  return {
    revision: productChanged ? next.revision : product.revision,
    stockRevision: nextStock.revision,
  };
}

export const adjustStock = tenantMutation({
  args: { productId: v.id("tenantProducts"), expectedRevision: v.number(), delta: v.number() },
  handler: async (ctx, args) => {
    await productFor(ctx, ctx.tenantId, args.productId);
    const stock = await stockFor(ctx, ctx.tenantId, args.productId);
    const next = adjustFiniteStock(stockFrom(stock), args.expectedRevision, args.delta);
    if (next.kind !== "finite") throw new Error("FINITE_STOCK_REQUIRED");
    await ctx.db.patch(stock._id, {
      onHand: next.onHand,
      reserved: next.reserved,
      revision: next.revision,
      updatedAt: Date.now(),
    });
    await stockAudit(
      ctx,
      ctx.tenantId,
      ctx.userId,
      "tenant.stock.adjusted",
      args.productId,
      next.revision,
      { delta: args.delta },
    );
    return { stockRevision: next.revision, onHand: next.onHand, reserved: next.reserved };
  },
});

export const configureStockPolicy = tenantMutation({
  args: {
    productId: v.id("tenantProducts"),
    expectedStockRevision: v.number(),
    policy: v.union(
      v.object({ kind: v.literal("finite"), reservationTtlMs: v.number() }),
      v.object({ kind: v.literal("untracked"), approved: v.boolean() }),
    ),
  },
  handler: async (ctx, args) => {
    const product = await productFor(ctx, ctx.tenantId, args.productId);
    const stock = await stockFor(ctx, ctx.tenantId, args.productId);
    const next = configureInventoryPolicy(
      itemFrom(product),
      ctx.tenantId,
      stockFrom(stock),
      args.expectedStockRevision,
      args.policy,
    );
    await ctx.db.patch(stock._id, {
      revision: next.revision,
      ...(next.kind === "finite"
        ? { reservationTtlMs: next.reservationTtlMs }
        : { approvedUntracked: next.approved }),
      updatedAt: Date.now(),
    });
    await stockAudit(
      ctx,
      ctx.tenantId,
      ctx.userId,
      "tenant.stock.policy_configured",
      args.productId,
      next.revision,
      { status: product.status },
    );
    return { stockRevision: next.revision };
  },
});

export const reserveProduct = tenantMutation({
  args: {
    productId: v.id("tenantProducts"),
    expectedStockRevision: v.number(),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const product = await productFor(ctx, ctx.tenantId, args.productId);
    const stock = await stockFor(ctx, ctx.tenantId, args.productId);
    const now = Date.now();
    const next = reserveInventory(
      itemFrom(product),
      ctx.tenantId,
      stockFrom(stock),
      "pending-reservation",
      args.quantity,
      now,
      args.expectedStockRevision,
    );
    const reservationId = await ctx.db.insert("tenantReservations", {
      tenantId: ctx.tenantId,
      productId: args.productId,
      quantity: next.reservation.quantity,
      status: "held",
      expiresAt: next.reservation.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(stock._id, {
      revision: next.stock.revision,
      ...(next.stock.kind === "finite" ? { reserved: next.stock.reserved } : {}),
      updatedAt: now,
    });
    await ctx.scheduler.runAt(next.reservation.expiresAt, expireReservationDueRef, {
      tenantId: ctx.tenantId,
      productId: args.productId,
      reservationId,
    });
    await stockAudit(
      ctx,
      ctx.tenantId,
      ctx.userId,
      "tenant.stock.reserved",
      args.productId,
      next.stock.revision,
      { reservationId, quantity: args.quantity },
    );
    return { reservationId, stockRevision: next.stock.revision };
  },
});

export const releaseReservation = tenantMutation({
  args: {
    productId: v.id("tenantProducts"),
    reservationId: v.id("tenantReservations"),
    expectedStockRevision: v.number(),
  },
  handler: async (ctx, args) => {
    await productFor(ctx, ctx.tenantId, args.productId);
    const reservation = await ctx.db.get(args.reservationId);
    if (
      !reservation ||
      reservation.tenantId !== ctx.tenantId ||
      reservation.productId !== args.productId
    )
      throw new Error("RESERVATION_UNAVAILABLE");
    if (reservation.orderId || reservation.attemptId)
      throw new Error("ORDER_HOLD_MANAGED_BY_ORDER");
    const stock = await stockFor(ctx, ctx.tenantId, args.productId);
    const next = releaseInventory(
      stockFrom(stock),
      reservationFrom(reservation),
      args.expectedStockRevision,
    );
    await ctx.db.patch(stock._id, {
      revision: next.stock.revision,
      ...(next.stock.kind === "finite" ? { reserved: next.stock.reserved } : {}),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(reservation._id, { status: "released", updatedAt: Date.now() });
    await stockAudit(
      ctx,
      ctx.tenantId,
      ctx.userId,
      "tenant.stock.released",
      args.productId,
      next.stock.revision,
      { reservationId: args.reservationId, quantity: reservation.quantity },
    );
    return { stockRevision: next.stock.revision };
  },
});

export const expireReservation = tenantMutation({
  args: {
    productId: v.id("tenantProducts"),
    reservationId: v.id("tenantReservations"),
    expectedStockRevision: v.number(),
  },
  handler: async (ctx, args) => {
    await productFor(ctx, ctx.tenantId, args.productId);
    const reservation = await ctx.db.get(args.reservationId);
    if (
      !reservation ||
      reservation.tenantId !== ctx.tenantId ||
      reservation.productId !== args.productId
    )
      throw new Error("RESERVATION_UNAVAILABLE");
    if (reservation.orderId || reservation.attemptId)
      throw new Error("ORDER_HOLD_MANAGED_BY_ORDER");
    const stock = await stockFor(ctx, ctx.tenantId, args.productId);
    const next = expireInventory(
      stockFrom(stock),
      reservationFrom(reservation),
      Date.now(),
      args.expectedStockRevision,
    );
    await ctx.db.patch(stock._id, {
      revision: next.stock.revision,
      ...(next.stock.kind === "finite" ? { reserved: next.stock.reserved } : {}),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(reservation._id, { status: "expired", updatedAt: Date.now() });
    await stockAudit(
      ctx,
      ctx.tenantId,
      ctx.userId,
      "tenant.stock.expired",
      args.productId,
      next.stock.revision,
      { reservationId: args.reservationId, quantity: reservation.quantity },
    );
    return { stockRevision: next.stock.revision };
  },
});

/** Journaled due-time release for standalone catalogue holds. Order-linked holds have their own
 * order timer and cannot be closed by this path, including after a link is changed. */
export const expireReservationDue = internalMutation({
  args: {
    tenantId: v.string(),
    productId: v.id("tenantProducts"),
    reservationId: v.id("tenantReservations"),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (
      !reservation ||
      reservation.tenantId !== args.tenantId ||
      reservation.productId !== args.productId ||
      reservation.orderId ||
      reservation.attemptId ||
      reservation.status !== "held"
    )
      return null;
    const now = Date.now();
    if (now < reservation.expiresAt) return null;
    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) throw new Error("PRODUCT_UNAVAILABLE");
    const stock = await stockFor(ctx, args.tenantId, args.productId);
    const next = expireInventory(
      stockFrom(stock),
      reservationFrom(reservation),
      now,
      stock.revision,
    );
    await ctx.db.patch(stock._id, {
      revision: next.stock.revision,
      ...(next.stock.kind === "finite" ? { reserved: next.stock.reserved } : {}),
      updatedAt: now,
    });
    await ctx.db.patch(reservation._id, { status: "expired", updatedAt: now });
    await stockAudit(
      ctx,
      args.tenantId,
      "system",
      "tenant.stock.expired",
      args.productId,
      next.stock.revision,
      {
        reservationId: args.reservationId,
        quantity: reservation.quantity,
      },
    );
    return null;
  },
});

export const listProducts = tenantQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("INVALID_PAGE_SIZE");
    const page = await ctx.db
      .query("tenantProducts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    const products = await Promise.all(
      page.page.map(async (row) => {
        const stock = await ctx.db
          .query("tenantStock")
          .withIndex("by_tenant_product", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("productId", row._id),
          )
          .unique();
        if (!stock) throw new Error("STOCK_UNAVAILABLE");
        const state = stockFrom(stock);
        validateInventory(state, ctx.tenantId, row._id);
        return {
          _id: row._id,
          sku: row.sku,
          variant: row.variant,
          currency: row.currency,
          priceMinor: row.priceMinor,
          goodsKind: row.goodsKind ?? null,
          status: row.status,
          revision: row.revision,
          stockRevision: state.revision,
          available:
            state.kind === "finite" ? state.onHand - state.reserved : ("untracked" as const),
          reservationTtlMs: state.kind === "finite" ? (state.reservationTtlMs ?? null) : null,
        };
      }),
    );
    return { products, nextCursor: page.isDone ? null : page.continueCursor };
  },
});
