import { afterEach, describe, expect, test, vi } from "vitest";
import {
  flutterwaveClient,
  flutterwavePaymentReceipt,
  flutterwaveReference,
  merchantClient,
  paypalPaymentReceipt,
  safeMerchantUrl,
  stripeCapability,
  stripePaymentReceipt,
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
  function pilot() {
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_TENANT_ID", "tenant");
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_PROJECT_ID", "shop");
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_ACCOUNT_ID", "91234");
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_SECRET_KEY", "FLWSECK_TEST-example-X");
    vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_WEBHOOK_SECRET", "test-callback-fixture");
  }
  const tzAttempt = {
    ...attempt,
    providerAccountRef: "91234",
    currency: "TZS",
    totalMinor: 150000,
  };
  const hostedLink = "https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-test";
  test("Flutterwave sends checkout only for a whole-shilling quote under this shop's test key", async () => {
    pilot();
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ status: "success", data: { link: hostedLink } }),
    );
    const client = flutterwaveClient("tenant", "shop", "91234", fetcher);
    for (const invalid of [
      { ...tzAttempt, totalMinor: 150001 },
      { ...tzAttempt, currency: "GBP" },
      { ...tzAttempt, providerAccountRef: "42" },
    ])
      await expect(
        client.createCheckout(invalid, "buyer@example.test", "https://shop.test/return"),
      ).rejects.toThrow();
    await expect(
      client.createCheckout(tzAttempt, "not-an-email", "https://shop.test/return"),
    ).rejects.toThrow("EMAIL");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      client.createCheckout(tzAttempt, "buyer@example.test", "https://shop.test/return"),
    ).resolves.toBe(hostedLink);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.flutterwave.com/v3/payments");
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer FLWSECK_TEST-example-X" });
    expect(JSON.parse(String(init?.body))).toEqual({
      amount: 1500,
      currency: "TZS",
      tx_ref: flutterwaveReference(tzAttempt),
      payment_options: "card,mobilemoneytanzania",
      redirect_url: "https://shop.test/return",
      customer: { email: "buyer@example.test" },
    });
    expect(flutterwaveReference(tzAttempt)).toMatch(/^pikar-flw-[a-f0-9]{64}$/);
    for (const badLink of [
      "https://checkout.flutterwave.com.evil.test/v3/hosted/pay/test",
      "https://checkout.flutterwave.com/login",
    ])
      expect(() => safeMerchantUrl(badLink, "flutterwave")).toThrow();
  });
  test("Flutterwave refuses another tenant, project, account, missing config, and production credentials before egress", () => {
    pilot();
    const fetcher = vi.fn();
    for (const [tenant, project, account] of [
      ["different", "shop", "91234"],
      ["tenant", "another", "91234"],
      ["tenant", "shop", "10000"],
    ] as const)
      expect(() => flutterwaveClient(tenant, project, account, fetcher)).toThrow();
    for (const key of ["", "FLWSECK-live-X", "FLWSECK_TEST-SANDBOXDEMOKEY-X"]) {
      vi.stubEnv("MERCHANT_FLUTTERWAVE_TEST_SECRET_KEY", key);
      expect(() => flutterwaveClient("tenant", "shop", "91234", fetcher)).toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  test("Flutterwave reconciles verified transactions against the immutable amount, order and merchant", async () => {
    pilot();
    const tx = {
      id: 456,
      account_id: 91234,
      tx_ref: flutterwaveReference(tzAttempt),
      amount: "1500.00",
      charged_amount: 1500,
      currency: "TZS",
      status: "successful",
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ status: "success", data: tx }));
    const client = flutterwaveClient("tenant", "shop", "91234", fetcher);
    const byReference = await client.readPayment(tx.tx_ref);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${tx.tx_ref}`,
    );
    await client.readPayment(tx.tx_ref, "456");
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "https://api.flutterwave.com/v3/transactions/456/verify",
    );
    expect(flutterwavePaymentReceipt(byReference, tzAttempt, "event", "456")).toMatchObject({
      outcome: "succeeded",
      paymentRef: "456",
      amountMinor: 150000,
      verification: { method: "provider_read" },
    });
    for (const change of [
      { id: 457 },
      { account_id: "999" },
      { amount: 1499 },
      { amount: "1500.001" },
      { charged_amount: 1501 },
      { currency: "GBP" },
      { tx_ref: flutterwaveReference({ ...tzAttempt, orderId: "other" }) },
    ])
      expect(() =>
        flutterwavePaymentReceipt({ ...tx, ...change }, tzAttempt, "event", "456"),
      ).toThrow("BINDING");
    for (const status of ["failed", "pending"]) {
      const receipt = flutterwavePaymentReceipt({ ...tx, status }, tzAttempt, "event");
      expect(receipt.outcome).toBe("pending");
      expect(receipt.paymentRef).toBeUndefined();
      expect(receipt.eventRef).not.toBe(flutterwavePaymentReceipt(tx, tzAttempt, "event").eventRef);
    }
  });
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
