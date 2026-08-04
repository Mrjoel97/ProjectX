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
import { v } from "convex/values";
import { tenantQuery } from "./lib/functions";

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — window shown in the card label

const DECISION_KEYS = ["approve", "edit", "reject", "regenerate"] as const;

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

    const decisionCounts: Record<string, number> = {
      approve: 0,
      edit: 0,
      reject: 0,
      regenerate: 0,
    };
    const reviewOutcomes: Record<string, number> = {};
    let regenerateTotal = 0;
    let totalCostUsd = 0;
    let deliveredCount = 0;
    for (const row of telemetryRows) {
      const dc = (row.decisionCounts ?? {}) as Record<string, unknown>;
      for (const key of DECISION_KEYS) {
        const n = dc[key];
        if (typeof n === "number") decisionCounts[key] = (decisionCounts[key] ?? 0) + n;
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
