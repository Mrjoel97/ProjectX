import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class PaidCallUnresolved extends Error {
  constructor() {
    super("GOLDEN_PAID_CALL_UNRESOLVED");
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

/** One provider-driving action, once. A local receipt never claims unknown usage was free.
 * These are recovery checkpoints, not evaluation evidence or an accounting ledger. */
export function invokePaidOnce({ invoke, directory, fn, args, attemptId = args.turnId }) {
  if (
    ![
      "llm:runCockpitAgent",
      "llm:runRevenueCandidateEval",
      "vaultSmoke:seedCorpus",
      "evaluations:actOnGapInternal",
    ].includes(fn) ||
    !/^[0-9a-f-]{36}$/.test(attemptId ?? "")
  )
    throw new Error("GOLDEN_PAID_CALL_INVALID");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const receipt = {
    schema: "golden-paid-attempt.v1",
    attemptId,
    ...(args.evalBudgetId ? { budgetId: args.evalBudgetId } : {}),
    function: fn,
    requestSha256: hash(JSON.stringify(args)),
    startedAt: Date.now(),
  };
  mkdirSync(directory, { recursive: true });
  const write = (suffix, value) =>
    writeFileSync(join(directory, `${attemptId}.${suffix}.json`), `${JSON.stringify(value)}\n`, {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
  // Exclusive durable write prevents accidental replay of this exact attempt after a crash.
  write("started", receipt);
  let output;
  let response;
  try {
    output = invoke(fn, args, { retryOnEmpty: false, redactErrors: true });
    response = JSON.parse(output);
    if (
      !response ||
      (fn === "evaluations:actOnGapInternal"
        ? typeof response.ok !== "boolean"
        : fn === "vaultSmoke:seedCorpus"
          ? !Array.isArray(response.docIds) ||
            response.docIds.length === 0 ||
            response.docIds.some((id) => typeof id !== "string")
          : typeof response.reply !== "string" ||
            (response.blocked === undefined &&
              (typeof response.costUsd !== "number" ||
                !Number.isFinite(response.costUsd) ||
                response.costUsd < 0)))
    )
      throw new Error();
  } catch {
    try {
      write("unresolved", { ...receipt, state: "unresolved", observedAt: Date.now() });
    } catch {
      /* started receipt remains */
    }
    throw new PaidCallUnresolved();
  }
  try {
    write("returned", {
      ...receipt,
      state: "returned",
      observedAt: Date.now(),
      responseSha256: hash(output),
      costUsd: response.costUsd ?? null,
      blocked: response.blocked !== undefined,
    });
  } catch {
    throw new PaidCallUnresolved();
  }
  return output;
}
