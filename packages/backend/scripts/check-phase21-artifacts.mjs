#!/usr/bin/env node
/**
 * check-phase21-artifacts — closed-schema validation for the Phase 21 live-gate artifacts.
 *
 * WHY THIS IS A FILE AND NOT A `node -e` ONE-LINER IN THE PLAN. The previous cut of 21-07 carried
 * its result validator as a ~4KB inline blob inside an XML-ish `<automated>` tag. Two consequences,
 * and the second one is what actually bit:
 *
 *   - It needed `&lt;` and `&amp;&amp;` entity escaping to sit inside the tag, so whoever ran it had
 *     to un-escape it by hand first — a paste-and-run produces a syntax error, not a verdict.
 *   - It had never been executed. Not once. It was the last block of a plan that always parked
 *     before reaching it, so nothing ever proved it could go green, let alone red for a real defect.
 *
 * A committed script gets a `--self-check`, which is the whole difference.
 *
 * Both artifacts are REFS-ONLY (CLAUDE.md §4): ids, hashes, counts. Never a body, prompt, fixture,
 * model output, message, email, secret or token. This validates that by walking every key and value.
 *
 * Usage:
 *   check-phase21-artifacts.mjs --handoff <h.json> --evidence <e.json>          # after Plan 21-07
 *   check-phase21-artifacts.mjs --handoff <h.json> --evidence <e.json> --result <r.json>   # 21-08
 *   check-phase21-artifacts.mjs --self-check
 *
 * Exit 0 = valid. Exit 1 = one or more violations, each printed with its path.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";

// `authorization` is legitimate on the EVIDENCE artifact (the owner's approval sentence, governance
// evidence) and forbidden on the RESULT artifact (there it could only mean an HTTP header).
const FORBIDDEN = [
  "body",
  "authoredbody",
  "prompt",
  "prompttext",
  "fixture",
  "modeloutput",
  "rawevidence",
  "evidencejson",
  "message",
  "messages",
  "content",
  "text",
  "email",
  "secret",
  "token",
  "providerresponse",
  "headers",
  "response",
  "output",
];
const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const NEEDLE = "PHASE21_PRIVATE_NEEDLE";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Every violation in one pass — a validator that stops at the first one hides the other five. */
class Check {
  constructor() {
    this.fails = [];
  }
  bad(path, msg) {
    this.fails.push(`${path}: ${msg}`);
    return false;
  }
  keys(obj, expected, path) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return this.bad(path, "expected an object");
    }
    const got = Object.keys(obj).sort();
    const want = [...expected].sort();
    const missing = want.filter((k) => !got.includes(k));
    const extra = got.filter((k) => !want.includes(k));
    for (const k of missing) this.bad(`${path}.${k}`, "MISSING required key");
    for (const k of extra) this.bad(`${path}.${k}`, "key is not in the closed schema");
    return missing.length === 0 && extra.length === 0;
  }
  eq(actual, expected, path, why = "") {
    if (actual !== expected) {
      return this.bad(
        path,
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${why && ` — ${why}`}`,
      );
    }
    return true;
  }
  str(v, path) {
    return typeof v === "string" && v ? true : this.bad(path, "expected a non-empty string");
  }
  iso(v, path) {
    return this.str(v, path) && Number.isFinite(Date.parse(v))
      ? true
      : this.bad(path, "expected an ISO timestamp");
  }
  int(v, path, min = 0) {
    return Number.isInteger(v) && v >= min ? true : this.bad(path, `expected an integer >= ${min}`);
  }
  /** Refs-only enforcement: forbidden key NAMES anywhere, plus needle/email-like VALUES anywhere. */
  refsOnly(node, path, forbidden) {
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (forbidden.includes(k.toLowerCase())) this.bad(`${path}.${k}`, "forbidden content key");
        this.refsOnly(v, `${path}.${k}`, forbidden);
      }
    } else if (typeof node === "string") {
      if (node.includes(NEEDLE)) this.bad(path, "private needle leaked into a refs-only artifact");
      if (EMAIL_LIKE.test(node)) this.bad(path, "email-like value in a refs-only artifact");
    }
  }
}

const REFS_KEYS = ["scope", "id", "name", "version", "bodyHash", "status"];

function checkRefs(c, o, path) {
  if (!c.keys(o, REFS_KEYS, path)) return;
  for (const k of ["scope", "id", "name", "bodyHash", "status"]) c.str(o[k], `${path}.${k}`);
  c.int(o.version, `${path}.version`, 1);
}

function checkForeign(c, o, path) {
  if (!c.keys(o, ["tenantId", "candidateIdVisible", "effective"], path)) return;
  c.str(o.tenantId, `${path}.tenantId`);
  c.eq(
    o.candidateIdVisible,
    false,
    `${path}.candidateIdVisible`,
    "a foreign tenant must never see the candidate",
  );
  checkRefs(c, o.effective, `${path}.effective`);
}

function checkRuntime(c, o, path) {
  if (
    !c.keys(
      o,
      [
        "queryArgs",
        "correlationId",
        "scope",
        "skillId",
        "skillName",
        "skillVersion",
        "skillBodyHash",
        "candidateAbsent",
      ],
      path,
    )
  )
    return;
  if (c.keys(o.queryArgs, ["tenantId", "correlationId"], `${path}.queryArgs`)) {
    c.str(o.queryArgs.tenantId, `${path}.queryArgs.tenantId`);
    c.eq(
      o.queryArgs.correlationId,
      o.correlationId,
      `${path}.queryArgs.correlationId`,
      "the recorded args must be the args that were queried",
    );
  }
  for (const k of ["correlationId", "scope", "skillId", "skillName", "skillBodyHash"])
    c.str(o[k], `${path}.${k}`);
  c.int(o.skillVersion, `${path}.skillVersion`, 1);
}

/**
 * The handoff is an INPUT, not a thing under test — but a malformed one must produce a verdict, not
 * a stack trace. (The self-check found this by feeding it `{"changed":1}`: every downstream
 * `h.candidate[k]` threw, and a validator that crashes reports nothing at all.)
 */
function handoffUsable(c, h) {
  const missing = [
    "deploymentUrlHash",
    "candidate",
    "rollbackBaseline",
    "globalBefore",
    "foreignBefore",
  ].filter((k) => h?.[k] === undefined);
  if (missing.length === 0) return true;
  c.bad(
    "handoff",
    `unusable — missing ${missing.join(", ")}. It is IMMUTABLE; if it changed, restore it.`,
  );
  return false;
}

export function checkEvidence(c, handoffBytes, evidence) {
  const h = JSON.parse(handoffBytes);
  const p = "evidence";
  if (!handoffUsable(c, h)) return;
  c.keys(
    evidence,
    [
      "schema",
      "handoffSha256",
      "deploymentHash",
      "recordedAt",
      "authorization",
      "attempts",
      "greenRun",
      "candidateAfter",
    ],
    p,
  );
  c.eq(evidence.schema, "phase21-eval-evidence.v1", `${p}.schema`);
  c.eq(
    evidence.handoffSha256,
    sha256(handoffBytes),
    `${p}.handoffSha256`,
    "THE HANDOFF IS IMMUTABLE — if this fails, it was rewritten",
  );
  c.eq(evidence.deploymentHash, h.deploymentUrlHash, `${p}.deploymentHash`);
  c.iso(evidence.recordedAt, `${p}.recordedAt`);

  if (Array.isArray(evidence.attempts) && evidence.attempts.length > 0) {
    evidence.attempts.forEach((a, i) => {
      const ap = `${p}.attempts[${i}]`;
      if (!c.keys(a, ["runId", "passed", "total", "costUsd", "failedFixtures"], ap)) return;
      c.str(a.runId, `${ap}.runId`);
      c.int(a.passed, `${ap}.passed`);
      c.int(a.total, `${ap}.total`, 1);
      if (typeof a.costUsd !== "number" || !(a.costUsd >= 0))
        c.bad(`${ap}.costUsd`, "expected a number >= 0");
      if (!Array.isArray(a.failedFixtures))
        c.bad(`${ap}.failedFixtures`, "expected an array (empty on a green run)");
    });
  } else {
    c.bad(
      `${p}.attempts`,
      "the ledger must record EVERY attempt, red ones included — that is the flake-rate evidence",
    );
  }

  const g = evidence.greenRun;
  if (
    c.keys(
      g,
      [
        "runId",
        "caseCount",
        "retryCount",
        "costUsd",
        "model",
        "candidate",
        "evidenceTarget",
        "gatePassed",
      ],
      `${p}.greenRun`,
    )
  ) {
    c.str(g.runId, `${p}.greenRun.runId`);
    c.str(g.model, `${p}.greenRun.model`);
    c.int(g.caseCount, `${p}.greenRun.caseCount`, 1);
    c.int(g.retryCount, `${p}.greenRun.retryCount`);
    c.eq(g.gatePassed, true, `${p}.greenRun.gatePassed`);
    for (const k of ["id", "tenantId", "name", "version", "bodyHash"]) {
      c.eq(
        g.candidate?.[k],
        h.candidate[k],
        `${p}.greenRun.candidate.${k}`,
        "identity drift from the freeze",
      );
    }
    if (
      c.keys(
        g.evidenceTarget,
        ["candidateId", "registryTenantId", "name", "version"],
        `${p}.greenRun.evidenceTarget`,
      )
    ) {
      c.eq(
        g.evidenceTarget.candidateId,
        h.candidate.id,
        `${p}.greenRun.evidenceTarget.candidateId`,
        "evidence must target the row it was measured on",
      );
      c.eq(
        g.evidenceTarget.registryTenantId,
        h.candidate.tenantId,
        `${p}.greenRun.evidenceTarget.registryTenantId`,
      );
    }
  }
  c.eq(
    evidence.candidateAfter?.status,
    "candidate",
    `${p}.candidateAfter.status`,
    "EVIDENCE IS NOT ACTIVATION",
  );
  c.eq(evidence.candidateAfter?.evidenceState, "passing", `${p}.candidateAfter.evidenceState`);

  // `authorization` is allowed here and only here.
  c.refsOnly(evidence, p, FORBIDDEN);
}

export function checkResult(c, handoffBytes, evidenceBytes, result) {
  const h = JSON.parse(handoffBytes);
  const p = "result";
  if (!handoffUsable(c, h)) return;
  c.keys(
    result,
    [
      "schema",
      "handoffSha256",
      "evalEvidenceSha256",
      "deploymentHash",
      "recordedAt",
      "nonOwner",
      "activation",
      "authorRuntime",
      "foreignRuntime",
      "rollback",
      "promptRun",
      "privacy",
      "ownerReviewedAt",
    ],
    p,
  );
  c.eq(result.schema, "phase21-live-result.v1", `${p}.schema`);
  c.eq(
    result.handoffSha256,
    sha256(handoffBytes),
    `${p}.handoffSha256`,
    "THE HANDOFF IS IMMUTABLE",
  );
  c.eq(
    result.evalEvidenceSha256,
    sha256(evidenceBytes),
    `${p}.evalEvidenceSha256`,
    "this result is not bound to the gate that was purchased",
  );
  c.eq(result.deploymentHash, h.deploymentUrlHash, `${p}.deploymentHash`);
  c.iso(result.recordedAt, `${p}.recordedAt`);
  c.iso(result.ownerReviewedAt, `${p}.ownerReviewedAt`);

  const n = result.nonOwner;
  if (
    c.keys(
      n,
      ["candidateId", "candidateBodyHash", "code", "stateUnchanged", "global", "foreign"],
      `${p}.nonOwner`,
    )
  ) {
    c.eq(n.candidateId, h.candidate.id, `${p}.nonOwner.candidateId`);
    c.eq(n.candidateBodyHash, h.candidate.bodyHash, `${p}.nonOwner.candidateBodyHash`);
    c.eq(n.code, "OWNER_REQUIRED", `${p}.nonOwner.code`, "the SERVER must refuse, not the UI");
    c.eq(n.stateUnchanged, true, `${p}.nonOwner.stateUnchanged`);
    checkRefs(c, n.global, `${p}.nonOwner.global`);
    checkForeign(c, n.foreign, `${p}.nonOwner.foreign`);
  }

  const a = result.activation;
  if (c.keys(a, ["candidate", "baseline", "global", "foreign"], `${p}.activation`)) {
    c.eq(a.candidate?.status, "active", `${p}.activation.candidate.status`);
    c.eq(a.candidate?.gatePassed, true, `${p}.activation.candidate.gatePassed`);
    c.eq(a.candidate?.evidenceState, "passing", `${p}.activation.candidate.evidenceState`);
    for (const k of ["id", "tenantId", "name", "version", "bodyHash"]) {
      c.eq(
        a.candidate?.[k],
        h.candidate[k],
        `${p}.activation.candidate.${k}`,
        "identity drift from the freeze",
      );
    }
    for (const k of ["id", "bodyHash", "version"]) {
      c.eq(a.baseline?.[k], h.rollbackBaseline[k], `${p}.activation.baseline.${k}`);
    }
    checkRefs(c, a.global, `${p}.activation.global`);
    checkForeign(c, a.foreign, `${p}.activation.foreign`);
  }

  checkRuntime(c, result.authorRuntime, `${p}.authorRuntime`);
  const ar = result.authorRuntime ?? {};
  c.eq(ar.queryArgs?.tenantId, h.candidate.tenantId, `${p}.authorRuntime.queryArgs.tenantId`);
  c.eq(ar.scope, "tenant", `${p}.authorRuntime.scope`);
  c.eq(ar.skillId, h.candidate.id, `${p}.authorRuntime.skillId`);
  c.eq(ar.skillName, h.candidate.name, `${p}.authorRuntime.skillName`);
  c.eq(ar.skillVersion, h.candidate.version, `${p}.authorRuntime.skillVersion`);
  c.eq(ar.skillBodyHash, h.candidate.bodyHash, `${p}.authorRuntime.skillBodyHash`);
  c.eq(ar.candidateAbsent, false, `${p}.authorRuntime.candidateAbsent`);

  // The B witness rule: NON-NULL, same name, different id AND different hash. A null record proves
  // nothing about isolation — it is equally consistent with the query being broken.
  checkRuntime(c, result.foreignRuntime, `${p}.foreignRuntime`);
  const fr = result.foreignRuntime ?? {};
  c.eq(fr.queryArgs?.tenantId, h.foreignBefore.tenantId, `${p}.foreignRuntime.queryArgs.tenantId`);
  c.eq(
    fr.skillName,
    h.candidate.name,
    `${p}.foreignRuntime.skillName`,
    "B must witness the SAME specialist name",
  );
  c.eq(fr.candidateAbsent, true, `${p}.foreignRuntime.candidateAbsent`);
  if (!["global", "tenant"].includes(fr.scope))
    c.bad(`${p}.foreignRuntime.scope`, "expected global or tenant");
  if (fr.skillId === h.candidate.id)
    c.bad(`${p}.foreignRuntime.skillId`, "B RESOLVED A'S CANDIDATE — tenant isolation failure");
  if (fr.skillBodyHash === h.candidate.bodyHash)
    c.bad(
      `${p}.foreignRuntime.skillBodyHash`,
      "B ran A's candidate BODY — tenant isolation failure",
    );

  const r = result.rollback;
  if (
    c.keys(
      r,
      ["targetId", "candidate", "currentEffective", "global", "foreign", "requiredEval"],
      `${p}.rollback`,
    )
  ) {
    c.eq(
      r.targetId,
      h.rollbackBaseline.id,
      `${p}.rollback.targetId`,
      "rollback must target the EXACT frozen baseline",
    );
    c.eq(
      r.requiredEval,
      false,
      `${p}.rollback.requiredEval`,
      "rollback's eval-exemption is Success Criterion 2 and must be OBSERVED",
    );
    c.eq(r.candidate?.status, "archived", `${p}.rollback.candidate.status`);
    c.eq(r.candidate?.rollbackEligible, true, `${p}.rollback.candidate.rollbackEligible`);
    c.eq(
      r.candidate?.evidenceState,
      "passing",
      `${p}.rollback.candidate.evidenceState`,
      "rollback must PRESERVE the purchased evidence",
    );
    c.eq(r.candidate?.bodyHash, h.candidate.bodyHash, `${p}.rollback.candidate.bodyHash`);
    checkRefs(c, r.currentEffective, `${p}.rollback.currentEffective`);
    for (const [k, want] of [
      ["scope", "tenant"],
      ["id", h.rollbackBaseline.id],
      ["name", h.rollbackBaseline.name],
      ["version", h.rollbackBaseline.version],
      ["bodyHash", h.rollbackBaseline.bodyHash],
      ["status", "active"],
    ]) {
      c.eq(
        r.currentEffective?.[k],
        want,
        `${p}.rollback.currentEffective.${k}`,
        "the restored row is not the frozen baseline",
      );
    }
    checkRefs(c, r.global, `${p}.rollback.global`);
    checkForeign(c, r.foreign, `${p}.rollback.foreign`);
  }

  const pr = result.promptRun;
  if (
    c.keys(
      pr,
      [
        "pinnedPromptId",
        "sourceThreadId",
        "runThreadId",
        "pinRemoved",
        "sourceThreadExists",
        "runThreadExists",
      ],
      `${p}.promptRun`,
    )
  ) {
    for (const k of ["pinnedPromptId", "sourceThreadId", "runThreadId"])
      c.str(pr[k], `${p}.promptRun.${k}`);
    if (pr.sourceThreadId === pr.runThreadId)
      c.bad(`${p}.promptRun.runThreadId`, "a re-run must land in a FRESH thread");
    for (const k of ["pinRemoved", "sourceThreadExists", "runThreadExists"])
      c.eq(pr[k], true, `${p}.promptRun.${k}`);
  }

  const pv = result.privacy;
  const counts = [
    "auditNeedleCount",
    "evidenceNeedleCount",
    "logNeedleCount",
    "dlqNeedleCount",
    "telemetryNeedleCount",
  ];
  if (c.keys(pv, ["passed", ...counts], `${p}.privacy`)) {
    c.eq(pv.passed, true, `${p}.privacy.passed`);
    for (const k of counts)
      c.eq(pv[k], 0, `${p}.privacy.${k}`, "CLAUDE.md §4 — refs, hashes and counts only");
  }

  c.refsOnly(result, p, [...FORBIDDEN, "authorization"]);
}

// ── self-check ───────────────────────────────────────────────────────────────
// Builds a MINIMAL valid trio, proves it passes, then mutates one field at a time and proves each
// mutation is caught. A validator nobody has watched go red is not a validator.

export function fixtures() {
  const handoff = {
    deploymentUrlHash: "b8c0",
    candidate: {
      id: "candA",
      tenantId: "tenA",
      name: "offer-architect",
      version: 12,
      bodyHash: "hashA",
    },
    rollbackBaseline: { id: "baseA", name: "offer-architect", version: 1, bodyHash: "hashBase" },
    foreignBefore: {
      tenantId: "tenB",
      candidateIdVisible: false,
      effective: {
        scope: "global",
        id: "g1",
        name: "offer-architect",
        version: 4,
        bodyHash: "hashG",
        status: "active",
      },
    },
    globalBefore: {
      scope: "global",
      id: "g1",
      name: "offer-architect",
      version: 4,
      bodyHash: "hashG",
      status: "active",
    },
  };
  const hb = Buffer.from(JSON.stringify(handoff));
  const evidence = {
    schema: "phase21-eval-evidence.v1",
    handoffSha256: sha256(hb),
    deploymentHash: "b8c0",
    recordedAt: "2026-08-18T00:00:00.000Z",
    authorization: { ownerWords: "go ahead", attemptBudget: 1, ceilingUsd: 2 },
    attempts: [
      { runId: "r1", passed: 0, total: 41, costUsd: 0, failedFixtures: ["28-healthy-no-gaps"] },
      { runId: "r2", passed: 41, total: 41, costUsd: 0.51, failedFixtures: [] },
    ],
    greenRun: {
      runId: "r2",
      caseCount: 41,
      retryCount: 1,
      costUsd: 0.51,
      model: "a-model",
      candidate: {
        id: "candA",
        tenantId: "tenA",
        name: "offer-architect",
        version: 12,
        bodyHash: "hashA",
      },
      evidenceTarget: {
        candidateId: "candA",
        registryTenantId: "tenA",
        name: "offer-architect",
        version: 12,
      },
      gatePassed: true,
    },
    candidateAfter: { status: "candidate", evidenceState: "passing" },
  };
  const eb = Buffer.from(JSON.stringify(evidence));
  const refsG = {
    scope: "global",
    id: "g1",
    name: "offer-architect",
    version: 4,
    bodyHash: "hashG",
    status: "active",
  };
  const foreign = { tenantId: "tenB", candidateIdVisible: false, effective: refsG };
  const result = {
    schema: "phase21-live-result.v1",
    handoffSha256: sha256(hb),
    evalEvidenceSha256: sha256(eb),
    deploymentHash: "b8c0",
    recordedAt: "2026-08-18T01:00:00.000Z",
    ownerReviewedAt: "2026-08-18T01:30:00.000Z",
    nonOwner: {
      candidateId: "candA",
      candidateBodyHash: "hashA",
      code: "OWNER_REQUIRED",
      stateUnchanged: true,
      global: refsG,
      foreign,
    },
    activation: {
      candidate: {
        id: "candA",
        tenantId: "tenA",
        name: "offer-architect",
        version: 12,
        bodyHash: "hashA",
        status: "active",
        gatePassed: true,
        evidenceState: "passing",
      },
      baseline: { id: "baseA", version: 1, bodyHash: "hashBase" },
      global: refsG,
      foreign,
    },
    authorRuntime: {
      queryArgs: { tenantId: "tenA", correlationId: "corrA" },
      correlationId: "corrA",
      scope: "tenant",
      skillId: "candA",
      skillName: "offer-architect",
      skillVersion: 12,
      skillBodyHash: "hashA",
      candidateAbsent: false,
    },
    foreignRuntime: {
      queryArgs: { tenantId: "tenB", correlationId: "corrB" },
      correlationId: "corrB",
      scope: "global",
      skillId: "g1",
      skillName: "offer-architect",
      skillVersion: 4,
      skillBodyHash: "hashG",
      candidateAbsent: true,
    },
    rollback: {
      targetId: "baseA",
      candidate: {
        status: "archived",
        rollbackEligible: true,
        evidenceState: "passing",
        bodyHash: "hashA",
      },
      currentEffective: {
        scope: "tenant",
        id: "baseA",
        name: "offer-architect",
        version: 1,
        bodyHash: "hashBase",
        status: "active",
      },
      global: refsG,
      foreign,
      requiredEval: false,
    },
    promptRun: {
      pinnedPromptId: "pin1",
      sourceThreadId: "t1",
      runThreadId: "t2",
      pinRemoved: true,
      sourceThreadExists: true,
      runThreadExists: true,
    },
    privacy: {
      passed: true,
      auditNeedleCount: 0,
      evidenceNeedleCount: 0,
      logNeedleCount: 0,
      dlqNeedleCount: 0,
      telemetryNeedleCount: 0,
    },
  };
  return { hb, eb, evidence, result };
}

function selfCheck() {
  const { hb, eb, evidence, result } = fixtures();
  const run = (fn) => {
    const c = new Check();
    fn(c);
    return c.fails;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const okE = run((c) => checkEvidence(c, hb, evidence));
  if (okE.length) throw new Error(`the valid evidence fixture must PASS:\n  ${okE.join("\n  ")}`);
  const okR = run((c) => checkResult(c, hb, eb, result));
  if (okR.length) throw new Error(`the valid result fixture must PASS:\n  ${okR.join("\n  ")}`);

  // A rewritten handoff must be REPORTED, not thrown on — the self-check's own first finding.
  if (run((c) => checkEvidence(c, Buffer.from('{"changed":1}'), evidence)).length === 0) {
    throw new Error("mutation NOT caught: a rewritten handoff");
  }

  // Each mutation names the real defect it stands for.
  const mutations = [
    [
      "evidence recorded as ACTIVE (evidence is not activation)",
      () => {
        const e = clone(evidence);
        e.candidateAfter.status = "active";
        return e;
      },
      "evidence",
    ],
    [
      "an empty attempt ledger (the flake rate would be lost)",
      () => {
        const e = clone(evidence);
        e.attempts = [];
        return e;
      },
      "evidence",
    ],
    [
      "greenRun identity drift from the freeze",
      () => {
        const e = clone(evidence);
        e.greenRun.candidate.bodyHash = "other";
        return e;
      },
      "evidence",
    ],
    [
      "a leaked body key",
      () => {
        const e = clone(evidence);
        e.greenRun.body = "x";
        return e;
      },
      "evidence",
    ],
    [
      "B witnessing A's candidate id (isolation failure)",
      () => {
        const r = clone(result);
        r.foreignRuntime.skillId = "candA";
        return r;
      },
      "result",
    ],
    [
      "B witnessing A's body hash (isolation failure)",
      () => {
        const r = clone(result);
        r.foreignRuntime.skillBodyHash = "hashA";
        return r;
      },
      "result",
    ],
    [
      "rollback to the wrong row",
      () => {
        const r = clone(result);
        r.rollback.targetId = "somethingElse";
        return r;
      },
      "result",
    ],
    [
      "rollback that claims it needed an eval",
      () => {
        const r = clone(result);
        r.rollback.requiredEval = true;
        return r;
      },
      "result",
    ],
    [
      "rollback that lost the purchased evidence",
      () => {
        const r = clone(result);
        r.rollback.candidate.evidenceState = "absent";
        return r;
      },
      "result",
    ],
    [
      "a non-zero privacy needle count",
      () => {
        const r = clone(result);
        r.privacy.auditNeedleCount = 1;
        return r;
      },
      "result",
    ],
    [
      "a re-run landing in the SAME thread",
      () => {
        const r = clone(result);
        r.promptRun.runThreadId = "t1";
        return r;
      },
      "result",
    ],
    [
      "an email address in a refs-only artifact",
      () => {
        const r = clone(result);
        r.promptRun.pinnedPromptId = "who@example.com";
        return r;
      },
      "result",
    ],
    [
      "a result unbound from the purchased evidence",
      () => {
        const r = clone(result);
        r.evalEvidenceSha256 = "0".repeat(64);
        return r;
      },
      "result",
    ],
    [
      "an extra root key outside the closed schema",
      () => {
        const r = clone(result);
        r.extra = 1;
        return r;
      },
      "result",
    ],
    [
      "a foreign tenant that CAN see the candidate",
      () => {
        const r = clone(result);
        r.activation.foreign.candidateIdVisible = true;
        return r;
      },
      "result",
    ],
  ];

  let red = 1; // the handoff-rewrite case above
  for (const [name, make, kind] of mutations) {
    const fails =
      kind === "evidence"
        ? run((c) => checkEvidence(c, hb, make()))
        : run((c) => checkResult(c, hb, eb, make()));
    if (fails.length === 0) throw new Error(`mutation NOT caught: ${name}`);
    red++;
  }
  console.log(
    `[check-phase21-artifacts] self-check PASSED — 2 valid fixtures green, ${red} mutations red`,
  );
}

function main(argv) {
  if (argv.includes("--self-check")) return selfCheck();
  const arg = (f) => {
    const i = argv.indexOf(f);
    return i === -1 ? undefined : argv[i + 1];
  };
  const handoffPath = arg("--handoff");
  const evidencePath = arg("--evidence");
  const resultPath = arg("--result");
  if (!handoffPath || !evidencePath) {
    console.error(
      "usage: check-phase21-artifacts.mjs --handoff <h.json> --evidence <e.json> [--result <r.json>]",
    );
    process.exit(2);
  }
  const hb = readFileSync(handoffPath);
  const eb = readFileSync(evidencePath);
  const c = new Check();
  checkEvidence(c, hb, JSON.parse(eb.toString("utf8")));
  if (resultPath) checkResult(c, hb, eb, JSON.parse(readFileSync(resultPath, "utf8")));

  if (c.fails.length === 0) {
    console.log(
      `[check-phase21-artifacts] OK — evidence${resultPath ? " + result" : ""} valid, refs-only, bound to the freeze`,
    );
    process.exit(0);
  }
  for (const f of c.fails) console.error(`[check-phase21-artifacts] ${f}`);
  console.error(`[check-phase21-artifacts] ${c.fails.length} violation(s)`);
  process.exit(1);
}

// Only run as a CLI. This file also EXPORTS its checks, and an unguarded main() meant importing it
// parsed the importer's argv and called process.exit — which is how the CLI test below found this.
if (import.meta.url === pathToFileURL(argv[1] ?? "").href) main(argv.slice(2));
