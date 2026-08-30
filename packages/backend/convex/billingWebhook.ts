// The Stripe webhook receiver for PIKAR'S OWN merchant account (phase 28.1, BILL-02).
//
// NOT the Phase 28 `stripe*` connector, which reads a TENANT's Stripe account. Different
// direction, different secret, different names — see docs/playbooks/billing.md.
//
// Two things live here and they are deliberately separated:
//
//  1. `verifyStripeSignature` — a PURE-ish adapter over `@pikar/billing`'s parsing law plus
//     `hmacHex`. It is exported so `http.ts` can call it and so the tests can drive it directly.
//     `http.ts` CANNOT be "use node" (Convex HTTP actions run in the query/mutation sandbox), so
//     Stripe's synchronous `constructEvent` is unreachable and `stripe` is not a dependency of
//     this repo. Web Crypto by hand is the same rung every other provider here sits on.
//
//  2. `receiveAndApply` — ONE `internalMutation` that owns the dedupe insert AND the effect
//     switch. An httpAction is NOT transactional: an "insert here, apply there" split lets a
//     crash leave a dedupe row with no effect, and Stripe's retry is then silently suppressed by
//     the very row that proves nothing happened. Do no I/O in here — no runAction, no fetch.
import type { BillingEventFacts } from "@pikar/billing/events";
import { classifyEvent, isOneShotEventType } from "@pikar/billing/events";
import type { BillingObservation, Reconciliation } from "@pikar/billing/reconcile";
import {
  parseStripeSignature,
  SIGNATURE_TOLERANCE_S,
  timingSafeEqualHex,
} from "@pikar/billing/signature";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { recordBillingMovement } from "./billingLedger";
import { hmacHex } from "./gmailAuth";

/** A fact is an id or it is absent. `v.null()` rather than `v.optional` so the shape is total —
 *  an omitted key and a null one would otherwise be two ways to say the same thing. */
const factRef = v.union(v.string(), v.null());

/**
 * The ONLY shape a Stripe delivery may hand the database.
 *
 * This validator IS the redaction boundary (CLAUDE.md §4): `customer_details.email`, the
 * customer name and the amount cannot reach a row because there is no argument to carry them.
 * `@pikar/billing`'s `eventFacts` builds it at the HTTP boundary, before this mutation is called.
 */
const vBillingFacts = v.object({
  customerId: factRef,
  subscriptionId: factRef,
  clientReferenceId: factRef,
  metadataTenantId: factRef,
  subscriptionStatus: factRef,
  priceId: factRef,
  trialEndsAt: v.union(v.number(), v.null()),
});

/**
 * WHAT `reconcileEvent` DECIDED — the second closed type a delivery may hand the database, and the
 * money half of the same redaction boundary `vBillingFacts` is above.
 *
 * The reconciliation is computed at the HTTP boundary (`http.ts`), beside `eventFacts` and for the
 * identical reason: `reconcileEvent` is the only thing that reads the Stripe object, and what
 * crosses into this mutation is its OUTPUT — a phase, an integer count of minor units, an ISO 4217
 * code, a `billing/<id>` correlation and a code-owned kind token. There is nowhere in this shape to
 * put an email, a name, a line-item description or a card. The plan for 28.1-06 called
 * `reconcileEvent` from inside the mutation; that would have required passing the raw Stripe object
 * across this boundary, which is exactly what CLAUDE.md §4 and 28.1-05's `eventFacts` exist to
 * prevent. **This module never re-derives a phase or an amount — it only writes what it is given.**
 */
const vMoney = v.object({ minor: v.number(), currency: v.string() });

const vMovement = v.object({
  phase: v.union(
    v.literal("estimated"),
    v.literal("reserved"),
    v.literal("actual"),
    v.literal("refunded"),
    v.literal("adjustment"),
  ),
  amount: vMoney,
  correlationId: v.string(),
  kind: v.string(),
  stripeObjectId: v.string(),
});

