// Microsoft OAuth token store + connect-URL builder. ONE grant for Calendar AND Mail (ADR-018).
//
// NOT "use node": these are DB helpers (internalQuery/internalMutation) plus two client-safe
// tenantQueries, mirroring gmailAuth.ts. The code-for-token exchange lives in http.ts (a server
// route), and any Graph "use node" ACTION reaches this module via ctx.runQuery/runMutation
// (01-07 rule: a "use node" module holds only actions).
//
// The tokens are the crown jewels (CLAUDE.md §4): `refreshToken`/`accessToken` are read ONLY by
// internal functions, NEVER returned to a client query, and NEVER placed in an audit payload.
// `microsoftStatus` exposes booleans and timestamps only — never the `scope` string, which is a
// capability inventory, exactly as gmailAuth.ts's `driveReady` derives a boolean instead.
//
// WHY THIS MODULE IS NOT NAMED FOR CALENDAR: ADR-018. Plans 17-06 and 25-06 each specified their
// own Microsoft OAuth for the same account. One provider, one connection, one consent, one row.
// Phase 25-06 adds the mail ADAPTER on top of this; it must not mint a second grant.
import { MICROSOFT_SCOPES, microsoftCalendarReady, microsoftMailReady } from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { hmacHex } from "./gmailAuth";
import { tenantAction, tenantQuery } from "./lib/functions";

// The tenant-INDEPENDENT `common` endpoint. This is the choice that lets BOTH a personal Microsoft
// account and a work/school account through the same flow; a tenant-specific authority would admit
// only one organisation, and `organizations` would lock out personal accounts entirely.
const MICROSOFT_OAUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
export const MICROSOFT_AUTH_ENDPOINT = `${MICROSOFT_OAUTH_BASE}/authorize`;
export const MICROSOFT_TOKEN_ENDPOINT = `${MICROSOFT_OAUTH_BASE}/token`;

/**
 * The provider discriminator mixed into the signed state.
 *
 * WITHOUT THIS, a Google `state` is a valid Microsoft `state` whenever the two OAuth client secrets
 * are ever equal or rotated to the same value — and more practically, it keeps the two callbacks
 * from silently accepting each other's round-trips during a misconfiguration. The signature covers
 * `microsoft:<tenantId>`, so a Google-issued state fails signature verification here even though
 * its wire format is identical.
 */
