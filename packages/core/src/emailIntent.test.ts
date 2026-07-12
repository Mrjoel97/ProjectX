import { describe, expect, test } from "vitest";
import {
  applyAnswer,
  emptyIntent,
  nextQuestion,
  type EmailIntentState,
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
    const res = applyAnswer(emptyIntent, {
      slot: "recipients",
      value: ["ok@x.com", "nope"],
    });
    expect(res).toEqual({
      ok: false,
      state: { recipients: ["ok@x.com"], rejected: ["nope"] },
      rejected: { slot: "recipients", invalid: ["nope"] },
    });
    // caller re-asks ONLY the invalid one
    expect(nextQuestion(res.state)).toEqual({ kind: "reask_recipient", invalid: "nope" });

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
    const s = applyAnswer({ recipients: ["A@B.com"] }, {
      slot: "recipients",
      value: ["a@b.com", "c@d.com"],
    }).state;
    expect(s.recipients).toEqual(["A@B.com", "c@d.com"]);
  });

  test("validator reuse: same bad-email table as validateSubmit is rejected", () => {
    const res = applyAnswer(emptyIntent, {
      slot: "recipients",
      value: ["a@b", "@b.com", "a@.com", "", "nope"],
    });
    expect(res.ok).toBe(false);
    expect(res.state.recipients).toEqual([]);
    if (!res.ok) {
      expect(res.rejected.invalid).toEqual(["a@b", "@b.com", "a@.com", "", "nope"]);
    }
  });
});
