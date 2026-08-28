"use node";

import { BODY_TRUNCATE_CHARS, type InboxMessageMeta, SEARCH_CAPS } from "@pikar/core";
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
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";
import { contentHash } from "./lib/hash";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
// Exported so notifyExternal.ts reuses the GOVERNED send endpoint (OPSG-05) — the external
// notification channel is the SAME sanctioned Gmail send, never a new write verb. Keeping it
// here (not duplicated) also keeps llmRedaction's POST-target scan the single source of truth.
export const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
// messages.list (`?q=`) + per-id messages.get (`/<id>?format=metadata`) share this base.
const MESSAGES_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

// The ONE token-refresh root — both send() and search() call it (root-cause discipline,
// CLAUDE.md ladder rung 2). Reads the tenant's stored tokens, POSTs the refresh_token grant,
// persists the fresh access token. Returns a discriminated result — NEVER throws: a dead/
// disconnected token is a governed reauth signal, not a retriable failure. Each caller decides
// how to surface `false` (send → awaiting_reauth; search → notification + fall back to asking).
export async function freshAccessToken(
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

/** An already-base64'd attachment part, decoded from storage bytes by `send`. */
type MimeAttachment = { filename: string; mimeType: string; base64: string };

/** Wrap a base64 string into ≤76-char CRLF lines (RFC 2045). */
function wrap76(b64: string): string {
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/**
 * RFC-2822 message. Zero attachments → the EXACT legacy single-part plain-text string
 * (byte-identical, so today's sends are provably unchanged — V4). One+ → `multipart/mixed`:
 * ONE top-level MIME-Version:1.0, a `=_pikar_<hex>` boundary, a base64 text/plain body part,
 * one `application/pdf`-style part per attachment (STANDARD base64, wrapped 76 — NOT url-safe;
 * only the whole raw message is base64url'd, by base64Url(), the classic Gmail bug), and a
 * MANDATORY closing `--boundary--` (V3). CRLF everywhere. Filenames are app-generated sanitized
 * ASCII (Plan 01). // ponytail: RFC 2047 encoded-word; ASCII names skip it.
 * // ponytail: hard 8MB/plan cap (Plan 04) keeps us on the simple raw send; add
 * // uploadType=resumable only if a real doc exceeds it.
 */
export function buildMime(
  to: string,
  subject: string,
  body: string,
  attachments: MimeAttachment[] = [],
  // 03.11 RPLY-01: when present, emit In-Reply-To + References so Gmail threads the reply (Pitfall 2:
  // these carry the RFC 5322 Message-ID header value, angle-bracketed — NEVER the Gmail id). Absent on
  // every non-reply send, so a normal compose is byte-identical to the pre-3.11 output (the V4 test).
  threading?: { inReplyTo: string; references: string },
): string {
  // 03.11 SECURITY (RPLY-01): a reply's subject + threading anchor originate from INBOUND mail —
  // getReplyTarget reads them straight off the attacker-controlled Subject/Message-ID/References
  // headers. Strip CR/LF at this single header sink so a crafted value can't inject extra headers
  // (Bcc:, a spoofed From, a premature body) into the reply the user sends. RFC 5322 header values
  // carry no bare CR/LF once unfolded, so this is lossless for every legitimate To/Subject/Message-ID.
  const h = (v: string): string => v.replace(/[\r\n]/g, "");
  const toH = h(to);
  const subjectH = h(subject);
  const threadHeaders = threading
    ? [`In-Reply-To: ${h(threading.inReplyTo)}`, `References: ${h(threading.references)}`]
    : [];
  if (attachments.length === 0) {
    return [
      `To: ${toH}`,
      `Subject: ${subjectH}`,
      ...threadHeaders,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      body,
    ].join("\r\n");
  }

  const boundary = `=_pikar_${crypto.randomUUID().replace(/-/g, "")}`;
  const lines: string[] = [
    `To: ${toH}`,
    `Subject: ${subjectH}`,
    ...threadHeaders,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(body, "utf-8").toString("base64")),
  ];
  for (const a of attachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "",
      wrap76(a.base64),
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

export function base64Url(s: string): string {
  return Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** What `getForDelivery` projects. Named so the shared preparation below can be typed without
 *  re-deriving it through the internal-api graph (guidelines §96). */
export type DeliveryRequest = {
  tenantId: string;
  correlationId: string;
  recipient: string;
  subject: string;
  body: string;
  attachments: { filename: string; mimeType: string; storageId: Id<"_storage"> }[];
  threadId?: string;
  inReplyTo?: string;
  references?: string;
};

/**
 * EVERY GOVERNANCE GUARD BETWEEN AN APPROVED ROW AND RAW MIME BYTES, IN ONE PLACE.
 *
 * Extracted at 25-05 so the Microsoft arm (`graph.ts`) reuses it instead of restating it. That is
 * not tidiness — the CAN-SPAM footer and the suppression check are the two things in this codebase
 * that must be UNBYPASSABLE, and "two providers, two copies of the guard" is precisely how a
 * bypass appears: the second copy drifts, or the third provider only gets one of them. One
 * function, two callers, no way to send without passing through it.
 *
 * The footer is still concatenated AT THE buildMime CALL SITE, which is what the long-standing
 * comment in `send` requires — this function IS that call site now, for both providers.
 * `notifyExternal.ts` deliberately does NOT come through here: it sends a static service notice to
 * the user's own mailbox, which must carry no footer and has nobody to unsubscribe.
 *
 * Returns `suppressed` rather than throwing, because suppression is a PERMANENT governed refusal
 * that both callers terminate on, not an error.
 */
export async function prepareGovernedMessage(
  ctx: ActionCtx,
  req: DeliveryRequest,
): Promise<{ ok: true; mime: string } | { ok: false; reason: "suppressed" }> {
  // Reads `suppressions` and never `contacts`, so a contacts bug cannot un-suppress anyone.
  if (
    await ctx.runQuery(internal.contacts.isSuppressed, {
      tenantId: req.tenantId,
      recipient: req.recipient,
    })
  ) {
    return { ok: false, reason: "suppressed" };
  }

  // A missing/deleted storage blob is a HARD failure → throw → retrier → onComplete DLQ: never
  // silently send the message without the promised attachment.
  const parts: MimeAttachment[] = [];
  for (const a of req.attachments) {
    const blob = await ctx.storage.get(a.storageId);
    if (!blob) throw new Error(`send: attachment blob ${a.storageId} missing`);
    parts.push({
      filename: a.filename,
      mimeType: a.mimeType,
      base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
    });
  }

  const threading = req.inReplyTo
    ? { inReplyTo: req.inReplyTo, references: req.references ?? req.inReplyTo }
    : undefined;

  const footer = await ctx.runQuery(internal.contacts.footerFor, {
    tenantId: req.tenantId,
    recipient: req.recipient,
  });
  // Fail CLOSED, mirroring the missing-attachment throw above. The message names BOTH causes
  // because footerFor collapses them into one null.
  if (!footer) {
    throw new Error(
      "send: no unsubscribe footer could be built — set the tenant's postal address on " +
        "/dashboard/profile, and check the deployment's UNSUBSCRIBE_SECRET and CONVEX_SITE_URL",
    );
  }

  return {
    ok: true,
    mime: buildMime(req.recipient, req.subject, req.body + footer.text, parts, threading),
  };
}

// Explicit return type: keeps `send` out of the internal-graph type-inference cycle.
// Inferring it from the body forces resolution of `internal.{pipeline,gmailAuth,audit}`,
// which (with llm.ts's actions doing the same) tips TS past its circular-inference limit
// and collapses sibling actions to `any` (Convex guidelines §96).
type SendResult =
  // 19-05: `suppressed` is a PERMANENT refusal, unlike the two reauth reasons beside it — see the
  // `deliverApprovedPlan` branch that terminates the row rather than holding it.
  | { delivered: false; reason: "not_connected" | "refresh_failed" | "suppressed" }
  | { delivered: true; messageId: string };

export const send = internalAction({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }): Promise<SendResult> => {
    const req = await ctx.runQuery(internal.gmailAuth.getForDelivery, { requestId });
    if (!req) throw new Error(`gmail.send: request ${requestId} not found`);

    // 19-05 SC#5 — THE TRUST BOUNDARY. Every product send converges on
    // `prepareGovernedMessage` (below), which since 25-05 is shared with the Microsoft arm in
    // `graph.ts` so the suppression check and the CAN-SPAM footer have exactly ONE implementation
    // across both providers. Production callers reach a provider through `internal.delivery.send`,
    // never directly. Both terminate on `suppressed` explicitly.
    //
    // executePlan's approve-time filter is the better UX because it can drop ONE address out of a
    // list and still send to the rest; THIS is what makes it unbypassable. A suppression created
    // after approve but before a SCHEDULED fire is invisible to that filter —
    // startScheduledDelivery re-fires a requestIds list frozen at approve time — and is caught
    // only here. Both are needed; neither is redundant.

    // ponytail: SMOKE::fail sentinel — deterministic offline terminal throw for the fan-out
    // isolation smoke (mirrors llm.ts's fail=primary). The message carries no PII, and real
    // rows never start with it. Remove with the other SMOKE seams once a mock-Gmail smoke exists.
    if (req.subject.startsWith("SMOKE::fail")) {
      throw new Error("SMOKE_FAILURE: forced fan-out send failure");
    }

    const prepared = await prepareGovernedMessage(ctx, req);
    if (!prepared.ok) return { delivered: false, reason: prepared.reason };

    // One refresh root (shared with search). A dead/disconnected token → awaiting_reauth
    // WITHOUT throwing: throwing would burn retrier attempts and eventually DLQ an approved
    // draft the user can still deliver by reconnecting (resolves the 7-day expiry race).
    const access = await freshAccessToken(ctx, req.tenantId);
    if (!access.ok) {
      await ctx.runMutation(internal.pipeline.setStatus, { requestId, status: "awaiting_reauth" });
      return { delivered: false, reason: access.reason };
    }

    // Gmail wants URL-SAFE base64 of the raw MIME; Graph wants standard. That one-line difference
    // is the entire divergence between the two transports — everything above it is shared.
    const raw = base64Url(prepared.mime);
    const sendRes = await fetch(SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.threadId ? { raw, threadId: req.threadId } : { raw }),
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
  return {
    from: pick("From"),
    to: pick("To"),
    cc: pick("Cc"),
    subject: pick("Subject"),
    date: pick("Date"),
  };
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
        {
          from: "Sarah Smoke <sarah@example.com>",
          subject: "Invoice",
          date: "Mon, 01 Jan 2024 10:00:00 +0000",
        },
        {
          from: "Sara Test <sara@example.org>",
          subject: "Hello",
          date: "Tue, 02 Jan 2024 09:00:00 +0000",
        },
      ];
      await audit(records.length);
      return { ok: true, records };
    }

    // FIXTURE FIRST (after the sentinel, before the token) — the SAME `inboxFixtures` seam
    // listInbox/fetchInboxBodies ride, so resolveContacts can park candidates on the tokenless
    // eval tenant (03.10-01). Fixture rows only exist for smoke/eval tenants (smoke.seedInboxFixture
    // is the only writer and it is internal), so the seam cannot shadow a live mailbox.
    const fixture = await ctx.runQuery(internal.smoke.getInboxFixture, { tenantId });
    if (fixture) {
      const records: HeaderRecord[] = fixture.messages.map((m) => ({
        from: m.from, // "Sarah Chen <sarah.chen@example.com>" — rankCandidates parses this
        subject: m.subject,
        date: new Date(m.internalDate).toUTCString(), // rankCandidates Date.parse-es rec.date
      }));
      await audit(records.length); // same refs-only shape as the token path (count only)
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
        const msg = (await res.json()) as {
          payload?: { headers?: { name: string; value: string }[] };
        };
        return toHeaderRecord(msg.payload?.headers ?? []);
      }),
    );

    await audit(messages.length);
    return { ok: true, records };
  },
});

