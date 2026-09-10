// Mechanical observations only. This module never scores meaning or records release evidence.
import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const lanes = ["data", "product", "design", "legal", "hr", "engineering"];
const tools = ["searchVault", "saveAsDocument"];
const models = ["or/openai/gpt-5.6-luna", "or/openai/gpt-4.1-mini"];
const blockedReasons = [
  "not-found",
  "missing-source",
  "budget-paused",
  "disabled",
  "not-released",
  "unconfirmed-profile",
  "no-confirmed-need",
  "insufficient-repeat-use",
  "review-required",
  "playbook-required",
  "validator-unavailable",
  "connector-not-approved",
];
function requireFact(condition, code) {
  if (!condition) throw new Error(`VERTICAL_OBSERVATION_${code}`);
}
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
const money = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const equalMoney = (a, b) => Math.abs(a - b) <= 1e-9;

function budgetFacts(budget, budgetId) {
  requireFact(budget && budget.budgetId === budgetId, "BUDGET_ID");
  requireFact(
    Number.isSafeInteger(budget.capCents) && budget.capCents > 0 && budget.capCents <= 1000,
    "BUDGET_CAP",
  );
  requireFact(typeof budget.expired === "boolean" && budget.breached === false, "BUDGET_BREACHED");
  requireFact(
    money(budget.actualUsd) &&
      count(budget.remainingCents) &&
      budget.remainingCents <= budget.capCents &&
      budget.actualUsd * 100 <= budget.capCents + 1e-7,
    "BUDGET_COST",
  );
  requireFact(
    count(budget.callCount) &&
      count(budget.settledCount) &&
      budget.callCount === budget.settledCount &&
      budget.unsettledCount === 0 &&
      budget.unresolvedCents === 0,
    "BUDGET_UNSETTLED",
  );
  return {
    budgetId,
    capCents: budget.capCents,
    actualUsd: budget.actualUsd,
    callCount: budget.callCount,
    settledCount: budget.settledCount,
    remainingCents: budget.remainingCents,
    expired: budget.expired,
    breached: false,
    unsettledCount: 0,
    unresolvedCents: 0,
  };
}

/** provision must come from native preflight+provision/verify readbacks, never fixture expectations.
 * budgetBefore is the collector's serial read immediately before this case. Concurrent use of the
 * same budget fails attribution rather than being silently assigned to this case.
 * @param {{pin: unknown, provision: unknown, observation: unknown, execution?: string, budgetBefore?: unknown}} input
 */
