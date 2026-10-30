import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEDIA_DAILY_BUDGET_CENTS,
  mediaDailyCharge,
  mediaTaskIncreaseCents,
} from "./mediaBudget";

describe("one-task media allowance", () => {
  it("keeps the hundred-dollar base and computes only the current shortfall", () => {
    expect(DEFAULT_MEDIA_DAILY_BUDGET_CENTS).toBe(10_000);
    expect(mediaTaskIncreaseCents(6000, 10_000)).toBe(0);
    expect(mediaTaskIncreaseCents(12_000, 10_000)).toBe(2000);
    expect(mediaTaskIncreaseCents(12_000, 0)).toBe(12_000);
  });
  it("debits normal allowance first, keeping approved extra local to this task", () => {
    expect(mediaDailyCharge(600, 1000, 0)).toEqual({ baseCents: 600, extraCents: 0 });
    expect(mediaDailyCharge(600, 400, 300)).toEqual({ baseCents: 400, extraCents: 200 });
    expect(mediaDailyCharge(600, 0, 600)).toEqual({ baseCents: 0, extraCents: 600 });
    expect(mediaDailyCharge(600, 0, 599)).toBeNull();
  });
  it("refuses malformed monetary values rather than creating credit", () => {
    for (const bad of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(mediaTaskIncreaseCents(bad, 1000)).toBeNull();
      expect(mediaTaskIncreaseCents(100, bad)).toBeNull();
      expect(mediaDailyCharge(100, 1000, bad)).toBeNull();
    }
  });
});