// ── Inbox read plane for the briefing (CKPT-04 / SC-3) ─────────────────────────────────────
//
// Two GET-only actions. EVERYTHING here is read-only by construction: no /modify, no /trash, no
// label write — the only POSTs in this module remain TOKEN_ENDPOINT (refresh) and SEND_ENDPOINT
// (the governed send), which llmRedaction.test.ts asserts statically.
//
// Both check the `inboxFixtures` seam BEFORE the token, so the offline E2E and the eval injection
// probe run with no mailbox. Real tenants never have fixture rows (smoke.seedInboxFixture is the
// only writer and it is internal), so the seam cannot shadow a live mailbox.

/** Hard cap on a single list (Gmail maxResults). Bounds quota AND the Promise.all fan-out below. */
const INBOX_LIST_CAP = 50;

/** Relative window — deliberately NOT after:/before:, whose calendar dates are timezone-ambiguous.
 *  Over-fetching is harmless: @pikar/core's pure `bucket()` owns the real 7-day boundary. */
const INBOX_QUERY = "in:inbox newer_than:7d";

type ListInboxResult =
  // `offlineDigest` rides the fixture row (03.7-03): it tells briefInbox to short-circuit the
  // digest to a deterministic offline one (the Playwright E2E) instead of calling the model. The
  // eval injection probe seeds it FALSE — a LIVE digest over the injected body is the whole point.
  // Absent/false on every live-mailbox read, so a real briefing can never take the offline path.
  | { ok: true; messages: InboxMessageMeta[]; fixture: boolean; offlineDigest?: boolean }
  | { ok: false; reason: "not_connected" | "reauth" };

