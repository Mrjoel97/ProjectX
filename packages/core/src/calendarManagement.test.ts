// The pure calendar-management contracts (17-05). No Convex, no network, no clock.
//
// Every assertion here is about a CLOSED surface: a provider that is not one of two, an operation
// that is not one of two, an update that changes nothing, a delete that carries content, or a
// registry row that is not a management candidate. The gap-closure plans that follow (17-06..17-09)
// add providers and provider calls; they must not be able to widen any of these by accident.

import { describe, expect, test } from "vitest";
import {
  buildManageIntent,
  CALENDAR_FAILURE_CODES,
  CALENDAR_MANAGE_OPERATIONS,
  CALENDAR_PROVIDERS,
  type CalendarManageIntent,
  type CalendarProvider,
  changedFields,
  DEFAULT_CALENDAR_PROVIDER,
  type ManagedEventSnapshot,
  manageability,
  microsoftUpdateEnabled,
  parseCalendarManageOperation,
  parseCalendarProvider,
  parseGraphProbe,
  providerSupports,
} from "./calendarManagement";

const CURRENT: ManagedEventSnapshot = {
  title: "Governed planning review",
  startMs: Date.UTC(2026, 7, 3, 13, 0),
  durationMs: 30 * 60_000,
  tz: "Africa/Dar_es_Salaam",
};

describe("parseCalendarProvider (G1's closed provider union)", () => {
  // EXACT equality, never `.includes` — a third provider must fail HERE, at the one assertion that
  // reads the whole union, rather than in whichever adapter forgot about it.
  test("the union is exactly google + microsoft", () => {
    expect(CALENDAR_PROVIDERS).toEqual(["google", "microsoft"]);
  });

  test.each(["google", "microsoft"] as const)("%s parses to itself", (p) => {
    expect(parseCalendarProvider(p)).toBe(p);
  });

  // THE no-migration claim, asserted rather than asserted-in-a-comment: every Phase-17 row written
  // before this plan has no `calendarProvider`, and it is a Google row.
  test("an absent provider is GOOGLE — old create plans need no schema migration", () => {
    expect(parseCalendarProvider(undefined)).toBe("google");
    expect(parseCalendarProvider(null)).toBe("google");
    expect(DEFAULT_CALENDAR_PROVIDER).toBe("google");
  });

  // A fallback would send a Microsoft-shaped operation at a Google calendar and the first symptom
  // would be a write against the wrong account.
  test("an unknown provider THROWS rather than defaulting to Google", () => {
    expect(() => parseCalendarProvider("outlook")).toThrow(/CALENDAR_PROVIDER_UNKNOWN:outlook/);
    expect(() => parseCalendarProvider("GOOGLE")).toThrow(/CALENDAR_PROVIDER_UNKNOWN/);
    expect(() => parseCalendarProvider("")).toThrow(/CALENDAR_PROVIDER_UNKNOWN/);
  });
});

describe("parseCalendarManageOperation (G2's closed operation union)", () => {
  test("the union is exactly update + delete — not move/cancel/reschedule as separate members", () => {
    expect(CALENDAR_MANAGE_OPERATIONS).toEqual(["update", "delete"]);
  });

  test.each([
    ["update", "update"],
    ["change", "update"],
    ["edit", "update"],
    ["move", "update"],
    ["reschedule", "update"],
    ["  Reschedule  ", "update"],
    ["delete", "delete"],
    ["cancel", "delete"],
    ["remove", "delete"],
    ["CANCEL", "delete"],
  ] as const)("%s maps to %s", (word, expected) => {
    expect(parseCalendarManageOperation(word)).toBe(expected);
  });

  test("a verb outside the alias map is REFUSED, not guessed", () => {
    expect(() => parseCalendarManageOperation("postpone")).toThrow(/CALENDAR_OPERATION_UNKNOWN/);
    expect(() => parseCalendarManageOperation("archive")).toThrow(/CALENDAR_OPERATION_UNKNOWN/);
    expect(() => parseCalendarManageOperation(undefined)).toThrow(/CALENDAR_OPERATION_UNKNOWN/);
    expect(() => parseCalendarManageOperation("")).toThrow(/CALENDAR_OPERATION_UNKNOWN/);
  });
});

