/** Opaque commerce refs: never interchange a tenant, product, order or provider id. */
type CommerceRef<Name extends string> = string & { readonly __commerceRef: Name };

export type TenantCommerceRef = CommerceRef<"tenant">;
export type ProductRef = CommerceRef<"product">;
export type SkuRef = CommerceRef<"sku">;
export type OrderRef = CommerceRef<"order">;
export type PaymentAttemptRef = CommerceRef<"payment_attempt">;
export type MerchantAccountRef = CommerceRef<"merchant_account">;
export type MerchantProviderRef = CommerceRef<"merchant_provider">;
export type ProviderEventRef = CommerceRef<"provider_event">;
export type PolicyVersionRef = CommerceRef<"policy_version">;

export type CommerceRefusal =
  | "configuration_required"
  | "provider_unavailable"
  | "stale"
  | "foreign"
  | "overflow"
  | "invalid_amount"
  | "invalid_quantity"
  | "invalid_currency"
  | "mixed_currency"
  | "client_total_override";

export type CommerceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: CommerceRefusal };

/** All prices and adjustments are trusted server-side integer-minor values. */
export type CommerceQuoteLine = {
  readonly tenant: TenantCommerceRef;
  readonly product: ProductRef;
  readonly sku: SkuRef;
  readonly productVersion: number;
  readonly pricePolicy: PolicyVersionRef;
  readonly currency: string;
  readonly unitMinor: number;
  readonly quantity: number;
};

export type CommerceQuoteInput = {
  readonly tenant: TenantCommerceRef;
  readonly merchantAccount?: MerchantAccountRef;
  readonly provider?: MerchantProviderRef;
  readonly taxPolicy?: PolicyVersionRef;
  readonly shippingPolicy?: PolicyVersionRef;
  readonly taxMinor: number;
  readonly shippingMinor: number;
  readonly lines: readonly CommerceQuoteLine[];
  /** A caller-supplied total is forbidden even if it happens to match. */
  readonly clientTotalMinor?: never;
};

export type CommerceQuote = Required<Omit<CommerceQuoteInput, "clientTotalMinor">> & {
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly totalMinor: number;
};

/** Only refs and a bounded ordinal; never buyer content, card data or a redirect URL. */
export type CheckoutIdempotencyInput = {
  readonly tenant: TenantCommerceRef;
  readonly order: OrderRef;
  readonly purpose: "checkout" | "refund" | "fulfilment";
  readonly attempt: number;
};