type FetchBodiesResult =
  | { ok: true; bodies: { id: string; body: string }[] }
  | { ok: false; reason: "not_connected" | "reauth" };

/** Gmail's recursive MessagePart tree (only the fields we read — `body.data` is base64url). */
export type MessagePart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: MessagePart[];
};

/**
 * The first `text/plain` leaf of a MessagePart tree, base64url-decoded — or null when the message
 * has none (HTML-only newsletters), which makes the caller fall back to Gmail's own snippet.
 *
 * We NEVER parse HTML: a tag-stripper is a tarpit and the snippet is already Google's plain-text
 * gist. Exported pure so it is unit-testable without a mailbox. Note `base64url`, not `base64` —
 * Gmail's alphabet is url-safe and decoding it as standard base64 mangles the bytes.
 */
export function pickPlainText(part: MessagePart): string | null {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const found = pickPlainText(child);
    if (found !== null) return found;
  }
  return null;
}

/**
 * List the inbox as headers + snippet + internalDate + unread flag — NEVER bodies (that is
 * fetchInboxBodies' job, for the digest-selected few only: snippet-first is a locked decision).
 * Tenant-scoped through freshAccessToken. Zero mailbox writes.
 *
 * Writes exactly ONE refs-only `mailbox.listed` audit event per successful list: the `range`
 * LITERAL (a caller-supplied enum — never user prose) plus a count. Never a sender, subject or
 * snippet (CLAUDE.md §4 / SC-3). A failed list audits nothing — no read happened.
 *
 * Explicit return type (guidelines §96) — see SendResult.
 */
