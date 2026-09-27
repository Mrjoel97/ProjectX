import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  invokePaidOnce,
  PaidCallCanceled,
  PaidCallFailed,
  PaidCallTimedOut,
  PaidCallUnresolved,
  waitForPaidSettlement,
} from "./goldenPaidAttempt.mjs";

const args = {
  turnId: "abcdef12-1234-4234-8234-123456789abc",
  text: "PRIVATE_NEEDLE_DO_NOT_STORE",
  tenantId: "eval-abcd",
};
const fn = "llm:runCockpitAgent";

function durableServer({
  terminal = "completed",
  loseStart = false,
  loseStatus = false,
  throwStart = false,
  throwStatus = false,
} = {}) {
  const attempts = new Map();
  let paidActionCalls = 0;
  let startCalls = 0;
  let statusCalls = 0;
  return {
    invoke(called, input, options) {
      assert.deepEqual(options, { retryOnEmpty: false, redactErrors: true });
      if (called === "goldenEvalAttempts:start") {
        startCalls++;
        const existing = attempts.get(input.attemptId);
        if (existing && existing.requestSha256 !== input.requestSha256) {
          throw new Error("GOLDEN_PAID_ATTEMPT_CONFLICT");
        }
        if (!existing) {
          paidActionCalls++;
          attempts.set(input.attemptId, {
            requestSha256: input.requestSha256,
            operation: input.request.operation,
          });
        }
        if (throwStart && startCalls === 1) {
          const error = new Error("CONVEX_FUNCTION_FAILED");
          error.safeReason = "transport_error";
          throw error;
        }
        if (loseStart && startCalls === 1) return "";
        return JSON.stringify({ state: existing ? "existing" : "started", workflowId: "wf-1" });
      }
      assert.equal(called, "goldenEvalAttempts:status");
      statusCalls++;
      const attempt = attempts.get(input.attemptId);
      assert.equal(attempt.requestSha256, input.requestSha256);
      assert.equal(attempt.operation, input.operation);
      if (throwStatus && statusCalls === 1) {
        const error = new Error("CONVEX_FUNCTION_FAILED");
        error.safeReason = "backend_unavailable";
        throw error;
      }
      if (loseStatus && statusCalls === 1) return "";
      return JSON.stringify(
        terminal === "completed"
          ? { state: terminal, result: { reply: args.text, costUsd: 0.01 } }
          : { state: terminal },
      );
    },
    counts: () => ({ paidActionCalls, startCalls, statusCalls }),
  };
}

const invokeInput = (server, overrides = {}) => ({
  invoke: server.invoke,
  fn,
  args,
  attemptId: args.turnId,
  sleep: () => {},
  timeoutMs: 10_000,
  pollMs: 1_000,
  ...overrides,
});

test("lost start and status stdout recover the exact result without replaying the paid action", () => {
  const server = durableServer({ loseStart: true, loseStatus: true });
  const output = invokePaidOnce(invokeInput(server));
  assert.deepEqual(JSON.parse(output), { reply: args.text, costUsd: 0.01 });
  assert.deepEqual(server.counts(), { paidActionCalls: 1, startCalls: 2, statusCalls: 2 });
});

test("redacted transport loss on start and status recovers without paid replay", () => {
  const server = durableServer({ throwStart: true, throwStatus: true });
  assert.equal(JSON.parse(invokePaidOnce(invokeInput(server))).costUsd, 0.01);
  assert.deepEqual(server.counts(), { paidActionCalls: 1, startCalls: 2, statusCalls: 2 });
});

test("a second free transport failure is preserved", () => {
  const first = new Error("CONVEX_FUNCTION_FAILED");
  first.safeReason = "transport_error";
  const second = new Error("SECOND_TRANSPORT_FAILURE");
  second.safeReason = "transport_error";
  let calls = 0;
  assert.throws(
    () =>
      invokePaidOnce(
        invokeInput(durableServer(), {
          invoke: () => {
            calls++;
            throw calls === 1 ? first : second;
          },
        }),
      ),
    (error) => error === second,
  );
  assert.equal(calls, 2);
});

test("mixed free-call loss modes still make at most one retry", () => {
  let calls = 0;
  assert.throws(
    () =>
      invokePaidOnce(
        invokeInput(durableServer(), {
          invoke: () => {
            calls++;
            if (calls === 1) {
              const error = new Error("CONVEX_FUNCTION_FAILED");
              error.safeReason = "transport_error";
              throw error;
            }
            return "";
          },
        }),
      ),
    PaidCallUnresolved,
  );
  assert.equal(calls, 2);
});

test("re-entering a completed attempt returns its result without another paid invocation", () => {
  const server = durableServer();
  assert.equal(JSON.parse(invokePaidOnce(invokeInput(server))).costUsd, 0.01);
  assert.equal(JSON.parse(invokePaidOnce(invokeInput(server))).costUsd, 0.01);
  assert.equal(server.counts().paidActionCalls, 1);
});

test("failed, canceled, and timeout are distinct terminal outcomes", () => {
  assert.throws(
    () => invokePaidOnce(invokeInput(durableServer({ terminal: "failed" }))),
    PaidCallFailed,
  );
  assert.throws(
    () => invokePaidOnce(invokeInput(durableServer({ terminal: "canceled" }))),
    PaidCallCanceled,
  );
  const clock = fakeClock();
  assert.throws(
    () =>
      invokePaidOnce(
        invokeInput(durableServer({ terminal: "in_progress" }), {
          now: clock.now,
          sleep: clock.sleep,
          timeoutMs: 2_000,
          pollMs: 1_000,
        }),
      ),
    PaidCallTimedOut,
  );
});

