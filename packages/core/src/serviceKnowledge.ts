import type { BusinessProfile } from "./businessProfile";
import { isManagedServiceOperationId, type ManagedServiceOperationId } from "./managedServices";

export const SERVICE_KNOWLEDGE_KEYS = [
  "offering",
  "targetCustomer",
  "brandVoice",
  "publishingBoundaries",
] as const;
export type ServiceKnowledgeKey = (typeof SERVICE_KNOWLEDGE_KEYS)[number];
export type ServiceKnowledgeSourceState = "current" | "changed" | "withdrawn" | "unverified";
export type ServiceKnowledgeCandidate = Readonly<{
  key: ServiceKnowledgeKey;
  value: string;
  sourceRef: string;
  sourceHash: string | null;
  confirmedAt: number | null;
  sourceState: ServiceKnowledgeSourceState;
  /** Explicit user-confirmed replacement references, never an inferred newest-wins rule. */
  supersedes?: readonly string[];
}>;
export type ServiceKnowledgeGapReason =
  | "missing"
  | "unconfirmed"
  | "changed"
  | "withdrawn"
  | "conflict";
export type ServiceKnowledgeGap = {
  key: ServiceKnowledgeKey;
  reason: ServiceKnowledgeGapReason;
  sourceRefs: string[];
};
export type ServiceKnowledgeAssessment = {
  ready: boolean;
  gaps: ServiceKnowledgeGap[];
  nextQuestion: {
    key: ServiceKnowledgeKey;
    question: string;
    why: string;
    reason: ServiceKnowledgeGapReason;
  } | null;
  knowledge: ServiceKnowledgeCandidate[];
};
export const SERVICE_KNOWLEDGE_MAX_CANDIDATES = 64;
export const SERVICE_KNOWLEDGE_MAX_VALUE_CHARS = 4000;

// Interface copy only. These questions are not instructions sent to a model or registry skill.
const QUESTIONS: Record<ServiceKnowledgeKey, { question: string; why: string }> = {
  offering: {
    question: "What product or service should your social content focus on?",
    why: "Pikar needs a confirmed offer to prepare relevant content.",
  },
  targetCustomer: {
    question: "Who do you want to reach with your social content?",
    why: "Your intended customers guide the topics and examples Pikar prepares.",
  },
  brandVoice: {
    question: "How should your business sound? You can describe the tone or share an example.",
    why: "A confirmed voice helps Pikar draft content that sounds like your business.",
  },
  publishingBoundaries: {
    question: "What should Pikar avoid saying or promising in your social content?",
    why: "Clear boundaries keep drafts within your business rules. Publishing still needs approval.",
  },
};
const normal = (value: string) => value.trim().replace(/\s+/g, " ");
const ref = (value: string) => typeof value === "string" && /^[A-Za-z0-9_:-]{1,200}$/.test(value);
const hash = (value: string | null) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const time = (value: number) => Number.isSafeInteger(value) && value >= 0;
const invalid = (): never => {
  throw new Error("SERVICE_KNOWLEDGE_INPUT_INVALID");
};

