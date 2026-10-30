import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMust } from "./smokeRun.mjs";

const fn = "skills:inspectTenantSkill";
const args = { candidateId: "candidate-ref" };
const transport = (name = fn) =>
  new Error(`✖ Failed to run function "${name}":\nTypeError: fetch failed`);

function harness(sequence) {
  const calls = [];
  const must = createMust((name, actualArgs) => {
    calls.push({ name, args: actualArgs });
    assert.ok(calls.length <= sequence.length, "unexpected extra invocation");
    const result = sequence[calls.length - 1];
    if (result instanceof Error) throw result;
    return result;
  });
  return { must, calls };
}

test("valid output is accepted once and arguments are unchanged", () => {
  const h = harness(['{"candidateId":"candidate-ref"}']);
  assert.equal(h.must(fn, args, { retryOnEmpty: true }), '{"candidateId":"candidate-ref"}');
  assert.deepEqual(h.calls, [{ name: fn, args }]);
});

test("a listed read retries the exact observed CLI transport envelope once", () => {
  for (const prefix of ["✖ ", ""]) {
    for (const newline of ["\n", "\r\n"]) {
      const error = new Error(
        `${prefix}Failed to run function "${fn}":${newline}TypeError: fetch failed`,
      );
      const h = harness([error, "{}"]);
      assert.equal(h.must(fn, args, { retryOnEmpty: true }), "{}");
      assert.deepEqual(h.calls, [
        { name: fn, args },
        { name: fn, args },
      ]);
    }
  }
});

test("every allowed target is an actual internalQuery used by the frozen golden reader", () => {
  const helper = readFileSync(new URL("./smokeRun.mjs", import.meta.url), "utf8");
  const names = [
    ...helper
      .match(/const TRANSPORT_RETRY_QUERIES = new Set\(\[([\s\S]*?)\]\)/)[1]
      .matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);
  assert.equal(names.length, 23);
  const runner = readFileSync(new URL("./run-eval-golden.mjs", import.meta.url), "utf8");
  for (const name of names) {
    const [module, exported] = name.split(":");
    const source = readFileSync(new URL(`../convex/${module}.ts`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`export const ${exported} = internalQuery\\(`));
    assert.ok(runner.includes(`"${name}"`));
    const h = harness([transport(name), "{}"]);
    assert.equal(h.must(name, args, { retryOnEmpty: true }), "{}");
    assert.equal(h.calls.length, 2);
  }
});

test("transport retry remains explicitly opt-in", (t) => {
  t.mock.method(console, "error", () => {});
  for (const options of [undefined, {}, { retryOnEmpty: false }]) {
    const error = transport();
    const h = harness([error]);
    assert.throws(
      () => h.must(fn, args, options),
      (actual) => actual === error,
    );
    assert.equal(h.calls.length, 1);
  }
});

test("paid actions, mutations, legacy pack turns and unknown reads never retry transport", (t) => {
  t.mock.method(console, "error", () => {});
  for (const name of [
    "llm:runCockpitAgent",
    "vaultSmoke:seedCorpus",
    "guardrails:openEvalBudget",
    "guardrails:closeEvalBudget",
    "skills:recordTenantEvalEvidence",
    "skills:activateAgentCandidate",
    "workflowPackBinding:runWorkflowPack",
    "tenantDelete:purgeEvalTenant",
    "unknown:read",
    "skills:inspectTenantSkillExtra",
  ]) {
    const error = transport(name);
    const h = harness([error]);
    assert.throws(
      () => h.must(name, args, { retryOnEmpty: true }),
      (actual) => actual === error,
    );
    assert.equal(h.calls.length, 1, name);
  }
});

test("native authority, governed stop and application errors take precedence over network words", (t) => {
  t.mock.method(console, "error", () => {});
  for (const code of [
    "OWNER_REQUIRED",
    "EVAL_BUDGET_EXHAUSTED",
    "EVAL_BUDGET_UNRESOLVED",
    "EVAL_BUDGET_CLOSED",
    "GOLDEN_PROVIDER_BILLING_UNVERIFIED",
  ]) {
    const error = new Error(
      `✖ Failed to run function "${fn}":\nUncaught Error: ${code}; TypeError: fetch failed`,
    );
    const h = harness([error]);
    assert.throws(
      () => h.must(fn, args, { retryOnEmpty: true }),
      (actual) => actual === error,
    );
    assert.equal(h.calls.length, 1);
  }
});

test("bare, mismatched, decorated, payload-bearing and native fetch errors fail closed", (t) => {
  t.mock.method(console, "error", () => {});
  for (const message of [
    "TypeError: fetch failed",
    transport("guardrails:openEvalBudget").message,
    `${transport().message}\nUncaught Error: OWNER_REQUIRED`,
    `${transport().message}\n    at nativeHandler`,
    `${transport().message} PRIVATE_PROVIDER_PAYLOAD`,
    `${transport().message}\n`,
    `\u001b[31m${transport().message}`,
    `✖ Failed to run function "${fn}":\nUncaught TypeError: fetch failed`,
    `✖ Failed to run function "${fn}":\nError: fetch failed`,
    "not listening: fetch failed",
  ]) {
    const error = new Error(message);
    const h = harness([error]);
    assert.throws(
      () => h.must(fn, args, { retryOnEmpty: true }),
      (actual) => actual === error,
    );
    assert.equal(h.calls.length, 1);
  }
});

test("a failed retry is terminal and only the final error is reported", (t) => {
  const logs = [];
  t.mock.method(console, "error", (message) => logs.push(message));
  const last = transport();
  const h = harness([transport(), last]);
  assert.throws(
    () => h.must(fn, args, { retryOnEmpty: true }),
    (actual) => actual === last,
  );
  assert.equal(h.calls.length, 2);
  assert.deepEqual(logs, [last.message]);
});

test("empty stdout and transport failure share one retry allowance", (t) => {
  t.mock.method(console, "error", () => {});
  const error = transport();
  const emptyFirst = harness(["", error]);
  assert.throws(
    () => emptyFirst.must(fn, args, { retryOnEmpty: true }),
    (e) => e === error,
  );
  assert.equal(emptyFirst.calls.length, 2);
  const transportFirst = harness([error, ""]);
  assert.equal(transportFirst.must(fn, args, { retryOnEmpty: true }), "");
  assert.equal(transportFirst.calls.length, 2);
});

test("existing empty-stdout retry remains unchanged", () => {
  const h = harness([" \n", "null"]);
  assert.equal(h.must(fn, args, { retryOnEmpty: true }), "null");
  assert.equal(h.calls.length, 2);
});

test("paid callers stay once-only and suppress all raw failure payloads", (t) => {
  const logs = [];
  t.mock.method(console, "error", (message) => logs.push(message));
  const h = harness([transport("llm:runCockpitAgent")]);
  assert.throws(
    () => h.must("llm:runCockpitAgent", args, { retryOnEmpty: false, redactErrors: true }),
    /^Error: CONVEX_FUNCTION_FAILED$/,
  );
  assert.equal(h.calls.length, 1);
  assert.deepEqual(logs, []);
});
