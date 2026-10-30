import type {
  MerchantCapability,
  MerchantProvider,
  NormalizedMerchantPaymentReceipt,
} from "@pikar/contracts/tenantCommerce";

/** Separate selling credentials: neither Pikar billing nor read-only finance grants are used. */
export const MERCHANT_STRIPE_API_VERSION = "2026-09-30.endive";
const required = {
  stripe: ["MERCHANT_STRIPE_TEST_SECRET_KEY", "MERCHANT_STRIPE_TEST_WEBHOOK_SECRET"],
  paypal: [
    "MERCHANT_PAYPAL_SANDBOX_CLIENT_ID",
    "MERCHANT_PAYPAL_SANDBOX_CLIENT_SECRET",
    "MERCHANT_PAYPAL_SANDBOX_WEBHOOK_ID",
    "MERCHANT_PAYPAL_PARTNER_MERCHANT_ID",
  ],
} as const;
export const missingMerchantConfiguration = (provider: MerchantProvider) =>
  required[provider].filter((name) => !process.env[name]);
export const wire = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(wire) : [];
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const accountId = (value: unknown) => /^acct_[A-Za-z0-9]+$/.test(text(value));
export function safeMerchantUrl(value: unknown, provider: MerchantProvider): string {
  const url = new URL(text(value));
  const hosts =
    provider === "stripe"
      ? ["accounts.stripe.com", "connect.stripe.com", "checkout.stripe.com"]
      : ["www.sandbox.paypal.com", "sandbox.paypal.com"];
  if (
    url.protocol !== "https:" ||
    !hosts.includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password
  )
    throw Error("MERCHANT_PROVIDER_URL_INVALID");
  return url.href;
}
/** Bounded JSON transport. Never retries an uncertain money/account write. */
async function jsonRequest(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw Error("MERCHANT_PROVIDER_OUTCOME_UNKNOWN");
  }
  if (!response.ok) throw Error(`MERCHANT_PROVIDER_HTTP_${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw Error("MERCHANT_PROVIDER_RESPONSE_INVALID");
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 256 * 1024) {
        await reader.cancel();
        throw Error("MERCHANT_PROVIDER_RESPONSE_TOO_LARGE");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return wire(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    throw Error("MERCHANT_PROVIDER_RESPONSE_INVALID");
  }
}
export function merchantClient(provider: MerchantProvider, fetcher: typeof fetch = fetch) {
  if (missingMerchantConfiguration(provider).length) throw Error("MERCHANT_CONFIGURATION_REQUIRED");
  const stripeKey = process.env.MERCHANT_STRIPE_TEST_SECRET_KEY;
  if (provider === "stripe" && !/^sk_test_[A-Za-z0-9]+$/.test(stripeKey ?? ""))
    throw Error("MERCHANT_TEST_KEY_REQUIRED");
  async function stripe(
    path: string,
    method = "GET",
    body?: Record<string, unknown> | URLSearchParams,
    account?: string,
    idempotency?: string,
  ) {
    if (
      !/^\/v[12]\//.test(path) ||
      path.includes("..") ||
      (account !== undefined && !accountId(account))
    )
      throw Error("MERCHANT_PROVIDER_PATH_INVALID");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${stripeKey}`,
      "Stripe-Version": MERCHANT_STRIPE_API_VERSION,
    };
    if (account) headers["Stripe-Account"] = account;
    if (idempotency) headers["Idempotency-Key"] = idempotency;
    if (body)
      headers["Content-Type"] =
        body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json";
    return jsonRequest(
      `https://api.stripe.com${path}`,
      {
        method,
        headers,
        ...(body
          ? { body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body) }
          : {}),
      },
      fetcher,
    );
  }
  let token: string | undefined;
  async function paypal(
    path: string,
    method = "GET",
    body?: Record<string, unknown>,
    seller?: string,
    idempotency?: string,
  ) {
    if (
      !path.startsWith("/v") ||
      path.includes("..") ||
      (seller && !/^[A-Z0-9]{8,32}$/.test(seller))
    )
      throw Error("MERCHANT_PROVIDER_PATH_INVALID");
    if (!token) {
      const response = await jsonRequest(
        "https://api-m.sandbox.paypal.com/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${process.env.MERCHANT_PAYPAL_SANDBOX_CLIENT_ID}:${process.env.MERCHANT_PAYPAL_SANDBOX_CLIENT_SECRET}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        },
        fetcher,
      );
      token = text(response.access_token);
      if (!token) throw Error("MERCHANT_PROVIDER_AUTH_INVALID");
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (seller)
      headers["PayPal-Auth-Assertion"] =
        `${btoa(JSON.stringify({ alg: "none" }))}.${btoa(JSON.stringify({ iss: process.env.MERCHANT_PAYPAL_SANDBOX_CLIENT_ID, payer_id: seller }))}.`;
    if (idempotency) headers["PayPal-Request-Id"] = idempotency;
    if (process.env.MERCHANT_PAYPAL_PARTNER_ATTRIBUTION_ID)
      headers["PayPal-Partner-Attribution-Id"] = process.env.MERCHANT_PAYPAL_PARTNER_ATTRIBUTION_ID;
    return jsonRequest(
      `https://api-m.sandbox.paypal.com${path}`,
      { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) },
      fetcher,
    );
  }
  return { stripe, paypal };
}

