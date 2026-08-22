// RPRT-01 report semantics (plan 26-14). Pure, DOM-free, no Convex.
//
// Every test here exists because a naive implementation of the same metric would report a number
// that is NOT TRUE. The names say which lie is being prevented.
import { describe, expect, test } from "vitest";
import { DASHBOARD_STATE_COPY, type DashboardBound } from "./dashboard";
import {
  type BoardPackInput,
  buildBoardPackMarkdown,
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

// ── BOARD PACK (26-16) ────────────────────────────────────────────────────────────────
//
// The pack LEAVES the product, so every test here names a sentence the pack must never print.
// A number with no coverage beside it is the defect this phase keeps re-shipping.

const PACK_TZ = "UTC";
const PACK_WINDOW = {
  sinceMs: 10 * DAY,
  untilMs: 20 * DAY,
  timeZone: PACK_TZ,
  timeZoneSource: "browser-fallback" as const,
};

const bound = (over: Partial<DashboardBound> = {}): DashboardBound => ({
  returned: 3,
  limit: 10,
  nextCursor: null,
  partial: false,
  ...over,
});

const covered = { state: "covered" } as const;

/** A fully covered, flag-free pack. Every test overrides exactly the one thing it is about. */
function input(
  over: {
    business?: Partial<BoardPackInput["business"]>;
    operations?: Partial<BoardPackInput["operations"]>;
    audit?: BoardPackInput["audit"];
  } = {},
): BoardPackInput {
  return {
    asOf: PACK_WINDOW.untilMs,
    window: PACK_WINDOW,
    business: {
      blueprint: { state: "not-built" },
      evaluation: { state: "no-review-run" },
      ...over.business,
    },
    operations: {
      delivery: { sentCount: 3, bound: bound(), coverage: covered },
      review: {
        terminals: 2,
        decisions: { approve: 2, edit_text: 1 },
        otherDecisions: 0,
        bound: bound(),
        coverage: covered,
      },
      latency: {
        state: "known",
        value: 1200,
        included: 9,
        excluded: 1,
        population: "p95 over 6 timed tools",
        truncated: false,
      },
      deadLetters: { openNow: 0, bound: bound({ returned: 0 }), windowed: false },
      feedback: { rated: 4, positive: 3, negative: 1, bound: bound(), coverage: covered },
      spend: { coverage: covered, readAt: "/dashboard/finance?tab=spend" },
      ...over.operations,
    },
    audit: over.audit ?? { rows: [], nextCursor: null },
  };
}

const lineWith = (markdown: string, needle: string): string =>
  markdown.split("\n").find((l) => l.includes(needle)) ?? "";

describe("buildBoardPackMarkdown", () => {
  test("a count whose coverage is UNKNOWN renders the reason and never a number", () => {
    // "0 sent" and "we were not watching" are the same bytes and different facts. This pack is a
    // file the owner forwards to someone else — the wrong one of those is a claim they repeat.
    for (const [reason, phrase] of [
      ["not-started", "instrumentation had not started"],
      ["window-precedes-coverage", "the window ends before measurement began"],
    ] as const) {
      const { markdown } = buildBoardPackMarkdown(
        input({
          operations: {
            ...input().operations,
            delivery: {
              sentCount: 0,
              bound: bound({ returned: 0 }),
              coverage: { state: "unknown", reason },
            },
          },
        }),
      );
      const line = lineWith(markdown, "Messages sent in the window:");
      expect(line).toContain(phrase);
      expect(line).not.toMatch(/\d/);
    }
  });

  test("a PARTIAL bound renders a floor, never a bare number", () => {
    const { markdown } = buildBoardPackMarkdown(
      input({
        operations: {
          ...input().operations,
          delivery: {
            sentCount: 1000,
            bound: bound({ returned: 1000, limit: 1000, partial: true, partialReason: "row-cap" }),
            coverage: covered,
          },
        },
      }),
    );
    const line = lineWith(markdown, "Messages sent in the window:");
    expect(line).toContain("at least 1000");
    expect(line).toContain(DASHBOARD_STATE_COPY.partial.label);
    expect(line).not.toBe("Messages sent in the window: 1000.");
  });

  test("a PARTIAL coverage says since when, so a late denominator is visible", () => {
    const { markdown } = buildBoardPackMarkdown(
      input({
        operations: {
          ...input().operations,
          feedback: {
            rated: 4,
            positive: 3,
            negative: 1,
            bound: bound(),
            coverage: { state: "partial", reason: "coverage-gap", coveredSinceMs: 15 * DAY },
          },
        },
      }),
    );
    expect(lineWith(markdown, "Rated in the window:")).toContain("partial since 1970-01-16");
  });

  test("dead letters render as OPEN NOW, never as a window count", () => {
    // `windowed: false` is a type-level statement. Printing this number inside a window section
    // would claim the tenant had N failures during those days; it is point-in-time.
    const { markdown } = buildBoardPackMarkdown(input());
    expect(lineWith(markdown, "open right now")).toContain("open right now (not a window count)");
  });

  test("an UNKNOWN latency prints its `needs` string and never a millisecond figure", () => {
    const { markdown } = buildBoardPackMarkdown(
      input({
        operations: {
          ...input().operations,
          latency: {
            state: "unknown",
            needs: "at least 5 measured values",
            included: 2,
            excluded: 0,
            population: "p95 over 6 timed tools",
            truncated: false,
          },
        },
      }),
    );
    const line = lineWith(markdown, "p95 tool latency:");
    expect(line).toContain("at least 5 measured values");
    expect(line).not.toMatch(/\d+\s*ms/);
  });

  test("the review table is DERIVED from the decisions record, and otherDecisions is never dropped", () => {
    // 26-14 shipped a permanent `edit: 0` by hand-typing a copy of a closed set. The pack must
    // inherit the derivation, and a literal this build does not know must still be visible.
    const { markdown } = buildBoardPackMarkdown(
      input({
        operations: {
          ...input().operations,
          review: {
            terminals: 7,
            decisions: { send_as_is: 4, edit_text: 2 },
            otherDecisions: 1,
            bound: bound(),
            coverage: covered,
          },
        },
      }),
    );
    expect(markdown).toContain("| send_as_is | 4 |");
    expect(markdown).toContain("| edit_text | 2 |");
    expect(markdown).toContain("| other (unrecognised literal) | 1 |");
    // A key nothing wrote must not appear with a manufactured zero.
    expect(markdown).not.toContain("| edit | 0 |");
    // Sorted, so the bytes are stable regardless of insertion order.
    expect(markdown.indexOf("| edit_text |")).toBeLessThan(markdown.indexOf("| send_as_is |"));
  });

  test("a segment with no fields renders `Not tracked yet`, never 0/0", () => {
    const { markdown } = buildBoardPackMarkdown(
      input({
        business: {
          blueprint: {
            state: "live",
            facts: { filled: 2, total: 11, missing: ["offer", "pricing"] },
            segments: [
              { id: "leads", label: "Leads", filled: 0, total: 0 },
              { id: "offer", label: "Offer", filled: 1, total: 3 },
            ],
          },
          evaluation: { state: "no-review-run" },
        },
      }),
    );
    expect(markdown).toContain("| Leads | Not tracked yet |");
    expect(markdown).toContain("| Offer | 1 of 3 |");
    expect(markdown).not.toContain("0 of 0");
  });

  test("an INCOMPARABLE movement prints its reason and never reads as stability", () => {
    const { markdown } = buildBoardPackMarkdown(
      input({
        business: {
          blueprint: { state: "not-built" },
          evaluation: {
            state: "run",
            framework: "growth-os",
            verdict: "gaps",
            findingCount: 6,
            createdAt: 12 * DAY,
            scorecard: { filled: 5, total: 8, missing: ["financials.cac"] },
            movement: { state: "incomparable", reason: "verdict-insufficient" },
          },
        },
      }),
    );
    const line = lineWith(markdown, "Movement since the previous run:");
    expect(line).toContain("not comparable (verdict-insufficient)");
    expect(markdown).not.toContain("no change");
  });

  test("spend renders coverage and the readAt pointer, and NEVER a total", () => {
    // A second sum over a different source is how two surfaces come to disagree about what the
    // tenant spent. The pack points at the ledger instead of restating it.
    const { markdown } = buildBoardPackMarkdown(input());
    const line = lineWith(markdown, "Coverage:");
    expect(line).toContain("/dashboard/finance?tab=spend");
    expect(markdown).not.toContain("$");
    expect(markdown.toLowerCase()).not.toContain("cents");
  });

  test("the markdown is byte-identical for the same input", () => {
    // The content hash is the replay key. Any clock, ambient locale or unordered iteration in the
    // builder would silently turn every regeneration into a second artifact.
    const a = buildBoardPackMarkdown(input());
    const b = buildBoardPackMarkdown(input());
    expect(a.markdown).toBe(b.markdown);
    expect(a.title).toBe(b.title);
  });

  test("partialSections counts every raised flag EXACTLY once", () => {
    expect(buildBoardPackMarkdown(input()).partialSections).toBe(0);

    const three = buildBoardPackMarkdown(
      input({
        operations: {
          ...input().operations,
          // flag 1: a capped scan
          review: {
            terminals: 2000,
            decisions: {},
            otherDecisions: 0,
            bound: bound({ returned: 2000, limit: 2000, partial: true, partialReason: "row-cap" }),
            coverage: covered,
          },
          // flag 2: a truncated latency sample
          latency: {
            state: "known",
            value: 900,
            included: 400,
            excluded: 0,
            population: "p95 over 6 timed tools",
            truncated: true,
          },
        },
        // flag 3: more governance rows than one page
        audit: { rows: [], nextCursor: "v1:123:abc" },
      }),
    );
    expect(three.partialSections).toBe(3);
    expect(three.markdown).toContain("3 figure(s) below are a floor");
  });

  test("governance rows carry when/event/actor only, and a next page says so", () => {
    const { markdown } = buildBoardPackMarkdown(
      input({
        audit: {
          rows: [{ ts: 12 * DAY, eventType: "gmail.sent", actor: "you" }],
          nextCursor: "v1:123:abc",
        },
      }),
    );
    expect(markdown).toContain("| 1970-01-13 00:00 | gmail.sent | you |");
    expect(markdown).toContain("More events not shown");
  });

  test("an empty section says so in the code-owned words, never with a bare zero", () => {
    const { markdown } = buildBoardPackMarkdown(input());
    expect(markdown).toContain(
      `${DASHBOARD_STATE_COPY.empty.label} — no blueprint has been confirmed.`,
    );
    expect(markdown).toContain(
      `${DASHBOARD_STATE_COPY.empty.label} — no governance events in this window.`,
    );
  });
});
