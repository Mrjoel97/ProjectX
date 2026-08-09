import { describe, expect, test } from "vitest";
import {
  activityFromSends,
  CASH_INPUTS,
  cashInputSpec,
  requireInputs,
  statedFigure,
  toCashInputs,
  validateCashInput,
} from "./cash";

const DAY = 24 * 60 * 60 * 1000;
// A fixed UTC instant, so the test never depends on the machine's clock or zone.
const NOW = Date.UTC(2026, 7, 9, 15, 30, 0);
const day = (offset: number) => Date.UTC(2026, 7, 9 - offset, 9, 0, 0);

describe("activityFromSends", () => {
  test("counts sends into UTC days, newest first, with no gaps in the window", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(0), day(1), day(3)],
      sinceMs: NOW - 4 * DAY,
      nowMs: NOW,
    });
    expect(result.perDay.map((d) => d.count)).toEqual([2, 1, 0, 1, 0]);
    expect(result.todayCount).toBe(2);
  });

  test("the streak counts consecutive days with at least one send, ending today", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(1), day(2), day(4)],
      sinceMs: NOW - 6 * DAY,
      nowMs: NOW,
    });
    expect(result.streakDays).toBe(3);
  });

  test("a day with no sends today ends the streak at zero, never at yesterday's value", () => {
    // Reporting "3-day streak" to someone who has not sent today is the flattering lie the
    // activity row exists to avoid: the row is a prompt to act, not a trophy.
    const result = activityFromSends({
      sentAtMs: [day(1), day(2), day(3)],
      sinceMs: NOW - 6 * DAY,
      nowMs: NOW,
    });
    expect(result.streakDays).toBe(0);
  });

  test("no sends at all is a real measured zero, not unknown", () => {
    const result = activityFromSends({ sentAtMs: [], sinceMs: NOW - 2 * DAY, nowMs: NOW });
    expect(result.todayCount).toBe(0);
    expect(result.streakDays).toBe(0);
    expect(result.perDay).toHaveLength(3);
  });

  test("a send outside the window is ignored rather than folded into the first bucket", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(30)],
      sinceMs: NOW - 2 * DAY,
      nowMs: NOW,
    });
    expect(result.perDay.reduce((sum, d) => sum + d.count, 0)).toBe(1);
  });

  test("last7Count sums exactly the newest 7 days — pinned against both an 8-day and an 11-day sum", () => {
    // 11-day window (offsets 0..10). Sends land on offsets 0,1,1,2,6,6,7,8 — one send on offset 7,
    // the day RIGHT AFTER the 7-day cutoff, so an off-by-one that includes it (slice(0, 8)) is
    // caught: the 7-day sum (offsets 0-6) is 6, the 8-day sum (offsets 0-7) is 7, and the whole
    // 11-day window is 8. Three different numbers pin both the lower edge (todayCount, below) and
    // the upper edge of the 7-day window, so a wrong slice direction OR a wrong window length (7
    // vs 8 vs the whole window) all show up as a failure here.
    const result = activityFromSends({
      sentAtMs: [day(0), day(1), day(1), day(2), day(6), day(6), day(7), day(8)],
      sinceMs: NOW - 10 * DAY,
      nowMs: NOW,
    });
    expect(result.todayCount).toBe(1);
    const eightDaySum = result.perDay.slice(0, 8).reduce((sum, d) => sum + d.count, 0);
    expect(eightDaySum).toBe(7);
    const wholeWindowSum = result.perDay.reduce((sum, d) => sum + d.count, 0);
    expect(wholeWindowSum).toBe(8);
    expect(result.last7Count).toBe(6);
    expect(result.last7Count).not.toBe(result.todayCount);
    expect(result.last7Count).not.toBe(eightDaySum);
    expect(result.last7Count).not.toBe(wholeWindowSum);
  });

  test("a window shorter than 7 days sums only the days that exist", () => {
    const result = activityFromSends({
      sentAtMs: [day(0), day(1), day(2)],
      sinceMs: NOW - 2 * DAY,
      nowMs: NOW,
    });
    expect(result.perDay).toHaveLength(3);
    expect(result.last7Count).toBe(3);
  });
});

