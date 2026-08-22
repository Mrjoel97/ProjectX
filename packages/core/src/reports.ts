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

import { DASHBOARD_STATE_COPY, type DashboardBound } from "./dashboard";

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

// ── BOARD PACK (RPRT-01, plan 26-16) ──────────────────────────────────────────────────
//
// The pure half of the board pack: one immutable snapshot value in, markdown out. It lives HERE
// rather than in a new module because every honesty primitive it must not re-implement —
// `coverageLabel`, `percentile`, `compareSnapshots`, `completenessOver` — is already this file's,
// and the pack is a RENDERING of them.
//
// **THE INPUT TYPE IS THE HONEST-NUMBERS GUARD.** Every count is declared beside its
// `DashboardBound` and its `CoverageLabel`, so a flagless count is a compile error rather than a
// reviewer's memory. `reportPackData.snapshot` asserts `satisfies BoardPackInput` on the value it
// returns: if the read plane ever drops a bound, the build breaks before the pack can print a
// confident zero over a window nothing was watching.

/**
 * The captured board-pack snapshot, declared to structurally MATCH `reportPackData.snapshot`'s
 * return value so no mapping adapter exists between them. An adapter would be pure glue whose only
 * job is to be kept in sync, and a second projection of the same rows is how two surfaces come to
 * disagree.
 *
 * Deliberately ABSENT: `wormExport` and `activeSkills` (deployment-global / cross-tenant facts —
 * once bytes are inside a tenant vault row there is no gate left to re-apply), and the `sentMail`
 * rows (a 50-row sample rendered against a 1000-row `sentCount` prints a floor as a ratio, and the
 * recipient address is a personal identifier that must not ride a distributable PDF).
 */
export type BoardPackInput = {
  /** The window's EXCLUSIVE upper bound, never a wall clock — see `reportPackData.snapshot`. */
  readonly asOf: number;
  readonly window: {
    readonly sinceMs: number;
    readonly untilMs: number;
    readonly timeZone: string;
    readonly timeZoneSource: "tenant" | "browser-fallback";
  };
  readonly business: {
    readonly blueprint:
      | { readonly state: "not-built" }
      | {
          readonly state: "live";
          readonly facts: Completeness;
          readonly segments: readonly {
            readonly id: string;
            readonly label: string;
            readonly filled: number;
            readonly total: number;
          }[];
        };
    readonly evaluation:
      | { readonly state: "no-review-run" }
      | {
          readonly state: "run";
          readonly framework: string;
          readonly verdict: string;
          readonly findingCount: number;
          readonly createdAt: number;
          readonly scorecard: Completeness;
          readonly movement: SnapshotComparison;
        };
  };
  readonly operations: {
    readonly delivery: {
      readonly sentCount: number;
      readonly bound: DashboardBound;
      readonly coverage: CoverageLabel;
    };
    readonly review: {
      readonly terminals: number;
      readonly decisions: Readonly<Record<string, number>>;
      readonly otherDecisions: number;
      readonly bound: DashboardBound;
      readonly coverage: CoverageLabel;
    };
    readonly latency: Percentile & { readonly truncated: boolean };
    /** `windowed: false` is a TYPE-level statement that this number is point-in-time. */
    readonly deadLetters: {
      readonly openNow: number;
      readonly bound: DashboardBound;
      readonly windowed: false;
    };
    readonly feedback: {
      readonly rated: number;
      readonly positive: number;
      readonly negative: number;
      readonly bound: DashboardBound;
      readonly coverage: CoverageLabel;
    };
    /** Coverage and a POINTER. Never a total — a second sum is how two surfaces disagree. */
    readonly spend: { readonly coverage: CoverageLabel; readonly readAt: string };
  };
  readonly audit: {
    readonly rows: readonly {
      readonly ts: number;
      readonly eventType: string;
      readonly actor: string;
    }[];
    readonly nextCursor: string | null;
  };
};

/** Why a source cannot answer for this window at all. Never rendered as `0`. */
const UNKNOWN_COVERAGE: Record<Extract<CoverageLabel, { state: "unknown" }>["reason"], string> = {
  "not-started": "not measured — instrumentation had not started",
  "window-precedes-coverage": "not measured — the window ends before measurement began",
};

/**
 * An explicit locale and an explicit field set, because the pack's bytes are its identity.
 * `toLocaleDateString()` with the ambient locale would render the same window differently on two
 * machines, and the content hash is the replay key — a drifting format is a duplicate artifact.
 */
