// The CALENDAR card's one piece of non-trivial rendering logic (ACTN-02).
//
// The card itself is a straight read of the `calendarViews` row — the backend half is covered by
// cockpitTools.test.ts, which asserts the ROW gets written (including on an empty read). What is
// left here is the formatter, and it has exactly one branch worth protecting: a busy block that
// crosses midnight must not print one date and two clock times, because "Mon 18 Aug · 23:00 –
// 01:00" reads as a two-hour meeting that ended before it started.
import { describe, expect, test } from "vitest";
import { fmtBusyBlock, rangePhrase } from "./cards";

// Caught on the FIRST live paint, not by a test: the card read "you're free for week" because the
// tool's closed enum literal was interpolated straight into a sentence. It reads fine as the caps
// header ("CALENDAR · WEEK") and wrong in prose — one value, two registers.
describe("rangePhrase", () => {
  test("the enum literals read as English inside a sentence", () => {
    expect(`you're free ${rangePhrase("week")}`).toBe("you're free this week");
    expect(`you're free ${rangePhrase("today")}`).toBe("you're free today");
    expect(`you're free ${rangePhrase("tomorrow")}`).toBe("you're free tomorrow");
  });

  test("an unknown range falls back to the literal, never to undefined", () => {
    // The row stores a `string`; the union lives in the tool's inputSchema. If that enum ever
    // widens, the card degrades to the raw word rather than rendering "undefined".
    expect(rangePhrase("fortnight")).toBe("fortnight");
  });
});

// 2026-08-17 is a Monday. Fixed instants, never Date.now() — the same clock discipline the tool
// itself is held to (§2-D).
const MON_09_00_UTC = Date.UTC(2026, 7, 17, 9, 0);
const MON_10_30_UTC = Date.UTC(2026, 7, 17, 10, 30);
const MON_23_00_UTC = Date.UTC(2026, 7, 17, 23, 0);
const TUE_01_00_UTC = Date.UTC(2026, 7, 18, 1, 0);

describe("fmtBusyBlock", () => {
  test("a same-day block prints the date ONCE and both clock times", () => {
    const out = fmtBusyBlock(MON_09_00_UTC, MON_10_30_UTC, "UTC");
    expect(out).toContain("Aug");
    expect(out).toContain("17");
    // The separator is what tells the reader this is one window, not two events.
    expect(out).toMatch(/·/);
    // One date, not two: the day label must not appear on both sides.
    expect(out.match(/Aug/g)).toHaveLength(1);
  });

  test("a block that CROSSES MIDNIGHT prints both dates — the branch that would otherwise lie", () => {
    const out = fmtBusyBlock(MON_23_00_UTC, TUE_01_00_UTC, "UTC");
    expect(out.match(/Aug/g)).toHaveLength(2);
    expect(out).toContain("17");
    expect(out).toContain("18");
  });

  test("it renders in the ROW's zone, not the runner's — the same instant reads differently", () => {
    // Display honesty: the row stores the zone the read was bucketed in, and the card must honour
    // it. If the formatter ever drops `timeZone`, these two collapse to the same string.
    const utc = fmtBusyBlock(MON_23_00_UTC, TUE_01_00_UTC, "UTC");
    const tokyo = fmtBusyBlock(MON_23_00_UTC, TUE_01_00_UTC, "Asia/Tokyo");
    expect(tokyo).not.toBe(utc);
    // In Tokyo (UTC+9) that same window is 08:00–10:00 on the 18th — one day, not two.
    expect(tokyo.match(/Aug/g)).toHaveLength(1);
    expect(tokyo).toContain("18");
  });

  test("a zero-length block still renders rather than collapsing to an empty string", () => {
    // Providers do emit these. Rendering nothing would leave a blank <li> with no explanation.
    expect(fmtBusyBlock(MON_09_00_UTC, MON_09_00_UTC, "UTC")).not.toBe("");
  });
});
