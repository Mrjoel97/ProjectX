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

/** Merchant commerce is separate from Pikar billing and read-only finance connectors. */
export type MerchantProvider = "stripe" | "paypal";
export type MerchantEnvironment = "test" | "live";
export type MerchantOperation =
  | "checkout"
  | "refund"
  | "physical_shipment"
  | "digital_entitlement"
  | "customer_notice";
export type MerchantFailure =
  | "configuration_required"
  | "live_mode_disabled"
  | "foreign"
  | "stale"
  | "expired"
  | "unsupported_country"
  | "unsupported_currency"
  | "invalid_amount"
  | "invalid_receipt"
  | "event_conflict"
  | "payment_conflict"
  | "unknown_outcome"
  | "approval_required"
  | "payment_not_confirmed"
  | "review_required"
  | "refund_exceeds_paid"
  | "invalid_transition";
export type MerchantResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: MerchantFailure };

/** Trusted server projection of verified account/configuration evidence, never a model grant. */
export type MerchantCapability = {
  readonly tenantId: string;
  readonly provider: MerchantProvider;
  readonly environment: MerchantEnvironment;
  readonly merchantAccountRef: string;
  readonly providerAccountRef: string;
  readonly flow: "stripe_connect_direct" | "paypal_merchant_checkout";
  readonly status: "unverified" | "verified" | "unsupported";
  readonly sellerCountry: string;
  readonly buyerCountries: readonly string[];
  readonly presentmentCurrencies: readonly string[];
  readonly settlementCurrencies: readonly string[];
  readonly operations: readonly MerchantOperation[];
  readonly evidenceRef: string;
  readonly verifiedAt: number;
  readonly expiresAt: number;
};

export type MerchantCheckoutAttempt = {
  readonly tenantId: string;
  readonly provider: MerchantProvider;
  readonly environment: MerchantEnvironment;
  readonly merchantAccountRef: string;
  readonly providerAccountRef: string;
  readonly orderId: string;
  readonly attemptId: string;
  readonly quoteHash: string;
  readonly currency: string;
  readonly totalMinor: number;
  readonly idempotencyKey: string;
  readonly expiresAt: number;
  readonly status:
    | "pending"
    | "unknown"
    | "expired"
    | "cancelled"
    | "failed"
    | "paid"
    | "merchant_review";
  readonly paymentRef?: string;
  readonly reviewReason?: "late_payment" | "released_hold" | "stock_unavailable";
  readonly events: readonly { readonly eventRef: string; readonly fingerprint: string }[];
};

/** A verifier constructs this only after signature/account checks or an authenticated provider read.
 * Its TypeScript shape does not verify a signature. Never expose it as an LLM/public write RPC. */
export type NormalizedMerchantPaymentReceipt = {
  readonly tenantId: string;
  readonly provider: MerchantProvider;
  readonly environment: MerchantEnvironment;
  readonly merchantAccountRef: string;
  readonly providerAccountRef: string;
  readonly eventRef: string;
  readonly paymentRef?: string;
  readonly orderId: string;
  readonly attemptId: string;
  readonly quoteHash: string;
  readonly currency: string;
  readonly amountMinor: number;
  readonly outcome: "pending" | "succeeded" | "failed" | "cancelled";
  readonly verification: {
    readonly method: "signed_webhook" | "provider_read";
    readonly evidenceRef: string;
  };
};
export type MerchantInventoryOutcome =
  | "consumed"
  | "late_paid_exception"
  | "released_paid_exception"
  | "unavailable";

/** Bound to an existing trusted approval/policy row for the exact action hash. A model cannot mint it. */
export type MerchantActionAuthorization = {
  readonly ref: string;
  readonly kind: "merchant_admin" | "standing_policy";
  readonly tenantId: string;
  readonly operation: Exclude<MerchantOperation, "checkout">;
  readonly subjectRef: string;
  readonly actionHash: string;
  readonly expiresAt: number;
};
export type MerchantRefundAttempt = {
  readonly tenantId: string;
  readonly provider: MerchantProvider;
  readonly environment: MerchantEnvironment;
  readonly merchantAccountRef: string;
  readonly providerAccountRef: string;
  readonly orderId: string;
  readonly paymentRef: string;
  readonly refundId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly authorizationRef: string;
  readonly status: "pending" | "unknown" | "succeeded" | "failed";
  readonly providerRefundRef?: string;
  readonly events: readonly { readonly eventRef: string; readonly fingerprint: string }[];
};
export type NormalizedMerchantRefundReceipt = {
  readonly tenantId: string;
  readonly provider: MerchantProvider;
  readonly environment: MerchantEnvironment;
  readonly merchantAccountRef: string;
  readonly providerAccountRef: string;
  readonly orderId: string;
  readonly paymentRef: string;
  readonly refundId: string;
  readonly providerRefundRef: string;
  readonly eventRef: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly outcome: "pending" | "succeeded" | "failed";
  readonly verification: NormalizedMerchantPaymentReceipt["verification"];
};

export type MerchantFulfilment = {
  readonly tenantId: string;
  readonly orderId: string;
  readonly fulfilmentId: string;
  readonly paymentRef: string;
  readonly kind: "physical_shipment" | "digital_entitlement";
  readonly policyRef: string;
  readonly targetRef: string;
  readonly idempotencyKey: string;
  readonly authorizationRef: string;
  readonly status: "prepared" | "pending" | "unknown" | "succeeded" | "failed" | "revoked";
  readonly evidenceRef?: string;
  readonly expiresAt?: number;
};
export type MerchantBuyerNotice = {
  readonly tenantId: string;
  readonly orderId: string;
  readonly customerRef: string;
  readonly template:
    | "payment_received"
    | "merchant_review"
    | "shipment_dispatched"
    | "digital_ready"
    | "refund_completed";
  readonly policyRef: string;
  readonly stateEvidenceRef: string;
  readonly idempotencyKey: string;
  readonly status: "prepared";
};
