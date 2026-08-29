import { describe, expect, test } from "vitest";
import { classifyEvent, HANDLED_EVENT_TYPES } from "./events";

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
