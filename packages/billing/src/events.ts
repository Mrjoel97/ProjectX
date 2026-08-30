// What a Stripe delivery MEANS — PURE (CLAUDE.md §1). No ctx, no fetch, no clock, no env.
//
// Three things live here and they are the same subject read at three depths: which event types
// this deployment acts on at all (`HANDLED_EVENT_TYPES` / `classifyEvent`), which ids a delivery
// is allowed to contribute to the database (`eventFacts` — the redact-then-write boundary), and
// what a stored subscription status means for access (`subscriptionState`).

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
  // `refund.created`, NOT `charge.refunded` (28.1-11 #6). A charge's `amount_refunded` is the
  // RUNNING TOTAL and the event repeats on one `ch_`, so booking it recorded a cumulative figure
  // under a correlation the first refund already owned — and the ledger's phase identity answers a
  // repeat by keeping the first row. A refund's own `amount` is the delta and `re_` is unique.
  "refund.created",
  "credit_note.created",
  // Bank transfer: funds land in the customer CASH BALANCE, not on the invoice. These two are why
  // `invoice.paid` alone must never be recorded as cash in hand.
  "customer_cash_balance_transaction.created",
  "cash_balance.funds_available",
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

/**
 * The CLOSED set of handled types that Stripe emits AT MOST ONCE per object — and therefore the
 * only types whose `(objectId, eventType)` pair is a genuine transition key.
 *
 * `billingWebhook.receiveAndApply` suppresses the EFFECT of a second delivery on one object. That
 * is correct only where a second delivery cannot be a second transition. Applied to every type it
 * was a defect (28.1-11 #2): one `sub_` emits `customer.subscription.updated` on EVERY transition,
 * so a subscription that went `trialing → active` and, three months later, `active → unpaid` had
 * the second update silently dropped and kept reading as a paying subscriber forever — `unpaid`
 * never emits a `deleted`, so nothing downstream could correct it. The same bit dropped every
 * refund after the first when refunds were still keyed on the charge.
 *
 * Membership is per-type and written down, because "is this one-shot?" is a claim about STRIPE and
 * a wrong guess is invisible:
 *   • `checkout.session.completed`      — a Checkout Session completes exactly once.
 *   • `invoice.finalized`               — an invoice finalizes exactly once; it cannot un-finalize.
 *   • `invoice.paid`                    — an invoice is paid once. A re-payment is a new invoice.
 *   • `customer.subscription.created`   — one per `sub_`, at creation.
 *   • `customer.subscription.deleted`   — terminal for that `sub_`; there is nothing after it.
 *
 * Everything else handled here is repeatable on ONE object id (`customer.subscription.updated`,
 * `invoice.payment_failed` across dunning) or already carries a per-movement id that makes the
 * by-object key non-colliding anyway (`refund.created`, `credit_note.created`,
 * `customer_cash_balance_transaction.created`). Those are protected instead by the `by_event`
 * dedupe key, by `applyMapping`'s `statusAt` freshness guard, and by the ledger's
 * (tenant, correlation, phase) identity.
 */
export const ONE_SHOT_EVENT_TYPES = [
  "checkout.session.completed",
  "invoice.finalized",
  "invoice.paid",
  "customer.subscription.created",
  "customer.subscription.deleted",
] as const satisfies readonly HandledEventType[];

/**
 * May a second delivery on this object id have its EFFECT suppressed?
 *
 * Exact membership, like `classifyEvent`. An unknown type answers `false` — fail OPEN here on
 * purpose, because the failure mode of suppressing wrongly is a transition silently lost, while
 * the failure mode of applying twice is caught downstream by the ledger's own identity.
 */
export function isOneShotEventType(type: string): boolean {
  return (ONE_SHOT_EVENT_TYPES as readonly string[]).includes(type);
}

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

/**
 * The subset of `HANDLED_EVENT_TYPES` that carries the tenant↔Stripe-customer mapping (28.1-05).
 *
 * EXACT membership, exactly like `classifyEvent` above and for the same reason: a prefix rule
 * (`type.startsWith("customer.subscription.")`) would swallow
 * `customer.subscription.pending_update_applied` and
 * `customer.subscription.trial_will_end` — real Stripe events that are NOT in the handled set and
 * whose `status` field means something else.
 */
export const MAPPING_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

