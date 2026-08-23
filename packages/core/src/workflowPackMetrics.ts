// Outcome metrics for the curated knowledge-work pack pilot (Phase 27, PACK-04). Pure TS,
// Convex-free (CLAUDE.md §1) — `convex/workflowPackEventLog.ts` is the recorder, and it reads rows
// back into the one shape defined here.
//
// WHAT THIS PLANE MEASURES: completed useful outcomes, not installations. Install count is
// deliberately absent — it measures whether a thing was offered, not whether it worked.
//
// WHAT IT DOES NOT MEASURE, STRUCTURALLY. `PackMetricEvent` has no cost field and no latency field,
// so no function here can produce either. Cost is owned by `spendEvents` and latency by
// `telemetry.durationMs` / `agentSteps`, and both are joined by `correlationId` — see
// `PACK_DERIVED_METRIC_SOURCES`. A second cost number that can disagree with the billing plane is
// worse than no number, and the prohibition is a property of the type rather than a rule someone
// has to remember.
//
// A MEASURE WITH NO DATA SAYS SO. Every ratio returns `not_applicable` on a zero denominator rather
// than 1.0 or 0.0. "0 of 0 claims were cited" is as wrong reported as perfect as it is reported as
// terrible; this repo has shipped a permanent invented zero before (26-14's `edit: 0`).

/** The closed event vocabulary. Mirrors `workflowPackEvents.event` in convex/schema.ts. */
export const PACK_EVENTS = [
  "recommendation_shown",
  "recommendation_accepted",
  "run_started",
  "preflight_completed",
  "plan_proposed",
  "plan_approved",
  "plan_edited",
  "plan_rejected",
  "capability_missing",
  "artifact_created",
  "run_completed",
  "run_failed",
] as const satisfies readonly string[];
export type PackEvent = (typeof PACK_EVENTS)[number];

/** The closed terminal outcomes. Mirrors `workflowPackEvents.outcome`. */
export const PACK_OUTCOMES = [
  "useful",
  "partial",
  "blocked",
  "refused",
  "failed",
  "no_findings",
] as const satisfies readonly string[];
export type PackOutcome = (typeof PACK_OUTCOMES)[number];

/** The outcomes that mean the run did not deliver — the denominator of follow-up recovery. */
const UNSUCCESSFUL: readonly PackOutcome[] = ["blocked", "refused", "failed"];
/** The outcomes that mean the user got something usable. */
const SUCCESSFUL: readonly PackOutcome[] = ["useful", "partial"];

/**
 * The ONLY shape a metric may read — one `workflowPackEvents` row, normalised.
 *
 * Every optional column arrives as `| null` rather than `?`, deliberately: the recorder must decide
 * and write each one, and an optional field can never be mutation-checked by the compiler. There is
 * no field here for a prompt, an output, an excerpt, a URL, a subject, a customer name or a
 * financial value — refs, ids, enums and counts only (CLAUDE.md §4).
 */
export type PackMetricEvent = {
  readonly event: PackEvent;
  readonly packId: string;
  readonly runId: string;
  readonly createdAt: number;
  readonly outcome: PackOutcome | null;
  readonly recommendationId: string | null;
  readonly sourceExpectedCount: number | null;
  readonly sourceAvailableCount: number | null;
  readonly preflightMissingCount: number | null;
  readonly runtimeMissingCount: number | null;
  readonly claimCount: number | null;
  readonly citedClaimCount: number | null;
  readonly unsupportedClaimCount: number | null;
};

/**
 * Where cost and latency actually live. Named in code so a dashboard author joins to the owner
 * rather than reaching for a convenient number on the pack event that would drift from billing.
 */
export const PACK_DERIVED_METRIC_SOURCES = {
  cost: {
    table: "spendEvents",
    rail: "reasoning",
    index: "by_correlation",
    field: "amountCents",
  },
  latency: {
    table: "telemetry",
    field: "durationMs",
    /** Per-step fallback when a run produced no terminal telemetry row. */
    fallback: "agentSteps",
    index: "by_correlation",
  },
} as const;

/**
 * A measure that can be undefined. `not_applicable` is a first-class answer, not an error: it is
 * what an honest report says when the denominator is zero or the data never arrived.
 */
export type MetricRatio =
  | {
      readonly kind: "ratio";
      readonly numerator: number;
      readonly denominator: number;
      readonly value: number;
    }
  | { readonly kind: "not_applicable"; readonly reason: "zero_denominator" | "no_data" };

/** `seen` distinguishes "nothing to measure" from "measured zero" — they are different answers. */
function ratio(numerator: number, denominator: number, seen: boolean): MetricRatio {
  if (!seen) return { kind: "not_applicable", reason: "no_data" };
  if (denominator === 0) return { kind: "not_applicable", reason: "zero_denominator" };
  return { kind: "ratio", numerator, denominator, value: numerator / denominator };
}

/**
 * Citation coverage, POOLED across runs: total cited claims over total claims. A run that made no
 * claims contributes nothing to either side rather than a free 100%.
 */
export function citationCoverage(events: readonly PackMetricEvent[]): MetricRatio {
  return claimRatio(events, (e) => e.citedClaimCount);
}

/** Unsupported-claim rate, with the same denominator and the same zero semantics. */
export function unsupportedClaimRate(events: readonly PackMetricEvent[]): MetricRatio {
  return claimRatio(events, (e) => e.unsupportedClaimCount);
}

