/**
 * OPSG-01 per-request telemetry — the PURE terminal-row builder.
 *
 * One row is built once, at a request's terminal transition, FROM the accumulated
 * outcome — never patched incrementally (that invites OCC contention on a hot row
 * and half-written rows that look complete). This module is framework-agnostic
 * domain logic (CLAUDE.md §1); the Convex adapter (convex/telemetry.ts) persists
 * what this returns.
 *
 * "Present or explicitly null": every OPSG-01 key is always on the row. When a
 * terminal state was reached without any LLM call (a request rejected or expired
 * at the gate), the token/cost measurements are `null` — "not measured" — never a
 * silent 0 that reads as "measured, was zero".
 */

/** The terminal states that produce exactly one telemetry row. `blocked` is a
 *  governed guardrail stop — a first-class fail-closed terminal (GRDL-01), no LLM ran. */
export type ReviewOutcome = "sent" | "rejected" | "expired" | "failed" | "blocked";

/** One LLM call's usage — route, draft, and each regenerate contribute one. */
export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

/** The accumulated outcome a terminal transition hands to the builder. */
export interface TerminalOutcome {
  readonly reviewOutcome: ReviewOutcome;
  readonly durationMs: number;
  /** Per-decision tallies (approve | edit_text | regenerate | reject). Carried through. */
  readonly decisionCounts: Record<string, number>;
  /** The regenerate loop count. Carried through, not recomputed from usages. */
  readonly regenerateCount: number;
  /** route + draft + each regenerate; empty when no LLM ran (reject/expire). */
  readonly usages: readonly LlmUsage[];
}

/** The built OPSG-01 row. Token/cost fields are null when no LLM call occurred. */
export interface TelemetryRow {
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly costUsd: number | null;
  readonly durationMs: number;
  readonly decisionCounts: Record<string, number>;
  readonly regenerateCount: number;
  readonly reviewOutcome: ReviewOutcome;
}

/** Build the single OPSG-01 telemetry row from a terminal outcome. Pure. */
export function buildTelemetry(outcome: TerminalOutcome): TelemetryRow {
  const { usages } = outcome;
  const measured = usages.length > 0;
  const sum = (pick: (u: LlmUsage) => number) => usages.reduce((total, u) => total + pick(u), 0);

  return {
    // present-or-null: null == "no LLM ran", distinct from a measured zero.
    tokensIn: measured ? sum((u) => u.inputTokens) : null,
    tokensOut: measured ? sum((u) => u.outputTokens) : null,
    costUsd: measured ? sum((u) => u.costUsd) : null,
    durationMs: outcome.durationMs,
    decisionCounts: outcome.decisionCounts,
    regenerateCount: outcome.regenerateCount,
    reviewOutcome: outcome.reviewOutcome,
  };
}