export const listInbox = internalAction({
  args: {
    tenantId: v.string(),
    correlationId: v.string(),
    range: v.string(),
    maxResults: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { tenantId, correlationId, range, maxResults },
  ): Promise<ListInboxResult> => {
    // ONE refs-only audit event per list, shared by the fixture + live paths (mirrors `search`).
    const audit = (resultCount: number) =>
      ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId,
        eventType: "mailbox.listed",
        actor: "system",
        payload: { range, resultCount },
      });

    // FIXTURE FIRST — before the token, so a fixture tenant needs no mailbox at all.
    const fixture = await ctx.runQuery(internal.smoke.getInboxFixture, { tenantId });
    if (fixture) {
      // Map explicitly: the fixture row carries `body`, and it must NOT ride into the meta shape.
      const messages: InboxMessageMeta[] = fixture.messages.map((m) => ({
        id: m.id,
        from: m.from,
        subject: m.subject,
        snippet: m.snippet,
        internalDate: m.internalDate,
        isUnread: m.isUnread ?? false,
      }));
      await audit(messages.length);
      return { ok: true, messages, fixture: true, offlineDigest: fixture.offlineDigest };
    }

    const access = await freshAccessToken(ctx, tenantId);
    if (!access.ok) {
      // Same non-throwing reauth signal `search` uses — the caller lights the banner and the
      // agent recovers conversationally. NO audit: nothing was read.
      return { ok: false, reason: access.reason === "not_connected" ? "not_connected" : "reauth" };
    }

    const cap = Math.min(maxResults ?? INBOX_LIST_CAP, INBOX_LIST_CAP);
    const listRes = await fetch(
      `${MESSAGES_ENDPOINT}?maxResults=${cap}&q=${encodeURIComponent(INBOX_QUERY)}`,
      { headers: { Authorization: `Bearer ${access.token}` } },
    );
    // messages.list returns { id, threadId } ONLY — every field below needs a per-id get.
    const listBody = (await listRes.json()) as { messages?: { id: string }[] };
    const ids = listBody.messages ?? [];

    // format=metadata rides the top-level snippet/internalDate/labelIds for free — no body is
    // fetched here. ponytail: Promise.all over the ≤50 cap costs ~250 quota units against a
    // 6,000/min/user budget (list=5, get=5); a p-limit is the upgrade only if the cap rises.
    const messages: InboxMessageMeta[] = await Promise.all(
      ids.map(async ({ id }) => {
        const res = await fetch(
          `${MESSAGES_ENDPOINT}/${id}?format=metadata` +
            META_HEADERS.map((h) => `&metadataHeaders=${h}`).join(""),
          { headers: { Authorization: `Bearer ${access.token}` } },
        );
        const msg = (await res.json()) as {
          snippet?: string;
          internalDate?: string;
          labelIds?: string[];
          payload?: { headers?: { name: string; value: string }[] };
        };
        const headers = toHeaderRecord(msg.payload?.headers ?? []);
        return {
          id,
          from: headers.from ?? "",
          subject: headers.subject ?? "",
          snippet: msg.snippet ?? "",
          // internalDate is a STRING int64 of epoch-ms in the Gmail API — Number() it or every
          // downstream bucket comparison silently compares strings.
          internalDate: Number(msg.internalDate ?? 0),
          isUnread: msg.labelIds?.includes("UNREAD") ?? false,
        };
      }),
    );

    await audit(messages.length);
    return { ok: true, messages, fixture: false };
  },
});

