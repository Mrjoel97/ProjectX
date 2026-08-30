import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  MAX_LOOKAHEAD_DAYS,
  nextOccurrence,
  type Occurrence,
  occurrenceKey,
  resolveLocalInstant,
  wallPartsAt,
  zoneOffsetMs,
} from "./routineSchedule";

// 29-11 Task 1 — THE RECURRENCE SPIKE, RUN.
//
// Every DST expectation below is an ABSOLUTE INSTANT written as an ISO string, not a
// re-statement of what the implementation returned. They are checkable by hand against the
// tzdata rules: US DST 2026 begins 2026-03-08 02:00 local (-05:00 -> -04:00) and ends
// 2026-11-01 02:00 local (-04:00 -> -05:00); EU DST 2026 begins 2026-03-29 01:00 UTC and ends
// 2026-10-25 01:00 UTC; Lord Howe's transition is a THIRTY-minute step (+10:30 -> +11:00), which
// is here because a half-hour gap breaks any implementation that assumes DST means "one hour".
//
// This module is a spike. Nothing imports it at runtime, and this file asserts that too.

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("resolveLocalInstant: the three DST cases, asked of ICU and round-tripped", () => {
  test("a fixed-offset zone has one instant per wall time and no disambiguation", () => {
    const r = resolveLocalInstant(2026, 3, 9, 8, 30, "Asia/Kolkata"); // UTC+05:30, no DST ever
    expect(r.disambiguation).toBe("exact");
    expect(iso(r.utcMs)).toBe("2026-03-09T03:00:00.000Z");
  });

  test("New York spring forward: 02:30 does not exist, so the answer is the transition itself", () => {
    const r = resolveLocalInstant(2026, 3, 8, 2, 30, "America/New_York");
    expect(r.disambiguation).toBe("gap_shifted");
    // 07:00Z is the exact instant EST becomes EDT. The local reading is 03:00, never 02:30.
    expect(iso(r.utcMs)).toBe("2026-03-08T07:00:00.000Z");
    const back = wallPartsAt(r.utcMs, "America/New_York");
    expect([back.h, back.mi]).toEqual([3, 0]);
    // One second earlier the zone is still EST and the clock still reads 01:59:59 — i.e. the
    // returned instant really is the FIRST instant that exists after the requested one.
    expect(wallPartsAt(r.utcMs - 1000, "America/New_York").h).toBe(1);
  });

  test("Berlin spring forward: same rule, different transition instant", () => {
    const r = resolveLocalInstant(2026, 3, 29, 2, 30, "Europe/Berlin");
    expect(r.disambiguation).toBe("gap_shifted");
    expect(iso(r.utcMs)).toBe("2026-03-29T01:00:00.000Z");
    expect(wallPartsAt(r.utcMs, "Europe/Berlin").h).toBe(3);
  });

  test("a THIRTY-minute gap (Lord Howe) resolves to its own transition, not a whole hour", () => {
    const r = resolveLocalInstant(2026, 10, 4, 2, 15, "Australia/Lord_Howe");
    expect(r.disambiguation).toBe("gap_shifted");
    expect(iso(r.utcMs)).toBe("2026-10-03T15:30:00.000Z");
    const back = wallPartsAt(r.utcMs, "Australia/Lord_Howe");
    expect([back.h, back.mi]).toEqual([2, 30]);
    expect(zoneOffsetMs(r.utcMs, "Australia/Lord_Howe")).toBe(11 * HOUR);
    expect(zoneOffsetMs(r.utcMs - 1000, "Australia/Lord_Howe")).toBe(10.5 * HOUR);
  });

  test("New York fall back: 01:30 happens twice and the FIRST one is chosen", () => {
    const r = resolveLocalInstant(2026, 11, 1, 1, 30, "America/New_York");
    expect(r.disambiguation).toBe("ambiguous_first");
    expect(iso(r.utcMs)).toBe("2026-11-01T05:30:00.000Z"); // 01:30 EDT
    // The SECOND 01:30 is a real instant an hour later, and it is not what we returned.
    expect(wallPartsAt(Date.parse("2026-11-01T06:30:00.000Z"), "America/New_York")).toMatchObject({
      h: 1,
      mi: 30,
    });
    expect(r.utcMs).toBeLessThan(Date.parse("2026-11-01T06:30:00.000Z"));
  });

  test("Berlin fall back picks the earlier (summer-time) instant", () => {
    const r = resolveLocalInstant(2026, 10, 25, 2, 30, "Europe/Berlin");
    expect(r.disambiguation).toBe("ambiguous_first");
    expect(iso(r.utcMs)).toBe("2026-10-25T00:30:00.000Z"); // 02:30 CEST, not 02:30 CET
  });
});