const STATE_PROVIDER = "microsoft";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Microsoft OAuth env not configured: ${name}`);
  return val;
}

function microsoftOAuthConfigured(): boolean {
  return Boolean(
    process.env.MICROSOFT_OAUTH_CLIENT_ID &&
      process.env.MICROSOFT_OAUTH_CLIENT_SECRET &&
      process.env.MICROSOFT_CALENDAR_REDIRECT_URI,
  );
}

/**
 * Length-checked, byte-XOR comparison. `crypto.subtle` offers no timingSafeEqual and the Convex
 * default runtime is not Node, so the Node primitive is unavailable here.
 *
 * ponytail: the early length return leaks the LENGTH of the expected signature, which is a fixed
 * 64 hex chars for HMAC-SHA-256 and therefore public knowledge — it is not a secret to leak. The
 * loop below is what must not short-circuit, and does not.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Microsoft authorize URL for the v2 auth-code flow.
 *
 * `prompt=consent` is deliberate and load-bearing, for the same class of reason Google's is: when
 * this grant is ever WIDENED, Microsoft will otherwise happily return the user's EXISTING narrower
 * grant without showing a consent screen, and the tenant stays silently un-upgraded while the
 * product believes they reconnected. Forcing the prompt makes a reconnect actually re-consent.
 */
export async function buildMicrosoftAuthorizeUrl(tenantId: string): Promise<string> {
  const secret = requireEnv("MICROSOFT_OAUTH_CLIENT_SECRET");
  const params = new URLSearchParams({
    client_id: requireEnv("MICROSOFT_OAUTH_CLIENT_ID"),
    redirect_uri: requireEnv("MICROSOFT_CALENDAR_REDIRECT_URI"),
    response_type: "code",
    response_mode: "query",
    prompt: "consent",
    scope: MICROSOFT_SCOPES,
    state: `${tenantId}.${await hmacHex(`${STATE_PROVIDER}:${tenantId}`, secret)}`,
  });
  return `${MICROSOFT_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Verify a callback `state`; returns the bound tenantId, or null if tampered/malformed/foreign. */
export async function verifyMicrosoftState(state: string): Promise<string | null> {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const tenantId = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = await hmacHex(
    `${STATE_PROVIDER}:${tenantId}`,
    requireEnv("MICROSOFT_OAUTH_CLIENT_SECRET"),
  );
  return constantTimeEquals(sig, expected) ? tenantId : null;
}

// ── Token store (internal-only) ──────────────────────────────────────────────────

/**
 * Store the tenant's tokens after a consent callback. REPLACES any existing row, so a reconnect
 * starts a fresh grant rather than inheriting a stale one — and so a WIDENED grant overwrites the
 * narrower `scope` string that would otherwise keep `mailReady` false forever.
 *
 * The table keeps its shipped name `microsoftCalendarTokens` (landed by 17-05) even though it now
 * holds the union grant. THIS IS THE ESTABLISHED PRECEDENT, not an oversight: `gmailTokens` holds
 * one Google grant covering mail AND calendar AND drive under its original name, because renaming
 * a Convex table is a migration for cosmetic gain (see gmailAuth.ts:54-56).
 */
export const store = internalMutation({
  args: {
    tenantId: v.string(),
    refreshToken: v.string(),
    accessToken: v.string(),
    expiresAt: v.number(),
    scope: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("microsoftCalendarTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("microsoftCalendarTokens", { ...args, updatedAt: Date.now() });

    // A fresh consent IS the reconnect the warning asked for. Retire ONLY this provider's rows:
    // a Microsoft reconnect must never clear a `gmail_reconnect` banner, or the user loses the
    // warning about a Google connection that is still genuinely broken.
    for (const n of await ctx.db
      .query("notifications")
      .withIndex("by_tenant_read", (q) => q.eq("tenantId", args.tenantId).eq("read", false))
      .collect()) {
      if (n.kind === "microsoft_calendar_reconnect") await ctx.db.patch(n._id, { read: true });
    }
  },
});

/** Drop the tenant's grant row. Internal-only — the token never leaves this module. */
export const deleteTokens = internalMutation({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const row = await ctx.db
      .query("microsoftCalendarTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return { deleted: !!row };
  },
});

/** Read the full token row for a Graph call (system context). Internal-only. */
export const getTokens = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    ctx.db
      .query("microsoftCalendarTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique(),
});

/** Capability-only grant check for the cockpit router. Never returns token material. */
export const hasMicrosoftConnection = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<boolean> =>
    (await ctx.db
      .query("microsoftCalendarTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique()) !== null,
});

/**
 * The granted scope string, and nothing else. Never returns token material — same posture as
 * `hasMicrosoftConnection` above, and the reason it is a separate query rather than `getTokens`:
 * `graph.send` needs to know whether Mail.Send was granted, and handing a send adapter the refresh
 * token to answer a capability question is how a credential ends up somewhere it did not need to be.
 *
 * `null` means no connection at all, which the caller must distinguish from "connected but
 * Calendar-only" (ADR-018: one grant serves both, and 17-05-era grants predate Mail.Send).
 */
export const grantedScope = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }): Promise<string | null> =>
    (
      await ctx.db
        .query("microsoftCalendarTokens")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .unique()
    )?.scope ?? null,
});

/**
 * Persist a freshly-refreshed access token.
 *
 * `refreshToken` is OPTIONAL here for a reason specific to this provider: **Microsoft rotates
 * refresh tokens**, returning a new one on many refreshes. Google does not. Dropping a rotated
 * token would leave the stored one dead and the connection unrecoverable without re-consent, so
 * the caller passes it through whenever the token response carried one.
 */
export const updateAccess = internalMutation({
  args: {
    tenantId: v.string(),
    accessToken: v.string(),
    expiresAt: v.number(),
    refreshToken: v.optional(v.string()),
  },
  handler: async (ctx, { tenantId, accessToken, expiresAt, refreshToken }) => {
    const row = await ctx.db
      .query("microsoftCalendarTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      accessToken,
      expiresAt,
      updatedAt: Date.now(),
      ...(refreshToken ? { refreshToken } : {}),
    });
  },
});

// ── Client-safe surfaces (tenant-scoped; never leak a token or the scope string) ────

