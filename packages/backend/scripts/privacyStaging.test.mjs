import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanEvidence,
  cleanupFixture,
  decodeCliResult,
  requireStaging,
  runPrivacyDrill,
} from "./run-privacy-staging.mjs";

test("a wrong deployment cannot seed or clean any fixtures", async () => {
  let called = false;
  const result = await runPrivacyDrill({
    target: async () => "https://dashboard.convex.dev/d/production",
    invoke: async () => {
      called = true;
    },
    query: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.equal(result.stagingTarget, false);
  assert.throws(() =>
    requireStaging("https://dashboard.convex.dev/d/woozy-wren-368.attacker.example"),
  );
});
test("provider errors remain private and cleanup is attempted for both exact fresh tenants", async () => {
  const targets = new Set();
  const functions = [];
  const result = await runPrivacyDrill({
    target: async () => "https://dashboard.convex.dev/d/woozy-wren-368",
    query: async (source) =>
      source.includes("system.get") ? true : source.includes('"uploadReceipts"') ? 0 : [],
    invoke: async (fn, args) => {
      functions.push(fn);
      if (fn === "guardrails:openEvalBudget") return "private-budget-id";
      if (fn === "requests:generateUploadUrl") throw Error("secret-url-and-provider-body");
      if (fn === "tenantDelete:purgeEvalTenant") {
        assert.equal(args.exact, true);
        assert.equal(args.preserveSpendEvents, true);
        targets.add(args.tenantId);
        return { done: true };
      }
      return {};
    },
  });
  assert.equal(targets.size, 2);
  assert.ok([...targets].every((t) => /^packeval-[a-f0-9]{8}-privacy-[ab]$/.test(t)));
  assert.equal(result.cleanupCompleted, true);
  assert.equal(result.budgetClosed, true);
  assert.equal(result.uploadExport, false);
  const log = booleanEvidence(result);
  assert.equal(log.includes("secret-url"), false);
  assert.equal(log.includes("private-budget"), false);
  assert.ok(functions.includes("guardrails:closeEvalBudget"));
});
test("cleanup refuses non-fixture tenants and exposes no arbitrary metadata in evidence", async () => {
  await assert.rejects(() => cleanupFixture({}, { tenant: "real-user-id" }));
  assert.throws(() => booleanEvidence({ storageId: "private-storage-id" }));
  assert.throws(() => booleanEvidence({ count: 3 }));
});
test("cleanup stops after its page bound instead of broadening or looping forever", async () => {
  let calls = 0;
  await assert.rejects(() =>
    cleanupFixture(
      {
        query: async () => [],
        invoke: async () => {
          calls++;
          return { done: false };
        },
      },
      { tenant: "packeval-12345678-privacy-a" },
    ),
  );
  assert.equal(calls, 50);
});

test("successful silent CLI results represent null without masking malformed output", () => {
  assert.equal(decodeCliResult("\n"), null);
  assert.equal(decodeCliResult("false\n"), false);
  assert.deepEqual(decodeCliResult("[]\n"), []);
  assert.throws(() => decodeCliResult("unparseable provider failure"));
});
