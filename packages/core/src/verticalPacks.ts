// Phase 30-01: policy only. No registry publication, runtime route or activation is added here.
import { TIERS, type Tier } from "./businessProfile";
import {
  LEAF_FORBIDDEN_OPERATIONS,
  type PackOperation,
  type PackOutput,
  type ReachablePackSource,
  WORKFLOW_PACKS,
  type WorkflowPackId,
} from "./workflowPacks";

export const VERTICAL_IDS = ["legal", "hr", "product", "design", "engineering", "data"] as const;
export type VerticalId = (typeof VERTICAL_IDS)[number];
export const VERTICAL_WORKFLOW_IDS = [
  "legal-contract-issues",
  "hr-onboarding-materials",
  "product-prd-brief",
  "design-artifact-critique",
  "engineering-runbook-review",
  "data-dataset-report",
] as const;
export type VerticalWorkflowId = (typeof VERTICAL_WORKFLOW_IDS)[number];
/** Reserved native names. Mapping a name never publishes a body or grants execution. */
export const verticalSkillName = (id: VerticalId): string => `vertical-${id}`;
export const verticalIdForSkill = (name: string): VerticalId | null =>
  VERTICAL_IDS.find((id) => verticalSkillName(id) === name) ?? null;
export type VerticalReview = "qualified-counsel" | "qualified-hr" | "human-review";
export type VerticalRisk = "consequential" | "advisory";
export type VerticalConnectorGate =
  | "legal-systems"
  | "hr-systems"
  | "project-systems"
  | "design-systems"
  | "source-control-monitoring"
  | "data-warehouse";
export type VerticalPackDefinition = {
  readonly id: VerticalId;
  readonly workflowId: VerticalWorkflowId;
  /** Reuse the approved native template contract; vertical bodies earn their own later evidence. */
  readonly baseTemplateId: WorkflowPackId;
  readonly risk: VerticalRisk;
  readonly output: PackOutput;
  readonly outputContractId: `${VerticalId}-output.v1`;
  readonly disclaimerId: `${VerticalId}-review.v1`;
  readonly requiredReview: VerticalReview;
  readonly requiredSources: readonly ReachablePackSource[];
  readonly connectorGate: VerticalConnectorGate;
  readonly operations: readonly PackOperation[];
  readonly disablePolicy: "block-new-starts-preserve-artifacts";
  readonly rollbackPolicy: "exact-previously-active-version";
};

// Reuse the native operations themselves. The allowed ids are literal so a future SOP tool does
// not silently widen vertical authority. A missing base operation is a boot/test error.
const FILE_OPERATION_IDS = ["ground-in-vault", "save-sop"] as const;
const fileOperations: readonly PackOperation[] = Object.freeze([
  ...FILE_OPERATION_IDS.map((id) => {
    const operation = WORKFLOW_PACKS["process-sop"].operations.find((item) => item.id === id);
    if (!operation || operation.state !== "existing")
      throw new Error("VERTICAL_NATIVE_OPERATION_MISSING");
    return operation;
  }),
  ...LEAF_FORBIDDEN_OPERATIONS,
]);

const define = (
  id: VerticalId,
  workflowId: VerticalWorkflowId,
  risk: VerticalRisk,
  requiredReview: VerticalReview,
  connectorGate: VerticalConnectorGate,
): VerticalPackDefinition =>
  Object.freeze({
    id,
    workflowId,
    baseTemplateId: "process-sop",
    risk,
    output: "document",
    outputContractId: `${id}-output.v1`,
    disclaimerId: `${id}-review.v1`,
    requiredReview,
    requiredSources: Object.freeze(["vault"] as const),
    connectorGate,
    operations: fileOperations,
    disablePolicy: "block-new-starts-preserve-artifacts",
    rollbackPolicy: "exact-previously-active-version",
  });

export const VERTICAL_PACKS: Readonly<Record<VerticalId, VerticalPackDefinition>> = Object.freeze({
  legal: define(
    "legal",
    "legal-contract-issues",
    "consequential",
    "qualified-counsel",
    "legal-systems",
  ),
  hr: define("hr", "hr-onboarding-materials", "consequential", "qualified-hr", "hr-systems"),
  product: define("product", "product-prd-brief", "advisory", "human-review", "project-systems"),
  design: define(
    "design",
    "design-artifact-critique",
    "advisory",
    "human-review",
    "design-systems",
  ),
  engineering: define(
    "engineering",
    "engineering-runbook-review",
    "advisory",
    "human-review",
    "source-control-monitoring",
  ),
  data: define("data", "data-dataset-report", "advisory", "human-review", "data-warehouse"),
});

