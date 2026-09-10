// Offline evidence validation. This does not observe a deployment or authorize a live operation.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_AUTHORABLE_SKILLS, AGENT_EVAL_SUITE, EXECUTIVE_AGENT_AUTHOR_ID } from "../../../packages/contracts/src/skill.ts";

const fail = () => { throw new Error("PHASE23_ARTIFACT_INVALID"); };
const check = (ok) => { if (!ok) fail(); };
const literal = (expected) => (v) => check(v === expected);
const oneOf = (...values) => (v) => check(values.includes(v));
const string = (pattern) => (v) => check(typeof v === "string" && pattern.test(v));
const ref = string(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const hash = string(/^[a-f0-9]{64}$/);
const count = (v) => check(Number.isSafeInteger(v) && v >= 0);
const positive = (v) => { count(v); check(v > 0); };
const money = (v) => check(typeof v === "number" && Number.isFinite(v) && v >= 0);
const exact = (shape) => (v) => {
  check(v !== null && typeof v === "object" && !Array.isArray(v));
  check(Object.keys(v).length === Object.keys(shape).length);
  for (const [key, validate] of Object.entries(shape)) {
    check(Object.hasOwn(v, key));
    validate(v[key]);
  }
};
const suite = exact({ revision: ref, sha256: hash, caseCount: positive });
const skillFields = { scope: oneOf("global", "tenant"), id: ref, name: ref, version: positive, bodyHash: hash, status: literal("active") };
const skill = exact(skillFields);
const globalSkill = exact({ ...skillFields, scope: literal("global") });
const foreign = exact({ tenantId: ref, candidateIdVisible: literal(false), effective: skill });
const baseline = exact({ ...skillFields, scope: literal("tenant"), tenantId: ref, status: literal("archived"), author: literal("system"), rollbackEligible: literal(true) });
const lineage = (v) => {
  const scope = v?.basedOnScope;
  exact({ basedOnScope: oneOf("global", "tenant"), basedOnName: ref, basedOnVersion: positive,
    basedOnGlobalSkillId: scope === "global" ? ref : literal(null),
    basedOnTenantSkillId: scope === "tenant" ? ref : literal(null) })(v);
};
const approval = exact({ ownerUserId: ref, approvedAt: positive, evalRunId: ref });
const candidateFields = {
  id: ref, tenantId: ref, name: oneOf(...AGENT_AUTHORABLE_SKILLS), version: positive, bodyHash: hash,
  author: literal("agent"), authorAgentId: literal(EXECUTIVE_AGENT_AUTHOR_ID),
  sourceThreadId: ref, sourceTurnId: ref, lineage,
};
const candidate = (stage) => exact({ ...candidateFields,
  status: stage === "rollback" ? oneOf("archived", "rolled_back") : literal(stage === "active" ? "active" : "candidate"),
  rollbackEligible: literal(stage === "active" || stage === "rollback"),
  evidenceState: literal(stage === "handoff" ? "absent" : "passing"),
  gatePassed: literal(stage !== "handoff"),
  ownerApproval: stage === "active" || stage === "rollback" ? approval : literal(null),
});
const state = exact({ sha256: hash, auditCount: count, requestCount: count, approvedPlanCount: count, toolGrantSha256: hash });
const evalRun = exact({ runId: ref, passed: positive, total: positive, retries: count, model: ref, costUsd: money, costCapUsd: money, authorizationSha256: hash });
const authRefs = exact({ primaryStorageStateRef: literal("e2e/.auth/user.json"), foreignStorageStateRef: literal("e2e/.auth/foreign.json"), primaryUserId: ref, foreignUserId: ref });
const browser = exact({ sourceThreadId: ref, observedAt: positive, activityTool: literal("authorSkillCandidate"), candidateCount: literal(1), authoringToolCalls: literal(1), authenticated: literal(true), viewportCount: positive, nonOwnerBeforeBootstrap: literal(true), foreignRemainedNonOwner: literal(true), preEvalActivationDisabled: literal(true), refusalBefore: state, refusalAfter: state });
const schemas = {
  handoff: exact({ schema: literal("phase23-live-handoff.v1"), deploymentHash: hash, suite, candidate: candidate("handoff"), rollbackBaseline: baseline, effectiveBefore: skill, globalBefore: globalSkill, foreignBefore: foreign, authRefs, browser }),
  eval: exact({ schema: literal("phase23-eval-result.v1"), handoffSha256: hash, deploymentHash: hash, suite, candidate: candidate("eval"), eval: evalRun,
    effectiveAfter: skill, globalAfter: globalSkill, foreignAfter: foreign,
    refusal: exact({ actorUserId: ref, tenantId: ref, code: literal("OWNER_REQUIRED"), publicMutation: literal("skills:activateAgentCandidate"), before: state, after: state }) }),
  live: exact({ schema: literal("phase23-live-result.v1"), handoffSha256: hash, evalResultSha256: hash, deploymentHash: hash, suite,
    activation: exact({ candidate: candidate("active"), effective: skill, global: globalSkill, foreign, ownerUiClickObserved: literal(true) }),
    rollback: exact({ candidate: candidate("rollback"), effective: skill, global: globalSkill, foreign, baselineId: ref, auditEventCount: literal(1), auditEventId: ref }),
    eval: evalRun }),
};

// Scan VALUES, including fields whose innocuous names offer no hint of their contents.
// Closed identifier alphabets above additionally reject prose, URLs and email addresses.
function scan(value, needle) {
  if (typeof value === "string") {
    check(!value.includes(needle));
    check(!/(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s|sk-[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|-----BEGIN|(?:password|secret|access_token|refresh_token|api_key)\s*[:=]|<\/?(?:system|user|assistant)>|BEGIN[_ -](?:PRIVATE|PROMPT|CONTENT)|[^\s@]+@[^\s@]+\.[^\s@]+)/i.test(value));
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) scan(item, needle);
  }
}
const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
const equal = (a, b) => check(canonical(a) === canonical(b));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (c) => Object.fromEntries(Object.keys(candidateFields).map((k) => [k, c[k]]));

/** JSON.parse discards duplicate keys. Check original tokens so an overwritten secret cannot hide. */
export function parseArtifactBytes(bytes, privateNeedle) {
  check(typeof privateNeedle === "string" && privateNeedle.length >= 24);
  try {
    const raw = bytes.toString();
    const value = JSON.parse(raw);
    const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) ?? [];
    for (const token of tokens) if (token.startsWith('"')) scan(JSON.parse(token), privateNeedle);
    let cursor = 0;
    const read = () => {
      const token = tokens[cursor++];
      if (token === "{") {
        const keys = new Set();
        if (tokens[cursor] !== "}") do {
          const key = JSON.parse(tokens[cursor++]);
          check(!keys.has(key));
          keys.add(key);
          check(tokens[cursor++] === ":");
          read();
          if (tokens[cursor] !== ",") break;
          cursor++;
        } while (true);
        check(tokens[cursor++] === "}");
      } else if (token === "[") {
        if (tokens[cursor] !== "]") do {
          read();
          if (tokens[cursor] !== ",") break;
          cursor++;
        } while (true);
        check(tokens[cursor++] === "]");
      }
    };
    read();
    check(cursor === tokens.length);
    return value;
  } catch { fail(); }
}

