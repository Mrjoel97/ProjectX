import { describe, expect, test } from "vitest";
import {
  BODY_TRUNCATE_CHARS,
  BRIEFING_BODY_CAP,
  type BriefingItem,
  buildBriefingView,
  bucket,
  collapseNoise,
  composeLede,
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

  test("joins gists onto the message's own id/sender/subject/ts/bucket", () => {
    const out = joinDigest(selected, [item(0, { needsReply: true, deadline: "by Friday" }), item(1)], now, TOKYO);
    expect(out).toEqual([
      {
        id: "a",
        bucket: "today",
        sender: "Sarah Chen <sarah@acme.com>",
        subject: "subject a",
        ts: now - 3_600_000,
        gist: "gist 0",
        category: "fyi",
        needsReply: true,
        deadline: "by Friday",
        isUnread: true,
      },
      {
        id: "b",
        bucket: "yesterday",
        sender: "Bob <bob@acme.com>",
        subject: "subject b",
        ts: Date.UTC(2026, 2, 1, 14, 59),
        gist: "gist 1",
        category: "fyi",
        needsReply: false,
      },
    ]);
  });

  test("an empty subject is carried through as-is — the CARD owns the fallback, not the join", () => {
    const out = joinDigest([msg("x", now, { subject: "" })], [item(0)], now, TOKYO);
    expect(out[0]?.subject).toBe("");
  });

  // THE REGRESSION (reported live, 2026-07-17): React "Encountered two children with the same key,
  // `1784248262000-Google <no-reply@accounts.google.com>`". The card keyed on `${ts}-${sender}`,
  // which is NOT unique — an automated sender batching two messages collides on the ms. The fix is
  // structural: joinDigest welds the Gmail message id, so every row carries its own identity.
  test("two messages from the SAME sender at the SAME ms produce rows with DISTINCT ids", () => {
    const collide = 1_784_248_262_000; // the exact internalDate from the live report
    const google = "Google <no-reply@accounts.google.com>";
    const twins = [
      msg("18f0a1", collide, { from: google, subject: "Security alert" }),
      msg("18f0a2", collide, { from: google, subject: "New sign-in" }),
    ];
    const out = joinDigest(twins, [item(0), item(1)], collide + 1_000, TOKYO);

    expect(out).toHaveLength(2);
    expect(out[0]?.ts).toBe(out[1]?.ts); // the collision is real...
    expect(out[0]?.sender).toBe(out[1]?.sender); // ...on BOTH of the old key's parts...
    expect(new Set(out.map((i) => i.id)).size).toBe(2); // ...and the id still separates them
    expect(out.map((i) => i.subject)).toEqual(["Security alert", "New sign-in"]);
  });

  test("id and subject come from the message meta even when the digest item carries its own", () => {
    const rogue = { ...item(0), id: "forged", subject: "URGENT: wire funds now" } as DigestItem;
    const out = joinDigest(selected, [rogue], now, TOKYO);
    expect(out[0]?.id).toBe("a");
    expect(out[0]?.subject).toBe("subject a");
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

// ---- Gap 1 reshape: the intelligent report, not a receipt (03.7-06) ----

/** A briefing row with sensible defaults; only the overridden axes matter per case. */
const bItem = (id: string, extra: Partial<BriefingItem> = {}): BriefingItem => ({
  id,
  bucket: "today",
  sender: `${id} <${id}@example.com>`,
  subject: `subject ${id}`,
  ts: 1_000,
  gist: `gist ${id}`,
  category: "fyi",
  needsReply: false,
  ...extra,
});

describe("composeLede — counts are CODE-owned, the synopsis is the model's clause (Gap 1.1, ADR-004)", () => {
  // 3 of these are "need you" (2 needsReply + 1 deadline); listedCount is the code-owned total.
  const items = [
    bItem("a", { needsReply: true }),
    bItem("b", { needsReply: true }),
    bItem("c", { deadline: "by Friday" }),
    bItem("d"),
    bItem("e"),
  ];

  test("leads with the code-owned counts, NEVER a number from the synopsis", () => {
    // The synopsis lies with a "99" — the lede's counts must come from listedCount + the items,
    // so "99" is never the number the lede states.
    const lede = composeLede(items, 24, "99 urgent fires, mostly billing");
    expect(lede.startsWith("24 messages, 3 need you")).toBe(true);
    expect(lede).not.toMatch(/^99/);
  });

  test("appends a non-empty synopsis as the qualitative clause", () => {
    const lede = composeLede(items, 24, "mostly billing notifications and two recruiting threads");
    expect(lede).toBe("24 messages, 3 need you — mostly billing notifications and two recruiting threads");
  });

  test("empty synopsis → counts-only lede, no dangling separator, no throw", () => {
    expect(composeLede(items, 24, "")).toBe("24 messages, 3 need you");
    expect(composeLede(items, 24, "   ")).toBe("24 messages, 3 need you");
    expect(composeLede(items, 24, undefined)).toBe("24 messages, 3 need you");
    expect(composeLede(items, 24)).not.toContain(" — ");
  });

  test("zero need-you still reads cleanly", () => {
    expect(composeLede([bItem("x"), bItem("y")], 2)).toBe("2 messages, 0 need you");
  });
});

describe("collapseNoise — 12 notifications become ONE count, never 12 rows (Gap 1.3)", () => {
  test("newsletters are removed from surfaced and counted", () => {
    const items = Array.from({ length: 12 }, (_, i) => bItem(`n${i}`, { category: "newsletter" }));
    const { surfaced, collapsedCount } = collapseNoise(items);
    expect(collapsedCount).toBe(12);
    expect(surfaced.filter((i) => i.category === "newsletter")).toHaveLength(0);
    expect(surfaced).toHaveLength(0);
  });

  test("action / fyi / other stay surfaced — only newsletters collapse (conservative)", () => {
    const items = [
      bItem("a", { category: "action" }),
      bItem("f", { category: "fyi" }),
      bItem("o", { category: "other" }),
      bItem("n", { category: "newsletter" }),
    ];
    const { surfaced, collapsedCount } = collapseNoise(items);
    expect(collapsedCount).toBe(1);
    expect(surfaced.map((i) => i.id)).toEqual(["a", "f", "o"]);
  });

  test("a needs-you item is NEVER collapsed even if mis-categorized newsletter (needs-you wins)", () => {
    const items = [
      bItem("reply", { category: "newsletter", needsReply: true }),
      bItem("due", { category: "newsletter", deadline: "tomorrow" }),
    ];
    const { surfaced, collapsedCount } = collapseNoise(items);
    expect(collapsedCount).toBe(0);
    expect(surfaced.map((i) => i.id)).toEqual(["reply", "due"]);
  });
});

describe("buildBriefingView — action-first, time preserved as the secondary axis (Gap 1.2, locked constraint)", () => {
  // 2 need-you, 3 plain fyi across all three buckets, 2 newsletters (noise).
  const items: BriefingItem[] = [
    bItem("A", { needsReply: true, bucket: "today" }),
    bItem("B", { deadline: "Friday", bucket: "yesterday" }),
    bItem("C", { category: "fyi", bucket: "today" }),
    bItem("D", { category: "fyi", bucket: "yesterday" }),
    bItem("E", { category: "fyi", bucket: "thisWeek" }),
    bItem("F", { category: "newsletter", bucket: "today" }),
    bItem("G", { category: "newsletter", bucket: "thisWeek" }),
  ];
  const briefing = { items, listedCount: 10, synopsis: "mostly newsletters" };

  test("needsYou is a SEPARATE top block, never interleaved into timeSections (action-first)", () => {
    const view = buildBriefingView(briefing);
    expect(view.needsYou.map((i) => i.id)).toEqual(["A", "B"]);
    const timed = view.timeSections.flatMap((s) => s.items.map((i) => i.id));
    expect(timed).not.toContain("A");
    expect(timed).not.toContain("B");
  });

  test("timeSections stay ordered [today, yesterday, thisWeek], each only its bucket's remainder (time PRESERVED)", () => {
    const view = buildBriefingView(briefing);
    expect(view.timeSections.map((s) => s.bucket)).toEqual(["today", "yesterday", "thisWeek"]);
    expect(view.timeSections.find((s) => s.bucket === "today")?.items.map((i) => i.id)).toEqual(["C"]);
    expect(view.timeSections.find((s) => s.bucket === "yesterday")?.items.map((i) => i.id)).toEqual(["D"]);
    expect(view.timeSections.find((s) => s.bucket === "thisWeek")?.items.map((i) => i.id)).toEqual(["E"]);
  });

  test("empty buckets are skipped", () => {
    const view = buildBriefingView({
      items: [bItem("C", { category: "fyi", bucket: "today" }), bItem("E", { category: "fyi", bucket: "thisWeek" })],
      listedCount: 2,
    });
    expect(view.timeSections.map((s) => s.bucket)).toEqual(["today", "thisWeek"]);
  });

  test("newsletters are absent from every timeSection and surface only as collapsedCount (Gap 1.3)", () => {
    const view = buildBriefingView(briefing);
    expect(view.collapsedCount).toBe(2);
    const timed = view.timeSections.flatMap((s) => s.items.map((i) => i.id));
    expect(timed).not.toContain("F");
    expect(timed).not.toContain("G");
    expect(view.needsYou.map((i) => i.id)).not.toContain("F");
  });

  test("lede equals composeLede over the FULL item set (counts reflect all items incl. collapsed + needs-you)", () => {
    const view = buildBriefingView(briefing);
    expect(view.lede).toBe(composeLede(items, 10, "mostly newsletters"));
    expect(view.lede).toBe("10 messages, 2 need you — mostly newsletters");
  });

  test("a missing synopsis degrades to a counts-only lede, never throws (pre-delta row)", () => {
    const view = buildBriefingView({ items, listedCount: 10 });
    expect(view.lede).toBe("10 messages, 2 need you");
  });
});