export const VERTICAL_REASONS = [
  "unconfirmed-profile",
  "no-confirmed-need",
  "insufficient-repeat-use",
  "not-released",
  "disabled",
  "missing-source",
  "review-required",
  "playbook-required",
  "validator-unavailable",
  "connector-not-approved",
  "confirmed-repeat-workflow",
] as const;
export type VerticalReason = (typeof VERTICAL_REASONS)[number];
export type VerticalState = "hidden" | "available" | "blocked" | "disabled";
export type VerticalEvidence = {
  readonly profileConfirmed: boolean;
  readonly tier: Tier;
  /** Explicitly confirmed choices, never keyword matches from a profile description. */
  readonly confirmedNeeds: readonly VerticalId[];
  readonly repeatCounts: Readonly<Partial<Record<VerticalId, number>>>;
  readonly sources: readonly ReachablePackSource[];
  /** Adapter supplies only versions whose native provenance/eval/UAT exposure gates passed. */
  readonly released: readonly VerticalId[];
  readonly disabled: readonly VerticalId[];
  readonly reviewReady: readonly VerticalId[];
  readonly confirmedLegalPlaybook: boolean;
  readonly deterministicDataValidationReady: boolean;
  readonly visualSourceReady: boolean;
  /** Connector variants remain structurally blocked until a separately reviewed adapter lands. */
  readonly connectorVariants: readonly VerticalId[];
};
export type VerticalRecommendation = {
  readonly id: VerticalId;
  readonly workflowId: VerticalWorkflowId;
  readonly state: VerticalState;
  readonly reason: VerticalReason;
  readonly missingSources: readonly ReachablePackSource[];
};

export function verticalState(id: VerticalId, evidence: VerticalEvidence): VerticalRecommendation {
  if (!Object.hasOwn(VERTICAL_PACKS, id)) throw new Error("UNKNOWN_VERTICAL");
  const definition = VERTICAL_PACKS[id];
  const result = (
    state: VerticalState,
    reason: VerticalReason,
    missingSources: readonly ReachablePackSource[] = [],
  ): VerticalRecommendation => ({
    id,
    workflowId: definition.workflowId,
    state,
    reason,
    missingSources,
  });
  if (evidence.disabled.includes(id)) return result("disabled", "disabled");
  if (!evidence.profileConfirmed || !TIERS.includes(evidence.tier))
    return result("hidden", "unconfirmed-profile");
  if (!evidence.confirmedNeeds.includes(id)) return result("hidden", "no-confirmed-need");
  const count = evidence.repeatCounts[id];
  if (!Number.isSafeInteger(count) || (count ?? 0) < 2)
    return result("hidden", "insufficient-repeat-use");
  if (!evidence.released.includes(id)) return result("hidden", "not-released");
  if (evidence.connectorVariants.includes(id)) return result("blocked", "connector-not-approved");
  const missing = definition.requiredSources.filter((source) => !evidence.sources.includes(source));
  if (missing.length > 0) return result("blocked", "missing-source", missing);
  if (id === "design" && !evidence.visualSourceReady)
    return result("blocked", "missing-source", ["vault"]);
  if (!evidence.reviewReady.includes(id)) return result("blocked", "review-required");
  if (id === "legal" && !evidence.confirmedLegalPlaybook)
    return result("blocked", "playbook-required");
  if (id === "data" && !evidence.deterministicDataValidationReady)
    return result("blocked", "validator-unavailable");
  return result("available", "confirmed-repeat-workflow");
}

/** Presentation only. Sorting and tier evidence never flow into authority resolution. */
export function recommendVerticals(evidence: VerticalEvidence): readonly VerticalRecommendation[] {
  return VERTICAL_IDS.map((id) => verticalState(id, evidence))
    .filter((item) => item.state === "available" || item.state === "blocked")
    .sort(
      (a, b) =>
        Number(b.state === "available") - Number(a.state === "available") ||
        Math.min(100, evidence.repeatCounts[b.id] ?? 0) -
          Math.min(100, evidence.repeatCounts[a.id] ?? 0) ||
        VERTICAL_IDS.indexOf(a.id) - VERTICAL_IDS.indexOf(b.id),
    )
    .slice(0, 2);
}

/** Code-owned grant; no tier/profile/DB/body argument exists. This is not a runtime entry point. */
export function toolsForVerticalWorkflow(workflowId: VerticalWorkflowId): readonly string[] {
  const definition = Object.values(VERTICAL_PACKS).find((item) => item.workflowId === workflowId);
  if (!definition) throw new Error("UNKNOWN_VERTICAL_WORKFLOW");
  return [
    ...new Set(
      definition.operations.flatMap((operation) =>
        operation.state === "existing" ? operation.tools : [],
      ),
    ),
  ].sort();
}
