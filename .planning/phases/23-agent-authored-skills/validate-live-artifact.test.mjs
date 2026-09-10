import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArtifactBytes, sha256, validateArtifact, writeImmutableArtifact } from "./validate-live-artifact.mjs";
import { AGENT_AUTHORABLE_SKILLS, AGENT_EVAL_SUITE } from "../../../packages/contracts/src/skill.ts";

const privateNeedle = "private-adaptation-75e034e06af943c9bace";
const hash = (n) => String(n).repeat(64);
const row = { scope: "global", id: "global1", name: AGENT_AUTHORABLE_SKILLS[0], version: 1, bodyHash: hash(1), status: "active" };
const state = { sha256: hash(2), auditCount: 2, requestCount: 1, approvedPlanCount: 0, toolGrantSha256: hash(3) };
const h = {
  schema: "phase23-live-handoff.v1", deploymentHash: hash(4), suite: { revision: AGENT_EVAL_SUITE.revision, sha256: AGENT_EVAL_SUITE.casesHash, caseCount: AGENT_EVAL_SUITE.caseCount },
  candidate: { id: "candidate2", tenantId: "tenantA", name: row.name, version: 2, bodyHash: hash(6), author: "agent", authorAgentId: "executive-agent", sourceThreadId: "thread1", sourceTurnId: "turn1", lineage: { basedOnScope: "global", basedOnName: row.name, basedOnVersion: 1, basedOnGlobalSkillId: row.id, basedOnTenantSkillId: null }, status: "candidate", rollbackEligible: false, evidenceState: "absent", gatePassed: false, ownerApproval: null },
  rollbackBaseline: { ...row, scope: "tenant", id: "baseline1", tenantId: "tenantA", status: "archived", author: "system", rollbackEligible: true },
  effectiveBefore: row, globalBefore: row, foreignBefore: { tenantId: "tenantB", candidateIdVisible: false, effective: row },
  authRefs: { primaryStorageStateRef: "e2e/.auth/user.json", foreignStorageStateRef: "e2e/.auth/foreign.json", primaryUserId: "tenantA", foreignUserId: "tenantB" },
  browser: { sourceThreadId: "thread1", observedAt: 100, activityTool: "authorSkillCandidate", candidateCount: 1, authoringToolCalls: 1, authenticated: true, viewportCount: 2, nonOwnerBeforeBootstrap: true, foreignRemainedNonOwner: true, preEvalActivationDisabled: true, refusalBefore: state, refusalAfter: state },
};
const handoffBytes = JSON.stringify(h);
const e = { schema: "phase23-eval-result.v1", handoffSha256: sha256(handoffBytes), deploymentHash: h.deploymentHash, suite: h.suite,
  candidate: { ...h.candidate, evidenceState: "passing", gatePassed: true },
  eval: { runId: "eval1", passed: AGENT_EVAL_SUITE.caseCount, total: AGENT_EVAL_SUITE.caseCount, retries: 0, model: "model-v1", costUsd: 0.1, costCapUsd: 1, authorizationSha256: hash(7) },
  effectiveAfter: row, globalAfter: row, foreignAfter: h.foreignBefore,
  refusal: { actorUserId: "tenantB", tenantId: "tenantB", code: "OWNER_REQUIRED", publicMutation: "skills:activateAgentCandidate", before: state, after: state } };
const evalBytes = JSON.stringify(e);
const ownerApproval = { ownerUserId: "tenantA", approvedAt: 101, evalRunId: "eval1" };
const live = { schema: "phase23-live-result.v1", handoffSha256: e.handoffSha256, evalResultSha256: sha256(evalBytes), deploymentHash: h.deploymentHash, suite: h.suite,
  activation: { candidate: { ...e.candidate, status: "active", rollbackEligible: true, ownerApproval }, effective: { ...row, scope: "tenant", id: h.candidate.id, version: 2, bodyHash: h.candidate.bodyHash }, global: row, foreign: h.foreignBefore, ownerUiClickObserved: true },
  rollback: { candidate: { ...e.candidate, status: "archived", rollbackEligible: true, ownerApproval }, effective: { ...row, scope: "tenant", id: "baseline1" }, global: row, foreign: h.foreignBefore, baselineId: "baseline1", auditEventCount: 1, auditEventId: "audit1" }, eval: e.eval };
