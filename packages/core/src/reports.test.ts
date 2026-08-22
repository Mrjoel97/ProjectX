// RPRT-01 report semantics (plan 26-14). Pure, DOM-free, no Convex.
//
// Every test here exists because a naive implementation of the same metric would report a number
// that is NOT TRUE. The names say which lie is being prevented.
import { describe, expect, test } from "vitest";
import {
  compareSnapshots,
  completenessOver,
  coverageLabel,
  type EvaluationSnapshot,
  gapKey,
  percentile,
} from "./reports";

const DAY = 24 * 60 * 60 * 1000;

const snapshot = (over: Partial<EvaluationSnapshot> = {}): EvaluationSnapshot => ({
  threadId: "proactive-review",
  framework: "growth-os",
  verdict: "gaps",
  findingCount: 6,
  gaps: [{ route: "offer", playbook: "grand-slam-offer", leverageRank: 1 }],
  createdAt: 1_000,
  ...over,
});

describe("gap identity", () => {
  test("a gap's identity is route/playbook — the key the engine already writes into delta", () => {
    // `runEvaluation` builds this key inline to compute `delta.gapsClosed`. Lifting it here means
    // the report and the engine cannot drift into two different notions of "the same gap".
    expect(gapKey({ route: "offer", playbook: "grand-slam-offer" })).toBe("offer/grand-slam-offer");
  });
});

describe("comparability — only comparable snapshots produce movement", () => {
  test("same thread and same framework compare", () => {
    const older = snapshot({
      createdAt: 500,
      gaps: [
        { route: "offer", playbook: "grand-slam-offer", leverageRank: 1 },
        { route: "leads", playbook: "core-four", leverageRank: 3 },
      ],
      findingCount: 4,
    });
    const result = compareSnapshots(snapshot(), older);
    expect(result).toEqual({
      state: "comparable",
      newFindings: 2,
      gapsClosed: ["leads/core-four"],
      gapsOpened: [],
    });
  });

  test("a DIFFERENT framework is not a comparison — a doc review is not a business diagnosis", () => {
    // The tenant's two newest rows routinely straddle three thread kinds: the weekly cron thread,
    // an arbitrary cockpit thread, and a per-session voice-doc thread. Diffing across them reports
    // movement between two things that were never measuring the same thing.
    expect(compareSnapshots(snapshot(), snapshot({ framework: "lean" }))).toEqual({
      state: "incomparable",
      reason: "framework-changed",
    });
    expect(compareSnapshots(snapshot(), snapshot({ threadId: "voice-doc:abc" }))).toEqual({
      state: "incomparable",
      reason: "different-thread",
    });
  });

  test("A RUN THAT COULD NOT ASSESS NEVER REPORTS PROGRESS", () => {
    // THE DEFECT THIS EXISTS FOR: when grounding fails, the engine clears `gaps` and sets
    // `verdict: "insufficient"`. Every previously open gap then looks CLOSED — a grounding hiccup
    // renders as a clean sweep. Both the verdict and the zero-findings branch are guarded, because
    // the engine sets them together and a future edit could set only one.
    const older = snapshot({
      createdAt: 500,
      gaps: [{ route: "money", playbook: "money-model", leverageRank: 2 }],
    });
    expect(compareSnapshots(snapshot({ verdict: "insufficient", gaps: [] }), older)).toEqual({
      state: "incomparable",
      reason: "verdict-insufficient",
    });
    expect(compareSnapshots(snapshot({ findingCount: 0, gaps: [] }), older)).toEqual({
      state: "incomparable",
      reason: "verdict-insufficient",
    });
  });

  test("AN UNASSESSED RUN IS NOT A BASELINE EITHER — the older side is guarded too", () => {
    // THE MIRROR OF THE DEFECT ABOVE, and the half a one-sided guard misses. Week 2 hiccups and
    // writes `insufficient` with empty gaps/findings. Week 3 reproduces week 1 byte for byte —
    // nothing changed. Diffed against week 2, a newer-only guard passes and reports "8 new
    // findings, 1 gap opened" for a week with no movement at all.
    const week3 = snapshot({
      createdAt: 900,
      findingCount: 8,
      gaps: [{ route: "money", playbook: "money-model", leverageRank: 2 }],
    });
    const hiccup = snapshot({ createdAt: 500, verdict: "insufficient", findingCount: 0, gaps: [] });
    expect(compareSnapshots(week3, hiccup)).toEqual({
      state: "incomparable",
      reason: "verdict-insufficient",
    });
    // The `!skillOk` path returns `insufficient` WITHOUT clearing gaps, so the verdict alone must
    // disqualify the baseline — the zero-findings condition does not imply it.
    const noRubric = snapshot({
      createdAt: 500,
      verdict: "insufficient",
      findingCount: 4,
      gaps: [{ route: "money", playbook: "money-model", leverageRank: 2 }],
    });
    expect(compareSnapshots(week3, noRubric)).toEqual({
      state: "incomparable",
      reason: "verdict-insufficient",
    });
  });

  test("a document review reports counts, never per-gap movement", () => {
    const older = snapshot({ framework: "document-review", createdAt: 500 });
    expect(compareSnapshots(snapshot({ framework: "document-review" }), older)).toEqual({
      state: "incomparable",
      reason: "doc-review-gap-collapse",
    });
  });

  test("no prior snapshot is UNKNOWN, never a clean slate of zero movement", () => {
    expect(compareSnapshots(snapshot(), null)).toEqual({
      state: "incomparable",
      reason: "no-prior-snapshot",
    });
  });

  test("newFindings never goes negative when findings drop", () => {
    const older = snapshot({ createdAt: 500, findingCount: 9 });
    const result = compareSnapshots(snapshot({ findingCount: 4 }), older);
    expect(result).toMatchObject({ state: "comparable", newFindings: 0 });
  });
});

