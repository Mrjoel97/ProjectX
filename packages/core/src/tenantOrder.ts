import { addCommerceMinor, multiplyCommerceMinor } from "./tenantCommerce";
import {
  type CatalogueItem,
  type GoodsKind,
  type InventoryState,
  MAX_FINITE_HOLD_MS,
  MIN_FINITE_HOLD_MS,
  validateInventory,
} from "./tenantInventory";
import { sha256Bytes } from "./webRuntime";

export type OrderPolicy = {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly revision: number;
  readonly sellerOfRecordRef: string;
  readonly currency: string;
  readonly countries: readonly string[];
  readonly taxRounding: "half_up";
  readonly physical?: {
    readonly shippingSourceRef: string;
    readonly shippingMinor: number;
    readonly returnsPolicyRef: string;
    readonly taxSourceRef: string;
    readonly taxBasisPoints: number;
    readonly refundPolicyRef: string;
    readonly buyerRetentionRef: string;
  };
  readonly digital?: {
    readonly deliveryRef: string;
    readonly revocationRef: string;
    readonly noShipping: true;
    readonly taxSourceRef: string;
    readonly taxBasisPoints: number;
    readonly refundPolicyRef: string;
    readonly buyerRetentionRef: string;
  };
};
export type OrderLineRequest = {
  readonly presentationItemId: string;
  readonly productId: string;
  readonly quantity: number;
  readonly expectedProductRevision: number;
  readonly expectedUnitMinor: number;
};
export type LiveOrderMapping = {
  readonly presentationItemId: string;
  readonly productId: string;
  readonly product: CatalogueItem;
  readonly stock: InventoryState;
};
export type OrderQuoteInput = {
  readonly tenantId: string;
  readonly projectId: string;
  readonly addressCountry: string;
  readonly lines: readonly OrderLineRequest[];
  readonly mappings: readonly LiveOrderMapping[];
  readonly policy?: OrderPolicy;
};
export type OrderSnapshot = {
  readonly tenantId: string;
  readonly projectId: string;
  readonly currency: string;
  readonly country: string;
  readonly policyId: string;
  readonly policyRevision: number;
  readonly sellerOfRecordRef: string;
  readonly taxRounding: "half_up";
  readonly physicalPolicy?: NonNullable<OrderPolicy["physical"]>;
  readonly digitalPolicy?: NonNullable<OrderPolicy["digital"]>;
  readonly lines: readonly {
    readonly presentationItemId: string;
    readonly productId: string;
    readonly sku: string;
    readonly goodsKind: GoodsKind;
    readonly taxSourceRef: string;
    readonly refundPolicyRef: string;
    readonly buyerRetentionRef: string;
    readonly productRevision: number;
    readonly stockRevision: number;
    readonly unitMinor: number;
    readonly quantity: number;
    readonly lineMinor: number;
  }[];
  readonly subtotalMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly totalMinor: number;
  readonly hash: string;
};
export type OrderRefusal =
  | "configuration_required"
  | "invalid_cart"
  | "foreign"
  | "stale"
  | "out_of_stock"
  | "unsupported_geography"
  | "unsupported_currency"
  | "overflow";
export type OrderQuoteResult =
  | { readonly ok: true; readonly snapshot: OrderSnapshot }
  | { readonly ok: false; readonly reason: OrderRefusal };
const refuse = (reason: OrderRefusal): OrderQuoteResult => ({ ok: false, reason });
const ref = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && value.trim().length > 0;
const minor = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const country = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{2}$/.test(value);
const taxRate = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000;
const physicalReady = (
  value: OrderPolicy["physical"],
): value is NonNullable<OrderPolicy["physical"]> =>
  !!value &&
  ref(value.shippingSourceRef) &&
  minor(value.shippingMinor) &&
  ref(value.returnsPolicyRef) &&
  ref(value.taxSourceRef) &&
  taxRate(value.taxBasisPoints) &&
  ref(value.refundPolicyRef) &&
  ref(value.buyerRetentionRef);