/** Context includes ORIGINAL bytes: a parsed/re-serialized handoff is not its immutable hash. */
export function validateArtifact(kind, value, { privateNeedle, handoffBytes, evalBytes } = {}) {
  check(typeof privateNeedle === "string" && privateNeedle.length >= 24 && privateNeedle.trim() === privateNeedle);
  check(Object.hasOwn(schemas, kind));
  scan(value, privateNeedle);
  schemas[kind](value);
  if (kind === "handoff") {
    const { candidate: c, rollbackBaseline: b, effectiveBefore: e, foreignBefore: f, browser: w, authRefs: a } = value;
    equal(value.suite, { revision: AGENT_EVAL_SUITE.revision, sha256: AGENT_EVAL_SUITE.casesHash, caseCount: AGENT_EVAL_SUITE.caseCount });
    check(c.tenantId === a.primaryUserId && f.tenantId === a.foreignUserId && a.primaryUserId !== a.foreignUserId);
    check(c.sourceThreadId === w.sourceThreadId && w.viewportCount >= 2);
    check(c.id !== e.id && c.id !== b.id && c.id !== f.effective.id && c.bodyHash !== f.effective.bodyHash);
    check(b.tenantId === c.tenantId && b.bodyHash === e.bodyHash);
    for (const row of [b, e, value.globalBefore, f.effective]) check(row.name === c.name);
    check(c.lineage.basedOnName === c.name);
    if (c.lineage.basedOnScope === "global") {
      check(c.lineage.basedOnGlobalSkillId === value.globalBefore.id && c.lineage.basedOnVersion === value.globalBefore.version);
    } else {
      check(c.lineage.basedOnTenantSkillId === e.id && c.lineage.basedOnVersion === e.version);
    }
    equal(w.refusalBefore, w.refusalAfter);
  } else {
    check(typeof handoffBytes === "string" || Buffer.isBuffer(handoffBytes));
    const h = parseArtifactBytes(handoffBytes, privateNeedle);
    validateArtifact("handoff", h, { privateNeedle });
    check(value.handoffSha256 === sha256(handoffBytes));
    equal(value.suite, h.suite);
    check(value.deploymentHash === h.deploymentHash);
    check(value.eval.passed === value.eval.total && value.eval.total === h.suite.caseCount);
    check(value.eval.retries <= value.eval.total && value.eval.costUsd <= value.eval.costCapUsd);
    if (kind === "eval") {
      equal(identity(value.candidate), identity(h.candidate));
      equal(value.effectiveAfter, h.effectiveBefore);
      equal(value.globalAfter, h.globalBefore);
      equal(value.foreignAfter, h.foreignBefore);
      check(value.refusal.actorUserId === h.authRefs.foreignUserId && value.refusal.tenantId === h.foreignBefore.tenantId);
      equal(value.refusal.before, value.refusal.after);
    } else {
      check(typeof evalBytes === "string" || Buffer.isBuffer(evalBytes));
      const e = parseArtifactBytes(evalBytes, privateNeedle);
      validateArtifact("eval", e, { privateNeedle, handoffBytes });
      check(value.evalResultSha256 === sha256(evalBytes));
      equal(value.eval, e.eval);
      for (const stage of [value.activation, value.rollback]) {
        equal(identity(stage.candidate), identity(h.candidate));
        equal(stage.global, h.globalBefore);
        equal(stage.foreign, h.foreignBefore);
        check(stage.candidate.ownerApproval.ownerUserId === h.authRefs.primaryUserId);
        check(stage.candidate.ownerApproval.evalRunId === e.eval.runId);
      }
      equal(value.activation.candidate.ownerApproval, value.rollback.candidate.ownerApproval);
      equal(value.activation.effective, { scope: "tenant", id: h.candidate.id, name: h.candidate.name, version: h.candidate.version, bodyHash: h.candidate.bodyHash, status: "active" });
      const { tenantId: _tenant, author: _author, rollbackEligible: _eligible, ...restored } = h.rollbackBaseline;
      equal(value.rollback.effective, { ...restored, status: "active" });
      check(value.rollback.baselineId === h.rollbackBaseline.id);
    }
  }
  return value;
}

export function writeImmutableArtifact(path, kind, value, context) {
  validateArtifact(kind, value, context);
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  return sha256(bytes);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [kind, path, flag, envName, ...extra] = process.argv.slice(2);
    check(extra.length === 0 && flag === "--forbid-env" && /^[A-Z][A-Z0-9_]+$/.test(envName ?? ""));
    const dir = dirname(resolve(path));
    validateArtifact(kind, parseArtifactBytes(readFileSync(path), process.env[envName]), {
      privateNeedle: process.env[envName],
      ...(kind !== "handoff" ? { handoffBytes: readFileSync(resolve(dir, "23-LIVE-HANDOFF.json")) } : {}),
      ...(kind === "live" ? { evalBytes: readFileSync(resolve(dir, "23-EVAL-RESULT.json")) } : {}),
    });
    process.stdout.write("Phase 23 artifact valid (offline schema and identity checks only).\n");
  } catch {
    // Neither rejected values, object keys, JSON parser messages nor credential paths escape.
    process.stderr.write("PHASE23_ARTIFACT_INVALID\n");
    process.exitCode = 1;
  }
}
