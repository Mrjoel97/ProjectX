// The closed set of Stripe event types this deployment acts on — PURE (CLAUDE.md §1).

/**
 * The locked list from the phase context. Every entry is a **v1 SNAPSHOT event**: the delivery
 * carries the full object under `data.object`.
 *
 * v2 THIN events (`v1.billing.meter.*` and the rest of the v2 event families) are deliberately
 * absent and must NOT be added here. They carry a reference rather than an object, need
 * `parseEventNotification` plus a follow-up fetch, and are configured on a SEPARATE endpoint.
 * Mixing the two shapes on one route is a defect, not a convenience.
 *
 * These strings are a wire contract with the Stripe Dashboard's endpoint configuration. A typo is
 * not a compile error anywhere — it is an event that is simply never delivered. `events.test.ts`
 * pins the whole array as a written-out literal for exactly that reason.
 */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "credit_note.created",
  // Bank transfer: funds land in the customer CASH BALANCE, not on the invoice. These two are why
  // `invoice.paid` alone must never be recorded as cash in hand.
  "customer_cash_balance_transaction.created",
  "cash_balance.funds_available",
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export type EventClassification = { kind: "handled"; type: HandledEventType } | { kind: "ignored" };

/**
 * Classify an incoming `event.type`.
 *
 * **Unknown types are ignored, never thrown.** Stripe adds event types without asking, and a
 * throw would turn a brand-new type into a 500 — which Stripe reads as a delivery failure and
 * answers with a retry storm on an endpoint we cannot un-configure quickly. Ignoring is the only
 * safe default; a type we care about is opted in by adding it to the array above.
 *
 * Matching is exact. No prefix matching, no case folding: `invoice.paid.v2` and `Invoice.Paid` are
 * different events, and guessing at them is how a wrong object gets money applied to it.
 */
export function classifyEvent(type: string): EventClassification {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type)
    ? { kind: "handled", type: type as HandledEventType }
    : { kind: "ignored" };
}