/**
 * Fetch the plain-text bodies of the digest-SELECTED messages only (the cap is @pikar/core's
 * BRIEFING_BODY_CAP, applied by the caller). Every body is truncated to BODY_TRUNCATE_CHARS —
 * a gist never needs more, and it bounds both cost and the digest's eval-cap blind spot.
 *
 * No audit here: the briefing's own `briefing.created` event covers the operation, and a second
 * event per body would be noise. Read-only; GET only. Explicit return type (guidelines §96).
 */
export const fetchInboxBodies = internalAction({
  args: { tenantId: v.string(), ids: v.array(v.string()) },
  handler: async (ctx, { tenantId, ids }): Promise<FetchBodiesResult> => {
    const truncate = (s: string) => s.slice(0, BODY_TRUNCATE_CHARS);

    // FIXTURE FIRST (same seam + ordering as listInbox).
    const fixture = await ctx.runQuery(internal.smoke.getInboxFixture, { tenantId });
    if (fixture) {
      const byId = new Map(fixture.messages.map((m) => [m.id, m]));
      return {
        ok: true,
        // Preserve the caller's id order; an unknown id yields nothing rather than an empty body.
        bodies: ids.flatMap((id) => {
          const m = byId.get(id);
          return m ? [{ id, body: truncate(m.body) }] : [];
        }),
      };
    }

    const access = await freshAccessToken(ctx, tenantId);
    if (!access.ok) {
      return { ok: false, reason: access.reason === "not_connected" ? "not_connected" : "reauth" };
    }

    const bodies = await Promise.all(
      ids.map(async (id) => {
        const res = await fetch(`${MESSAGES_ENDPOINT}/${id}?format=full`, {
          headers: { Authorization: `Bearer ${access.token}` },
        });
        const msg = (await res.json()) as { snippet?: string; payload?: MessagePart };
        // No text/plain leaf (HTML-only) → Gmail's snippet. Never crash, never parse HTML.
        const text = (msg.payload ? pickPlainText(msg.payload) : null) ?? msg.snippet ?? "";
        return { id, body: truncate(text) };
      }),
    );
    return { ok: true, bodies };
  },
});

// ── 03.11 RPLY-01: the reply target-header read ────────────────────────────────────────────
//
// A single message's threading anchor: From, Subject, threadId, and the RFC 5322 Message-ID/References
// HEADERS (angle-bracketed — NEVER the Gmail id, Pitfall 2). Plan 04's replyToMessage tool calls this
// server-side to set the reply's recipient/subject/In-Reply-To/References on the plan. These headers/ids
// are returned to the SERVER-SIDE caller ONLY, never logged (the address stays refs-only to the loop,
// §2-D; the reply tool owns the audit) — so this read writes NO audit itself (mirrors fetchInboxBodies).
// Deliberately a SEPARATE action from fetchInboxBodies: that returns the untrusted BODY (toolless-only),
// this returns refs-only HEADERS — keeping the two trust planes in distinct, separately-scanned blocks.

