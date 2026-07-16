import { describe, expect, test } from "vitest";
import {
  BODY_TRUNCATE_CHARS,
  BRIEFING_BODY_CAP,
  bucket,
  type DigestItem,
  dayKey,
  type InboxMessageMeta,
  joinDigest,
  selectForDigest,
} from "./briefing";

const TOKYO = "Asia/Tokyo"; // UTC+9, no DST — east of UTC
const LA = "America/Los_Angeles"; // UTC-8/-7, DST — west of UTC

/** Minimal message meta; only internalDate matters to bucketing. */
const msg = (id: string, internalDate: number, extra: Partial<InboxMessageMeta> = {}): InboxMessageMeta => ({
  id,
  from: `${id} <${id}@example.com>`,
  subject: `subject ${id}`,
  snippet: `snippet ${id}`,
  internalDate,
  ...extra,
});

describe("constants", () => {
  test("caps are the locked values (snippet-first cap, SC-3)", () => {
    expect(BRIEFING_BODY_CAP).toBe(25);
    expect(BODY_TRUNCATE_CHARS).toBe(2000);
  });
});

describe("dayKey — YYYY-MM-DD in an IANA zone", () => {
  test("formats the local calendar day, not the UTC day", () => {
    // 2026-03-01T16:00Z is already 2026-03-02 in Tokyo but still 2026-03-01 in UTC.
    const ms = Date.UTC(2026, 2, 1, 16, 0);
    expect(dayKey(ms, TOKYO)).toBe("2026-03-02");
    expect(dayKey(ms, "UTC")).toBe("2026-03-01");
    expect(dayKey(ms, LA)).toBe("2026-03-01");
  });
});

describe("bucket — pure code owns the grouping (ADR-004, SC-1)", () => {
  describe("east of UTC (Asia/Tokyo)", () => {
    // Tokyo local: 2026-03-02 01:00. UTC: 2026-03-01 16:00 → the zones disagree on "today".
    const now = Date.UTC(2026, 2, 1, 16, 0);

    test("a message 1h ago is today", () => {
      expect(bucket(now - 3_600_000, now, TOKYO)).toBe("today");
    });

    test("just before local midnight is yesterday — even though it is still TODAY in UTC", () => {
      const ms = Date.UTC(2026, 2, 1, 14, 59); // Tokyo 2026-03-01 23:59 | UTC 2026-03-01
      expect(dayKey(ms, "UTC")).toBe(dayKey(now, "UTC")); // same UTC day as now...
      expect(bucket(ms, now, TOKYO)).toBe("yesterday"); // ...but the previous Tokyo day
    });
  });

  describe("west of UTC (America/Los_Angeles)", () => {
    // LA local: 2026-03-01 16:30. UTC: 2026-03-02 00:30 → the zones disagree the other way.
    const now = Date.UTC(2026, 2, 2, 0, 30);

    test("just after local midnight is today — even though it is already YESTERDAY in UTC", () => {
      const ms = Date.UTC(2026, 2, 1, 9, 0); // LA 2026-03-01 01:00 | UTC 2026-03-01
      expect(dayKey(ms, "UTC")).not.toBe(dayKey(now, "UTC")); // a different UTC day than now...
      expect(bucket(ms, now, LA)).toBe("today"); // ...but the same LA day
    });

    test("yesterday rolls over a month boundary (03-01 → 02-28)", () => {
      const ms = Date.UTC(2026, 2, 1, 5, 0); // LA 2026-02-28 21:00
      expect(dayKey(now, LA)).toBe("2026-03-01");
      expect(bucket(ms, now, LA)).toBe("yesterday");
    });
  });

  test("yesterday rolls over a YEAR boundary (01-01 → 12-31)", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0); // UTC 2026-01-01 12:00
    expect(bucket(Date.UTC(2025, 11, 31, 23, 0), now, "UTC")).toBe("yesterday");
  });

  // The regression that kills the naive `dayKey(now - 86400000)` derivation: the day after a
  // spring-forward is only 23h from local midnight, so "24h ago" lands two calendar days back.
  test("yesterday is DST-proof across a spring-forward transition", () => {
    const now = Date.UTC(2026, 2, 9, 7, 30); // LA 2026-03-09 00:30 PDT (DST began 03-08 02:00)
    expect(dayKey(now, LA)).toBe("2026-03-09");
    expect(dayKey(now - 86_400_000, LA)).toBe("2026-03-07"); // the naive derivation is off by one
    const ms = Date.UTC(2026, 2, 8, 20, 0); // LA 2026-03-08 13:00 → the real yesterday
    expect(bucket(ms, now, LA)).toBe("yesterday");
  });

  describe("the 7-day window", () => {
    const now = Date.UTC(2026, 2, 1, 16, 0);

    test("6 days ago is thisWeek", () => {
      expect(bucket(now - 6 * 86_400_000, now, TOKYO)).toBe("thisWeek");
    });

    test("8 days ago is dropped (outside the window)", () => {
      expect(bucket(now - 8 * 86_400_000, now, TOKYO)).toBeNull();
    });

    test("a future-dated message (clock skew) is today, never thisWeek", () => {
      // +30h lands on a later local day, so without the skew clamp this would fall through
      // to the 7-day branch and be mislabelled thisWeek.
      expect(bucket(now + 30 * 3_600_000, now, TOKYO)).toBe("today");
    });
  });
});

