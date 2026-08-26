// GOVN-01 — the owner identity surface.
//
// The AUTHORIZATION primitive itself (`requireOwner`/`ownerQuery`/`ownerMutation`) lives in
// `lib/functions.ts` beside the tenant wrappers, because tenancy and ownership must derive
// from one identity resolution. This module holds the two things that are not wrappers:
// a non-disclosing viewer for presentation, and the operator-only grant.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
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
 * The owner check an ACTION can make (27-09). Actions have no `ctx.db`, which is why
 * `lib/functions.ts` carried "there is deliberately no `ownerAction`" until this shipped — the
 * resolution is not to weaken the check but to move the ROW READ into a query the action calls.
 *
 * Same rule as `requireOwner`, byte for byte: exact `true` only, so an absent field, an explicit
 * `false` and an orphan identity whose row no longer exists all read as NOT owner. It takes an
 * exact `users._id` and never resolves an identity itself — the caller's wrapper does that once,
 * from the authenticated session, so this cannot be handed a userId a model chose.
 *
 * `internalQuery`, so it is not client-callable: the browser-facing boolean is `viewer`, which is
 * presentation support and says so. This one is the trust boundary's read half.
 */
export const ownsDeployment = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => ({ isOwner: (await ctx.db.get(userId))?.owner === true }),
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
/**
 * Look up ONE user id by email. READ-ONLY, `internalQuery`, and it grants nothing.
 *
 * It exists for local provisioning (`apps/web/e2e/provision-owner.setup.ts`): the browser evidence
 * plane needs a signed-in OWNER, `bootstrapOwner` takes an exact `users._id` by design, and there
 * was no way to turn the address you just signed up with into that id without opening the dashboard
 * by hand.
 *
 * IT DOES NOT WEAKEN `bootstrapOwner`'s RULE, and the distinction is the whole point. That mutation
 * refuses to SELECT a row — no first-user rule, no email allowlist, no registration order — because
 * selecting is how the wrong account becomes owner through data the owner does not control. This
 * only READS an id and hands it back to a human running a CLI; the grant is still a separate,
 * deliberate call naming an exact row. Do not call this from `bootstrapOwner`.
 */
export const findUserIdByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    return user === null ? null : { userId: user._id, owner: user.owner === true };
  },
});

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

/**
 * Revoke owner from ONE exact user row — the inverse `bootstrapOwner` shipped without.
 *
 *   npx convex run owner:revokeOwner '{"userId":"<users._id>"}'
 *
 * WHY THIS EXISTS. A grant with no inverse makes the NON-OWNER state unobservable: once an
 * account is promoted, nothing in the deployment can ever demonstrate the boundary from it
 * again. That cost lands on the only evidence that proves the boundary holds — the E2E run
 * and the owner UAT — and it lands PERMANENTLY, because this deployment has exactly one
 * loggable human account plus one seeded E2E identity. Without a revoke, `finance.spec.ts`
 * is a single-use test: run it once and its own non-owner assertions can never pass again.
 *
 * Same trust level as the grant, deliberately: `internalMutation`, so there is no
 * client-callable path — a browser cannot self-promote, and equally cannot demote anyone
 * else. It takes an exact `users._id` and never selects a row itself.
 *
 * Writes `owner: false` rather than deleting the field. `viewer` already treats absent and
 * explicit-false identically, so this is not a behaviour difference — it is a readable one:
 * an explicit false is a row that was DECIDED about, which is what an operator wants to see
 * when they are working out who holds authority.
 *
 * ponytail: no last-owner guard. Revoking the final owner leaves owner endpoints unreachable
 * until someone re-runs `bootstrapOwner` — recoverable by the operation directly above this
 * one, by the same operator, at the same terminal. A guard would need a scan of `users` for
 * `owner: true` with no index to serve it, to prevent a state that un-does itself in one
 * command. Add it if a second operator ever shares the deployment.
 */
export const revokeOwner = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    // Same loud failure as the grant: a typo'd id must not read as a successful revoke.
    if (!user) throw new Error("NO_SUCH_USER");

    if (user.owner !== true) return { changed: false, userId: args.userId };

    await ctx.db.patch(args.userId, { owner: false });

    // One audit event, on the transition only — mirroring the grant, including the §4 key
    // set (`owner,userId` and nothing else). A de-escalation is at least as worth recording
    // as an escalation: it is how you reconstruct who held authority at a given time.
    await ctx.runMutation(internal.audit.log, {
      tenantId: String(args.userId),
      correlationId: `owner-revoke:${args.userId}`,
      eventType: "owner.revoked",
      actor: "operator",
      payload: { owner: false, userId: args.userId },
    });

    return { changed: true, userId: args.userId };
  },
});
