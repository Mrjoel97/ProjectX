// DLVR-02 / 25-06: which mailboxes a plan may be sent from.
//
// THE ONE RULE THAT MATTERS: Microsoft is offered on `mailReady`, never on `connected`. ADR-018 put
// Calendar and Mail on ONE Microsoft grant, so a 17-05-era consent is connected, refreshable and
// completely real — and cannot send mail. Gating on `connected` would offer a mailbox that refuses
// with `mail_scope_missing` at approve time, after the user has already committed to the plan.
//
// Drives the pure `mailboxOptions` rather than rendering: the branching is the whole behaviour.
import { describe, expect, test } from "vitest";
import { mailboxOptions } from "./cards";

const opts = (googleConnected: boolean, microsoftConnected: boolean, microsoftMailReady: boolean) =>
  mailboxOptions({ googleConnected, microsoftConnected, microsoftMailReady });

describe("mailboxOptions — connected is not the same question as can-send-mail", () => {
  test("a CALENDAR-ONLY Microsoft grant is NOT offered as a mailbox", () => {
    // The regression this file exists for.
    const { options, microsoftNeedsReconsent } = opts(true, true, false);
    expect(options).toEqual(["google"]);
    expect(microsoftNeedsReconsent).toBe(true);
  });

  test("a full Microsoft grant is offered alongside Gmail", () => {
    const { options, microsoftNeedsReconsent } = opts(true, true, true);
    expect(options).toEqual(["google", "microsoft"]);
    expect(microsoftNeedsReconsent).toBe(false);
  });

  test("Microsoft alone is a complete option set — Gmail is not required", () => {
    expect(opts(false, true, true).options).toEqual(["microsoft"]);
  });

  test("no connection at all offers nothing, and does not claim re-consent would help", () => {
    const { options, microsoftNeedsReconsent } = opts(false, false, false);
    expect(options).toEqual([]);
    // Nothing to re-consent: there is no grant. Saying otherwise sends the user to a page that
    // will simply ask them to connect, which the empty option set already implies.
    expect(microsoftNeedsReconsent).toBe(false);
  });

  test("re-consent is offered ONLY when a grant exists but lacks the mail half", () => {
    expect(opts(true, false, false).microsoftNeedsReconsent).toBe(false); // no grant
    expect(opts(true, true, true).microsoftNeedsReconsent).toBe(false); // grant is fine
    expect(opts(true, true, false).microsoftNeedsReconsent).toBe(true); // the narrow case
  });

  test("Google's availability never depends on Microsoft's, and vice versa", () => {
    // Independence: connecting or disconnecting one must never change the other's status.
    expect(opts(true, false, false).options).toContain("google");
    expect(opts(true, true, true).options).toContain("google");
    expect(opts(false, true, true).options).toContain("microsoft");
    expect(opts(true, true, true).options).toContain("microsoft");
  });

  test("the order is stable, so the picker does not reshuffle between renders", () => {
    expect(opts(true, true, true).options).toEqual(["google", "microsoft"]);
  });
});
