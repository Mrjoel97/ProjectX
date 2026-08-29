import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  type ApprovalSnapshot,
  classifyDue,
  classifyOverlap,
  classifyRetry,
  MATERIAL_FIELDS,
  materialChanges,
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

  /** `nextOccurrence` returns null only past MAX_LOOKAHEAD_DAYS; every rule here resolves. */
  const must = (afterUtcMs: number, rule: Parameters<typeof nextOccurrence>[1]): Occurrence => {
    const o = nextOccurrence(afterUtcMs, rule);
    if (!o) throw new Error("nextOccurrence returned null for a rule that must resolve");
    return o;
  };

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

describe("the classifiers the matrix rows cite", () => {
  test("overlap: any live run blocks the next tick", () => {
    expect(classifyOverlap(null)).toBe("start");
    for (const state of ["claimed", "running", "awaiting_approval"] as const) {
      expect(classifyOverlap(state)).toBe("skip_overlap");
    }
  });

  test("missed runs are skipped, not caught up", () => {
    const due = Date.parse("2026-03-08T12:30:00Z");
    const grace = 5 * 60_000;
    expect(classifyDue(due, due - 1, grace)).toBe("pending");
    expect(classifyDue(due, due, grace)).toBe("due");
    expect(classifyDue(due, due + grace, grace)).toBe("due");
    expect(classifyDue(due, due + grace + 1, grace)).toBe("missed");
  });

  test("retry is bounded and only for transient classes", () => {
    expect(classifyRetry("provider_5xx", 1, 3)).toBe("retry");
    expect(classifyRetry("provider_timeout", 2, 3)).toBe("retry");
    expect(classifyRetry("internal", 1, 3)).toBe("retry");
    expect(classifyRetry("provider_5xx", 3, 3)).toBe("terminal");
    for (const kind of ["auth", "validation", "budget", "paused", "provider_refusal"] as const) {
      expect(classifyRetry(kind, 1, 3)).toBe("terminal");
    }
  });

  test("material change: every governed field voids a standing approval", () => {
    const base: ApprovalSnapshot = {
      templateId: "pack_a",
      templateVersion: 3,
      candidateVersion: 12,
      actionType: "prepare_brief",
      recipients: ["a@example.com"],
      sourceSet: ["vault", "drive"],
      threshold: 0.2,
      timeZone: "America/New_York",
      cadence: "daily 08:30",
      outputContract: "brief_v1",
    };
    expect(materialChanges(base, { ...base })).toEqual([]);
    // Array order is not a change; array CONTENT is.
    expect(materialChanges(base, { ...base, sourceSet: ["drive", "vault"] })).toEqual([]);
    expect(materialChanges(base, { ...base, sourceSet: ["drive", "vault", "gmail"] })).toEqual([
      "sourceSet",
    ]);
    expect(
      materialChanges(base, { ...base, threshold: 0.5, recipients: ["b@example.com"] }),
    ).toEqual(["recipients", "threshold"]);
    // No field may quietly stop being material: each one, alone, is detected.
    const bumped: Record<string, unknown> = {
      templateId: "pack_b",
      templateVersion: 4,
      candidateVersion: 13,
      actionType: "send_email",
      recipients: ["c@example.com"],
      sourceSet: ["vault"],
      threshold: 0.9,
      timeZone: "Europe/Berlin",
      cadence: "weekly Mon 08:30",
      outputContract: "brief_v2",
    };
    for (const field of MATERIAL_FIELDS) {
      expect(
        materialChanges(base, { ...base, [field]: bumped[field] } as ApprovalSnapshot),
      ).toEqual([field]);
    }
  });
});

test("the spike is pure and unwired: it imports nothing and no runtime module imports it", () => {
  const src = readFileSync(fileURLToPath(new URL("./routineSchedule.ts", import.meta.url)), "utf8");
  // CLAUDE.md section 1: pure TS, no Convex. And no dependency was installed for the spike.
  expect(src).not.toMatch(/^\s*import\s/m);
  expect(src).not.toMatch(/\brequire\s*\(/);
  // The spike ran on native Intl and installed NOTHING. `defer` forbids the dependency outright,
  // so its absence from the manifest is part of the deliverable, not an accident of this file.
  const manifest = readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8");
  expect(manifest).not.toContain("temporal");
  // It is not exported from the package barrel either, so nothing can reach it by accident.
  const barrel = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
  expect(barrel).not.toContain("routineSchedule");
});
