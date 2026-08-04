import { describe, expect, test } from "vitest";
import {
  applyRecipientEdit,
  buildRecipientView,
  type HeaderRecord,
  parseAddress,
  parseSendTime,
  rankCandidates,
  SEND_TIME_HORIZON_MS,
} from "./emailIntent";

describe("parseAddress — header value → { displayName?, address }", () => {
  test('"Name <addr>" → displayName + lowercased address', () => {
    expect(parseAddress("Sarah Chen <sarah@acme.com>")).toEqual({
      displayName: "Sarah Chen",
      address: "sarah@acme.com",
    });
    // quoted display name + mixed-case address lowercased
    expect(parseAddress('"Bob Jones" <Bob@Example.COM>')).toEqual({
      displayName: "Bob Jones",
      address: "bob@example.com",
    });
  });

  test("bare address → address only, no displayName; address lowercased", () => {
    expect(parseAddress("sarah@acme.com")).toEqual({ address: "sarah@acme.com" });
    expect(parseAddress("  SARAH@Acme.com  ")).toEqual({ address: "sarah@acme.com" });
  });

  test("non-address → null", () => {
    expect(parseAddress("not-an-address")).toBeNull();
    expect(parseAddress("")).toBeNull();
  });
});

describe("rankCandidates — dedupe + rank contacts from header metadata", () => {
  test("zero records → []", () => {
    expect(rankCandidates("Sarah", [])).toEqual([]);
  });

  test("dedupes by lowercased address, counts frequency; a non-name-match (Tom) is dropped when a name-match exists", () => {
    const recs: HeaderRecord[] = [
      { from: "Sarah Chen <sarah@acme.com>", subject: "Old", date: "2024-01-01T00:00:00Z" },
      { from: "SARAH <SARAH@acme.com>", subject: "New", date: "2024-06-01T00:00:00Z" },
      { from: "Tom <tom@x.com>", subject: "One-off", date: "2024-07-01T00:00:00Z" },
    ];
    const ranked = rankCandidates("Sarah", recs);
    // sarah matches the name (deduped, count 2); tom shared a thread but is NOT a Sarah → filtered out.
    expect(ranked.map((m) => m.address)).toEqual(["sarah@acme.com"]);
    const [sarah] = ranked;
    expect(sarah?.count).toBe(2);
    // most-recent hit drives lastSubject/lastDateMs
    expect(sarah?.lastSubject).toBe("New");
    expect(sarah?.lastDateMs).toBe(Date.parse("2024-06-01T00:00:00Z"));
  });

  test("ranks name-matches over higher-frequency noise (the live bug: 'Sarah' surfaced joel.feruzi/pdfFiller)", () => {
    const recs: HeaderRecord[] = [
      // noise: a frequent correspondent who was merely on threads that mentioned Sarah
      { from: "joel <joel.feruzi@gmail.com>", subject: "a", date: "2024-05-01T00:00:00Z" },
      { from: "joel <joel.feruzi@gmail.com>", subject: "b", date: "2024-05-02T00:00:00Z" },
      { from: "joel <joel.feruzi@gmail.com>", subject: "c", date: "2024-05-03T00:00:00Z" },
      // the real match, seen once
      { from: "Sarah Li <sarah.li@acme.com>", subject: "hi", date: "2024-04-01T00:00:00Z" },
    ];
    const ranked = rankCandidates("Sarah", recs);
    // only the name-match survives — despite joel having 3x the frequency.
    expect(ranked.map((m) => m.address)).toEqual(["sarah.li@acme.com"]);
  });

  test("no name-match anywhere → [] (accuracy: never present an unrelated contact as the named person)", () => {
    const recs: HeaderRecord[] = [
      { from: "Bob <bob@x.com>", date: "2024-01-01T00:00:00Z" },
      { from: "Bob <bob@x.com>", date: "2024-02-01T00:00:00Z" },
      { from: "Al <al@x.com>", date: "2024-03-01T00:00:00Z" },
    ];
    // "Zara" matches neither Bob nor Al → return NOTHING. The caller asks the user for the address
    // rather than surfacing a stranger as "Zara" (the live liability bug: a wrong recipient guess).
    expect(rankCandidates("Zara", recs)).toEqual([]);
  });

  test("parses From/To/Cc and ignores unparseable / missing fields", () => {
    const recs: HeaderRecord[] = [{ to: "a@x.com, b@x.com", cc: "garbage-no-at", from: "" }];
    const ranked = rankCandidates("x", recs);
    expect(ranked.map((m) => m.address).sort()).toEqual(["a@x.com", "b@x.com"]);
  });

  test("caps output at ~5", () => {
    const recs: HeaderRecord[] = Array.from({ length: 9 }, (_, i) => ({
      from: `p${i}@x.com`,
    }));
    expect(rankCandidates("p", recs).length).toBeLessThanOrEqual(5);
  });
});

