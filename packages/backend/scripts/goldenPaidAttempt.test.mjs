import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { invokePaidOnce, PaidCallUnresolved, waitForPaidSettlement } from "./goldenPaidAttempt.mjs";

const args = {
  turnId: "abcdef12-1234-4234-8234-123456789abc",
  text: "PRIVATE_NEEDLE_DO_NOT_STORE",
  tenantId: "eval-abcd",
};
const fn = "llm:runCockpitAgent";
test("embedding seed is checkpointed once without forwarding a synthetic turn argument", () => {
  const directory = mkdtempSync(join(tmpdir(), "golden-paid-seed-"));
  try {
    const seedArgs = {
      tenantId: "eval-abcdef12",
      evalBudgetId: "budget-ref",
      needle: "public-fixture",
    };
    let calls = 0;
    const input = {
      directory,
      fn: "vaultSmoke:seedCorpus",
      args: seedArgs,
      attemptId: args.turnId,
      invoke: (_fn, actualArgs) => {
        calls++;
        assert.deepEqual(actualArgs, seedArgs);
        return JSON.stringify({ docIds: ["doc-ref"] });
      },
    };
    invokePaidOnce(input);
    assert.throws(() => invokePaidOnce(input));
    assert.equal(calls, 1);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
test("ambiguous responses never retry or persist content; receipt precedes call", () => {
  for (const response of [
    "",
    "not json",
    JSON.stringify({ reply: args.text }),
    new Error(args.text),
  ]) {
    const directory = mkdtempSync(join(tmpdir(), "golden-paid-"));
    try {
      let calls = 0;
      assert.throws(
        () =>
          invokePaidOnce({
            directory,
            fn,
            args,
            invoke: (_fn, _args, options) => {
              calls++;
              assert.equal(readdirSync(directory).length, 1);
              assert.deepEqual(options, { retryOnEmpty: false, redactErrors: true });
              if (response instanceof Error) throw response;
              return response;
            },
          }),
        PaidCallUnresolved,
      );
      assert.equal(calls, 1);
      for (const file of readdirSync(directory))
        assert.ok(!readFileSync(join(directory, file), "utf8").includes(args.text));
      assert.equal(readdirSync(directory).length, 2);
    } finally {
      rmSync(directory, { recursive: true });
    }
  }
});
test("successful response records observed cost and exact attempt cannot replay", () => {
  const directory = mkdtempSync(join(tmpdir(), "golden-paid-"));
  try {
    let calls = 0;
    const input = {
      directory,
      fn,
      args,
      invoke: () => {
        calls++;
        return JSON.stringify({ reply: args.text, costUsd: 0.01 });
      },
    };
    invokePaidOnce(input);
    assert.throws(() => invokePaidOnce(input));
    assert.equal(calls, 1);
    const receipt = JSON.parse(
      readFileSync(join(directory, `${args.turnId}.returned.json`), "utf8"),
    );
    assert.equal(receipt.costUsd, 0.01);
    assert.ok(!JSON.stringify(receipt).includes(args.text));
  } finally {
    rmSync(directory, { recursive: true });
  }
});

const budgetStatus = (overrides = {}) => ({
  budgetId: "budget-ref",
  closed: false,
  expired: false,
  breached: false,
  callCount: 1,
  settledCount: 1,
  unsettledCount: 0,
  unresolvedCents: 0,
  actualUsd: 0.01,
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
