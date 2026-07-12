// SC2/SC3 guided-conversation brain — pure domain logic (CLAUDE.md §1: no Convex imports).
//
// The deterministic half of the cockpit (DECISION #2): this module computes the NEXT
// question to ask; the LLM is used only later, for the body draft. It has NO send path
// and NO Convex import, so "nothing is ever sent on an assumption" is structurally true,
// not conventional — an invalid recipient literally cannot enter `state.recipients`.
//
// Pure: no Date.now, no randomness, no I/O. The ordered `if` branches in nextQuestion ARE
// the spec. isValidEmail is the ONE email regex (shared with validateSubmit — one truth).

import { isValidEmail } from "./validateSubmit";

/** Whether a multi-recipient send goes out individually or as one group thread. */
export type RecipientMode = "individual" | "group";

/**
 * Accumulated answers so far. Immutable — every applyAnswer returns a fresh object.
 * `rejected` holds recipients that bounced validation and are pending re-ask; they are
 * NEVER stored in `recipients` (the trust boundary). Absent `attachmentIntent` never gates ready.
 */
export interface EmailIntentState {
  readonly recipients: readonly string[];
  readonly subject?: string;
  readonly bodyIntent?: string;
  readonly mode?: RecipientMode;
  readonly attachmentIntent?: string;
  readonly rejected?: readonly string[];
  /** Names (no `@`) awaiting a contact lookup — the cockpit resolves these, core only flags them. */
  readonly pendingResolution?: readonly { name: string }[];
  /** Same-turn valid addresses held (not committed) while a name is unresolved — the uniform card. */
  readonly pendingValid?: readonly string[];
  /** Group-like tokens (team/everyone/…) — deferred, never resolved; the cockpit declines + re-asks. */
  readonly groupDeferred?: readonly string[];
  /** First resolved pick's display name, for the drafted greeting. */
  readonly greetingName?: string;
}

/** In-module mutable view for building a fresh immutable state. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ponytail: static word list, not a regex/NLP — extend on demonstrated need (research Open-Q 3).
const GROUP_WORDS: ReadonlySet<string> = new Set([
  "team",
  "everyone",
  "all",
  "staff",
  "group",
  "everybody",
]);
const isGroupWord = (s: string): boolean => GROUP_WORDS.has(s.trim().toLowerCase());

/** The empty starting point of a conversation. */
export const emptyIntent: EmailIntentState = { recipients: [] };

/** The single next thing to ask the user, or `ready` when every required slot is filled. */
export type NextQuestion =
  | { kind: "ask_recipients" }
  | { kind: "reask_recipient"; invalid: string }
  | { kind: "resolve_recipients"; names: string[] }
  | { kind: "defer_group"; groups: string[] }
  | { kind: "ask_subject" }
  | { kind: "ask_body_intent" }
  | { kind: "ask_mode" }
  | { kind: "ready" };

/** One user answer, discriminated by the slot it fills. */
export type Answer =
  | { slot: "recipients"; value: readonly string[] }
  | {
      slot: "resolution";
      picks: readonly { name: string; address: string; displayName?: string }[];
    }
  | { slot: "subject"; value: string }
  | { slot: "bodyIntent"; value: string }
  | { slot: "mode"; value: RecipientMode }
  | { slot: "attachmentIntent"; value: string };

/** Result of applying an answer: the new state, plus rejected recipients when any bounced. */
export type ApplyResult =
  | { ok: true; state: EmailIntentState }
  | { ok: false; state: EmailIntentState; rejected: { slot: "recipients"; invalid: string[] } };

/**
 * The ordered branches ARE the spec. Never returns `ready` while a required slot is missing
 * or a recipient is pending re-ask. `ask_mode` fires only when there is a real choice (>1).
 */
export function nextQuestion(state: EmailIntentState): NextQuestion {
  const pending = state.rejected?.[0];
  if (pending !== undefined) {
    return { kind: "reask_recipient", invalid: pending };
  }
  if (state.pendingResolution && state.pendingResolution.length > 0) {
    return { kind: "resolve_recipients", names: state.pendingResolution.map((p) => p.name) };
  }
  if (state.groupDeferred && state.groupDeferred.length > 0) {
    return { kind: "defer_group", groups: [...state.groupDeferred] };
  }
  if (state.recipients.length === 0) return { kind: "ask_recipients" };
  if (state.subject === undefined) return { kind: "ask_subject" };
  if (state.bodyIntent === undefined) return { kind: "ask_body_intent" };
  if (state.recipients.length > 1 && state.mode === undefined) return { kind: "ask_mode" };
  return { kind: "ready" };
}

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

