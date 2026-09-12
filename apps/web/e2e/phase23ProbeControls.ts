// Offline assertions over native refs-only controls. No credentials, provider or deployment calls.
export type ProbeExpectation = {
  tenantId: string;
  threadId: string;
  budgetId: string;
  authorizationSha256: string;
  capCents: number;
};
type NativeRecord = Record<string, unknown>;
function demand(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`PHASE23_${code}`);
}
function record(value: unknown): NativeRecord {
  demand(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "PROBE_READ_INVALID",
  );
  return value as NativeRecord;
}
export function requestedCap(value: string | undefined): number {
  demand(value !== undefined && /^[1-9]\d{0,3}$/.test(value), "EXPLICIT_PROBE_CAP_REQUIRED");
  const cap = Number(value);
  demand(cap <= 1000, "PROBE_CAP_TOO_LARGE");
  return cap;
}
export function probeReadback(
  probeValue: unknown,
  budgetValue: unknown,
  expected: ProbeExpectation,
  completedTurns: 0 | 1 | 2,
  closed = false,
  now = Date.now(),
) {
  const probe = record(probeValue);
  const budget = record(budgetValue);
  demand(
    probe.tenantId === expected.tenantId &&
      probe.threadId === expected.threadId &&
      probe.authorizationSha256 === expected.authorizationSha256 &&
      budget.budgetId === expected.budgetId &&
      budget.capCents === expected.capCents,
    "PROBE_BINDING_MISMATCH",
  );
  demand(typeof probe.expiresAt === "number" && probe.expiresAt > now, "PROBE_EXPIRED");
  demand(
    probe.started === completedTurns && probe.finished === completedTurns && probe.failed === 0,
    "PROBE_TURNS_UNRESOLVED",
  );
  // A refusal from budget containment is not the policy behavior this adversarial turn tests.
  demand(probe.containmentRefusals === 0, "PROBE_CONTAINMENT_INVALIDATES_POLICY_ACCEPTANCE");
  demand(probe.policyAcceptanceEstablished === false, "PROBE_CONTROL_CANNOT_ATTEST_POLICY");
  demand(
    budget.closed === closed &&
      budget.expired === false &&
      budget.breached === false &&
      budget.unsettledCount === 0 &&
      budget.unresolvedCents === 0,
    "PROBE_BUDGET_UNRESOLVED",
  );
  demand(
    typeof budget.callCount === "number" &&
      Number.isSafeInteger(budget.callCount) &&
      budget.callCount >= completedTurns &&
      budget.callCount <= 500 &&
      budget.settledCount === budget.callCount &&
      (completedTurns !== 0 || budget.callCount === 0),
    "PROBE_CALLS_UNRESOLVED",
  );
  demand(
    typeof budget.actualUsd === "number" &&
      Number.isFinite(budget.actualUsd) &&
      budget.actualUsd >= 0 &&
      budget.actualUsd <= expected.capCents / 100,
    "PROBE_COST_UNRESOLVED",
  );
  return {
    ...expected,
    expiresAt: probe.expiresAt,
    started: completedTurns,
    finished: completedTurns,
    failed: 0,
    containmentRefusals: 0,
    closed,
    actualUsd: budget.actualUsd,
    callCount: budget.callCount,
    settledCount: budget.settledCount,
    unsettledCount: 0,
    // This field stays false: matching counters are not a semantic policy attestation.
    policyAcceptanceEstablished: false,
  };
}
