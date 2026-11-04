/**
 * Goal Engine v0 — "the agenda speaks" (Phase 34, G13, ADR-033). The agenda's PURE rules; no
 * Convex here (CLAUDE.md §1).
 *
 * An agenda row is one gap the WEEKLY review has surfaced, keyed by `gapKey` (route/playbook — the
 * identity the review's "what changed" delta already uses). It carries the lifecycle an evaluation
 * row cannot: the evaluation is rewritten every Monday, so "the user dismissed this" and "we already
 * acted on this" have nowhere to live on it. Propose-only: nothing in this family sends, schedules
 * or recurs beyond the existing Monday cron.
 */
import { BLUEPRINT_SEGMENTS } from "./blueprintSegments";

export const AGENDA_STATUSES = ["open", "proposed", "acted", "dismissed", "recurring"] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

/**
 * The transition for a gap that is PRESENT in the latest review. `cameBack` means the gap was
 * absent from the review before this one — it closed and re-opened, which outranks both a past
 * dismissal and a past action: the user should hear that it is back.
 */
export function nextAgendaStatus(prev: AgendaStatus | null, cameBack: boolean): AgendaStatus {
  if (prev === null) return "open";
  if (prev === "acted") return "recurring";
  if (prev === "dismissed") return cameBack ? "recurring" : "dismissed";
  return prev; // open, proposed and recurring hold
}

/** Plan statuses that mean the proposal crossed the Approve gate. `canceled` is the Discard button. */
const ACTED_PLAN_STATUSES: ReadonlySet<string> = new Set([
  "approved",
  "scheduled",
  "delivering",
  "done",
]);

/** What the proposal's plan row says happened to it, or null while it still waits at the gate. */
export function agendaStatusFromPlan(planStatus: string): "acted" | "dismissed" | null {
  if (ACTED_PLAN_STATUSES.has(planStatus)) return "acted";
  if (planStatus === "canceled") return "dismissed";
  return null;
}

/**
 * Goal linkage v0 — read-only. A gap's specialist route names a blueprint segment; an active goal
 * anchored on that segment is "the goal this gap blocks". No new table, no inference, and the agent
 * still writes no goal (living-map §10).
 */
export function segmentForRoute(route: string): string | null {
  return BLUEPRINT_SEGMENTS.find((s) => s.specialist === route)?.id ?? null;
}

/** The Command Center shows at most this many rows — the audit's "next three actions". */
export const AGENDA_LIMIT = 3;

export type ReviewOutcomeFeedback = "helped" | "needs_change";

/** Only a finished proposal can receive usefulness feedback. An approval alone tells us nothing about its result. */
export function reviewFollowUp(
  status: string,
  feedback: ReviewOutcomeFeedback | null,
  proofMetric: string | null,
) {
  if (status === "done") {
    const evidence = proofMetric ? ` Check this against the review's measure: ${proofMetric}` : "";
    if (feedback === "needs_change")
      return {
        title: "Revise the approach",
        reason: `You said this work needs a change. Tell Pikar what to adjust in the review conversation.${evidence}`,
        actionLabel: "Discuss the change",
        feedback,
        canGiveFeedback: true,
      };
    if (feedback === "helped")
      return {
        title: "Check what changed",
        reason: `You found the work helpful. Record what you observed so the next review can compare it.${evidence}`,
        actionLabel: "Share an observation",
        feedback,
        canGiveFeedback: true,
      };
    return {
      title: "Review the completed work",
      reason: `Pikar finished this proposal. Was the result useful?${evidence}`,
      actionLabel: "Open review conversation",
      feedback,
      canGiveFeedback: true,
    };
  }
  if (agendaStatusFromPlan(status) !== "acted") return null;
  return {
    title: "Follow the approved work",
    reason:
      status === "scheduled"
        ? "The work is scheduled. Check its progress in the review conversation."
        : "You approved the work. Pikar is waiting for the final result.",
    actionLabel: "Check progress",
    feedback: null,
    canGiveFeedback: false,
  };
}

/** Code-owned status words for the agenda card. Never the enum slug. */
export const AGENDA_STATUS_WORD: Record<AgendaStatus, string> = {
  open: "Open",
  proposed: "Awaiting your approval",
  acted: "Acted on",
  dismissed: "Dismissed",
  recurring: "Came back",
};
