// EVAL-02 read side: production eval signals computed from EXISTING
// telemetry/audit/deadLetters rows. READ-ONLY by design — this module contains
// no db.insert/patch/replace/delete and must stay that way (locked decision:
// no new write paths). Reads live in a NEW module, not audit.ts, so the
// insert-only audit module stays visibly insert-only (CLAUDE.md §3).
//
// Honesty caveats (RESEARCH Pattern 6 — what the rows ACTUALLY contain):
// - Cockpit send rows carry `costUsd: 0`, `decisionCounts: {}` and
//   `regenerateCount: 0` — the cockpit's reasoning spend goes to the rate
//   limiter, not telemetry, and gate decisions exist only on the legacy
//   pipeline lane.
// - `decisionCounts` sums are therefore PIPELINE-ONLY; the `reviewOutcome`
//   distribution covers BOTH lanes and is the approve-proxy for cockpit sends.
// - `costPerDeliveredUsd` is pipeline LLM cost per delivered send.
// The ops card labels each metric against these realities (Pitfall 6).
import { type PackMetricEvent, projectRevenueSignals } from "@pikar/core";
import { v } from "convex/values";
import { tenantQuery } from "./lib/functions";
import { REVIEW_DECISIONS } from "./review";
import { PACK_EVENT_PAGE_MAX, toMetricEvent } from "./workflowPackEventLog";
import { costForRun, latencyForRun, PACK_RUN_JOIN_MAX } from "./workflowPackOutcomes";

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — window shown in the card label

// CORRECTED 26-14, AT THE ROOT. This list was hand-typed as ["approve", "edit", "reject",
// "regenerate"] and "edit" IS WRITTEN BY NOTHING: `review.ts`'s `reviewDecisionValidator` says
// "edit_text", and `pipeline.ts` writes `decisionCounts[evt.decision]` verbatim. Because the fold
// below only sums keys present in THIS list, the card rendered a permanent `edit: 0` as truth AND
// silently discarded every real edit-with-changes decision.
//
// DERIVED, not re-typed. Correcting one hand-typed copy into another hand-typed copy leaves the
// same drift one edit away — a fifth literal in the validator would repeat the defect verbatim.
const DECISION_KEYS = REVIEW_DECISIONS;

/**
 * Tenant-scoped, time-windowed eval signals. Returns counts/rates ONLY —
 * refs-only by construction (CLAUDE.md §4): every field is a number or a
 * record of numbers; no draft/subject/body/recipient strings ever leave.
 */
export const evalSignals = tenantQuery({
  args: { sinceMs: v.optional(v.number()) },
  handler: async (ctx, { sinceMs }) => {
    const since = sinceMs ?? Date.now() - DEFAULT_WINDOW_MS;

    // Telemetry: one row per terminal request — bounded by per-tenant request
    // count at beta scale; windowed via the compound index.
    const telemetryRows = await ctx.db
      .query("telemetry")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", ctx.tenantId).gte("createdAt", since))
      .collect();

    // Zero-initialised from the SAME closed list the fold reads, so the card can never show a
    // key nothing writes (it showed `edit: 0` for months) or omit one that does.
    const decisionCounts: Record<string, number> = Object.fromEntries(
      DECISION_KEYS.map((key) => [key, 0]),
    );
    const reviewOutcomes: Record<string, number> = {};
    // A decision literal this build does not know about still MOVED a number, so it is named
    // rather than dropped. Dropping is what made the `edit` defect invisible for months: the card
    // under-reported its own total and nothing in the payload said so.
    let otherDecisions = 0;
    let regenerateTotal = 0;
    let totalCostUsd = 0;
    let deliveredCount = 0;
    for (const row of telemetryRows) {
      const dc = (row.decisionCounts ?? {}) as Record<string, unknown>;
      for (const [key, n] of Object.entries(dc)) {
        if (typeof n !== "number") continue;
        if (DECISION_KEYS.includes(key)) decisionCounts[key] = (decisionCounts[key] ?? 0) + n;
        else otherDecisions += n;
      }
      regenerateTotal += row.regenerateCount;
      totalCostUsd += row.costUsd;
      reviewOutcomes[row.reviewOutcome] = (reviewOutcomes[row.reviewOutcome] ?? 0) + 1;
      if (row.reviewOutcome === "sent") deliveredCount += 1;
    }
    const requestCount = telemetryRows.length;

    // Audit: WINDOWED read via by_tenant_ts, then filter eventType in memory.
    // NEVER an un-windowed audit collect — the table is unbounded, and the
    // auditCounts aggregate counts all events (not per-type) so it can't serve this.
    const auditRows = await ctx.db
      .query("audit")
      .withIndex("by_tenant_ts", (q) => q.eq("tenantId", ctx.tenantId).gte("ts", since))
      .collect();
    const fallbackCount = auditRows.filter((r) => r.eventType === "llm.fallback").length;

    // Dead letters: bounded table — tenant-prefix read, windowed in memory.
    const dlqRows = (
      await ctx.db
        .query("deadLetters")
        .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
        .collect()
    ).filter((r) => r.createdAt >= since);
    const dlqTotal = dlqRows.length;
    const dlqNew = dlqRows.filter((r) => r.status === "new").length;

    return {
      windowStartMs: since,
      requestCount,
      decisionCounts,
      otherDecisions,
      reviewOutcomes,
      regenerateTotal,
      fallbackCount,
      dlqNew,
      dlqTotal,
      totalCostUsd,
      deliveredCount,
      // 0 when nothing delivered — never NaN.
      costPerDeliveredUsd: deliveredCount > 0 ? totalCostUsd / deliveredCount : 0,
    };
  },
});

