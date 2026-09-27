import { exportableTables } from "@pikar/core/tenantData";
import { type DefaultFunctionArgs, makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const fn = <Kind extends "query" | "mutation", Args extends DefaultFunctionArgs, Result = unknown>(
  name: string,
) => makeFunctionReference<Kind, Args, Result>(`tenantOrders:${name}`);
const createProduct = makeFunctionReference<
  "mutation",
  {
    sku: string;
    variant: string;
    currency: string;
    priceMinor: number;
    status: "active";
    goodsKind: "physical" | "digital";
    stock: { kind: "finite"; onHand: number; reservationTtlMs: number };
  },
  { productId: string }
>("tenantCatalogue:createProduct");
const configureStockPolicy = makeFunctionReference<
  "mutation",
  {
    productId: string;
    expectedStockRevision: number;
    policy: { kind: "finite"; reservationTtlMs: number };
  },
  unknown
>("tenantCatalogue:configureStockPolicy");
type Branch = {
  taxSourceRef: string;
  taxBasisPoints: number;
  refundPolicyRef: string;
  buyerRetentionRef: string;
};
type PolicyArgs = {
  projectId: string;
  expectedRevision: number;
  sellerOfRecordRef: string;
  currency: string;
  countries: string[];
  taxRounding: "half_up";
  physical?: Branch & {
    shippingSourceRef: string;
    shippingMinor: number;
    returnsPolicyRef: string;
  };
  digital?: Branch & { deliveryRef: string; revocationRef: string; noShipping: true };
};
const configurePolicy = fn<"mutation", PolicyArgs, { policyId: string; revision: number }>(
  "configurePolicy",
);
const mapProduct = fn<
  "mutation",
  { projectId: string; presentationItemId: string; productId: string; expectedRevision: number }
>("mapProduct");
const createCart = fn<
  "mutation",
  {
    projectId: string;
    addressCountry: string;
    lines: {
      presentationItemId: string;
      productId: string;
      quantity: number;
      expectedProductRevision: number;
      expectedUnitMinor: number;
    }[];
  },
  { cartId: string; revision: number }
>("createCart");
const updateCart = fn<
  "mutation",
  {
    cartId: string;
    expectedRevision: number;
    addressCountry: string;
    lines: {
      presentationItemId: string;
      productId: string;
      quantity: number;
      expectedProductRevision: number;
      expectedUnitMinor: number;
    }[];
  },
  { revision: number }
>("updateCart");
const placeOrder = fn<
  "mutation",
  { cartId: string; expectedCartRevision: number; retryKey: string },
  { orderId: string; attemptId: string; status: string; snapshotHash: string }
>("placeOrder");
const expireOrder = fn<"mutation", { orderId: string }, { status: string }>("expireOrder");
const cancelOrder = fn<"mutation", { orderId: string }, { status: string }>("cancelOrder");
const reconcileExpiredProduct = fn<
  "mutation",
  { productId: string },
  { processed: number; hasMore: boolean }
>("reconcileExpiredProduct");
const getOrder = fn<
  "query",
  { orderId: string },
  { snapshot: { totalMinor: number; hash: string }; status: string; expiresAt: number } | null
>("getOrder");
const authorizeTenantDeletion = makeFunctionReference<
  "mutation",
  { tenantId: string; userId: string },
  unknown
>("tenantDelete:authorizeTenantDeletion");
const exportTenantData = makeFunctionReference<
  "query",
  {
    cursor: {
      tableIndex: number;
      cursor: null;
      rowsExported: number;
      tableRows: number;
      truncated: boolean;
      generatedAt: string;
    };
  },
  { table: { name: string; rows: unknown[] } }
>("tenantExport:exportTenantData");
const expireDue = makeFunctionReference<"mutation", { tenantId: string; orderId: string }, null>(
  "tenantOrders:expireDue",
);

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}
async function setup(t: ReturnType<typeof harness>, email: string) {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
  const actor = t.withIdentity({ subject: `${userId}|session` });
  const projectId = await t.run((ctx) =>
    ctx.db.insert("webProjects", {
      tenantId: String(userId),
      kind: "storefront",
      slug: `store-${email[0]}`,
      title: "Private",
      publicHost: "private.test",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const { productId } = await actor.mutation(createProduct, {
    sku: "lamp",
    variant: "one",
    goodsKind: "physical",
    currency: "USD",
    priceMinor: 1250,
    status: "active",
    stock: { kind: "finite", onHand: 2, reservationTtlMs: 900_000 },
  });
  const policy = {
    projectId,
    expectedRevision: 0,
    sellerOfRecordRef: "seller-a",
    currency: "USD",
    countries: ["TZ"],
    taxRounding: "half_up" as const,
    physical: {
      taxSourceRef: "tax-tz-v1",
      taxBasisPoints: 1000,
      shippingSourceRef: "ship-tz-v1",
      shippingMinor: 300,
      returnsPolicyRef: "returns-v1",
      refundPolicyRef: "refund-v1",
      buyerRetentionRef: "retain-v1",
    },
    digital: {
      taxSourceRef: "tax-digital",
      taxBasisPoints: 500,
      deliveryRef: "deliver-v1",
      revocationRef: "revoke-v1",
      noShipping: true as const,
      refundPolicyRef: "refund-d",
      buyerRetentionRef: "retain-d",
    },
  };
  await actor.mutation(configurePolicy, policy);
  await actor.mutation(mapProduct, {
    projectId,
    presentationItemId: "card-1",
    productId,
    expectedRevision: 0,
  });
  const lines = [
    {
      presentationItemId: "card-1",
      productId,
      quantity: 1,
      expectedProductRevision: 1,
      expectedUnitMinor: 1250,
    },
  ];
  const cart = await actor.mutation(createCart, { projectId, addressCountry: "TZ", lines });
  return { actor, userId, projectId, productId, policy, lines, cart };
}

describe("local tenant order adapter", () => {
  test("digital-only and mixed carts pin branch facts and charge physical shipping once", async () => {
    const t = harness();
    const a = await setup(t, "digital@example.test");
    const { productId: digitalId } = await a.actor.mutation(createProduct, {
      sku: "ebook",
      variant: "one",
      goodsKind: "digital",
      currency: "USD",
      priceMinor: 1000,
      status: "active",
      stock: { kind: "finite", onHand: 2, reservationTtlMs: 900_000 },
    });
    await a.actor.mutation(mapProduct, {
      projectId: a.projectId,
      presentationItemId: "card-2",
      productId: digitalId,
      expectedRevision: 0,
    });
    const digitalLine = {
      presentationItemId: "card-2",
      productId: digitalId,
      quantity: 1,
      expectedProductRevision: 1,
      expectedUnitMinor: 1000,
    };
    const digitalCart = await a.actor.mutation(createCart, {
      projectId: a.projectId,
      addressCountry: "TZ",
      lines: [digitalLine],
    });
    const digitalPlaced = await a.actor.mutation(placeOrder, {
      cartId: digitalCart.cartId,
      expectedCartRevision: 1,
      retryKey: "digital",
    });
    const digitalOrder = await a.actor.query(getOrder, { orderId: digitalPlaced.orderId });
    expect(digitalOrder?.snapshot).toMatchObject({
      subtotalMinor: 1000,
      taxMinor: 50,
      shippingMinor: 0,
      totalMinor: 1050,
      lines: [{ goodsKind: "digital", buyerRetentionRef: "retain-d", refundPolicyRef: "refund-d" }],
    });
    const mixedCart = await a.actor.mutation(createCart, {
      projectId: a.projectId,
      addressCountry: "TZ",
      lines: [...a.lines, digitalLine],
    });
    const mixedPlaced = await a.actor.mutation(placeOrder, {
      cartId: mixedCart.cartId,
      expectedCartRevision: 1,
      retryKey: "mixed",
    });
    expect(
      (await a.actor.query(getOrder, { orderId: mixedPlaced.orderId }))?.snapshot,
    ).toMatchObject({
      subtotalMinor: 2250,
      taxMinor: 175,
      shippingMinor: 300,
      totalMinor: 2725,
      policyRevision: 1,
    });
    expect(await t.run((ctx) => ctx.db.query("tenantOrderAttempts").collect())).toHaveLength(2);
  });

  test("legacy product and policy rows refuse before order or stock hold", async () => {
    const t = harness();
    const a = await setup(t, "legacy@example.test");
    await t.run((ctx) => ctx.db.patch(a.productId as never, { goodsKind: undefined }));
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "legacy-product",
      }),
    ).rejects.toThrow("QUOTE_CONFIGURATION_REQUIRED");
    expect(await t.run((ctx) => ctx.db.query("tenantOrders").collect())).toHaveLength(0);
    await t.run((ctx) => ctx.db.patch(a.productId as never, { goodsKind: "physical" }));
    await t.run(async (ctx) => {
      const latest = await ctx.db
        .query("tenantCommercePolicies")
        .withIndex("by_tenant_project_revision", (q) =>
          q.eq("tenantId", String(a.userId)).eq("projectId", a.projectId as never),
        )
        .unique();
      if (!latest) throw new Error("MISSING_POLICY");
      await ctx.db.patch(latest._id, { physical: undefined, digital: undefined });
    });
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "legacy-policy",
      }),
    ).rejects.toThrow("QUOTE_CONFIGURATION_REQUIRED");
    expect(await t.run((ctx) => ctx.db.query("tenantReservations").collect())).toHaveLength(0);
  });

  test("policy CAS refuses stale edits and existing snapshot retains its exact revision", async () => {
    const t = harness();
    const a = await setup(t, "policy@example.test");
    const placed = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "before-edit",
    });
    const before = (await a.actor.query(getOrder, { orderId: placed.orderId }))?.snapshot;
    await expect(
      a.actor.mutation(configurePolicy, { ...a.policy, expectedRevision: 0 }),
    ).rejects.toThrow("STALE_REVISION");
    await expect(
      a.actor.mutation(configurePolicy, {
        ...a.policy,
        expectedRevision: 1,
        digital: { ...a.policy.digital, buyerRetentionRef: "" },
      }),
    ).rejects.toThrow("POLICY_REQUIRED");
    await a.actor.mutation(configurePolicy, {
      ...a.policy,
      expectedRevision: 1,
      physical: { ...a.policy.physical, shippingMinor: 400 },
    });
    expect((await a.actor.query(getOrder, { orderId: placed.orderId }))?.snapshot).toEqual(before);
    expect(before).toMatchObject({ policyRevision: 1, physicalPolicy: { shippingMinor: 300 } });
  });
  test("stores exact live quote, attempt and hold atomically; retry is same attempt", async () => {
    const t = harness();
    const a = await setup(t, "a@example.test");
    const first = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "retry-1",
    });
    const same = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "retry-1",
    });
    expect(same).toEqual(first);
    const order = await a.actor.query(getOrder, { orderId: first.orderId });
    expect(order).toMatchObject({
      status: "pending",
      snapshot: { totalMinor: 1675, hash: first.snapshotHash },
    });
    const rows = await t.run(async (ctx) => ({
      attempts: await ctx.db.query("tenantOrderAttempts").collect(),
      holds: await ctx.db.query("tenantReservations").collect(),
      stock: await ctx.db.query("tenantStock").collect(),
      audit: await ctx.db.query("audit").collect(),
    }));
    expect(rows.attempts).toHaveLength(1);
    expect(rows.holds).toMatchObject([
      { orderId: first.orderId, attemptId: first.attemptId, status: "held" },
    ]);
    expect(rows.stock[0]).toMatchObject({ reserved: 1 });
    expect(JSON.stringify(rows.audit)).not.toMatch(/@example\.test|tax-tz|ship-tz/);
  });

  test("a merchant's 60-minute hold starts at order placement, even when the cart is nearly expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t = harness();
      const a = await setup(t, "hold-window@example.test");
      const cartCreatedAt = Date.now();
      await a.actor.mutation(configureStockPolicy, {
        productId: a.productId,
        expectedStockRevision: 1,
        policy: { kind: "finite", reservationTtlMs: 60 * 60_000 },
      });
      vi.setSystemTime(new Date(cartCreatedAt + 29 * 60_000));
      const placedAt = Date.now();
      const placed = await a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "sixty-minute-hold",
      });
      const order = await a.actor.query(getOrder, { orderId: placed.orderId });
      const holds = await t.run((ctx) => ctx.db.query("tenantReservations").collect());
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(order?.expiresAt).toBe(placedAt + 60 * 60_000);
      expect(holds).toMatchObject([{ status: "held", expiresAt: order?.expiresAt }]);
      expect(scheduled).toMatchObject([
        { scheduledTime: order?.expiresAt, state: { kind: "pending" } },
      ]);
      expect(order?.expiresAt).toBeGreaterThan(cartCreatedAt + 30 * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a legacy 24-hour finite policy refuses before order writes and can be reconfigured", async () => {
    const t = harness();
    const a = await setup(t, "legacy-hold@example.test");
    await t.run(async (ctx) => {
      const stock = await ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", String(a.userId)).eq("productId", a.productId as never),
        )
        .unique();
      if (!stock) throw new Error("MISSING_STOCK");
      await ctx.db.patch(stock._id, { reservationTtlMs: 24 * 60 * 60_000 });
    });
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "legacy-wide-hold",
      }),
    ).rejects.toThrow("QUOTE_CONFIGURATION_REQUIRED");
    const refused = await t.run(async (ctx) => ({
      orders: await ctx.db.query("tenantOrders").collect(),
      attempts: await ctx.db.query("tenantOrderAttempts").collect(),
      holds: await ctx.db.query("tenantReservations").collect(),
    }));
    expect(refused).toEqual({ orders: [], attempts: [], holds: [] });
    await a.actor.mutation(configureStockPolicy, {
      productId: a.productId,
      expectedStockRevision: 1,
      policy: { kind: "finite", reservationTtlMs: 60 * 60_000 },
    });
    expect(
      (
        await a.actor.mutation(placeOrder, {
          cartId: a.cart.cartId,
          expectedCartRevision: 1,
          retryKey: "reconfigured-hold",
        })
      ).status,
    ).toBe("local_pending");
  });

  test("a mixed cart shares the earliest configured stock deadline across every linked hold", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t = harness();
      const a = await setup(t, "mixed-window@example.test");
      await a.actor.mutation(configureStockPolicy, {
        productId: a.productId,
        expectedStockRevision: 1,
        policy: { kind: "finite", reservationTtlMs: 60_000 },
      });
      const { productId: digitalId } = await a.actor.mutation(createProduct, {
        sku: "ebook",
        variant: "one",
        goodsKind: "digital",
        currency: "USD",
        priceMinor: 1000,
        status: "active",
        stock: { kind: "finite", onHand: 2, reservationTtlMs: 60 * 60_000 },
      });
      await a.actor.mutation(mapProduct, {
        projectId: a.projectId,
        presentationItemId: "card-2",
        productId: digitalId,
        expectedRevision: 0,
      });
      const cart = await a.actor.mutation(createCart, {
        projectId: a.projectId,
        addressCountry: "TZ",
        lines: [
          ...a.lines,
          {
            presentationItemId: "card-2",
            productId: digitalId,
            quantity: 1,
            expectedProductRevision: 1,
            expectedUnitMinor: 1000,
          },
        ],
      });
      const placedAt = Date.now();
      const placed = await a.actor.mutation(placeOrder, {
        cartId: cart.cartId,
        expectedCartRevision: 1,
        retryKey: "mixed-window",
      });
      const order = await a.actor.query(getOrder, { orderId: placed.orderId });
      const holds = await t.run((ctx) => ctx.db.query("tenantReservations").collect());
      expect(order?.expiresAt).toBe(placedAt + 60_000);
      expect(holds).toHaveLength(2);
      expect(
        holds.every((hold) => hold.expiresAt === order?.expiresAt && hold.status === "held"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("two-tenant swapped IDs, stale price and finite-stock races refuse without extra order", async () => {
    const t = harness();
    const a = await setup(t, "a@example.test");
    const b = await setup(t, "b@example.test");
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: b.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "x",
      }),
    ).rejects.toThrow("CART_UNAVAILABLE");
    await expect(
      a.actor.mutation(mapProduct, {
        projectId: a.projectId,
        presentationItemId: "card-1",
        productId: b.productId,
        expectedRevision: 1,
      }),
    ).rejects.toThrow("PRODUCT_UNAVAILABLE");
    await expect(
      a.actor.mutation(createCart, {
        projectId: b.projectId,
        addressCountry: "TZ",
        lines: a.lines,
      }),
    ).rejects.toThrow("PROJECT_UNAVAILABLE");
    const first = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "one",
    });
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "two",
      }),
    ).rejects.toThrow("CART_ATTEMPT_EXISTS");
    const secondCart = await a.actor.mutation(createCart, {
      projectId: a.projectId,
      addressCountry: "TZ",
      lines: a.lines,
    });
    await a.actor.mutation(placeOrder, {
      cartId: secondCart.cartId,
      expectedCartRevision: 1,
      retryKey: "two",
    });
    const thirdCart = await a.actor.mutation(createCart, {
      projectId: a.projectId,
      addressCountry: "TZ",
      lines: a.lines,
    });
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: thirdCart.cartId,
        expectedCartRevision: 1,
        retryKey: "three",
      }),
    ).rejects.toThrow("QUOTE_OUT_OF_STOCK");
    await expect(
      a.actor.mutation(updateCart, {
        cartId: a.cart.cartId,
        expectedRevision: 0,
        addressCountry: "TZ",
        lines: a.lines,
      }),
    ).rejects.toThrow("STALE_REVISION");
    await a.actor.mutation(updateCart, {
      cartId: a.cart.cartId,
      expectedRevision: 1,
      addressCountry: "TZ",
      lines: [{ ...a.lines[0]!, expectedUnitMinor: 1000 }],
    });
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "one",
      }),
    ).rejects.toThrow("RETRY_KEY_CONFLICT");
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 2,
        retryKey: "new",
      }),
    ).rejects.toThrow("QUOTE_STALE");
    expect(await b.actor.query(getOrder, { orderId: first.orderId })).toBeNull();
  });

  test("policy omissions and unsupported address refuse before persistence", async () => {
    const t = harness();
    const a = await setup(t, "a@example.test");
    await expect(
      a.actor.mutation(configurePolicy, {
        ...a.policy,
        expectedRevision: 1,
        physical: { ...a.policy.physical, taxSourceRef: "" },
      }),
    ).rejects.toThrow("POLICY_REQUIRED");
    await expect(
      a.actor.mutation(configurePolicy, {
        ...a.policy,
        expectedRevision: 1,
        sellerOfRecordRef: " \t ",
      }),
    ).rejects.toThrow("POLICY_REQUIRED");
    await expect(
      a.actor.mutation(configurePolicy, {
        ...a.policy,
        expectedRevision: 1,
        physical: { ...a.policy.physical, refundPolicyRef: "  " },
      }),
    ).rejects.toThrow("POLICY_REQUIRED");
    await expect(
      a.actor.mutation(configurePolicy, { ...a.policy, expectedRevision: 1, countries: [] }),
    ).rejects.toThrow("POLICY_REQUIRED");
    const cart = await a.actor.mutation(createCart, {
      projectId: a.projectId,
      addressCountry: "US",
      lines: a.lines,
    });
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: cart.cartId,
        expectedCartRevision: 1,
        retryKey: "no-us",
      }),
    ).rejects.toThrow("QUOTE_UNSUPPORTED_GEOGRAPHY");
    expect(await t.run((ctx) => ctx.db.query("tenantOrders").collect())).toHaveLength(0);
  });

  test("expiry and cancellation release exactly one hold; a later payment is a pure review state", async () => {
    const t = harness();
    const a = await setup(t, "a@example.test");
    const first = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "expire",
    });
    await expect(a.actor.mutation(expireOrder, { orderId: first.orderId })).rejects.toThrow(
      "ORDER_NOT_EXPIRED",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(first.orderId as never, { expiresAt: 1 });
      const hold = await ctx.db
        .query("tenantReservations")
        .withIndex("by_tenant_order", (q) =>
          q.eq("tenantId", String(a.userId)).eq("orderId", first.orderId as never),
        )
        .unique();
      if (!hold) throw new Error("MISSING_HOLD");
      await ctx.db.patch(hold._id, { expiresAt: 1 });
    });
    expect(await a.actor.mutation(expireOrder, { orderId: first.orderId })).toEqual({
      status: "expired",
    });
    expect(await a.actor.mutation(expireOrder, { orderId: first.orderId })).toEqual({
      status: "expired",
    });
    expect(
      await a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "expire",
      }),
    ).toMatchObject({ attemptId: first.attemptId, status: "expired" });
    const nextCart = await a.actor.mutation(createCart, {
      projectId: a.projectId,
      addressCountry: "TZ",
      lines: a.lines,
    });
    const second = await a.actor.mutation(placeOrder, {
      cartId: nextCart.cartId,
      expectedCartRevision: 1,
      retryKey: "cancel",
    });
    expect(await a.actor.mutation(cancelOrder, { orderId: second.orderId })).toEqual({
      status: "cancelled",
    });
    expect(
      await a.actor.mutation(placeOrder, {
        cartId: nextCart.cartId,
        expectedCartRevision: 1,
        retryKey: "cancel",
      }),
    ).toMatchObject({ attemptId: second.attemptId, status: "refused" });
    expect(await a.actor.mutation(cancelOrder, { orderId: second.orderId })).toEqual({
      status: "cancelled",
    });
    expect((await t.run((ctx) => ctx.db.query("tenantStock").collect()))[0]).toMatchObject({
      reserved: 0,
      onHand: 2,
    });
  });

  test("cancellation refuses a reservation linked to the wrong snapshot product before releasing stock", async () => {
    const t = harness();
    const a = await setup(t, "wrong-hold@example.test");
    const { productId: otherProductId } = await a.actor.mutation(createProduct, {
      sku: "other",
      variant: "one",
      goodsKind: "physical",
      currency: "USD",
      priceMinor: 500,
      status: "active",
      stock: { kind: "finite", onHand: 2, reservationTtlMs: 900_000 },
    });
    const placed = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "wrong-link",
    });
    await t.run(async (ctx) => {
      const hold = await ctx.db
        .query("tenantReservations")
        .withIndex("by_tenant_order", (q) =>
          q.eq("tenantId", String(a.userId)).eq("orderId", placed.orderId as never),
        )
        .unique();
      const otherStock = await ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", String(a.userId)).eq("productId", otherProductId as never),
        )
        .unique();
      if (!hold || !otherStock) throw new Error("MISSING_FIXTURE_ROW");
      await ctx.db.patch(otherStock._id, { reserved: 1 });
      await ctx.db.patch(hold._id, { productId: otherProductId as never });
    });
    const rows = () =>
      t.run(async (ctx) => ({
        orders: await ctx.db.query("tenantOrders").collect(),
        attempts: await ctx.db.query("tenantOrderAttempts").collect(),
        holds: await ctx.db.query("tenantReservations").collect(),
        stocks: await ctx.db.query("tenantStock").collect(),
      }));
    const before = await rows();
    await expect(a.actor.mutation(cancelOrder, { orderId: placed.orderId })).rejects.toThrow(
      "RESERVATION_LINK_INCOMPLETE",
    );
    expect(await rows()).toEqual(before);
  });

  test("expiry refuses a reservation quantity that disagrees with the order snapshot", async () => {
    const t = harness();
    const a = await setup(t, "wrong-quantity@example.test");
    const placed = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "wrong-quantity",
    });
    await t.run(async (ctx) => {
      const hold = await ctx.db
        .query("tenantReservations")
        .withIndex("by_tenant_order", (q) =>
          q.eq("tenantId", String(a.userId)).eq("orderId", placed.orderId as never),
        )
        .unique();
      const stock = await ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", String(a.userId)).eq("productId", a.productId as never),
        )
        .unique();
      if (!hold || !stock) throw new Error("MISSING_FIXTURE_ROW");
      await ctx.db.patch(hold._id, { quantity: 2 });
      await ctx.db.patch(stock._id, { reserved: 2 });
      await ctx.db.patch(placed.orderId as never, { expiresAt: 1 });
      await ctx.db.patch(hold._id, { expiresAt: 1 });
    });
    const before = await t.run(async (ctx) => ({
      orders: await ctx.db.query("tenantOrders").collect(),
      attempts: await ctx.db.query("tenantOrderAttempts").collect(),
      holds: await ctx.db.query("tenantReservations").collect(),
      stocks: await ctx.db.query("tenantStock").collect(),
    }));
    await expect(a.actor.mutation(expireOrder, { orderId: placed.orderId })).rejects.toThrow(
      "RESERVATION_LINK_INCOMPLETE",
    );
    const after = await t.run(async (ctx) => ({
      orders: await ctx.db.query("tenantOrders").collect(),
      attempts: await ctx.db.query("tenantOrderAttempts").collect(),
      holds: await ctx.db.query("tenantReservations").collect(),
      stocks: await ctx.db.query("tenantStock").collect(),
    }));
    expect(after).toEqual(before);
  });

  test("cancellation refuses a hold linked to a different payment attempt before releasing stock", async () => {
    const t = harness();
    const a = await setup(t, "wrong-attempt@example.test");
    const first = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "first-attempt",
    });
    const nextCart = await a.actor.mutation(createCart, {
      projectId: a.projectId,
      addressCountry: "TZ",
      lines: a.lines,
    });
    const second = await a.actor.mutation(placeOrder, {
      cartId: nextCart.cartId,
      expectedCartRevision: 1,
      retryKey: "second-attempt",
    });
    await t.run(async (ctx) => {
      const hold = await ctx.db
        .query("tenantReservations")
        .withIndex("by_tenant_order", (q) =>
          q.eq("tenantId", String(a.userId)).eq("orderId", first.orderId as never),
        )
        .unique();
      if (!hold) throw new Error("MISSING_HOLD");
      await ctx.db.patch(hold._id, { attemptId: second.attemptId as never });
    });
    const rows = () =>
      t.run(async (ctx) => ({
        orders: await ctx.db.query("tenantOrders").collect(),
        attempts: await ctx.db.query("tenantOrderAttempts").collect(),
        holds: await ctx.db.query("tenantReservations").collect(),
        stocks: await ctx.db.query("tenantStock").collect(),
      }));
    const before = await rows();
    await expect(a.actor.mutation(cancelOrder, { orderId: first.orderId })).rejects.toThrow(
      "RESERVATION_LINK_INCOMPLETE",
    );
    expect(await rows()).toEqual(before);
  });

  test.each([
    "cancel",
    "expire",
  ] as const)("%s refuses a changed quote snapshot even when its stored hash and hold still match", async (mode) => {
    const t = harness();
    const a = await setup(t, `changed-snapshot-${mode}@example.test`);
    const placed = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: `changed-snapshot-${mode}`,
    });
    await t.run(async (ctx) => {
      const order = await ctx.db.get(placed.orderId as never);
      if (!order || !("snapshot" in order)) throw new Error("MISSING_ORDER");
      await ctx.db.patch(placed.orderId as never, {
        snapshot: { ...order.snapshot, totalMinor: order.snapshot.totalMinor + 1 },
        ...(mode === "expire" ? { expiresAt: 1 } : {}),
      });
      if (mode === "expire") {
        const hold = await ctx.db
          .query("tenantReservations")
          .withIndex("by_tenant_order", (q) =>
            q.eq("tenantId", String(a.userId)).eq("orderId", placed.orderId as never),
          )
          .unique();
        if (!hold) throw new Error("MISSING_HOLD");
        await ctx.db.patch(hold._id, { expiresAt: 1 });
      }
    });
    const rows = () =>
      t.run(async (ctx) => ({
        orders: await ctx.db.query("tenantOrders").collect(),
        attempts: await ctx.db.query("tenantOrderAttempts").collect(),
        holds: await ctx.db.query("tenantReservations").collect(),
        stocks: await ctx.db.query("tenantStock").collect(),
      }));
    const before = await rows();
    await expect(
      a.actor.mutation(mode === "cancel" ? cancelOrder : expireOrder, {
        orderId: placed.orderId,
      }),
    ).rejects.toThrow("RESERVATION_LINK_INCOMPLETE");
    expect(await rows()).toEqual(before);
  });

  test.each([
    "cartId",
    "cartRevision",
    "status",
  ] as const)("cancellation refuses a mismatched attempt %s before releasing stock", async (field) => {
    const t = harness();
    const a = await setup(t, `wrong-attempt-${field}@example.test`);
    const placed = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: `wrong-${field}`,
    });
    const otherCart =
      field === "cartId"
        ? await a.actor.mutation(createCart, {
            projectId: a.projectId,
            addressCountry: "TZ",
            lines: a.lines,
          })
        : null;
    await t.run((ctx) =>
      ctx.db.patch(
        placed.attemptId as never,
        field === "cartId"
          ? { cartId: otherCart!.cartId as never }
          : field === "cartRevision"
            ? { cartRevision: 2 }
            : { status: "refused" },
      ),
    );
    const rows = () =>
      t.run(async (ctx) => ({
        orders: await ctx.db.query("tenantOrders").collect(),
        attempts: await ctx.db.query("tenantOrderAttempts").collect(),
        holds: await ctx.db.query("tenantReservations").collect(),
        stocks: await ctx.db.query("tenantStock").collect(),
      }));
    const before = await rows();
    await expect(a.actor.mutation(cancelOrder, { orderId: placed.orderId })).rejects.toThrow(
      "RESERVATION_LINK_INCOMPLETE",
    );
    expect(await rows()).toEqual(before);
  });

  test("expiry refuses an order deadline that disagrees with its held reservation", async () => {
    const t = harness();
    const a = await setup(t, "wrong-deadline@example.test");
    const placed = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "wrong-deadline",
    });
    await t.run((ctx) => ctx.db.patch(placed.orderId as never, { expiresAt: 1 }));
    const rows = () =>
      t.run(async (ctx) => ({
        orders: await ctx.db.query("tenantOrders").collect(),
        attempts: await ctx.db.query("tenantOrderAttempts").collect(),
        holds: await ctx.db.query("tenantReservations").collect(),
        stocks: await ctx.db.query("tenantStock").collect(),
      }));
    const before = await rows();
    await expect(a.actor.mutation(expireOrder, { orderId: placed.orderId })).rejects.toThrow(
      "RESERVATION_LINK_INCOMPLETE",
    );
    expect(await rows()).toEqual(before);
  });

  test("cart expiry and concurrent final-unit attempts fail closed", async () => {
    const t = harness();
    const a = await setup(t, "a@example.test");
    await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "first",
    });
    const carts = await Promise.all(
      ["left", "right"].map(() =>
        a.actor.mutation(createCart, {
          projectId: a.projectId,
          addressCountry: "TZ",
          lines: a.lines,
        }),
      ),
    );
    const contenders = await Promise.allSettled(
      carts.map((cart, index) =>
        a.actor.mutation(placeOrder, {
          cartId: cart.cartId,
          expectedCartRevision: 1,
          retryKey: `contender-${index}`,
        }),
      ),
    );
    expect(contenders.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(contenders.filter((result) => result.status === "rejected")).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch(a.cart.cartId as never, { expiresAt: 1 }));
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "late",
      }),
    ).rejects.toThrow("CART_EXPIRED");
    expect(await t.run((ctx) => ctx.db.query("tenantOrderAttempts").collect())).toHaveLength(2);
  });

  test("new checkout demand expires old holds and restores finite availability once", async () => {
    const t = harness();
    const a = await setup(t, "a@example.test");
    const old = await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "old",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(old.orderId as never, { expiresAt: 1 });
      const held = await ctx.db
        .query("tenantReservations")
        .withIndex("by_tenant_order", (q) =>
          q.eq("tenantId", String(a.userId)).eq("orderId", old.orderId as never),
        )
        .unique();
      if (!held) throw new Error("MISSING_HOLD");
      await ctx.db.patch(held._id, { expiresAt: 1 });
    });
    const cart = await a.actor.mutation(createCart, {
      projectId: a.projectId,
      addressCountry: "TZ",
      lines: [{ ...a.lines[0]!, quantity: 2 }],
    });
    const placed = await a.actor.mutation(placeOrder, {
      cartId: cart.cartId,
      expectedCartRevision: 1,
      retryKey: "after-expiry",
    });
    expect(placed.status).toBe("local_pending");
    expect((await a.actor.query(getOrder, { orderId: old.orderId }))?.status).toBe("expired");
    expect((await t.run((ctx) => ctx.db.query("tenantStock").collect()))[0]).toMatchObject({
      reserved: 2,
      onHand: 2,
    });
    expect(await a.actor.mutation(reconcileExpiredProduct, { productId: a.productId })).toEqual({
      processed: 0,
      hasMore: false,
    });
  });

  test("order creation durably arms exact expiry; timer landing is tenant-bound and idempotent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const t = harness();
      const a = await setup(t, "a@example.test");
      const b = await setup(t, "b@example.test");
      const placed = await a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "timed",
      });
      const order = await a.actor.query(getOrder, { orderId: placed.orderId });
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]).toMatchObject({
        scheduledTime: order?.expiresAt,
        state: { kind: "pending" },
      });
      expect(String(scheduled[0]?.name)).toContain("tenantOrders:expireDue");
      await t.mutation(expireDue, { tenantId: String(b.userId), orderId: placed.orderId });
      expect((await a.actor.query(getOrder, { orderId: placed.orderId }))?.status).toBe("pending");
      vi.setSystemTime(new Date((order?.expiresAt ?? 0) + 1));
      await t.mutation(expireDue, { tenantId: String(a.userId), orderId: placed.orderId });
      await t.mutation(expireDue, { tenantId: String(a.userId), orderId: placed.orderId });
      expect((await a.actor.query(getOrder, { orderId: placed.orderId }))?.status).toBe("expired");
      expect(
        (
          await t.run((ctx) =>
            ctx.db
              .query("tenantStock")
              .withIndex("by_tenant_product", (q) =>
                q.eq("tenantId", String(a.userId)).eq("productId", a.productId as never),
              )
              .unique(),
          )
        )?.reserved,
      ).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("bounded expiry backlog refuses checkout until tenant drains it in pages", async () => {
    const t = harness();
    const a = await setup(t, "a@example.test");
    await t.run(async (ctx) => {
      const stock = await ctx.db
        .query("tenantStock")
        .withIndex("by_tenant_product", (q) =>
          q.eq("tenantId", String(a.userId)).eq("productId", a.productId as never),
        )
        .unique();
      if (!stock) throw new Error("MISSING_STOCK");
      await ctx.db.patch(stock._id, { onHand: 10, reserved: 6 });
      for (let i = 0; i < 6; i++)
        await ctx.db.insert("tenantReservations", {
          tenantId: String(a.userId),
          productId: a.productId as never,
          quantity: 1,
          status: "held",
          expiresAt: 1,
          createdAt: 1,
          updatedAt: 1,
        });
    });
    await expect(
      a.actor.mutation(placeOrder, {
        cartId: a.cart.cartId,
        expectedCartRevision: 1,
        retryKey: "backlog",
      }),
    ).rejects.toThrow("EXPIRY_BACKLOG");
    expect(await a.actor.mutation(reconcileExpiredProduct, { productId: a.productId })).toEqual({
      processed: 5,
      hasMore: true,
    });
    expect(await a.actor.mutation(reconcileExpiredProduct, { productId: a.productId })).toEqual({
      processed: 1,
      hasMore: false,
    });
    expect(
      (
        await a.actor.mutation(placeOrder, {
          cartId: a.cart.cartId,
          expectedCartRevision: 1,
          retryKey: "backlog",
        })
      ).status,
    ).toBe("local_pending");
    expect((await t.run((ctx) => ctx.db.query("tenantStock").collect()))[0]).toMatchObject({
      onHand: 10,
      reserved: 1,
    });
  });

  test("order content exports to its tenant and erasure refuses before any rows are deleted", async () => {
    const t = harness();
    const a = await setup(t, "a@example.test");
    const b = await setup(t, "b@example.test");
    await a.actor.mutation(placeOrder, {
      cartId: a.cart.cartId,
      expectedCartRevision: 1,
      retryKey: "retain",
    });
    const tableIndex = exportableTables().indexOf("tenantOrders");
    const cursor = {
      tableIndex,
      cursor: null,
      rowsExported: 0,
      tableRows: 0,
      truncated: false,
      generatedAt: "2026-09-24T00:00:00.000Z",
    };
    expect((await a.actor.query(exportTenantData, { cursor })).table.rows).toHaveLength(1);
    expect((await b.actor.query(exportTenantData, { cursor })).table.rows).toHaveLength(0);
    await expect(
      t.mutation(authorizeTenantDeletion, { tenantId: String(a.userId), userId: a.userId }),
    ).rejects.toThrow("COMMERCE_RETENTION_POLICY_REQUIRED");
    expect(await t.run((ctx) => ctx.db.query("tenantOrders").collect())).toHaveLength(1);
  });
});