const vObservation = v.union(
  v.object({
    kind: v.literal("unapplied-funds"),
    amount: vMoney,
    correlationId: v.string(),
    stripeObjectId: v.string(),
    ageDays: v.number(),
    stage: v.union(v.literal("held"), v.literal("return-attempted"), v.literal("swept")),
  }),
  v.object({
    kind: v.literal("awaiting-cash-application"),
    correlationId: v.string(),
    stripeObjectId: v.string(),
  }),
  v.object({
    kind: v.literal("payment-method-undetermined"),
    correlationId: v.string(),
    stripeObjectId: v.string(),
  }),
);

/** `null` is not "nothing moved" — it is `reconcileEvent` REFUSING a delivery whose amount or
 *  currency it could not read. A ledger that wrote a zero because it could not read a number is
 *  worse than one that refuses, so the null takes the dead-letter path below. */
const vReconciliation = v.union(
  v.object({ movements: v.array(vMovement), observations: v.array(vObservation) }),
  v.null(),
);

/**
 * Verify a `Stripe-Signature` header against the EXACT raw request body.
 *
 * `rawBody` must be the string returned by `req.text()`, never a re-serialized object: Stripe
 * signs the bytes it sent, and `JSON.parse` → `JSON.stringify` changes key order and whitespace,
 * so the HMAC cannot match.
 *
 * Two guards, in this order, and they are independent:
 *  - the TOLERANCE guard rejects a replayed-but-genuinely-signed delivery;
 *  - the SIGNATURE guard rejects a forged one.
 * Neither subsumes the other, and removing either leaves the other still passing its own tests.
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  nowS: number,
): Promise<boolean> {
  const parsed = parseStripeSignature(header);
  if (!parsed) return false;
  if (Math.abs(nowS - parsed.t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = await hmacHex(`${parsed.t}.${rawBody}`, secret);
  // EVERY v1, not just the first: during a secret roll Stripe sends both signatures on one header.
  return parsed.v1.some((sig) => timingSafeEqualHex(sig, expected));
}

/**
 * Record a VERIFIED Stripe event and apply its effect, in one transaction.
 *
 * Idempotency is structural, not advisory. Convex has no unique index; what makes the read-then-
 * insert safe is OCC — the `by_event` read joins this mutation's read set, so a concurrent
 * duplicate is transparently re-run, finds the row on its second pass, and returns early. This is
 * `recordMovement`'s shape (`spendLedger.ts`), copied rather than reinvented.
 *
 * TWO dedupe keys, because `event.id` alone is not enough (Stripe's own duplicate guidance): some
 * duplicates arrive as two DISTINCT Event objects describing the same object transition. The
 * second one is recorded — so the delivery is not lost — but `ignored`, so no effect runs twice.
 *
 * Event ORDER is not guaranteed by Stripe. Nothing here may assume sequencing.
 */
