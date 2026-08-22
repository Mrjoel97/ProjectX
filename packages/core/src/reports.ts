// RPRT-01 report semantics (plan 26-14) — the pure half.
//
// This module is deliberately SMALL. Reports reuse the shipped dashboard contracts rather than
// growing a parallel vocabulary: `resolveDashboardWindow` / `createDashboardBound` /
// `compareDashboardOrder` / `DashboardResult` (`dashboard.ts`), `aggregateSpend` (`spend.ts`),
// `segmentFill` / `firstGap` (`blueprintSegments.ts`), `BLUEPRINT_FIELDS` (`blueprint.ts`). What
// lives here is only what reporting needs and nothing else has: comparability between two
// evaluation snapshots, completeness over a closed key set, percentiles that disclose what they
// dropped, and coverage for a source with no coverage row.
//
// A `bucketWindow`/`ReportBucket` pair was written here and REMOVED before commit: nothing called
// it, and no plan in this phase asks for a time series. An exported, doc-commented, unit-tested
// function with no caller is speculative code, and the tests around it read as coverage.
//
// Every function here exists because the obvious implementation of the same metric reports a
// number that is NOT TRUE. The doc comments say which lie each one prevents; `reports.test.ts`
// names them again as test titles.

/** A gap's stable identity — the key `runEvaluation` already writes into `evaluations.delta`.
 *
 *  Lifted out of a local arrow inside that handler — which now IMPORTS this one — so the engine
 *  and the report cannot drift into two different notions of "the same gap". (It was first shipped
 *  as a COPY, with the local arrow left in place; that is the drift this comment claims to prevent,
 *  so the lift was completed.) `leverageRank` deliberately plays no part: a gap that moves gates is
 *  still the same prescription. */
export const gapKey = (gap: { route: string; playbook: string }): string =>
  `${gap.route}/${gap.playbook}`;

export type EvaluationFramework = "swot" | "lean" | "bmc" | "growth-os" | "document-review";

/** The refs-and-counts projection of one `evaluations` row. No findings prose, no scorecard. */
export type EvaluationSnapshot = {
  threadId: string;
  framework: EvaluationFramework;
  verdict: "gaps" | "healthy" | "insufficient";
  findingCount: number;
  gaps: readonly { route: string; playbook: string; leverageRank: number }[];
  createdAt: number;
};

export type SnapshotComparison =
  | { state: "comparable"; newFindings: number; gapsClosed: string[]; gapsOpened: string[] }
  | {
      state: "incomparable";
      reason:
        | "no-prior-snapshot"
        | "different-thread"
        | "framework-changed"
        | "verdict-insufficient"
        | "doc-review-gap-collapse";
    };

/**
 * Movement between two evaluation snapshots, or an explicit reason there is none.
 *
 * **COMPARABLE MEANS SAME THREAD AND SAME FRAMEWORK.** A tenant's rows land on at least three kinds
 * of thread — the weekly review cron, an arbitrary cockpit conversation, and a never-reused
 * per-session voice-doc thread — and the table's only newest-first read interleaves all of them. So
 * "the last two rows" routinely diffs a document review against a business diagnosis. Two things
 * that were never measuring the same subject cannot have movement between them.
 *
 * **AN UNASSESSED RUN IS NEITHER A RESULT NOR A BASELINE.** The engine has TWO insufficient paths
 * and they do not agree on gaps: `findings.length === 0` clears `gaps` (evaluations.ts:482), while a
 * missing rubric skill (`!skillOk`) returns `insufficient` with gaps LEFT AS THEY WERE. So both the
 * verdict and the zero-findings condition are checked — neither implies the other.
 *
 * The guard is SYMMETRIC, and the older side is the half that is easy to miss. If only the newer row
 * were guarded, this happens: week 1 diagnoses one gap and eight findings; week 2 hiccups and writes
 * `insufficient` with empty gaps and findings; week 3 reproduces week 1 byte for byte. Diffing week 3
 * against week 2 passes every guard and reports "8 new findings, 1 gap opened" for a week in which
 * nothing changed. A hiccup would render as a clean sweep in one direction and as a burst of fresh
 * damage in the other — the same lie, mirrored.
 *
 * `document-review` is refused outright: its gaps are not the growth engine's leverage-ranked
 * prescriptions, so a per-gap diff over them is a category error. Report a COUNT for those rows.
 */
