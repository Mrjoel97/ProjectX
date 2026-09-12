// Read-only continuation preflight. Never authors, evaluates, grants ownership, activates or rolls back.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseArtifactBytes, sha256, validateArtifact } from "./validate-live-artifact.mjs";

const fail = () => { throw new Error("PHASE23_PREFLIGHT_MISMATCH"); };
const equal = (a, b) => { if (!isDeepStrictEqual(a, b)) fail(); };
export function assertLiveMatches(kind, artifact, snapshot, provenance, source) {
  const expected = kind === "live" ? artifact.rollback.candidate : artifact.candidate;
  const actual = {...snapshot.candidate,
    authorAgentId: provenance?.authorAgentId, sourceThreadId: provenance?.sourceThreadId,
    sourceTurnId: provenance?.sourceTurnId, ownerApproval: provenance?.ownerApproval};
  for (const key of Object.keys(expected)) equal(actual[key], expected[key]);
  equal(provenance?.tenantSkillId, expected.id);
  equal(provenance?.bodyHash, expected.bodyHash);
  equal(provenance?.status, expected.status);
  equal(snapshot.deploymentHash, artifact.deploymentHash);
  equal(source.candidateCount, 1);
  equal(source.authoringToolCalls, 1);
  equal(source.candidates?.[0]?.tenantSkillId, expected.id);
  equal(snapshot.currentEffective, kind === "handoff" ? artifact.effectiveBefore : kind === "eval" ? artifact.effectiveAfter : artifact.rollback.effective);
  equal(snapshot.globalCurrent, kind === "handoff" ? artifact.globalBefore : kind === "eval" ? artifact.globalAfter : artifact.rollback.global);
  equal(snapshot.foreignCurrent, kind === "handoff" ? artifact.foreignBefore : kind === "eval" ? artifact.foreignAfter : artifact.rollback.foreign);
  if (kind === "handoff") {
    equal(snapshot.rollbackBaseline, artifact.rollbackBaseline);
    equal(source.governance, artifact.browser.refusalAfter);
  } else {
    equal(snapshot.candidate.evidenceSummary?.runId, artifact.eval.runId);
    equal(snapshot.candidate.evidenceSummary?.caseCount, artifact.suite.caseCount);
    equal(snapshot.candidate.evidenceSummary?.costUsd, artifact.eval.costUsd);
  }
}

export function stableRead(read) {
  const first = read();
  equal(first, read());
  return first;
}

export function preflight(kind, artifactPath, privateNeedle, env = process.env) {
  const directory = dirname(resolve(artifactPath));
  const bytes = readFileSync(artifactPath);
  const artifact = parseArtifactBytes(bytes, privateNeedle);
  const context = {privateNeedle,
    ...(kind !== "handoff" ? {handoffBytes: readFileSync(resolve(directory, "23-LIVE-HANDOFF.json"))} : {}),
    ...(kind === "live" ? {evalBytes: readFileSync(resolve(directory, "23-EVAL-RESULT.json"))} : {})};
  validateArtifact(kind, artifact, context);
  if (env.PIKAR_CONVEX_TARGET && !["prod", "dev"].includes(env.PIKAR_CONVEX_TARGET)) fail();
  // The legacy inspector otherwise fingerprints the dev .env.local label even with --prod.
  if (env.PIKAR_CONVEX_TARGET === "prod" && !/^https:\/\/[^/?#]+\.convex\.cloud\/?$/.test(env.CONVEX_URL ?? ""))
    throw new Error("PHASE23_EXPLICIT_DEPLOYMENT_REQUIRED");
  const backend = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
  const run = (file, args) => {
    const result = spawnSync(process.execPath, [file, ...args], {cwd: backend, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024});
    if (result.error || result.status !== 0) throw new Error("PHASE23_INSPECTION_FAILED");
    try { return JSON.parse(result.stdout); } catch { throw new Error("PHASE23_INSPECTION_FAILED"); }
  };
  const candidate = kind === "live" ? artifact.rollback.candidate : artifact.candidate;
  const foreign = kind === "handoff" ? artifact.foreignBefore : kind === "eval" ? artifact.foreignAfter : artifact.rollback.foreign;
  const inspect = args => run(resolve(backend, "scripts/run-eval-golden.mjs"), args);
  const source = stableRead(() => inspect(["--inspect-agent-source", `${candidate.tenantId}:${candidate.sourceThreadId}`, "--json"]));
  const snapshot = stableRead(() => inspect(["--inspect-tenant-skill", candidate.id, "--foreign-tenant", foreign.tenantId, "--json"]));
  const provenance = stableRead(() => run(resolve(backend, "node_modules/convex/bin/main.js"),
    ["run", ...(env.PIKAR_CONVEX_TARGET === "prod" ? ["--prod"] : []), "skills:inspectAgentCandidate", JSON.stringify({tenantSkillId: candidate.id})]));
  assertLiveMatches(kind, artifact, snapshot, provenance, source);
  return {schema: "phase23-preflight.v1", artifactSha256: sha256(bytes), candidateId: candidate.id,
    status: candidate.status, matchingReads: 6, authSessionVerified: false,
    paidReady: false, paidBlocker: "provider_billing_and_authenticated_exact_candidate_approval_unverified"};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, kind, path, flag, envName, ...extra] = process.argv.slice(2);
    if (mode !== "preflight" || !["handoff", "eval", "live"].includes(kind) || flag !== "--forbid-env" || !/^[A-Z][A-Z0-9_]+$/.test(envName ?? "") || extra.length) fail();
    console.log(JSON.stringify(preflight(kind, path, process.env[envName])));
  } catch { console.error("PHASE23_PREFLIGHT_FAILED"); process.exitCode = 1; }
}
