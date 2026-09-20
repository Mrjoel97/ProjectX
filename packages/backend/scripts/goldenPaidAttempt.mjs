import { createHash } from "node:crypto";

export class PaidCallUnresolved extends Error {
  constructor(code = "GOLDEN_PAID_CALL_UNRESOLVED") {
    super(code);
  }
}

export class PaidCallFailed extends PaidCallUnresolved {
  constructor() {
    super("GOLDEN_PAID_CALL_FAILED");
  }
}

export class PaidCallCanceled extends PaidCallUnresolved {
  constructor() {
    super("GOLDEN_PAID_CALL_CANCELED");
  }
}

export class PaidCallTimedOut extends PaidCallUnresolved {
  constructor() {
    super("GOLDEN_PAID_CALL_TIMEOUT");
  }
}

const ALLOWED = new Set([
  "llm:runCockpitAgent",
  "llm:runRevenueCandidateEval",
  "vaultSmoke:seedCorpus",
  "evaluations:actOnGapInternal",
]);

const parseFree = (invoke, fn, args) => {
  // Only this refs/hash-only start/status layer may retry after the Windows CLI loses stdout.
  // The server keys both calls by attemptId+requestSha256, so the retry cannot start paid work.
  const call = () => invoke(fn, args, { retryOnEmpty: false, redactErrors: true });
  let output = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      output = call();
    } catch (error) {
      if (attempt === 0 && ["backend_unavailable", "transport_error"].includes(error?.safeReason)) {
        continue;
      }
      // Preserve a terminal error verbatim: collapsing the second transport failure to
      // "unresolved" would erase the distinction operators need.
      throw error;
    }
    if (typeof output === "string" && output.trim() !== "") break;
  }
  if (typeof output !== "string" || output.trim() === "") throw new PaidCallUnresolved();
  try {
    return JSON.parse(output);
  } catch {
    throw new PaidCallUnresolved();
  }
};

/**
 * Start one durable server-side attempt and recover its exact JSON result.
 *
 * A lost start/status response retries only the free idempotent functions. The paid operation is a
 * single `{retry:false}` Workflow step and is never called by this process directly.
 */
export function invokePaidOnce({
  invoke,
  fn,
  args,
  attemptId = args.turnId,
  sleep,
  now = Date.now,
  timeoutMs,
  pollMs,
}) {
  if (
    typeof invoke !== "function" ||
    typeof sleep !== "function" ||
    !ALLOWED.has(fn) ||
    !/^[0-9a-f-]{36}$/.test(attemptId ?? "") ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(pollMs) ||
    pollMs <= 0
  ) {
    throw new Error("GOLDEN_PAID_CALL_INVALID");
  }
  const requestSha256 = createHash("sha256")
    .update(JSON.stringify({ operation: fn, args }))
    .digest("hex");
  const identity = { attemptId, requestSha256, operation: fn };
  const started = parseFree(invoke, "goldenEvalAttempts:start", {
    attemptId,
    requestSha256,
    request: { operation: fn, args },
  });
  if (
    !started ||
    !["started", "existing"].includes(started.state) ||
    typeof started.workflowId !== "string"
  ) {
    throw new PaidCallUnresolved();
  }

  const deadline = now() + timeoutMs;
  for (;;) {
    const observed = parseFree(invoke, "goldenEvalAttempts:status", identity);
    switch (observed?.state) {
      case "completed":
        return JSON.stringify(observed.result);
      case "failed":
        throw new PaidCallFailed();
      case "canceled":
        throw new PaidCallCanceled();
      case "in_progress":
        break;
      default:
        throw new PaidCallUnresolved();
    }
    const observedAt = now();
    if (observedAt >= deadline) throw new PaidCallTimedOut();
    sleep(Math.min(pollMs, deadline - observedAt));
  }
}

/**
 * Wait for the durable evaluation ledger to remain fully settled for a quiet window.
 *
 * One zero-unsettled snapshot is insufficient: scheduled work can reserve its call after the
 * action that scheduled it has returned. Requiring an unchanged, settled ledger for `quietMs`
 * catches that late reservation without ever replaying the paid action. All dependencies are
 * injectable so the timeout and race are proved with a deterministic fake clock.
 */
export function waitForPaidSettlement({
  readStatus,
  sleep,
  now = Date.now,
  timeoutMs,
  pollMs,
  quietMs,
}) {
  if (
    typeof readStatus !== "function" ||
    typeof sleep !== "function" ||
    typeof now !== "function" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(pollMs) ||
    pollMs <= 0 ||
    !Number.isFinite(quietMs) ||
    quietMs < 0 ||
    quietMs > timeoutMs
  ) {
    throw new Error("GOLDEN_SETTLEMENT_POLL_INVALID");
  }

  const deadline = now() + timeoutMs;
  let quietSince = null;
  let quietSignature = null;
  for (;;) {
    const status = readStatus();
    if (
      !status ||
      !Number.isInteger(status.callCount) ||
      !Number.isInteger(status.settledCount) ||
      !Number.isInteger(status.unsettledCount) ||
      !Number.isFinite(status.unresolvedCents) ||
      status.callCount < 0 ||
      status.settledCount < 0 ||
      status.unsettledCount < 0 ||
      status.unresolvedCents < 0 ||
      status.breached ||
      status.expired ||
      status.closed
    ) {
      throw new PaidCallUnresolved();
    }

    const observedAt = now();
    if (status.unsettledCount === 0 && status.unresolvedCents === 0) {
      const signature = `${status.callCount}:${status.settledCount}:${status.actualUsd}`;
      if (signature !== quietSignature) {
        quietSignature = signature;
        quietSince = observedAt;
      }
      if (observedAt - quietSince >= quietMs) return status;
    } else {
      quietSince = null;
      quietSignature = null;
    }

    if (observedAt >= deadline) throw new PaidCallUnresolved();
    sleep(Math.min(pollMs, deadline - observedAt));
  }
}