const digitalReady = (
  value: OrderPolicy["digital"],
): value is NonNullable<OrderPolicy["digital"]> =>
  !!value &&
  value.noShipping === true &&
  ref(value.deliveryRef) &&
  ref(value.revocationRef) &&
  ref(value.taxSourceRef) &&
  taxRate(value.taxBasisPoints) &&
  ref(value.refundPolicyRef) &&
  ref(value.buyerRetentionRef);

function canonicalOrderJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalOrderJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = value as Record<string, unknown>;
    return `{${Object.keys(fields)
      .filter((key) => fields[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalOrderJson(fields[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Stable across policy/Convex object-key ordering; line-array order remains significant. */
export function hashOrderQuote(body: Record<string, unknown>): string {
  return `sha256:${sha256Bytes(new TextEncoder().encode(canonicalOrderJson(body)))}`;
}

/** Server-owned live product and policy facts are the only financial authority. */
export function quoteOrder(input: OrderQuoteInput): OrderQuoteResult {
  if (
    !input ||
    !ref(input.tenantId) ||
    !ref(input.projectId) ||
    !country(input.addressCountry) ||
    "clientTotalMinor" in input ||
    !Array.isArray(input.lines) ||
    input.lines.length < 1 ||
    input.lines.length > 50 ||
    !Array.isArray(input.mappings)
  )
    return refuse("invalid_cart");
  const policy = input.policy;
  if (
    !policy ||
    !ref(policy.id) ||
    !ref(policy.sellerOfRecordRef) ||
    !Number.isSafeInteger(policy.revision) ||
    policy.revision < 1 ||
    !/^[A-Z]{3}$/.test(policy.currency) ||
    !Array.isArray(policy.countries) ||
    policy.countries.length < 1 ||
    policy.countries.length > 249 ||
    !policy.countries.every(country) ||
    policy.taxRounding !== "half_up"
  )
    return refuse("configuration_required");
  if (policy.tenantId !== input.tenantId || policy.projectId !== input.projectId)
    return refuse("foreign");
  if (!policy.countries.includes(input.addressCountry)) return refuse("unsupported_geography");
  const unique = new Set<string>();
  const lines: OrderSnapshot["lines"][number][] = [];
  let subtotalMinor = 0;
  let physicalSubtotal = 0;
  let digitalSubtotal = 0;
  for (const request of input.lines) {
    if (
      !request ||
      !ref(request.presentationItemId) ||
      !ref(request.productId) ||
      unique.has(request.productId) ||
      "goodsKind" in request ||
      "displayLabel" in request ||
      "lineMinor" in request
    )
      return refuse("invalid_cart");
    unique.add(request.productId);
    const mapping = input.mappings.find(
      (row) =>
        row.presentationItemId === request.presentationItemId &&
        row.productId === request.productId,
    );
    if (
      !mapping ||
      mapping.product.id !== request.productId ||
      mapping.stock.productId !== request.productId
    )
      return refuse("stale");
    if (mapping.product.tenantId !== input.tenantId || mapping.stock.tenantId !== input.tenantId)
      return refuse("foreign");
    const goodsKind = mapping.product.goodsKind;
    if (goodsKind !== "physical" && goodsKind !== "digital")
      return refuse("configuration_required");
    const branch = goodsKind === "physical" ? policy.physical : policy.digital;
    if (goodsKind === "physical" ? !physicalReady(policy.physical) : !digitalReady(policy.digital))
      return refuse("configuration_required");
    if (
      mapping.product.status !== "active" ||
      mapping.product.revision !== request.expectedProductRevision ||
      mapping.product.priceMinor !== request.expectedUnitMinor ||
      !minor(mapping.product.priceMinor) ||
      mapping.product.priceMinor === 0
    )
      return refuse("stale");
    if (mapping.product.currency !== policy.currency) return refuse("unsupported_currency");
    try {
      validateInventory(mapping.stock, input.tenantId, request.productId);
    } catch {
      return refuse("stale");
    }
    if (
      mapping.stock.kind === "finite" &&
      (!Number.isSafeInteger(mapping.stock.reservationTtlMs) ||
        (mapping.stock.reservationTtlMs ?? 0) < MIN_FINITE_HOLD_MS ||
        (mapping.stock.reservationTtlMs ?? 0) > MAX_FINITE_HOLD_MS ||
        (mapping.stock.reservationTtlMs ?? 0) % MIN_FINITE_HOLD_MS !== 0)
    )
      return refuse("configuration_required");
    if (
      mapping.stock.kind === "finite"
        ? mapping.stock.onHand - mapping.stock.reserved < request.quantity
        : !mapping.stock.approved
    )
      return refuse("out_of_stock");
    const total = multiplyCommerceMinor(mapping.product.priceMinor, request.quantity);
    if (!total.ok) return refuse(total.reason === "overflow" ? "overflow" : "invalid_cart");
    const next = addCommerceMinor(subtotalMinor, total.value);
    if (!next.ok) return refuse("overflow");
    subtotalMinor = next.value;
    const kindSubtotal = addCommerceMinor(
      goodsKind === "physical" ? physicalSubtotal : digitalSubtotal,
      total.value,
    );
    if (!kindSubtotal.ok) return refuse("overflow");
    if (goodsKind === "physical") physicalSubtotal = kindSubtotal.value;
    else digitalSubtotal = kindSubtotal.value;
    lines.push({
      presentationItemId: request.presentationItemId,
      productId: request.productId,
      sku: mapping.product.sku,
      goodsKind,
      taxSourceRef: branch!.taxSourceRef,
      refundPolicyRef: branch!.refundPolicyRef,
      buyerRetentionRef: branch!.buyerRetentionRef,
      productRevision: mapping.product.revision,
      stockRevision: mapping.stock.revision,
      unitMinor: mapping.product.priceMinor,
      quantity: request.quantity,
      lineMinor: total.value,
    });
  }
  // The declared half-up rule is evaluated in bigint to avoid fractional/unsafe intermediates.
  const taxBig =
    (BigInt(physicalSubtotal) * BigInt(policy.physical?.taxBasisPoints ?? 0) + 5_000n) / 10_000n +
    (BigInt(digitalSubtotal) * BigInt(policy.digital?.taxBasisPoints ?? 0) + 5_000n) / 10_000n;
  if (taxBig > BigInt(Number.MAX_SAFE_INTEGER)) return refuse("overflow");
  const taxMinor = Number(taxBig);
  const taxed = addCommerceMinor(subtotalMinor, taxMinor);
  if (!taxed.ok) return refuse("overflow");
  const shippingMinor = physicalSubtotal > 0 ? policy.physical!.shippingMinor : 0;
  const total = addCommerceMinor(taxed.value, shippingMinor);
  if (!total.ok) return refuse("overflow");
  const body = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    currency: policy.currency,
    country: input.addressCountry,
    policyId: policy.id,
    policyRevision: policy.revision,
    sellerOfRecordRef: policy.sellerOfRecordRef,
    taxRounding: policy.taxRounding,
    ...(physicalSubtotal > 0 ? { physicalPolicy: policy.physical } : {}),
    ...(digitalSubtotal > 0 ? { digitalPolicy: policy.digital } : {}),
    lines,
    subtotalMinor,
    taxMinor,
    shippingMinor,
    totalMinor: total.value,
  };
  return {
    ok: true,
    snapshot: {
      ...body,
      hash: hashOrderQuote(body),
    },
  };
}

export type OrderStatus =
  | "pending"
  | "expired"
  | "cancelled"
  | "cancel_requested"
  | "paid"
  | "paid_needs_review";
export function transitionOrder(
  status: OrderStatus,
  fact: "cancel" | "expire" | "payment_confirmed",
): OrderStatus {
  if (fact === "cancel")
    return status === "pending"
      ? "cancelled"
      : status === "paid"
        ? "cancel_requested"
        : status;
  if (fact === "expire") return status === "pending" ? "expired" : status;
  if (status === "expired" || status === "cancelled") return "paid_needs_review";
  return status === "pending" ? "paid" : status;
}
