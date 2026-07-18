// Pure recipient/contact validators for the cockpit (CLAUDE.md §1: no Convex imports).
//
// The deterministic slot-filling FSM was RETIRED in 03.2.1 (the cockpit reasons via the governed
// Executive Agent tool-loop now — no dual engine). What survives here are the pure validators the
// agent's tools wrap: recipient-list edits (§2-D trust boundary — an invalid address bounces
// before it can enter recipients), the index+label recipient view (a raw email never reaches the
// model), and contact-header ranking for name resolution. Pure — no Date.now, no I/O.
// isValidEmail is the ONE email regex (shared with validateSubmit — one truth).

import { isValidEmail } from "./validateSubmit";

/** Merge `incoming` into `existing`, skipping case-insensitive duplicates. */
function dedupeAppend(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing.map((r) => r.toLowerCase()));
  const out = [...existing];
  for (const r of incoming) {
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ─── Pure agent tool-internals (the Plan 03 Convex tools wrap these verbatim) ──────────────────────
// The §2-D enforcement point: the agent reasons over index+label ONLY, and a bad address bounces
// at the trust boundary before it can enter recipients. Pure — no Convex/Gmail import.

/** One row of the recipient view the agent reasons over: a 1-based index and an address-free label. */
export interface RecipientViewRow {
  index: number;
  label: string;
}

/**
 * Project recipients into an index+label view. The label is the `displayName` when present, else a
 * neutral `"#<index> (no name)"` placeholder — it MUST NOT contain the address (§2-D: a raw email
 * never reaches the model). Index is 1-based; order preserved.
 */
export function buildRecipientView(
  recipients: readonly { address: string; displayName?: string }[],
): RecipientViewRow[] {
  return recipients.map((r, i) => {
    const index = i + 1;
    return { index, label: r.displayName ?? `#${index} (no name)` };
  });
}

/** One recipient-list edit the agent's tool applies. `index` on remove is 1-based. */
export type RecipientEdit =
  | { op: "add"; addresses: string[] }
  | { op: "remove"; index: number }
  | { op: "set"; addresses: string[] };

/** Result of an edit: `ok` when nothing bounced; else recipients hold the accepted subset + rejected. */
export type RecipientEditResult =
  | { ok: true; recipients: string[] }
  | { ok: false; recipients: string[]; rejected: string[] };

/**
 * Apply one add/remove/set edit to a recipient list. Validation is the ONE shared `isValidEmail`
 * regex — an invalid address bounces into `rejected` and NEVER enters recipients (the trust
 * boundary). Add/set dedupe case-insensitively. Remove resolves the 1-based index against the
 * current array; out-of-range returns a `"#<index>"` bounce (never a silent no-op into a send).
 * ponytail: plain reducer over `string[]` — no state-machine coupling; the tool reads the plans
 * row, calls this, patches back.
 */
export function applyRecipientEdit(
  recipients: readonly string[],
  edit: RecipientEdit,
): RecipientEditResult {
  if (edit.op === "remove") {
    if (edit.index < 1 || edit.index > recipients.length) {
      return { ok: false, recipients: [...recipients], rejected: [`#${edit.index}`] };
    }
    return { ok: true, recipients: recipients.filter((_, i) => i + 1 !== edit.index) };
  }
  // add | set: validate each, bounce the invalid, dedupe the valid.
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const a of edit.addresses) (isValidEmail(a) ? valid : rejected).push(a);
  const base = edit.op === "add" ? recipients : [];
  const next = dedupeAppend(base, valid);
  // A "set" that would EMPTY the list is never legitimate (a plan needs ≥1 recipient). Bounce it,
  // keeping the current recipients — so an empty or all-garbage setRecipients can never silently
  // wipe already-resolved contacts (the model emitting `setRecipients([])` did exactly that).
  if (edit.op === "set" && next.length === 0) {
    return { ok: false, recipients: [...recipients], rejected: rejected.length > 0 ? rejected : ["(empty)"] };
  }
  if (rejected.length > 0) return { ok: false, recipients: next, rejected };
  return { ok: true, recipients: next };
}

