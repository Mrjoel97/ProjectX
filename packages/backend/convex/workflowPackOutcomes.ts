// The pilot's outcome projection (Phase 27, PACK-04) — a BOUNDED, tenant-derived read over
// `workflowPackEvents`, joined to the planes that already own cost and latency.
//
// IT DEFINES NO METRIC. Every number below comes from `@pikar/core`'s pure
// `workflowPackMetrics.ts` (CLAUDE.md section 1): this module reads rows, joins two other tables by
// `runId`, and calls those functions. A metric re-derived here would be a second definition of a
// measure that already has exactly one, and the two would disagree the first time either changed.
//
// COST AND LATENCY ARE JOINED, NEVER RE-EMITTED. `spendEvents` owns cost (rail `reasoning`, index
// `by_correlation`) and `agentSteps` owns per-run timing (`by_turn`). The pack lane passes its
// `runId` as the loop's `turnId`, which IS the `spendEvents.correlationId` and the
// `agentSteps.turnId` for the whole run — so one id joins all three planes and there is never a
// second cost number that can disagree with the billing plane. See `PACK_DERIVED_METRIC_SOURCES`.
//
// TWO MEASURES REPORT `no_data` TODAY, AND THAT IS THE HONEST ANSWER. `citationCoverage` and
// `unsupportedClaimRate` read `claimCount` / `citedClaimCount` / `unsupportedClaimCount`, and
// nothing writes them yet: scoring a body's claims is grading, and the only plane that grades a pack
// body is 27-08's eval runner. When that runner records the counts these light up unchanged. A
// projection that invented a 100% citation rate from zero claims is the exact failure 27-03's
// `not_applicable` arm exists to prevent.

import {
  citationCoverage,
  completionOutcomes,
  followUpRecovery,
  type MetricRatio,
  missingSourceSurprise,
  type PackMetricEvent,
  type PackOutcome,
  type PlanDecisionCounts,
  planDecisions,
  recommendationAcceptance,
  type TimeToFirstUsefulOutcome,
  timeToFirstUsefulOutcome,
  unsupportedClaimRate,
} from "@pikar/core";
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { tenantQuery } from "./lib/functions";
import { onboardingCompletedAt } from "./onboarding";
import { PACK_EVENT_PAGE_MAX, toMetricEvent } from "./workflowPackEventLog";

/**
 * How many distinct runs get the cost/latency join. It is a SECOND bound on top of the event page,
 * because each joined run costs two more indexed reads: 500 events could otherwise be 500 runs and
 * 1,000 extra reads inside one query. The newest runs are the ones a pilot dashboard is looking at.
 */
export const PACK_RUN_JOIN_MAX = 25;

const packIdArg = v.union(
  v.literal("business-pulse"),
  v.literal("campaign-plan"),
  v.literal("customer-complaint"),
  v.literal("sales-call-prep"),
  v.literal("process-sop"),
  v.literal("brand-review"),
);

/** Cost, in the ledger's own unit. `runsPriced` is the denominator: a run the ledger never charged
 *  (a governed stop, a zero-usage turn) contributes nothing rather than a free zero. */
export type PackCostRollup = { totalCents: number; runsPriced: number; runsJoined: number };

/** Wall-clock per run, from the run's own activity trace. `runsMeasured` is again the denominator. */
export type PackLatencyRollup = { runsMeasured: number; medianMs: number | null; maxMs: number };

export type PackOutcomeReport = {
  eventCount: number;
  runCount: number;
  citationCoverage: MetricRatio;
  unsupportedClaimRate: MetricRatio;
  recommendationAcceptance: MetricRatio;
  missingSourceSurprise: MetricRatio;
  planDecisions: PlanDecisionCounts;
  completionOutcomes: Readonly<Record<PackOutcome, number>>;
  timeToFirstUsefulOutcome: TimeToFirstUsefulOutcome;
  followUpRecovery: MetricRatio;
  cost: PackCostRollup;
  latency: PackLatencyRollup;
};

/**
 * The ledger correlation ids ONE agent loop writes for a run. `runAgentLoop` passes the run's
 * `turnId` through as its `loopId` and then charges each attempt under `agentloop:<loopId>:a<n>` —
 * the primary AND, on an eligible failure, the fallback, which is billed too and must not vanish
 * from the pilot's cost. The `:search` sibling is a Tavily fee on the same attempt and is included
 * for the same reason.
 *
 * ponytail: the format is llm.ts's and is re-stated here rather than hoisted into a shared package,
 * because there are exactly two sites and hoisting means a new file under `packages/core` with its
 * own playbook. The drift is caught rather than trusted — `workflowPackOutcomes.test.ts` asserts the
 * projection's total EQUALS the ledger's own rows for a real run, so a format change reddens it
 * instead of silently reporting no cost. Upgrade path: a third consumer moves it into @pikar/cost.
 */
