// DLVR-02: the reauth banner must name the RIGHT provider and the RIGHT subsystem.
//
// This test exists because 25-05 turned a previously-safe assumption into a bug. Before it,
// `awaiting_reauth` could only be set by `gmail.send`, so a held request always meant Google and
// the banner hardcoded that. `graph.send` now sets it too — so a held Microsoft send would have
// told the user to reconnect *Gmail*, sending them to the wrong consent screen while the real
// problem stood.
//
// The quieter half: Microsoft's notification copy is raised by the CALENDAR expiry cron ("keep
// calendar access working"). Reusing it for a MAIL hold describes the wrong subsystem.
//
// It drives `reconnectLines` directly rather than rendering: the component returns null until its
// seen-set loads after mount (deliberate — no flash of a dismissed banner), so a static render
// would assert on an empty string and prove nothing.
import { RECONNECT } from "@pikar/core";
import { describe, expect, test } from "vitest";
import { reconnectLines } from "./ReconnectBanner";

const hold = (mailProvider?: "google" | "microsoft") => ({ mailProvider });
const warn = (provider: "google" | "microsoft") => ({ kind: RECONNECT[provider].kind });

describe("reconnectLines — the line names the mailbox that actually held the send", () => {
  test("a MICROSOFT hold produces a Microsoft line, and no Gmail line at all", () => {
    // THE REGRESSION. Before 25-05's fix this produced `{provider:"google"}` and pointed the user
    // at /connect-gmail.
    expect(reconnectLines([hold("microsoft")], [])).toEqual([
      { provider: "microsoft", message: RECONNECT.microsoft.holdMessage },
    ]);
  });

  test("a GOOGLE hold produces only a Google line", () => {
    expect(reconnectLines([hold("google")], [])).toEqual([
      { provider: "google", message: RECONNECT.google.holdMessage },
    ]);
  });

  test("a LEGACY hold with no mailProvider is Google — the same default delivery.send applies", () => {
    expect(reconnectLines([hold(undefined)], [])).toEqual([
      { provider: "google", message: RECONNECT.google.holdMessage },
    ]);
  });

  test("holds on BOTH providers produce two lines, each with its own copy", () => {
    expect(reconnectLines([hold("microsoft"), hold("google")], [])).toEqual([
      { provider: "google", message: RECONNECT.google.holdMessage },
      { provider: "microsoft", message: RECONNECT.microsoft.holdMessage },
    ]);
  });

  test("a hold OUTRANKS a notification for the same provider", () => {
    // A stuck message is concrete; an expiry warning is not yet.
    expect(reconnectLines([hold("microsoft")], [warn("microsoft")])).toEqual([
      { provider: "microsoft", message: RECONNECT.microsoft.holdMessage },
    ]);
  });

  test("a Microsoft MAIL hold does not describe the calendar", () => {
    // The subsystem bug: the notification copy is the calendar cron's, not the mail path's.
    const [line] = reconnectLines([hold("microsoft")], []);
    expect(line?.message).not.toMatch(/calendar/i);
    expect(RECONNECT.microsoft.message).toMatch(/calendar/i); // …which is right for a notification
  });

  test("a notification with NO hold uses the proactive copy", () => {
    expect(reconnectLines([], [warn("microsoft")])).toEqual([
      { provider: "microsoft", message: RECONNECT.microsoft.message },
    ]);
    expect(reconnectLines([], [warn("google")])).toEqual([
      { provider: "google", message: RECONNECT.google.message },
    ]);
  });

  test("a Google hold never raises a Microsoft line, and vice versa", () => {
    expect(reconnectLines([hold("google")], []).map((l) => l.provider)).not.toContain("microsoft");
    expect(reconnectLines([hold("microsoft")], []).map((l) => l.provider)).not.toContain("google");
  });

  test("nothing to report renders no lines", () => {
    expect(reconnectLines([], [])).toEqual([]);
  });

  test("each provider's line resolves to its OWN consent screen", () => {
    // The concrete harm of the old hardcoding.
    for (const { provider } of reconnectLines([hold("google"), hold("microsoft")], [])) {
      expect(RECONNECT[provider].href).toBe(
        provider === "google" ? "/connect-gmail" : "/connect-microsoft",
      );
    }
  });

  test("neither provider's copy names the other's product", () => {
    expect(RECONNECT.google.holdMessage).not.toMatch(/microsoft|outlook/i);
    expect(RECONNECT.microsoft.holdMessage).not.toMatch(/gmail|google/i);
    expect(RECONNECT.microsoft.message).not.toMatch(/gmail|google/i);
  });
});
