import { describe, expect, test } from "vitest";
import { buildTelemetry, type TerminalOutcome } from "./buildTelemetry";

// The complete set of OPSG-01 measurement keys every built row must carry.
const OPSG01_KEYS = [
  "tokensIn",
  "tokensOut",
  "costUsd",
  "durationMs",
  "decisionCounts",
  "regenerateCount",
  "reviewOutcome",
] as const;

const usage = (inputTokens: number, outputTokens: number, costUsd: number) => ({
  inputTokens,
  outputTokens,
  costUsd,
});

describe("buildTelemetry (OPSG-01 terminal row builder)", () => {
  test("a sent outcome accumulates tokens/cost across route + draft + regenerates", () => {
    const outcome: TerminalOutcome = {
      reviewOutcome: "sent",
      durationMs: 4200,
      decisionCounts: { approve: 1, regenerate: 2 },
      regenerateCount: 2,
      // route + draft + two regenerate drafts
      usages: [usage(100, 20, 0.001), usage(200, 80, 0.004), usage(150, 60, 0.003), usage(150, 40, 0.002)],
    };
    const row = buildTelemetry(outcome);
    expect(row.tokensIn).toBe(600);
    expect(row.tokensOut).toBe(200);
    expect(row.costUsd).toBeCloseTo(0.01, 10);
    expect(row.durationMs).toBe(4200);
    expect(row.regenerateCount).toBe(2);
    expect(row.reviewOutcome).toBe("sent");
    // Counters are carried through verbatim, not recomputed.
    expect(row.decisionCounts).toEqual({ approve: 1, regenerate: 2 });
  });

  test("every terminal outcome yields a row with all OPSG-01 keys present", () => {
    for (const reviewOutcome of ["sent", "rejected", "expired", "failed"] as const) {
      const row = buildTelemetry({
        reviewOutcome,
        durationMs: 10,
        decisionCounts: {},
        regenerateCount: 0,
        usages: [],
      });
      for (const key of OPSG01_KEYS) {
        expect(key in row, `${reviewOutcome} row missing key ${key}`).toBe(true);
      }
      expect(row.reviewOutcome).toBe(reviewOutcome);
    }
  });

  test("a no-LLM outcome (rejected/expired) yields explicit nulls, not missing keys", () => {
    for (const reviewOutcome of ["rejected", "expired"] as const) {
      const row = buildTelemetry({
        reviewOutcome,
        durationMs: 5,
        decisionCounts: { reject: 1 },
        regenerateCount: 0,
        usages: [],
      });
      // present-or-null: the token/cost keys exist and are explicitly null.
      expect(row.tokensIn).toBeNull();
      expect(row.tokensOut).toBeNull();
      expect(row.costUsd).toBeNull();
      // non-usage fields are still concrete.
      expect(row.durationMs).toBe(5);
      expect(row.regenerateCount).toBe(0);
      expect(row.decisionCounts).toEqual({ reject: 1 });
    }
  });

  test("regenerateCount and decisionCounts are carried through, never recomputed from usages", () => {
    const row = buildTelemetry({
      reviewOutcome: "sent",
      durationMs: 1,
      // deliberately inconsistent with usages.length to prove no recomputation
      decisionCounts: { approve: 1, regenerate: 5 },
      regenerateCount: 5,
      usages: [usage(1, 1, 0)],
    });
    expect(row.regenerateCount).toBe(5);
    expect(row.decisionCounts).toEqual({ approve: 1, regenerate: 5 });
  });
});
