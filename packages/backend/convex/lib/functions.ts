// THE tenant-scoping linchpin. This is the ONLY module permitted to import the
// raw `query`/`mutation` builders from _generated/server (enforced by biome
// noRestrictedImports + the importGuard static test). Every tenant-owned read
// and write MUST go through tenantQuery/tenantMutation so `tenantId` is injected
// from the authenticated identity and can never be forgotten or spoofed.

import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
// This is the ONLY sanctioned raw-builder import site (biome noRestrictedImports
// is turned off for this file via an override in biome.json).
import { action, mutation, query } from "../_generated/server";

/**
 * Derive the stable per-user tenant id from a Convex Auth subject.
 * `identity.subject` is `<userId>|<sessionId>` — we take the userId segment so a
 * given user gets the SAME tenantId across login sessions (a new session must not
 * mint a new tenant). A subject with no `|` returns unchanged (shape may vary by
 * provider); only the first segment is ever the userId, so extra pipes are ignored.
 */
export function stableTenant(subject: string): string {
  // split() always yields ≥1 element, so [0] is never undefined at runtime; the `?? subject`
  // satisfies noUncheckedIndexedAccess and is a safe no-op fallback.
  return subject.split("|")[0] ?? subject;
}

/**
 * Resolve the tenant scope from the authenticated identity. Fails closed:
 * an unauthenticated call throws UNAUTHENTICATED before any handler runs.
 */
async function requireTenant(ctx: { auth: { getUserIdentity: () => Promise<unknown> } }) {
  const identity = (await ctx.auth.getUserIdentity()) as { subject?: string } | null;
  if (!identity) throw new Error("UNAUTHENTICATED");
  return stableTenant(identity.subject as string);
}

/** Tenant-scoped query builder. ctx gains `tenantId`. */
export const tenantQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ tenantId: await requireTenant(ctx) })),
);

/** Tenant-scoped mutation builder. ctx gains `tenantId`. */
export const tenantMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ tenantId: await requireTenant(ctx) })),
);

/**
 * Tenant-scoped action builder. ctx gains `tenantId`. The agent runs in an
 * action; the cockpit's public agent action is its sole consumer, so raw
 * `action` stays import-banned outside this file (CLAUDE.md §2).
 */
export const tenantAction = customAction(
  action,
  customCtx(async (ctx) => ({ tenantId: await requireTenant(ctx) })),
);
