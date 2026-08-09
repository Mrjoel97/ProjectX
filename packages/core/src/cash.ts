/**
 * CASH — the PURE half of the business-finance plane (CLAUDE.md §1).
 *
 * The Cost console answers *what is Pikar spending*. This module answers *is the business using
 * Pikar viable*. `convex/cash.ts` owns storage and tenant scoping; everything decidable without a
 * database lives here — the role `spend.ts` plays for Cost.
 *
 * TWO PLANES, mirroring that split so one mental model serves the whole page:
 *   • UNIT ECONOMICS — does each customer pay for itself? (the Hormozi spine: CFA, LTGP:CAC)
 *   • SOLVENCY — how long does the business survive? (the finance-ops layer: runway, burn, MRR/ARR,
 *     working capital). This layer is deliberately OUTSIDE the Hormozi framework and is marked as
 *     such wherever it is rendered. It earns its place because it is the survival metric for funded
 *     businesses, whom the books explicitly exclude.
 *
 * UNITS. Everything here is USD **dollars** as a plain number, matching `scorecard.financials.cac`.
 * The Pikar-spend plane uses integer **cents** (`DashboardMoney`). They never meet in one formula.
 *
 * THE ARITHMETIC IS NOT REIMPLEMENTED. `growth/financialSpine.ts` already ports LTGP:CAC and CFA
 * from the source material, with the divide-by-zero guards. This module adds what a *screen* needs
 * on top: which truth a figure is in, where it came from, whether it is stale, and which set of
 * metrics this tenant should see at all.
 *
 * ponytail: `ltgpCac` from `./growth/financialSpine` is not imported here — this task (Task 2) has
 * no caller for it yet, and an unused import fails lint. Task 5 imports it where it is first used.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a number MEANS, so a renderer never has to guess a suffix. */
export type CashUnit = "usd" | "ratio" | "months" | "percent" | "count" | "perDay";

/** Where a known figure came from. The blueprint code's vocabulary, reused verbatim. */
export type CashOrigin = "observed" | "stated" | "derived";

/**
 * ONE figure, in exactly one of FOUR states. Three of them are the spec's three truths; the fourth
 * exists because a real, recorded input can still make the arithmetic undefined.
 *
 *   • `unknown`         — never asked, or unanswered. Names the missing input.
 *   • `not-applicable`  — the metric does not exist for this business. Decided by tier and revenue
 *                         stage, NEVER inferred from absent data. "MRR $0" shown to a project-based
 *                         consultant implies a failing subscription business that does not exist.
 *   • `not-computable`  — the inputs are present and one of them makes the result undefined
 *                         (CAC = 0, monthly cost = 0). Deliberately NOT folded into `unknown`:
 *                         "needs your CAC" is a lie to someone who told us it was zero.
 *   • `known`           — a real number, including a real measured ZERO.
 *
 * Collapsing any two of these is the failure mode this type exists to prevent. `cash.test.ts` has a
 * red test per collapse.
 */
export type CashFigure =
  | { state: "unknown"; needs: string }
  | { state: "not-applicable"; because: string }
  | { state: "not-computable"; because: string }
  | {
      state: "known";
      origin: CashOrigin;
      value: number;
      unit: CashUnit;
      /** For `derived`: what it was computed FROM, in words. Never rendered without it. */
      from?: string;
      /** For a RATIO: how many customers it rests on. `null` = not recorded, and it says so. */
      sampleSize?: number | null;
      /** For `stated`: when the user last confirmed it. */
      statedAt?: number;
      /** For `stated`: older than STALE_AFTER_MS, so the page asks for a confirm-or-update. */
      stale?: boolean;
    };

export const unknownFigure = (needs: string): CashFigure => ({ state: "unknown", needs });
export const notApplicable = (because: string): CashFigure => ({
  state: "not-applicable",
  because,
});
export const notComputable = (because: string): CashFigure => ({
  state: "not-computable",
  because,
});
export const knownFigure = (
  origin: CashOrigin,
  value: number,
  unit: CashUnit,
  extra: Pick<
    Extract<CashFigure, { state: "known" }>,
    "from" | "sampleSize" | "statedAt" | "stale"
  > = {},
): CashFigure => ({ state: "known", origin, value, unit, ...extra });

// ── Activity: the row that costs nothing ────────────────────────────────────────────────
//
// Pikar already delivers the emails, so `requests` rows in status `sent` ARE the reach-out count.
// The books say the readable signals at the smallest scale are INPUTS — reach-outs per day, posts
// per day, streak — and explicitly that rates at small samples are unreadable. This is the one row
// that populates itself with no data entry.

export type CashActivity = {
  /** Newest UTC day first, one entry per day in the window, gaps included as real zeroes. */
  perDay: { dayStartMs: number; count: number }[];
  todayCount: number;
  /** Consecutive UTC days with at least one send, ENDING TODAY. Zero if nothing went out today. */
  streakDays: number;
};

const utcDayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * Bucket delivered sends into UTC days.
 *
 * The streak ends TODAY by definition. A streak that keeps counting yesterday's run for someone who
 * has not sent today is the flattering lie this row exists to avoid — it is a prompt to act, not a
 * trophy.
 */
export function activityFromSends(input: {
  sentAtMs: readonly number[];
  sinceMs: number;
  nowMs: number;
}): CashActivity {
  const firstDay = utcDayStart(input.sinceMs);
  const today = utcDayStart(input.nowMs);

  const counts = new Map<number, number>();
  for (let day = firstDay; day <= today; day += DAY_MS) counts.set(day, 0);
  for (const sentAt of input.sentAtMs) {
    const day = utcDayStart(sentAt);
    // Outside the reported window is IGNORED, never folded into the first bucket — a bar that
    // silently absorbs older history misreports the day it sits on.
    if (!counts.has(day)) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const perDay = [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayStartMs, count]) => ({ dayStartMs, count }));

  let streakDays = 0;
  for (const bucket of perDay) {
    if (bucket.count === 0) break;
    streakDays += 1;
  }

  return { perDay, todayCount: counts.get(today) ?? 0, streakDays };
}
