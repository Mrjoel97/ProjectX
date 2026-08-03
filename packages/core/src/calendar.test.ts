// The pure calendar domain (17-01, ACTN-02). No Convex, no network, no Date.now() — every clock
// is injected, which is what makes all of this synchronously unit-testable.

import { describe, expect, test } from "vitest";
import {
  availabilityWindow,
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_FREEBUSY_SCOPE,
  CALENDAR_HORIZON_MS,
  DRIVE_READONLY_SCOPE,
  eventIdFor,
  GMAIL_MODIFY_SCOPE,
  GOOGLE_SCOPES,
  hasScope,
  toRfc3339,
} from "./calendar";
import { parseSendTime } from "./emailIntent";

describe("eventIdFor — a CLIENT-supplied event id is what buys exactly-once", () => {
  // Google's id grammar is base32hex: [0-9a-v], length 5-1024. This is exactly why
  // crypto.randomUUID() is REJECTED (Pitfall 6) — it emits `-` and the letters w-z, and the 400
  // lands at the LAST step, after the user already approved.
  test("emits only base32hex characters, never a UUID's `-` or w-z", () => {
    for (const seed of ["plan_abc123", "k97xyz", "j57d9q2m4n6p8r0t", "z"]) {
      const id = eventIdFor(seed);
      expect(id).toMatch(/^[0-9a-v]+$/);
      expect(id).not.toMatch(/[w-z-]/);
    }
  });

  test("length is inside Google's 5-1024 bound", () => {
    const id = eventIdFor("plan_abc123");
    expect(id.length).toBeGreaterThanOrEqual(5);
    expect(id.length).toBeLessThanOrEqual(1024);
  });

  // Determinism IS the exactly-once mechanism: a retry recomputes the SAME id, so the second
  // insert 409s — and this phase treats 409 as success.
  test("is deterministic, and different plans differ", () => {
    expect(eventIdFor("plan_a")).toBe(eventIdFor("plan_a"));
    expect(eventIdFor("plan_a")).not.toBe(eventIdFor("plan_b"));
  });
});

describe("toRfc3339", () => {
  test("round-trips through Date.parse", () => {
    for (const ms of [0, 1_700_000_000_000, 2_000_000_000_123]) {
      expect(Date.parse(toRfc3339(ms))).toBe(ms);
    }
  });
});

describe("availabilityWindow — rolling windows off the TRUSTED nowMs", () => {
  const now = 1_700_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;

  test("every range is non-empty", () => {
    for (const r of ["today", "tomorrow", "week"] as const) {
      const w = availabilityWindow(r, now);
      expect(w.toMs).toBeGreaterThan(w.fromMs);
    }
  });

  test("week spans 7 days", () => {
    const w = availabilityWindow("week", now);
    expect(w.toMs - w.fromMs).toBe(7 * DAY);
  });

  test("tomorrow starts at or after today ends", () => {
    expect(availabilityWindow("tomorrow", now).fromMs).toBeGreaterThanOrEqual(
      availabilityWindow("today", now).toMs,
    );
  });
});

describe("hasScope — whole-token matching, because a PREFIX must not pass", () => {
  const granted = `${GMAIL_MODIFY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`;

  test("matches a whole token", () => {
    expect(hasScope(granted, CALENDAR_EVENTS_SCOPE)).toBe(true);
  });

  // The bug this prevents: `freshAccessToken` returns {ok:true} for a token lacking the calendar
  // scope, so a substring match would let a 403 land AFTER the human approved.
  test("a PREFIX of a granted scope is false", () => {
    expect(hasScope(granted, "https://www.googleapis.com/auth/calendar")).toBe(false);
  });

  test("an empty granted string is false", () => {
    expect(hasScope("", CALENDAR_EVENTS_SCOPE)).toBe(false);
  });

  // A user who connected BEFORE the scope widening holds gmail.modify alone. They must be
  // detected and re-consented, not discovered at insert time.
  test("a pre-widening grant does not satisfy the calendar scope", () => {
    expect(hasScope(GMAIL_MODIFY_SCOPE, CALENDAR_EVENTS_SCOPE)).toBe(false);
  });

  // The same trap one widening later (15.3-09): a tenant connected for mail AND calendar still
  // holds no Drive scope, and `freshAccessToken` will happily hand back {ok:true} for that token.
  // Reading this as "connected, therefore Drive-ready" is what turns a reconnect prompt into a 403.
  test("a gmail+calendar grant does not satisfy the Drive scope", () => {
    expect(hasScope(`${GMAIL_MODIFY_SCOPE} ${CALENDAR_EVENTS_SCOPE}`, DRIVE_READONLY_SCOPE)).toBe(
      false,
    );
  });

  test("GOOGLE_SCOPES contains every scope the app requests", () => {
    for (const s of [
      GMAIL_MODIFY_SCOPE,
      CALENDAR_FREEBUSY_SCOPE,
      CALENDAR_EVENTS_SCOPE,
      DRIVE_READONLY_SCOPE,
    ]) {
      expect(hasScope(GOOGLE_SCOPES, s)).toBe(true);
    }
  });
});

// The email path must not move. parseSendTime's 7-day bound is a GMAIL-TOKEN-LIFETIME constraint
// on DEFERRED SEND (a schedule past it finds a dead token at fire time). A calendar event is
// created at APPROVE time, so that bound is simply false for this path — hence the 4th parameter.
describe("parseSendTime horizon widening (17-01)", () => {
  const now = Date.UTC(2026, 0, 5, 12, 0, 0);
  // 10 days out. NOTE: parseSendTime has NO month-name grammar — "January 30 at 3pm" silently
  // resolves to TODAY at 3pm. `in N hours` is the only shipped form that reaches past 7 days.
  const tenDaysOut = "in 240 hours";

  test("3-arg form is unchanged — 10 days out is still tooFar for email", () => {
    expect(parseSendTime(tenDaysOut, now, "UTC").kind).toBe("tooFar");
  });

  test("with CALENDAR_HORIZON_MS the same instant resolves", () => {
    expect(parseSendTime(tenDaysOut, now, "UTC", CALENDAR_HORIZON_MS).kind).toBe("resolved");
  });
});
