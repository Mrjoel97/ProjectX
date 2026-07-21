import { describe, expect, test } from "vitest";
import { classifyBreach } from "./optimizerBreach";

// A conservative, floor-guarded, cooldown-bounded breach check (IMPR-02). The CI job consults
// this before it spends any minutes. One bad rating below the floor can NEVER make it eligible.
const cfg = { negativeRateThreshold: 0.3, minSampleFloor: 20, cooldownMs: 604800000 }; // 7d
const NOW = 1_700_000_000_000;

describe("classifyBreach (IMPR-02 trigger policy)", () => {
  test("rate over threshold, count at floor, no prior run → eligible", () => {
    expect(
      classifyBreach({ downCount: 8, total: 20, lastRunAt: undefined, nowMs: NOW, cfg }),
    ).toEqual({ eligible: true, reason: "eligible", negativeRate: 0.4 });
  });

  test("below the sample floor → NOT eligible (one/few bad ratings never trigger)", () => {
    const r = classifyBreach({ downCount: 5, total: 5, lastRunAt: undefined, nowMs: NOW, cfg });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("below_sample_floor");
  });

  test("total 0 → below_sample_floor, no divide-by-zero", () => {
    const r = classifyBreach({ downCount: 0, total: 0, lastRunAt: undefined, nowMs: NOW, cfg });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("below_sample_floor");
    expect(r.negativeRate).toBe(0);
  });

  test("rate below threshold → below_threshold", () => {
    const r = classifyBreach({ downCount: 2, total: 20, lastRunAt: undefined, nowMs: NOW, cfg });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("below_threshold");
    expect(r.negativeRate).toBeCloseTo(0.1);
  });

  test("within cooldown → cooldown (crossed rate + floor, but too soon)", () => {
    const r = classifyBreach({
      downCount: 8,
      total: 20,
      lastRunAt: NOW - 3_600_000, // 1h ago, cooldown is 7d
      nowMs: NOW,
      cfg,
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("cooldown");
  });

  test("boundary: rate EXACTLY threshold, count EXACTLY floor, cooldown EXACTLY elapsed → eligible (inclusive)", () => {
    const r = classifyBreach({
      downCount: 6, // 6/20 = 0.30 exactly
      total: 20,
      lastRunAt: NOW - cfg.cooldownMs, // exactly one cooldown ago
      nowMs: NOW,
      cfg,
    });
    expect(r).toEqual({ eligible: true, reason: "eligible", negativeRate: 0.3 });
  });

  test("order of checks: below floor wins even when the rate is very high", () => {
    // 3/3 = 1.0 rate but only 3 samples — the floor guard is the point.
    const r = classifyBreach({ downCount: 3, total: 3, lastRunAt: undefined, nowMs: NOW, cfg });
    expect(r.reason).toBe("below_sample_floor");
  });
});
