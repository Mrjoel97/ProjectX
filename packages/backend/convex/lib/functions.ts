// THE tenant-scoping linchpin. This is the ONLY module permitted to import the
// raw `query`/`mutation` builders from _generated/server (enforced by biome
// noRestrictedImports + the importGuard static test). Every tenant-owned read
// and write MUST go through tenantQuery/tenantMutation so `tenantId` is injected
// from the authenticated identity and can never be forgotten or spoofed.
//
// GOVN-01 adds the OWNER siblings (requireOwner/ownerQuery/ownerMutation) here rather
// than in their own module: authorization and tenancy must derive from ONE identity
// resolution, or the two can drift and disagree about who the caller is.

import { getAuthUserId } from "@convex-dev/auth/server";
import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { internal } from "../_generated/api";
// This is the ONLY sanctioned raw-builder import site (biome noRestrictedImports
// is turned off for this file via an override in biome.json).
import {
  type ActionCtx,
  action,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "../_generated/server";

/**
 * Resolve the caller's scope from the authenticated identity. Fails closed:
 * an unauthenticated call throws UNAUTHENTICATED before any handler runs.
 *
 * `getAuthUserId` is the OFFICIAL adapter for the pinned @convex-dev/auth@0.0.94 and is
 * the single source of truth for identity here. It replaced a hand-written
 * `stableTenant(subject)` parser that split `<userId>|<sessionId>` itself — the installed
 * helper does exactly the same split, so this is behaviour-preserving (no tenant is
 * re-keyed), but it is now the auth package's job to stay correct across a version bump
 * instead of ours. Do NOT authorize on `identity.tokenIdentifier` or the whole
 * `identity.subject`: both carry the SESSION suffix, so they change on every login and
 * would silently re-scope a returning user.
 *
 * `tenantId` stays a plain string for backwards compatibility — every existing table
 * stores it as `v.string()`, and it is already exactly this userId segment.
 */
async function requireScope(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("UNAUTHENTICATED");
  return { userId, tenantId: String(userId) };
}

/**
 * The owner authorization primitive (GOVN-01). Reads the caller's exact `users` row and
 * accepts ONLY `owner === true`; an absent field, an explicit `false`, an orphan identity
 * whose row no longer exists, and an unauthenticated caller all fail closed.
 *
 * This is the TRUST BOUNDARY. Hiding a control in the UI is presentation only — every
 * admin-ish public function must start here.
 *
 * 27-09 CORRECTED THIS COMMENT. It used to end "there is deliberately no `ownerAction`: an action
 * has no `ctx.db`, so it cannot read the row this check depends on." True about `ctx.db`, wrong as
 * a conclusion — and the gap it left is what made the pack candidate preview reach for an ad-hoc
 * check in one handler. An action reads the row through a query instead; see `requireOwnerAction`.
 */
export async function requireOwner(ctx: QueryCtx | MutationCtx) {
  const scope = await requireScope(ctx);
  const user = await ctx.db.get(scope.userId);
  // Exact `true` only. `!user?.owner` would also accept a row whose owner is a truthy
  // non-boolean, and absence must mean false so the widening needed no migration.
  if (user?.owner !== true) throw new Error("OWNER_REQUIRED");
  return scope;
}

/** Tenant-scoped query builder. ctx gains `userId` + `tenantId`. */
export const tenantQuery = customQuery(query, customCtx(requireScope));

/** Tenant-scoped mutation builder. ctx gains `userId` + `tenantId`. */
export const tenantMutation = customMutation(mutation, customCtx(requireScope));

/**
 * Tenant-scoped action builder. ctx gains `userId` + `tenantId`. The agent runs in an
 * action; the cockpit's public agent action is its sole consumer, so raw
 * `action` stays import-banned outside this file (CLAUDE.md §2). No DB read happens
 * here — an action has no `ctx.db`.
 */
export const tenantAction = customAction(action, customCtx(requireScope));

/**
 * The ACTION half of the owner primitive (27-09). Identical rule to `requireOwner` — exact
 * `owner === true`, everything else fails closed — but the row read happens in
 * `owner.ownsDeployment`, an `internalQuery`, because an action has no `ctx.db`.
 *
 * Exported as a FUNCTION as well as a builder because the first real consumer is CONDITIONAL:
 * `cockpit.startWorkflowPack` is a `tenantAction` every user calls, and only the optional
 * candidate-preview pin is owner-gated. Wrapping the whole action would lock every user out of
 * running a pack at all. A whole-action owner surface should use `ownerAction` below.
 */
export async function requireOwnerAction(ctx: ActionCtx) {
  const scope = await requireScope(ctx);
  const { isOwner } = await ctx.runQuery(internal.owner.ownsDeployment, { userId: scope.userId });
  if (!isOwner) throw new Error("OWNER_REQUIRED");
  return scope;
}

/** Owner-only query builder. Rejects a non-owner BEFORE the handler reads anything. */
export const ownerQuery = customQuery(query, customCtx(requireOwner));

/** Owner-only mutation builder. Rejects a non-owner BEFORE the handler writes anything. */
export const ownerMutation = customMutation(mutation, customCtx(requireOwner));

/**
 * Owner-only action builder. Rejects a non-owner BEFORE the handler runs anything.
 *
 * It exists for SYMMETRY with `ownerQuery`/`ownerMutation`, and the asymmetry was not free: having
 * two of the three is exactly why the pack preview had nowhere to put its check. A future
 * owner-only action must use this rather than re-deriving the rule in a handler.
 */
export const ownerAction = customAction(action, customCtx(requireOwnerAction));