/**
 * Connected? + expiry + per-half readiness. Never the tokens, never the raw `scope`.
 *
 * `calendarReady`/`mailReady` are DERIVED BOOLEANS for the same reason `driveReady` is in
 * gmailAuth.ts: `connected` alone cannot distinguish a grant taken before a widening from a
 * current one, and the two are identical from the client. A mail control that trusts `connected`
 * on a calendar-only grant walks the user into a 403 instead of into reconnect.
 */
export const microsoftStatus = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("microsoftCalendarTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    return {
      connected: !!row,
      expiresAt: row?.expiresAt ?? null,
      calendarReady: microsoftCalendarReady(row?.scope ?? ""),
      mailReady: microsoftMailReady(row?.scope ?? ""),
    };
  },
});

/**
 * Signed connect URL for the authenticated tenant (state binds this identity).
 *
 * Missing deployment configuration is an operational state, not a client-query failure: return a
 * bounded result so the consent page can explain that Microsoft connection is unavailable instead
 * of crashing while React subscribes. `buildMicrosoftAuthorizeUrl` stays strict so the callback and
 * token-exchange code can never proceed with partial OAuth configuration.
 */
export const microsoftConnectUrl = tenantQuery({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean; url: string | null }> => {
    if (!microsoftOAuthConfigured()) return { configured: false, url: null };
    return { configured: true, url: await buildMicrosoftAuthorizeUrl(ctx.tenantId) };
  },
});

/**
 * Disconnect: delete the local grant row.
 *
 * **THIS IS NOT PARITY WITH `disconnectGoogle`, AND MUST NOT BE DESCRIBED AS IF IT WERE.** Google
 * exposes a revocation endpoint that kills the grant at the provider; the Microsoft identity
 * platform v2 flow used here has no equivalent endpoint for a delegated grant. Removing the
 * application's consent is a separate action the user takes in Microsoft My Apps (personal) or
 * Entra (work/school).
 *
 * So this deletes the crown jewels from our side — which is the half we control and the half that
 * matters for data-at-rest — and the UI copy says plainly that the consent entry remains on the
 * user's Microsoft account until they remove it there. GOVN-03 inherits this limitation and must
 * state it rather than imply a revocation we do not perform. Inventing a revoke call against a
 * an endpoint we cannot reach would be worse than the honest gap: it would report success for
 * nothing.
 *
 * PRECISION (verified 2026-08-16 — the earlier wording here said the endpoint does not exist, which
 * is wrong and would mislead the next reader into thinking this is unfixable). Two mechanisms DO
 * exist; neither is usable by a user-consented delegated app revoking its OWN grant:
 *   1. `DELETE /oauth2PermissionGrants/{id}` revokes exactly this app's grant — but requires
 *      `DelegatedPermissionGrant.ReadWrite.All` / `AppRoleAssignment.ReadWrite.All`, admin-consent
 *      application permissions. Holding tenant-wide grant-deletion rights just to disconnect
 *      ourselves would be a far larger privilege than the mailbox scopes we actually need.
 *   2. `POST /me/revokeSignInSessions` invalidates the user's refresh tokens — for EVERY
 *      application, not just ours. Disconnecting Pikar would sign the user out of Outlook, Teams
 *      and the rest, minutes later and without warning. That is user-hostile, not compliant.
 * So the gap is a deliberate refusal to over-privilege, not an absence. The product's job is to say
 * so and hand the user the real control (My Apps / account.microsoft.com), which the privacy policy
 * and the erasure card both now do.
 *
 * `tenantAction`, not an arg-supplied tenantId: the scope comes from the caller's identity, so this
 * can only ever disconnect the caller's own grant.
 */
export const disconnectMicrosoft = tenantAction({
  args: {},
  handler: async (ctx): Promise<{ deleted: boolean; revokedAtProvider: boolean }> => {
    const { deleted } = await ctx.runMutation(internal.microsoftAuth.deleteTokens, {
      tenantId: ctx.tenantId,
    });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: `microsoft-disconnect:${ctx.tenantId}`,
      eventType: "microsoft.disconnected",
      actor: "user",
      // Flags ONLY (CLAUDE.md §4). `revokedAtProvider` is a HARD false, not a placeholder: it
      // records in the audit trail that the provider-side grant was never revoked, so a later
      // compliance read cannot mistake this for a Google-style disconnect.
      payload: { deleted, revokedAtProvider: false },
    });
    return { deleted, revokedAtProvider: false };
  },
});