export function qualifyVerticalObservation({
  pin,
  provision,
  observation,
  execution = "model",
  budgetBefore = undefined,
}) {
  requireFact(
    pin &&
      lanes.includes(pin.verticalId) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pin.runId) &&
      /^[a-z0-9][a-z0-9-]{0,63}$/.test(pin.caseId),
    "PIN",
  );
  requireFact(
    digest(pin.caseHash) &&
      digest(pin.requestHash) &&
      digest(pin.bodyHash) &&
      Number.isSafeInteger(pin.candidateVersion) &&
      pin.candidateVersion > 0 &&
      id(pin.budgetId),
    "PIN",
  );
  requireFact(execution === "model" || execution === "scripted", "EXECUTION");
  const tenantId = `packeval-${pin.runId.slice(0, 8)}-${pin.caseId}`;
  const threadId = `verticaleval:${pin.runId}:${pin.caseId}`;
  requireFact(
    provision &&
      provision.tenantId === tenantId &&
      provision.threadId === threadId &&
      id(provision.planId) &&
      id(provision.candidateId),
    "PROVISION",
  );
  requireFact(
    Array.isArray(provision.sourceRefs) && provision.sourceRefs.length <= 5,
    "SOURCE_MANIFEST",
  );
  const sourceMap = new Map();
  const sourceNames = new Set();
  for (const source of provision.sourceRefs) {
    requireFact(
      id(source.docId) &&
        digest(source.hash) &&
        new RegExp(`^fixture:${pin.verticalId}:[a-z0-9-]{1,64}$`).test(source.ref) &&
        !sourceMap.has(source.docId) &&
        !sourceNames.has(source.ref),
      "SOURCE_MANIFEST",
    );
    sourceMap.set(source.docId, source.hash);
    sourceNames.add(source.ref);
  }
  requireFact(
    observation &&
      observation.caseHash === pin.caseHash &&
      observation.inputSha256 === pin.requestHash &&
      observation.sourceMode === "fixed-owned-fixtures" &&
      observation.releaseEvidenceRecorded === false,
    "CASE_BINDING",
  );
  const binding = observation.caseBinding;
  requireFact(
    binding &&
      binding.tenantId === tenantId &&
      binding.threadId === threadId &&
      binding.planId === provision.planId &&
      binding.candidateId === provision.candidateId &&
      binding.candidateVersion === pin.candidateVersion &&
      binding.bodyHash === pin.bodyHash &&
      binding.requestHash === pin.requestHash,
    "CASE_BINDING",
  );
  const budget = budgetFacts(observation.budget, pin.budgetId);
  const before = budgetBefore === undefined ? undefined : budgetFacts(budgetBefore, pin.budgetId);
  if (before)
    requireFact(
      before.capCents === budget.capCents &&
        before.callCount <= budget.callCount &&
        before.actualUsd <= budget.actualUsd + 1e-9,
      "BUDGET_BASELINE",
    );
  requireFact(
    Array.isArray(observation.sourceReads) && observation.sourceReads.length <= 5,
    "SOURCE_READS",
  );
  const readIds = new Set();
  const sourceReads = observation.sourceReads.map((source) => {
    requireFact(
      sourceMap.get(source.docId) === source.chunkHash &&
        digest(source.chunkHash) &&
        !readIds.has(source.docId),
      "SOURCE_READS",
    );
    readIds.add(source.docId);
    return { docId: source.docId, chunkHash: source.chunkHash };
  });
  const base = {
    schemaVersion: 1,
    verticalId: pin.verticalId,
    runId: pin.runId,
    caseId: pin.caseId,
    caseHash: pin.caseHash,
    requestHash: pin.requestHash,
    bodyHash: pin.bodyHash,
    candidateVersion: pin.candidateVersion,
    candidateId: provision.candidateId,
    tenantId,
    threadId,
    planId: provision.planId,
    execution,
    sourceMode: "fixed-owned-fixtures",
    sourceReads,
    budget,
    semanticReviewRequired: true,
    releasePassed: false,
  };
  const result = observation.result;
  requireFact(result && typeof result.ok === "boolean", "RESULT");
  if (!result.ok) {
    requireFact(
      blockedReasons.includes(result.reason) &&
        result.facts === undefined &&
        result.artifactId === undefined &&
        result.reply === undefined &&
        sourceReads.length === 0,
      "BLOCKED_RESULT",
    );
    if (before)
      requireFact(
        before.callCount === budget.callCount && equalMoney(before.actualUsd, budget.actualUsd),
        "BLOCKED_COST",
      );
    return {
      ...base,
      mechanicalOutcome: "blocked",
      blockedReason: result.reason,
      modelEvaluated: false,
    };
  }
  const facts = result.facts;
  requireFact(facts && facts.schemaVersion === 1 && facts.execution === execution, "EXECUTION");
  requireFact(
    result.version === pin.candidateVersion &&
      facts.candidateVersion === pin.candidateVersion &&
      facts.candidateId === provision.candidateId &&
      facts.candidateBodySha256 === pin.bodyHash &&
      facts.planId === provision.planId &&
      facts.runHash === hash(pin.runId) &&
      facts.inputSha256 === pin.requestHash,
    "FACT_BINDING",
  );
  requireFact(
    facts.configuredModelId === models[0] &&
      facts.configuredFallbackModelId === models[1] &&
      models.includes(facts.actualModelId),
    "MODEL",
  );
  requireFact(
    money(facts.modelCostUsd) &&
      facts.costScope === "reserved_fixed_source_model_calls" &&
      typeof facts.truncated === "boolean" &&
      ["useful", "partial"].includes(result.outcome),
    "MODEL_FACTS",
  );
  if (execution === "model") {
    requireFact(
      before !== undefined &&
        budget.callCount > before.callCount &&
        equalMoney(budget.actualUsd - before.actualUsd, facts.modelCostUsd),
      "MODEL_COST",
    );
  } else {
    requireFact(
      facts.modelCostUsd === 0 &&
        (!before ||
          (budget.callCount === before.callCount &&
            equalMoney(budget.actualUsd, before.actualUsd))),
      "SCRIPTED_COST",
    );
  }
  for (const field of ["attemptedAllowedTools", "completedAllowedTools"]) {
    requireFact(
      facts[field] &&
        Object.keys(facts[field]).sort().join(",") === [...tools].sort().join(",") &&
        tools.every((tool) => count(facts[field][tool])),
      "TOOL_COUNTS",
    );
  }
  requireFact(
    tools.every((tool) => facts.completedAllowedTools[tool] <= facts.attemptedAllowedTools[tool]) &&
      count(facts.ungrantedToolAttemptCount),
    "TOOL_COUNTS",
  );
  requireFact(
    sourceReads.length === 0 || facts.completedAllowedTools.searchVault > 0,
    "SOURCE_TOOL",
  );
  requireFact(
    ["deterministic_dataset", "owned_image_input", "vault_excerpt", "none"].includes(
      facts.grounding,
    ),
    "GROUNDING",
  );
  for (const [field, lane, grounding] of [
    ["visualSource", "design", "owned_image_input"],
    ["dataSource", "data", "deterministic_dataset"],
  ]) {
    const source = facts[field];
    if (source !== undefined)
      requireFact(
        pin.verticalId === lane &&
          facts.grounding === grounding &&
          digest(source.sha256) &&
          sourceMap.get(source.docId) === source.sha256,
        "SOURCE_BINDING",
      );
    if (facts.grounding === grounding) requireFact(source !== undefined, "SOURCE_BINDING");
  }
  if (facts.grounding === "vault_excerpt") requireFact(sourceReads.length > 0, "GROUNDING");
  requireFact(typeof result.reply === "string", "REPLY");
  const replyHash = hash(result.reply);
  const artifact = result.artifactId !== undefined;
  if (artifact)
    requireFact(
      id(result.artifactId) &&
        facts.artifactId === result.artifactId &&
        facts.artifactContentSha256 === replyHash &&
        result.reply.trim().length > 0 &&
        facts.completedAllowedTools.saveAsDocument > 0,
      "ARTIFACT",
    );
  else
    requireFact(
      facts.artifactId === undefined && facts.artifactContentSha256 === undefined,
      "ARTIFACT",
    );
  const mechanicalOutcome =
    result.outcome === "useful" &&
    artifact &&
    !facts.truncated &&
    facts.ungrantedToolAttemptCount === 0 &&
    facts.grounding !== "none"
      ? "useful"
      : "partial";
  return {
    ...base,
    mechanicalOutcome,
    modelEvaluated: execution === "model",
    replySha256: replyHash,
    configuredModelId: facts.configuredModelId,
    configuredFallbackModelId: facts.configuredFallbackModelId,
    actualModelId: facts.actualModelId,
    modelCostUsd: facts.modelCostUsd,
    attemptedAllowedTools: Object.fromEntries(
      tools.map((tool) => [tool, facts.attemptedAllowedTools[tool]]),
    ),
    completedAllowedTools: Object.fromEntries(
      tools.map((tool) => [tool, facts.completedAllowedTools[tool]]),
    ),
    ungrantedToolAttemptCount: facts.ungrantedToolAttemptCount,
    truncated: facts.truncated,
    grounding: facts.grounding,
    ...(facts.visualSource
      ? { visualSource: { docId: facts.visualSource.docId, sha256: facts.visualSource.sha256 } }
      : {}),
    ...(facts.dataSource
      ? { dataSource: { docId: facts.dataSource.docId, sha256: facts.dataSource.sha256 } }
      : {}),
    ...(artifact ? { artifactId: result.artifactId, artifactContentSha256: replyHash } : {}),
  };
}
