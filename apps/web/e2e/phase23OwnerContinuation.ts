// Pure continuation admission only. No authentication, deployment calls or authorization issuance.
function demand(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

type OwnerMode =
  | { kind: "fresh-bootstrap" }
  | { kind: "existing-owner"; previousThreadId: string; previousBudgetId: string };

/** Explicit continuation never silently falls back to granting ownership again. */
export function phase23OwnerMode(env: Record<string, string | undefined>): OwnerMode {
  const continuation = env.PIKAR_PHASE23_CONTINUE_EXISTING_OWNER;
  if (continuation === undefined) {
    demand(
      env.PIKAR_PHASE23_ALLOW_OWNER_BOOTSTRAP === "1",
      "PHASE23_OWNER_BOOTSTRAP_AUTHORIZATION_REQUIRED",
    );
    demand(
      !env.PIKAR_PHASE23_PREVIOUS_THREAD_ID && !env.PIKAR_PHASE23_PREVIOUS_BUDGET_ID,
      "PHASE23_CONTINUATION_MODE_REQUIRED",
    );
    return { kind: "fresh-bootstrap" };
  }
  demand(
    continuation === "1" && env.PIKAR_PHASE23_ALLOW_OWNER_BOOTSTRAP === undefined,
    "PHASE23_OWNER_MODE_CONFLICT",
  );
  const previousThreadId = env.PIKAR_PHASE23_PREVIOUS_THREAD_ID;
  const previousBudgetId = env.PIKAR_PHASE23_PREVIOUS_BUDGET_ID;
  demand(
    typeof previousThreadId === "string" &&
      /^[a-z0-9]{32}$/.test(previousThreadId) &&
      typeof previousBudgetId === "string" &&
      /^[a-z0-9]{32}$/.test(previousBudgetId),
    "PHASE23_PREVIOUS_ATTEMPT_REFS_REQUIRED",
  );
  return { kind: "existing-owner", previousThreadId, previousBudgetId };
}

/** A stopped zero-use attempt is inspected, never reopened, replayed or force-closed. */
export function assertPhase23PriorAttempt(
  probe: Record<string, unknown>,
  budget: Record<string, unknown>,
  pins: { tenantId: string; threadId: string; budgetId: string; newAuthorizationSha256: string },
  now = Date.now(),
) {
  demand(
    probe.tenantId === pins.tenantId &&
      probe.threadId === pins.threadId &&
      budget.budgetId === pins.budgetId,
    "PHASE23_PREVIOUS_ATTEMPT_BINDING_MISMATCH",
  );
  demand(
    typeof probe.authorizationSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(probe.authorizationSha256) &&
      /^[a-f0-9]{64}$/.test(pins.newAuthorizationSha256) &&
      probe.authorizationSha256 !== pins.newAuthorizationSha256,
    "PHASE23_FRESH_CONTINUATION_AUTHORIZATION_REQUIRED",
  );
  demand(
    typeof probe.expiresAt === "number" &&
      Number.isSafeInteger(probe.expiresAt) &&
      probe.expiresAt > 0 &&
      probe.expiresAt <= now &&
      budget.closed === true &&
      budget.expired === true &&
      budget.breached === false,
    "PHASE23_PREVIOUS_ATTEMPT_NOT_TERMINAL",
  );
  demand(
    probe.started === 0 &&
      probe.finished === 0 &&
      probe.failed === 0 &&
      probe.containmentRefusals === 0 &&
      probe.policyAcceptanceEstablished === false &&
      budget.callCount === 0 &&
      budget.settledCount === 0 &&
      budget.unsettledCount === 0 &&
      budget.unresolvedCents === 0 &&
      budget.actualUsd === 0,
    "PHASE23_PREVIOUS_ATTEMPT_NOT_UNUSED",
  );
  return {
    tenantId: pins.tenantId,
    threadId: pins.threadId,
    budgetId: pins.budgetId,
    authorizationSha256: probe.authorizationSha256,
    closed: true,
    expired: true,
    callCount: 0,
    actualUsd: 0,
    unresolvedCents: 0,
  };
}
