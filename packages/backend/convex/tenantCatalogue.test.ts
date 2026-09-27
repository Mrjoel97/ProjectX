import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const createProduct = makeFunctionReference<
  "mutation",
  {
    sku: string;
    variant: string;
    currency: string;
    priceMinor: number;
    status: "draft" | "active" | "retired";
    goodsKind: "physical" | "digital";
    stock:
      | { kind: "finite"; onHand: number; reservationTtlMs?: number }
      | { kind: "untracked"; approved: boolean };
  },
  { productId: string; revision: number; stockRevision: number }
>("tenantCatalogue:createProduct");
const editProduct = makeFunctionReference<
  "mutation",
  {
    productId: string;
    expectedRevision: number;
    priceMinor?: number;
    status?: "draft" | "active" | "retired";
    goodsKind?: "physical" | "digital";
  },
  { revision: number }
>("tenantCatalogue:editProduct");
const adjustStock = makeFunctionReference<
  "mutation",
  { productId: string; expectedRevision: number; delta: number },
  { stockRevision: number; onHand: number; reserved: number }
>("tenantCatalogue:adjustStock");
const configureStockPolicy = makeFunctionReference<
  "mutation",
  {
    productId: string;
    expectedStockRevision: number;
    policy: { kind: "finite"; reservationTtlMs: number } | { kind: "untracked"; approved: boolean };
  },
  { stockRevision: number }
>("tenantCatalogue:configureStockPolicy");
const reserveProduct = makeFunctionReference<
  "mutation",
  { productId: string; expectedStockRevision: number; quantity: number },
  { reservationId: string; stockRevision: number }
>("tenantCatalogue:reserveProduct");
const releaseReservation = makeFunctionReference<
  "mutation",
  { productId: string; reservationId: string; expectedStockRevision: number },
  { stockRevision: number }
>("tenantCatalogue:releaseReservation");
const listProducts = makeFunctionReference<
  "query",
  { cursor?: string | null; limit?: number },
  {
    products: readonly {
      _id: string;
      sku: string;
      priceMinor: number;
      available: number | "untracked";
      reservationTtlMs: number | null;
    }[];
    nextCursor: string | null;
  }
>("tenantCatalogue:listProducts");

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

