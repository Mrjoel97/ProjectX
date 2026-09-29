/** Pure, provider-independent catalogue and finite-stock transitions. */
export type CatalogueStatus = "draft" | "active" | "retired";
export type GoodsKind = "physical" | "digital";
export type CatalogueItem = {
  readonly id: string;
  readonly tenantId: string;
  readonly sku: string;
  readonly variant: string;
  readonly currency: string;
  readonly priceMinor: number;
  readonly status: CatalogueStatus;
  readonly goodsKind?: GoodsKind;
  readonly revision: number;
};
export type InventoryState =
  | {
      readonly kind: "finite";
      readonly tenantId: string;
      readonly productId: string;
      readonly onHand: number;
      readonly reserved: number;
      readonly revision: number;
      readonly reservationTtlMs?: number;
    }
  | {
      readonly kind: "untracked";
      readonly tenantId: string;
      readonly productId: string;
      readonly approved: boolean;
      readonly revision: number;
    };
export type StockReservation = {
  readonly id: string;
  readonly tenantId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly status: "held" | "released" | "expired" | "consumed";
  readonly expiresAt: number;
};

const MAX_STOCK = 1_000_000;
const MAX_QUANTITY = 100;
export const MIN_FINITE_HOLD_MS = 60_000;
export const MAX_FINITE_HOLD_MS = 60 * 60_000;
const UNTRACKED_RESERVATION_TTL_MS = 24 * 60 * 60_000;
const boundedRef = (value: string): boolean =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
const boundedStock = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= MAX_STOCK;
const validRevision = (value: number): boolean => Number.isSafeInteger(value) && value >= 1;
const nextRevision = (revision: number): number => {
  if (!validRevision(revision) || revision >= Number.MAX_SAFE_INTEGER)
    throw new Error("INVALID_REVISION");
  return revision + 1;
};

export function validateInventory(
  stock: InventoryState,
  tenantId: string,
  productId: string,
): void {
  if (stock.tenantId !== tenantId || stock.productId !== productId)
    throw new Error("FOREIGN_PRODUCT");
  if (!validRevision(stock.revision)) throw new Error("INVALID_STOCK");
  if (stock.kind === "finite") {
    if (
      !boundedStock(stock.onHand) ||
      !boundedStock(stock.reserved) ||
      stock.reserved > stock.onHand
    ) {
      throw new Error("INVALID_STOCK");
    }
  } else if (stock.kind !== "untracked" || typeof stock.approved !== "boolean") {
    throw new Error("INVALID_STOCK");
  }
}

function validPolicy(stock: InventoryState): boolean {
  return stock.kind === "untracked"
    ? stock.approved === true
    : Number.isSafeInteger(stock.reservationTtlMs) &&
        (stock.reservationTtlMs ?? 0) >= MIN_FINITE_HOLD_MS &&
        (stock.reservationTtlMs ?? 0) <= MAX_FINITE_HOLD_MS &&
        (stock.reservationTtlMs ?? 0) % MIN_FINITE_HOLD_MS === 0;
}

function validateCatalogue(input: Omit<CatalogueItem, "revision">, stock: InventoryState): void {
  if (
    !boundedRef(input.id) ||
    !boundedRef(input.tenantId) ||
    !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(input.sku) ||
    input.sku.length > 64 ||
    !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(input.variant) ||
    input.variant.length > 64
  )
    throw new Error("INVALID_SKU");
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor <= 0)
    throw new Error("INVALID_PRICE");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("INVALID_CURRENCY");
  if (!["draft", "active", "retired"].includes(input.status)) throw new Error("INVALID_STATUS");
  if (input.goodsKind !== "physical" && input.goodsKind !== "digital")
    throw new Error("GOODS_KIND_REQUIRED");
  validateInventory(stock, input.tenantId, input.id);
  if (input.status === "active" && !validPolicy(stock))
    throw new Error("INVENTORY_POLICY_REQUIRED");
}

export function createCatalogueItem(
  input: Omit<CatalogueItem, "id" | "revision">,
  stock: InventoryState,
  id: string,
): CatalogueItem {
  const product = { ...input, id };
  validateCatalogue(product, stock);
  return { ...product, revision: 1 };
}

