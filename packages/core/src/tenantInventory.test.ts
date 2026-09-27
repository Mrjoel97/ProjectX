import { describe, expect, test } from "vitest";
import {
  adjustFiniteStock,
  type CatalogueItem,
  configureInventoryPolicy,
  consumeInventory,
  createCatalogueItem,
  editCatalogueItem,
  expireInventory,
  type InventoryState,
  releaseInventory,
  reserveInventory,
  type StockReservation,
} from "./tenantInventory";

const itemInput = {
  tenantId: "tenant-a",
  sku: "desk-lamp",
  variant: "bronze",
  currency: "USD",
  priceMinor: 1250,
  status: "draft" as const,
  goodsKind: "physical" as const,
};
const finite: InventoryState = {
  kind: "finite",
  tenantId: "tenant-a",
  productId: "product-a",
  onHand: 2,
  reserved: 0,
  revision: 1,
  reservationTtlMs: 15 * 60_000,
};
const active: CatalogueItem = {
  ...itemInput,
  status: "active",
  id: "product-a",
  revision: 1,
};

describe("tenant inventory pure rules", () => {
  test("first-release finite holds are whole minutes from one to sixty; untracked stays separate", () => {
    for (const ttl of [60_000, 60 * 60_000]) {
      const selected = { ...finite, reservationTtlMs: ttl };
      expect(
        createCatalogueItem({ ...itemInput, status: "active" }, selected, "product-a").status,
      ).toBe("active");
      expect(
        reserveInventory(active, "tenant-a", selected, `hold-${ttl}`, 1, 1_000, 1).reservation
          .expiresAt,
      ).toBe(1_000 + ttl);
    }
    for (const ttl of [0, 90_000, 61 * 60_000, 24 * 60 * 60_000]) {
      const selected = { ...finite, reservationTtlMs: ttl };
      expect(() =>
        createCatalogueItem({ ...itemInput, status: "active" }, selected, "product-a"),
      ).toThrow("INVENTORY_POLICY_REQUIRED");
      expect(() =>
        reserveInventory(active, "tenant-a", selected, "invalid-hold", 1, 1_000, 1),
      ).toThrow("INVENTORY_POLICY_REQUIRED");
    }
    const untracked: InventoryState = {
      kind: "untracked",
      tenantId: "tenant-a",
      productId: "product-a",
      approved: true,
      revision: 1,
    };
    expect(
      reserveInventory(active, "tenant-a", untracked, "untracked-hold", 1, 1_000, 1).reservation
        .expiresAt,
    ).toBe(1_000 + 24 * 60 * 60_000);
  });

  test("create/edit/pause require bounded price, ISO currency, tenant and CAS revision", () => {
    expect(createCatalogueItem(itemInput, finite, "product-a")).toMatchObject({
      status: "draft",
      revision: 1,
    });
    expect(editCatalogueItem(active, "tenant-a", 1, { status: "retired" })).toMatchObject({
      status: "retired",
      revision: 2,
    });
    expect(() => editCatalogueItem(active, "tenant-b", 1, { status: "retired" })).toThrow(
      "FOREIGN_PRODUCT",
    );
    expect(() => editCatalogueItem(active, "tenant-a", 0, { priceMinor: 1500 })).toThrow(
      "STALE_REVISION",
    );
    expect(() =>
      createCatalogueItem({ ...itemInput, priceMinor: Number.MAX_SAFE_INTEGER + 1 }, finite, "p"),
    ).toThrow("INVALID_PRICE");
    expect(() => createCatalogueItem({ ...itemInput, currency: "usd" }, finite, "p")).toThrow(
      "INVALID_CURRENCY",
    );
    expect(() => createCatalogueItem({ ...itemInput, goodsKind: undefined }, finite, "p")).toThrow(
      "GOODS_KIND_REQUIRED",
    );
    expect(
      editCatalogueItem(
        { ...active, goodsKind: undefined },
        "tenant-a",
        1,
        { goodsKind: "digital" },
        finite,
      ),
    ).toMatchObject({ goodsKind: "digital", revision: 2 });
    expect(() =>
      editCatalogueItem(
        { ...active, goodsKind: undefined },
        "tenant-a",
        1,
        { status: "active" },
        finite,
      ),
    ).toThrow("GOODS_KIND_REQUIRED");
    expect(() =>
      createCatalogueItem(
        { ...itemInput, status: "active" },
        { ...finite, productId: "p", reservationTtlMs: undefined },
        "p",
      ),
    ).toThrow("INVENTORY_POLICY_REQUIRED");
    expect(() =>
      createCatalogueItem(
        { ...itemInput, status: "active" },
        { kind: "untracked", tenantId: "tenant-a", productId: "p", approved: false, revision: 1 },
        "p",
      ),
    ).toThrow("INVENTORY_POLICY_REQUIRED");
    expect(
      createCatalogueItem(
        { ...itemInput, status: "active" },
        { kind: "untracked", tenantId: "tenant-a", productId: "p", approved: true, revision: 1 },
        "p",
      ).status,
    ).toBe("active");
  });

  test("finite stock cannot oversell, rewind silently, or accept a stale concurrent decrement", () => {
    const first = reserveInventory(active, "tenant-a", finite, "r1", 2, 1_000, 1);
    expect(first.stock).toMatchObject({ onHand: 2, reserved: 2, revision: 2 });
    expect(() => reserveInventory(active, "tenant-a", finite, "r2", 1, 1_001, 0)).toThrow(
      "STALE_REVISION",
    );
    expect(() => reserveInventory(active, "tenant-a", first.stock, "r2", 1, 1_001, 2)).toThrow(
      "OUT_OF_STOCK",
    );
    expect(() => adjustFiniteStock(first.stock, 2, -1)).toThrow("STOCK_BELOW_RESERVED");
    const consumed = consumeInventory(first.stock, first.reservation, 2_000, 2);
    expect(consumed.stock).toMatchObject({ onHand: 0, reserved: 0 });
    expect(() => reserveInventory(active, "tenant-a", consumed.stock, "r3", 1, 2_001, 3)).toThrow(
      "OUT_OF_STOCK",
    );
  });

  test("release/expiry happen once and late paid cannot silently consume returned stock", () => {
    const held = reserveInventory(active, "tenant-a", finite, "r1", 1, 1_000, 1);
    const released = releaseInventory(held.stock, held.reservation, 2);
    expect(released.stock).toMatchObject({ reserved: 0 });
    expect(() => releaseInventory(released.stock, released.reservation, 3)).toThrow(
      "RESERVATION_NOT_HELD",
    );
    const expired = expireInventory(held.stock, held.reservation, 901_000, 2);
    expect(expired.reservation.status).toBe("expired");
    expect(expired.stock).toMatchObject({ reserved: 0 });
    expect(() => expireInventory(expired.stock, expired.reservation, 901_001, 3)).toThrow(
      "RESERVATION_NOT_HELD",
    );
    expect(consumeInventory(expired.stock, expired.reservation, 901_001, 3)).toMatchObject({
      kind: "late_paid_exception",
    });
    expect(consumeInventory(held.stock, held.reservation, 901_000, 2)).toMatchObject({
      kind: "late_paid_exception",
    });
    expect(consumeInventory(released.stock, released.reservation, 2_000, 3)).toEqual({
      kind: "released_paid_exception",
      stock: released.stock,
      reservation: released.reservation,
    });
    expect(() => consumeInventory(released.stock, released.reservation, 2_000, 2)).toThrow(
      "STALE_REVISION",
    );
    expect(() =>
      consumeInventory(released.stock, { ...released.reservation, tenantId: "tenant-b" }, 2_000, 3),
    ).toThrow("FOREIGN_PRODUCT");
    expect(() =>
      consumeInventory(released.stock, { ...released.reservation, quantity: 0 }, 2_000, 3),
    ).toThrow("INVALID_QUANTITY");
    expect(() =>
      consumeInventory(released.stock, { ...released.reservation, expiresAt: -1 }, 2_000, 3),
    ).toThrow("INVALID_TIME");
  });

  test("reservation ids, quantities, product refs and stock shape are bounded", () => {
    expect(() => reserveInventory(active, "tenant-a", finite, "", 1, 0, 1)).toThrow(
      "INVALID_RESERVATION",
    );
    expect(() =>
      reserveInventory({ ...active, id: "other" }, "tenant-a", finite, "r", 1, 0, 1),
    ).toThrow("FOREIGN_PRODUCT");
    expect(() => reserveInventory(active, "tenant-b", finite, "r", 1, 0, 1)).toThrow(
      "FOREIGN_PRODUCT",
    );
    expect(() => reserveInventory(active, "tenant-a", finite, "r", 101, 0, 1)).toThrow(
      "INVALID_QUANTITY",
    );
    expect(() =>
      reserveInventory(active, "tenant-a", { ...finite, onHand: -1 }, "r", 1, 0, 1),
    ).toThrow("INVALID_STOCK");
    const held = reserveInventory(active, "tenant-a", finite, "r", 1, 0, 1);
    expect(() => consumeInventory({ ...held.stock, revision: 99 }, held.reservation, 1, 2)).toThrow(
      "STALE_REVISION",
    );
  });

  test("a draft can configure its stock policy before activation, with CAS and no silent kind switch", () => {
    const draft = createCatalogueItem(
      itemInput,
      { ...finite, reservationTtlMs: undefined },
      "product-a",
    );
    expect(() =>
      editCatalogueItem(
        draft,
        "tenant-a",
        1,
        { status: "active" },
        { ...finite, reservationTtlMs: undefined },
      ),
    ).toThrow("INVENTORY_POLICY_REQUIRED");
    const configured = configureInventoryPolicy(
      draft,
      "tenant-a",
      { ...finite, reservationTtlMs: undefined },
      1,
      { kind: "finite", reservationTtlMs: 900_000 },
    );
    expect(editCatalogueItem(draft, "tenant-a", 1, { status: "active" }, configured).status).toBe(
      "active",
    );
    expect(() =>
      configureInventoryPolicy(draft, "tenant-a", configured, 1, {
        kind: "finite",
        reservationTtlMs: 900_000,
      }),
    ).toThrow("STALE_REVISION");
    expect(() =>
      configureInventoryPolicy(draft, "tenant-a", configured, 2, {
        kind: "untracked",
        approved: true,
      }),
    ).toThrow("STOCK_KIND_CHANGE_REQUIRES_REVIEW");
  });

  test("every stock-writing transition refuses a revision that cannot be incremented safely", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const atLimit: InventoryState = { ...finite, revision: max };
    const heldStock: InventoryState = { ...finite, reserved: 1, revision: max };
    const held: StockReservation = {
      id: "held-max",
      tenantId: "tenant-a",
      productId: "product-a",
      quantity: 1,
      status: "held",
      expiresAt: 100_000,
    };
    expect(() => adjustFiniteStock(atLimit, max, 1)).toThrow("INVALID_REVISION");
    expect(() =>
      configureInventoryPolicy(active, "tenant-a", atLimit, max, {
        kind: "finite",
        reservationTtlMs: 900_000,
      }),
    ).toThrow("INVALID_REVISION");
    expect(() => reserveInventory(active, "tenant-a", atLimit, "new-max", 1, 0, max)).toThrow(
      "INVALID_REVISION",
    );
    expect(() => releaseInventory(heldStock, held, max)).toThrow("INVALID_REVISION");
    expect(() => expireInventory(heldStock, held, 100_000, max)).toThrow("INVALID_REVISION");
    expect(() => consumeInventory(heldStock, held, 99_999, max)).toThrow("INVALID_REVISION");
    expect(() =>
      reserveInventory(
        active,
        "tenant-a",
        {
          kind: "untracked",
          tenantId: "tenant-a",
          productId: "product-a",
          approved: true,
          revision: max,
        },
        "new-max",
        1,
        0,
        max,
      ),
    ).toThrow("INVALID_REVISION");
    expect(consumeInventory(heldStock, held, 100_000, max)).toMatchObject({
      kind: "late_paid_exception",
      stock: heldStock,
    });
  });
});