const context = { privateNeedle, handoffBytes, evalBytes };
const reject = (kind, original, mutate) => {
  const copy = JSON.parse(JSON.stringify(original));
  mutate(copy);
  assert.throws(() => validateArtifact(kind, copy, context), /PHASE23_ARTIFACT_INVALID/);
};
let cases = 0;
for (const [kind, artifact] of [["handoff", h], ["eval", e], ["live", live]]) {
  validateArtifact(kind, artifact, context);
  // Every object branch must reject added AND missing keys, not just the root.
  const visit = (obj, path = []) => {
    if (obj === null || typeof obj !== "object") return;
    const at = (copy) => path.reduce((v, key) => v[key], copy);
    reject(kind, artifact, (copy) => { at(copy).innocent = "extra"; });
    cases++;
    for (const [key, value] of Object.entries(obj)) {
      reject(kind, artifact, (copy) => { delete at(copy)[key]; });
      cases++;
      if (typeof value === "string") {
        for (const secret of [privateNeedle, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.signature", "sk-abcdefghijklmno", "BEGIN_PRIVATE_CONTENT", "foo@example.com", "Bearer secret"]) {
          reject(kind, artifact, (copy) => { at(copy)[key] = secret; });
          cases++;
        }
      }
      visit(value, [...path, key]);
    }
  };
  visit(artifact);
}
for (const mutate of [
  (v) => { v.candidate.id = v.effectiveBefore.id; },
  (v) => { v.browser.sourceThreadId = "wrong"; },
  (v) => { v.browser.refusalAfter.requestCount++; },
  (v) => { v.authRefs.foreignUserId = "tenantA"; },
  (v) => { v.candidate.lineage.basedOnGlobalSkillId = "wrong"; },
  (v) => { v.rollbackBaseline.bodyHash = hash(9); },
  (v) => { v.browser.viewportCount = 1; },
  (v) => { v.candidate.version = 1.5; },
  (v) => { v.suite.sha256 = hash(9); },
  (v) => { v.candidate.name = "unapproved-skill"; },
]) reject("handoff", h, mutate);
for (const mutate of [
  (v) => { v.candidate.id = "substituted"; },
  (v) => { v.eval.passed--; },
  (v) => { v.eval.costUsd = 2; },
  (v) => { v.eval.costUsd = NaN; },
  (v) => { v.suite.sha256 = hash(9); },
  (v) => { v.refusal.after.auditCount++; },
  (v) => { v.handoffSha256 = hash(9); },
]) reject("eval", e, mutate);
for (const mutate of [
  (v) => { v.rollback.baselineId = "wrong"; },
  (v) => { v.activation.effective.id = "wrong"; },
  (v) => { v.rollback.candidate.ownerApproval.evalRunId = "wrong"; },
  (v) => { v.rollback.foreign.effective.bodyHash = hash(9); },
  (v) => { v.evalResultSha256 = hash(9); },
]) reject("live", live, mutate);
assert.throws(() => validateArtifact("handoff", h, {}));
assert.throws(() => validateArtifact("eval", e, { privateNeedle }));
assert.throws(() => validateArtifact("eval", e, { ...context, handoffBytes: `${handoffBytes}\n` }));
assert.deepEqual(parseArtifactBytes(handoffBytes, privateNeedle), h);
for (const bytes of ['{"id":"first","id":"second"}', '{"nested":{"id":1,"id":2}}', '{"id":"sk-abcdefghijklmnop","id":"public"}', '{"id":', '{"id":"\\u0073k-abcdefghijklmnop"}']) {
  assert.throws(() => parseArtifactBytes(bytes, privateNeedle), /PHASE23_ARTIFACT_INVALID/);
}

const dir = mkdtempSync(join(tmpdir(), "phase23-validator-"));
try {
  const path = join(dir, "23-LIVE-HANDOFF.json");
  writeImmutableArtifact(path, "handoff", h, context);
  const original = readFileSync(path);
  assert.throws(() => writeImmutableArtifact(path, "handoff", h, context), /EEXIST/);
  assert.deepEqual(readFileSync(path), original);
  const bad = structuredClone(h);
  bad.candidate.id = privateNeedle;
  writeFileSync(path, JSON.stringify(bad));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./validate-live-artifact.mjs", import.meta.url)), "handoff", path, "--forbid-env", "PHASE23_PRIVATE_NEEDLE"], { env: { ...process.env, PHASE23_PRIVATE_NEEDLE: privateNeedle }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "PHASE23_ARTIFACT_INVALID\n");
  assert.equal(result.stdout, "");
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`Phase 23 offline validator: ${cases} closed-schema/secret probes plus identity, lifecycle, immutable-write and CLI checks passed.`);
