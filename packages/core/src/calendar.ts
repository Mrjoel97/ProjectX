// The pure calendar domain (17-01, ACTN-02). Pure TS, Convex-free, network-free (CLAUDE.md §1) —
// every clock is INJECTED, never `Date.now()`, which is what makes all of this synchronously
// unit-testable and keeps the trusted-clock rule (§2-D) enforceable.
//
// ponytail: no new dependency, and no `crypto.subtle` — it is async, which would make every
// caller async for a hash over one Convex id. A small deterministic loop plus a base32hex
// alphabet is a few lines and stays synchronous.

/** Read-only free/busy. Deliberately NOT `calendar.readonly`: `freeBusy.query` returns only busy
 *  `{start,end}` intervals, so event titles and attendee addresses never enter the system at all.
 *  That deletes the §4 / §2-D PII problem BY CONSTRUCTION rather than by a redaction layer. */
export const CALENDAR_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/** The full Google grant this app requests — ONE consent, ONE token row, ONE connect button
 *  (D1: mirror the shipped gmail.ts adapter; do not invent a second integration shape). */
export const GOOGLE_SCOPES = [
  GMAIL_MODIFY_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
  CALENDAR_EVENTS_SCOPE,
].join(" ");

/** The CLOSED availability enum. Closed so a new range is a deliberate edit, not a model string. */
export type AvailabilityRange = "today" | "tomorrow" | "week";

/**
 * Whole-token scope check. **Not a substring test, and that is the whole point**: `freshAccessToken`
 * returns `{ok:true}` for a token that lacks the calendar scope, so a prefix match (`.../calendar`
 * against `.../calendar.events`) would let a 403 land AFTER the human approved. Google delimits the
 * granted scope string with single spaces.
 */
export const hasScope = (granted: string, want: string): boolean =>
  granted.split(" ").includes(want);

/** One year. ponytail: a TYPO GUARD, not a product limit — Google imposes no such bound. The
 *  upgrade path is simply widening it. It exists so "January 30" in the wrong year cannot silently
 *  book an event three centuries out. */
export const CALENDAR_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

/** Google's event-id alphabet: base32hex, `[0-9a-v]`, length 5–1024. */
const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/**
 * A DETERMINISTIC client-supplied event id — this is what buys exactly-once for free. A retry
 * recomputes the same id, so the duplicate `events.insert` returns 409, and this phase treats
 * **409 as success**.
 *
 * `crypto.randomUUID()` is REJECTED (Pitfall 6): it emits `-` and the letters `w`–`z`, neither of
 * which is in Google's grammar, and the resulting 400 lands at the LAST step — after the user has
 * already approved.
 *
 * ponytail: a 32-bit FNV-1a rendered as 13 base32hex chars. Collision-free in practice because
 * Convex ids are unique per deployment, and a collision returns 409, which this phase already
 * treats as success. Upgrade path if that ever stops holding: a wider digest, same shape.
 */
export function eventIdFor(planId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < planId.length; i++) {
    h ^= planId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = "";
  // 13 chars * 5 bits covers the 32-bit digest with room to spare, and clears the 5-char floor.
  for (let i = 0; i < 13; i++) {
    out += BASE32HEX[h & 31];
    h = Math.floor(h / 32);
  }
  return out;
}

/** RFC3339 in UTC. ponytail: `toISOString()` already emits exactly this — rung 3, stdlib. */
export const toRfc3339 = (epochMs: number): string => new Date(epochMs).toISOString();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Map a range to an absolute window off the TRUSTED `nowMs`.
 *
 * ponytail: these are ROLLING windows, not calendar-day boundaries in the user's zone — "today"
 * means the next 24 hours, not "until local midnight". Upgrade path if a user complains: one
 * zone-aware boundary helper, which must still take the zone from `clientContext.tz` and NEVER
 * from the model (§2-D). Do NOT introduce a date library to get there — `emailIntent.ts:203`
 * records why (non-deterministic across versions, not cleanly tz-injectable).
 */
export function availabilityWindow(
  range: AvailabilityRange,
  nowMs: number,
): { fromMs: number; toMs: number } {
  switch (range) {
    case "today":
      return { fromMs: nowMs, toMs: nowMs + DAY_MS };
    case "tomorrow":
      return { fromMs: nowMs + DAY_MS, toMs: nowMs + 2 * DAY_MS };
    case "week":
      return { fromMs: nowMs, toMs: nowMs + 7 * DAY_MS };
  }
}