export const receiveAndApply = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    objectId: v.string(),
    /** `event.created` in MILLISECONDS. The only ordering Stripe gives us, and the mapping arm
     *  uses it to refuse a stale status rather than trusting arrival order. */
    eventCreatedAt: v.optional(v.number()),
    /** Ids lifted from `data.object` at the HTTP boundary. Optional so the 28.1-01 callers that
     *  predate the mapping arm still typecheck; absent is treated as "carried nothing". */
    facts: v.optional(vBillingFacts),
    /** What `reconcileEvent` decided, computed at the HTTP boundary. Optional for the same reason
     *  `facts` is: absent means the caller predates 28.1-06 and no money is booked. */
    money: v.optional(vReconciliation),
    /** The invoice's single published `taxability_reason`, when it claimed exactly one. Stamped on
     *  every ledger row this delivery writes, because a bare `Tax: 0.00` is never presentable. */
    taxabilityReason: v.optional(v.string()),
  },
  // The outcome is a THREE-value discriminant, not a boolean, because the two duplicate shapes are
  // genuinely different events: `duplicate_event` is Stripe re-delivering the SAME Event object
  // (nothing new is stored), `duplicate_object` is a DIFFERENT Event object describing an object
  // transition we already saw (a row IS stored, so the delivery is visible, but no effect runs).
  // Collapsing them would make the by-object branch unobservable — and an unobservable branch is
  // one no test can prove exists.
  returns: v.object({
    outcome: v.union(v.literal("new"), v.literal("duplicate_event"), v.literal("duplicate_object")),
    status: v.union(v.literal("applied"), v.literal("ignored")),
  }),
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("billingStripeEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (seen) return { outcome: "duplicate_event" as const, status: seen.status };

    // The same object transition arriving as a second Event object. Record it (so the delivery is
    // visible) but never act on it. An empty objectId is not a dedupe key — a payload with no
    // object id would otherwise collapse every such event into one.
    //
    // ONE-SHOT TYPES ONLY (28.1-11 #2). `(objectId, eventType)` is a transition key only where
    // Stripe emits that type at most once per object. For a REPEATABLE type — a `sub_` updating on
    // every transition, an invoice failing across dunning — the pair is not a transition key at
    // all, and suppressing on it dropped every transition after the first: a subscription that
    // went `unpaid` kept reading as a paying subscriber, permanently. The delivery is still
    // recorded either way; only the EFFECT is conditional.
    const duplicateByObject =
      args.objectId === "" || !isOneShotEventType(args.eventType)
        ? null
        : await ctx.db
            .query("billingStripeEvents")
            .withIndex("by_object_type", (q) =>
              q.eq("objectId", args.objectId).eq("eventType", args.eventType),
            )
            .first();

    const status = duplicateByObject
      ? ("ignored" as const)
      : await applyEffect(ctx, args, args.facts ?? NO_FACTS);
    await ctx.db.insert("billingStripeEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      objectId: args.objectId,
      status,
      receivedAt: Date.now(),
    });
    return {
      outcome: duplicateByObject ? ("duplicate_object" as const) : ("new" as const),
      status,
    };
  },
});

/** Everything an arm of the effect switch may see. Deliberately NOT the Stripe object. */
type EffectArgs = {
  eventId: string;
  eventType: string;
  objectId: string;
  eventCreatedAt?: number;
  money?: Reconciliation | null;
  taxabilityReason?: string;
};

/**
 * THE effect switch. Singular, on purpose: every arm runs inside `receiveAndApply`'s transaction,
 * so "we recorded it" and "we acted on it" can never diverge.
 *
 * EXHAUSTIVE over `HandledEventType`, with no `default`. That is the point of the `never` below:
 * a type added to `HANDLED_EVENT_TYPES` is now a COMPILE error rather than a silently unbooked
 * delivery, and on a money path silence is the expensive failure. (An event type this deployment
 * has never heard of is still ignored, one line above — `classifyEvent` owns that, and must, or a
 * new Stripe type becomes a 500 and a retry storm.)
 */
async function applyEffect(
  ctx: MutationCtx,
  args: EffectArgs,
  facts: BillingEventFacts,
): Promise<"applied" | "ignored"> {
  const classified = classifyEvent(args.eventType);
  if (classified.kind === "ignored") return "ignored";
  switch (classified.type) {
    case "checkout.session.completed":
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return await applyMapping(ctx, args, facts);
    case "invoice.finalized":
    case "invoice.paid":
    case "refund.created":
    case "credit_note.created":
    case "customer_cash_balance_transaction.created":
    case "cash_balance.funds_available":
      return await applyMoney(ctx, args, facts);
    case "invoice.payment_failed":
      // A failed attempt is not a movement in either direction, and `reconcileEvent` agrees —
      // it maps this type to nothing. Recorded as received, never booked.
      return "ignored";
    default: {
      const unreachable: never = classified.type;
      return unreachable;
    }
  }
}

/**
 * The tenantId stamped on a dead letter that belongs to NO tenant.
 *
 * Code-owned, and deliberately not a valid `users` id: it can never collide with a real tenant, so
 * an unattributable Stripe event can never be filed under someone else's name. `deadLetters.listNew`
 * is tenant-scoped, so no tenant ever sees it; the owner-plane `deadLetters.listAll` does, which is
 * the surface that makes an orphaned Stripe customer visible.
 */
export const UNATTRIBUTED_TENANT = "billing:unattributed";