// ─── Pure contact-resolution helpers (the cockpit's name-resolution tool composes these) ───────────
// Co-located in this file — NOT a sibling module — so they stay under the cockpit.md §9 playbook
// watch (a new packages/core/src/*.ts would trip the Stop hook). No Convex/Gmail import here either.

/** A single ranked contact match for an unresolved name. `lastSubject`/`lastDateMs` are USER-only
 *  hints — they must NEVER be sent to the LLM (CLAUDE.md §4). */
export interface ContactMatch {
  address: string; // lowercased, deduped
  displayName?: string;
  lastSubject?: string;
  lastDateMs?: number;
  count: number; // frequency across the search hits
}

/** The ranked candidate set for one unresolved name (stored on the plans row by the resolve tool). */
export interface NameCandidates {
  name: string;
  matches: ContactMatch[];
}

/** Raw header record the Gmail metadata search returns; core parses these. */
export interface HeaderRecord {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  date?: string;
}

// ponytail: handles only `Name <addr>` / quoted-name / bare-addr shapes — no RFC 5322 group-address
// or comment syntax; upgrade on a demonstrated malformed-header failure (research Pattern 2).
/** Parse one header address value into `{ displayName?, address }` (lowercased), or null. */
export function parseAddress(raw: string): { displayName?: string; address: string } | null {
  const m = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (m?.[2]) {
    return { displayName: m[1]?.trim() || undefined, address: m[2].trim().toLowerCase() };
  }
  const bare = raw.trim().toLowerCase();
  return bare.includes("@") ? { address: bare } : null;
}

/**
 * Rank the contacts appearing in a name-search's header records: parse every From/To/Cc, dedupe by
 * lowercased address, count frequency, and track the most-recent date + its subject/displayName.
 * Gmail search matches the name ANYWHERE in a thread, so the raw records include correspondents who
 * merely shared a thread that mentioned the name (e.g. "Sarah" surfaces people CC'd alongside her).
 * So we rank by NAME-MATCH first (does the display name / address contain the search name), and when
 * any candidate matches we show ONLY those — dropping the noise; if none match, fall back to the
 * frequency ranking. Then `count desc, then lastDateMs desc`; capped at 5. `Date.parse` is pure.
 */
export function rankCandidates(name: string, records: readonly HeaderRecord[]): ContactMatch[] {
  const byAddr = new Map<string, ContactMatch>();
  for (const rec of records) {
    const parsed = Date.parse(rec.date ?? "");
    const dateMs = Number.isNaN(parsed) ? undefined : parsed;
    for (const field of [rec.from, rec.to, rec.cc]) {
      if (!field) continue;
      for (const part of field.split(",")) {
        const addr = parseAddress(part);
        if (!addr) continue;
        const hit = byAddr.get(addr.address);
        if (!hit) {
          byAddr.set(addr.address, {
            address: addr.address,
            displayName: addr.displayName,
            lastSubject: rec.subject,
            lastDateMs: dateMs,
            count: 1,
          });
          continue;
        }
        hit.count += 1;
        const isNewer =
          dateMs !== undefined && (hit.lastDateMs === undefined || dateMs > hit.lastDateMs);
        if (isNewer) {
          hit.lastDateMs = dateMs;
          hit.lastSubject = rec.subject;
        }
        if (addr.displayName && (isNewer || hit.displayName === undefined)) {
          hit.displayName = addr.displayName;
        }
      }
    }
  }
  // Name-match score: 2 = display name / address contains the full search name, 1 = contains any
  // token of it, 0 = no match. Lets a real "Sarah" outrank people merely on her threads.
  const q = name.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const score = (c: ContactMatch): number => {
    const hay = `${c.displayName ?? ""} ${c.address}`.toLowerCase();
    if (q && hay.includes(q)) return 2;
    return tokens.some((t) => hay.includes(t)) ? 1 : 0;
  };
  // Accuracy over convenience: return ONLY contacts that actually match the searched name. If none
  // match, return NONE — the caller then asks the user for the address rather than presenting an
  // unrelated correspondent as the named person. A wrong recipient on a proposal/deal is a
  // liability, so "I couldn't find them, what's their email?" beats a confident wrong guess.
  const named = [...byAddr.values()].filter((c) => score(c) > 0);
  return named
    .sort((a, b) => score(b) - score(a) || b.count - a.count || (b.lastDateMs ?? 0) - (a.lastDateMs ?? 0))
    .slice(0, 5);
}

