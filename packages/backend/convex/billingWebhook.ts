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
import { classifyEvent } from "@pikar/billing/events";
import {
  parseStripeSignature,
  SIGNATURE_TOLERANCE_S,
  timingSafeEqualHex,
} from "@pikar/billing/signature";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
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
    const duplicateByObject =
      args.objectId === ""
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

/**
 * THE effect switch. Singular, on purpose: later plans add their arms HERE, inside
 * `receiveAndApply`'s transaction, so "we recorded it" and "we acted on it" can never diverge.
 *
 * 28.1-05 filled the first four arms. The invoice / refund / cash-balance arms are still empty and
 * still return `ignored` rather than a flattering `applied` — 28.1-06 wires the `billingEvents`
 * book of record.
 */
async function applyEffect(
  ctx: MutationCtx,
  args: { eventId: string; eventType: string; objectId: string; eventCreatedAt?: number },
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
    default:
      // invoice.*, charge.refunded, credit_note.created and both cash-balance types — 28.1-06.
      return "ignored";
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
  tenantId: string = UNATTRIBUTED_TENANT,
): Promise<"ignored"> {
  // Ids and code tokens only (CLAUDE.md §4). `deadLetters` is `audit_immutable`: it is excluded
  // from both the erasure walk and the export walk, so anything personal that lands here outlives
  // every deletion request this deployment can honour.
  const payload = {
    stripeEventId: args.eventId,
    stripeEventType: args.eventType,
    stripeCustomerId: facts.customerId,
    stripeObjectId: args.objectId,
  };
  await ctx.db.insert("deadLetters", {
    tenantId,
    correlationId: args.eventId,
    source: "billing",
    payload,
    error: reason,
    status: "new",
    createdAt: Date.now(),
  });
  await ctx.runMutation(internal.audit.log, {
    tenantId,
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