/**
 * Why a delivery was refused. CODES, never prose.
 *
 * `error` is rendered verbatim on the operator screen and lives forever in an `audit_immutable`
 * table, so a message built by interpolating anything off a Stripe object is a PII leak with a
 * long half-life.
 */
const REFUSAL = {
  /** The event names a tenant that no `users` row matches — deleted, or never existed. */
  unknownTenant: "billing_unknown_tenant",
  /** Nothing in the delivery names a tenant and no mapping claims the customer. */
  unattributableCustomer: "billing_unattributable_customer",
  /** This Stripe customer already belongs to a DIFFERENT tenant. */
  customerConflict: "billing_customer_tenant_conflict",
  /** This tenant already maps to a DIFFERENT Stripe customer. */
  tenantConflict: "billing_tenant_customer_conflict",
  /** A mapping event with no `cus_…` — there is nothing to map. */
  noCustomer: "billing_no_customer",
  /** `reconcileEvent` could not read the amount or the currency. Refused, never written as zero. */
  unreconcilable: "billing_unreconcilable_event",
  /** An `invoice.paid` whose payment method could not be determined. NOT booked as a card: the
   *  money may or may not be ours, and an append-only ledger cannot un-say that it is. */
  undeterminedPaymentMethod: "billing_undetermined_payment_method",
} as const;

/**
 * The status a mapping carries between the checkout and the first subscription event.
 *
 * A Checkout Session does NOT carry a subscription status (its own `status` is "complete"), so
 * there is a window in which the mapping exists and the subscription state is genuinely unknown.
 * `subscriptionState()` answers `unknown` for this token — it is never reported as subscribed, and
 * never as a free tier.
 */
const MAPPING_PENDING_STATUS = "pending";

/** All-null facts: what a delivery that carried nothing contributes. */
const NO_FACTS: BillingEventFacts = {
  customerId: null,
  subscriptionId: null,
  clientReferenceId: null,
  metadataTenantId: null,
  subscriptionStatus: null,
  priceId: null,
  trialEndsAt: null,
};

/**
 * Does this tenant id name a `users` row that exists RIGHT NOW?
 *
 * `normalizeId` fails closed on a malformed id and on an id belonging to another table, so a
 * `client_reference_id` a stranger could put on a Checkout Session cannot become a lookup that
 * throws — or, worse, one that hits.
 */
async function tenantExists(ctx: MutationCtx, tenantId: string): Promise<boolean> {
  const id = ctx.db.normalizeId("users", tenantId);
  return id !== null && (await ctx.db.get(id)) !== null;
}

/**
 * Record a refusal: one `deadLetters` row, one audit row, and NOTHING created.
 *
 * REDACT-THEN-WRITE is a step ordering, and here it is enforced by the call shape: this function
 * never sees the Stripe object. It is handed ids that were extracted at the HTTP boundary by
 * `eventFacts`, so there is no object in scope to leak even by accident.
 */
async function refuse(
  ctx: MutationCtx,
  args: { eventId: string; eventType: string; objectId: string },
  facts: BillingEventFacts,
  reason: (typeof REFUSAL)[keyof typeof REFUSAL],
  /**
   * The tenant this delivery was ABOUT, when one was resolved. It goes in the PAYLOAD, never on
   * the row (28.1-11 #9).
   *
   * `deadLetters.listNew` is a `tenantQuery` over `by_tenant_status` and `markResolved` is a
   * `tenantMutation` whose only check is `row.tenantId === ctx.tenantId`, so a refusal filed under
   * the tenant it bills is one THAT CUSTOMER can read — every id in the payload, including (on a
   * customer conflict) a `cus_` the lookup just proved belongs to somebody else — and can mark
   * resolved, which drops it out of the owner's `listAll` (filtered `by_status` on "new")
   * entirely. A billing refusal is Pikar's own money signal; the billed party is not its audience.
   */
  billedTenantId?: string,
): Promise<"ignored"> {
  // Ids and code tokens only (CLAUDE.md §4). `deadLetters` is `audit_immutable`: it is excluded
  // from both the erasure walk and the export walk, so anything personal that lands here outlives
  // every deletion request this deployment can honour. A tenant id is an id, so attribution is
  // kept here rather than traded away with the row's scope.
  const payload = {
    stripeEventId: args.eventId,
    stripeEventType: args.eventType,
    stripeCustomerId: facts.customerId,
    stripeObjectId: args.objectId,
    billedTenantId: billedTenantId ?? null,
  };
  await ctx.db.insert("deadLetters", {
    // ALWAYS unattributed. Not a default a caller can override — the four sites that used to pass
    // a real tenant id are exactly the four that leaked.
    tenantId: UNATTRIBUTED_TENANT,
    correlationId: args.eventId,
    source: "billing",
    payload,
    error: reason,
    status: "new",
    createdAt: Date.now(),
  });
  await ctx.runMutation(internal.audit.log, {
    tenantId: UNATTRIBUTED_TENANT,
    correlationId: args.eventId,
    eventType: "deadletter.written",
    actor: "system",
    payload: { ...payload, source: "billing", reason, status: "new" },
  });
  return "ignored";
}

