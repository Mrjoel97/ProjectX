import { describe, expect, test } from "vitest";
import { activityFromSends } from "./cash";

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

  test("last7Count sums the newest 7 days — distinct from todayCount and from the whole window", () => {
    // 11-day window (offsets 0..10). Sends land on offsets 0,1,1,2,6,6,8, so the newest-7-days
    // slice (offsets 0-6) sums to 6, todayCount (offset 0 alone) is 1, and the whole 11-day window
    // sums to 7 — three different numbers, so a wrong slice direction or window length shows up.
    const result = activityFromSends({
      sentAtMs: [day(0), day(1), day(1), day(2), day(6), day(6), day(8)],
      sinceMs: NOW - 10 * DAY,
      nowMs: NOW,
    });
    expect(result.todayCount).toBe(1);
    const wholeWindowSum = result.perDay.reduce((sum, d) => sum + d.count, 0);
    expect(wholeWindowSum).toBe(7);
    expect(result.last7Count).toBe(6);
    expect(result.last7Count).not.toBe(result.todayCount);
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
