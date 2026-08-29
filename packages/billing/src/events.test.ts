import { describe, expect, test } from "vitest";
import {
  classifyEvent,
  eventFacts,
  HANDLED_EVENT_TYPES,
  MAPPING_EVENT_TYPES,
  subscriptionState,
} from "./events";

describe("HANDLED_EVENT_TYPES", () => {
  // The literal array, written out. A rename on either side kills this test — which is the
  // point: these strings are a wire contract with Stripe's Dashboard endpoint configuration,
  // and a typo is a silently-never-delivered event.
  test("is exactly the locked list and nothing else", () => {
    expect([...HANDLED_EVENT_TYPES]).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.finalized",
      "invoice.paid",
      "invoice.payment_failed",
      "charge.refunded",
      "credit_note.created",
      "customer_cash_balance_transaction.created",
      "cash_balance.funds_available",
    ]);
  });

  test("holds no duplicates", () => {
    expect(new Set(HANDLED_EVENT_TYPES).size).toBe(HANDLED_EVENT_TYPES.length);
  });
});

describe("classifyEvent", () => {
  test("a handled type returns its own discriminant", () => {
    expect(classifyEvent("invoice.paid")).toEqual({ kind: "handled", type: "invoice.paid" });
  });

  test.each([...HANDLED_EVENT_TYPES])("%s is handled", (type) => {
    expect(classifyEvent(type).kind).toBe("handled");
  });

  test("an unhandled type is ignored, not thrown", () => {
    expect(classifyEvent("charge.dispute.created")).toEqual({ kind: "ignored" });
  });

  // Stripe adds event types without asking. A throw here would turn a brand-new event type into
  // a 500 and buy a retry storm on an endpoint we cannot un-configure fast.
  test.each([
    "invoice.updated",
    "v1.billing.meter.error_report_triggered",
    "",
    "totally.made.up",
  ])("%s is ignored and never throws", (type) => {
    expect(() => classifyEvent(type)).not.toThrow();
    expect(classifyEvent(type)).toEqual({ kind: "ignored" });
  });

  test("a near-miss on a handled name is ignored, not fuzzy-matched", () => {
    expect(classifyEvent("invoice.paid.v2")).toEqual({ kind: "ignored" });
    expect(classifyEvent("Invoice.Paid")).toEqual({ kind: "ignored" });
  });
});

/**
 * A realistic `checkout.session.completed` `data.object`, PII included on purpose.
 *
 * The two sentinels below are what the extractor exists to leave behind: `deadLetters` and `audit`
 * are `audit_immutable` and are excluded from BOTH the erasure walk and the export walk, so an
 * email that reaches either one is beyond the reach of a deletion request forever (CLAUDE.md §4).
 */
const SENTINEL_EMAIL = "sentinel-buyer@example.invalid";
const SENTINEL_NAME = "Sentinel Buyer";

function checkoutSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cs_test_1",
    object: "checkout.session",
    customer: "cus_1",
    subscription: "sub_1",
    client_reference_id: "tenant_1",
    metadata: { tenantId: "tenant_1" },
    status: "complete",
    amount_total: 4900,
    customer_details: { email: SENTINEL_EMAIL, name: SENTINEL_NAME, phone: "+15550000000" },
    customer_email: SENTINEL_EMAIL,
    ...overrides,
  };
}

function subscriptionObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: "trialing",
    trial_end: 1_800_000_000,
    metadata: { tenantId: "tenant_1" },
    items: { data: [{ id: "si_1", price: { id: "price_1", nickname: "Pikar AI" } }] },
    default_payment_method: { billing_details: { email: SENTINEL_EMAIL, name: SENTINEL_NAME } },
    ...overrides,
  };
}