/**
 * THE MAPPING ARM, shared by `checkout.session.completed` and all three
 * `customer.subscription.*` types — one body rather than two, because the difference between them
 * is entirely in WHICH facts the delivery carried, and that difference already lives in
 * `BillingEventFacts`.
 *
 * ORDER-INDEPENDENT BY CONSTRUCTION. There are three threads back to a tenant and any one of them
 * is enough: the Checkout Session's `client_reference_id`, `metadata.tenantId` (which
 * `startCheckout` puts on the SUBSCRIPTION too, precisely so a subscription event that overtakes
 * its checkout can still be attributed), and an existing mapping row. A handler that required the
 * checkout to land first would break in production the first time Stripe reordered a retry.
 *
 * **NEVER AUTO-PROVISIONS.** There is no `users` insert and no tenant insert on any path here. An
 * unmatched customer stays orphaned and VISIBLE in the dead-letter queue, which is the point:
 * inventing a tenant from a webhook is how a billing system invents users.
 */
async function applyMapping(
  ctx: MutationCtx,
  args: { eventId: string; eventType: string; objectId: string; eventCreatedAt?: number },
  facts: BillingEventFacts,
): Promise<"applied" | "ignored"> {
  const customerId = facts.customerId;
  if (customerId === null) return await refuse(ctx, args, facts, REFUSAL.noCustomer);

  const byCustomer = await ctx.db
    .query("billingCustomers")
    .withIndex("by_customer", (q) => q.eq("stripeCustomerId", customerId))
    .first();

  // The checkout thread first (it is the one WE put there), then the object's own metadata, then
  // an existing mapping. A claim that disagrees with the stored mapping is a conflict below, not a
  // silent re-point.
  const tenantId =
    facts.clientReferenceId ?? facts.metadataTenantId ?? byCustomer?.tenantId ?? null;
  if (tenantId === null) return await refuse(ctx, args, facts, REFUSAL.unattributableCustomer);
  if (!(await tenantExists(ctx, tenantId))) {
    return await refuse(ctx, args, facts, REFUSAL.unknownTenant);
  }

  if (byCustomer && byCustomer.tenantId !== tenantId) {
    return await refuse(ctx, args, facts, REFUSAL.customerConflict, tenantId);
  }
  const byTenant = await ctx.db
    .query("billingCustomers")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .first();
  if (byTenant && byTenant.stripeCustomerId !== customerId) {
    // The FIRST mapping stands. Overwriting it strands a live Stripe customer that nothing in this
    // database points at any more — and the conflict is a fact somebody has to look at, so it is
    // recorded rather than absorbed.
    return await refuse(ctx, args, facts, REFUSAL.tenantConflict, tenantId);
  }

  const existing = byCustomer ?? byTenant;
  const now = Date.now();
  // Only a delivery that CARRIED a status may move one, and only if it is not older than the
  // delivery that set the current one. Stripe does not guarantee order, so a re-delivered
  // `updated` can arrive after a `deleted`; applying it would hand a canceled customer their
  // access back. `event.created` is the only ordering Stripe gives us.
  const statusAt = args.eventCreatedAt ?? now;
  const statusIsFresh =
    facts.subscriptionStatus !== null &&
    statusAt >= (existing?.statusAt ?? Number.NEGATIVE_INFINITY);

  const moved = {
    ...(facts.subscriptionId !== null ? { subscriptionId: facts.subscriptionId } : {}),
    ...(facts.priceId !== null ? { priceId: facts.priceId } : {}),
    ...(facts.trialEndsAt !== null ? { trialEndsAt: facts.trialEndsAt } : {}),
    ...(statusIsFresh ? { status: facts.subscriptionStatus as string, statusAt } : {}),
  };

  if (existing) {
    await ctx.db.patch(existing._id, { ...moved, updatedAt: now });
    return "applied";
  }
  await ctx.db.insert("billingCustomers", {
    tenantId,
    stripeCustomerId: customerId,
    // Never a fabricated state: `pending` only until a subscription event says otherwise, and
    // `subscriptionState()` reports it as `unknown`.
    status: MAPPING_PENDING_STATUS,
    ...moved,
    createdAt: now,
    updatedAt: now,
  });
  return "applied";
}

