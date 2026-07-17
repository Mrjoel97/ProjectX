// Pure briefing domain logic for the cockpit inbox briefing (CLAUDE.md §1: no Convex imports).
//
// The locked decision this module exists to enforce (ADR-004 / design §2, SC-1): TIME GROUPING IS
// PURE CODE, NEVER LLM OUTPUT. Timestamps, senders and buckets are structural facts the code
// already knows from Gmail headers + `internalDate`; the model's only job is the gist. So the
// digest call is keyed by INDEX and `joinDigest` welds the model's gist back onto the real
// message — an index the model invents has nothing to weld onto and is dropped. The model
// structurally CANNOT own identity or time; it is not trusted to, and it is not asked to.
//
// Pure by discipline: no Date.now(), no I/O — the caller injects `nowMs` (the client's trusted
// clock, threaded via 3.5's clientContext) and the IANA zone. Same tz story as parseSendTime.
// ponytail (rung 3): Intl.DateTimeFormat is the whole date library — zone/DST tables are stdlib.
// No date-fns/luxon/moment; a dep here would buy nothing two Intl calls don't already do.

/** Gmail message metadata the briefing reasons over. `internalDate` is epoch ms (Number()'d by the
 *  adapter — the Gmail API returns it as a STRING int64). */
export interface InboxMessageMeta {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  internalDate: number;
  isUnread?: boolean;
}

/** One row the toolless digest call returns. INDEX-KEYED BY DESIGN: no sender, no ts, no bucket —
 *  the model never emits a structural fact (ADR-004). `deadline` is a model-extracted *suggestion
 *  string*, rendered as text and never parsed into an action (SC-4). */
export interface DigestItem {
  index: number;
  gist: string;
  category: string;
  needsReply: boolean;
  deadline?: string;
}

/** One briefing row: the model's gist welded onto the code-owned id/sender/subject/ts/bucket. */
export interface BriefingItem {
  /** The Gmail message id — CODE-owned, from the list response. The row's STABLE IDENTITY: it is
   *  what the card keys on. `${ts}-${sender}` is not unique (one sender, two messages, same
   *  internalDate ms is a real and observed case — automated no-reply senders batch). */
  id: string;
  bucket: Bucket;
  sender: string;
  /** The Subject header — CODE-owned like `sender`, never the model's. May be "" (Gmail allows it). */
  subject: string;
  ts: number;
  gist: string;
  category: string;
  needsReply: boolean;
  deadline?: string;
  isUnread?: boolean;
}

export type Bucket = "today" | "yesterday" | "thisWeek";

/** Max message bodies fetched + digested per briefing (snippet-only for the long tail). Bounds both
 *  cost and the digest blind spot in the eval cost cap (research Pitfall 5). */
export const BRIEFING_BODY_CAP = 25;

/** Per-body truncation before the digest prompt — a gist never needs more. */
export const BODY_TRUNCATE_CHARS = 2000;

const DAY_MS = 86_400_000;

/** The calendar day of an instant IN an IANA zone, as "YYYY-MM-DD" (en-CA formats ISO-style). */
export function dayKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

/**
 * The calendar day before `key` ("YYYY-MM-DD" → "YYYY-MM-DD"), DST-proof.
 *
 * Does the arithmetic in UTC, which has no DST and rolls months/years over for free. The obvious
 * `dayKey(nowMs - 86_400_000, tz)` is WRONG twice a year: the day after a spring-forward is only 23
 * local hours long, so "24h ago" from 00:30 local lands two calendar days back (regression-tested:
 * LA 2026-03-09 → naive says 03-07, the truth is 03-08).
 */
function previousDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Group a message into today / yesterday / thisWeek in the user's zone, or null when it falls
 * outside the 7-day window (drop it — the briefing is a week's view, not an archive).
 */
export function bucket(msgTsMs: number, nowMs: number, tz: string): Bucket | null {
  // ponytail: a future-dated message (sender clock skew / a mis-set mail client) reads as "today"
  // rather than being dropped or landing in thisWeek — it is the newest thing in the mailbox, so
  // burying it would be the surprising outcome. Upgrade path: if skew ever exceeds a day in
  // practice, clamp to nowMs and re-bucket instead of special-casing.
  if (msgTsMs > nowMs) return "today";

  const todayKey = dayKey(nowMs, tz);
  const msgKey = dayKey(msgTsMs, tz);
  if (msgKey === todayKey) return "today";
  if (msgKey === previousDayKey(todayKey)) return "yesterday";
  return msgTsMs >= nowMs - 7 * DAY_MS ? "thisWeek" : null;
}

/**
 * The recency-first selection for full-body fetch + digest: newest `cap` messages. Everything else
 * is the snippet-only long tail (locked decision: snippet-first). Pure — does not mutate `messages`.
 */
export function selectForDigest(
  messages: readonly InboxMessageMeta[],
  cap: number = BRIEFING_BODY_CAP,
): InboxMessageMeta[] {
  return [...messages].sort((a, b) => b.internalDate - a.internalDate).slice(0, cap);
}

/**
 * Weld each digest gist onto the message it actually describes, by index.
 *
 * THE TRUST BOUNDARY (ADR-004): `id`/`bucket`/`sender`/`subject`/`ts`/`isUnread` come from
 * `selected[index]` — the message the code fetched — and NEVER from the digest item, even if the
 * model emitted such fields. An index that is out of range, non-integer, or a repeat has no real
 * message behind it and is dropped, so the model cannot invent a briefing row. Messages outside the
 * 7-day window drop too. Output order follows `items`.
 *
 * `id` and `subject` ride the SAME rail as `sender`: both are Gmail-header facts the code already
 * holds, so welding them here costs nothing and keeps the model's surface exactly as narrow as it
 * was (gist/category/needsReply/deadline). The model must never own either — `id` is row identity
 * and `subject` is the row's heading; a model-authored one would be a fabrication rendered as fact.
 */
export function joinDigest(
  selected: readonly InboxMessageMeta[],
  items: readonly DigestItem[],
  nowMs: number,
  tz: string,
): BriefingItem[] {
  const seen = new Set<number>();
  const out: BriefingItem[] = [];
  for (const item of items) {
    if (!Number.isInteger(item.index) || seen.has(item.index)) continue;
    const message = selected[item.index];
    if (!message) continue;
    const b = bucket(message.internalDate, nowMs, tz);
    if (b === null) continue;
    seen.add(item.index);
    out.push({
      id: message.id,
      bucket: b,
      sender: message.from,
      subject: message.subject,
      ts: message.internalDate,
      gist: item.gist,
      category: item.category,
      needsReply: item.needsReply,
      ...(item.deadline !== undefined && { deadline: item.deadline }),
      ...(message.isUnread !== undefined && { isUnread: message.isUnread }),
    });
  }
  return out;
}
