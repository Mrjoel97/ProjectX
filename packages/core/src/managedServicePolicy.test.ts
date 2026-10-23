import { describe, expect, test } from "vitest";
import {
  classifyStandingOccurrence,
  reconcileStandingRunBudget,
  reserveStandingRunBudget,
  STANDING_SERVICE_GRACE_MS,
  type StandingFailureClass,
  type StandingOccurrence,
  type StandingServiceTerms,
  type StandingTerminalOutcome,
  settleStandingRunBudget,
  standingOccurrenceKey,
  standingRetryDecision,
  standingServiceMaterialChanges,
  validateStandingServiceTerms,
} from "./managedServicePolicy";

const terms: StandingServiceTerms = {
  goalHash: "a".repeat(64),
  operationIds: ["social.prepare", "social.report"],
  skillPins: [
    {
      skillId: "cockpit",
      name: "cockpit-agent",
      version: 1,
      bodyHash: "b".repeat(64),
      tenantId: null,
    },
  ],
  recipientRefs: ["recipient one", "recipient-two"],
  accountPins: [
    { provider: "buffer", accountId: "channel", connectionId: "connection", connectionRevision: 1 },
  ],
  budgetLimitCents: 100,
  schedule: { cadence: "daily", weekday: null, hour: 1, minute: 30, timeZone: "America/New_York" },
};
const occurrence: StandingOccurrence = {
  tenantId: "tenant-a",
  serviceId: "social",
  approvalRevision: 1,
  localDate: "2026-11-01",
  requestedLocalTime: "01:30",
  timeZone: "America/New_York",
  dueAtMs: Date.parse("2026-11-01T05:30:00Z"),
};
const claim = () => ({
  admitted: true,
  occurrence,
  nowMs: occurrence.dueAtMs,
  currentTerms: terms,
  approval: {
    tenantId: "tenant-a",
    serviceId: "social",
    revision: 1,
    terms,
    expiresAtMs: occurrence.dueAtMs + 86_400_000,
  },
  control: { state: "active" as const, revision: 1 },
  expectedControlRevision: 1,
  authorization: "valid" as const,
  previousOccurrenceKeys: [],
  activeRun: "none" as const,
});

