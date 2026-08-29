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
import { classifyEvent } from "@pikar/billing/events";
import {
  parseStripeSignature,
  SIGNATURE_TOLERANCE_S,
  timingSafeEqualHex,
} from "@pikar/billing/signature";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { hmacHex } from "./gmailAuth";

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

    const status = duplicateByObject ? ("ignored" as const) : applyEffect(args.eventType);
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
 * ponytail: NO ARM HAS AN EFFECT YET — 28.1-01 ships the receiver, not the effects. Both branches
 * below return `ignored`, and that is stated rather than disguised: a handled type is currently
 * indistinguishable from an unhandled one in the stored row, so no test can tell them apart and
 * none pretends to. Returning `applied` for a switch that does nothing would put a lie in the only
 * record this subsystem keeps. Upgrade path: 28.1-06 wires the `billingEvents` book of record and
 * the handled arms start returning `applied`.
 */
function applyEffect(eventType: string): "applied" | "ignored" {
  const classified = classifyEvent(eventType);
  if (classified.kind === "ignored") return "ignored";
  // switch (classified.type) { … } — 28.1-06 onwards.
  return "ignored";
}