export const REVENUE_SIGNAL_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
export const REVENUE_SIGNAL_MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;

/**
 * Phase 28's bounded tenant projection over the shared immutable event plane. No source content is
 * reconstructed. Cost and latency are joined from their canonical owners by revenue workflow run.
 */
export const revenueSignals = tenantQuery({
  args: { sinceMs: v.optional(v.number()), untilMs: v.optional(v.number()) },
  handler: async (ctx, { sinceMs, untilMs }) => {
    const until = untilMs ?? Date.now();
    const requestedSince = sinceMs ?? until - REVENUE_SIGNAL_DEFAULT_WINDOW_MS;
    if (
      !Number.isSafeInteger(until) ||
      !Number.isSafeInteger(requestedSince) ||
      requestedSince > until
    )
      throw new Error("INVALID_REVENUE_SIGNAL_WINDOW");
    const retentionSince = until - REVENUE_SIGNAL_MAX_WINDOW_MS;
    const since = Math.max(requestedSince, retentionSince);
    const reasons: Array<"retention_boundary" | "event_cap" | "join_cap"> = [];
    if (since !== requestedSince) reasons.push("retention_boundary");

    const fetched = await ctx.db
      .query("workflowPackEvents")
      .withIndex("by_tenant_pack_createdAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("packId", "revenue").gte("createdAt", since),
      )
      .order("asc")
      .take(PACK_EVENT_PAGE_MAX + 1);
    const inWindow = fetched.filter((row) => row.createdAt <= until);
    if (inWindow.length > PACK_EVENT_PAGE_MAX) reasons.push("event_cap");
    const events: PackMetricEvent[] = inWindow.slice(0, PACK_EVENT_PAGE_MAX).map(toMetricEvent);
    const projected = projectRevenueSignals(events);

    const workflowRunIds = [
      ...new Set(
        events.filter((event) => event.event === "workflow_completed").map((event) => event.runId),
      ),
    ];
    if (workflowRunIds.length > PACK_RUN_JOIN_MAX) reasons.push("join_cap");
    const joinedRunIds = workflowRunIds.slice(0, PACK_RUN_JOIN_MAX);
    const costs: number[] = [];
    const latencies: number[] = [];
    for (const runId of joinedRunIds) {
      const cost = await costForRun(ctx, ctx.tenantId, runId);
      if (cost !== null) costs.push(cost);
      const latency = await latencyForRun(ctx, ctx.tenantId, runId);
      if (latency !== null) latencies.push(latency);
    }
    latencies.sort((a, b) => a - b);

    return {
      window: {
        requestedSinceMs: requestedSince,
        sinceMs: since,
        untilMs: until,
        eventCount: events.length,
        complete: reasons.length === 0,
        reasons,
      },
      ...projected,
      workflowCost: {
        totalCents: costs.reduce((sum, cost) => sum + cost, 0),
        runsPriced: costs.length,
        runsJoined: joinedRunIds.length,
      },
      workflowLatency: {
        runsMeasured: latencies.length,
        medianMs: latencies.length === 0 ? null : (latencies[latencies.length >> 1] ?? null),
        maxMs: latencies.length === 0 ? null : (latencies[latencies.length - 1] ?? null),
        runsJoined: joinedRunIds.length,
      },
    };
  },
});
