/**
 * routineSchedule — the RECURRENCE SPIKE for plan 29-11's decision gate (ROUT-02).
 *
 * WHAT THIS IS AND IS NOT. This module is EVIDENCE, not a scheduler. It exists so the
 * `dst-boundary` and `run-identity` rows of
 * `.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md` can cite an
 * executable answer instead of prose. `schema.ts:442` still carries, verbatim and untouched,
 * "There is deliberately NO `routines` table, cron, trigger, recurrence, next-run timestamp,
 * execution-history table, canvas or DSL" — and 29-11 keeps it that way.
 *
 * WHAT WAS DELETED FROM IT, AND WHY. Round 1 also shipped `classifyOverlap`, `classifyDue`,
 * `classifyRetry` and `materialChanges`/`MATERIAL_FIELDS` here. Those were not a spike — they
 * were the implementation of the feature the gate then decided NOT to build, written so the
 * `overlap` / `retry` / `missed-run` / `material-change-reapproval` rows would have something
 * to cite, and every one of those rows is red regardless. `classifyOverlap` was literally
 * `active === null ? "start" : "skip_overlap"`: the requirement retyped, not evidence about it.
 * They were unreachable (no import anywhere), they carried real defects nothing could observe
 * — `materialChanges` normalised `["a b"]` and `["a","b"]` to the same string, so a change to
 * the recipient list could report as immaterial — and CLAUDE.md §8 says later can scaffold for
 * itself. Deleted in round 2; those four matrix rows now carry `manual` evidence pointing at
 * the research note, which is what they always actually had.
 *
 * Nothing imports what is left, either. `routineDecision.test.ts` scans `convex/**`,
 * `apps/web` and every package `src` recursively for the string `routineSchedule` — round 1
 * scanned only the top level of `convex/`, so `convex/lib/` and `convex/render/` could have
 * imported it in silence.
 *
 * WHY THERE IS NO `@js-temporal/polyfill` HERE. Plan 29-11 said to spike it. The native
 * platform already covers what the matrix needs, so the dependency is not installed:
 * `Intl.DateTimeFormat(..., { timeZone })` + `formatToParts` resolves real IANA wall time
 * against the full ICU tzdata (418 zones in this Node), including both DST edges —
 * America/New_York 2026-03-08T07:00Z reads back as 03:00 local (the 02:xx hour never
 * exists) and 2026-11-01T05:30Z and 06:30Z BOTH read back as 01:30 local. Everything below
 * is derived from that one primitive. The research note "do not hand-roll timezone offsets
 * with Date/Intl arithmetic" is about GUESSING offsets; this does not guess — it asks ICU
 * for the offset at an instant, and round-trips every candidate back through ICU before
 * returning it. A candidate that does not re-format to the requested wall time is rejected,
 * which is exactly how the gap and the ambiguity are detected rather than assumed.
 *
 * ponytail: native Intl, no dependency. If a future enable-safe branch needs calendar
 * arithmetic beyond "same wall time, next day/week" (month-end clamping, RRULE, sub-minute
 * precision), that is the point to reach for Temporal — not before.
 */

/** Milliseconds in a calendar-agnostic 24h span. Used only as a bracket, never as "a day". */
const DAY_MS = 86_400_000;

/** A schedule that cannot resolve within this many local days is a broken rule, not a wait. */
export const MAX_LOOKAHEAD_DAYS = 400;

export type LocalCadence =
  | { frequency: "daily" }
  /** `weekday` is the JS weekday of the LOCAL date: 0 = Sunday .. 6 = Saturday. */
  | { frequency: "weekly"; weekday: number };

/**
 * A closed local recurrence rule. Deliberately NOT cron text and NOT a UTC timestamp: the
 * research row for Time/DST requires an IANA zone plus a local wall time, so a routine pinned
 * to "08:30 in Berlin" stays at 08:30 across a transition instead of drifting an hour.
 */
export type LocalRecurrenceRule = {
  timeZone: string;
  /** Local wall-clock hour, 0-23. */
  hour: number;
  /** Local wall-clock minute, 0-59. */
  minute: number;
  cadence: LocalCadence;
};