describe("selectForDigest — recency-first under the body cap (SC-3)", () => {
  const many = Array.from({ length: 30 }, (_, i) => msg(`m${i}`, Date.UTC(2026, 2, 1) + i * 60_000));

  test("30 messages → the 25 newest, newest-first", () => {
    const out = selectForDigest(many);
    expect(out).toHaveLength(BRIEFING_BODY_CAP);
    expect(out[0]?.id).toBe("m29"); // newest
    expect(out.at(-1)?.id).toBe("m5"); // 25th newest; m0..m4 fall to the snippet-only long tail
    expect(out.map((m) => m.internalDate)).toEqual([...out.map((m) => m.internalDate)].sort((a, b) => b - a));
  });

  test("does not mutate its input", () => {
    const input = [msg("old", 1_000), msg("new", 9_000)];
    const before = input.map((m) => m.id);
    selectForDigest(input);
    expect(input.map((m) => m.id)).toEqual(before);
  });

  test("fewer messages than the cap → all of them, still newest-first", () => {
    expect(selectForDigest([msg("a", 1_000), msg("c", 3_000), msg("b", 2_000)]).map((m) => m.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  test("honours an explicit cap", () => {
    expect(selectForDigest(many, 3)).toHaveLength(3);
  });
});

describe("joinDigest — the model owns gists, code owns identity and time (ADR-004)", () => {
  const now = Date.UTC(2026, 2, 1, 16, 0); // Tokyo 2026-03-02 01:00
  const selected = [
    msg("a", now - 3_600_000, { from: "Sarah Chen <sarah@acme.com>", isUnread: true }), // today
    msg("b", Date.UTC(2026, 2, 1, 14, 59), { from: "Bob <bob@acme.com>" }), // Tokyo yesterday
  ];
  const item = (index: number, extra: Partial<DigestItem> = {}): DigestItem => ({
    index,
    gist: `gist ${index}`,
    category: "fyi",
    needsReply: false,
    ...extra,
  });

  test("joins gists onto the message's own sender/ts/bucket", () => {
    const out = joinDigest(selected, [item(0, { needsReply: true, deadline: "by Friday" }), item(1)], now, TOKYO);
    expect(out).toEqual([
      {
        bucket: "today",
        sender: "Sarah Chen <sarah@acme.com>",
        ts: now - 3_600_000,
        gist: "gist 0",
        category: "fyi",
        needsReply: true,
        deadline: "by Friday",
        isUnread: true,
      },
      {
        bucket: "yesterday",
        sender: "Bob <bob@acme.com>",
        ts: Date.UTC(2026, 2, 1, 14, 59),
        gist: "gist 1",
        category: "fyi",
        needsReply: false,
      },
    ]);
  });

  test("an out-of-range index is DROPPED — the model cannot invent a message", () => {
    const out = joinDigest(selected, [item(0), item(99), item(-1)], now, TOKYO);
    expect(out).toHaveLength(1);
    expect(out[0]?.gist).toBe("gist 0");
  });

  test("a non-integer index is dropped", () => {
    expect(joinDigest(selected, [item(1.5)], now, TOKYO)).toEqual([]);
  });

  test("a duplicate index is dropped — one briefing row per real message", () => {
    const out = joinDigest(selected, [item(0, { gist: "first" }), item(0, { gist: "second" })], now, TOKYO);
    expect(out).toHaveLength(1);
    expect(out[0]?.gist).toBe("first");
  });

  test("sender and ts come from the message meta even when the digest item carries its own", () => {
    const rogue = { ...item(0), sender: "attacker@evil.example", ts: 0, bucket: "thisWeek" } as DigestItem;
    const out = joinDigest(selected, [rogue], now, TOKYO);
    expect(out[0]?.sender).toBe("Sarah Chen <sarah@acme.com>");
    expect(out[0]?.ts).toBe(now - 3_600_000);
    expect(out[0]?.bucket).toBe("today");
  });

  test("a message outside the 7-day window is dropped even if the model digested it", () => {
    const stale = [msg("old", now - 9 * 86_400_000)];
    expect(joinDigest(stale, [item(0)], now, TOKYO)).toEqual([]);
  });

  test("no items → no rows", () => {
    expect(joinDigest(selected, [], now, TOKYO)).toEqual([]);
  });
});
