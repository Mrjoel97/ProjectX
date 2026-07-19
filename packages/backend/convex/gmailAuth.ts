// Gmail OAuth token store + connect-URL builder + delivery readers.
//
// NOT "use node": these are DB helpers (internalQuery/internalMutation) plus two
// client-safe tenantQueries. The "use node" send ACTION lives in gmail.ts and reaches
// these via ctx.runQuery/runMutation (01-07 rule: a "use node" module holds only actions).
//
// The tokens are the crown jewels (CONTEXT): the `refreshToken`/`accessToken` are read
// ONLY by internal functions, NEVER returned to a client query, and NEVER placed in an
// audit payload (CLAUDE.md §4). `gmailStatus` exposes booleans/timestamps only.
import { v } from "convex/values";
import { isExpiringSoon, REFRESH_TOKEN_TTL_MS } from "@pikar/core/tokenExpiry";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

// ── Opaque, tamper-evident `state` (binds the tenant into the OAuth round-trip) ──
// Never trust a raw tenant param on the callback: an attacker could forge a state for
// another tenant and graft their Gmail onto that tenant. HMAC the tenantId with the
// (server-only) client secret — no new secret, no nonce table needed for the beta.
async function hmacHex(data: string, secret: string): Promise<string> {
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

/** Google authorize URL requesting offline access + forced consent (Research Pitfall 3). */
export async function buildAuthorizeUrl(tenantId: string): Promise<string> {
  const secret = requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: requireEnv("GMAIL_OAUTH_REDIRECT_URI"),
    response_type: "code",
    access_type: "offline", // ← required for a refresh_token
    prompt: "consent", // ← required so Google re-issues a refresh_token every time
    include_granted_scopes: "true",
    scope: GMAIL_SCOPE,
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
 * `notifications.notify` — importing `internal` here creates a gmailAuth⇄internal type
 * cycle that collapses llm.ts's inference (Convex circular-type limitation, guidelines
 * §96). Route through notify once OPSG-05 adds channel dispatch and the cycle is broken.
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

/** Connected? + access-token expiry ONLY — never the tokens themselves. */
export const gmailStatus = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("gmailTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    return { connected: !!row, expiresAt: row?.expiresAt ?? null };
  },
});

/** Signed connect URL for the authenticated tenant (state binds this identity). */
export const gmailConnectUrl = tenantQuery({
  args: {},
  handler: async (ctx): Promise<string> => buildAuthorizeUrl(ctx.tenantId),
});
