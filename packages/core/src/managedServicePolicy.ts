import {
  isManagedServiceOperationId,
  type ManagedServiceOperationId,
  type ServiceAccountPin,
  type ServiceSkillPin,
} from "./managedServices";

// Offline policy only: this module neither schedules work nor supplies recurrence admission.
// A future adapter must earn admission, atomically claim an occurrence and persist each receipt.
export const STANDING_SERVICE_GRACE_MS = 5 * 60_000;
export const STANDING_SERVICE_MAX_RETRIES = 1;
export const STANDING_SERVICE_MAX_BUDGET_CENTS = 1000;
export type StandingServiceSchedule = Readonly<{
  cadence: "daily" | "weekly";
  weekday: number | null;
  hour: number;
  minute: number;
  timeZone: string;
}>;
export type StandingServiceTerms = Readonly<{
  goalHash: string;
  operationIds: readonly ManagedServiceOperationId[];
  skillPins: readonly ServiceSkillPin[];
  recipientRefs: readonly string[];
  accountPins: readonly ServiceAccountPin[];
  budgetLimitCents: number;
  schedule: StandingServiceSchedule;
}>;
export type StandingMaterialChange =
  | "instructions"
  | "recipients"
  | "accounts"
  | "budget"
  | "schedule";
const invalid = (): never => {
  throw new Error("STANDING_SERVICE_POLICY_INVALID");
};
const id = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 200;
const integer = (value: number, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = <T>(items: readonly T[], key: (item: T) => string): T[] =>
  [...items].sort((a, b) => key(a).localeCompare(key(b), "en"));

export function validateStandingServiceTerms(terms: StandingServiceTerms): void {
  if (
    !terms ||
    !hash(terms.goalHash) ||
    !integer(terms.budgetLimitCents, 1) ||
    terms.budgetLimitCents > STANDING_SERVICE_MAX_BUDGET_CENTS ||
    !Array.isArray(terms.operationIds) ||
    terms.operationIds.length < 1 ||
    terms.operationIds.length > 4 ||
    terms.operationIds.some((operation) => !isManagedServiceOperationId(operation)) ||
    new Set(terms.operationIds).size !== terms.operationIds.length ||
    !Array.isArray(terms.skillPins) ||
    terms.skillPins.length < 1 ||
    terms.skillPins.length > 8 ||
    !Array.isArray(terms.recipientRefs) ||
    terms.recipientRefs.length > 100 ||
    terms.recipientRefs.some((ref) => !id(ref)) ||
    new Set(terms.recipientRefs).size !== terms.recipientRefs.length ||
    !Array.isArray(terms.accountPins) ||
    terms.accountPins.length > 8
  )
    invalid();
  const names = new Set<string>();
  for (const pin of terms.skillPins) {
    if (
      !pin ||
      !id(pin.skillId) ||
      !id(pin.name) ||
      !integer(pin.version, 1) ||
      !hash(pin.bodyHash) ||
      (pin.tenantId !== null && !id(pin.tenantId)) ||
      names.has(pin.name)
    )
      invalid();
    names.add(pin.name);
  }
  const accounts = new Set<string>();
  for (const pin of terms.accountPins) {
    const key = JSON.stringify([pin?.provider, pin?.accountId]);
    if (
      !pin ||
      !["buffer", "zernio"].includes(pin.provider) ||
      !id(pin.connectionId) ||
      !id(pin.accountId) ||
      !integer(pin.connectionRevision, 1) ||
      accounts.has(key)
    )
      invalid();
    accounts.add(key);
  }
  const s = terms.schedule;
  if (
    !s ||
    !["daily", "weekly"].includes(s.cadence) ||
    !integer(s.hour) ||
    s.hour > 23 ||
    !integer(s.minute) ||
    s.minute > 59 ||
    (s.cadence === "daily"
      ? s.weekday !== null
      : s.weekday === null || !integer(s.weekday) || s.weekday > 6) ||
    !id(s.timeZone)
  )
    invalid();
  try {
    new Intl.DateTimeFormat("en", { timeZone: s.timeZone }).format(0);
  } catch {
    invalid();
  }
}

/** The five ADR-046 groups, compared structurally; display labels and last-run metadata are absent. */
export function standingServiceMaterialChanges(
  before: StandingServiceTerms,
  after: StandingServiceTerms,
): readonly StandingMaterialChange[] {
  validateStandingServiceTerms(before);
  validateStandingServiceTerms(after);
  const changes: StandingMaterialChange[] = [];
  const instructions = (terms: StandingServiceTerms) => [
    terms.goalHash,
    [...terms.operationIds].sort(),
    sorted(terms.skillPins, (pin) => pin.name).map((pin) => [
      pin.skillId,
      pin.name,
      pin.version,
      pin.bodyHash,
      pin.tenantId,
    ]),
  ];
  const accounts = (terms: StandingServiceTerms) =>
    sorted(terms.accountPins, (pin) => JSON.stringify([pin.provider, pin.accountId])).map((pin) => [
      pin.provider,
      pin.connectionId,
      pin.accountId,
      pin.connectionRevision,
    ]);
  if (!same(instructions(before), instructions(after))) changes.push("instructions");
  if (!same([...before.recipientRefs].sort(), [...after.recipientRefs].sort()))
    changes.push("recipients");
  if (!same(accounts(before), accounts(after))) changes.push("accounts");
  if (before.budgetLimitCents !== after.budgetLimitCents) changes.push("budget");
  const schedule = (s: StandingServiceSchedule) => [
    s.cadence,
    s.weekday,
    s.hour,
    s.minute,
    s.timeZone,
  ];
  if (!same(schedule(before.schedule), schedule(after.schedule))) changes.push("schedule");
  return changes;
}

export type StandingOccurrence = Readonly<{
  tenantId: string;
  serviceId: string;
  approvalRevision: number;
  localDate: string;
  requestedLocalTime: string;
  timeZone: string;
  dueAtMs: number;
}>;
/** Requested local date/time, not UTC offset: both sides of a fall-back fold share one identity. */
export function standingOccurrenceKey(occurrence: StandingOccurrence): string {
  const {
    tenantId,
    serviceId,
    approvalRevision,
    localDate,
    requestedLocalTime,
    timeZone,
    dueAtMs,
  } = occurrence;
  if (
    !id(tenantId) ||
    !id(serviceId) ||
    !integer(approvalRevision, 1) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(localDate) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(requestedLocalTime) ||
    !id(timeZone) ||
    !integer(dueAtMs)
  )
    invalid();
  const date = new Date(`${localDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== localDate) invalid();
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
  } catch {
    invalid();
  }
  return JSON.stringify([
    "standing-service-v1",
    tenantId,
    serviceId,
    approvalRevision,
    localDate,
    requestedLocalTime,
    timeZone,
  ]);
}
export type StandingClaimDecision =
  | "claimable"
  | "admission_deferred"
  | "approval_stale"
  | "authorization_required"
  | "paused"
  | "control_changed"
  | "not_due"
  | "skipped_missed"
  | "skipped_overlap"
  | "duplicate"
  | "reconciliation_required";
export function classifyStandingOccurrence(input: {
  admitted: boolean;
  occurrence: StandingOccurrence;
  nowMs: number;
  currentTerms: StandingServiceTerms;
  approval: {
    tenantId: string;
    serviceId: string;
    revision: number;
    terms: StandingServiceTerms;
    expiresAtMs: number;
  };
  control: { state: "active" | "paused" | "stopped"; revision: number };
  expectedControlRevision: number;
  authorization: "valid" | "expired" | "revoked";
  previousOccurrenceKeys: readonly string[];
  activeRun: "none" | "running" | "unknown";
}): StandingClaimDecision {
  const key = standingOccurrenceKey(input.occurrence);
  validateStandingServiceTerms(input.currentTerms);
  validateStandingServiceTerms(input.approval.terms);
  if (
    typeof input.admitted !== "boolean" ||
    !["valid", "expired", "revoked"].includes(input.authorization) ||
    !["active", "paused", "stopped"].includes(input.control.state) ||
    !["none", "running", "unknown"].includes(input.activeRun) ||
    !integer(input.nowMs) ||
    !integer(input.approval.expiresAtMs) ||
    !integer(input.approval.revision, 1) ||
    !integer(input.control.revision, 1) ||
    !integer(input.expectedControlRevision, 1) ||
    !Array.isArray(input.previousOccurrenceKeys) ||
    input.previousOccurrenceKeys.length > 400 ||
    input.previousOccurrenceKeys.some((value) => typeof value !== "string")
  )
    invalid();
  if (!input.admitted) return "admission_deferred";
  if (input.control.state !== "active") return "paused";
  if (input.expectedControlRevision !== input.control.revision) return "control_changed";
  if (input.authorization !== "valid") return "authorization_required";
  const schedule = input.currentTerms.schedule;
  const requestedTime = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  if (
    input.approval.tenantId !== input.occurrence.tenantId ||
    input.approval.serviceId !== input.occurrence.serviceId ||
    input.approval.revision !== input.occurrence.approvalRevision ||
    input.approval.expiresAtMs <= input.nowMs ||
    input.occurrence.timeZone !== schedule.timeZone ||
    input.occurrence.requestedLocalTime !== requestedTime ||
    (schedule.cadence === "weekly" &&
      new Date(`${input.occurrence.localDate}T00:00:00Z`).getUTCDay() !== schedule.weekday) ||
    standingServiceMaterialChanges(input.approval.terms, input.currentTerms).length > 0
  )
    return "approval_stale";
  if (input.previousOccurrenceKeys.includes(key)) return "duplicate";
  if (input.activeRun === "unknown") return "reconciliation_required";
  if (input.nowMs < input.occurrence.dueAtMs) return "not_due";
  if (input.nowMs - input.occurrence.dueAtMs > STANDING_SERVICE_GRACE_MS) return "skipped_missed";
  if (input.activeRun === "running") return "skipped_overlap";
  return "claimable";
}

export type StandingFailureClass =
  | "provider_5xx"
  | "provider_timeout"
  | "internal"
  | "auth"
  | "validation"
  | "budget"
  | "paused"
  | "provider_refusal";
export function standingRetryDecision(input: {
  failure: StandingFailureClass;
  retriesUsed: number;
  costKnown: boolean;
  effectsKnown: boolean;
}): "retryable" | "terminal" | "reconciliation_required" | "retries_exhausted" {
  if (
    !integer(input.retriesUsed) ||
    typeof input.costKnown !== "boolean" ||
    typeof input.effectsKnown !== "boolean" ||
    ![
      "provider_5xx",
      "provider_timeout",
      "internal",
      "auth",
      "validation",
      "budget",
      "paused",
      "provider_refusal",
    ].includes(input.failure)
  )
    invalid();
  if (["auth", "validation", "budget", "paused", "provider_refusal"].includes(input.failure))
    return "terminal";
  if (!input.costKnown || !input.effectsKnown) return "reconciliation_required";
  return input.retriesUsed >= STANDING_SERVICE_MAX_RETRIES ? "retries_exhausted" : "retryable";
}

export type StandingTerminalOutcome =
  | "completed"
  | "auth"
  | "validation"
  | "budget"
  | "paused"
  | "provider_refusal"
  | "retries_exhausted"
  | "execution_uncertain";
export type StandingRunBudget = Readonly<{
  reservationKey: string;
  runRef: string;
  capCents: number;
  phase: "reserved" | "terminal";
  knownSpentCents: number;
  heldCents: number;
  releasedCents: number;
  overrunCents: number;
  terminalOutcome: StandingTerminalOutcome | null;
}>;
const terminalOutcomes: readonly StandingTerminalOutcome[] = [
  "completed",
  "auth",
  "validation",
  "budget",
  "paused",
  "provider_refusal",
  "retries_exhausted",
  "execution_uncertain",
];
function validateBudget(budget: StandingRunBudget): void {
  if (
    !budget ||
    !id(budget.reservationKey) ||
    !id(budget.runRef) ||
    !integer(budget.capCents, 1) ||
    budget.capCents > STANDING_SERVICE_MAX_BUDGET_CENTS ||
    ![budget.knownSpentCents, budget.heldCents, budget.releasedCents, budget.overrunCents].every(
      (value) => integer(value),
    ) ||
    !integer(budget.capCents + budget.overrunCents) ||
    budget.knownSpentCents + budget.heldCents + budget.releasedCents !==
      budget.capCents + budget.overrunCents ||
    (budget.phase === "reserved"
      ? budget.terminalOutcome !== null ||
        budget.heldCents !== budget.capCents ||
        budget.knownSpentCents !== 0 ||
        budget.releasedCents !== 0 ||
        budget.overrunCents !== 0
      : budget.phase !== "terminal" ||
        !terminalOutcomes.includes(budget.terminalOutcome as StandingTerminalOutcome))
  )
    invalid();
}
/** Caller persists the returned whole-run hold with one native CAS before any paid work. */
export function reserveStandingRunBudget(input: {
  reservationKey: string;
  runRef: string;
  capCents: number;
  availableCents: number;
  existing?: StandingRunBudget;
}): StandingRunBudget {
  if (
    !id(input.reservationKey) ||
    !id(input.runRef) ||
    !integer(input.capCents, 1) ||
    input.capCents > STANDING_SERVICE_MAX_BUDGET_CENTS ||
    !integer(input.availableCents)
  )
    invalid();
  if (input.existing) {
    validateBudget(input.existing);
    if (
      input.existing.reservationKey !== input.reservationKey ||
      input.existing.runRef !== input.runRef ||
      input.existing.capCents !== input.capCents
    )
      throw new Error("STANDING_RESERVATION_MISMATCH");
    return input.existing;
  }
  if (input.availableCents < input.capCents) throw new Error("STANDING_BUDGET_UNAVAILABLE");
  return {
    reservationKey: input.reservationKey,
    runRef: input.runRef,
    capCents: input.capCents,
    phase: "reserved",
    knownSpentCents: 0,
    heldCents: input.capCents,
    releasedCents: 0,
    overrunCents: 0,
    terminalOutcome: null,
  };
}
type ObservedSettlement = Readonly<{
  knownSpentCents: number;
  unknownHoldCents: number;
  outcome: StandingTerminalOutcome;
}>;
function applyObservedSettlement(
  budget: StandingRunBudget,
  observed: ObservedSettlement,
): StandingRunBudget {
  if (
    !integer(observed.knownSpentCents) ||
    !integer(observed.unknownHoldCents) ||
    !terminalOutcomes.includes(observed.outcome) ||
    observed.knownSpentCents < budget.knownSpentCents ||
    observed.unknownHoldCents > budget.heldCents ||
    !integer(observed.knownSpentCents + observed.unknownHoldCents)
  )
    invalid();
  const consumed = observed.knownSpentCents - budget.knownSpentCents + observed.unknownHoldCents;
  const releasedCents = budget.releasedCents + Math.max(0, budget.heldCents - consumed);
  const overrunCents = budget.overrunCents + Math.max(0, consumed - budget.heldCents);
  const next: StandingRunBudget = {
    ...budget,
    phase: "terminal",
    knownSpentCents: observed.knownSpentCents,
    heldCents: observed.unknownHoldCents,
    releasedCents,
    overrunCents,
    terminalOutcome: observed.outcome,
  };
  validateBudget(next);
  return next;
}
/** Native observed usage only. Unknown usage remains held on every terminal path. */
export function settleStandingRunBudget(
  budget: StandingRunBudget,
  observed: ObservedSettlement,
): StandingRunBudget {
  validateBudget(budget);
  if (budget.phase === "terminal") {
    if (
      budget.knownSpentCents !== observed.knownSpentCents ||
      budget.heldCents !== observed.unknownHoldCents ||
      budget.terminalOutcome !== observed.outcome
    )
      throw new Error("STANDING_SETTLEMENT_MISMATCH");
    return budget;
  }
  return applyObservedSettlement(budget, observed);
}
/** Reconcile trusted late usage without reclaiming an allowance already released or replaying work. */
export function reconcileStandingRunBudget(
  budget: StandingRunBudget,
  observed: Omit<ObservedSettlement, "outcome">,
): StandingRunBudget {
  validateBudget(budget);
  const outcome = budget.terminalOutcome;
  if (budget.phase !== "terminal" || outcome === null) return invalid();
  if (
    observed.knownSpentCents === budget.knownSpentCents &&
    observed.unknownHoldCents === budget.heldCents
  )
    return budget;
  if (budget.heldCents === 0) throw new Error("STANDING_SETTLEMENT_MISMATCH");
  return applyObservedSettlement(budget, { ...observed, outcome });
}
