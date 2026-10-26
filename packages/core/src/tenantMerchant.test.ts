import type {
  MerchantActionAuthorization,
  MerchantCapability,
  MerchantCheckoutAttempt,
  MerchantProvider,
  NormalizedMerchantPaymentReceipt,
  NormalizedMerchantRefundReceipt,
} from "@pikar/contracts/tenantCommerce";
import { describe, expect, test } from "vitest";
import {
  admitMerchantCheckout,
  digitalEntitlementAccessible,
  merchantFulfilmentActionHash,
  merchantRefundActionHash,
  prepareMerchantCheckout,
  prepareMerchantFulfilment,
  prepareMerchantNotice,
  prepareMerchantRefund,
  transitionMerchantFulfilment,
  transitionMerchantPayment,
  transitionMerchantRefund,
  validateMerchantPaymentReceipt,
} from "./tenantMerchant";

// Synthetic account capability rows only: these tests establish no provider/country eligibility.
const now = 1000;
const capability = (provider: MerchantProvider = "stripe"): MerchantCapability => ({
  tenantId: "tenant-a",
  provider,
  environment: "test",
  merchantAccountRef: "merchant-a",
  providerAccountRef: provider === "stripe" ? "acct_test" : "paypal-merchant-test",
  flow: provider === "stripe" ? "stripe_connect_direct" : "paypal_merchant_checkout",
  status: "verified",
  sellerCountry: "US",
  buyerCountries: ["US", "GB"],
  presentmentCurrencies: ["USD", "GBP"],
  settlementCurrencies: ["USD"],
  operations: ["checkout", "refund"],
  evidenceRef: "verified-fixture-only",
  verifiedAt: 1,
  expiresAt: 10000,
});
const request = (provider: MerchantProvider = "stripe") => ({
  capability: capability(provider),
  tenantId: "tenant-a",
  provider,
  environment: "test" as const,
  sellerCountry: "US",
  buyerCountry: "GB",
  currency: "USD",
  settlementCurrency: "USD",
  now,
  orderId: "order-a",
  attemptId: "attempt-a",
  quoteHash: `sha256:${"a".repeat(64)}`,
  totalMinor: 1500,
  expiresAt: 2000,
});
const attempt = (provider: MerchantProvider = "stripe"): MerchantCheckoutAttempt => {
  const result = prepareMerchantCheckout(request(provider));
  if (!result.ok) throw new Error(result.reason);
  return result.value;
};
const receipt = (
  state: MerchantCheckoutAttempt,
  patch: Partial<NormalizedMerchantPaymentReceipt> = {},
): NormalizedMerchantPaymentReceipt => ({
  tenantId: state.tenantId,
  provider: state.provider,
  environment: state.environment,
  merchantAccountRef: state.merchantAccountRef,
  providerAccountRef: state.providerAccountRef,
  eventRef: "event-paid",
  paymentRef: "capture-paid",
  orderId: state.orderId,
  attemptId: state.attemptId,
  quoteHash: state.quoteHash,
  currency: state.currency,
  amountMinor: state.totalMinor,
  outcome: "succeeded",
  verification: { method: "signed_webhook", evidenceRef: "verified-event" },
  ...patch,
});
const paid = (provider: MerchantProvider = "stripe") => {
  const state = attempt(provider);
  const result = transitionMerchantPayment(state, receipt(state), "consumed");
  if (!result.ok) throw new Error(result.reason);
  return result.value.attempt;
};
const authorization = (
  operation: MerchantActionAuthorization["operation"],
  actionHash: string,
  patch: Partial<MerchantActionAuthorization> = {},
): MerchantActionAuthorization => ({
  ref: "approval-a",
  kind: "merchant_admin",
  tenantId: "tenant-a",
  operation,
  subjectRef: "order-a",
  actionHash,
  expiresAt: 5000,
  ...patch,
});
const refundInput = (state: MerchantCheckoutAttempt, amountMinor = 500) => {
  const action = {
    tenantId: state.tenantId,
    provider: state.provider,
    environment: state.environment,
    merchantAccountRef: state.merchantAccountRef,
    providerAccountRef: state.providerAccountRef,
    orderId: state.orderId,
    paymentRef: state.paymentRef ?? "",
    refundId: "refund-a",
    amountMinor,
    currency: state.currency,
  };
  return {
    capability: capability(state.provider),
    refundId: action.refundId,
    amountMinor,
    alreadyRefundedMinor: 0,
    reservedRefundMinor: 0,
    authorization: authorization("refund", merchantRefundActionHash(action)),
    now,
  };
};