// ─── Pure NL send-time parser (03.5 SCHD-01 — the deferred-send foundation) ─────────────────────────
// Co-located here (not a sibling module) so it stays under the cockpit.md §9 playbook watch, exactly
// like the contact helpers above. PURE by discipline (CLAUDE.md §1): the CLIENT injects `nowMs` (the
// trusted clock — the model must never invent "now", §2-D) and `ianaTz` (the user's zone). It stores
// ONE absolute epoch ms — never a wall-clock string or a tz pair (the Tier-1 rule, scheduled-send.md).
// ponytail (rung 6/7): a small deterministic reducer over slice-1's grammar — NOT chrono-node/a date
// lib (none installed; a dep is non-deterministic across versions and can't be tz-injected cleanly).
// Upgrade path: widen the grammar (ranges, "next week", explicit dates) or adopt a lib only when a
// demonstrated user phrasing falls through to `none`/`ambiguous`.

/** The outcomes of parsing a natural-language send time. */
export type SendTimeParse =
  | { kind: "resolved"; epochMs: number } // a concrete future instant → schedule
  | { kind: "ambiguous" } // grammar can't anchor it (bare AM / no meridiem, no day) → RE-ASK, never guess
  | { kind: "past" } // a concrete instant at/before now → RE-ASK, never silently send
  | { kind: "tooFar" } // beyond the horizon → RE-ASK, never a silent clamp (the connection may expire before then)
  | { kind: "none" }; // no time expressed → immediate send (today's default, SC1)

const SEND_TIME_EPSILON_MS = 60_000; // a time within a minute of "now" counts as past (clock skew slack)

// The far-future cap (SCHD-01 refinement). ponytail — ceiling: Gmail Testing-mode's 7-day refresh-
// token lifetime (design/scheduled-send.md); a schedule past it finds a DEAD token at fire time. This
// is a tunable calibration knob, not a hard truth — upgrade path: raise or remove once verified Google
// OAuth lands (post-Phase-9), when refresh tokens no longer expire on the 7-day Testing-mode clock.
export const SEND_TIME_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Classify a resolved instant against the injected clock: past (at/before now+epsilon), tooFar
 * (strictly beyond now+horizon), else resolved. One helper so the three resolve sites share the
 * SAME two bounds — a bound can never drift between branches.
 */
