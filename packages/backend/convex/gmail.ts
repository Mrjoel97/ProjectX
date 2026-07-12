"use node";

// Gmail delivery send action (DLVR-01). "use node": this module holds ONLY the send
// action — every DB touch goes through internal queries/mutations in gmailAuth.ts /
// pipeline.ts / audit.ts via ctx.runQuery/runMutation (01-07 rule: a "use node" module
// may contain only actions, and actions have no ctx.db).
//
// The pipeline (02-06) invokes this through `retrier.run(ctx, internal.gmail.send, ...)`,
// so retries + terminal→deadLetter routing are the retrier's job; here a 5xx THROWS
// (retry) and a dead refresh token routes to awaiting_reauth WITHOUT throwing (the
// approved draft is preserved and delivery resumes after the user reconnects).
import { v } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { contentHash } from "./lib/hash";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
// messages.list (`?q=`) + per-id messages.get (`/<id>?format=metadata`) share this base.
const MESSAGES_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

// The ONE token-refresh root — both send() and search() call it (root-cause discipline,
// CLAUDE.md ladder rung 2). Reads the tenant's stored tokens, POSTs the refresh_token grant,
// persists the fresh access token. Returns a discriminated result — NEVER throws: a dead/
// disconnected token is a governed reauth signal, not a retriable failure. Each caller decides
// how to surface `false` (send → awaiting_reauth; search → notification + fall back to asking).
async function freshAccessToken(
  ctx: ActionCtx,
  tenantId: string,
): Promise<
  { ok: true; token: string } | { ok: false; reason: "not_connected" | "refresh_failed" }
> {
  const token = await ctx.runQuery(internal.gmailAuth.getTokens, { tenantId });
  if (!token) return { ok: false, reason: "not_connected" as const };

  const refreshRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      refresh_token: token.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!refreshRes.ok) return { ok: false, reason: "refresh_failed" as const };

  const refreshed = (await refreshRes.json()) as { access_token: string; expires_in?: number };
  await ctx.runMutation(internal.gmailAuth.updateAccess, {
    tenantId,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
  });
  return { ok: true, token: refreshed.access_token };
}

/** RFC-2822 plain-text message. */
function buildMime(to: string, subject: string, body: string): string {
  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    body,
  ].join("\r\n");
}

function base64Url(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Explicit return type: keeps `send` out of the internal-graph type-inference cycle.
// Inferring it from the body forces resolution of `internal.{pipeline,gmailAuth,audit}`,
// which (with llm.ts's actions doing the same) tips TS past its circular-inference limit
// and collapses sibling actions to `any` (Convex guidelines §96).
type SendResult =
  | { delivered: false; reason: "not_connected" | "refresh_failed" }
  | { delivered: true; messageId: string };

export const send = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }): Promise<SendResult> => {
    const req = await ctx.runQuery(internal.gmailAuth.getForDelivery, { requestId });
    if (!req) throw new Error(`gmail.send: request ${requestId} not found`);

    // ponytail: SMOKE::fail sentinel — deterministic offline terminal throw for the fan-out
    // isolation smoke (mirrors llm.ts's fail=primary). The message carries no PII, and real
    // rows never start with it. Remove with the other SMOKE seams once a mock-Gmail smoke exists.
    if (req.subject.startsWith("SMOKE::fail")) {
      throw new Error("SMOKE_FAILURE: forced fan-out send failure");
    }

    // One refresh root (shared with search). A dead/disconnected token → awaiting_reauth
    // WITHOUT throwing: throwing would burn retrier attempts and eventually DLQ an approved
    // draft the user can still deliver by reconnecting (resolves the 7-day expiry race).
    const access = await freshAccessToken(ctx, req.tenantId);
    if (!access.ok) {
      await ctx.runMutation(internal.pipeline.setStatus, { requestId, status: "awaiting_reauth" });
      return { delivered: false, reason: access.reason };
    }

    // Deliver via the Gmail REST API.
    const raw = base64Url(buildMime(req.recipient, req.subject, req.body));
    const sendRes = await fetch(SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (sendRes.status >= 500) {
      // Transient: THROW so the retrier retries; a terminal failure flows onComplete →
      // deadLetters → OPSG-07.
      throw new Error(`gmail.send: transient ${sendRes.status}`);
    }
    if (!sendRes.ok) {
      throw new Error(`gmail.send: ${sendRes.status} ${await sendRes.text()}`);
    }
    const sent = (await sendRes.json()) as { id: string };

    // Record the message id as an audit ref — refs/ids ONLY, never the body/PII (CLAUDE.md §4).
    // Status stays untouched: the pipeline owns the `sent` transition after retrier.run returns.
    await ctx.runMutation(internal.audit.log, {
      tenantId: req.tenantId,
      correlationId: req.correlationId,
      eventType: "gmail.sent",
      actor: "system",
      payload: { requestId, messageId: sent.id },
    });
    return { delivered: true, messageId: sent.id };
  },
});