describe("standing read/prepare policy", () => {
  test("the five material groups preserve list boundaries, exact pins and immaterial ordering", () => {
    expect(
      standingServiceMaterialChanges(terms, {
        ...terms,
        operationIds: [...terms.operationIds].reverse(),
        recipientRefs: [...terms.recipientRefs].reverse(),
      }),
    ).toEqual([]);
    expect(
      standingServiceMaterialChanges(
        { ...terms, recipientRefs: ["a b"] },
        { ...terms, recipientRefs: ["a", "b"] },
      ),
    ).toEqual(["recipients"]);
    expect(
      standingServiceMaterialChanges(terms, {
        ...terms,
        goalHash: "c".repeat(64),
        recipientRefs: [],
        accountPins: terms.accountPins.map((pin) => ({ ...pin, connectionRevision: 2 })),
        budgetLimitCents: 200,
        schedule: { ...terms.schedule, minute: 45 },
      }),
    ).toEqual(["instructions", "recipients", "accounts", "budget", "schedule"]);
    expect(
      standingServiceMaterialChanges(terms, {
        ...terms,
        skillPins: terms.skillPins.map((pin) => ({ ...pin, version: 2 })),
      }),
    ).toEqual(["instructions"]);
  });
  test("unsupported external operations, invalid schedules and malformed envelopes fail closed", () => {
    expect(() =>
      validateStandingServiceTerms({ ...terms, operationIds: ["social.publish" as never] }),
    ).toThrow("STANDING_SERVICE_POLICY_INVALID");
    for (const schedule of [
      { ...terms.schedule, timeZone: "not/a-zone" },
      { ...terms.schedule, minute: 60 },
      { ...terms.schedule, weekday: 2 },
    ])
      expect(() => validateStandingServiceTerms({ ...terms, schedule })).toThrow(
        "STANDING_SERVICE_POLICY_INVALID",
      );
    for (const budgetLimitCents of [0, -1, Number.NaN, 1.5, 1001])
      expect(() => validateStandingServiceTerms({ ...terms, budgetLimitCents })).toThrow(
        "STANDING_SERVICE_POLICY_INVALID",
      );
  });
  test("DST fold identities deduplicate both instants while tenant/version and element boundaries stay distinct", () => {
    expect(standingOccurrenceKey(occurrence)).toBe(
      standingOccurrenceKey({ ...occurrence, dueAtMs: Date.parse("2026-11-01T06:30:00Z") }),
    );
    expect(standingOccurrenceKey({ ...occurrence, tenantId: "tenant-b" })).not.toBe(
      standingOccurrenceKey(occurrence),
    );
    expect(standingOccurrenceKey({ ...occurrence, approvalRevision: 2 })).not.toBe(
      standingOccurrenceKey(occurrence),
    );
    expect(() => standingOccurrenceKey({ ...occurrence, localDate: "2026-02-30" })).toThrow(
      "STANDING_SERVICE_POLICY_INVALID",
    );
    expect(standingOccurrenceKey({ ...occurrence, tenantId: "a b", serviceId: "c" })).not.toBe(
      standingOccurrenceKey({ ...occurrence, tenantId: "a", serviceId: "b c" }),
    );
  });
  test("only a current admitted occurrence can claim; outages skip rather than create a catch-up queue", () => {
    expect(classifyStandingOccurrence(claim())).toBe("claimable");
    expect(classifyStandingOccurrence({ ...claim(), admitted: false })).toBe("admission_deferred");
    expect(classifyStandingOccurrence({ ...claim(), nowMs: occurrence.dueAtMs - 1 })).toBe(
      "not_due",
    );
    expect(
      classifyStandingOccurrence({
        ...claim(),
        nowMs: occurrence.dueAtMs + STANDING_SERVICE_GRACE_MS,
      }),
    ).toBe("claimable");
    expect(
      classifyStandingOccurrence({
        ...claim(),
        nowMs: occurrence.dueAtMs + STANDING_SERVICE_GRACE_MS + 1,
      }),
    ).toBe("skipped_missed");
    expect(classifyStandingOccurrence({ ...claim(), activeRun: "running" })).toBe(
      "skipped_overlap",
    );
    expect(classifyStandingOccurrence({ ...claim(), activeRun: "unknown" })).toBe(
      "reconciliation_required",
    );
    expect(
      classifyStandingOccurrence({
        ...claim(),
        previousOccurrenceKeys: [standingOccurrenceKey(occurrence)],
      }),
    ).toBe("duplicate");
  });
  test("pause fences old callbacks; explicit rearm preserves unchanged standing terms without implicit resume", () => {
    expect(
      classifyStandingOccurrence({ ...claim(), control: { state: "paused", revision: 2 } }),
    ).toBe("paused");
    expect(
      classifyStandingOccurrence({ ...claim(), control: { state: "active", revision: 3 } }),
    ).toBe("control_changed");
    expect(
      classifyStandingOccurrence({
        ...claim(),
        control: { state: "active", revision: 3 },
        expectedControlRevision: 3,
      }),
    ).toBe("claimable");
    expect(classifyStandingOccurrence({ ...claim(), authorization: "expired" })).toBe(
      "authorization_required",
    );
    expect(
      classifyStandingOccurrence({
        ...claim(),
        approval: { ...claim().approval, expiresAtMs: occurrence.dueAtMs },
      }),
    ).toBe("approval_stale");
    expect(
      classifyStandingOccurrence({
        ...claim(),
        currentTerms: { ...terms, goalHash: "f".repeat(64) },
      }),
    ).toBe("approval_stale");
    expect(
      classifyStandingOccurrence({
        ...claim(),
        occurrence: { ...occurrence, requestedLocalTime: "02:30" },
      }),
    ).toBe("approval_stale");
    expect(
      classifyStandingOccurrence({
        ...claim(),
        approval: { ...claim().approval, tenantId: "tenant-b" },
      }),
    ).toBe("approval_stale");
  });
  test("retry classes require known usage and effects; refusal never becomes a spend loop", () => {
    for (const failure of ["provider_5xx", "provider_timeout", "internal"] as const) {
      expect(
        standingRetryDecision({ failure, retriesUsed: 0, costKnown: true, effectsKnown: true }),
      ).toBe("retryable");
      expect(
        standingRetryDecision({ failure, retriesUsed: 1, costKnown: true, effectsKnown: true }),
      ).toBe("retries_exhausted");
      expect(
        standingRetryDecision({ failure, retriesUsed: 0, costKnown: false, effectsKnown: true }),
      ).toBe("reconciliation_required");
      expect(
        standingRetryDecision({ failure, retriesUsed: 0, costKnown: true, effectsKnown: false }),
      ).toBe("reconciliation_required");
    }
    for (const failure of ["auth", "validation", "budget", "paused", "provider_refusal"] as const)
      expect(
        standingRetryDecision({ failure, retriesUsed: 0, costKnown: false, effectsKnown: false }),
      ).toBe("terminal");
    expect(() =>
      standingRetryDecision({
        failure: "unknown" as StandingFailureClass,
        retriesUsed: 0,
        costKnown: true,
        effectsKnown: true,
      }),
    ).toThrow("STANDING_SERVICE_POLICY_INVALID");
  });
});

