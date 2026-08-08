import { describe, expect, it } from "vitest";
import {
  aggregatePulse,
  BLUEPRINT_SEGMENTS,
  composeReadout,
  dispatchToolFor,
  PULSE_WINDOW_MS,
  type PulseStep,
  recencyLevel,
  STALE_RUN_MS,
} from "./index";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * 60 * 1000;
const step = (over: Partial<PulseStep>): PulseStep => ({
  tool: "dispatchOfferArchitect",
  phase: "done",
  startedAt: NOW - 2 * DAY,
  endedAt: NOW - 2 * DAY + 5 * MIN,
  durationMs: 5 * MIN,
  ...over,
});

describe("dispatchToolFor", () => {
  it("maps every specialist segment to a distinct dispatch tool and null-specialist segments to null", () => {
    const tools = new Set<string>();
    for (const segment of BLUEPRINT_SEGMENTS) {
      const tool = dispatchToolFor(segment);
      if (segment.specialist === null) expect(tool).toBeNull();
      else {
        expect(tool).toMatch(/^dispatch/);
        expect(tools.has(tool as string)).toBe(false);
        tools.add(tool as string);
      }
    }
  });
});

describe("aggregatePulse", () => {
  it("counts a fresh running step as in flight, but not a stale one", () => {
    const fresh = step({
      phase: "running",
      startedAt: NOW - MIN,
      endedAt: undefined,
      durationMs: undefined,
    });
    const stale = step({
      phase: "running",
      startedAt: NOW - STALE_RUN_MS - MIN,
      endedAt: undefined,
      durationMs: undefined,
    });
    const out = aggregatePulse([fresh, stale], NOW);
    expect(out.offer?.inFlight).toBe(1);
    // The stale step still counts as activity — it happened — just not as breathing.
    expect(out.offer?.lastActivityAt).toBe(fresh.startedAt);
  });

  it("excludes steps outside the 30-day window and takes the median of done durations", () => {
    const old = step({ startedAt: NOW - PULSE_WINDOW_MS - DAY });
    const a = step({ durationMs: 2 * MIN, endedAt: NOW - DAY });
    const b = step({ durationMs: 4 * MIN, endedAt: NOW - DAY });
    const c = step({ durationMs: 60 * MIN, endedAt: NOW - DAY });
    const out = aggregatePulse([old, a, b, c], NOW);
    expect(out.offer?.runs30d).toBe(3);
    expect(out.offer?.medianRunMs).toBe(4 * MIN);
  });

  it("returns an entry for every specialist segment even with zero steps, and none for null-specialist segments", () => {
    const out = aggregatePulse([], NOW);
    expect(out.offer).toEqual({ inFlight: 0, lastActivityAt: null, runs30d: 0, medianRunMs: null });
    expect(out.foundation).toBeUndefined();
    expect(out.direction).toBeUndefined();
  });
});

describe("recencyLevel", () => {
  it("steps at 7 and 30 days and is null with no activity", () => {
    expect(recencyLevel(null, NOW)).toBeNull();
    expect(recencyLevel(NOW - 6 * DAY, NOW)).toBe("fresh");
    expect(recencyLevel(NOW - 8 * DAY, NOW)).toBe("recent");
    expect(recencyLevel(NOW - 31 * DAY, NOW)).toBe("quiet");
  });
});

describe("composeReadout", () => {
  const empty = { sent30d: 0, plansDone30d: 0, plansInFlight: 0 };

  it("returns null when nothing has ever moved", () => {
    expect(composeReadout(aggregatePulse([], NOW), empty, NOW)).toBeNull();
  });

  it("leads with in-flight runs, then plans in motion, then sent count, then the quietest section", () => {
    const pulse = aggregatePulse(
      [
        step({ phase: "running", startedAt: NOW - MIN, endedAt: undefined, durationMs: undefined }),
        step({
          tool: "dispatchLeadEngine",
          startedAt: NOW - 20 * DAY - MIN,
          endedAt: NOW - 20 * DAY,
        }),
      ],
      NOW,
    );
    const text = composeReadout(pulse, { sent30d: 4, plansDone30d: 1, plansInFlight: 2 }, NOW);
    expect(text).toBe(
      "Offer run in flight · 2 plans in motion · 4 emails sent in 30 days · Leads quiet 20 days",
    );
  });

  it("pluralizes correctly at one", () => {
    const text = composeReadout(
      aggregatePulse([], NOW),
      { sent30d: 1, plansDone30d: 0, plansInFlight: 1 },
      NOW,
    );
    expect(text).toBe("1 plan in motion · 1 email sent in 30 days");
  });
});