/**
 * How the requested wall time mapped onto the timeline.
 * - `exact` — exactly one instant carries that wall time.
 * - `gap_shifted` — the wall time does not exist (spring forward). Resolved to the NEXT
 *   VALID INSTANT, which is the transition itself, not the requested time plus the gap.
 * - `ambiguous_first` — the wall time happens twice (fall back). Resolved to the FIRST of
 *   the two; `occurrenceKey` makes the second one a duplicate claim, not a second run.
 */
export type Disambiguation = "exact" | "gap_shifted" | "ambiguous_first";

export type Occurrence = {
  /** The absolute instant to show the user and to arm against. */
  utcMs: number;
  /** The local calendar date the occurrence belongs to, `YYYY-MM-DD`. Part of the run key. */
  localDate: string;
  /** The REQUESTED local wall time `HH:MM`. Part of the run key. */
  localTime: string;
  /** The local wall time actually resolved — differs from `localTime` only on `gap_shifted`. */
  resolvedLocalTime: string;
  disambiguation: Disambiguation;
};

type WallParts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  // Throws RangeError on an unknown zone — a trust-boundary check we deliberately do not swallow.
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, made);
  return made;
}

/** The wall-clock reading ICU gives for an absolute instant in a zone. */
export function wallPartsAt(utcMs: number, timeZone: string): WallParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`routineSchedule: ICU gave no ${type} for ${timeZone}`);
    return Number(found.value);
  };
  return {
    y: get("year"),
    mo: get("month"),
    d: get("day"),
    h: get("hour"),
    mi: get("minute"),
    s: get("second"),
  };
}

/**
 * The zone's UTC offset AT AN INSTANT, in ms, asked of ICU rather than derived from a table.
 * Positive east of Greenwich. This is the only place offsets come from.
 */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const second = Math.floor(utcMs / 1000) * 1000;
  const p = wallPartsAt(second, timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - second;
}

/** The first instant at which the zone's offset differs from the offset at `lo`. */
function transitionInstant(lo: number, hi: number, timeZone: string): number {
  const offLo = zoneOffsetMs(lo, timeZone);
  let low = lo;
  let high = hi;
  while (high - low > 1000) {
    const mid = low + Math.floor((high - low) / 2000) * 1000;
    if (mid <= low) break;
    if (zoneOffsetMs(mid, timeZone) === offLo) low = mid;
    else high = mid;
  }
  return high;
}