const REPLY_HEADERS = ["From", "Subject", "Message-ID", "References"] as const;

/** References = the original's References header (if any) + its Message-ID, space-joined (RFC 5322). */
function buildReferences(messageIdHeader: string, existingReferences?: string): string {
  return existingReferences ? `${existingReferences} ${messageIdHeader}` : messageIdHeader;
}

/** The reply anchor. inReplyTo/references are the RFC Message-ID header values (angle-bracketed). */
type ReplyTarget = {
  from: string;
  subject: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
};

// Explicit return type (guidelines §96) — never inferred through the internal graph.
type ReplyTargetResult =
  | { ok: true; target: ReplyTarget }
  | { ok: false; reason: "not_connected" | "reauth" | "not_found" };

export const getReplyTarget = internalAction({
  args: { tenantId: v.string(), id: v.string() },
  handler: async (ctx, { tenantId, id }): Promise<ReplyTargetResult> => {
    // FIXTURE FIRST (same seam + ordering as listInbox/fetchInboxBodies) — the fixture message carries
    // the RFC `messageId` header + `threadId` (03.11-01 anchors), so the eval/E2E reply path threads
    // against it with no live mailbox.
    const fixture = await ctx.runQuery(internal.smoke.getInboxFixture, { tenantId });
    if (fixture) {
      const m = fixture.messages.find((x) => x.id === id);
      if (!m) return { ok: false, reason: "not_found" };
      return {
        ok: true,
        target: {
          from: m.from,
          subject: m.subject,
          threadId: m.threadId,
          inReplyTo: m.messageId,
          references: m.messageId ? buildReferences(m.messageId) : undefined,
        },
      };
    }

    const access = await freshAccessToken(ctx, tenantId);
    if (!access.ok) {
      return { ok: false, reason: access.reason === "not_connected" ? "not_connected" : "reauth" };
    }

    // format=metadata surfaces the top-level threadId + the requested headers — NO body is fetched.
    const res = await fetch(
      `${MESSAGES_ENDPOINT}/${id}?format=metadata` +
        REPLY_HEADERS.map((h) => `&metadataHeaders=${h}`).join(""),
      { headers: { Authorization: `Bearer ${access.token}` } },
    );
    if (res.status === 404) return { ok: false, reason: "not_found" };
    const msg = (await res.json()) as {
      threadId?: string;
      payload?: { headers?: { name: string; value: string }[] };
    };
    const headers = msg.payload?.headers ?? [];
    const pick = (h: string) =>
      headers.find((x) => x.name.toLowerCase() === h.toLowerCase())?.value;
    const messageIdHeader = pick("Message-ID");
    return {
      ok: true,
      target: {
        from: pick("From") ?? "",
        subject: pick("Subject") ?? "",
        threadId: msg.threadId,
        inReplyTo: messageIdHeader,
        references: messageIdHeader
          ? buildReferences(messageIdHeader, pick("References"))
          : undefined,
      },
    };
  },
});

// ── 29-03 (KNOW-01): the metadata-first knowledge query ──────────────────────────────────────
//
// A SEPARATE verb from `search`, on purpose. `search` resolves a CONTACT: it asks `from:/to:`
// about a name and never fetches a body. This asks a free-text BUSINESS QUESTION and exists to
// fetch a bounded number of bodies, because a body is what the toolless synthesis reads. Merging
// them would give the contact resolver a reason to hydrate bodies it has never needed.
//
// EVERYTHING HERE IS A GET on the tenant's own token, and NOTHING here writes an audit row: a
// unified search reads several sources and owes exactly ONE refs-only `knowledge.searched` event,
// which the plan-29-06 coordinator owns. Per-source events would let the log plane infer the shape
// of the question from how many rows appeared.
//
// WHAT LEAVES THIS FUNCTION IS UNTRUSTED CONTENT — a subject line and a message body, both
// attacker-controlled. They are for the toolless plane only. The known boundary, stated rather
// than papered over: the LANDED firewall (`llmRedaction.test.ts`) is BODY-scoped, so today's
// briefing path already admits senders and subjects into the tool-bearing loop. This verb is
// deliberately tighter — it returns NO sender at all — and `knowledgeExternalSources.ts` is where
// that containment is scanned.