describe("eventFacts is the redact-then-write boundary, made structural", () => {
  test("a checkout session yields the thread back to a tenant and nothing else", () => {
    expect(eventFacts("checkout.session.completed", checkoutSession())).toEqual({
      customerId: "cus_1",
      subscriptionId: "sub_1",
      clientReferenceId: "tenant_1",
      metadataTenantId: "tenant_1",
      // A checkout session's `status` is "complete"/"open"/"expired" — it is NOT a subscription
      // status, and reading it as one would write "complete" into the field every access decision
      // is made from.
      subscriptionStatus: null,
      priceId: null,
      trialEndsAt: null,
    });
  });

  test("a subscription yields its status, its price and its trial end in MILLISECONDS", () => {
    expect(eventFacts("customer.subscription.updated", subscriptionObject())).toEqual({
      customerId: "cus_1",
      subscriptionId: "sub_1",
      clientReferenceId: null,
      metadataTenantId: "tenant_1",
      subscriptionStatus: "trialing",
      priceId: "price_1",
      // Stripe sends SECONDS. Storing them unconverted puts a 1970 date on a live trial.
      trialEndsAt: 1_800_000_000_000,
    });
  });

  // THE §4 ASSERTION. Written against the SERIALIZED result, not against named fields: a field
  // this test does not know about is exactly the one that would carry the leak.
  test("no email, name, phone or amount survives the extraction — whole-object assertion", () => {
    const cases: readonly [string, Record<string, unknown>][] = [
      ["checkout.session.completed", checkoutSession()],
      ["customer.subscription.created", subscriptionObject()],
    ];
    for (const [type, object] of cases) {
      const json = JSON.stringify(eventFacts(type, object));
      expect(json, type).not.toContain(SENTINEL_EMAIL);
      expect(json, type).not.toContain(SENTINEL_NAME);
      expect(json, type).not.toContain("+15550000000");
      expect(json, type).not.toContain("4900");
      expect(json, type).not.toContain("Pikar AI");
    }
  });

  test("an expanded `customer` object is read by id, never carried through whole", () => {
    const facts = eventFacts(
      "checkout.session.completed",
      checkoutSession({ customer: { id: "cus_exp", email: SENTINEL_EMAIL, name: SENTINEL_NAME } }),
    );
    expect(facts.customerId).toBe("cus_exp");
    expect(JSON.stringify(facts)).not.toContain(SENTINEL_EMAIL);
  });

  test("a garbage or absent data object yields all-null rather than throwing", () => {
    const allNull = {
      customerId: null,
      subscriptionId: null,
      clientReferenceId: null,
      metadataTenantId: null,
      subscriptionStatus: null,
      priceId: null,
      trialEndsAt: null,
    };
    expect(eventFacts("checkout.session.completed", undefined)).toEqual(allNull);
    expect(eventFacts("checkout.session.completed", null)).toEqual(allNull);
    expect(eventFacts("customer.subscription.created", "not an object")).toEqual(allNull);
    expect(eventFacts("customer.subscription.created", { items: { data: [] } })).toEqual(allNull);
  });

  test("empty strings are null — an empty id must never become a lookup key", () => {
    const facts = eventFacts(
      "checkout.session.completed",
      checkoutSession({ customer: "", client_reference_id: "", metadata: { tenantId: "" } }),
    );
    expect(facts).toMatchObject({
      customerId: null,
      clientReferenceId: null,
      metadataTenantId: null,
    });
  });

  test("a non-numeric trial_end is dropped rather than coerced", () => {
    const nulled = subscriptionObject({ trial_end: null });
    const worded = subscriptionObject({ trial_end: "soon" });
    expect(eventFacts("customer.subscription.created", nulled).trialEndsAt).toBe(null);
    expect(eventFacts("customer.subscription.created", worded).trialEndsAt).toBe(null);
  });

  // Matching is EXACT, exactly like classifyEvent. A prefix rule would read
  // `customer.subscription.pending_update_applied` — a real Stripe event that is NOT in the
  // handled set — as a status-bearing one.
  test("MAPPING_EVENT_TYPES is the written-out closed set the mapping arm acts on", () => {
    expect([...MAPPING_EVENT_TYPES]).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ]);
    for (const type of MAPPING_EVENT_TYPES) expect(classifyEvent(type).kind).toBe("handled");
  });

  test("a subscription-shaped object under a NON-subscription event type yields no status", () => {
    expect(eventFacts("invoice.paid", subscriptionObject()).subscriptionStatus).toBe(null);
    const nearMiss = eventFacts(
      "customer.subscription.pending_update_applied",
      subscriptionObject(),
    );
    expect(nearMiss.subscriptionStatus).toBe(null);
  });
});

describe("subscriptionState never invents a tier it has no evidence for", () => {
  // Stripe's OWN status vocabulary, written out rather than imported, so the oracle cannot move
  // with the subject.
  test("the paying statuses", () => {
    for (const status of ["trialing", "active", "past_due"]) {
      expect(subscriptionState(status), status).toBe("subscribed");
    }
  });

  test("the not-paying statuses", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      expect(subscriptionState(status), status).toBe("not_subscribed");
    }
  });

  test("no row, and any status Stripe adds later, are `unknown` — never a free tier, never zero", () => {
    expect(subscriptionState(undefined)).toBe("unknown");
    expect(subscriptionState("")).toBe("unknown");
    expect(subscriptionState("pending")).toBe("unknown");
    expect(subscriptionState("some_status_stripe_adds_in_2027")).toBe("unknown");
    // The one that matters: an unrecognised status must never fall through to "subscribed".
    expect(subscriptionState("Active")).toBe("unknown");
  });
});
