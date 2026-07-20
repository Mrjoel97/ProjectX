/**
 * REVW-02 review-gate policy — the PURE, fail-closed decision classifier.
 *
 * This is the SINGLE source of truth both review gates call: the pipeline gate
 * (convex/pipeline.ts / review.ts, 07-03) and the cockpit gate (07-04). Routing every
 * caller through one function fixes the "regenerate past the cap = an unapproved send"
 * bug ONCE, at the shared decision point (CLAUDE.md §8 root-cause), instead of a guard
 * per caller that a new caller can forget.
 *
 * Fail-closed: once the regenerate cap is reached, a further regenerate must ESCALATE
 * (hand the draft to a human), NEVER fall through to `proceed`/delivery.
 *
 * `edit_text` and `reject` are single-shot terminals — they break/terminate the gate, so
 * their per-session "counter" cannot exceed 1. The one enforceable threshold is the
 * regenerate cap; its breach path is escalate, never deliver.
 */

/** Per-tenant policy could raise this ceiling; this is the ponytail default (07-CONTEXT). */
export const MAX_REGENERATE = 3;

export type ReviewDecision = "approve" | "edit_text" | "reject" | "regenerate";

export interface ReviewClassifierInput {
  readonly decision: ReviewDecision;
  /** How many regenerates have already happened this session (0 on the first). */
  readonly regenerateCount: number;
}

export type ReviewClassification =
  | { readonly action: "proceed" }
  | { readonly action: "terminate"; readonly outcome: "rejected" }
  | { readonly action: "regenerate" }
  | { readonly action: "escalate"; readonly reason: "regenerate_limit" };

/**
 * Classify a review decision into the gate's next move. Pure — no Convex, no Date.now.
 * The escalate branch is the fail-closed fix: at/over MAX_REGENERATE a regenerate is
 * escalated, never delivered.
 */
export function classifyReviewDecision(input: ReviewClassifierInput): ReviewClassification {
  const { decision, regenerateCount } = input;
  switch (decision) {
    case "approve":
    case "edit_text":
      return { action: "proceed" };
    case "reject":
      return { action: "terminate", outcome: "rejected" };
    case "regenerate":
      return regenerateCount < MAX_REGENERATE
        ? { action: "regenerate" }
        : { action: "escalate", reason: "regenerate_limit" };
  }
}