/** Ids one knowledge query may list. Hard: it also bounds the hydration fan-out below. */
const KNOWLEDGE_LIST_CAP = 25;
/**
 * Bodies hydrated per query. DELIBERATELY smaller than the list cap and smaller than
 * `SEARCH_CAPS.maxEvidencePerSource` (8): the list is ids, the hydration is untrusted content and
 * a per-message round trip. Listing wide and reading narrow is what makes the read "metadata
 * first" rather than "download the mailbox".
 */
const KNOWLEDGE_BODY_CAP = 5;
/** Words one escaped query may carry. Gmail ANDs them, so more words means fewer results, not more. */
const KNOWLEDGE_QUERY_WORD_CAP = 12;

/** Everything that carries Gmail search-operator meaning. Replaced by a SPACE, never deleted. */
const GMAIL_OPERATOR_CHARS = /[:"'`(){}[\]\\<>\r\n\t]/g;

/**
 * Turn a planner phrase into a Gmail `q` that cannot carry Gmail query language.
 *
 * NEUTRALIZE, never drop-the-token: every character that makes an operator (`:` for `from:`,
 * `label:`, `has:`, `in:`, `is:`; quotes for exact phrases; brackets for grouping) becomes a SPACE,
 * a leading `-`/`+` is stripped per token (they are Gmail's exclude/require prefixes, and a phrase
 * that happened to start with a dash would silently invert the search), and the bare uppercase
 * `OR`/`AND` are dropped. What survives is a bag of literal words, which Gmail ANDs.
 *
 * URL encoding does NOT protect this boundary — Gmail decodes `q` before it parses operators, the
 * same trap `escapeDriveQueryLiteral` (`vaultDrive.ts`) exists for.
 *
 * Returns `""` only for a phrase with no letter or digit at all. The caller must NOT list on that:
 * an empty `q` returns arbitrary recent mail, which is an answer about messages nobody asked about.
 */
export function escapeGmailQuery(raw: string): string {
  const words = raw
    .replace(GMAIL_OPERATOR_CHARS, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-+]+/, ""))
    .filter((w) => w !== "" && w !== "OR" && w !== "AND");
  return words.slice(0, KNOWLEDGE_QUERY_WORD_CAP).join(" ").slice(0, SEARCH_CAPS.queryCharCap);
}

/**
 * One mailbox message as knowledge evidence.
 *
 * THERE IS NO SENDER FIELD, and that is a decision rather than an omission: a display name and an
 * address are the PII-densest things in a mailbox, the answer is built from what was SAID, and the
 * landed briefing path already admits senders into the tool-bearing loop. Adding one here would
 * widen a boundary this plan is meant to hold. `ponytail:` ceiling — an answer cannot say "Sarah
 * said X". Upgrade path when that is genuinely needed: carry an index into a server-side sender
 * table the model never sees, the `buildRecipientView` idiom.
 */
export type KnowledgeMailMessage = {
  /** The Gmail message id — an opaque provider ref, safe for a `sourceRef`. */
  id: string;
  /** UNTRUSTED CONTENT. The subject line, capped. Content plane only. */
  subject: string;
  /** UNTRUSTED CONTENT. Plain-text body (or Gmail's own snippet), truncated to the search cap. */
  body: string;
  internalDate: number;
  /** The body was cut. The caller must report the read as PARTIAL, never as a full read. */
  bodyTruncated: boolean;
};

// Explicit return type (guidelines §96) — see SendResult.
type KnowledgeQueryResult =
  | {
      ok: true;
      messages: KnowledgeMailMessage[];
      /** How many ids the list returned, BEFORE hydration narrowed it. */
      listed: number;
      /** Gmail had another page. Reported so a capped read can never present as complete. */
      more: boolean;
    }
  | { ok: false; reason: "not_connected" | "reauth" };

/** Apply the content-plane caps once, so the fixture path and the live path cannot disagree. */
function knowledgeMessage(
  id: string,
  subject: string,
  body: string,
  internalDate: number,
): KnowledgeMailMessage {
  const text = body.slice(0, SEARCH_CAPS.evidenceTextCharCap);
  return {
    id,
    subject: subject.slice(0, SEARCH_CAPS.labelCharCap),
    body: text,
    internalDate,
    bodyTruncated: text.length < body.length,
  };
}

