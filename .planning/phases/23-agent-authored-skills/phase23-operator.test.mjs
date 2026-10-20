import assert from "node:assert/strict";
import test from "node:test";
import { assertLiveMatches, stableRead } from "./phase23-operator.mjs";

test("changing readbacks are refused", () => {
  let n = 0;
  assert.throws(() => stableRead(() => ({count: n++})), /MISMATCH/);
  assert.deepEqual(stableRead(() => ({count: 1})), {count: 1});
});
test("exact handoff compares source, immutable candidate, governance, baseline and foreign state", () => {
  const c = {id: "candidate", bodyHash: "hash", status: "candidate", sourceThreadId: "thread", sourceTurnId: "turn", authorAgentId: "executive-agent", ownerApproval: null};
  const artifact = {candidate: c, deploymentHash: "deployment", rollbackBaseline: {id: "baseline"}, effectiveBefore: {id: "old"}, globalBefore: {id: "global"}, foreignBefore: {id: "foreign"}, browser: {refusalAfter: {count: 1}}};
  const snapshot = {candidate: c, deploymentHash: "deployment", rollbackBaseline: artifact.rollbackBaseline, currentEffective: artifact.effectiveBefore, globalCurrent: artifact.globalBefore, foreignCurrent: artifact.foreignBefore};
  const provenance = {...c, tenantSkillId: c.id};
  const source = {candidateCount: 1, authoringToolCalls: 1, candidates: [{tenantSkillId: c.id}], governance: {count: 1}};
  assertLiveMatches("handoff", artifact, snapshot, provenance, source);
  // Both validated witness shapes retain the exact same read-only state/hash comparisons.
  for (const witness of [{nonOwnerBeforeBootstrap: true}, {existingOwnerAtStart: true}])
    for (const authRefs of [
      {primaryStorageStateRef: "e2e/.auth/user.json", foreignStorageStateRef: "e2e/.auth/foreign.json", primaryUserId: "tenantA", foreignUserId: "tenantB"},
      {primaryNativeOrigin: "http://127.0.0.1:3111", foreignNativeOrigin: "http://localhost:3111", primaryUserId: "tenantA", foreignUserId: "tenantB"},
    ]) {
      const witnessed = {...artifact, authRefs, browser: {...artifact.browser, ...witness}};
      assertLiveMatches("handoff", witnessed, snapshot, provenance, source);
      assert.throws(() => assertLiveMatches("handoff", witnessed, {...snapshot, foreignCurrent: {id: "changed"}}, provenance, source));
    }
  for (const key of ["deploymentHash", "currentEffective", "globalCurrent", "foreignCurrent", "rollbackBaseline"])
    assert.throws(() => assertLiveMatches("handoff", artifact, {...snapshot, [key]: "changed"}, provenance, source));
  assert.throws(() => assertLiveMatches("handoff", artifact, snapshot, {...provenance, sourceTurnId: "other"}, source));
  assert.throws(() => assertLiveMatches("handoff", artifact, snapshot, provenance, {...source, candidateCount: 2}));
});
