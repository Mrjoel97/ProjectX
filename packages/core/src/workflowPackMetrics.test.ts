import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  citationCoverage,
  completionOutcomes,
  followUpRecovery,
  missingSourceSurprise,
  PACK_DERIVED_METRIC_SOURCES,
  PACK_EVENTS,
  PACK_OUTCOMES,
  type PackMetricEvent,
  planDecisions,
  recommendationAcceptance,
  timeToFirstUsefulOutcome,
  unsupportedClaimRate,
} from "./workflowPackMetrics";

// 27-03 Task 1 (PACK-04). The success measures for the pack pilot, defined as pure functions over a
// closed event vocabulary so the definition is reviewable and cannot drift from what a dashboard
// happens to compute.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a measure with no data says so. It never invents a success.
// A zero denominator is `not_applicable`, never 100% and never 0% — "0 of 0 claims were cited" is
// as wrong reported as 1.0 (perfect) as it is reported as 0.0 (terrible), and both have shipped in
// this repo before (26-14's permanent `edit: 0`).

/** Minimal event builder — every field explicit, because `| null` is what the type demands. */
const ev = (over: Partial<PackMetricEvent> & Pick<PackMetricEvent, "event">): PackMetricEvent => ({
  packId: "brand-review",
  runId: "r1",
  createdAt: 1_000,
  outcome: null,
  recommendationId: null,
  sourceExpectedCount: null,
  sourceAvailableCount: null,
  preflightMissingCount: null,
  runtimeMissingCount: null,
  claimCount: null,
  citedClaimCount: null,
  unsupportedClaimCount: null,
  provider: null,
  workflow: null,
  status: null,
  subjectRef: null,
  itemCount: null,
  pageCount: null,
  retryCount: null,
  evidenceCount: null,
  unknownCount: null,
  suppressedCount: null,
  capped: null,
  partial: null,
  coverage: null,
  confidence: null,
  hasGap: null,
  observedAt: null,
  ...over,
});