/**
 * THE MONEY ARM — every invoice, refund and cash-balance signal, booked into OUR ledger.
 *
 * IT ONLY WRITES. `reconcileEvent` (`@pikar/billing`, pure, plan 03) already decided which phase
 * each signal is and what it is worth; nothing here re-derives either. In particular the central
 * law is NOT restated in this file, so it cannot drift from the place that owns it:
 *
 *   `invoice.paid` is not cash in hand. Bank-transfer funds land in the customer CASH BALANCE and
 *   are collected only on `customer_cash_balance_transaction.created` with
 *   `type=applied_to_payment`. `funded` is arrival (`reserved`); `funding_reversed` takes it back.
 *
 * ORDER-INDEPENDENT BY CONSTRUCTION, like the mapping arm above: each delivery is booked from its
 * own contents alone, there is no state machine and no arm reads what came before it. A `funded`
 * arriving after its `applied_to_payment` produces the same final ledger as the other order.
 *
 * TENANT RESOLUTION IS THE MAPPING ROW AND NOTHING ELSE. Unlike the mapping arm, a money event has
 * no `client_reference_id` thread to fall back on, and guessing one would book a stranger's payment
 * to a tenant. No mapping means the refusal path and NO ledger row: an unattributable payment is
 * visible in the dead-letter queue, which is recoverable, whereas a misattributed one is written
 * into an append-only table that cannot take it back.
 */
async function applyMoney(
  ctx: MutationCtx,
  args: EffectArgs,
  facts: BillingEventFacts,
): Promise<"applied" | "ignored"> {
  const money = args.money;
  // Absent = a caller that predates 28.1-06 (the 28.1-01 tests). Null = a REFUSAL from
  // `reconcileEvent`, which is a fact somebody has to look at rather than a quiet nothing.
  if (money === undefined) return "ignored";
  if (money === null) return await refuse(ctx, args, facts, REFUSAL.unreconcilable);
  if (money.movements.length === 0 && money.observations.length === 0) return "ignored";

  const customerId = facts.customerId;
  if (customerId === null) return await refuse(ctx, args, facts, REFUSAL.noCustomer);
  const mapping = await ctx.db
    .query("billingCustomers")
    .withIndex("by_customer", (q) => q.eq("stripeCustomerId", customerId))
    .first();
  if (!mapping) return await refuse(ctx, args, facts, REFUSAL.unattributableCustomer);
  const tenantId = mapping.tenantId;
  // The mapping is deleted by a tenant erasure, so a surviving row pointing at a vanished tenant
  // should be impossible — but this row is about to become permanent, so it is checked anyway.
  if (!(await tenantExists(ctx, tenantId))) {
    return await refuse(ctx, args, facts, REFUSAL.unknownTenant, tenantId);
  }

  // `event.created`, not `Date.now()`: the ledger records when the money moved, not when the
  // delivery reached us. A retry days later must not re-date the movement.
  const at = args.eventCreatedAt ?? Date.now();
  for (const movement of money.movements) {
    await recordBillingMovement(ctx, {
      tenantId,
      phase: movement.phase,
      amountMinor: movement.amount.minor,
      currency: movement.amount.currency,
      correlationId: movement.correlationId,
      kind: movement.kind,
      stripeObjectId: movement.stripeObjectId,
      ...(args.taxabilityReason === undefined ? {} : { taxabilityReason: args.taxabilityReason }),
      createdAt: at,
    });
  }

  let undetermined = false;
  for (const observation of money.observations) {
    if (observation.kind === "unapplied-funds") {
      await observeUnapplied(ctx, tenantId, observation, at);
    } else if (observation.kind === "payment-method-undetermined") {
      undetermined = true;
    }
    // `awaiting-cash-application` is the NORMAL bank-transfer path — the invoice is paid as far as
    // Stripe is concerned and the cash has not been applied to us yet. Nothing to record: the
    // `reserved`/`actual` rows arrive on the cash-balance rail, in their own time and any order.
  }
  // Refused LAST, so any unapplied observation on the same delivery is still recorded. This is not
  // a Stripe failure; it is us declining to guess, and it must be visible rather than silent.
  if (undetermined) {
    return await refuse(ctx, args, facts, REFUSAL.undeterminedPaymentMethod, tenantId);
  }
  return "applied";
}

