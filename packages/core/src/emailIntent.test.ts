import { describe, expect, test } from "vitest";
import {
  applyAnswer,
  applyRecipientEdit,
  buildRecipientView,
  type EmailIntentState,
  emptyIntent,
  type HeaderRecord,
  nextQuestion,
  parseAddress,
  rankCandidates,
} from "./emailIntent";

describe("emailIntent — SC2/SC3 slot-filling brain", () => {
  test("ordering: recipients → subject → bodyIntent → ready (single recipient, no ask_mode)", () => {
    let s = emptyIntent;
    expect(nextQuestion(s)).toEqual({ kind: "ask_recipients" });

    const r1 = applyAnswer(s, { slot: "recipients", value: ["a@b.com"] });
    expect(r1.ok).toBe(true);
    s = r1.state;
    expect(nextQuestion(s)).toEqual({ kind: "ask_subject" });

    s = applyAnswer(s, { slot: "subject", value: "Hello" }).state;
    expect(nextQuestion(s)).toEqual({ kind: "ask_body_intent" });

    s = applyAnswer(s, { slot: "bodyIntent", value: "a friendly ping" }).state;
    // single recipient → straight to ready, never ask_mode
    expect(nextQuestion(s)).toEqual({ kind: "ready" });
  });

  test("invalid-email re-ask: invalid bounces in rejected, valid kept, nextQuestion re-asks only that one", () => {
    // "nope@x" is malformed (has @, no dotted domain) so it stays the rejected re-ask path — a bare
    // "nope" (no @) is now classified as a NAME, so a has-@ malformed token exercises this branch.
    const res = applyAnswer(emptyIntent, {
      slot: "recipients",
      value: ["ok@x.com", "nope@x"],
    });
    expect(res).toEqual({
      ok: false,
      state: { recipients: ["ok@x.com"], rejected: ["nope@x"] },
      rejected: { slot: "recipients", invalid: ["nope@x"] },
    });
    // caller re-asks ONLY the invalid one
    expect(nextQuestion(res.state)).toEqual({ kind: "reask_recipient", invalid: "nope@x" });

    // supplying a valid replacement clears the rejection and advances
    const fixed = applyAnswer(res.state, { slot: "recipients", value: ["fixed@x.com"] });
    expect(fixed.ok).toBe(true);
    expect(fixed.state.recipients).toEqual(["ok@x.com", "fixed@x.com"]);
    expect(fixed.state.rejected).toBeUndefined();
    // rejection cleared → advances to the next required slot (subject still missing)
    expect(nextQuestion(fixed.state)).toEqual({ kind: "ask_subject" });
  });

  test("mode trigger: >1 recipient asks mode; 1 recipient never does", () => {
    const filled = (recipients: string[]): EmailIntentState => {
      let s: EmailIntentState = { recipients };
      s = applyAnswer(s, { slot: "subject", value: "S" }).state;
      s = applyAnswer(s, { slot: "bodyIntent", value: "B" }).state;
      return s;
    };
    expect(nextQuestion(filled(["a@b.com", "c@d.com"]))).toEqual({ kind: "ask_mode" });
    expect(nextQuestion(filled(["a@b.com"]))).toEqual({ kind: "ready" });

    // once mode chosen, 2-recipient state is ready
    const withMode = applyAnswer(filled(["a@b.com", "c@d.com"]), {
      slot: "mode",
      value: "group",
    }).state;
    expect(nextQuestion(withMode)).toEqual({ kind: "ready" });
  });

  test("never-ready-early: any missing required slot or pending rejection blocks ready", () => {
    expect(nextQuestion(emptyIntent)).not.toEqual({ kind: "ready" });
    expect(nextQuestion({ recipients: ["a@b.com"] })).not.toEqual({ kind: "ready" }); // no subject
    expect(nextQuestion({ recipients: ["a@b.com"], subject: "S" })).not.toEqual({ kind: "ready" }); // no body
    expect(
      nextQuestion({ recipients: ["a@b.com"], subject: "S", bodyIntent: "B", rejected: ["x"] }),
    ).not.toEqual({ kind: "ready" }); // pending rejection
  });

  test("attachmentIntent is tracked but NEVER gates ready", () => {
    const s: EmailIntentState = {
      recipients: ["a@b.com"],
      subject: "S",
      bodyIntent: "B",
    };
    expect(nextQuestion(s)).toEqual({ kind: "ready" });
    const withAtt = applyAnswer(s, { slot: "attachmentIntent", value: "a pdf report" }).state;
    expect(withAtt.attachmentIntent).toBe("a pdf report");
    expect(nextQuestion(withAtt)).toEqual({ kind: "ready" }); // still ready, attachment never asked
  });

  test("immutability: applyAnswer returns a fresh object, input unchanged", () => {
    const s: EmailIntentState = { recipients: ["a@b.com"] };
    const r = applyAnswer(s, { slot: "subject", value: "S" });
    expect(r.state).not.toBe(s);
    expect(s).toEqual({ recipients: ["a@b.com"] }); // original untouched
  });

  test("dedupe: duplicate recipient (case-insensitive) not added twice", () => {
    const s = applyAnswer(
      { recipients: ["A@B.com"] },
      {
        slot: "recipients",
        value: ["a@b.com", "c@d.com"],
      },
    ).state;
    expect(s.recipients).toEqual(["A@B.com", "c@d.com"]);
  });

  test("validator reuse: has-@-malformed AND empty stay rejected; a no-@ token is now a name", () => {
    const res = applyAnswer(emptyIntent, {
      slot: "recipients",
      value: ["a@b", "@b.com", "a@.com", "", "nope"],
    });
    expect(res.ok).toBe(false);
    expect(res.state.recipients).toEqual([]);
    if (!res.ok) {
      // has-@-but-malformed cases AND the empty string bounce to rejected (unchanged classification)
      expect(res.rejected.invalid).toEqual(["a@b", "@b.com", "a@.com", ""]);
    }
    // the no-@ token is NOT rejected — it is a name to resolve
    expect(res.state.rejected).toEqual(["a@b", "@b.com", "a@.com", ""]);
    expect(res.state.pendingResolution).toEqual([{ name: "nope" }]);
  });

  test('empty/whitespace segment → rejected, NEVER a pendingResolution "name"', () => {
    const res = applyAnswer(emptyIntent, { slot: "recipients", value: ["", "   "] });
    expect(res.ok).toBe(false);
    expect(res.state.recipients).toEqual([]);
    expect(res.state.pendingResolution).toBeUndefined();
    if (!res.ok) expect(res.rejected.invalid).toEqual(["", "   "]);
  });

  test('no-@ token "Sarah" → pendingResolution (a name), blocks ready, asks resolve_recipients', () => {
    const res = applyAnswer(emptyIntent, { slot: "recipients", value: ["Sarah"] });
    expect(res.ok).toBe(true);
    expect(res.state.recipients).toEqual([]);
    expect(res.state.pendingResolution).toEqual([{ name: "Sarah" }]);
    // resolve_recipients surfaces BEFORE ask_subject
    expect(nextQuestion(res.state)).toEqual({ kind: "resolve_recipients", names: ["Sarah"] });
    // multi-word names stay ONE segment (tokenizer lives in cockpit.ts)
    const multi = applyAnswer(emptyIntent, { slot: "recipients", value: ["Sarah Chen"] });
    expect(multi.state.pendingResolution).toEqual([{ name: "Sarah Chen" }]);
  });

  test("group word (case-insensitive) → groupDeferred, distinct defer_group signal, never resolved", () => {
    for (const g of ["team", "Everyone", "ALL", "staff", "group", "everybody"]) {
      const res = applyAnswer(emptyIntent, { slot: "recipients", value: [g] });
      expect(res.ok).toBe(true);
      expect(res.state.groupDeferred).toEqual([g]);
      expect(res.state.pendingResolution).toBeUndefined(); // NOT a name
      expect(nextQuestion(res.state)).toEqual({ kind: "defer_group", groups: [g] });
    }
  });

  test("mixed name + valid email: name pends, valid HELD in pendingValid (not recipients)", () => {
    const res = applyAnswer(emptyIntent, {
      slot: "recipients",
      value: ["Sarah", "bob@x.com"],
    });
    expect(res.ok).toBe(true);
    expect(res.state.recipients).toEqual([]); // valid NOT committed while a name is unresolved
    expect(res.state.pendingResolution).toEqual([{ name: "Sarah" }]);
    expect(res.state.pendingValid).toEqual(["bob@x.com"]);
    expect(nextQuestion(res.state).kind).toBe("resolve_recipients");
  });

  test("resolve answer folds picks + pendingValid into recipients, clears pending, sets greetingName", () => {
    const held = applyAnswer(emptyIntent, {
      slot: "recipients",
      value: ["Sarah", "bob@x.com"],
    }).state;
    const done = applyAnswer(held, {
      slot: "resolution",
      picks: [{ name: "Sarah", address: "sarah@acme.com", displayName: "Sarah Chen" }],
    });
    expect(done.ok).toBe(true);
    // picks + held pendingValid folded (deduped) into recipients
    expect(done.state.recipients).toEqual(["bob@x.com", "sarah@acme.com"]);
    expect(done.state.pendingResolution).toBeUndefined();
    expect(done.state.pendingValid).toBeUndefined();
    // FIRST pick's displayName drives the greeting
    expect(done.state.greetingName).toBe("Sarah Chen");
    // pending cleared → advances to the next required slot
    expect(nextQuestion(done.state)).toEqual({ kind: "ask_subject" });
  });

  test("pendingResolution blocks ready just like a pending rejection", () => {
    const s: EmailIntentState = {
      recipients: ["a@b.com"],
      subject: "S",
      bodyIntent: "B",
      pendingResolution: [{ name: "Sarah" }],
    };
    expect(nextQuestion(s)).not.toEqual({ kind: "ready" });
    expect(nextQuestion(s).kind).toBe("resolve_recipients");
  });

  test("turn of ONLY valid emails keeps the direct path (no pendingValid, no card)", () => {
    const res = applyAnswer(emptyIntent, {
      slot: "recipients",
      value: ["a@b.com", "c@d.com"],
    });
    expect(res.ok).toBe(true);
    expect(res.state.recipients).toEqual(["a@b.com", "c@d.com"]);
    expect(res.state.pendingValid).toBeUndefined();
    expect(res.state.pendingResolution).toBeUndefined();
  });
});

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

  test("dedupes by lowercased address, counts frequency, ranks count desc then recency desc, caps ~5", () => {
    const recs: HeaderRecord[] = [
      { from: "Sarah Chen <sarah@acme.com>", subject: "Old", date: "2024-01-01T00:00:00Z" },
      { from: "SARAH <SARAH@acme.com>", subject: "New", date: "2024-06-01T00:00:00Z" },
      { from: "Tom <tom@x.com>", subject: "One-off", date: "2024-07-01T00:00:00Z" },
    ];
    const ranked = rankCandidates("Sarah", recs);
    // sarah appears twice (deduped to one, count 2) → ranks above tom (count 1)
    expect(ranked.map((m) => m.address)).toEqual(["sarah@acme.com", "tom@x.com"]);
    const [sarah] = ranked;
    expect(sarah?.count).toBe(2);
    // most-recent hit drives lastSubject/lastDateMs
    expect(sarah?.lastSubject).toBe("New");
    expect(sarah?.lastDateMs).toBe(Date.parse("2024-06-01T00:00:00Z"));
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
});