describe("buildRecipientView — index+label projection (§2-D: no raw address reaches the model)", () => {
  test("recipient WITH a display name → label is the name; never contains an address", () => {
    const view = buildRecipientView([{ address: "sarah@x.com", displayName: "Sarah Chen" }]);
    expect(view).toEqual([{ index: 1, label: "Sarah Chen" }]);
    for (const r of view) expect(r.label).not.toContain("@");
  });

  test("recipient WITHOUT a display name → neutral '#<index> (no name)' placeholder, index preserved", () => {
    const view = buildRecipientView([
      { address: "a@x.com", displayName: "Alice" },
      { address: "bob@y.com" },
    ]);
    expect(view).toEqual([
      { index: 1, label: "Alice" },
      { index: 2, label: "#2 (no name)" },
    ]);
    for (const r of view) expect(r.label).not.toContain("@");
  });

  test("empty recipients → empty view", () => {
    expect(buildRecipientView([])).toEqual([]);
  });
});

describe("applyRecipientEdit — add/remove/set with validation bounce + index resolution", () => {
  test("add valid → appended, deduped case-insensitively", () => {
    const res = applyRecipientEdit(["a@x.com"], { op: "add", addresses: ["b@y.com"] });
    expect(res).toEqual({ ok: true, recipients: ["a@x.com", "b@y.com"] });

    const dupe = applyRecipientEdit(["a@x.com"], { op: "add", addresses: ["A@X.com"] });
    expect(dupe).toEqual({ ok: true, recipients: ["a@x.com"] });
  });

  test("add invalid → recipients unchanged, address bounces (never enters recipients)", () => {
    const res = applyRecipientEdit(["a@x.com"], { op: "add", addresses: ["bad@"] });
    expect(res).toEqual({ ok: false, recipients: ["a@x.com"], rejected: ["bad@"] });
  });

  test("add mixed → valid appended, invalid bounced", () => {
    const res = applyRecipientEdit([], { op: "add", addresses: ["good@z.com", "bad@"] });
    expect(res).toEqual({ ok: false, recipients: ["good@z.com"], rejected: ["bad@"] });
  });

  test("remove by 1-based index → resolves the right recipient", () => {
    const res = applyRecipientEdit(["a@x.com", "b@y.com"], { op: "remove", index: 1 });
    expect(res).toEqual({ ok: true, recipients: ["b@y.com"] });
  });

  test("remove out of range → bounce, recipients unchanged (never a silent no-op send)", () => {
    const res = applyRecipientEdit(["a@x.com", "b@y.com"], { op: "remove", index: 5 });
    expect(res).toEqual({ ok: false, recipients: ["a@x.com", "b@y.com"], rejected: ["#5"] });
  });

  test("set valid → replaces recipients wholesale", () => {
    const res = applyRecipientEdit(["a@x.com"], { op: "set", addresses: ["c@d.com"] });
    expect(res).toEqual({ ok: true, recipients: ["c@d.com"] });
  });

  test("set with an invalid member → bounces that member, does NOT replace with the bad address", () => {
    const res = applyRecipientEdit(["a@x.com"], { op: "set", addresses: ["c@d.com", "bad@"] });
    expect(res).toEqual({ ok: false, recipients: ["c@d.com"], rejected: ["bad@"] });
  });

  test("set to EMPTY never wipes: bounces and keeps the current recipients (the 03.2.1 disappearing-recipients bug)", () => {
    const res = applyRecipientEdit(["a@x.com", "b@y.com"], { op: "set", addresses: [] });
    expect(res.ok).toBe(false);
    expect(res.recipients).toEqual(["a@x.com", "b@y.com"]); // unchanged — not wiped
  });

  test("set with only invalid addresses → also keeps the current recipients (would-be-empty bounces)", () => {
    const res = applyRecipientEdit(["a@x.com"], { op: "set", addresses: ["nope", "bad@"] });
    expect(res.ok).toBe(false);
    expect(res.recipients).toEqual(["a@x.com"]); // unchanged
  });
});