// ── Headers-only mailbox read (CKPT-01 / SC1) ──────────────────────────────────────
//
// A RAW header record straight off `messages.get?format=metadata`. Mirrors @pikar/core's
// shape but is defined LOCALLY (no cross-package import) so gmail.ts stays a thin fetch
// adapter (CLAUDE.md §1) — parsing/dedupe/ranking is the pure @pikar/core job Plan 04 composes.
type HeaderRecord = { from?: string; to?: string; cc?: string; subject?: string; date?: string };

// Explicit return type (guidelines §96) — never inferred through the internal graph, or a
// sibling action (send/draftCockpit) collapses to `any`.
type SearchResult =
  | { ok: true; records: HeaderRecord[] }
  | { ok: false; reason: "not_connected" | "reauth" };

const META_HEADERS = ["From", "To", "Cc", "Subject", "Date"] as const;

/** Quote a name containing whitespace for a Gmail `from:`/`to:` operator ("Sarah Chen"). */
function gq(name: string): string {
  return /\s/.test(name) ? `"${name}"` : name;
}

/** Map a message's metadata headers into a HeaderRecord (headers only — no body ever leaves Google). */
function toHeaderRecord(headers: { name: string; value: string }[]): HeaderRecord {
  const pick = (h: string) => headers.find((x) => x.name.toLowerCase() === h.toLowerCase())?.value;
  return { from: pick("From"), to: pick("To"), cc: pick("Cc"), subject: pick("Subject"), date: pick("Date") };
}

/**
 * Search the requesting user's mailbox for correspondence with `name` and return RAW header
 * records (From/To/Cc/Subject/Date) — HEADERS ONLY, bodies are NEVER fetched (`format=metadata`,
 * never full/raw). Scoped to the tenant via `freshAccessToken` (tenant-keyed token read). Nothing
 * is ever sent as a side effect of reading (CKPT-01). Each search writes exactly one refs-only
 * `mailbox.searched` audit event ({ queryHash, resultCount } — no names/addresses/subjects, §4/SC3).
 * A read-time token failure returns a reauth signal WITHOUT throwing (the caller lights the banner
 * + falls back to asking). Ranking/dedupe of these records is Plan 04's pure @pikar/core job.
 */
export const search = internalAction({
  args: { tenantId: v.string(), name: v.string(), correlationId: v.string() },
  handler: async (ctx, { tenantId, name, correlationId }): Promise<SearchResult> => {
    // ONE refs-only audit event per search — shared by the SMOKE + live paths so a search is
    // recorded exactly once (CLAUDE.md §4 / SC3: queryHash + count only, never the name itself).
    const audit = async (resultCount: number) =>
      ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId,
        eventType: "mailbox.searched",
        actor: "system",
        payload: { queryHash: await contentHash(name), resultCount },
      });

    // Deterministic offline fixture — real names never start with the sentinel, so this carries
    // no real PII. Lets the resolution E2E/smoke run with no live mailbox (Plan 04/05 drive it).
    if (name.startsWith("SMOKE::")) {
      const records: HeaderRecord[] = [
        { from: "Sarah Smoke <sarah@example.com>", subject: "Invoice", date: "Mon, 01 Jan 2024 10:00:00 +0000" },
        { from: "Sara Test <sara@example.org>", subject: "Hello", date: "Tue, 02 Jan 2024 09:00:00 +0000" },
      ];
      await audit(records.length);
      return { ok: true, records };
    }

    const access = await freshAccessToken(ctx, tenantId);
    if (!access.ok) {
      // Not connected → caller gates on it; any refresh failure → reauth. Never throw, never
      // dead-end: the caller lights the ReconnectBanner and falls back to asking for the address.
      return { ok: false, reason: access.reason === "not_connected" ? "not_connected" : "reauth" };
    }

    // `from:`/`to:` scope the match to correspondents, not body text (more precise than bare q=name).
    const base = `(from:${gq(name)} OR to:${gq(name)})`;
    const list = async (withWindow: boolean): Promise<{ id: string }[]> => {
      const q = withWindow ? `${base} newer_than:1y` : base;
      const res = await fetch(`${MESSAGES_ENDPOINT}?maxResults=20&q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${access.token}` },
      });
      const body = (await res.json()) as { messages?: { id: string }[] };
      return body.messages ?? [];
    };

    // Zero-match widens ONCE: drop the 12-month window and re-list a single time. Still empty →
    // records:[] (the caller falls back to asking).
    let messages = await list(true);
    if (messages.length === 0) messages = await list(false);

    // Headers ONLY — format=metadata, NEVER full/raw (that pulls the body, inflating the GDPR
    // surface). ponytail: Promise.all over the ~20-message cap is well within the 6,000 units/min
    // per-user budget; a p-limit is the upgrade only if the cap ever rises (research Open-Q 2).
    const records: HeaderRecord[] = await Promise.all(
      messages.map(async ({ id }) => {
        const res = await fetch(
          `${MESSAGES_ENDPOINT}/${id}?format=metadata` +
            META_HEADERS.map((h) => `&metadataHeaders=${h}`).join(""),
          { headers: { Authorization: `Bearer ${access.token}` } },
        );
        const msg = (await res.json()) as { payload?: { headers?: { name: string; value: string }[] } };
        return toHeaderRecord(msg.payload?.headers ?? []);
      }),
    );

    await audit(messages.length);
    return { ok: true, records };
  },
});