export const knowledgeQuery = internalAction({
  args: { tenantId: v.string(), query: v.string() },
  handler: async (ctx, { tenantId, query }): Promise<KnowledgeQueryResult> => {
    const q = escapeGmailQuery(query);
    // FAIL CLOSED, and loudly. This is unreachable through the product path — `clampSearchPlan`
    // refuses a query with no searchable term at the planner boundary — so reaching it means an
    // adapter was called directly with something no planner could produce. A throw is the honest
    // answer: the coordinator runs adapters under `Promise.allSettled`, and there is no governed
    // state that truthfully describes "we could not build a query", while every alternative
    // (`available` with zero rows, `provider_error`) is a sentence that is not true.
    if (q === "") {
      throw new Error("gmail.knowledgeQuery: the query carried no searchable term");
    }

    // FIXTURE FIRST (the same seam and ordering as listInbox/fetchInboxBodies), so the offline
    // eval corpus can exercise the inbox source with no mailbox. Real tenants never have fixture
    // rows — `smoke.seedInboxFixture` is the only writer and it is internal.
    const fixture = await ctx.runQuery(internal.smoke.getInboxFixture, { tenantId });
    if (fixture) {
      // The seam FILTERS on the escaped terms rather than returning every fixture message: a seam
      // that answered every question with the whole fixture would make every offline assertion
      // built on it vacuous. It is a substring AND, not Gmail's ranking — `ponytail:` ceiling,
      // named because the offline path is a shape check and not a relevance check.
      const terms = q.toLowerCase().split(" ");
      const hits = fixture.messages
        .filter((m) => {
          const hay = `${m.subject}\n${m.snippet}\n${m.body}`.toLowerCase();
          return terms.every((term) => hay.includes(term));
        })
        .sort((a, b) => b.internalDate - a.internalDate);
      return {
        ok: true,
        listed: hits.length,
        more: false,
        messages: hits
          .slice(0, KNOWLEDGE_BODY_CAP)
          .map((m) => knowledgeMessage(m.id, m.subject, m.body || m.snippet, m.internalDate)),
      };
    }

    const access = await freshAccessToken(ctx, tenantId);
    if (!access.ok) {
      // The same non-throwing governed signal every other read verb returns. The caller renders a
      // GAP ("your mailbox needs reconnecting"), never an empty result.
      return { ok: false, reason: access.reason === "not_connected" ? "not_connected" : "reauth" };
    }

    const listRes = await fetch(
      `${MESSAGES_ENDPOINT}?maxResults=${KNOWLEDGE_LIST_CAP}&q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${access.token}` } },
    );
    const listBody = (await listRes.json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    const ids = (listBody.messages ?? []).slice(0, KNOWLEDGE_LIST_CAP);

    // Gmail returns the list newest-first, so the first `KNOWLEDGE_BODY_CAP` ARE the most recent
    // matches and no extra metadata round trip is needed to rank them. `ponytail:` ceiling — the
    // selection is recency, not relevance; upgrade path if that is not good enough: fetch metadata
    // for all `listed` ids and rank in pure code, at 5x the quota.
    const messages = await Promise.all(
      ids.slice(0, KNOWLEDGE_BODY_CAP).map(async ({ id }) => {
        const res = await fetch(`${MESSAGES_ENDPOINT}/${id}?format=full`, {
          headers: { Authorization: `Bearer ${access.token}` },
        });
        const msg = (await res.json()) as {
          snippet?: string;
          internalDate?: string;
          payload?: MessagePart & { headers?: { name: string; value: string }[] };
        };
        // No text/plain leaf (an HTML-only newsletter) → Gmail's own snippet. Never parse HTML.
        const text = (msg.payload ? pickPlainText(msg.payload) : null) ?? msg.snippet ?? "";
        const subject = toHeaderRecord(msg.payload?.headers ?? []).subject ?? "";
        // internalDate is a STRING int64 of epoch-ms in the Gmail API.
        return knowledgeMessage(id, subject, text, Number(msg.internalDate ?? 0));
      }),
    );

    return { ok: true, messages, listed: ids.length, more: Boolean(listBody.nextPageToken) };
  },
});