/** The three types whose `data.object` IS a Subscription, so its `status` is a subscription one. */
const SUBSCRIPTION_EVENT_TYPES = new Set<string>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * The ONLY facts a Stripe delivery is allowed to contribute to the database.
 *
 * This type IS the redact-then-write boundary (CLAUDE.md §4), made structural rather than
 * procedural. A `checkout.session.completed` carries `customer_details.email`, `.name` and
 * `.phone`; a subscription carries the default payment method's billing details. None of it can
 * reach a row because there is nowhere in this shape to put it — `eventFacts` NAMES every field it
 * lifts, so a field Stripe adds tomorrow is absent by default instead of present by accident.
 *
 * Every member is an id, an enum token or a timestamp. `null` means "the delivery did not carry
 * it", never "empty".
 */
export type BillingEventFacts = {
  /** `cus_…` — the Stripe customer this event is about. */
  customerId: string | null;
  /** `sub_…` — the subscription the event is about, or the one a checkout session created. */
  subscriptionId: string | null;
  /** A Checkout Session's `client_reference_id`: the tenant id `startCheckout` threaded through. */
  clientReferenceId: string | null;
  /** `metadata.tenantId` — the same thread, on the object rather than on the session. */
  metadataTenantId: string | null;
  /** A SUBSCRIPTION status only. Null for every other event type. */
  subscriptionStatus: string | null;
  /** `price_…` off the first subscription item. */
  priceId: string | null;
  /** `trial_end` converted from Stripe SECONDS to epoch MILLISECONDS. */
  trialEndsAt: number | null;
};

/** A non-empty string, or null. An empty id must never become a lookup key. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * An id from either a bare string or an expanded object.
 *
 * We never request expansions, but a webhook endpoint can be configured with them in the
 * Dashboard, and `{ id, email, name }` arriving where `"cus_…"` was expected is exactly how a
 * whole object gets carried into a row. Taking `.id` either way keeps the shape closed.
 */
function refId(value: unknown): string | null {
  return str(value) ?? str((value as { id?: unknown } | null | undefined)?.id);
}

/**
 * Lift the ids out of a VERIFIED Stripe event's `data.object` and drop everything else.
 *
 * PURE (CLAUDE.md §1): no ctx, no fetch, no clock. Driven by `eventType` rather than by the
 * object's own `object` discriminator, because the type is what the signature covered and the
 * dedupe key was built from — trusting a self-describing field inside the payload to decide how
 * to read the payload is a smaller circle than it looks.
 */
export function eventFacts(eventType: string, dataObject: unknown): BillingEventFacts {
  const object: Record<string, unknown> =
    typeof dataObject === "object" && dataObject !== null
      ? (dataObject as Record<string, unknown>)
      : {};
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  const isSubscription = SUBSCRIPTION_EVENT_TYPES.has(eventType);
  const items = ((object.items as { data?: unknown } | undefined)?.data ?? []) as unknown[];
  const firstItem = (items[0] ?? null) as { price?: unknown } | null;
  const trialEnd = object.trial_end;

  return {
    customerId: refId(object.customer),
    // A checkout session POINTS AT its subscription; a subscription object IS one.
    subscriptionId: isSubscription ? str(object.id) : refId(object.subscription),
    clientReferenceId: str(object.client_reference_id),
    metadataTenantId: str(metadata.tenantId),
    subscriptionStatus: isSubscription ? str(object.status) : null,
    priceId: isSubscription ? refId(firstItem?.price) : null,
    trialEndsAt:
      isSubscription && typeof trialEnd === "number" && Number.isFinite(trialEnd)
        ? trialEnd * 1000
        : null,
  };
}

/** Stripe statuses under which the tenant has a live entitlement. */
const SUBSCRIBED_STATUSES = new Set<string>(["trialing", "active", "past_due"]);

/**
 * …and the ones under which they demonstrably do not.
 *
 * `incomplete` is here, not in the set above: the first payment has not succeeded, so the
 * subscription exists without ever having been paid for. `past_due` is in the set above because
 * Stripe keeps the subscription ACTIVE through dunning and cancels it itself when retries run out
 * — cutting access at the first failed retry is a product decision nobody made.
 */
const NOT_SUBSCRIBED_STATUSES = new Set<string>([
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

/**
 * What a stored subscription status means for access — or, honestly, that we do not know.
 *
 * `unknown` is the DEFAULT arm, not a special case: a status Stripe adds after this code was
 * written, and the `pending` sentinel a checkout writes before any subscription event has been
 * seen, both land there. Falling through to `subscribed` would grant a live entitlement off a
 * string nobody has read, and falling through to `not_subscribed` would fabricate a free tier this
 * product does not have.
 */
export function subscriptionState(
  status: string | undefined | null,
): "unknown" | "not_subscribed" | "subscribed" {
  if (typeof status !== "string") return "unknown";
  if (SUBSCRIBED_STATUSES.has(status)) return "subscribed";
  if (NOT_SUBSCRIBED_STATUSES.has(status)) return "not_subscribed";
  return "unknown";
}