function classify(epochMs: number, nowMs: number): SendTimeParse {
  if (epochMs <= nowMs + SEND_TIME_EPSILON_MS) return { kind: "past" };
  if (epochMs > nowMs + SEND_TIME_HORIZON_MS) return { kind: "tooFar" };
  return { kind: "resolved", epochMs };
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** The wall-clock parts of an instant IN the given IANA zone (hour in 24h; midnight normalized to 0). */
function tzParts(epochMs: number, ianaTz: string) {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  const hour = Number(p.hour);
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: hour === 24 ? 0 : hour, // some engines emit "24" for midnight
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** The zone's UTC offset (ms) at a given instant, derived by round-tripping through its wall clock. */
function tzOffsetMs(epochMs: number, ianaTz: string): number {
  const p = tzParts(epochMs, ianaTz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - epochMs;
}

/** Convert a wall clock (Y/M/D H:M) IN `ianaTz` to absolute epoch ms; one refine pass handles DST. */
function zonedWallClockToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  ianaTz: string,
): number {
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, 0);
  // First guess using the offset at the naive-UTC instant, then refine once at the candidate instant
  // so a DST transition between the two resolves correctly (minute-granularity is all slice 1 needs).
  const epoch1 = asUTC - tzOffsetMs(asUTC, ianaTz);
  return asUTC - tzOffsetMs(epoch1, ianaTz);
}

/**
 * Parse a natural-language send time against an injected clock + zone. Slice-1 grammar:
 *   - relative:      "in N hours" / "in N minutes"                      → resolved (offset from now)
 *   - day anchor:    "today" / "tomorrow" / a weekday, + optional time  → resolved (default 09:00)
 *   - bare PM time:  "4pm" / "4:30pm" (no day)                          → today if future, else tomorrow
 *   - bare AM time:  "4am" (no day)  ·  bare hour "at 4" (no meridiem)  → ambiguous (RE-ASK, never guess)
 *   - a day+time already in the past ("today 4am" at noon)             → past (RE-ASK)
 *   - anything unrecognized / no time                                  → none (immediate send)
 * PURE — no Date.now / no `new Date()` without an explicit ms. Bound 3 (locked): never guess a day.
 */
export function parseSendTime(text: string, nowMs: number, ianaTz: string): SendTimeParse {
  const t = text.trim().toLowerCase();
  if (!t) return { kind: "none" };

  // Relative offsets are tz-independent — resolve directly off nowMs.
  const rel = t.match(/\bin\s+(\d+)\s*(hours?|hrs?|minutes?|mins?)\b/);
  if (rel) {
    const n = Number(rel[1]);
    const ms = /^h/.test(rel[2] ?? "") ? n * 3_600_000 : n * 60_000;
    const epochMs = nowMs + ms;
    return classify(epochMs, nowMs);
  }

  // Day anchor.
  let anchor: "today" | "tomorrow" | "weekday" | null = null;
  let weekdayDow = -1;
  if (/\btoday\b/.test(t)) anchor = "today";
  else if (/\btomorrow\b/.test(t)) anchor = "tomorrow";
  else {
    const wd = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    const name = wd?.[1];
    if (name) {
      anchor = "weekday";
      weekdayDow = WEEKDAYS[name] ?? -1;
    }
  }

  // Time of day. A meridiem (am/pm) makes an hour concrete; a bare "at 4" cannot be anchored to am/pm.
  const mer = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  const bare = mer ? null : t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  let hour: number | null = null;
  let minute = 0;
  let meridiem: "am" | "pm" | null = null;
  if (mer) {
    const h = Number(mer[1]);
    if (h >= 1 && h <= 12) {
      meridiem = mer[3] as "am" | "pm";
      minute = mer[2] ? Number(mer[2]) : 0;
      hour = meridiem === "pm" ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
    }
  }

  const now = tzParts(nowMs, ianaTz);
  const nowDow = new Date(Date.UTC(now.year, now.month - 1, now.day)).getUTCDay();

  if (anchor !== null) {
    // A bare hour with no am/pm cannot be anchored even with a day → re-ask.
    if (bare) return { kind: "ambiguous" };
    const h = hour ?? 9; // default 09:00 when a day is named without a time
    const mi = hour === null ? 0 : minute;
    let deltaDays: number;
    if (anchor === "today") deltaDays = 0;
    else if (anchor === "tomorrow") deltaDays = 1;
    else {
      deltaDays = (weekdayDow - nowDow + 7) % 7;
      if (deltaDays === 0) deltaDays = 7; // "Monday" on a Monday means NEXT Monday
    }
    const d = new Date(Date.UTC(now.year, now.month - 1, now.day + deltaDays));
    const epochMs = zonedWallClockToEpoch(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      h,
      mi,
      ianaTz,
    );
    return classify(epochMs, nowMs);
  }

  // No day anchor.
  if (hour !== null) {
    // A bare AM time with no day is the classic ambiguous case (its today-occurrence has usually
    // passed, so resolving to "tomorrow" would be a guess). A bare PM time reads as "later today,
    // else tomorrow" — the low-risk interpretation people expect ("send at 4pm" = this afternoon).
    if (meridiem === "am") return { kind: "ambiguous" };
    let epochMs = zonedWallClockToEpoch(now.year, now.month, now.day, hour, minute, ianaTz);
    if (epochMs <= nowMs + SEND_TIME_EPSILON_MS) {
      const d = new Date(Date.UTC(now.year, now.month - 1, now.day + 1));
      epochMs = zonedWallClockToEpoch(
        d.getUTCFullYear(),
        d.getUTCMonth() + 1,
        d.getUTCDate(),
        hour,
        minute,
        ianaTz,
      );
    }
    return classify(epochMs, nowMs);
  }

  if (bare) return { kind: "ambiguous" }; // "at 4" — hour with no meridiem, no day
  return { kind: "none" };
}