function claimRatio(
  events: readonly PackMetricEvent[],
  pick: (e: PackMetricEvent) => number | null,
): MetricRatio {
  let claims = 0;
  let picked = 0;
  let seen = false;
  for (const e of events) {
    const total = e.claimCount;
    const part = pick(e);
    if (total === null || part === null) continue;
    seen = true;
    claims += total;
    picked += part;
  }
  return ratio(picked, claims, seen);
}

/**
 * Recommendation acceptance, paired on the EXACT recommendation id.
 *
 * An acceptance with no matching impression is ignored rather than counted — otherwise a numerator
 * could exceed its denominator, which is the shape of a metric nobody can trust. An impression with
 * no id cannot be attributed and is not counted either.
 */
export function recommendationAcceptance(events: readonly PackMetricEvent[]): MetricRatio {
  const shown = new Set<string>();
  const accepted = new Set<string>();
  for (const e of events) {
    if (e.recommendationId === null) continue;
    const key = `${e.packId}::${e.recommendationId}`;
    if (e.event === "recommendation_shown") shown.add(key);
    if (e.event === "recommendation_accepted") accepted.add(key);
  }
  let matched = 0;
  for (const key of shown) if (accepted.has(key)) matched++;
  return ratio(matched, shown.size, shown.size > 0);
}

/**
 * Missing-connector SURPRISE: runs that discovered more missing sources than preflight announced.
 *
 * A source the pack said up front it could not see is not a surprise — that is the honest-partial
 * contract working. Only a source that went missing during the run is. A run that reported neither
 * count sits outside the denominator rather than being counted as a silent success.
 */
export function missingSourceSurprise(events: readonly PackMetricEvent[]): MetricRatio {
  let runs = 0;
  let surprised = 0;
  for (const e of events) {
    if (e.preflightMissingCount === null || e.runtimeMissingCount === null) continue;
    runs++;
    if (e.runtimeMissingCount > e.preflightMissingCount) surprised++;
  }
  return ratio(surprised, runs, runs > 0);
}

export type PlanDecisionCounts = {
  readonly approved: number;
  readonly edited: number;
  readonly rejected: number;
};

/** Counts every plan decision. An absent decision reads 0, never undefined. */
export function planDecisions(events: readonly PackMetricEvent[]): PlanDecisionCounts {
  const counts = { approved: 0, edited: 0, rejected: 0 };
  for (const e of events) {
    if (e.event === "plan_approved") counts.approved++;
    if (e.event === "plan_edited") counts.edited++;
    if (e.event === "plan_rejected") counts.rejected++;
  }
  return counts;
}

/**
 * A count for EVERY outcome in the closed enum, including the ones that never happened — a report
 * that silently omits `refused` reads identically to one where nothing was ever refused.
 */
export function completionOutcomes(
  events: readonly PackMetricEvent[],
): Readonly<Record<PackOutcome, number>> {
  const counts = Object.fromEntries(PACK_OUTCOMES.map((o) => [o, 0])) as Record<
    PackOutcome,
    number
  >;
  for (const e of events) {
    if (e.event !== "run_completed" && e.event !== "run_failed") continue;
    if (e.outcome === null) continue; // a terminal row with no outcome is not evidence of one
    counts[e.outcome]++;
  }
  return counts;
}

export type TimeToFirstUsefulOutcome =
  | { readonly kind: "known"; readonly ms: number }
  | {
      readonly kind: "unknown";
      readonly reason:
        | "no_onboarding_timestamp"
        | "no_useful_outcome"
        | "useful_precedes_onboarding";
    };

/**
 * The pilot's headline measure: how long from finishing onboarding to the first genuinely useful
 * pack outcome.
 *
 * Three distinct unknowns, never a number: the tenant's onboarding was never timestamped, nothing
 * useful has completed yet, or the useful run predates onboarding — which is a broken clock or a
 * mis-stamped row, not a fast onboarding. Reporting a negative duration would put a nonsense figure
 * into the measure the whole phase is judged by.
 */
export function timeToFirstUsefulOutcome(
  events: readonly PackMetricEvent[],
  onboardingCompletedAt: number | null,
): TimeToFirstUsefulOutcome {
  if (onboardingCompletedAt === null) return { kind: "unknown", reason: "no_onboarding_timestamp" };

  let earliest: number | null = null;
  for (const e of events) {
    if (e.event !== "run_completed" || e.outcome !== "useful") continue;
    if (earliest === null || e.createdAt < earliest) earliest = e.createdAt;
  }
  if (earliest === null) return { kind: "unknown", reason: "no_useful_outcome" };
  if (earliest < onboardingCompletedAt)
    return { kind: "unknown", reason: "useful_precedes_onboarding" };
  return { kind: "known", ms: earliest - onboardingCompletedAt };
}

/**
 * Follow-up recovery: of the runs that did NOT deliver, how many were redeemed by a later run of
 * the SAME pack that did?
 *
 * Direction and pack identity both matter. An earlier success does not redeem a later failure, and
 * a success in another pack is a different workflow entirely — either would turn this into a
 * measure of general activity rather than of recovery.
 */
export function followUpRecovery(events: readonly PackMetricEvent[]): MetricRatio {
  const terminal = events.filter((e) => e.event === "run_completed" || e.event === "run_failed");
  const bad = terminal.filter((e) => e.outcome !== null && UNSUCCESSFUL.includes(e.outcome));
  let recovered = 0;
  for (const e of bad) {
    const redeemed = terminal.some(
      (later) =>
        later.packId === e.packId &&
        later.createdAt > e.createdAt &&
        later.outcome !== null &&
        SUCCESSFUL.includes(later.outcome),
    );
    if (redeemed) recovered++;
  }
  return ratio(recovered, bad.length, bad.length > 0);
}