describe.each(["stripe", "paypal"] as const)("merchant test-mode protocol: %s", (provider) => {
  test("binds a deterministic checkout to its merchant, quote, amount, currency and attempt", () => {
    const first = attempt(provider),
      again = prepareMerchantCheckout({ ...request(provider), existingAttempt: first });
    expect(again).toEqual({ ok: true, value: first });
    expect(
      prepareMerchantCheckout({ ...request(provider), totalMinor: 1600, existingAttempt: first }),
    ).toMatchObject({ ok: false, reason: "payment_conflict" });
    expect(
      prepareMerchantCheckout({
        ...request(provider),
        existingAttempt: { ...first, status: "unknown" },
      }),
    ).toMatchObject({ ok: false, reason: "unknown_outcome" });
    expect(
      prepareMerchantCheckout({
        ...request(provider),
        existingAttempt: { ...first, tenantId: "other" },
      }),
    ).toMatchObject({ ok: false, reason: "foreign" });
    expect(prepareMerchantCheckout({ ...request(provider), attemptId: "second" })).not.toEqual({
      ok: true,
      value: first,
    });
  });
  test("requires current account evidence, seller/buyer/currency admission and rejects real money", () => {
    const input = request(provider);
    for (const change of [
      { environment: "live" as const },
      { capability: { ...input.capability, status: "unverified" as const } },
      { capability: { ...input.capability, expiresAt: now } },
      { capability: { ...input.capability, operations: [] } },
    ])
      expect(prepareMerchantCheckout({ ...input, ...change }).ok).toBe(false);
    expect(admitMerchantCheckout(input.capability, { ...input, buyerCountry: "XX" })).toMatchObject(
      { ok: false, reason: "unsupported_country" },
    );
    expect(
      admitMerchantCheckout(input.capability, { ...input, sellerCountry: "GB" }),
    ).toMatchObject({ ok: false, reason: "unsupported_country" });
    expect(
      admitMerchantCheckout(input.capability, { ...input, settlementCurrency: "EUR" }),
    ).toMatchObject({ ok: false, reason: "unsupported_currency" });
    for (const totalMinor of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(prepareMerchantCheckout({ ...input, totalMinor }).ok).toBe(false);
  });
  test("deduplicates before inventory consumption and never fulfills twice or downgrades paid", () => {
    const initial = attempt(provider),
      fact = receipt(initial);
    const first = transitionMerchantPayment(initial, fact, "consumed");
    if (!first.ok) throw new Error(first.reason);
    expect(first.value).toMatchObject({
      fulfilmentAllowed: true,
      merchantReviewRequired: false,
      attempt: { status: "paid" },
    });
    expect(validateMerchantPaymentReceipt(first.value.attempt, fact)).toMatchObject({
      ok: true,
      value: { duplicate: true },
    });
    expect(transitionMerchantPayment(first.value.attempt, fact, "consumed")).toMatchObject({
      ok: true,
      value: { duplicate: true, fulfilmentAllowed: false },
    });
    expect(
      transitionMerchantPayment(
        first.value.attempt,
        { ...fact, eventRef: "event-two" },
        "consumed",
      ),
    ).toMatchObject({ ok: true, value: { fulfilmentAllowed: false, attempt: { status: "paid" } } });
    expect(
      transitionMerchantPayment(first.value.attempt, {
        ...fact,
        eventRef: "failed-later",
        outcome: "failed",
      }),
    ).toMatchObject({ ok: true, value: { attempt: { status: "paid" } } });
    expect(initial.events).toEqual([]);
  });
  test("rejects altered or unverified receipt facts and same event with changed financial meaning", () => {
    const initial = attempt(provider),
      fact = receipt(initial);
    for (const change of [
      { tenantId: "other" },
      { providerAccountRef: "other" },
      { environment: "live" as const },
      { currency: "GBP" },
      { amountMinor: 1 },
      { quoteHash: `sha256:${"b".repeat(64)}` },
      { attemptId: "other" },
      { verification: { method: "browser_redirect", evidenceRef: "success-url" } as never },
      { paymentRef: undefined },
    ])
      expect(validateMerchantPaymentReceipt(initial, { ...fact, ...change }).ok).toBe(false);
    const first = transitionMerchantPayment(initial, fact, "consumed");
    if (!first.ok) throw new Error(first.reason);
    expect(
      validateMerchantPaymentReceipt(first.value.attempt, { ...fact, outcome: "failed" }),
    ).toMatchObject({ ok: false, reason: "event_conflict" });
    expect(
      validateMerchantPaymentReceipt(first.value.attempt, {
        ...fact,
        eventRef: "another",
        paymentRef: "second-capture",
      }),
    ).toMatchObject({ ok: false, reason: "payment_conflict" });
    expect(transitionMerchantPayment(initial, fact, "invented" as never)).toMatchObject({
      ok: false,
      reason: "configuration_required",
    });
  });
  test("late, released and unavailable stock stop at merchant review without automatic delivery", () => {
    for (const inventoryOutcome of [
      "late_paid_exception",
      "released_paid_exception",
      "unavailable",
    ] as const) {
      const initial = attempt(provider);
      const result = transitionMerchantPayment(initial, receipt(initial), inventoryOutcome);
      expect(result).toMatchObject({
        ok: true,
        value: {
          merchantReviewRequired: true,
          fulfilmentAllowed: false,
          attempt: { status: "merchant_review" },
        },
      });
    }
    const initial = { ...attempt(provider), status: "expired" as const };
    expect(transitionMerchantPayment(initial, receipt(initial), "consumed")).toMatchObject({
      ok: true,
      value: { merchantReviewRequired: true, fulfilmentAllowed: false },
    });
  });
  test("refund authority is exact, merchant-admin only, account-scoped and reserves pending amounts", () => {
    const state = paid(provider),
      input = refundInput(state);
    expect(prepareMerchantRefund(state, input)).toMatchObject({
      ok: true,
      value: { status: "pending", amountMinor: 500 },
    });
    for (const change of [
      { reservedRefundMinor: 1100 },
      { alreadyRefundedMinor: 1100 },
      { amountMinor: 1501 },
    ])
      expect(prepareMerchantRefund(state, { ...input, ...change })).toMatchObject({
        ok: false,
        reason: "refund_exceeds_paid",
      });
    for (const auth of [
      { kind: "standing_policy" as const },
      { tenantId: "other" },
      { actionHash: "different" },
      { expiresAt: now },
    ])
      expect(
        prepareMerchantRefund(state, {
          ...input,
          authorization: { ...input.authorization, ...auth },
        }),
      ).toMatchObject({ ok: false, reason: "approval_required" });
    expect(
      prepareMerchantRefund(state, {
        ...input,
        capability: { ...input.capability, operations: ["checkout"] },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
    expect(
      prepareMerchantRefund(state, {
        ...input,
        capability: { ...input.capability, providerAccountRef: "another" },
      }),
    ).toMatchObject({ ok: false, reason: "foreign" });
    expect(
      prepareMerchantRefund(
        { ...state, providerAccountRef: "another" },
        {
          ...input,
          capability: { ...input.capability, providerAccountRef: "another" },
        },
      ),
    ).toMatchObject({ ok: false, reason: "approval_required" });
    expect(
      prepareMerchantRefund(state, {
        ...input,
        capability: {
          ...input.capability,
          flow: provider === "stripe" ? "paypal_merchant_checkout" : "stripe_connect_direct",
        },
      }),
    ).toMatchObject({ ok: false, reason: "configuration_required" });
  });
  test("verified refund completion increments refunded money once; unknown remains reserved", () => {
    const state = paid(provider),
      command = prepareMerchantRefund(state, refundInput(state));
    if (!command.ok) throw new Error(command.reason);
    const a = command.value;
    const fact: NormalizedMerchantRefundReceipt = {
      tenantId: a.tenantId,
      provider: a.provider,
      environment: a.environment,
      merchantAccountRef: a.merchantAccountRef,
      providerAccountRef: a.providerAccountRef,
      orderId: a.orderId,
      paymentRef: a.paymentRef,
      refundId: a.refundId,
      providerRefundRef: "provider-refund",
      eventRef: "refund-event",
      amountMinor: a.amountMinor,
      currency: a.currency,
      outcome: "succeeded",
      verification: { method: "provider_read", evidenceRef: "refund-read" },
    };
    const completed = transitionMerchantRefund({ ...a, status: "unknown" }, fact);
    if (!completed.ok) throw new Error(completed.reason);
    expect(completed.value).toMatchObject({
      newlyRefundedMinor: 500,
      attempt: { status: "succeeded" },
    });
    expect(transitionMerchantRefund(completed.value.attempt, fact)).toMatchObject({
      ok: true,
      value: { duplicate: true, newlyRefundedMinor: 0 },
    });
    expect(
      transitionMerchantRefund(completed.value.attempt, { ...fact, eventRef: "second-event" }),
    ).toMatchObject({ ok: true, value: { newlyRefundedMinor: 0 } });
    expect(transitionMerchantRefund(a, { ...fact, amountMinor: 1 }).ok).toBe(false);
    expect(transitionMerchantRefund(a, { ...fact, providerAccountRef: "foreign" }).ok).toBe(false);
    expect(
      transitionMerchantRefund({ ...a, status: "unknown" }, { ...fact, outcome: "pending" }),
    ).toMatchObject({ ok: true, value: { attempt: { status: "unknown" }, newlyRefundedMinor: 0 } });
  });
});

describe("fulfillment and truthful customer-notice preparation", () => {
  const state = paid();
  const draft = (kind: "physical_shipment" | "digital_entitlement") => {
    const action = {
      tenantId: state.tenantId,
      orderId: state.orderId,
      fulfilmentId: "delivery-a",
      kind,
      policyRef: "policy-v1",
      targetRef: "owned-delivery-target",
      ...(kind === "digital_entitlement" ? { expiresAt: 5000 } : {}),
    };
    return {
      ...action,
      goodsKind: kind === "physical_shipment" ? ("physical" as const) : ("digital" as const),
      refundedMinor: 0,
      authorization: authorization(kind, merchantFulfilmentActionHash(action), {
        kind: "standing_policy",
      }),
      now,
    };
  };
  test.each([
    "physical_shipment",
    "digital_entitlement",
  ] as const)("%s needs paid unreversed funds, matching goods and real evidence before completion", (kind) => {
    const input = draft(kind);
    const prepared = prepareMerchantFulfilment(state, input);
    if (!prepared.ok) throw new Error(prepared.reason);
    expect(prepared.value.status).toBe("prepared");
    expect(prepareMerchantFulfilment({ ...state, status: "merchant_review" }, input)).toMatchObject(
      { ok: false, reason: "review_required" },
    );
    expect(prepareMerchantFulfilment(state, { ...input, refundedMinor: 1 }).ok).toBe(false);
    expect(
      prepareMerchantFulfilment(state, {
        ...input,
        goodsKind: input.goodsKind === "physical" ? "digital" : "physical",
      }).ok,
    ).toBe(false);
    expect(
      prepareMerchantFulfilment(state, {
        ...input,
        authorization: { ...input.authorization, actionHash: "other" },
      }).ok,
    ).toBe(false);
    const done = transitionMerchantFulfilment(prepared.value, {
      tenantId: state.tenantId,
      orderId: state.orderId,
      fulfilmentId: prepared.value.fulfilmentId,
      status: "succeeded",
      evidenceRef: "actual-delivery-witness",
    });
    if (!done.ok) throw new Error(done.reason);
    expect(done.value.status).toBe("succeeded");
    expect(
      transitionMerchantFulfilment(done.value, {
        tenantId: state.tenantId,
        orderId: state.orderId,
        fulfilmentId: prepared.value.fulfilmentId,
        status: "pending",
        evidenceRef: "stale",
      }).ok,
    ).toBe(false);
  });
  test("digital access is tenant/order bound, expires and stops on recorded revocation", () => {
    const prepared = prepareMerchantFulfilment(state, draft("digital_entitlement"));
    if (!prepared.ok) throw new Error(prepared.reason);
    const done = transitionMerchantFulfilment(prepared.value, {
      tenantId: state.tenantId,
      orderId: state.orderId,
      fulfilmentId: prepared.value.fulfilmentId,
      status: "succeeded",
      evidenceRef: "delivery",
    });
    if (!done.ok) throw new Error(done.reason);
    expect(
      digitalEntitlementAccessible(done.value, {
        tenantId: state.tenantId,
        orderId: state.orderId,
        now,
      }),
    ).toBe(true);
    expect(
      digitalEntitlementAccessible(done.value, { tenantId: "other", orderId: state.orderId, now }),
    ).toBe(false);
    expect(
      digitalEntitlementAccessible(done.value, {
        tenantId: state.tenantId,
        orderId: state.orderId,
        now: 5000,
      }),
    ).toBe(false);
    const revoked = transitionMerchantFulfilment(done.value, {
      tenantId: state.tenantId,
      orderId: state.orderId,
      fulfilmentId: prepared.value.fulfilmentId,
      status: "revoked",
      evidenceRef: "policy-bound-revocation",
    });
    if (!revoked.ok) throw new Error(revoked.reason);
    expect(
      digitalEntitlementAccessible(revoked.value, {
        tenantId: state.tenantId,
        orderId: state.orderId,
        now,
      }),
    ).toBe(false);
  });
  test("notices are only drafts from real matching state, never claims of sent mail or unsupported delivery", () => {
    const input = {
      customerRef: "buyer-record",
      policyRef: "retention-v1",
      stateEvidenceRef: "payment-event",
      template: "payment_received" as const,
    };
    expect(prepareMerchantNotice(state, input)).toMatchObject({
      ok: true,
      value: { status: "prepared" },
    });
    expect(prepareMerchantNotice({ ...state, status: "merchant_review" }, input).ok).toBe(false);
    expect(prepareMerchantNotice(state, { ...input, template: "shipment_dispatched" }).ok).toBe(
      false,
    );
    expect(prepareMerchantNotice(state, { ...input, template: "refund_completed" }).ok).toBe(false);
    expect(prepareMerchantNotice(state, { ...input, template: "invented" as never }).ok).toBe(
      false,
    );
  });
});