const pad = (n: number) => String(n).padStart(2, "0");
const wallDate = (p: { y: number; mo: number; d: number }) => `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
const wallTime = (h: number, mi: number) => `${pad(h)}:${pad(mi)}`;

/**
 * Resolve a LOCAL wall date-time in an IANA zone to an absolute instant, naming which of the
 * three DST cases applied. Every candidate is round-tripped back through ICU: an instant that
 * does not re-read as the requested wall time is never returned as if it did.
 */
export function resolveLocalInstant(
  y: number,
  mo: number,
  d: number,
  hour: number,
  minute: number,
  timeZone: string,
): { utcMs: number; disambiguation: Disambiguation } {
  const wall = Date.UTC(y, mo - 1, d, hour, minute, 0);
  const offBefore = zoneOffsetMs(wall - DAY_MS, timeZone);
  const offAfter = zoneOffsetMs(wall + DAY_MS, timeZone);

  const matches = (utcMs: number) => {
    const p = wallPartsAt(utcMs, timeZone);
    return p.y === y && p.mo === mo && p.d === d && p.h === hour && p.mi === minute;
  };

  const candidates = [...new Set([wall - offBefore, wall - offAfter])].sort((a, b) => a - b);
  const valid = candidates.filter(matches);

  if (valid.length === 1) return { utcMs: valid[0] as number, disambiguation: "exact" };
  if (valid.length > 1) return { utcMs: valid[0] as number, disambiguation: "ambiguous_first" };

  // No instant carries this wall time: it fell in a spring-forward gap. There is nothing to
  // disambiguate — the answer is the next instant that exists, i.e. the transition itself.
  if (offBefore === offAfter) {
    // Unreachable for any zone in tzdata: a wall time can only go missing across an offset change.
    throw new Error(
      `routineSchedule: ${wallDate({ y, mo, d })} ${wallTime(hour, minute)} is unresolvable in ${timeZone}`,
    );
  }
  return {
    utcMs: transitionInstant(wall - DAY_MS, wall + DAY_MS, timeZone),
    disambiguation: "gap_shifted",
  };
}

function assertRule(rule: LocalRecurrenceRule): void {
  if (!Number.isInteger(rule.hour) || rule.hour < 0 || rule.hour > 23) {
    throw new Error(`routineSchedule: hour must be an integer 0-23, got ${rule.hour}`);
  }
  if (!Number.isInteger(rule.minute) || rule.minute < 0 || rule.minute > 59) {
    throw new Error(`routineSchedule: minute must be an integer 0-59, got ${rule.minute}`);
  }
  if (rule.cadence.frequency === "weekly") {
    const wd = rule.cadence.weekday;
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
      throw new Error(`routineSchedule: weekday must be an integer 0-6, got ${wd}`);
    }
  }
  formatterFor(rule.timeZone); // RangeError on an unknown zone, before any arithmetic.
}

/**
 * The next occurrence strictly AFTER `afterUtcMs`. Walks LOCAL calendar dates — never `+24h` —
 * so a day that is 23 or 25 hours long does not shift the wall time.
 *
 * Throws when no occurrence resolves within `MAX_LOOKAHEAD_DAYS`. That is a broken rule, not a
 * wait, and a `null` in the return type would only push a branch onto every caller that can
 * never be taken (`assertRule` already rejects every unsatisfiable cadence).
 * ponytail: unreachable by construction today — daily resolves on day 0 or 1, weekly within 7.
 * If a cadence with real gaps is ever added (month-end, "last Friday"), that is the moment this
 * throw becomes reachable and needs a test, not before.
 */
export function nextOccurrence(afterUtcMs: number, rule: LocalRecurrenceRule): Occurrence {
  assertRule(rule);
  const start = wallPartsAt(afterUtcMs, rule.timeZone);
  let cursor = Date.UTC(start.y, start.mo - 1, start.d);

  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    const day = new Date(cursor);
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const cadenceAllows =
      rule.cadence.frequency === "daily" || day.getUTCDay() === rule.cadence.weekday;
    if (cadenceAllows) {
      const resolved = resolveLocalInstant(y, mo, d, rule.hour, rule.minute, rule.timeZone);
      const actual = wallPartsAt(resolved.utcMs, rule.timeZone);
      // A local date the zone SKIPPED ENTIRELY has no occurrence at all. Pacific/Apia deleted
      // 2011-12-30 when it crossed the date line, and `resolveLocalInstant` gap-shifts the whole
      // missing day onto the transition — i.e. onto 12-31. Returning that would emit an
      // `Occurrence` whose `localDate` never existed AND fire a second time on 12-31 with a
      // DIFFERENT `occurrenceKey`, which is exactly the duplicate the key exists to prevent.
      // The `gap_shifted` branch stays for the ordinary case (New York 02:30 -> 03:00 the SAME
      // local date); only a shift that lands on another local date is skipped.
      const sameLocalDate = wallDate(actual) === wallDate({ y, mo, d });
      if (resolved.utcMs > afterUtcMs && sameLocalDate) {
        return {
          utcMs: resolved.utcMs,
          localDate: wallDate({ y, mo, d }),
          localTime: wallTime(rule.hour, rule.minute),
          resolvedLocalTime: wallTime(actual.h, actual.mi),
          disambiguation: resolved.disambiguation,
        };
      }
    }
    cursor += DAY_MS;
  }
  throw new Error(
    `routineSchedule: no occurrence within ${MAX_LOOKAHEAD_DAYS} local days of ` +
      `${new Date(afterUtcMs).toISOString()} in ${rule.timeZone} — the rule is broken, not late`,
  );
}

/**
 * The idempotency key a claim mutation would insert under. Derived from the LOCAL occurrence,
 * never from the absolute instant — that is what makes the second 01:30 of a fall-back night a
 * duplicate claim (an idempotent no-op) instead of a second run.
 */
export function occurrenceKey(input: {
  routineId: string;
  localDate: string;
  localTime: string;
  templateVersion: number;
}): string {
  return `${input.routineId}|${input.localDate}T${input.localTime}|v${input.templateVersion}`;
}
