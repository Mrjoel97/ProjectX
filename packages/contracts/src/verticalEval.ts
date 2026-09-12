import {
  VERTICAL_CORPUS,
  VERTICAL_CORPUS_SHA256,
  VERTICAL_EVALUATOR_SHA256,
} from "./verticalEvalCorpus";

export const VERTICAL_EVAL_MODELS = ["or/openai/gpt-5.6-luna", "or/openai/gpt-4.1-mini"] as const;
export const VERTICAL_EVAL_SUITE = {
  revision: "2026-09-10.phase30.native-owner-reviewed",
  executable: true,
  names: [
    "vertical-data",
    "vertical-product",
    "vertical-design",
    "vertical-legal",
    "vertical-hr",
    "vertical-engineering",
  ],
} as const;

export type VerticalEvidence = {
  schemaVersion: 1;
  kind: "native-owner-reviewed-vertical";
  name: string;
  version: number;
  candidateId: string;
  bodyHash: string;
  runId: string;
  corpusHash: string;
  evaluatorHash: string;
  caseHashes: string[];
  caseReceiptIds: string[];
  reviewReceiptIds: string[];
  modelIds: string[];
  budgetId: string;
  passed: true;
  issuanceId: string;
};
export function verticalCorpus(name: string) {
  const lane = name.replace(/^vertical-/, "") as keyof typeof VERTICAL_CORPUS;
  return Object.hasOwn(VERTICAL_CORPUS, lane) && name === `vertical-${lane}`
    ? VERTICAL_CORPUS[lane]
    : undefined;
}
/** One exact corpus gate shared by unpaid preparation and native evidence issuance. */
export function requireVerticalCorpusCase(pin: {
  verticalId: string;
  caseId: string;
  caseHash: string;
  requestHash: string;
}) {
  const item = verticalCorpus(`vertical-${pin.verticalId}`)?.find((c) => c.caseId === pin.caseId);
  if (!item || item.caseHash !== pin.caseHash || item.requestHash !== pin.requestHash)
    throw new Error("VERTICAL_EVIDENCE_CORPUS_PIN");
  return item;
}
/** Structural check only. Native activation/exposure MUST also verify immutable issuance. */
export function hasPassingVerticalEvalEvidence(
  evidence: string | undefined,
  name: string,
  version: number,
): boolean {
  try {
    const value = JSON.parse(evidence ?? "null") as VerticalEvidence | null;
    const corpus = verticalCorpus(name);
    if (!value || !corpus) return false;
    const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    const ids = (v: unknown): v is string[] =>
      Array.isArray(v) &&
      v.length === corpus.length &&
      new Set(v).size === v.length &&
      v.every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id));
    return (
      value.schemaVersion === 1 &&
      value.kind === "native-owner-reviewed-vertical" &&
      value.name === name &&
      value.version === version &&
      Number.isSafeInteger(version) &&
      version > 0 &&
      value.passed === true &&
      digest(value.bodyHash) &&
      value.corpusHash === VERTICAL_CORPUS_SHA256 &&
      value.evaluatorHash === VERTICAL_EVALUATOR_SHA256 &&
      typeof value.candidateId === "string" &&
      typeof value.issuanceId === "string" &&
      typeof value.budgetId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.runId) &&
      ids(value.caseReceiptIds) &&
      ids(value.reviewReceiptIds) &&
      JSON.stringify(value.caseHashes) === JSON.stringify(corpus.map((c) => c.caseHash)) &&
      Array.isArray(value.modelIds) &&
      value.modelIds.length > 0 &&
      new Set(value.modelIds).size === value.modelIds.length &&
      value.modelIds.every((model) => (VERTICAL_EVAL_MODELS as readonly string[]).includes(model))
    );
  } catch {
    return false;
  }
}
