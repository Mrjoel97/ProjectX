// GOVN-01 — the owner identity surface.
//
// The AUTHORIZATION primitive itself (`requireOwner`/`ownerQuery`/`ownerMutation`) lives in
// `lib/functions.ts` beside the tenant wrappers, because tenancy and ownership must derive
// from one identity resolution. This module holds the two things that are not wrappers:
// a non-disclosing viewer for presentation, and the operator-only grant.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

/**
 * Does the CALLER own this deployment? Returns one boolean and nothing else.
 *
 * Deliberately a `tenantQuery`, not an `ownerQuery`: a non-owner has to be able to call this
 * to learn it should NOT mount the admin surface, and an `ownerQuery` would throw at exactly
 * the caller that needs the answer. That is safe because the boolean is the whole payload —
 * it discloses no identity, no profile field, and no admin data.
 *
 * This is PRESENTATION support, never the trust boundary. Hiding a control is cosmetic; the
 * server-side owner wrappers on the protected endpoints are what actually stop a non-owner.
 */
export const viewer = tenantQuery({
  args: {},
  handler: async (ctx) => {
    // An orphan identity (valid session, row since deleted) reads null here and is a
    // non-owner — same fail-closed answer as an explicit `owner: false`.
    const user = await ctx.db.get(ctx.userId);
    return { isOwner: user?.owner === true };
  },
});

/**
 * Grant owner to ONE exact user row. Operator-only, run by hand:
 *
 *   npx convex run owner:bootstrapOwner '{"userId":"<users._id>"}'
 *
 * `internalMutation`, so it is not client-callable at all — there is no browser path to
 * self-promotion. It takes an exact `users._id` and never selects a row itself: no
 * first-user rule, no email allowlist, no registration order, no env fallback. Each of
 * those would let the wrong account become owner through data the owner does not control.
 *
 * Idempotent by design so re-running it is safe and so the live checkpoint can PROVE the
 * transition happened exactly once (`changed: true` then `changed: false`).
 */
export const bootstrapOwner = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    // Fail loudly rather than silently doing nothing: a typo'd id must not look like success.
    if (!user) throw new Error("NO_SUCH_USER");

    if (user.owner === true) return { changed: false, userId: args.userId };

    await ctx.db.patch(args.userId, { owner: true });

    // One audit event, on the transition only. CLAUDE.md §4: refs and flags ONLY — the key
    // set here is exactly `owner,userId`. No email, name, subject, session or token; the
    // whole point of a durable owner grant is that it never becomes a PII honeypot.
    // Deterministic correlationId so a duplicate grant for one user is greppable.
    await ctx.runMutation(internal.audit.log, {
      tenantId: String(args.userId),
      correlationId: `owner-grant:${args.userId}`,
      eventType: "owner.granted",
      actor: "operator",
      payload: { owner: true, userId: args.userId },
    });

    return { changed: true, userId: args.userId };
  },
});