export function editCatalogueItem(
  item: CatalogueItem,
  tenantId: string,
  expectedRevision: number,
  patch: Partial<Pick<CatalogueItem, "priceMinor" | "status" | "goodsKind">>,
  stock?: InventoryState,
): CatalogueItem {
  if (item.tenantId !== tenantId) throw new Error("FOREIGN_PRODUCT");
  if (item.revision !== expectedRevision) throw new Error("STALE_REVISION");
  const next = { ...item, ...patch, revision: nextRevision(item.revision) };
  if (!Number.isSafeInteger(next.priceMinor) || next.priceMinor <= 0)
    throw new Error("INVALID_PRICE");
  if (!["draft", "active", "retired"].includes(next.status)) throw new Error("INVALID_STATUS");
  if (next.goodsKind !== "physical" && next.goodsKind !== "digital")
    throw new Error("GOODS_KIND_REQUIRED");
  if (
    next.status === "active" &&
    (!stock || (validateInventory(stock, tenantId, item.id), !validPolicy(stock)))
  ) {
    throw new Error("INVENTORY_POLICY_REQUIRED");
  }
  return next;
}

export function adjustFiniteStock(
  stock: InventoryState,
  expectedRevision: number,
  delta: number,
): InventoryState {
  if (stock.kind !== "finite") throw new Error("FINITE_STOCK_REQUIRED");
  validateInventory(stock, stock.tenantId, stock.productId);
  if (stock.revision !== expectedRevision) throw new Error("STALE_REVISION");
  if (!Number.isSafeInteger(delta) || delta === 0) throw new Error("INVALID_STOCK_DELTA");
  const onHand = stock.onHand + delta;
  if (!boundedStock(onHand)) throw new Error("INVALID_STOCK");
  if (onHand < stock.reserved) throw new Error("STOCK_BELOW_RESERVED");
  return { ...stock, onHand, revision: nextRevision(stock.revision) };
}

/** A draft with no policy can become sellable only after an explicit CAS policy edit. */
export function configureInventoryPolicy(
  product: CatalogueItem,
  tenantId: string,
  stock: InventoryState,
  expectedRevision: number,
  policy: { kind: "finite"; reservationTtlMs: number } | { kind: "untracked"; approved: boolean },
): InventoryState {
  if (product.tenantId !== tenantId) throw new Error("FOREIGN_PRODUCT");
  validateInventory(stock, tenantId, product.id);
  if (stock.revision !== expectedRevision) throw new Error("STALE_REVISION");
  if (stock.kind !== policy.kind) throw new Error("STOCK_KIND_CHANGE_REQUIRES_REVIEW");
  const revision = nextRevision(stock.revision);
  const next: InventoryState =
    stock.kind === "finite" && policy.kind === "finite"
      ? { ...stock, reservationTtlMs: policy.reservationTtlMs, revision }
      : stock.kind === "untracked" && policy.kind === "untracked"
        ? { ...stock, approved: policy.approved, revision }
        : stock;
  if (next.kind === "finite" && !validPolicy(next)) throw new Error("INVENTORY_POLICY_REQUIRED");
  if (product.status === "active" && !validPolicy(next))
    throw new Error("INVENTORY_POLICY_REQUIRED");
  return next;
}

function requireHeld(
  stock: InventoryState,
  reservation: StockReservation,
  expectedRevision: number,
): void {
  validateInventory(stock, reservation.tenantId, reservation.productId);
  if (stock.revision !== expectedRevision) throw new Error("STALE_REVISION");
  if (reservation.status !== "held") throw new Error("RESERVATION_NOT_HELD");
  if (
    !Number.isSafeInteger(reservation.quantity) ||
    reservation.quantity < 1 ||
    reservation.quantity > MAX_QUANTITY
  )
    throw new Error("INVALID_QUANTITY");
  if (stock.kind === "finite" && stock.reserved < reservation.quantity)
    throw new Error("INVALID_STOCK");
}

