import { describe, expect, test } from "vitest";
import { commerceDeletionBlocker, commerceExportView } from "./tenantCommercePrivacy";
import { storageIdsIn } from "./tenantData";

describe("closed merchant privacy projection", () => {
  test("buyer details and money history are explicit merchant data; receipt capabilities and provider checkout links are omitted", () => {
    const row = {
      tenantId: "seller",
      orderId: "order",
      provider: "stripe",
      state: {
        tenantId: "seller",
        environment: "test",
        provider: "stripe",
        status: "paid",
        currency: "GBP",
        totalMinor: 1400,
        quoteHash: "immutable-quote",
        paymentRef: "pi_test",
        events: [{ eventRef: "evt_test", fingerprint: "digest" }],
        idempotencyKey: "private-provider-key",
      },
      buyerEmail: "buyer@example.test",
      buyerAddress: {
        name: "Test buyer",
        line1: "Test address",
        city: "Test city",
        postalCode: "00000",
        country: "TZ",
      },
      buyerTokenHash: "private-receipt-capability",
      checkoutUrl: "https://checkout.stripe.com/private",
      buyerPurgeAt: 123,
    };
    const projected = commerceExportView("tenantMerchantPayments", row);
    expect(projected).toMatchObject({
      buyerEmail: row.buyerEmail,
      buyerAddress: row.buyerAddress,
      state: {
        totalMinor: 1400,
        currency: "GBP",
        paymentRef: "pi_test",
        quoteHash: "immutable-quote",
        events: row.state.events,
      },
    });
    expect(projected).not.toHaveProperty("buyerTokenHash");
    expect(projected).not.toHaveProperty("checkoutUrl");
    expect(projected.state).not.toHaveProperty("idempotencyKey");
  });
  test("unknown buyer fields or raw provider payloads refuse the export rather than leaking", () => {
    expect(() =>
      commerceExportView("tenantMerchantPayments", {
        buyerAddress: { country: "TZ", unreviewedSecret: "private" },
      }),
    ).toThrow("COMMERCE_FIELD_UNCLASSIFIED");
    expect(() =>
      commerceExportView("tenantMerchantPayments", {
        state: { status: "paid", rawProviderResponse: { card: "private" } },
      }),
    ).toThrow("COMMERCE_FIELD_UNCLASSIFIED");
    const account = commerceExportView("tenantMerchantAccounts", {
      tenantId: "seller",
      providerAccountId: "acct_test",
      trackingId: "native-tracking",
      onboardingUrl: "private-onboarding-url",
    });
    expect(account).toEqual({ tenantId: "seller", providerAccountId: "acct_test" });
  });
  test("financial order, attempt and linked reservation history remain protected before any erase", () => {
    expect(commerceDeletionBlocker("tenantOrders", { status: "paid" })).toContain(
      "RETENTION_POLICY_REQUIRED",
    );
    expect(commerceDeletionBlocker("tenantOrderAttempts", {})).toContain(
      "RETENTION_POLICY_REQUIRED",
    );
    expect(commerceDeletionBlocker("tenantReservations", { orderId: "order" })).toContain(
      "RETENTION_POLICY_REQUIRED",
    );
    expect(commerceDeletionBlocker("tenantProducts", {})).toBeNull();
  });
  test("the immutable digital copy is included in the actual storage export/deletion inventory", () => {
    expect(storageIdsIn("tenantMerchantOperations", { storageId: "owned-digital-copy" })).toEqual([
      "owned-digital-copy",
    ]);
    expect(storageIdsIn("tenantMerchantOperations", {})).toEqual([]);
  });
});