describe("tenant catalogue adapter", () => {
  test("create/edit/pause, CAS stock and exact finite availability", async () => {
    const t = harness();
    const a = await t.run((ctx) => ctx.db.insert("users", { email: "merchant-a@example.test" }));
    const actor = t.withIdentity({ subject: `${a}|session` });
    const created = await actor.mutation(createProduct, {
      sku: "desk-lamp",
      variant: "bronze",
      currency: "USD",
      priceMinor: 1250,
      status: "active",
      goodsKind: "physical",
      stock: { kind: "finite", onHand: 2, reservationTtlMs: 900_000 },
    });
    const stock = await actor.mutation(adjustStock, {
      productId: created.productId,
      expectedRevision: 1,
      delta: -1,
    });
    expect(stock).toMatchObject({ stockRevision: 2, onHand: 1, reserved: 0 });
    await expect(
      actor.mutation(adjustStock, { productId: created.productId, expectedRevision: 1, delta: -1 }),
    ).rejects.toThrow("STALE_REVISION");
    const held = await actor.mutation(reserveProduct, {
      productId: created.productId,
      expectedStockRevision: 2,
      quantity: 1,
    });
    await expect(
      actor.mutation(reserveProduct, {
        productId: created.productId,
        expectedStockRevision: 3,
        quantity: 1,
      }),
    ).rejects.toThrow("OUT_OF_STOCK");
    await expect(
      actor.mutation(releaseReservation, {
        productId: created.productId,
        reservationId: held.reservationId,
        expectedStockRevision: 2,
      }),
    ).rejects.toThrow("STALE_REVISION");
    await actor.mutation(releaseReservation, {
      productId: created.productId,
      reservationId: held.reservationId,
      expectedStockRevision: 3,
    });
    await expect(
      actor.mutation(releaseReservation, {
        productId: created.productId,
        reservationId: held.reservationId,
        expectedStockRevision: 4,
      }),
    ).rejects.toThrow("RESERVATION_NOT_HELD");
    const paused = await actor.mutation(editProduct, {
      productId: created.productId,
      expectedRevision: 1,
      status: "retired",
    });
    expect(paused.revision).toBe(2);
    expect((await actor.query(listProducts, {})).products).toMatchObject([
      { sku: "desk-lamp", available: 1 },
    ]);
  });

  test("swapped product and reservation ids fail before writes or audit", async () => {
    const t = harness();
    const [a, b] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.insert("users", { email: "merchant-a@example.test" }),
        ctx.db.insert("users", { email: "merchant-b@example.test" }),
      ]),
    );
    const alice = t.withIdentity({ subject: `${a}|session` });
    const bob = t.withIdentity({ subject: `${b}|session` });
    const args = {
      sku: "lamp",
      variant: "one",
      currency: "USD",
      priceMinor: 100,
      status: "active" as const,
      goodsKind: "physical" as const,
      stock: { kind: "finite" as const, onHand: 1, reservationTtlMs: 900_000 },
    };
    const own = await alice.mutation(createProduct, args);
    const foreign = await bob.mutation(createProduct, args);
    const held = await alice.mutation(reserveProduct, {
      productId: own.productId,
      expectedStockRevision: 1,
      quantity: 1,
    });
    await expect(
      alice.mutation(editProduct, {
        productId: foreign.productId,
        expectedRevision: 1,
        priceMinor: 500,
      }),
    ).rejects.toThrow("PRODUCT_UNAVAILABLE");
    await expect(
      alice.mutation(releaseReservation, {
        productId: foreign.productId,
        reservationId: held.reservationId,
        expectedStockRevision: 1,
      }),
    ).rejects.toThrow("PRODUCT_UNAVAILABLE");
    await expect(
      bob.mutation(releaseReservation, {
        productId: foreign.productId,
        reservationId: held.reservationId,
        expectedStockRevision: 1,
      }),
    ).rejects.toThrow("RESERVATION_UNAVAILABLE");
    const receipts = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(
      receipts.every((row) =>
        Object.keys(row.payload).every((key) =>
          /^(productId|reservationId|revision|stockRevision|delta|quantity|status)$/.test(key),
        ),
      ),
    ).toBe(true);
    expect(receipts).toHaveLength(3);
  });

  test("sellable state refuses absent TTL or unapproved untracked posture and duplicate SKU", async () => {
    const t = harness();
    const a = await t.run((ctx) => ctx.db.insert("users", { email: "merchant-a@example.test" }));
    const actor = t.withIdentity({ subject: `${a}|session` });
    const base = {
      sku: "lamp",
      variant: "one",
      currency: "USD",
      priceMinor: 100,
      status: "active" as const,
      goodsKind: "physical" as const,
    };
    await expect(
      actor.mutation(createProduct, {
        ...base,
        goodsKind: undefined,
        stock: { kind: "untracked", approved: true },
      } as never),
    ).rejects.toThrow("GOODS_KIND_REQUIRED");
    await expect(
      actor.mutation(createProduct, { ...base, stock: { kind: "finite", onHand: 1 } }),
    ).rejects.toThrow("INVENTORY_POLICY_REQUIRED");
    await expect(
      actor.mutation(createProduct, { ...base, stock: { kind: "untracked", approved: false } }),
    ).rejects.toThrow("INVENTORY_POLICY_REQUIRED");
    await actor.mutation(createProduct, { ...base, stock: { kind: "untracked", approved: true } });
    await expect(
      actor.mutation(createProduct, { ...base, stock: { kind: "untracked", approved: true } }),
    ).rejects.toThrow("DUPLICATE_SKU");
  });

  test("merchant finite hold policy accepts one to sixty whole minutes, never a legacy day", async () => {
    const t = harness();
    const a = await t.run((ctx) => ctx.db.insert("users", { email: "merchant-hold@example.test" }));
    const actor = t.withIdentity({ subject: `${a}|session` });
    const base = {
      variant: "one",
      currency: "USD",
      priceMinor: 100,
      status: "active" as const,
      goodsKind: "physical" as const,
    };
    await actor.mutation(createProduct, {
      ...base,
      sku: "one-minute",
      stock: { kind: "finite", onHand: 1, reservationTtlMs: 60_000 },
    });
    await actor.mutation(createProduct, {
      ...base,
      sku: "sixty-minutes",
      stock: { kind: "finite", onHand: 1, reservationTtlMs: 60 * 60_000 },
    });
    for (const [sku, ttl] of [
      ["partial-minute", 90_000],
      ["sixty-one", 61 * 60_000],
      ["legacy-day", 24 * 60 * 60_000],
    ] as const) {
      await expect(
        actor.mutation(createProduct, {
          ...base,
          sku,
          stock: { kind: "finite", onHand: 1, reservationTtlMs: ttl },
        }),
      ).rejects.toThrow("INVENTORY_POLICY_REQUIRED");
    }
  });

  test("legacy unclassified rows require an exact merchant revision before classification", async () => {
    const t = harness();
    const a = await t.run((ctx) => ctx.db.insert("users", { email: "legacy@example.test" }));
    const actor = t.withIdentity({ subject: `${a}|session` });
    const created = await actor.mutation(createProduct, {
      sku: "ebook",
      variant: "one",
      currency: "USD",
      priceMinor: 100,
      status: "draft",
      goodsKind: "digital",
      stock: { kind: "untracked", approved: true },
    });
    await t.run((ctx) => ctx.db.patch(created.productId as never, { goodsKind: undefined }));
    expect((await actor.query(listProducts, {})).products).toMatchObject([{ goodsKind: null }]);
    await expect(
      actor.mutation(editProduct, {
        productId: created.productId,
        expectedRevision: 0,
        goodsKind: "digital",
      }),
    ).rejects.toThrow("STALE_REVISION");
    expect(
      await actor.mutation(editProduct, {
        productId: created.productId,
        expectedRevision: 1,
        goodsKind: "digital",
      }),
    ).toMatchObject({ revision: 2 });
    expect((await actor.query(listProducts, {})).products).toMatchObject([
      { goodsKind: "digital", revision: 2 },
    ]);
  });

  test("a draft can add a missing finite TTL before activation, never change stock kind silently", async () => {
    const t = harness();
    const a = await t.run((ctx) => ctx.db.insert("users", { email: "merchant-a@example.test" }));
    const actor = t.withIdentity({ subject: `${a}|session` });
    const draft = await actor.mutation(createProduct, {
      sku: "draft-lamp",
      variant: "one",
      currency: "USD",
      priceMinor: 100,
      status: "draft",
      goodsKind: "physical",
      stock: { kind: "finite", onHand: 1 },
    });
    await expect(
      actor.mutation(editProduct, {
        productId: draft.productId,
        expectedRevision: 1,
        status: "active",
      }),
    ).rejects.toThrow("INVENTORY_POLICY_REQUIRED");
    expect(
      await actor.mutation(configureStockPolicy, {
        productId: draft.productId,
        expectedStockRevision: 1,
        policy: { kind: "finite", reservationTtlMs: 900_000 },
      }),
    ).toMatchObject({ stockRevision: 2 });
    await expect(
      actor.mutation(configureStockPolicy, {
        productId: draft.productId,
        expectedStockRevision: 1,
        policy: { kind: "finite", reservationTtlMs: 900_000 },
      }),
    ).rejects.toThrow("STALE_REVISION");
    await expect(
      actor.mutation(configureStockPolicy, {
        productId: draft.productId,
        expectedStockRevision: 2,
        policy: { kind: "untracked", approved: true },
      }),
    ).rejects.toThrow("STOCK_KIND_CHANGE_REQUIRES_REVIEW");
    expect(
      await actor.mutation(editProduct, {
        productId: draft.productId,
        expectedRevision: 1,
        status: "active",
      }),
    ).toMatchObject({ revision: 2 });
    expect((await actor.query(listProducts, {})).products).toMatchObject([
      { reservationTtlMs: 900_000 },
    ]);
    expect(
      await actor.mutation(configureStockPolicy, {
        productId: draft.productId,
        expectedStockRevision: 2,
        policy: { kind: "finite", reservationTtlMs: 1_200_000 },
      }),
    ).toMatchObject({ stockRevision: 3 });
    await expect(
      actor.mutation(configureStockPolicy, {
        productId: draft.productId,
        expectedStockRevision: 2,
        policy: { kind: "finite", reservationTtlMs: 1_800_000 },
      }),
    ).rejects.toThrow("STALE_REVISION");
    expect((await actor.query(listProducts, {})).products).toMatchObject([
      { reservationTtlMs: 1_200_000, stockRevision: 3 },
    ]);
  });

  test("the operator catalogue paginates instead of silently hiding products", async () => {
    const t = harness();
    const a = await t.run((ctx) => ctx.db.insert("users", { email: "merchant-a@example.test" }));
    const actor = t.withIdentity({ subject: `${a}|session` });
    for (const sku of ["lamp-a", "lamp-b"]) {
      await actor.mutation(createProduct, {
        sku,
        variant: "one",
        currency: "USD",
        priceMinor: 100,
        status: "draft",
        goodsKind: "physical",
        stock: { kind: "finite", onHand: 1 },
      });
    }
    const first = await actor.query(listProducts, { limit: 1 });
    expect(first.products).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await actor.query(listProducts, { limit: 1, cursor: first.nextCursor });
    expect(second.products).toHaveLength(1);
    expect(second.products[0]?._id).not.toBe(first.products[0]?._id);
    await expect(actor.query(listProducts, { limit: 0 })).rejects.toThrow("INVALID_PAGE_SIZE");
  });
});