/**
 * Money we HOLD that is attached to nothing, re-observed rather than re-inserted.
 *
 * `cash_balance.funds_available` fires whenever the leftover balance CHANGES, and a CashBalance
 * object carries no `id` — so `billingStripeEvents`' by-object dedupe cannot see two of them as the
 * same thing, and a plain insert would report one pile of money two, three, four times on a screen
 * whose whole job is to say how much we hold.
 *
 * THE AMOUNT MOVES, `observedAt` DOES NOT — while the hold lasts. Stripe attempts to RETURN
 * unreconciled funds at 75 days and SWEEPS them at 90; restarting that clock on every notification
 * would hide exactly the row that is about to be taken away. Money held again AFTER the balance
 * reached zero is a different hold on a fresh clock, and that one does restart.
 *
 * A ZERO CLEARS THE HOLD (28.1-11 #8) and the row stays, at zero. Deleting it would take `amountAt`
 * with it, and Stripe redelivers for days: the pre-clear event arriving afterwards would re-insert
 * the old figure as a brand-new hold that no later delivery is going to clear again. Readers
 * exclude zeros, so nothing renders.
 */
async function observeUnapplied(
  ctx: MutationCtx,
  tenantId: string,
  observation: Extract<BillingObservation, { kind: "unapplied-funds" }>,
  observedAt: number,
): Promise<void> {
  const existing = await ctx.db
    .query("billingUnapplied")
    .withIndex("by_tenant_object_currency", (q) =>
      q
        .eq("tenantId", tenantId)
        .eq("stripeObjectId", observation.stripeObjectId)
        .eq("currency", observation.amount.currency),
    )
    .first();
  if (!existing) {
    // A zero with no row is the steady state of every customer who has never left funds behind.
    if (observation.amount.minor === 0) return;
    await ctx.db.insert("billingUnapplied", {
      tenantId,
      stripeObjectId: observation.stripeObjectId,
      amountMinor: observation.amount.minor,
      currency: observation.amount.currency,
      observedAt,
      amountAt: observedAt,
    });
    return;
  }
  // OUT OF ORDER (28.1-11 #13). Stripe does not guarantee delivery order, so an older `created`
  // reaching us second must not overwrite a newer figure or re-open a cleared hold. `<=` also
  // makes a plain redelivery a no-op, which a CashBalance cannot get from the by-object dedupe
  // because it carries no `id`.
  if (observedAt <= existing.amountAt) return;
  await ctx.db.patch(existing._id, {
    amountMinor: observation.amount.minor,
    amountAt: observedAt,
    // Reopening a cleared row is a NEW hold, so its clock starts here. Carrying the old date
    // forward would render fresh money as already returned or swept.
    ...(existing.amountMinor === 0 ? { observedAt } : {}),
  });
}
