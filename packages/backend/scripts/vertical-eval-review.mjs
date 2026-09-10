// Offline review packets. Source bytes and artifacts are content-plane inputs, never telemetry.
import { createHash } from "node:crypto";
import { profileDataset } from "@pikar/core/dataProfile";
import { readDataWorkbook } from "@pikar/vault/dataWorkbook";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const isId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const criteria = {
  data: ["data_numeric_fidelity"],
  product: ["requirements_and_prioritization"],
  design: ["visual_claim_scope", "accessibility_test_limits"],
  legal: ["qualified_legal_judgment"],
  hr: ["employment_decision_boundary", "qualified_hr_judgment"],
  engineering: ["observed_vs_proposed_actions"],
};
const commonCriteria = [
  "source_support",
  "coverage_and_uncertainty",
  "review_boundary",
  "refusal_and_authority",
  "artifact_completeness",
];
function check(condition, code) {
  if (!condition) throw new Error(`VERTICAL_REVIEW_${code}`);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
/** The exact UTF-8 representation used by profile quote offsets and profileSha256. */
export function referenceProfileText(profile) {
  return `${JSON.stringify(canonical(profile), null, 2)}\n`;
}
function asBytes(value) {
  check(value instanceof Uint8Array || value instanceof ArrayBuffer, "SOURCE_BYTES");
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** No fixture expectations enter this API. qualification must be the native observation qualifier's
 * result; original source bytes must be archived/recompiled and hash-identical to that observation.
 * @param {{qualification: any, reply: string, sourceSnapshots: Array<{docId: string, mimeType: string, bytes: Uint8Array | ArrayBuffer}>}} input
 */
export function buildVerticalReviewPacket({ qualification, reply, sourceSnapshots }) {
  const q = qualification;
  check(
    q &&
      q.schemaVersion === 1 &&
      q.sourceMode === "fixed-owned-fixtures" &&
      Object.hasOwn(criteria, q.verticalId) &&
      q.semanticReviewRequired === true &&
      q.releasePassed === false &&
      ["model", "scripted"].includes(q.execution) &&
      ["useful", "partial", "blocked"].includes(q.mechanicalOutcome) &&
      q.modelEvaluated === (q.execution === "model" && q.mechanicalOutcome !== "blocked"),
    "QUALIFICATION",
  );
  check(
    isId(q.candidateId) &&
      isId(q.planId) &&
      isHash(q.caseHash) &&
      isHash(q.bodyHash) &&
      isHash(q.requestHash) &&
      Number.isSafeInteger(q.candidateVersion) &&
      q.candidateVersion > 0 &&
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(q.caseId) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(q.runId),
    "BINDING",
  );
  check(
    q.tenantId === `packeval-${q.runId.slice(0, 8)}-${q.caseId}` &&
      q.threadId === `verticaleval:${q.runId}:${q.caseId}`,
    "BINDING",
  );
  check(
    typeof reply === "string" && encoder.encode(reply).byteLength <= 256 * 1024,
    "OUTPUT_LIMIT",
  );
  const outputBytes = encoder.encode(reply);
  if (q.mechanicalOutcome === "blocked")
    check(reply === "" && q.replySha256 === undefined, "OUTPUT_HASH");
  else check(isHash(q.replySha256) && hash(outputBytes) === q.replySha256, "OUTPUT_HASH");
  check(
    Array.isArray(q.sourceReads) &&
      q.sourceReads.length <= 5 &&
      Array.isArray(sourceSnapshots) &&
      sourceSnapshots.length <= 5,
    "SOURCES",
  );
  const expected = new Map();
  for (const source of q.sourceReads) {
    check(isId(source.docId) && isHash(source.chunkHash) && !expected.has(source.docId), "SOURCES");
    expected.set(source.docId, source.chunkHash);
  }
  for (const [field, lane] of [
    ["dataSource", "data"],
    ["visualSource", "design"],
  ]) {
    const source = q[field];
    if (!source) continue;
    check(
      q.verticalId === lane &&
        isId(source.docId) &&
        isHash(source.sha256) &&
        (!expected.has(source.docId) || expected.get(source.docId) === source.sha256),
      "SOURCES",
    );
    expected.set(source.docId, source.sha256);
  }
  const sources = [];
  const seen = new Set();
  let totalBytes = 0;
  let referenceProfile;
  for (const snapshot of sourceSnapshots) {
    const bytes = asBytes(snapshot.bytes);
    totalBytes += bytes.byteLength;
    check(
      bytes.byteLength > 0 && bytes.byteLength <= 1024 * 1024 && totalBytes <= 2 * 1024 * 1024,
      "SOURCE_LIMIT",
    );
    check(
      expected.has(snapshot.docId) &&
        !seen.has(snapshot.docId) &&
        hash(bytes) === expected.get(snapshot.docId),
      "SOURCE_HASH",
    );
    seen.add(snapshot.docId);
    check(
      [
        "text/plain",
        "text/csv",
        "application/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "image/png",
        "image/jpeg",
      ].includes(snapshot.mimeType),
      "SOURCE_FORMAT",
    );
    if (q.sourceReads.some((source) => source.docId === snapshot.docId)) {
      check(snapshot.mimeType === "text/plain", "SOURCE_FORMAT");
      decoder.decode(bytes);
    }
    if (q.visualSource?.docId === snapshot.docId)
      check(["image/png", "image/jpeg"].includes(snapshot.mimeType), "SOURCE_FORMAT");
    if (q.dataSource?.docId === snapshot.docId) {
      const format = ["text/csv", "application/csv"].includes(snapshot.mimeType)
        ? "csv"
        : snapshot.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          ? "xlsx"
          : undefined;
      check(format !== undefined, "SOURCE_FORMAT");
      // The binding's deterministic profile uses hasHeader=false. Never infer it from expected rows.
      const workbook = readDataWorkbook(bytes, format, false);
      referenceProfile = profileDataset({
        source: {
          fileId: snapshot.docId,
          contentHash: hash(bytes),
          byteLength: bytes.byteLength,
          format,
        },
        ...workbook,
      });
    }
    sources.push({
      docId: snapshot.docId,
      sha256: hash(bytes),
      mimeType: snapshot.mimeType,
      byteLength: bytes.byteLength,
    });
  }
  check(seen.size === expected.size, "SOURCE_MISSING");
  sources.sort((a, b) => a.docId.localeCompare(b.docId));
  const packetBase = {
    schemaVersion: 1,
    binding: {
      verticalId: q.verticalId,
      runId: q.runId,
      caseId: q.caseId,
      caseHash: q.caseHash,
      requestHash: q.requestHash,
      bodyHash: q.bodyHash,
      candidateId: q.candidateId,
      candidateVersion: q.candidateVersion,
      tenantId: q.tenantId,
      threadId: q.threadId,
      planId: q.planId,
    },
    execution: q.execution,
    mechanicalOutcome: q.mechanicalOutcome,
    output: { sha256: hash(outputBytes), byteLength: outputBytes.byteLength },
    sources,
    criteria: [...commonCriteria, ...criteria[q.verticalId]].map((criterion) => ({
      criterion,
      status: "unresolved",
    })),
    ...(referenceProfile
      ? {
          dataReference: {
            sha256: hash(referenceProfileText(referenceProfile)),
            byteLength: encoder.encode(referenceProfileText(referenceProfile)).byteLength,
            rowCount: referenceProfile.rowCount,
            sheetCount: referenceProfile.sheets.length,
            warningCount: referenceProfile.warnings.length,
            truncated: referenceProfile.truncated,
          },
        }
      : {}),
    observationAuthenticity: "local-unverified",
    semanticsAssessed: false,
    semanticReviewRequired: true,
    releasePassed: false,
  };
  return {
    packet: { ...packetBase, packetSha256: hash(JSON.stringify(canonical(packetBase))) },
    ...(referenceProfile ? { referenceProfile } : {}),
  };
}

/** Verify reviewer-authored evidence locations, never infer a judgment from words or a model vote.
 * Claimed reviewer identity/qualification is not authenticated by this offline file validator.
 * @param {{qualification: any, reply: string, sourceSnapshots: Array<{docId: string, mimeType: string, bytes: Uint8Array | ArrayBuffer}>, record: any}} input
 */
export function validateVerticalReviewRecord({ qualification, reply, sourceSnapshots, record }) {
  const { packet, referenceProfile } = buildVerticalReviewPacket({
    qualification,
    reply,
    sourceSnapshots,
  });
  check(
    record &&
      record.schemaVersion === 1 &&
      record.packetSha256 === packet.packetSha256 &&
      isHash(record.reviewerRef) &&
      ["owner", "human_reviewer", "qualified_counsel", "qualified_hr"].includes(record.claimedRole),
    "RECORD_BINDING",
  );
  check(
    Array.isArray(record.decisions) && record.decisions.length <= packet.criteria.length,
    "DECISIONS",
  );
  const outputBytes = encoder.encode(reply);
  const profileBytes = referenceProfile
    ? encoder.encode(referenceProfileText(referenceProfile))
    : undefined;
  const snapshotMap = new Map(sourceSnapshots.map((source) => [source.docId, source]));
  const decisionIds = new Set();
  const decisions = [];
  for (const decision of record.decisions) {
    check(
      packet.criteria.some((item) => item.criterion === decision.criterion) &&
        !decisionIds.has(decision.criterion) &&
        ["supported", "contradicted", "needs_review"].includes(decision.decision) &&
        Array.isArray(decision.evidence) &&
        decision.evidence.length <= 20,
      "DECISION",
    );
    decisionIds.add(decision.criterion);
    const evidence = [];
    for (const span of decision.evidence) {
      check(
        ["output", "source", "profile"].includes(span.target) &&
          Number.isSafeInteger(span.startByte) &&
          Number.isSafeInteger(span.endByte) &&
          span.startByte >= 0 &&
          span.endByte > span.startByte &&
          isHash(span.sha256),
        "SPAN",
      );
      const snapshot = span.target === "source" ? snapshotMap.get(span.docId) : undefined;
      if (span.target !== "source") check(span.docId === undefined, "SPAN");
      const bytes =
        span.target === "output"
          ? outputBytes
          : span.target === "profile"
            ? profileBytes
            : snapshot
              ? asBytes(snapshot.bytes)
              : undefined;
      check(
        bytes !== undefined &&
          span.endByte <= bytes.byteLength &&
          hash(bytes.subarray(span.startByte, span.endByte)) === span.sha256,
        "SPAN_HASH",
      );
      if (span.target !== "source" || snapshot?.mimeType === "text/plain")
        decoder.decode(bytes.subarray(span.startByte, span.endByte));
      evidence.push({
        target: span.target,
        ...(snapshot ? { docId: span.docId } : {}),
        startByte: span.startByte,
        endByte: span.endByte,
        sha256: span.sha256,
      });
    }
    if (decision.decision !== "needs_review") {
      check(
        evidence.some((span) => span.target === "output"),
        "OUTPUT_EVIDENCE_REQUIRED",
      );
      if (decision.criterion === "source_support" || decision.criterion === "data_numeric_fidelity")
        check(
          evidence.some((span) => span.target === "source" || span.target === "profile"),
          "SOURCE_EVIDENCE_REQUIRED",
        );
    }
    if (decision.decision === "supported" && decision.criterion === "qualified_legal_judgment")
      check(record.claimedRole === "qualified_counsel", "REVIEWER_ROLE");
    if (decision.decision === "supported" && decision.criterion === "qualified_hr_judgment")
      check(record.claimedRole === "qualified_hr", "REVIEWER_ROLE");
    decisions.push({ criterion: decision.criterion, decision: decision.decision, evidence });
  }
  return {
    schemaVersion: 1,
    packetSha256: packet.packetSha256,
    binding: packet.binding,
    reviewerRef: record.reviewerRef,
    claimedRole: record.claimedRole,
    reviewerIdentityVerified: false,
    decisions,
    unresolvedCriteria: packet.criteria
      .filter(
        (item) =>
          !decisions.some(
            (decision) =>
              decision.criterion === item.criterion && decision.decision !== "needs_review",
          ),
      )
      .map((item) => item.criterion),
    contradictedCount: decisions.filter((decision) => decision.decision === "contradicted").length,
    evidenceBindingsValid: true,
    observationAuthenticity: "local-unverified",
    semanticsAssessed: false,
    semanticReviewRequired: true,
    releasePassed: false,
  };
}