function ledgerCorrelationIds(runId: string): string[] {
  return [0, 1].flatMap((attempt) => [
    `agentloop:${runId}:a${attempt}`,
    `agentloop:${runId}:a${attempt}:search`,
  ]);
}

/** Sum this run's `reasoning`-rail charges. Tenant-checked because `by_correlation` is keyed on the
 *  correlation id ALONE — a tenant-scoped read must never trust an index that is not. */
export async function costForRun(
  ctx: QueryCtx,
  tenantId: string,
  runId: string,
): Promise<number | null> {
  const rows: { tenantId: string; rail: string; amountCents: number }[] = [];
  for (const correlationId of ledgerCorrelationIds(runId)) {
    rows.push(
      ...(await ctx.db
        .query("spendEvents")
        .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
        .take(PACK_RUN_JOIN_MAX)),
    );
  }
  const mine = rows.filter((r) => r.tenantId === tenantId && r.rail === "reasoning");
  // `null`, not 0: "the ledger has no row for this run" and "this run cost nothing" are different
  // answers, and averaging the first as a zero understates every cost the pilot reports.
  return mine.length === 0 ? null : mine.reduce((sum, r) => sum + r.amountCents, 0);
}

/** Wall clock for one run: the span from its first step starting to its last step ending. A step
 *  still open (`endedAt` absent) makes the run unmeasured rather than artificially short. */
export async function latencyForRun(
  ctx: QueryCtx,
  tenantId: string,
  runId: string,
): Promise<number | null> {
  const steps = await ctx.db
    .query("agentSteps")
    .withIndex("by_turn", (q) => q.eq("tenantId", tenantId).eq("turnId", runId))
    .take(PACK_EVENT_PAGE_MAX);
  if (steps.length === 0) return null;
  const ends = steps.map((s) => s.endedAt).filter((e): e is number => e !== undefined);
  if (ends.length !== steps.length) return null;
  return Math.max(...ends) - Math.min(...steps.map((s) => s.startedAt));
}

/**
 * The pilot report for the calling tenant. `tenantQuery` derives `tenantId` from the caller's
 * identity (CLAUDE.md section 2) — it is never an argument, so no caller can ask for another
 * tenant's outcomes.
 */
export const forTenant = tenantQuery({
  args: { packId: v.optional(packIdArg), limit: v.optional(v.number()) },
  handler: async (ctx, { packId, limit }): Promise<PackOutcomeReport> => {
    const take = Math.min(limit ?? PACK_EVENT_PAGE_MAX, PACK_EVENT_PAGE_MAX);
    const rows =
      packId === undefined
        ? await ctx.db
            .query("workflowPackEvents")
            .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", ctx.tenantId))
            .order("desc")
            .take(take)
        : await ctx.db
            .query("workflowPackEvents")
            .withIndex("by_tenant_pack_createdAt", (q) =>
              q.eq("tenantId", ctx.tenantId).eq("packId", packId),
            )
            .order("desc")
            .take(take);
    const events: PackMetricEvent[] = rows.map(toMetricEvent);

    // Newest-first already, so this keeps the most recent runs rather than an arbitrary slice.
    const runIds = [...new Set(events.map((e) => e.runId))].slice(0, PACK_RUN_JOIN_MAX);
    const costs: number[] = [];
    const latencies: number[] = [];
    for (const runId of runIds) {
      const cents = await costForRun(ctx, ctx.tenantId, runId);
      if (cents !== null) costs.push(cents);
      const ms = await latencyForRun(ctx, ctx.tenantId, runId);
      if (ms !== null) latencies.push(ms);
    }
    const sorted = [...latencies].sort((a, b) => a - b);

    return {
      eventCount: events.length,
      runCount: new Set(events.map((e) => e.runId)).size,
      citationCoverage: citationCoverage(events),
      unsupportedClaimRate: unsupportedClaimRate(events),
      recommendationAcceptance: recommendationAcceptance(events),
      missingSourceSurprise: missingSourceSurprise(events),
      planDecisions: planDecisions(events),
      completionOutcomes: completionOutcomes(events),
      timeToFirstUsefulOutcome: timeToFirstUsefulOutcome(
        events,
        await onboardingCompletedAt(ctx, ctx.tenantId),
      ),
      followUpRecovery: followUpRecovery(events),
      cost: {
        totalCents: costs.reduce((sum, c) => sum + c, 0),
        runsPriced: costs.length,
        runsJoined: runIds.length,
      },
      latency: {
        runsMeasured: sorted.length,
        medianMs: sorted.length === 0 ? null : (sorted[sorted.length >> 1] ?? null),
        maxMs: sorted.length === 0 ? 0 : (sorted[sorted.length - 1] ?? 0),
      },
    };
  },
});