describe("completeness over a CLOSED key set", () => {
  test("presence is per-key, over an ordered list — never a key count", () => {
    // THE DEFECT THIS EXISTS FOR: `BusinessBlueprint` is a TOTAL mapped type, so every one of its
    // 11 keys is always present and blankness is the VALUE `null`. `Object.keys(x).length` reads
    // 11/11 = "100% complete" for a completely blank blueprint.
    const keys = ["a", "b", "c"] as const;
    const filled = new Set(["a", "c"]);
    expect(completenessOver(keys, (k) => filled.has(k))).toEqual({
      filled: 2,
      total: 3,
      missing: ["b"],
    });
  });

  test("an empty key set is total 0 — a caller must not divide by it", () => {
    expect(completenessOver([], () => true)).toEqual({ filled: 0, total: 0, missing: [] });
  });

  test("missing preserves the declared order, so the output is byte-deterministic", () => {
    expect(completenessOver(["z", "y", "x"] as const, () => false).missing).toEqual([
      "z",
      "y",
      "x",
    ]);
  });
});

describe("percentiles name what they dropped", () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  test("nearest-rank on the INCLUDED set, with the excluded count beside it", () => {
    const p95 = percentile({ values, p: 0.95, population: "steps that finished" });
    expect(p95).toEqual({
      state: "known",
      value: 100,
      included: 10,
      excluded: 0,
      population: "steps that finished",
    });
    expect(percentile({ values, p: 0.5, population: "x" })).toMatchObject({ value: 50 });
    // Both ends pinned so a future refactor cannot silently switch to linear interpolation.
    expect(percentile({ values, p: 0, population: "x" })).toMatchObject({ value: 10 });
    expect(percentile({ values, p: 1, population: "x" })).toMatchObject({ value: 100 });
  });

  test("A STRUCTURAL ZERO IS NOT A MEASUREMENT — undefined and 0 are both excluded", () => {
    // THE DEFECT THIS EXISTS FOR: several writers persist `durationMs: 0` for a path they never
    // timed. Including those zeros yields a confident, flattering "0 ms p95" for a tenant whose
    // work was never measured at all.
    const result = percentile({
      values: [undefined, 0, 0, 120, 240, 360, 480],
      p: 0.5,
      population: "steps that reported a duration",
      minIncluded: 2,
    });
    expect(result).toEqual({
      state: "known",
      value: 240,
      included: 4,
      excluded: 3,
      population: "steps that reported a duration",
    });
  });

  test("too few measurements is UNKNOWN with its counts, never a number", () => {
    expect(percentile({ values: [5, 10], p: 0.95, population: "p", minIncluded: 5 })).toEqual({
      state: "unknown",
      needs: "at least 5 measured values",
      included: 2,
      excluded: 0,
      population: "p",
    });
    expect(percentile({ values: [], p: 0.5, population: "p" })).toMatchObject({
      state: "unknown",
      included: 0,
    });
  });

  test("negative values are excluded rather than sorted into the answer", () => {
    const r = percentile({ values: [-5, 100, 200], p: 0.5, population: "p", minIncluded: 1 });
    expect(r).toMatchObject({ included: 2, excluded: 1, value: 100 });
  });
});

describe("coverage — a window a source cannot answer for says so", () => {
  const window = { sinceMs: 10 * DAY, untilMs: 40 * DAY };

  test("a source with no rows at all is UNKNOWN, never zero", () => {
    // THE DEFECT THIS EXISTS FOR: "0 failures this period" and "no rows in this table" are
    // indistinguishable in the data and completely different to a reader.
    expect(coverageLabel({ ...window, earliestRowAtMs: null })).toEqual({
      state: "unknown",
      reason: "not-started",
    });
  });

  test("a window entirely before the first row is UNKNOWN", () => {
    expect(coverageLabel({ ...window, earliestRowAtMs: 50 * DAY })).toEqual({
      state: "unknown",
      reason: "window-precedes-coverage",
    });
  });

  test("a window that STARTS before coverage is partial, and says from when", () => {
    expect(coverageLabel({ ...window, earliestRowAtMs: 20 * DAY })).toEqual({
      state: "partial",
      reason: "coverage-gap",
      coveredSinceMs: 20 * DAY,
    });
  });

  test("an explicit coverage marker beats the oldest row, because it is the real start", () => {
    // A ledger knows when instrumentation began; the oldest surviving row only knows when the
    // oldest surviving row was written. Retention makes those different numbers.
    expect(
      coverageLabel({ ...window, earliestRowAtMs: 12 * DAY, coverageStartedAtMs: 25 * DAY }),
    ).toEqual({ state: "partial", reason: "coverage-gap", coveredSinceMs: 25 * DAY });
  });

  test("a fully covered window is covered", () => {
    expect(coverageLabel({ ...window, earliestRowAtMs: 5 * DAY })).toEqual({ state: "covered" });
    expect(
      coverageLabel({ ...window, earliestRowAtMs: 5 * DAY, coverageStartedAtMs: 9 * DAY }),
    ).toEqual({ state: "covered" });
  });
});