export function stripeCapability(value: unknown, expectedAccount: string) {
  const account = wire(value),
    merchant = wire(wire(account.configuration).merchant),
    capabilities = wire(merchant.capabilities),
    defaults = wire(account.defaults),
    identity = wire(account.identity);
  if (
    account.id !== expectedAccount ||
    account.object !== "v2.core.account" ||
    account.livemode !== false ||
    wire(capabilities.card_payments).status !== "active" ||
    account.dashboard !== "full" ||
    wire(defaults.responsibilities).losses_collector !== "stripe" ||
    wire(defaults.responsibilities).fees_collector !== "stripe"
  )
    throw Error("MERCHANT_ACCOUNT_NOT_READY");
  const sellerCountry = text(identity.country).toUpperCase(),
    currency = text(defaults.currency).toUpperCase();
  if (!/^[A-Z]{2}$/.test(sellerCountry) || !["USD", "EUR", "GBP"].includes(currency))
    throw Error("MERCHANT_ACCOUNT_CURRENCY_UNSUPPORTED");
  return { sellerCountry, currency };
}
export function paypalCapability(value: unknown, trackingId: string) {
  const account = wire(value);
  const grants = rows(account.oauth_integrations)
    .flatMap((row) => rows(row.oauth_third_party))
    .filter((row) => row.partner_client_id === process.env.MERCHANT_PAYPAL_SANDBOX_CLIENT_ID);
  const scopes = grants.flatMap((row) => (Array.isArray(row.scopes) ? row.scopes : []));
  if (
    account.tracking_id !== trackingId ||
    !/^[A-Z0-9]{8,32}$/.test(text(account.merchant_id)) ||
    account.merchant_id === process.env.MERCHANT_PAYPAL_PARTNER_MERCHANT_ID ||
    account.payments_receivable !== true ||
    account.primary_email_confirmed !== true ||
    !rows(account.products).some(
      (row) => row.name === "EXPRESS_CHECKOUT" && row.status === "ACTIVE",
    ) ||
    !scopes.includes("https://uri.paypal.com/services/payments/refund") ||
    !scopes.includes("https://uri.paypal.com/services/payments/payment/authcapture")
  )
    throw Error("MERCHANT_ACCOUNT_NOT_READY");
  const sellerCountry = text(account.country).toUpperCase(),
    currency = text(account.primary_currency).toUpperCase();
  if (!/^[A-Z]{2}$/.test(sellerCountry) || !["USD", "EUR", "GBP"].includes(currency))
    throw Error("MERCHANT_ACCOUNT_CURRENCY_UNSUPPORTED");
  return { providerAccountId: text(account.merchant_id), sellerCountry, currency };
}
export function makeMerchantCapability(input: {
  tenantId: string;
  accountId: string;
  providerAccountId: string;
  provider: MerchantProvider;
  sellerCountry: string;
  currency: string;
  buyerCountries: string[];
  now: number;
}): MerchantCapability {
  return {
    tenantId: input.tenantId,
    provider: input.provider,
    environment: "test",
    merchantAccountRef: input.accountId,
    providerAccountRef: input.providerAccountId,
    flow: input.provider === "stripe" ? "stripe_connect_direct" : "paypal_merchant_checkout",
    status: "verified",
    sellerCountry: input.sellerCountry,
    buyerCountries: input.buyerCountries,
    presentmentCurrencies: [input.currency],
    settlementCurrencies: [input.currency],
    operations: ["checkout", "refund"],
    evidenceRef: `provider-read:${input.provider}:${input.accountId}:${input.now}`,
    verifiedAt: input.now,
    expiresAt: input.now + 15 * 60_000,
  };
}
export function stripePaymentReceipt(
  value: unknown,
  attempt: {
    tenantId: string;
    providerAccountRef: string;
    merchantAccountRef: string;
    orderId: string;
    attemptId: string;
    quoteHash: string;
    currency: string;
    totalMinor: number;
  },
  eventRef: string,
): NormalizedMerchantPaymentReceipt {
  const session = wire(value),
    metadata = wire(session.metadata),
    intent = wire(session.payment_intent);
  if (
    session.livemode !== false ||
    session.mode !== "payment" ||
    metadata.orderId !== attempt.orderId ||
    metadata.attemptId !== attempt.attemptId ||
    metadata.quoteHash !== attempt.quoteHash ||
    session.amount_total !== attempt.totalMinor ||
    text(session.currency).toUpperCase() !== attempt.currency ||
    session.client_reference_id !== attempt.orderId
  )
    throw Error("MERCHANT_PAYMENT_BINDING_MISMATCH");
  const paid = session.payment_status === "paid" && intent.status === "succeeded";
  if (
    paid &&
    (intent.livemode !== false ||
      intent.amount_received !== attempt.totalMinor ||
      text(intent.currency).toUpperCase() !== attempt.currency ||
      !text(intent.id).startsWith("pi_"))
  )
    throw Error("MERCHANT_PAYMENT_BINDING_MISMATCH");
  return {
    ...attempt,
    provider: "stripe",
    environment: "test",
    eventRef,
    amountMinor: attempt.totalMinor,
    outcome: paid ? "succeeded" : session.status === "expired" ? "cancelled" : "pending",
    ...(paid ? { paymentRef: text(intent.id) } : {}),
    verification: { method: "provider_read", evidenceRef: `stripe-session:${text(session.id)}` },
  };
}
export function paypalPaymentReceipt(
  value: unknown,
  attempt: {
    tenantId: string;
    providerAccountRef: string;
    merchantAccountRef: string;
    orderId: string;
    attemptId: string;
    quoteHash: string;
    currency: string;
    totalMinor: number;
  },
  eventRef: string,
): NormalizedMerchantPaymentReceipt {
  const order = wire(value),
    units = rows(order.purchase_units);
  if (units.length !== 1) throw Error("MERCHANT_PAYMENT_BINDING_MISMATCH");
  const unit = units[0]!,
    captures = rows(wire(unit.payments).captures),
    amount = wire(unit.amount);
  if (
    unit.reference_id !== attempt.orderId ||
    unit.custom_id !== attempt.attemptId ||
    unit.invoice_id !== attempt.quoteHash ||
    wire(unit.payee).merchant_id !== attempt.providerAccountRef ||
    amount.currency_code !== attempt.currency ||
    amount.value !== (attempt.totalMinor / 100).toFixed(2)
  )
    throw Error("MERCHANT_PAYMENT_BINDING_MISMATCH");
  const paid = order.status === "COMPLETED";
  if (
    paid &&
    (captures.length !== 1 ||
      captures[0]!.status !== "COMPLETED" ||
      wire(captures[0]!.amount).value !== amount.value ||
      wire(captures[0]!.amount).currency_code !== attempt.currency ||
      !text(captures[0]!.id))
  )
    throw Error("MERCHANT_PAYMENT_BINDING_MISMATCH");
  return {
    ...attempt,
    provider: "paypal",
    environment: "test",
    eventRef,
    amountMinor: attempt.totalMinor,
    outcome: paid ? "succeeded" : "pending",
    ...(paid ? { paymentRef: text(captures[0]!.id) } : {}),
    verification: { method: "provider_read", evidenceRef: `paypal-order:${text(order.id)}` },
  };
}