test("server workflow has one non-retrying paid step and a closed operation switch", () => {
  const source = readFileSync(new URL("../convex/goldenEvalAttempts.ts", import.meta.url), "utf8");
  assert.equal(source.match(/step\.runAction\(/g)?.length, 1);
  assert.match(source, /step\.runAction\([\s\S]*\{ retry: false \},\s*\);/);
  for (const operation of [
    "llm:runCockpitAgent",
    "llm:runRevenueCandidateEval",
    "vaultSmoke:seedCorpus",
    "evaluations:actOnGapInternal",
  ]) {
    assert.match(source, new RegExp(`case "${operation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":`));
  }
  const table = source.slice(source.indexOf("export const start"));
  assert.ok(!table.includes("text:"));
  assert.ok(!table.includes("prompt:"));
});

const budgetStatus = (overrides = {}) => ({
  budgetId: "budget-ref",
  closed: false,
  expired: false,
  breached: false,
  capCents: 25,
  remainingCents: 24,
  callCount: 1,
  settledCount: 1,
  unsettledCount: 0,
  unresolvedCents: 0,
  actualUsd: 0.01,
  observedUsd: 0.01,
  conservativeUsd: 0,
  conservativeCount: 0,
  ...overrides,
});

function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: (ms) => {
      time += ms;
    },
    elapsed: () => time,
  };
}

test("settlement polling waits through an unresolved reservation and a full quiet window", () => {
  const clock = fakeClock();
  const statuses = [
    budgetStatus({ settledCount: 0, unsettledCount: 1, unresolvedCents: 3 }),
    budgetStatus({ settledCount: 0, unsettledCount: 1, unresolvedCents: 3 }),
    budgetStatus(),
  ];
  let reads = 0;
  const providerCalls = 0;
  const status = waitForPaidSettlement({
    readStatus: () => statuses[Math.min(reads++, statuses.length - 1)],
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 10_000,
    pollMs: 1_000,
    quietMs: 3_000,
  });
  assert.equal(status.unsettledCount, 0);
  assert.equal(clock.elapsed(), 5_000);
  assert.equal(reads, 6);
  assert.equal(providerCalls, 0, "settlement polling must never replay a paid call");
});

test("an initially settled snapshot cannot hide a reservation that appears during the quiet window", () => {
  const clock = fakeClock();
  const statuses = [
    budgetStatus(),
    budgetStatus(),
    budgetStatus({ callCount: 2, settledCount: 1, unsettledCount: 1, unresolvedCents: 4 }),
    budgetStatus({ callCount: 2, settledCount: 2, actualUsd: 0.02 }),
  ];
  let reads = 0;
  const status = waitForPaidSettlement({
    readStatus: () => statuses[Math.min(reads++, statuses.length - 1)],
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 10_000,
    pollMs: 1_000,
    quietMs: 3_000,
  });
  assert.equal(status.callCount, 2);
  assert.equal(status.settledCount, 2);
  assert.equal(clock.elapsed(), 6_000);
  assert.equal(reads, 7);
});

test("case state observed after settlement sees the late durable plan", () => {
  const clock = fakeClock();
  const plan = { status: "collecting" };
  let reads = 0;
  waitForPaidSettlement({
    readStatus: () => {
      reads++;
      if (reads === 3) plan.status = "proposed";
      return reads < 3
        ? budgetStatus({ settledCount: 0, unsettledCount: 1, unresolvedCents: 2 })
        : budgetStatus();
    },
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 10_000,
    pollMs: 1_000,
    quietMs: 2_000,
  });
  assert.equal(plan.status, "proposed");
  assert.equal(reads, 5);
});

test("settlement polling is bounded and fails closed without retrying forever", () => {
  const clock = fakeClock();
  let reads = 0;
  assert.throws(
    () =>
      waitForPaidSettlement({
        readStatus: () => {
          reads++;
          return budgetStatus({ settledCount: 0, unsettledCount: 1, unresolvedCents: 3 });
        },
        now: clock.now,
        sleep: clock.sleep,
        timeoutMs: 3_000,
        pollMs: 1_000,
        quietMs: 2_000,
      }),
    PaidCallUnresolved,
  );
  assert.equal(clock.elapsed(), 3_000);
  assert.equal(reads, 4);
});

test("closed, expired, or breached budgets fail immediately instead of being treated as settled", () => {
  for (const terminal of ["closed", "expired", "breached"]) {
    const clock = fakeClock();
    assert.throws(
      () =>
        waitForPaidSettlement({
          readStatus: () => budgetStatus({ [terminal]: true }),
          now: clock.now,
          sleep: clock.sleep,
          timeoutMs: 3_000,
          pollMs: 1_000,
          quietMs: 2_000,
        }),
      PaidCallUnresolved,
    );
    assert.equal(clock.elapsed(), 0);
  }
});

test("malformed or cross-budget settlement snapshots cannot satisfy the quiet window", () => {
  for (const invalid of [
    { budgetId: "different-budget" },
    { callCount: 1, settledCount: 2 },
    { callCount: 2, settledCount: 1, unsettledCount: 0 },
    { actualUsd: "0.01" },
    { observedUsd: Number.NaN },
    { conservativeUsd: 0.02, conservativeCount: 2 },
    { unresolvedCents: 0.5 },
  ]) {
    const clock = fakeClock();
    assert.throws(
      () =>
        waitForPaidSettlement({
          expectedBudgetId: "budget-ref",
          readStatus: () => budgetStatus(invalid),
          now: clock.now,
          sleep: clock.sleep,
          timeoutMs: 3_000,
          pollMs: 1_000,
          quietMs: 0,
        }),
      PaidCallUnresolved,
      JSON.stringify(invalid),
    );
    assert.equal(clock.elapsed(), 0);
  }
});