describe("parseSendTime — pure NL time → resolved | ambiguous | past | none (03.5 SCHD-01)", () => {
  const TZ = "America/New_York";
  // A FIXED instant: 2024-06-10T16:00:00Z = 12:00 (noon) Monday June 10 2024 in America/New_York (EDT, UTC-4).
  // Every case is deterministic against this injected clock — the parser NEVER reads the real clock.
  const NOW = Date.UTC(2024, 5, 10, 16, 0, 0);

  /** Read an epoch back into its wall-clock parts in TZ (mirrors what the picker shows the user). */
  function wallClock(epochMs: number) {
    const p: Record<string, string> = {};
    for (const part of new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "long",
    }).formatToParts(new Date(epochMs))) {
      if (part.type !== "literal") p[part.type] = part.value;
    }
    return {
      year: Number(p.year),
      month: Number(p.month),
      day: Number(p.day),
      hour: p.hour === "24" ? 0 : Number(p.hour),
      minute: Number(p.minute),
      weekday: p.weekday,
    };
  }

  test('empty / whitespace / no time expression → { kind: "none" } (immediate-send default, SC1)', () => {
    expect(parseSendTime("", NOW, TZ)).toEqual({ kind: "none" });
    expect(parseSendTime("   ", NOW, TZ)).toEqual({ kind: "none" });
    expect(parseSendTime("please send the proposal to the team", NOW, TZ)).toEqual({
      kind: "none",
    });
  });

  test('"in 2 hours" → resolved epoch exactly nowMs + 7_200_000 (tz-independent offset)', () => {
    const r = parseSendTime("in 2 hours", NOW, TZ);
    expect(r).toEqual({ kind: "resolved", epochMs: NOW + 7_200_000 });
  });

  test('"in 30 minutes" → resolved epoch exactly nowMs + 1_800_000', () => {
    const r = parseSendTime("send it in 30 minutes", NOW, TZ);
    expect(r).toEqual({ kind: "resolved", epochMs: NOW + 1_800_000 });
  });

  test('"tomorrow 9am" → resolved, next day at 09:00 wall-clock, strictly after now', () => {
    const r = parseSendTime("tomorrow 9am", NOW, TZ);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    expect(r.epochMs).toBeGreaterThan(NOW);
    const w = wallClock(r.epochMs);
    expect({ day: w.day, hour: w.hour, minute: w.minute }).toEqual({ day: 11, hour: 9, minute: 0 });
  });

  test('"tomorrow" with no time → resolved, next day at the 09:00 default', () => {
    const r = parseSendTime("tomorrow", NOW, TZ);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    const w = wallClock(r.epochMs);
    expect({ day: w.day, hour: w.hour, minute: w.minute }).toEqual({ day: 11, hour: 9, minute: 0 });
  });

  test('"Monday 9am" → next Monday (7 days ahead of this Monday) at 09:00, after now', () => {
    const r = parseSendTime("Monday 9am", NOW, TZ);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    expect(r.epochMs).toBeGreaterThan(NOW);
    const w = wallClock(r.epochMs);
    expect(w.weekday).toBe("Monday");
    expect({ day: w.day, hour: w.hour }).toEqual({ day: 17, hour: 9 }); // next Monday = June 17
  });

  test('"Monday" with no time → next Monday at the 09:00 default', () => {
    const r = parseSendTime("Monday", NOW, TZ);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    const w = wallClock(r.epochMs);
    expect(w.weekday).toBe("Monday");
    expect(w.hour).toBe(9);
  });

  test('"4pm" (concrete PM anchor, no day) → today 16:00 since it is still future — NOT ambiguous', () => {
    const r = parseSendTime("4pm", NOW, TZ);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    const w = wallClock(r.epochMs);
    expect({ day: w.day, hour: w.hour, minute: w.minute }).toEqual({
      day: 10,
      hour: 16,
      minute: 0,
    });
  });

  test("a bare PM time already past today → rolls to tomorrow (never a past send)", () => {
    // now is noon; "9pm" is still future today, so use one that already passed: none in PM after noon.
    // Instead prove the roll with a morning-equivalent by pinning now to the evening.
    const evening = Date.UTC(2024, 5, 10, 23, 30, 0); // 19:30 EDT Monday
    const r = parseSendTime("4pm", evening, TZ);
    expect(r.kind).toBe("resolved");
    if (r.kind !== "resolved") return;
    const w = wallClock(r.epochMs);
    expect({ day: w.day, hour: w.hour }).toEqual({ day: 11, hour: 16 }); // tomorrow 4pm
  });

  test('"4am" (bare AM, no day anchor) → { kind: "ambiguous" } — re-ask, never guess (locked bound 3)', () => {
    expect(parseSendTime("4am", NOW, TZ)).toEqual({ kind: "ambiguous" });
    expect(parseSendTime("send at 4 am", NOW, TZ)).toEqual({ kind: "ambiguous" });
  });

  test('a bare hour with no am/pm and no day ("at 4") → { kind: "ambiguous" }', () => {
    expect(parseSendTime("at 4", NOW, TZ)).toEqual({ kind: "ambiguous" });
  });

  test('a concrete day+time that already passed ("today 4am" at noon) → { kind: "past" }', () => {
    expect(parseSendTime("today 4am", NOW, TZ)).toEqual({ kind: "past" });
  });

  test("is deterministic — two calls with identical args return equal results (no Date.now)", () => {
    expect(parseSendTime("tomorrow 9am", NOW, TZ)).toEqual(parseSendTime("tomorrow 9am", NOW, TZ));
  });

  // Far-future cap (SCHD-01 refinement, Plan 06). Horizon = 7 days; the relative grammar ("in N
  // hours") is the only phrasing that can resolve strictly beyond it deterministically (weekday/
  // tomorrow max out at 7 days). 168 h == exactly the horizon; 169 h is one hour past it.
  test("SEND_TIME_HORIZON_MS is the 7-day Gmail-token ceiling (168 hours)", () => {
    expect(SEND_TIME_HORIZON_MS).toBe(168 * 3_600_000);
  });

  test('beyond the horizon ("in 169 hours") → { kind: "tooFar" } (re-ask, never a silent clamp)', () => {
    expect(parseSendTime("in 169 hours", NOW, TZ)).toEqual({ kind: "tooFar" });
  });

  test('just inside the horizon ("in 167 hours") → resolved (unchanged)', () => {
    expect(parseSendTime("in 167 hours", NOW, TZ)).toEqual({
      kind: "resolved",
      epochMs: NOW + 167 * 3_600_000,
    });
  });

  test("exactly at nowMs + SEND_TIME_HORIZON_MS is allowed → resolved (boundary inclusive)", () => {
    expect(parseSendTime("in 168 hours", NOW, TZ)).toEqual({
      kind: "resolved",
      epochMs: NOW + SEND_TIME_HORIZON_MS,
    });
  });

  test("within-horizon cases still resolve (no regression from the horizon check)", () => {
    expect(parseSendTime("in 2 hours", NOW, TZ)).toEqual({
      kind: "resolved",
      epochMs: NOW + 7_200_000,
    });
  });
});

// 17-01 (ACTN-02) — the horizon parameter. Exactly TWO rows: the default-preserved row and the
// wider-horizon row. The parser's grammar and its tz-independence are already covered above; this
// is only about the BOUND.
describe("parseSendTime horizonMs (17-01)", () => {
  const now = Date.UTC(2026, 0, 5, 12, 0, 0);
  // 10 days out — `in N hours` is the only shipped grammar that reaches past the 7-day horizon.
  const farOut = "in 240 hours";

  test("the default is unchanged — the email path does not move", () => {
    expect(parseSendTime(farOut, now, "UTC").kind).toBe("tooFar");
  });

  test("an explicit wider horizon resolves the same instant", () => {
    expect(parseSendTime(farOut, now, "UTC", 365 * 24 * 60 * 60 * 1000).kind).toBe("resolved");
  });
});