describe("changedFields + buildManageIntent (a desired update must actually change something)", () => {
  test("only the fields that DIFFER come back", () => {
    expect(
      changedFields(CURRENT, { title: CURRENT.title, startMs: CURRENT.startMs + 300_000 }),
    ).toEqual({ startMs: CURRENT.startMs + 300_000 });
    expect(changedFields(CURRENT, {})).toEqual({});
    expect(changedFields(CURRENT, { ...CURRENT })).toEqual({});
  });

  test("an update carries the changed subset and nothing else", () => {
    const intent = buildManageIntent({
      operation: "update",
      current: CURRENT,
      desired: { title: "Governed planning review", startMs: CURRENT.startMs + 900_000, tz: "UTC" },
    });
    expect(intent).toEqual({
      operation: "update",
      changed: { startMs: CURRENT.startMs + 900_000, tz: "UTC" },
    });
  });

  test("an update that changes nothing is REFUSED — a provider round-trip for no diff", () => {
    expect(() => buildManageIntent({ operation: "update", current: CURRENT, desired: {} })).toThrow(
      /CALENDAR_UPDATE_EMPTY/,
    );
    expect(() =>
      buildManageIntent({ operation: "update", current: CURRENT, desired: { ...CURRENT } }),
    ).toThrow(/CALENDAR_UPDATE_EMPTY/);
    expect(() => buildManageIntent({ operation: "update", current: CURRENT })).toThrow(
      /CALENDAR_UPDATE_EMPTY/,
    );
  });

  test("a delete carries NO desired content, and one that tries is refused", () => {
    expect(buildManageIntent({ operation: "delete", current: CURRENT })).toEqual({
      operation: "delete",
    });
    expect(buildManageIntent({ operation: "delete", current: CURRENT, desired: {} })).toEqual({
      operation: "delete",
    });
    expect(() =>
      buildManageIntent({ operation: "delete", current: CURRENT, desired: { title: "x" } }),
    ).toThrow(/CALENDAR_DELETE_HAS_DESIRED/);
  });
});

