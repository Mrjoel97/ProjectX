// The Microsoft grant contract (17-06, ADR-018). Pure: no Convex, no network, no clock.
//
// The scope checks here guard a failure mode that is invisible offline and expensive live: a
// correctly-connected tenant being told to reconnect forever, because Microsoft echoed a scope
// back in a shape a Google-shaped comparison does not recognise.

import { describe, expect, test } from "vitest";
import {
  hasMicrosoftScope,
  MICROSOFT_SCOPES,
  MS_CALENDARS_READWRITE_SCOPE,
  MS_MAIL_READ_SCOPE,
  MS_MAIL_SEND_SCOPE,
  MS_OFFLINE_ACCESS_SCOPE,
  microsoftCalendarReady,
  microsoftMailReady,
} from "./microsoft";

describe("MICROSOFT_SCOPES — the union grant ADR-018 decided", () => {
  test("carries offline access, both mail scopes and the calendar scope", () => {
    const parts = MICROSOFT_SCOPES.split(" ");
    expect(parts).toContain(MS_OFFLINE_ACCESS_SCOPE);
    expect(parts).toContain(MS_CALENDARS_READWRITE_SCOPE);
    expect(parts).toContain(MS_MAIL_SEND_SCOPE);
    expect(parts).toContain(MS_MAIL_READ_SCOPE);
  });

  test("carries an identity scope, because Mail.Send must name the sending address", () => {
    expect(MICROSOFT_SCOPES.split(" ")).toContain("email");
  });

  // The negative half of minimality. ADR-018 widened this grant ONCE, deliberately; these are the
  // permissions it did NOT take, and a future edit that quietly adds one should turn this red.
  test.each([
    "Contacts.Read",
    "Directory.Read.All",
    "Files.ReadWrite.All",
    "User.ReadWrite.All",
  ])("does not request %s", (forbidden) => {
    expect(hasMicrosoftScope(MICROSOFT_SCOPES, forbidden)).toBe(false);
  });
});

describe("hasMicrosoftScope — why this is not Google's hasScope", () => {
  test("matches a bare scope", () => {
    expect(hasMicrosoftScope("offline_access Calendars.ReadWrite", "Calendars.ReadWrite")).toBe(
      true,
    );
  });

  // Microsoft echoes resource scopes back fully qualified even when requested bare. A comparison
  // written for Google returns false here, and a false answer sends a CONNECTED tenant to reconnect.
  test("matches the fully-qualified form Graph actually returns", () => {
    expect(
      hasMicrosoftScope("https://graph.microsoft.com/Calendars.ReadWrite", "Calendars.ReadWrite"),
    ).toBe(true);
  });

  test("is case-insensitive, because Microsoft does not preserve case", () => {
    expect(hasMicrosoftScope("calendars.readwrite", "Calendars.ReadWrite")).toBe(true);
  });

  // The whole reason this is a segment comparison and not a substring test.
  test("Mail.Read is NOT satisfied by Mail.ReadWrite", () => {
    expect(hasMicrosoftScope("Mail.ReadWrite", "Mail.Read")).toBe(false);
  });

  test("a scope that merely contains the target does not match", () => {
    expect(hasMicrosoftScope("NotCalendars.ReadWriteExtra", "Calendars.ReadWrite")).toBe(false);
  });

  test("tolerates the irregular whitespace a stored grant can carry", () => {
    expect(hasMicrosoftScope("  Mail.Send   Mail.Read  ", "Mail.Read")).toBe(true);
  });

  test("an empty grant grants nothing", () => {
    expect(hasMicrosoftScope("", "Mail.Read")).toBe(false);
  });
});

describe("readiness — a pre-widening grant must be detectable per half", () => {
  test("the full union grant is ready for both halves", () => {
    expect(microsoftCalendarReady(MICROSOFT_SCOPES)).toBe(true);
    expect(microsoftMailReady(MICROSOFT_SCOPES)).toBe(true);
  });

  // This is the shape a token stored before ADR-018 would have. It must read calendar-ready and
  // mail-UNready rather than "connected", or 25-06 sends mail on a grant that cannot send.
  test("a calendar-only grant is calendar-ready and mail-unready", () => {
    const calendarOnly = "offline_access Calendars.ReadWrite";
    expect(microsoftCalendarReady(calendarOnly)).toBe(true);
    expect(microsoftMailReady(calendarOnly)).toBe(false);
  });

  test("mail readiness requires BOTH send and read, never just one", () => {
    expect(microsoftMailReady("offline_access Mail.Send")).toBe(false);
    expect(microsoftMailReady("offline_access Mail.Read")).toBe(false);
    expect(microsoftMailReady("offline_access Mail.Send Mail.Read")).toBe(true);
  });
});
