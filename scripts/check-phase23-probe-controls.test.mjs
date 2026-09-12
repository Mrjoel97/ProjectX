import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { probeReadback, requestedCap } from "../apps/web/e2e/phase23ProbeControls.ts";

const expected = {
  tenantId: "tenant-a",
  threadId: "thread-a",
  budgetId: "budget-a",
  authorizationSha256: "a".repeat(64),
  capCents: 100,
};
const probe = {
  ...expected,
  expiresAt: 2000,
  started: 2,
  finished: 2,
  failed: 0,
  containmentRefusals: 0,
  policyAcceptanceEstablished: false,
};
const budget = {
  budgetId: "budget-a",
  capCents: 100,
  closed: false,
  expired: false,
  breached: false,
  unsettledCount: 0,
  unresolvedCents: 0,
  callCount: 4,
  settledCount: 4,
  actualUsd: 0.01,
};
const read = (p = probe, b = budget) => probeReadback(p, b, expected, 2, false, 1000);

test("an explicit aggregate cap is required and native maximum remains 1000 cents", () => {
  assert.equal(requestedCap("100"), 100);
  for (const value of [undefined, "", "0", "-1", "NaN", "1.5", "1001"])
    assert.throws(() => requestedCap(value));
});
test("native settled two-turn controls remain distinct from policy acceptance", () => {
  assert.equal(read().actualUsd, 0.01);
  assert.equal(read().policyAcceptanceEstablished, false);
  assert.equal(
    probeReadback(probe, { ...budget, closed: true }, expected, 2, true, 1000).closed,
    true,
  );
});
test("wrong tenant/thread/authorization/cap and expired or missing native reads fail closed", () => {
  for (const patch of [
    { tenantId: "other" },
    { threadId: "other" },
    { authorizationSha256: "b".repeat(64) },
    { expiresAt: 999 },
  ])
    assert.throws(() => read({ ...probe, ...patch }));
  assert.throws(() => read(probe, { ...budget, capCents: 101 }));
  assert.throws(() => read(probe, { ...budget, budgetId: "other-envelope" }));
  assert.throws(() => probeReadback(null, budget, expected, 2));
});
test("containment cannot masquerade as an adversarial refusal and unknown provider work cannot pass", () => {
  for (const patch of [
    { containmentRefusals: 1 },
    { failed: 1 },
    { finished: 1 },
    { started: 3 },
    { policyAcceptanceEstablished: true },
  ])
    assert.throws(() => read({ ...probe, ...patch }));
  for (const patch of [
    { unsettledCount: 1 },
    { unresolvedCents: 1 },
    { settledCount: 3 },
    { actualUsd: NaN },
    { actualUsd: 1.01 },
    { breached: true },
    { closed: true },
  ])
    assert.throws(() => read(probe, { ...budget, ...patch }));
});

test("ordinary browser turns use the registered thread and close its budget before immutable handoff", () => {
  const source = readFileSync(
    new URL("../apps/web/e2e/agent-skill-authoring.spec.ts", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/await say\(/g) ?? []).length, 2);
  assert.equal((source.match(/query\("authoringProbe:prepare"/g) ?? []).length, 1);
  assert.equal((source.match(/await openProbe\(page, probe\)/g) ?? []).length, 2);
  assert.ok(
    source.indexOf("readProbe(probe, 2, true)") <
      source.indexOf("validator.writeImmutableArtifact"),
  );
  assert.ok(!source.includes("__convexAuthJWT"));
  assert.ok(!source.includes('name: "New chat"'));
});