describe("manageability (the pre-provider refusal gate)", () => {
  const ACTIVE = { status: "active", attendeeFree: true, etag: 'W/"1"' } as const;

  test("a Pikar-created, attendee-free, etag-bearing active row is manageable", () => {
    expect(manageability(ACTIVE)).toEqual({ ok: true });
  });

  test("a deleted row reports not_found BEFORE anything else is inspected", () => {
    expect(manageability({ status: "deleted", attendeeFree: true, etag: 'W/"1"' })).toEqual({
      ok: false,
      code: "not_found",
    });
    // Ordering matters: a deleted row with no etag must still say not_found, not needs_inspection.
    expect(manageability({ status: "deleted", attendeeFree: false })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  // The single sharpest governance hazard in this phase: touching an attendee-bearing event can
  // make the provider email people on our behalf, outside plan/audit/DLQ. Refuse before provider.
  test("an attendee-bearing row is refused", () => {
    expect(manageability({ ...ACTIVE, attendeeFree: false })).toEqual({
      ok: false,
      code: "attendees_present",
    });
  });

  test("an etag-less legacy row is NOT manageable until provider inspection", () => {
    expect(manageability({ status: "active", attendeeFree: true })).toEqual({
      ok: false,
      code: "needs_inspection",
    });
  });
});

describe("CALENDAR_FAILURE_CODES (§4 — codes, never provider prose)", () => {
  test("the vocabulary is exactly the eight bounded codes", () => {
    expect(CALENDAR_FAILURE_CODES).toEqual([
      "conflict",
      "not_found",
      "reauth",
      "attendees_present",
      "needs_inspection",
      "not_managed",
      "provider_unsupported",
      "provider_error",
    ]);
  });

  // Every code is a short lowercase token. A code that grew into a sentence would be the first
  // step towards a provider body reaching an audit row.
  test("every code is a short snake_case token, so none can carry a provider message", () => {
    for (const code of CALENDAR_FAILURE_CODES) {
      expect(code, code).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(code.length, code).toBeLessThanOrEqual(20);
    }
  });
});

// ── 17-08 Task 2: what each provider may be ASKED to do, and what the probe may unlock ────────
//
// These two surfaces are deliberately separate functions. `providerSupports` decides whether an
// operation is attemptable AT ALL and has no probe parameter; `microsoftUpdateEnabled` reads the
// probe. ADR-023 forbids a measured DELETE result from ever widening delete, and the cheapest way
// to guarantee that is to leave the delete decision nowhere to read a measurement from.

/** The REAL committed 17-07 artifact, verbatim, so this file fails if the gate stops matching it. */
const REAL_PROBE = {
  schema: "phase17-graph-concurrency-probe.v1",
  deploymentUrlHash: "fe9caaa6ad03ad51f45975cc2438e3bcd036d723278064876efbdc7b71e82d5b",
  accountIdHash: "199b7e12b06ac39afeffb7242755e5ea6dbbae431d81829fdd5aae40437d60ec",
  stalePatchStatus: 412,
  stalePatchPreserved: true,
  staleDeleteStatus: 204,
  staleDeletePreserved: false,
  supported: false,
};
const BOUND = {
  deploymentUrlHash: REAL_PROBE.deploymentUrlHash,
  accountIdHash: REAL_PROBE.accountIdHash,
};

describe("providerSupports (ADR-023 — Microsoft cancel/delete is a PRODUCT SURFACE, not a hole)", () => {
  test("Google does the full set, and Microsoft may be asked to update", () => {
    expect(providerSupports("google", "update")).toEqual({ ok: true });
    expect(providerSupports("google", "delete")).toEqual({ ok: true });
    expect(providerSupports("microsoft", "update")).toEqual({ ok: true });
  });

  test("a Microsoft delete is REFUSED with a named provider-limitation code", () => {
    expect(providerSupports("microsoft", "delete")).toEqual({
      ok: false,
      code: "provider_unsupported",
    });
  });

  // The refusal must be distinguishable from every other failure. `provider_error` is the bounded
  // catch-all for "the provider said no this time"; this one means "we will never ask", and a card
  // that renders them the same way would tell the user to retry something that cannot work.
  test("the refusal code is not the transient catch-all", () => {
    const refusal = providerSupports("microsoft", "delete");
    expect(refusal.ok).toBe(false);
    expect(refusal.ok === false && refusal.code).not.toBe("provider_error");
    expect(CALENDAR_FAILURE_CODES).toContain("provider_unsupported");
  });

  // THE ANTI-WIDENING PIN. A probe cannot enable Microsoft delete because there is no parameter to
  // hand one to. If a later edit adds a third argument, this fails before any behaviour changes.
  test("the delete decision structurally cannot read a probe — arity is exactly (provider, operation)", () => {
    expect(providerSupports.length).toBe(2);
  });
});

describe("parseGraphProbe (a probe that cannot be trusted is the same as no probe)", () => {
  test("the committed 17-07 artifact parses", () => {
    expect(parseGraphProbe(JSON.stringify(REAL_PROBE))).toMatchObject({
      schema: "phase17-graph-concurrency-probe.v1",
      stalePatchStatus: 412,
      stalePatchPreserved: true,
    });
  });

  test("missing, blank and malformed all resolve to null rather than a default", () => {
    expect(parseGraphProbe(undefined)).toBeNull();
    expect(parseGraphProbe(null)).toBeNull();
    expect(parseGraphProbe("   ")).toBeNull();
    expect(parseGraphProbe("{not json")).toBeNull();
    expect(parseGraphProbe("[]")).toBeNull();
    expect(parseGraphProbe('"a string"')).toBeNull();
  });

  test("a probe from a different schema version is not read as this one", () => {
    expect(parseGraphProbe(JSON.stringify({ ...REAL_PROBE, schema: "…v2" }))).toBeNull();
  });

  // Each field individually: a probe missing the very field the gate reads must not parse into a
  // shape whose `undefined` then compares falsely-safe downstream.
  test("a field of the wrong type makes the whole probe unusable", () => {
    const broken: Record<string, unknown>[] = [
      { ...REAL_PROBE, stalePatchStatus: "412" },
      { ...REAL_PROBE, stalePatchPreserved: "true" },
      { ...REAL_PROBE, deploymentUrlHash: 1 },
      { ...REAL_PROBE, accountIdHash: undefined },
    ];
    for (const b of broken)
      expect(parseGraphProbe(JSON.stringify(b)), JSON.stringify(b)).toBeNull();
  });
});

describe("microsoftUpdateEnabled (the stalePatch PAIR, bound to one deployment and one account)", () => {
  const probe = parseGraphProbe(JSON.stringify(REAL_PROBE));

  test("the measured 412 + preserved pair on the bound deployment/account enables UPDATE", () => {
    expect(microsoftUpdateEnabled({ probe, ...BOUND })).toBe(true);
  });

  // `supported: false` is the COLLAPSED boolean ADR-023 exists to reject. The gate must read the
  // two stalePatch fields apart from it, or a safe PATCH stays unreachable behind an unsafe DELETE.
  test("the collapsed `supported: false` does not veto a passing stalePatch pair", () => {
    expect(REAL_PROBE.supported).toBe(false);
    expect(microsoftUpdateEnabled({ probe, ...BOUND })).toBe(true);
  });

  test("no probe means NO Microsoft update — absence is a refusal, not a default", () => {
    expect(microsoftUpdateEnabled({ probe: null, ...BOUND })).toBe(false);
  });

  test("a probe that did not measure a refused stale PATCH does not enable update", () => {
    for (const bad of [
      { ...REAL_PROBE, stalePatchStatus: 200 },
      { ...REAL_PROBE, stalePatchStatus: 204 },
      { ...REAL_PROBE, stalePatchPreserved: false },
    ]) {
      expect(
        microsoftUpdateEnabled({ probe: parseGraphProbe(JSON.stringify(bad)), ...BOUND }),
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  // The binding is what stops a passing dev probe being pasted into production, or one tenant's
  // measured grant vouching for another's.
  test("a probe bound to another deployment or another account does not carry over", () => {
    expect(microsoftUpdateEnabled({ ...BOUND, probe, deploymentUrlHash: "deadbeef" })).toBe(false);
    expect(microsoftUpdateEnabled({ ...BOUND, probe, accountIdHash: "deadbeef" })).toBe(false);
  });

  // THE ADR-023 PIN, stated as an executable claim: even a probe that reported a REFUSED stale
  // delete — the exact evidence a future widening would rest on — enables nothing here today.
  test("a hypothetical 412-on-DELETE probe still does not enable Microsoft delete", () => {
    const generous = parseGraphProbe(
      JSON.stringify({ ...REAL_PROBE, staleDeleteStatus: 412, staleDeletePreserved: true }),
    );
    expect(microsoftUpdateEnabled({ probe: generous, ...BOUND })).toBe(true);
    expect(providerSupports("microsoft", "delete")).toEqual({
      ok: false,
      code: "provider_unsupported",
    });
  });
});

// ── Compile-time proof (checked by `tsc --noEmit`, NOT by vitest) ─────────────────────────────
// `@ts-expect-error` FAILS THE BUILD when the error it expects does not occur, so if a future edit
// ever makes these unions permissive, this file stops compiling.

// @ts-expect-error — a third provider MUST NOT be assignable to CalendarProvider.
const _NOT_A_PROVIDER: CalendarProvider = "outlook";

// @ts-expect-error — the `delete` arm of the discriminated union has nowhere to put desired
// content, so a delete carrying `changed` is not merely refused at runtime: it does not compile.
const _DELETE_WITH_CONTENT: CalendarManageIntent = { operation: "delete", changed: {} };
