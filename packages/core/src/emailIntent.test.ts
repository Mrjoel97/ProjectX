import { describe, expect, test } from "vitest";
import {
  applyRecipientEdit,
  buildRecipientView,
  type HeaderRecord,
  parseAddress,
  rankCandidates,
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
