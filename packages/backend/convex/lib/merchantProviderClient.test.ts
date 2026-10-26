import { afterEach, describe, expect, test, vi } from "vitest";
import {
  merchantClient,
  stripeCapability,
  stripePaymentReceipt,
  safeMerchantUrl,
  paypalPaymentReceipt,
} from "./merchantProviderClient";
afterEach(() => vi.unstubAllEnvs());
const attempt = {
  tenantId: "tenant",
  providerAccountRef: "acct_exact",
  merchantAccountRef: "merchant",
  orderId: "order",
  attemptId: "attempt",
  quoteHash: "sha256:" + "a".repeat(64),
  currency: "GBP",
  totalMinor: 1400,
};
describe("merchant provider boundary", () => {
  test("missing or live Stripe key fails before any egress", () => {
    vi.stubEnv("MERCHANT_STRIPE_TEST_SECRET_KEY", "");
    vi.stubEnv("MERCHANT_STRIPE_TEST_WEBHOOK_SECRET", "whsec_test");
    const fetcher = vi.fn();
    expect(() => merchantClient("stripe", fetcher)).toThrow("CONFIGURATION");
    vi.stubEnv("MERCHANT_STRIPE_TEST_SECRET_KEY", "sk_live_disallowed");
    expect(() => merchantClient("stripe", fetcher)).toThrow("TEST_KEY");
    expect(fetcher).not.toHaveBeenCalled();
  });
  test("direct requests carry only dedicated test credentials and the exact server-selected account", async () => {
    vi.stubEnv("MERCHANT_STRIPE_TEST_SECRET_KEY", "sk_test_fixture");
    vi.stubEnv("MERCHANT_STRIPE_TEST_WEBHOOK_SECRET", "whsec_test");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "cs_test_fixture" }));
    await merchantClient("stripe", fetcher).stripe(
      "/v1/checkout/sessions",
      "POST",
      new URLSearchParams({ mode: "payment" }),
      "acct_exact",
      "stable-key",
    );
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: {
        Authorization: "Bearer sk_test_fixture",
        "Stripe-Account": "acct_exact",
        "Idempotency-Key": "stable-key",
      },
    });
  });
  test("account readiness requires server permission, exact account and test mode", () => {
    const value = {
      id: "acct_exact",
      object: "v2.core.account",
      livemode: false,
      dashboard: "full",
      identity: { country: "TZ" },
      defaults: {
        currency: "GBP",
        responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      },
      configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
    };
    expect(stripeCapability(value, "acct_exact")).toEqual({ sellerCountry: "TZ", currency: "GBP" });
    for (const bad of [
      { ...value, livemode: true },
      { ...value, id: "acct_foreign" },
      { ...value, configuration: {} },
      { ...value, defaults: {} },
    ])
      expect(() => stripeCapability(bad, "acct_exact")).toThrow();
  });
  test("success return and session completion never substitute for exact succeeded payment evidence", () => {
    const value = {
      id: "cs_test_fixture",
      livemode: false,
      mode: "payment",
      client_reference_id: "order",
      metadata: { orderId: "order", attemptId: "attempt", quoteHash: attempt.quoteHash },
      amount_total: 1400,
      currency: "gbp",
      payment_status: "unpaid",
      status: "complete",
      payment_intent: { status: "processing" },
    };
    expect(stripePaymentReceipt(value, attempt, "evt").outcome).toBe("pending");
    const paid = {
      ...value,
      payment_status: "paid",
      payment_intent: {
        id: "pi_exact",
        status: "succeeded",
        livemode: false,
        amount_received: 1400,
        currency: "gbp",
      },
    };
    expect(stripePaymentReceipt(paid, attempt, "evt").outcome).toBe("succeeded");
    for (const bad of [
      { ...paid, livemode: true },
      { ...paid, metadata: { ...paid.metadata, orderId: "other" } },
      { ...paid, amount_total: 1 },
      { ...paid, payment_intent: { ...paid.payment_intent, livemode: true } },
    ])
      expect(() => stripePaymentReceipt(bad, attempt, "evt")).toThrow();
  });
  test("PayPal binds the actual capture seller, amount, currency and immutable quote", () => {
    const value = {
      id: "ORDERTEST",
      status: "COMPLETED",
      purchase_units: [
        {
          reference_id: "order",
          custom_id: "attempt",
          invoice_id: attempt.quoteHash,
          payee: { merchant_id: "acct_exact" },
          amount: { currency_code: "GBP", value: "14.00" },
          payments: {
            captures: [
              {
                id: "CAPTURETEST",
                status: "COMPLETED",
                amount: { currency_code: "GBP", value: "14.00" },
              },
            ],
          },
        },
      ],
    };
    expect(paypalPaymentReceipt(value, attempt, "evt").outcome).toBe("succeeded");
    expect(() =>
      paypalPaymentReceipt(
        {
          ...value,
          purchase_units: [{ ...value.purchase_units[0], payee: { merchant_id: "foreign" } }],
        },
        attempt,
        "evt",
      ),
    ).toThrow();
  });
  test("provider redirects cannot target arbitrary URLs, live PayPal, credentials or port overrides", () => {
    expect(safeMerchantUrl("https://checkout.stripe.com/c/pay/test", "stripe")).toContain(
      "checkout.stripe.com",
    );
    for (const url of [
      "https://example.test/",
      "https://www.paypal.com/",
      "https://user:password@checkout.stripe.com/",
      "https://checkout.stripe.com:8443/",
    ])
      expect(() => safeMerchantUrl(url, "stripe")).toThrow();
  });
});
