import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { invokePaidOnce, PaidCallUnresolved } from "./goldenPaidAttempt.mjs";

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