describe("nextOccurrence: the wall time is what is preserved, not the interval", () => {
  const daily = (hour: number, minute: number, timeZone: string) =>
    ({ timeZone, hour, minute, cadence: { frequency: "daily" } }) as const;

  const must = nextOccurrence;

  const walk = (fromIso: string, rule: Parameters<typeof nextOccurrence>[1], count: number) => {
    const out: Occurrence[] = [];
    let t = Date.parse(fromIso);
    for (let i = 0; i < count; i++) {
      const o = must(t, rule);
      out.push(o);
      t = o.utcMs;
    }
    return out;
  };

  test("08:30 New York stays 08:30 across spring forward, and that day is 23 hours long", () => {
    const [before, after] = walk("2026-03-07T00:00:00Z", daily(8, 30, "America/New_York"), 2) as [
      Occurrence,
      Occurrence,
    ];
    expect(iso(before.utcMs)).toBe("2026-03-07T13:30:00.000Z"); // 08:30 EST
    expect(iso(after.utcMs)).toBe("2026-03-08T12:30:00.000Z"); // 08:30 EDT
    expect(after.utcMs - before.utcMs).toBe(23 * HOUR);
    expect(before.resolvedLocalTime).toBe("08:30");
    expect(after.resolvedLocalTime).toBe("08:30");
  });

  test("01:30 New York across fall back: one occurrence per local date, and 25 hours after it", () => {
    const runs = walk("2026-10-31T12:00:00Z", daily(1, 30, "America/New_York"), 3);
    expect(runs.map((r) => r.localDate)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(runs.map((r) => iso(r.utcMs))).toEqual([
      "2026-11-01T05:30:00.000Z",
      "2026-11-02T06:30:00.000Z",
      "2026-11-03T06:30:00.000Z",
    ]);
    expect(runs[0]?.disambiguation).toBe("ambiguous_first");
    // The repeated wall hour does NOT create a second run: the next occurrence after the first
    // 01:30 is the NEXT LOCAL DATE, an hour past the second 01:30 (06:30Z), not 06:30Z itself.
    expect((runs[1]?.utcMs ?? 0) - (runs[0]?.utcMs ?? 0)).toBe(25 * HOUR);
  });

  test("02:30 New York on the gap day fires once, at 03:00 local, then returns to 02:30", () => {
    const runs = walk("2026-03-07T12:00:00Z", daily(2, 30, "America/New_York"), 2);
    expect(runs.map((r) => [r.localDate, iso(r.utcMs), r.resolvedLocalTime])).toEqual([
      ["2026-03-08", "2026-03-08T07:00:00.000Z", "03:00"],
      ["2026-03-09", "2026-03-09T06:30:00.000Z", "02:30"],
    ]);
    // `localTime` is what the user asked for and stays stable — it is the key material.
    expect(runs.map((r) => r.localTime)).toEqual(["02:30", "02:30"]);
  });

  test("weekly cadence advances a local week, on the local weekday", () => {
    const rule = {
      timeZone: "Asia/Kolkata",
      hour: 8,
      minute: 30,
      cadence: { frequency: "weekly", weekday: 1 },
    } as const;
    const runs = walk("2026-03-06T00:00:00Z", rule, 3);
    expect(runs.map((r) => r.localDate)).toEqual(["2026-03-09", "2026-03-16", "2026-03-23"]);
    expect(runs.map((r) => iso(r.utcMs))).toEqual([
      "2026-03-09T03:00:00.000Z",
      "2026-03-16T03:00:00.000Z",
      "2026-03-23T03:00:00.000Z",
    ]);
  });

  test("the returned occurrence is always strictly after the instant asked about", () => {
    const rule = daily(8, 30, "America/New_York");
    const exact = Date.parse("2026-03-07T13:30:00.000Z");
    expect(iso(must(exact, rule).utcMs)).toBe("2026-03-08T12:30:00.000Z");
    expect(iso(must(exact - 1, rule).utcMs)).toBe("2026-03-07T13:30:00.000Z");
  });

  test("the walk starts from the caller's LOCAL date, not the UTC date", () => {
    // 2026-03-07T01:00Z is still 2026-03-06 20:00 in New York. A walk that started from the UTC
    // calendar date (03-07) would skip that evening's 23:00 run entirely and answer a day late.
    const rule = daily(23, 0, "America/New_York");
    const o = must(Date.parse("2026-03-07T01:00:00.000Z"), rule);
    expect(o.localDate).toBe("2026-03-06");
    expect(iso(o.utcMs)).toBe("2026-03-07T04:00:00.000Z");
  });

  test("bad rule input is refused at the boundary, not silently coerced", () => {
    expect(() => nextOccurrence(0, { ...daily(24, 0, "UTC") })).toThrow(/hour/);
    expect(() => nextOccurrence(0, { ...daily(1, 60, "UTC") })).toThrow(/minute/);
    expect(() => nextOccurrence(0, { ...daily(1, 0, "Mars/Olympus") })).toThrow(RangeError);
    expect(() =>
      nextOccurrence(0, {
        timeZone: "UTC",
        hour: 1,
        minute: 0,
        cadence: { frequency: "weekly", weekday: 7 },
      }),
    ).toThrow(/weekday/);
  });
});

describe("occurrenceKey: the run identity that makes a repeated wall hour a no-op", () => {
  test("both 01:30s of a fall-back night produce the SAME key", () => {
    const first = resolveLocalInstant(2026, 11, 1, 1, 30, "America/New_York");
    const second = Date.parse("2026-11-01T06:30:00.000Z");
    expect(first.utcMs).not.toBe(second);
    const keyOf = (utcMs: number) => {
      const p = wallPartsAt(utcMs, "America/New_York");
      return occurrenceKey({
        routineId: "rt_7",
        localDate: `${p.y}-11-0${p.d}`,
        localTime: `0${p.h}:${p.mi}`,
        templateVersion: 4,
      });
    };
    expect(keyOf(first.utcMs)).toBe(keyOf(second));
    expect(keyOf(first.utcMs)).toBe("rt_7|2026-11-01T01:30|v4");
  });

  test("the template version is part of the key, so a version bump is a different run", () => {
    const base = { routineId: "rt_7", localDate: "2026-11-01", localTime: "01:30" };
    expect(occurrenceKey({ ...base, templateVersion: 4 })).not.toBe(
      occurrenceKey({ ...base, templateVersion: 5 }),
    );
  });
});

describe("the boundaries the module documents, pinned so they cannot drift silently", () => {
  test("MAX_LOOKAHEAD_DAYS is 400 — the broken-rule bound, pinned to a literal", () => {
    // Round 1 left this free: 400 -> 8 was a surviving mutation, because nothing asserted the
    // value and every rule under test resolves within a week. It is exported and documented as
    // the boundary between "a late run" and "a broken rule", so it is pinned literally here.
    // It must stay comfortably above 7 (weekly) with room for a cadence that skips.
    expect(MAX_LOOKAHEAD_DAYS).toBe(400);
    expect(MAX_LOOKAHEAD_DAYS).toBeGreaterThan(7);
  });
});

describe("a local date the zone SKIPPED has no occurrence at all", () => {
  // Pacific/Apia jumped the international date line at the end of 2011: local 2011-12-30 never
  // existed. Round 1 answered that day by gap-shifting the whole missing date onto the
  // transition, which produced an Occurrence whose `localDate` was "2011-12-30" but which read
  // back as 00:00 on 12-31 — and then fired AGAIN at 08:30 on 12-31 under a DIFFERENT
  // occurrenceKey. Two runs on one local day, from the module that exists to prove they cannot
  // happen. These are absolute instants, checkable by hand: Apia was UTC-10 through 12-29 and
  // UTC+14 from 12-31, so 08:30 local on 12-31 is 2011-12-30T18:30Z.
  const apia = {
    timeZone: "Pacific/Apia",
    hour: 8,
    minute: 30,
    cadence: { frequency: "daily" },
  } as const;

  test("the skipped date is absent, every remaining date appears exactly once", () => {
    const out: Occurrence[] = [];
    let t = Date.parse("2011-12-28T00:00:00Z");
    for (let i = 0; i < 4; i++) {
      const o = nextOccurrence(t, apia);
      out.push(o);
      t = o.utcMs;
    }
    expect(out.map((o) => o.localDate)).toEqual([
      "2011-12-28",
      "2011-12-29",
      "2011-12-31",
      "2012-01-01",
    ]);
    // Every one is the wall time that was asked for, on the date it claims to be on.
    expect(out.map((o) => o.resolvedLocalTime)).toEqual(["08:30", "08:30", "08:30", "08:30"]);
    expect(out.map((o) => iso(o.utcMs))).toEqual([
      "2011-12-28T18:30:00.000Z",
      "2011-12-29T18:30:00.000Z",
      "2011-12-30T18:30:00.000Z",
      "2011-12-31T18:30:00.000Z",
    ]);
    // The occurrence key is what a claim mutation would insert under: four dates, four keys.
    const keys = out.map((o) =>
      occurrenceKey({
        routineId: "rt_1",
        localDate: o.localDate,
        localTime: o.localTime,
        templateVersion: 1,
      }),
    );
    expect(new Set(keys).size).toBe(4);
    expect(keys).not.toContain("rt_1|2011-12-30T08:30|v1");
  });

  test("an ORDINARY gap still shifts within its own local date — the fix did not delete that", () => {
    // The control for the test above: New York 02:30 on 2026-03-08 also does not exist, but the
    // shift lands on 03:00 the SAME local date, so it is a real occurrence and must survive.
    const o = nextOccurrence(Date.parse("2026-03-07T12:00:00Z"), {
      timeZone: "America/New_York",
      hour: 2,
      minute: 30,
      cadence: { frequency: "daily" },
    });
    expect([o.localDate, o.resolvedLocalTime, o.disambiguation]).toEqual([
      "2026-03-08",
      "03:00",
      "gap_shifted",
    ]);
  });
});

test("the spike imports nothing, exports nothing to the barrel, and added no dependency", () => {
  const src = readFileSync(fileURLToPath(new URL("./routineSchedule.ts", import.meta.url)), "utf8");
  // CLAUDE.md section 1: pure TS, no Convex. And no dependency was installed for the spike.
  expect(src).not.toMatch(/^\s*import\s/m);
  expect(src).not.toMatch(/\brequire\s*\(/);
  // The spike ran on native Intl and installed NOTHING. `defer` forbids the dependency outright,
  // so its absence from the manifest is part of the deliverable, not an accident of this file.
  const manifest = readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8");
  expect(manifest).not.toContain("temporal");
  // POSITIVE CONTROL: this really is the core manifest and really was read, not an empty string
  // that trivially contains nothing.
  expect(manifest).toContain('"@pikar/core"');
  // It is not exported from the package barrel either, so nothing can reach it by accident.
  const barrel = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
  expect(barrel).not.toContain("routineSchedule");
  expect(barrel).toMatch(/export/); // the barrel exists and exports things; the spike is not one
  // NOTE: this test says nothing about IMPORTERS — it cannot see them from here. The recursive
  // "no runtime module imports the spike" scan lives in
  // `packages/backend/convex/routineDecision.test.ts`, which walks convex/, apps/web and every
  // `packages/*/src` — the package roots derived from the filesystem, so a package added later is
  // scanned without anyone remembering to add it. (Round 2 said "every package src" while
  // hardcoding four of nine; an import from `packages/revenue/src` read green.) Round 1's title
  // claimed both halves here and only ever checked this one.
});