export function reserveInventory(
  product: CatalogueItem,
  tenantId: string,
  stock: InventoryState,
  reservationId: string,
  quantity: number,
  now: number,
  expectedRevision: number,
): { stock: InventoryState; reservation: StockReservation } {
  if (product.tenantId !== tenantId) throw new Error("FOREIGN_PRODUCT");
  validateInventory(stock, tenantId, product.id);
  if (stock.revision !== expectedRevision) throw new Error("STALE_REVISION");
  if (product.status !== "active") throw new Error("PRODUCT_NOT_ACTIVE");
  if (!boundedRef(reservationId)) throw new Error("INVALID_RESERVATION");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY)
    throw new Error("INVALID_QUANTITY");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("INVALID_TIME");
  if (!validPolicy(stock)) throw new Error("INVENTORY_POLICY_REQUIRED");
  // Untracked is an explicit tenant approval, not the fallback when finite stock is missing.
  const ttl = stock.kind === "finite" ? stock.reservationTtlMs! : UNTRACKED_RESERVATION_TTL_MS;
  if (!Number.isSafeInteger(now + ttl)) throw new Error("INVALID_TIME");
  if (stock.kind === "finite" && stock.onHand - stock.reserved < quantity)
    throw new Error("OUT_OF_STOCK");
  const revision = nextRevision(stock.revision);
  const next: InventoryState =
    stock.kind === "finite"
      ? { ...stock, reserved: stock.reserved + quantity, revision }
      : { ...stock, revision };
  return {
    stock: next,
    reservation: {
      id: reservationId,
      tenantId,
      productId: product.id,
      quantity,
      status: "held",
      expiresAt: now + ttl,
    },
  };
}

export function releaseInventory(
  stock: InventoryState,
  reservation: StockReservation,
  expectedRevision: number,
) {
  requireHeld(stock, reservation, expectedRevision);
  const revision = nextRevision(stock.revision);
  return {
    stock:
      stock.kind === "finite"
        ? { ...stock, reserved: stock.reserved - reservation.quantity, revision }
        : { ...stock, revision },
    reservation: { ...reservation, status: "released" as const },
  };
}

export function expireInventory(
  stock: InventoryState,
  reservation: StockReservation,
  now: number,
  expectedRevision: number,
) {
  requireHeld(stock, reservation, expectedRevision);
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(reservation.expiresAt) ||
    reservation.expiresAt < 0
  )
    throw new Error("INVALID_TIME");
  if (now < reservation.expiresAt) throw new Error("RESERVATION_NOT_EXPIRED");
  const released = releaseInventory(stock, reservation, expectedRevision);
  return { ...released, reservation: { ...reservation, status: "expired" as const } };
}

export function consumeInventory(
  stock: InventoryState,
  reservation: StockReservation,
  now: number,
  expectedRevision: number,
) {
  validateInventory(stock, reservation.tenantId, reservation.productId);
  if (stock.revision !== expectedRevision) throw new Error("STALE_REVISION");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("INVALID_TIME");
  if (
    !Number.isSafeInteger(reservation.quantity) ||
    reservation.quantity < 1 ||
    reservation.quantity > MAX_QUANTITY
  )
    throw new Error("INVALID_QUANTITY");
  if (!Number.isSafeInteger(reservation.expiresAt) || reservation.expiresAt < 0)
    throw new Error("INVALID_TIME");
  // A payment that arrives after an explicit release (for example cancellation)
  // cannot consume returned stock, even when the original expiry is still future.
  // Keep it distinct from an expired hold so the eventual provider/order adapter
  // can journal and reconcile the correct cause without guessing.
  if (reservation.status === "released")
    return { kind: "released_paid_exception" as const, stock, reservation };
  if (reservation.status === "expired") {
    return { kind: "late_paid_exception" as const, stock, reservation };
  }
  if (reservation.status === "held" && now >= reservation.expiresAt) {
    // A verified payment may race the expiry callback. Release the still-held
    // stock in this same transition; leaving it held while reporting a late
    // payment would strand stock once the order leaves the pending queue.
    const expired = expireInventory(stock, reservation, now, expectedRevision);
    return { kind: "late_paid_exception" as const, ...expired };
  }
  requireHeld(stock, reservation, expectedRevision);
  const revision = nextRevision(stock.revision);
  return {
    kind: "consumed" as const,
    stock:
      stock.kind === "finite"
        ? {
            ...stock,
            onHand: stock.onHand - reservation.quantity,
            reserved: stock.reserved - reservation.quantity,
            revision,
          }
        : { ...stock, revision },
    reservation: { ...reservation, status: "consumed" as const },
  };
}