export const fmtDate = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));

export const fmtDateTime = (ms: number, timeZone: string): string =>
  `${fmtDate(ms, timeZone)} ${new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms))}`;

/** The floor half on its own, for the one count that has a bound but no coverage (dead letters). */
export const floorCell = (count: number, bound: DashboardBound): string =>
  bound.partial ? `at least ${count} (${DASHBOARD_STATE_COPY.partial.label})` : `${count}`;

/**
 * ONE count, rendered with everything that makes it honest, in a fixed precedence:
 *
 *  1. An UNKNOWN coverage never renders a number. "0 failures" and "we were not watching" are the
 *     same bytes and different facts, and a board pack LEAVES the product — the wrong one of those
 *     is a claim the owner will repeat to someone else.
 *  2. A capped scan is a FLOOR. `at least N`, never a bare `N`.
 *  3. A partial coverage says since when, so the reader can see the denominator start late.
 */
export function countCell(
  count: number,
  bound: DashboardBound,
  coverage: CoverageLabel,
  timeZone: string,
): string {
  if (coverage.state === "unknown") return UNKNOWN_COVERAGE[coverage.reason];
  const value = floorCell(count, bound);
  return coverage.state === "partial"
    ? `${value} — partial since ${fmtDate(coverage.coveredSinceMs, timeZone)}`
    : value;
}

export const coverageWord = (coverage: CoverageLabel, timeZone: string): string => {
  if (coverage.state === "unknown") return UNKNOWN_COVERAGE[coverage.reason];
  if (coverage.state === "partial")
    return `partial since ${fmtDate(coverage.coveredSinceMs, timeZone)}`;
  return "covered for the whole window";
};

/** A GitHub pipe table — the one table form `tokenizeMarkdown` parses. */
const table = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");

/**
 * Render one captured snapshot as board-pack markdown.
 *
 * PURE: no clock, no ambient locale, no iteration over an unordered set. The same input renders the
 * same bytes forever, which is exactly what lets `reportPack` use the content hash as the replay
 * key — two clicks on the same window are ONE artifact, not two.
 *
 * `partialSections` is derived HERE and handed back, so the audit payload reports the same number
 * the reader sees. Deriving it a second time in the action is how two counts of one thing disagree.
 */
