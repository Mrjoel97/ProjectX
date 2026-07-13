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
  const all = [...byAddr.values()];
  const named = all.filter((c) => score(c) > 0);
  const pool = named.length > 0 ? named : all; // show only name-matches when any exist, else all
  return pool
    .sort((a, b) => score(b) - score(a) || b.count - a.count || (b.lastDateMs ?? 0) - (a.lastDateMs ?? 0))
    .slice(0, 5);
}