describe("whole-run reservation and observed settlement projection", () => {
  const request = {
    reservationKey: "occurrence-reservation",
    runRef: "run-a",
    capCents: 100,
    availableCents: 100,
  };
  test("the whole envelope is held up front, duplicate reserve is stable and changed identity refuses", () => {
    const held = reserveStandingRunBudget(request);
    expect(held).toMatchObject({ phase: "reserved", heldCents: 100, releasedCents: 0 });
    expect(reserveStandingRunBudget({ ...request, availableCents: 0, existing: held })).toBe(held);
    expect(() => reserveStandingRunBudget({ ...request, runRef: "run-b", existing: held })).toThrow(
      "STANDING_RESERVATION_MISMATCH",
    );
    expect(() => reserveStandingRunBudget({ ...request, availableCents: 99 })).toThrow(
      "STANDING_BUDGET_UNAVAILABLE",
    );
  });
  test("every terminal path releases only unused allowance and settles idempotently", () => {
    for (const outcome of [
      "completed",
      "auth",
      "validation",
      "budget",
      "paused",
      "provider_refusal",
      "retries_exhausted",
      "execution_uncertain",
    ] as StandingTerminalOutcome[]) {
      const held = reserveStandingRunBudget(request);
      const observed = { knownSpentCents: 13, unknownHoldCents: 0, outcome };
      const terminal = settleStandingRunBudget(held, observed);
      expect(terminal).toMatchObject({
        knownSpentCents: 13,
        heldCents: 0,
        releasedCents: 87,
        overrunCents: 0,
        terminalOutcome: outcome,
      });
      expect(settleStandingRunBudget(terminal, observed)).toBe(terminal);
      expect(reserveStandingRunBudget({ ...request, availableCents: 0, existing: terminal })).toBe(
        terminal,
      );
      expect(() => settleStandingRunBudget(terminal, { ...observed, knownSpentCents: 14 })).toThrow(
        "STANDING_SETTLEMENT_MISMATCH",
      );
    }
  });
  test("unknown holds survive stop and reconcile late usage without replay or duplicate refunds", () => {
    const terminal = settleStandingRunBudget(reserveStandingRunBudget(request), {
      knownSpentCents: 10,
      unknownHoldCents: 20,
      outcome: "paused",
    });
    expect(terminal).toMatchObject({ heldCents: 20, releasedCents: 70 });
    const reconciled = reconcileStandingRunBudget(terminal, {
      knownSpentCents: 15,
      unknownHoldCents: 0,
    });
    expect(reconciled).toMatchObject({
      knownSpentCents: 15,
      heldCents: 0,
      releasedCents: 85,
      terminalOutcome: "paused",
    });
    expect(
      reconcileStandingRunBudget(reconciled, { knownSpentCents: 15, unknownHoldCents: 0 }),
    ).toBe(reconciled);
    expect(() =>
      reconcileStandingRunBudget(reconciled, { knownSpentCents: 16, unknownHoldCents: 0 }),
    ).toThrow("STANDING_SETTLEMENT_MISMATCH");
  });
  test("late provider overrun is reported without reclaiming already released money", () => {
    const terminal = settleStandingRunBudget(reserveStandingRunBudget(request), {
      knownSpentCents: 10,
      unknownHoldCents: 20,
      outcome: "execution_uncertain",
    });
    const reconciled = reconcileStandingRunBudget(terminal, {
      knownSpentCents: 35,
      unknownHoldCents: 0,
    });
    expect(reconciled).toMatchObject({
      knownSpentCents: 35,
      releasedCents: 70,
      heldCents: 0,
      overrunCents: 5,
      terminalOutcome: "execution_uncertain",
    });
    expect(reconciled.knownSpentCents + reconciled.heldCents + reconciled.releasedCents).toBe(
      reconciled.capCents + reconciled.overrunCents,
    );
    const direct = settleStandingRunBudget(reserveStandingRunBudget(request), {
      knownSpentCents: 105,
      unknownHoldCents: 0,
      outcome: "execution_uncertain",
    });
    expect(direct).toMatchObject({ releasedCents: 0, overrunCents: 5 });
  });
});