/** Merge name records, skipping case-insensitive duplicate names. */
function dedupeNames(
  existing: readonly { name: string }[],
  incoming: readonly { name: string }[],
): { name: string }[] {
  const seen = new Set(existing.map((n) => n.name.toLowerCase()));
  const out = [...existing];
  for (const n of incoming) {
    const key = n.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * Validate + merge one answer immutably. Invalid recipients are NOT stored — they bounce back
 * in `rejected` so the caller re-asks only those. A clean answer clears any prior rejection.
 */
export function applyAnswer(state: EmailIntentState, answer: Answer): ApplyResult {
  if (answer.slot === "recipients") {
    // Classify EACH segment in strict order (behavior contract): empty → invalid; has-@ →
    // valid/malformed; no-@ group word → deferred; no-@ otherwise → a name to resolve.
    const valid: string[] = [];
    const invalid: string[] = [];
    const names: { name: string }[] = [];
    const groups: string[] = [];
    for (const r of answer.value) {
      if (r.trim().length === 0) {
        invalid.push(r); // step 1: empty/whitespace is never a pendingResolution "name"
      } else if (r.includes("@")) {
        (isValidEmail(r) ? valid : invalid).push(r); // steps 2 & 3
      } else if (isGroupWord(r)) {
        groups.push(r.trim()); // step 4
      } else {
        names.push({ name: r.trim() }); // step 5: a name to resolve
      }
    }

    const pendingResolution = dedupeNames(state.pendingResolution ?? [], names);
    const hasPending = pendingResolution.length > 0;
    // Uniform-confirm: while any name is unresolved, hold valid addresses instead of committing.
    const recipients = hasPending ? [...state.recipients] : dedupeAppend(state.recipients, valid);
    const pendingValid = hasPending ? dedupeAppend(state.pendingValid ?? [], valid) : [];

    const next: Mutable<EmailIntentState> = { ...state, recipients };
    setOrDrop(next, "rejected", invalid);
    setOrDrop(next, "groupDeferred", groups);
    setOrDrop(next, "pendingResolution", pendingResolution);
    setOrDrop(next, "pendingValid", pendingValid);

    if (invalid.length > 0) {
      return { ok: false, state: next, rejected: { slot: "recipients", invalid } };
    }
    return { ok: true, state: next };
  }

  if (answer.slot === "resolution") {
    // Fold picked addresses + all held pendingValid into recipients (deduped); clear pending state.
    const held = state.pendingValid ?? [];
    const picked = answer.picks.map((p) => p.address);
    const recipients = dedupeAppend(state.recipients, [...held, ...picked]);
    const next: Mutable<EmailIntentState> = { ...state, recipients };
    delete next.pendingResolution;
    delete next.pendingValid;
    const greeting = answer.picks[0]?.displayName; // FIRST pick names the greeting
    if (greeting !== undefined) next.greetingName = greeting;
    return { ok: true, state: next };
  }

  return { ok: true, state: { ...state, [answer.slot]: answer.value } };
}

/** Set a transient array field when non-empty, else drop it — keeps state minimal & clears signals. */
function setOrDrop<K extends "rejected" | "groupDeferred" | "pendingResolution" | "pendingValid">(
  state: Mutable<EmailIntentState>,
  key: K,
  value: NonNullable<EmailIntentState[K]>,
): void {
  if (value.length > 0) state[key] = value;
  else delete state[key];
}

// ─── Pure contact-resolution helpers (Plan 04 cockpit composes these) ────────────────────────────
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

/** The ranked candidate set for one unresolved name (stored on the plans row by Plan 04). */
export interface NameCandidates {
  name: string;
  matches: ContactMatch[];
}

/** Raw header record the Gmail metadata search (Plan 03) returns; core parses these. */
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
 * Sorted `count desc, then lastDateMs desc`; capped at 5. `Date.parse` is pure (no clock read).
 * `name` is the label the caller carries onto NameCandidates — the search already scoped the records.
 */
export function rankCandidates(_name: string, records: readonly HeaderRecord[]): ContactMatch[] {
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
  return [...byAddr.values()]
    .sort((a, b) => b.count - a.count || (b.lastDateMs ?? 0) - (a.lastDateMs ?? 0))
    .slice(0, 5);
}