export function buildBoardPackMarkdown(input: BoardPackInput): {
  title: string;
  markdown: string;
  partialSections: number;
} {
  const tz = input.window.timeZone;
  const { business, operations, audit } = input;
  const { delivery, review, latency, deadLetters, feedback, spend } = operations;

  // Every raised honesty flag, counted ONCE. A `true` here is a place where the pack is a floor, an
  // unknown or a truncation rather than a complete answer.
  const flags: boolean[] = [
    delivery.bound.partial,
    review.bound.partial,
    deadLetters.bound.partial,
    feedback.bound.partial,
    latency.truncated,
    audit.nextCursor !== null,
    delivery.coverage.state !== "covered",
    review.coverage.state !== "covered",
    feedback.coverage.state !== "covered",
    spend.coverage.state !== "covered",
  ];
  const partialSections = flags.filter(Boolean).length;

  const title = `Board pack ${fmtDate(input.window.sinceMs, tz)} to ${fmtDate(input.window.untilMs - 1, tz)}`;

  const out: string[] = [];
  out.push(`# ${title}`);
  out.push(
    `Window ${fmtDateTime(input.window.sinceMs, tz)} to ${fmtDateTime(input.window.untilMs, tz)} (exclusive), timezone ${tz} (${input.window.timeZoneSource}). As of ${fmtDateTime(input.asOf, tz)}.`,
  );
  out.push(
    partialSections === 0
      ? "Every figure below covers the whole window."
      : `${partialSections} figure(s) below are a floor, a truncation or an unknown rather than a complete answer. Each says so where it appears.`,
  );

  // ── Business ────────────────────────────────────────────────────────────────────────
  out.push("## Business");
  out.push("### Blueprint");
  if (business.blueprint.state === "not-built") {
    out.push(`${DASHBOARD_STATE_COPY.empty.label} — no blueprint has been confirmed.`);
  } else {
    const bp = business.blueprint;
    out.push(`Facts on file: ${bp.facts.filled} of ${bp.facts.total}.`);
    out.push(
      table(
        ["Segment", "Filled"],
        bp.segments.map((s) => [
          s.label,
          // NEVER "0/0": a segment with no fields is not 0% complete, it is NOT TRACKED. The
          // `leads` segment has `total === 0` today and would otherwise read as a failure.
          s.total === 0 ? "Not tracked yet" : `${s.filled} of ${s.total}`,
        ]),
      ),
    );
    if (bp.facts.missing.length > 0) out.push(`Still missing: ${bp.facts.missing.join(", ")}.`);
  }

  out.push("### Business evaluation");
  if (business.evaluation.state === "no-review-run") {
    out.push(
      `${DASHBOARD_STATE_COPY.empty.label} — the weekly review thread has no run in the record.`,
    );
  } else {
    const ev = business.evaluation;
    out.push(
      `Framework ${ev.framework}, verdict ${ev.verdict}, ${ev.findingCount} cited finding(s), run ${fmtDateTime(ev.createdAt, tz)}.`,
    );
    out.push(`Scorecard: ${ev.scorecard.filled} of ${ev.scorecard.total} fields answered.`);
    out.push(
      ev.movement.state === "comparable"
        ? `Movement since the previous run: ${ev.movement.newFindings} new finding(s), ${ev.movement.gapsClosed.length} gap(s) closed, ${ev.movement.gapsOpened.length} gap(s) opened.`
        : // NEVER "no change": an incomparable pair is two runs that were not measuring the same
          // subject, which is a different fact from stability.
          `Movement since the previous run: not comparable (${ev.movement.reason}).`,
    );
  }

  // ── Operations ──────────────────────────────────────────────────────────────────────
  out.push("## Operations");
  out.push("### Delivery");
  out.push(
    `Messages sent in the window: ${countCell(delivery.sentCount, delivery.bound, delivery.coverage, tz)}.`,
  );
  out.push(
    "Recipients are deliberately not listed here; the sent-mail record stays on the Reports page.",
  );

  out.push("### Review");
  out.push(
    `Terminal reviews in the window: ${countCell(review.terminals, review.bound, review.coverage, tz)}.`,
  );
  // DERIVED from the record, never a hand-typed row set. 26-14 shipped a permanent "edit: 0" by
  // re-typing a copy of a closed set; the pack inherits the derivation instead of restating it.
  const decisionRows: string[][] = Object.entries(review.decisions)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, count]) => [key, String(count)]);
  if (review.otherDecisions > 0) {
    // NAMED, not dropped. A decision literal this build does not know about still moved a number.
    decisionRows.push(["other (unrecognised literal)", String(review.otherDecisions)]);
  }
  out.push(
    decisionRows.length === 0
      ? `${DASHBOARD_STATE_COPY.empty.label} — no gate decisions were recorded.`
      : table(["Decision", "Count"], decisionRows),
  );

  out.push("### Latency");
  out.push(
    latency.state === "unknown"
      ? // NEVER a p95 invented from fewer measurements than it takes to have one.
        `p95 tool latency: not measured — needs ${latency.needs} (${latency.population}).`
      : `p95 tool latency: ${latency.value} ms (${latency.population}; ${latency.included} measured, ${latency.excluded} unmeasured value(s) excluded).`,
  );
  if (latency.truncated) {
    out.push(
      `That sample was capped per tool, so it describes the newest steps rather than the whole window (${DASHBOARD_STATE_COPY.partial.label}).`,
    );
  }

  out.push("### Dead letters");
  out.push(
    `${floorCell(deadLetters.openNow, deadLetters.bound)} open right now (not a window count).`,
  );

  out.push("### Feedback");
  out.push(
    `Rated in the window: ${countCell(feedback.rated, feedback.bound, feedback.coverage, tz)}.`,
  );
  out.push(`Of those counted: ${feedback.positive} positive, ${feedback.negative} negative.`);

  out.push("### Reasoning spend");
  out.push(
    `Coverage: ${coverageWord(spend.coverage, tz)}. The total is not restated here — read it at ${spend.readAt}.`,
  );

  // ── Governance ──────────────────────────────────────────────────────────────────────
  out.push("## Governance");
  out.push(
    audit.rows.length === 0
      ? `${DASHBOARD_STATE_COPY.empty.label} — no governance events in this window.`
      : table(
          ["When", "Event", "Actor"],
          audit.rows.map((r) => [fmtDateTime(r.ts, tz), r.eventType, r.actor]),
        ),
  );
  if (audit.nextCursor !== null) {
    out.push(`More events not shown — this is one page (${DASHBOARD_STATE_COPY.partial.label}).`);
  }

  return { title, markdown: `${out.join("\n\n")}\n`, partialSections };
}