/** The adapter must resolve owned sources and exact native confirmation; prose cannot attest itself. */
export function assessServiceKnowledge(input: {
  operationIds: readonly ManagedServiceOperationId[];
  candidates: readonly ServiceKnowledgeCandidate[];
  nowMs: number;
}): ServiceKnowledgeAssessment {
  if (
    !time(input.nowMs) ||
    input.operationIds.length > 4 ||
    input.operationIds.some((operation) => !isManagedServiceOperationId(operation)) ||
    input.candidates.length > SERVICE_KNOWLEDGE_MAX_CANDIDATES
  )
    return invalid();
  for (const row of input.candidates) {
    if (
      !SERVICE_KNOWLEDGE_KEYS.includes(row.key) ||
      typeof row.value !== "string" ||
      (!normal(row.value) && row.sourceState === "current") ||
      row.value.length > SERVICE_KNOWLEDGE_MAX_VALUE_CHARS ||
      !ref(row.sourceRef) ||
      (row.sourceHash !== null && !hash(row.sourceHash)) ||
      (row.confirmedAt !== null && (!time(row.confirmedAt) || row.confirmedAt > input.nowMs)) ||
      !["current", "changed", "withdrawn", "unverified"].includes(row.sourceState) ||
      (row.supersedes !== undefined &&
        (row.supersedes.length > 16 ||
          new Set(row.supersedes).size !== row.supersedes.length ||
          row.supersedes.some((value) => !ref(value) || value === row.sourceRef)))
    )
      return invalid();
  }
  // Reporting reads existing account evidence; content onboarding is not a report prerequisite.
  const required = input.operationIds.includes("social.prepare") ? SERVICE_KNOWLEDGE_KEYS : [];
  const gaps: ServiceKnowledgeGap[] = [];
  const knowledge: ServiceKnowledgeCandidate[] = [];
  for (const key of required) {
    const rows = input.candidates.filter((row) => row.key === key);
    const ambiguousRefs = new Set(
      rows
        .filter(
          (row) =>
            row.sourceState !== "current" ||
            new Set(
              rows
                .filter((other) => other.sourceRef === row.sourceRef)
                .map((other) => other.sourceHash),
            ).size > 1,
        )
        .map((row) => row.sourceRef),
    );
    const reviewed = rows.filter((row) => row.confirmedAt !== null && hash(row.sourceHash));
    const confirmed = reviewed.filter(
      (row) => row.sourceState === "current" && !ambiguousRefs.has(row.sourceRef),
    );
    const superseded = new Set<string>();
    // Withdrawal cannot silently resurrect a fact the user already replaced. The exact
    // confirmation retains that decision, although its missing source cannot supply a value.
    for (const replacement of reviewed)
      for (const target of rows)
        if (
          replacement.supersedes?.includes(target.sourceRef) &&
          target.confirmedAt !== null &&
          replacement.confirmedAt !== null &&
          replacement.confirmedAt > target.confirmedAt
        )
          superseded.add(target.sourceRef);
    const usable = confirmed.filter((row) => !superseded.has(row.sourceRef));
    const values = new Set(usable.map((row) => normal(row.value)));
    if (values.size === 1) {
      // Preserve every corroborating source. Input order and source timestamps do not choose truth.
      const seen = new Set<string>();
      for (const row of [...usable].sort((a, b) =>
        JSON.stringify([a.sourceRef, a.sourceHash, a.confirmedAt]).localeCompare(
          JSON.stringify([b.sourceRef, b.sourceHash, b.confirmedAt]),
          "en",
        ),
      )) {
        const identity = JSON.stringify([row.sourceRef, row.sourceHash, row.confirmedAt]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        knowledge.push({
          ...row,
          value: normal(row.value),
          ...(row.supersedes ? { supersedes: [...row.supersedes] } : {}),
        });
      }
      continue;
    }
    const reason: ServiceKnowledgeGapReason =
      values.size > 1
        ? "conflict"
        : rows.some((row) => row.sourceState === "changed")
          ? "changed"
          : rows.some((row) => row.sourceState === "withdrawn")
            ? "withdrawn"
            : rows.length
              ? "unconfirmed"
              : "missing";
    gaps.push({ key, reason, sourceRefs: [...new Set(rows.map((row) => row.sourceRef))].sort() });
  }
  const first = gaps[0];
  return {
    ready: gaps.length === 0,
    gaps,
    knowledge,
    nextQuestion: first
      ? {
          key: first.key,
          reason: first.reason,
          ...QUESTIONS[first.key],
          question:
            first.reason === "conflict"
              ? `Your saved information disagrees. ${QUESTIONS[first.key].question}`
              : first.reason === "changed" || first.reason === "withdrawn"
                ? `The saved source needs confirmation again. ${QUESTIONS[first.key].question}`
                : QUESTIONS[first.key].question,
        }
      : null,
  };
}

/** Reuse only explicit profile fields; constraints are not silently converted into posting rules. */
export function serviceKnowledgeFromProfile(
  profile: Pick<BusinessProfile, "offering" | "targetCustomer">,
  provenance: Pick<
    ServiceKnowledgeCandidate,
    "sourceRef" | "sourceHash" | "confirmedAt" | "sourceState"
  >,
): ServiceKnowledgeCandidate[] {
  return (["offering", "targetCustomer"] as const).flatMap((key) =>
    profile[key].trim() ? [{ key, value: profile[key], ...provenance }] : [],
  );
}
