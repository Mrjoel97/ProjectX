// Gmail OAuth token store + connect-URL builder + delivery readers.
//
// NOT "use node": these are DB helpers (internalQuery/internalMutation) plus two
// client-safe tenantQueries. The "use node" send ACTION lives in gmail.ts and reaches
// these via ctx.runQuery/runMutation (01-07 rule: a "use node" module holds only actions).
//
// The tokens are the crown jewels (CONTEXT): the `refreshToken`/`accessToken` are read
// ONLY by internal functions, NEVER returned to a client query, and NEVER placed in an
// audit payload (CLAUDE.md §4). `gmailStatus` exposes booleans/timestamps only.
import { DRIVE_READONLY_SCOPE, GOOGLE_SCOPES, hasScope } from "@pikar/core";
import { isExpiringSoon, REFRESH_TOKEN_TTL_MS } from "@pikar/core/tokenExpiry";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantAction, tenantQuery } from "./lib/functions";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
// Revocation takes the token ALONE — no client_id/client_secret, unlike the refresh grant
// (gmail.ts:41-50) and the code exchange (http.ts:39-49).
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

// ── Opaque, tamper-evident `state` (binds the tenant into the OAuth round-trip) ──
// Never trust a raw tenant param on the callback: an attacker could forge a state for
// another tenant and graft their Gmail onto that tenant. HMAC the tenantId with the
// (server-only) client secret — no new secret, no nonce table needed for the beta.
export async function hmacHex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Gmail OAuth env not configured: ${name}`);
  return val;
}

/** Google authorize URL requesting offline access + forced consent (Research Pitfall 3).
 *  `gmailTokens` deliberately keeps its shipped name: this is now one Google grant covering mail
 *  and calendar, and renaming a Convex table would be a migration for cosmetic gain. */
export async function buildAuthorizeUrl(tenantId: string): Promise<string> {
  const secret = requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: requireEnv("GMAIL_OAUTH_REDIRECT_URI"),
    response_type: "code",
    access_type: "offline", // ← required for a refresh_token
    prompt: "consent", // ← required so Google re-issues a refresh_token every time
    include_granted_scopes: "true",
    scope: GOOGLE_SCOPES,
    state: `${tenantId}.${await hmacHex(tenantId, secret)}`,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

/** Verify a callback `state`; returns the bound tenantId or null if tampered/malformed. */
export async function verifyState(state: string): Promise<string | null> {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const tenantId = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = await hmacHex(tenantId, requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"));
  return sig === expected ? tenantId : null;
}

// ── Token store (internal-only) ──────────────────────────────────────────────────

/**
 * Store the tenant's tokens after a consent callback. REPLACES any existing row so the
 * 7-day refresh clock (`_creationTime`) resets on every fresh consent — a reconnect must
 * restart the Testing-mode window, not inherit the dead one.
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
      .query("gmailTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("gmailTokens", { ...args, updatedAt: Date.now() });

    // A fresh consent IS the reconnect the warning asked for, so retire it here — otherwise the
    // banner outlives the problem and the only way out is dismissing it by hand. Direct patch,
    // mirroring flagExpiringTokens' direct insert below (same table, no notify path involved).
    // Requests held at `awaiting_reauth` are NOT touched: nothing resumes them yet (see
    // disconnectGoogle's note), so clearing them here would claim a send that never happens.
    for (const n of await ctx.db
      .query("notifications")
      .withIndex("by_tenant_read", (q) => q.eq("tenantId", args.tenantId).eq("read", false))
      .collect()) {
      if (n.kind === "gmail_reconnect") await ctx.db.patch(n._id, { read: true });
    }
  },
});

/**
 * Drop the tenant's grant row. The only delete surface for `gmailTokens` outside `store`'s
 * reconnect replace above. Internal-only — like every other reader here, the token never
 * leaves this module.
 */
export const deleteTokens = internalMutation({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const row = await ctx.db
      .query("gmailTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return { deleted: !!row };
  },
});

/** Read the full token row for delivery (send action, system context). Internal-only. */
export const getTokens = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    ctx.db
      .query("gmailTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique(),
});

/** Persist a freshly-refreshed access token (keeps the refresh clock intact). */
export const updateAccess = internalMutation({
  args: { tenantId: v.string(), accessToken: v.string(), expiresAt: v.number() },
  handler: async (ctx, { tenantId, accessToken, expiresAt }) => {
    const row = await ctx.db
      .query("gmailTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (row) await ctx.db.patch(row._id, { accessToken, expiresAt, updatedAt: Date.now() });
  },
});

/**
 * Delivery reader keyed by requestId — NOT 02-03's `requests.get` tenantQuery, which
 * derives tenantId from the caller's identity. The send action runs in the retrier's
 * system context (no identity), so it must read by explicit requestId.
 */
export const getForDelivery = internalQuery({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (!r) return null;
    // Resolve each attachment ref → the storage-bearing metadata the send action needs.
    // A dangling ref (deleted row) is dropped here; a missing STORAGE blob is the hard
    // failure `send` throws on (never a silent send without the promised attachment).
    const attachments = [];
    for (const ref of r.attachmentRefs) {
      const a = await ctx.db.get(ref);
      if (a) attachments.push({ filename: a.filename, mimeType: a.mimeType, storageId: a.storageId });
    }
    return {
      tenantId: r.tenantId,
      correlationId: r.correlationId,
      recipient: r.recipient,
      subject: r.goal,
      body: r.editedBody ?? r.draft ?? "",
      attachments,
      // 03.11 RPLY-01: the reply threading anchor. This is a HAND-BUILT projection (Pitfall 4) — a
      // field it doesn't return never reaches gmail.send, so a reply would silently post un-threaded.
      // executePlan copies these from the plan onto the request; buildMime emits In-Reply-To/References
      // and send POSTs threadId. Absent on every non-reply row (all optional → the projection is null).
      threadId: r.threadId,
      inReplyTo: r.inReplyTo,
      references: r.references,
    };
  },
});

// ── Proactive expiry scan (DLVR-03, driven by the daily cron in crons.ts) ──────────

/**
 * Flag tokens within ~24h of their 7-day refresh expiry into an in-app "Reconnect
 * Gmail" notification — BEFORE delivery breaks. The refresh clock starts at
 * `_creationTime` (a fresh consent deletes+re-inserts the row, so it always reflects
 * the last connect). In-app only, deliberately NOT email: an expiry alert must not
 * depend on the mail path it reports on (CONTEXT).
 *
 * ponytail: full-table scan + no per-day dedup — one row per tenant at beta scale, and a
 * daily cron flags at most ~once inside a 24h window. Add a `by_expiry` index + a
 * "last_notified" guard if tenant count or noise ever justifies it.
 *
 * ponytail: inserts the notification row directly rather than routing through
 * `notifications.notify`. The original reason was that importing `internal` here would trip
 * the gmailAuth⇄internal circular-type limit (guidelines §96); `disconnectGoogle` now imports
 * it and typecheck stays clean, so the live reason is narrower and worse: `notify`
 * unconditionally schedules `internal.notifyExternal.dispatch`, which sends mail through
 * `freshAccessToken` — the very grant this cron reports as expiring. Routing an
 * expiry warning through the dying mailbox is the loop `audit-dead-letter.md` sanctions this
 * direct insert to avoid. Route through notify only once notify can pick a non-mail channel.
 */
export const flagExpiringTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const row of await ctx.db.query("gmailTokens").collect()) {
      const refreshExpiresAt = row._creationTime + REFRESH_TOKEN_TTL_MS;
      if (!isExpiringSoon(refreshExpiresAt, now)) continue;
      await ctx.db.insert("notifications", {
        tenantId: row.tenantId,
        kind: "gmail_reconnect",
        message: "Your Gmail connection is about to expire — reconnect to keep delivery running.",
        read: false,
        createdAt: now,
      });
    }
  },
});

// ── Client-safe surfaces (tenant-scoped; never leak a token) ───────────────────────

/**
 * Connected? + access-token expiry ONLY — never the tokens themselves.
 *
 * `driveReady` (15.3-09) is a DERIVED BOOLEAN, never the raw `scope` string: this module's
 * standing rule is that nothing about the grant leaves it except booleans and timestamps, and a
 * scope string is a capability inventory. It exists because `connected` alone cannot distinguish
 * "connected before the Drive widening" from "Drive-ready" — the two look identical from the
 * client, and a Drive control that trusts `connected` sends a pre-widening tenant into a 403
 * instead of into reconnect.
 */
export const gmailStatus = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("gmailTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    return {
      connected: !!row,
      expiresAt: row?.expiresAt ?? null,
      driveReady: hasScope(row?.scope ?? "", DRIVE_READONLY_SCOPE),
    };
  },
});

/** Signed connect URL for the authenticated tenant (state binds this identity). */
export const gmailConnectUrl = tenantQuery({
  args: {},
  handler: async (ctx): Promise<string> => buildAuthorizeUrl(ctx.tenantId),
});

/**
 * Disconnect: revoke the grant AT GOOGLE, then delete the local row — in that order.
 * This is what makes `apps/web/app/privacy/page.tsx:312` ("You can disconnect your Google
 * account at any time from within the application") a true statement.
 *
 * Order matters both ways. Delete-only leaves the grant alive on the user's Google account,
 * which is the promise this exists to keep. Revoke-only leaves the crown-jewel refresh token
 * at rest in a DB where nothing honours it — so the delete runs even when Google refuses.
 *
 * We POST the REFRESH token, never the access token: Google kills the whole grant and every
 * access token derived from it, whereas revoking an access token would expire one short-lived
 * credential and leave the user's "Third-party access" entry standing.
 *
 * ONE Google grant covers mail AND calendar (see `buildAuthorizeUrl` above), so this ends
 * inbox reads, sends, free/busy and event creation together. The confirm copy says so.
 *
 * `tenantAction`, not an arg-supplied tenantId: the scope comes from the caller's identity, so
 * this can only ever revoke the caller's own grant. Explicit return type keeps the action out
 * of the internal-graph inference cycle (guidelines §96, the `gmail.send` precedent).
 *
 * ponytail: rows a disconnect strands are left alone — requests held at `awaiting_reauth`,
 * unread `gmail_reconnect` notifications, and armed future-`sendAt` schedulers. All three
 * degrade to a non-throwing hold (`gmail.send` routes a missing token to `awaiting_reauth`
 * without throwing), no new ones are created once the row is gone, and there is no
 * reconnect-resume path today for any of them. Cleaning them up means building that resume
 * sweep — which is where it belongs, not here.
 */
export const disconnectGoogle = tenantAction({
  args: {},
  handler: async (ctx): Promise<{ revoked: boolean }> => {
    const row = await ctx.runQuery(internal.gmailAuth.getTokens, { tenantId: ctx.tenantId });

    // 200 = revoked; 400 = Google already considers it invalid. Both leave the grant in the
    // same end state, so both count as gone — the `eventIdFor` discipline in calendar.ts,
    // where a 409 duplicate IS success. A network throw or 5xx leaves `revoked` false.
    let status = 0;
    if (row) {
      const res = await fetch(GOOGLE_REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: row.refreshToken }),
      });
      status = res.status;
    }
    const revoked = status === 200 || status === 400;

    await ctx.runMutation(internal.gmailAuth.deleteTokens, { tenantId: ctx.tenantId });
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: `google-disconnect:${ctx.tenantId}`,
      eventType: "google.disconnected",
      actor: "user",
      // Flags and a status code ONLY. This function holds the refresh token in scope one line
      // above; putting any of it here would make the audit log the honeypot §4 forbids.
      payload: { revoked, status },
    });
    return { revoked };
  },
});