export function compareSnapshots(
  newer: EvaluationSnapshot,
  older: EvaluationSnapshot | null,
): SnapshotComparison {
  if (older === null) return { state: "incomparable", reason: "no-prior-snapshot" };
  if (newer.threadId !== older.threadId)
    return { state: "incomparable", reason: "different-thread" };
  if (newer.framework !== older.framework) {
    return { state: "incomparable", reason: "framework-changed" };
  }
  if (newer.framework === "document-review") {
    return { state: "incomparable", reason: "doc-review-gap-collapse" };
  }
  if (
    newer.verdict === "insufficient" ||
    newer.findingCount === 0 ||
    older.verdict === "insufficient" ||
    older.findingCount === 0
  ) {
    return { state: "incomparable", reason: "verdict-insufficient" };
  }

  const before = new Set(older.gaps.map(gapKey));
  const after = new Set(newer.gaps.map(gapKey));
  return {
    state: "comparable",
    // A DROP in findings is not negative new findings. Findings are cited observations on one run,
    // not a running total, so fewer of them means this run cited less — never "minus two".
    newFindings: Math.max(0, newer.findingCount - older.findingCount),
    gapsClosed: [...before].filter((key) => !after.has(key)),
    gapsOpened: [...after].filter((key) => !before.has(key)),
  };
}

export type Completeness = { filled: number; total: number; missing: readonly string[] };

/**
 * How much of a CLOSED, ORDERED key set is filled.
 *
 * **NEVER COUNT OBJECT KEYS.** `BusinessBlueprint` is a total mapped type: all eleven keys are
 * always present and blankness is the *value* `null`, so `Object.keys(x).length` reports a
 * completely blank blueprint as 11/11. The key list is the population, and presence is a predicate
 * the caller supplies. `missing` preserves the declared order, which is what makes the output
 * byte-deterministic across runs.
 */
export function completenessOver<K extends string>(
  keys: readonly K[],
  present: (key: K) => boolean,
): Completeness {
  const missing = keys.filter((key) => !present(key));
  return { filled: keys.length - missing.length, total: keys.length, missing };
}

export type Percentile =
  | { state: "known"; value: number; included: number; excluded: number; population: string }
  | { state: "unknown"; needs: string; included: number; excluded: number; population: string };

/**
 * A percentile that discloses what it threw away.
 *
 * **A STRUCTURAL ZERO IS NOT A MEASUREMENT.** Several writers persist `durationMs: 0` for a path
 * they never timed, and a delivery terminal writes `usages: []` with `durationMs: 0` outright.
 * Averaging those in produces a confident *and flattering* "0 ms" for a tenant whose work was never
 * measured — wrong in the direction nobody questions. Absent, zero and negative values are all
 * excluded, and the excluded count travels with the answer so the reader can see the denominator
 * shrink.
 *
 * Nearest-rank on the sorted included set (no interpolation), pinned in the tests so a later
 * refactor cannot quietly switch conventions. Under `minIncluded` measurements the answer is
 * `unknown` — a p95 over three samples is a number, not an estimate.
 */
export function percentile(input: {
  values: readonly (number | undefined)[];
  p: number;
  population: string;
  minIncluded?: number;
}): Percentile {
  const { values, p, population } = input;
  const minIncluded = input.minIncluded ?? 5;
  const measured = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  const included = measured.length;
  const excluded = values.length - included;
  if (included < minIncluded) {
    return {
      state: "unknown",
      needs: `at least ${minIncluded} measured values`,
      included,
      excluded,
      population,
    };
  }
  const sorted = [...measured].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return { state: "known", value: sorted[rank] as number, included, excluded, population };
}

export type CoverageLabel =
  | { state: "covered" }
  | { state: "partial"; reason: "coverage-gap"; coveredSinceMs: number }
  | { state: "unknown"; reason: "not-started" | "window-precedes-coverage" };

/**
 * How much of a window a source can honestly answer for.
 *
 * **"NO ROWS" AND "NOTHING HAPPENED" ARE THE SAME BYTES AND DIFFERENT FACTS.** A table with no rows
 * in a window supports "0 failures" and "we were not watching" equally well, and only one of them
 * is safe to render. This is the per-source analogue of `spendCoverage.coverageStartedAt` for the
 * tables that have no coverage row: the honest floor is the OLDEST row the tenant has, because a
 * window that starts before it is a window this source cannot speak for.
 *
 * An explicit `coverageStartedAtMs` wins when present — a ledger knows when instrumentation began,
 * whereas the oldest surviving row only knows when the oldest SURVIVING row was written, and
 * retention makes those different numbers.
 */
export function coverageLabel(input: {
  sinceMs: number;
  untilMs: number;
  earliestRowAtMs: number | null;
  coverageStartedAtMs?: number | null;
}): CoverageLabel {
  const { sinceMs, untilMs, earliestRowAtMs } = input;
  const coverageStartedAtMs = input.coverageStartedAtMs ?? null;
  if (earliestRowAtMs === null && coverageStartedAtMs === null) {
    return { state: "unknown", reason: "not-started" };
  }
  const startedAt = coverageStartedAtMs ?? (earliestRowAtMs as number); // one of the two is non-null here
  if (startedAt >= untilMs) return { state: "unknown", reason: "window-precedes-coverage" };
  if (startedAt > sinceMs) {
    return { state: "partial", reason: "coverage-gap", coveredSinceMs: startedAt };
  }
  return { state: "covered" };
}