describe("input validation at the trust boundary", () => {
  test("purchases per lifetime below 1 is REJECTED, not silently multiplied", () => {
    // Multiplying gross profit by 0.5 purchases produces a plausible-looking LTGP that is wrong.
    expect(validateCashInput("purchasesPerLifetime", 0.5)).toEqual({
      ok: false,
      reason: expect.stringMatching(/at least 1/i),
    });
    expect(validateCashInput("purchasesPerLifetime", 1)).toEqual({ ok: true });
  });

  test("money cannot be negative, infinite or NaN", () => {
    expect(validateCashInput("cashOnHand", -1).ok).toBe(false);
    expect(validateCashInput("cashOnHand", Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(validateCashInput("cashOnHand", Number.NaN).ok).toBe(false);
    expect(validateCashInput("cashOnHand", 0)).toEqual({ ok: true });
  });

  test("a percentage is bounded to 0-100", () => {
    expect(validateCashInput("referralPct", 101).ok).toBe(false);
    expect(validateCashInput("referralPct", 25)).toEqual({ ok: true });
  });

  test("a customer count is a whole number", () => {
    expect(validateCashInput("customerCount", 4.5).ok).toBe(false);
    expect(validateCashInput("customerCount", 4)).toEqual({ ok: true });
  });

  test("every input names what it unlocks — a field with no payoff should not be asked for", () => {
    for (const spec of CASH_INPUTS) expect(spec.unlocks.length).toBeGreaterThan(0);
  });

  test("no input is stored in two places", () => {
    const fields = CASH_INPUTS.map((spec) => spec.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

const state = (field: string, over: Record<string, unknown> = {}) =>
  ({
    field,
    value: 100,
    statedAt: NOW - DAY,
    stale: false,
    ...over,
  }) as never;

describe("the four truths", () => {
  test("an unanswered input is unknown and NAMES what is missing", () => {
    const figure = statedFigure(undefined, cashInputSpec("cac"), NOW);
    expect(figure).toEqual({
      state: "unknown",
      needs: expect.stringContaining("Customer acquisition cost"),
    });
  });

  test("a real zero is KNOWN, not unknown — measured nothing is an answer", () => {
    const figure = statedFigure(state("cac", { value: 0 }), cashInputSpec("cac"), NOW);
    expect(figure).toMatchObject({ state: "known", origin: "stated", value: 0 });
  });

  test("a stated input carries when it was said", () => {
    const figure = statedFigure(state("cac"), cashInputSpec("cac"), NOW);
    expect(figure).toMatchObject({
      state: "known",
      origin: "stated",
      statedAt: NOW - DAY,
      stale: false,
    });
  });

  test("past 90 days it is flagged stale rather than silently used", () => {
    const old = state("cac", { statedAt: NOW - 91 * DAY, stale: true });
    expect(statedFigure(old, cashInputSpec("cac"), NOW)).toMatchObject({ stale: true });
  });

  test("a derived figure is SUPPRESSED when any input is unknown, and names the missing one", () => {
    const inputs = toCashInputs([state("cac")]);
    const blocked = requireInputs(inputs, ["cac", "thirtyDayCashPerCustomer"]);
    expect(blocked).toEqual({
      state: "unknown",
      needs: expect.stringContaining("30-day cash per customer"),
    });
  });

  test("with every input present nothing is suppressed", () => {
    const inputs = toCashInputs([state("cac"), state("thirtyDayCashPerCustomer")]);
    expect(requireInputs(inputs, ["cac", "thirtyDayCashPerCustomer"])).toBeNull();
  });

  test("the FIRST missing input is named, so the prompt is one ask and not a list", () => {
    const blocked = requireInputs(toCashInputs([]), ["cac", "thirtyDayCashPerCustomer"]);
    expect(blocked).toMatchObject({ needs: expect.stringContaining("Customer acquisition cost") });
  });
});
