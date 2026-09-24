import type {
  CheckoutIdempotencyInput,
  CommerceQuote,
  CommerceQuoteInput,
  CommerceRefusal,
  CommerceResult,
} from "@pikar/contracts/tenantCommerce";

const MAX_QUANTITY = 100;
const MAX_LINES = 50;
const refusal = (reason: CommerceRefusal): { ok: false; reason: CommerceRefusal } => ({ ok: false, reason });
const validMinor = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const validRef = (value: string | undefined): value is string => typeof value === "string" && value.length > 0;

export function addCommerceMinor(a: number, b: number): CommerceResult<number> {
  if (!validMinor(a) || !validMinor(b)) return refusal("invalid_amount");
  if (a > Number.MAX_SAFE_INTEGER - b) return refusal("overflow");
  return { ok: true, value: a + b };
}

export function multiplyCommerceMinor(unitMinor: number, quantity: number): CommerceResult<number> {
  if (!validMinor(unitMinor)) return refusal("invalid_amount");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return refusal("invalid_quantity");
  if (unitMinor > Math.floor(Number.MAX_SAFE_INTEGER / quantity)) return refusal("overflow");
  return { ok: true, value: unitMinor * quantity };
}

export type CommerceQuoteResult = { readonly ok: true; readonly quote: CommerceQuote } | { readonly ok: false; readonly reason: CommerceRefusal };

export function quoteTenantCommerce(input: CommerceQuoteInput): CommerceQuoteResult {
  // The runtime boundary matters too: JS callers can bypass TypeScript's `never`.
  if (!input || typeof input !== "object" || !Array.isArray(input.lines)) return refusal("invalid_quantity");
  if ("clientTotalMinor" in input) return refusal("client_total_override");
  if (!validRef(input.tenant) || !validRef(input.merchantAccount) || !validRef(input.provider) || !validRef(input.taxPolicy) || !validRef(input.shippingPolicy)) {
    return refusal("configuration_required");
  }
  if (input.lines.length < 1 || input.lines.length > MAX_LINES) return refusal("invalid_quantity");
  if (!validMinor(input.taxMinor) || !validMinor(input.shippingMinor)) return refusal("invalid_amount");

  if (!input.lines[0] || typeof input.lines[0] !== "object") return refusal("stale");
  const currency = input.lines[0].currency;
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return refusal("invalid_currency");
  let subtotalMinor = 0;
  for (const line of input.lines) {
    if (!line || typeof line !== "object") return refusal("stale");
    if (line.tenant !== input.tenant) return refusal("foreign");
    if (!validRef(line.product) || !validRef(line.sku) || !validRef(line.pricePolicy) || !Number.isSafeInteger(line.productVersion) || line.productVersion < 1) return refusal("stale");
    if (line.currency !== currency) return refusal("mixed_currency");
    const lineTotal = multiplyCommerceMinor(line.unitMinor, line.quantity);
    if (!lineTotal.ok) return lineTotal;
    const next = addCommerceMinor(subtotalMinor, lineTotal.value);
    if (!next.ok) return next;
    subtotalMinor = next.value;
  }
  const withTax = addCommerceMinor(subtotalMinor, input.taxMinor);
  if (!withTax.ok) return withTax;
  const total = addCommerceMinor(withTax.value, input.shippingMinor);
  if (!total.ok) return total;
  return {
    ok: true,
    quote: {
      tenant: input.tenant,
      merchantAccount: input.merchantAccount,
      provider: input.provider,
      taxPolicy: input.taxPolicy,
      shippingPolicy: input.shippingPolicy,
      currency,
      subtotalMinor,
      taxMinor: input.taxMinor,
      shippingMinor: input.shippingMinor,
      totalMinor: total.value,
      lines: input.lines,
    },
  };
}

export function checkoutIdempotencyKey(input: CheckoutIdempotencyInput): string {
  if (
    !input ||
    !validRef(input.tenant) ||
    !validRef(input.order) ||
    !["checkout", "refund", "fulfilment"].includes(input.purpose) ||
    !Number.isSafeInteger(input.attempt) ||
    input.attempt < 1
  ) {
    throw new RangeError("Invalid commerce idempotency input");
  }
  // The selected adapter may hash this versioned exact tuple later.
  return `tenant-commerce:v1:${JSON.stringify([input.tenant, input.order, input.purpose, input.attempt])}`;
}