describe("the vocabulary is closed and matches the table it is read from", () => {
  // THE CLOSED-UNION TRAP again, from the read side. `workflowPackEvents.event` and `.outcome` are
  // closed `v.literal` unions; a name here that has no literal there describes rows that can never
  // exist, and a literal there with no name here is a row every metric silently ignores.
  // MUTATION that must turn this RED: delete one literal from either union in schema.ts.
  test("every event name and outcome has a literal in workflowPackEvents", () => {
    const src = readFileSync(
      new URL("../../backend/convex/schema.ts", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const table = src.slice(src.indexOf("workflowPackEvents: defineTable"));
    expect(table.length, "workflowPackEvents not found in schema.ts").toBeGreaterThan(0);

    const between = (from: string, to: string) => {
      // Both anchors asserted present: a moved anchor makes `indexOf` return -1, and `slice(a, -1)`
      // silently widens the window instead of failing — which is how a parity scan rots into one
      // that passes because it is reading the wrong region.
      const start = table.indexOf(from);
      const end = table.indexOf(to);
      expect(start, `anchor "${from}" not found in schema.ts`).toBeGreaterThan(-1);
      expect(end, `anchor "${to}" not found in schema.ts`).toBeGreaterThan(start);
      return [...table.slice(start, end).matchAll(/v\.literal\("([^"]+)"\)/g)]
        .map((m) => m[1] as string)
        .sort();
    };

    expect(between("event: v.union(", "/** Terminal outcome")).toEqual([...PACK_EVENTS].sort());
    expect(between("outcome: v.optional(", "/** Pairs `recommendation_accepted`")).toEqual(
      [...PACK_OUTCOMES].sort(),
    );
  });

  // THE STRUCTURAL HALF OF "never re-emit cost or latency". `PackMetricEvent` has nowhere to put
  // either, so no function in this module can produce a second cost or latency number — the
  // prohibition is a property of the type, not a rule someone has to remember.
  // MUTATION that must turn this RED: add `costUsd` or `durationMs` to PackMetricEvent.
  test("no metric can produce a cost or latency number — the input type has no such field", () => {
    const keys = Object.keys(ev({ event: "run_started" }));
    expect(keys.filter((k) => /cost|usd|cents|duration|latency|ms$|elapsed/i.test(k))).toEqual([]);
    // …and the join to their real owners is code-owned, so a reader is told WHERE to get them.
    expect(PACK_DERIVED_METRIC_SOURCES.cost).toEqual({
      table: "spendEvents",
      rail: "reasoning",
      index: "by_correlation",
      field: "amountCents",
    });
    expect(PACK_DERIVED_METRIC_SOURCES.latency.table).toBe("telemetry");
    expect(PACK_DERIVED_METRIC_SOURCES.latency.field).toBe("durationMs");
  });
});

describe("a zero denominator is not_applicable, never an invented success", () => {
  test("citation coverage over zero claims is not_applicable — not 1.0, not 0.0", () => {
    const zeroClaims = [
      ev({ event: "run_completed", outcome: "useful", claimCount: 0, citedClaimCount: 0 }),
    ];
    expect(citationCoverage(zeroClaims)).toEqual({
      kind: "not_applicable",
      reason: "zero_denominator",
    });
    expect(citationCoverage([])).toEqual({ kind: "not_applicable", reason: "no_data" });
  });

  test("citation coverage pools claims across runs", () => {
    expect(
      citationCoverage([
        ev({ event: "run_completed", runId: "a", claimCount: 4, citedClaimCount: 3 }),
        ev({ event: "run_completed", runId: "b", claimCount: 6, citedClaimCount: 2 }),
      ]),
    ).toEqual({ kind: "ratio", numerator: 5, denominator: 10, value: 0.5 });
  });

  test("unsupported-claim rate has the same zero-denominator semantics", () => {
    expect(
      unsupportedClaimRate([
        ev({ event: "run_completed", claimCount: 0, unsupportedClaimCount: 0 }),
      ]),
    ).toEqual({ kind: "not_applicable", reason: "zero_denominator" });
    expect(
      unsupportedClaimRate([
        ev({ event: "run_completed", claimCount: 4, unsupportedClaimCount: 1 }),
      ]),
    ).toEqual({ kind: "ratio", numerator: 1, denominator: 4, value: 0.25 });
  });

  test("recommendation acceptance with nothing shown is not_applicable", () => {
    expect(recommendationAcceptance([])).toEqual({ kind: "not_applicable", reason: "no_data" });
  });
});

describe("recommendation acceptance pairs on the exact recommendation", () => {
  test("acceptance is counted only against a recommendation that was shown", () => {
    const events = [
      ev({ event: "recommendation_shown", recommendationId: "x" }),
      ev({ event: "recommendation_shown", recommendationId: "y" }),
      ev({ event: "recommendation_accepted", recommendationId: "x" }),
      // An acceptance with no matching impression cannot inflate the numerator above the
      // denominator — it is ignored, not counted, because nothing was shown to accept.
      ev({ event: "recommendation_accepted", recommendationId: "ghost" }),
    ];
    expect(recommendationAcceptance(events)).toEqual({
      kind: "ratio",
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
  });

  test("the same recommendation shown twice is one impression, accepted twice is one acceptance", () => {
    expect(
      recommendationAcceptance([
        ev({ event: "recommendation_shown", recommendationId: "x" }),
        ev({ event: "recommendation_shown", recommendationId: "x" }),
        ev({ event: "recommendation_accepted", recommendationId: "x" }),
        ev({ event: "recommendation_accepted", recommendationId: "x" }),
      ]),
    ).toEqual({ kind: "ratio", numerator: 1, denominator: 1, value: 1 });
  });

  // A shown/accepted pair carrying no id cannot be attributed, so it is not counted at all.
  test("an impression with no recommendation id is not counted", () => {
    expect(recommendationAcceptance([ev({ event: "recommendation_shown" })])).toEqual({
      kind: "not_applicable",
      reason: "no_data",
    });
  });
});

describe("missing-connector surprise is runtime BEYOND what preflight announced", () => {
  // The honest-partial contract's own measure: a source the pack said up front it could not see is
  // not a surprise. Only a source that went missing DURING the run is.
  test("an announced miss is not a surprise; an unannounced one is", () => {
    const announced = ev({
      event: "run_completed",
      runId: "a",
      preflightMissingCount: 2,
      runtimeMissingCount: 2,
    });
    const surprised = ev({
      event: "run_completed",
      runId: "b",
      preflightMissingCount: 1,
      runtimeMissingCount: 3,
    });
    expect(missingSourceSurprise([announced, surprised])).toEqual({
      kind: "ratio",
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
    expect(missingSourceSurprise([announced])).toEqual({
      kind: "ratio",
      numerator: 0,
      denominator: 1,
      value: 0,
    });
  });

  test("a run that reported neither count is outside the denominator, not a silent zero", () => {
    expect(missingSourceSurprise([ev({ event: "run_completed", runId: "a" })])).toEqual({
      kind: "not_applicable",
      reason: "no_data",
    });
  });
});

describe("plan decisions and completion outcomes are total counts over closed enums", () => {
  test("every decision is counted and an absent one reads 0, never undefined", () => {
    expect(
      planDecisions([
        ev({ event: "plan_approved" }),
        ev({ event: "plan_approved" }),
        ev({ event: "plan_rejected" }),
        ev({ event: "run_started" }),
      ]),
    ).toEqual({ approved: 2, edited: 0, rejected: 1 });
  });

  test("every outcome in the closed enum has a count, including the ones that never happened", () => {
    const counts = completionOutcomes([
      ev({ event: "run_completed", outcome: "useful" }),
      ev({ event: "run_completed", outcome: "partial" }),
      ev({ event: "run_failed", outcome: "failed" }),
      // A terminal event with no outcome recorded cannot be counted as anything.
      ev({ event: "run_completed", outcome: null }),
    ]);
    expect(counts).toEqual({
      useful: 1,
      partial: 1,
      blocked: 0,
      refused: 0,
      failed: 1,
      no_findings: 0,
    });
    expect(Object.keys(counts).sort()).toEqual([...PACK_OUTCOMES].sort());
  });
});

describe("time to first useful outcome reports unknown rather than guessing", () => {
  const useful = ev({ event: "run_completed", outcome: "useful", createdAt: 5_000 });

  test("known when both ends exist", () => {
    expect(timeToFirstUsefulOutcome([useful], 1_000)).toEqual({ kind: "known", ms: 4_000 });
  });

  test("unknown when onboarding was never timestamped", () => {
    expect(timeToFirstUsefulOutcome([useful], null)).toEqual({
      kind: "unknown",
      reason: "no_onboarding_timestamp",
    });
  });

  test("unknown when nothing useful has completed", () => {
    expect(
      timeToFirstUsefulOutcome([ev({ event: "run_completed", outcome: "partial" })], 1_000),
    ).toEqual({ kind: "unknown", reason: "no_useful_outcome" });
  });

  // A negative duration is not a fast onboarding, it is a broken clock or a mis-stamped row.
  // Reporting it as a number would put a nonsense figure into the pilot's headline measure.
  test("unknown rather than negative when the useful run predates onboarding", () => {
    expect(timeToFirstUsefulOutcome([useful], 9_000)).toEqual({
      kind: "unknown",
      reason: "useful_precedes_onboarding",
    });
  });

  test("the FIRST useful outcome wins, not the last", () => {
    expect(
      timeToFirstUsefulOutcome(
        [ev({ event: "run_completed", outcome: "useful", createdAt: 9_000 }), useful],
        1_000,
      ),
    ).toEqual({ kind: "known", ms: 4_000 });
  });
});

describe("follow-up recovery asks whether a bad first run was ever redeemed", () => {
  const bad = (runId: string, createdAt: number, outcome: "blocked" | "failed" | "refused") =>
    ev({ event: "run_completed", runId, createdAt, outcome });

  test("a later successful run of the SAME pack redeems an earlier bad one", () => {
    expect(
      followUpRecovery([
        bad("a", 1_000, "blocked"),
        ev({ event: "run_completed", runId: "b", createdAt: 2_000, outcome: "useful" }),
      ]),
    ).toEqual({ kind: "ratio", numerator: 1, denominator: 1, value: 1 });
  });

  test("an EARLIER success does not redeem a later failure", () => {
    expect(
      followUpRecovery([
        ev({ event: "run_completed", runId: "b", createdAt: 500, outcome: "useful" }),
        bad("a", 1_000, "failed"),
      ]),
    ).toEqual({ kind: "ratio", numerator: 0, denominator: 1, value: 0 });
  });

  test("a success in a DIFFERENT pack does not redeem it", () => {
    expect(
      followUpRecovery([
        bad("a", 1_000, "refused"),
        ev({
          event: "run_completed",
          packId: "process-sop",
          runId: "b",
          createdAt: 2_000,
          outcome: "useful",
        }),
      ]),
    ).toEqual({ kind: "ratio", numerator: 0, denominator: 1, value: 0 });
  });

  test("with no bad runs at all there is nothing to recover from", () => {
    expect(followUpRecovery([ev({ event: "run_completed", outcome: "useful" })])).toEqual({
      kind: "not_applicable",
      reason: "no_data",
    });
  });
});
