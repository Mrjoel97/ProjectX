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

/** Code-owned status words for the agenda card. Never the enum slug. */
export const AGENDA_STATUS_WORD: Record<AgendaStatus, string> = {
  open: "Open",
  proposed: "Awaiting your approval",
  acted: "Acted on",
  dismissed: "Dismissed",
  recurring: "Came back",
};
