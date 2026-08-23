// Append-only recorder for the `workflowPackEvents` table (Phase 27, PACK-04).
//
// This is the SOLE write surface for that table. It exposes ONE insert and no patch, replace or
// delete — the `audit.ts` posture, and not a stylistic one: 27-02 classified `workflowPackEvents`
// `audit_immutable` in `packages/core/src/tenantData.ts`, which takes the table out of the tenant
// deletion and export walks. That classification is a CLAIM ABOUT IMMUTABILITY, and this module is
// where it is either true or a lie.
//
// REFS, IDS, ENUMS AND COUNTS ONLY (CLAUDE.md §4). Enforcement is structural rather than reviewed:
// the table's validator has nowhere to put a prompt, an output, an excerpt, a URL, a subject line,
// a customer name or a financial value, and Convex refuses an argument object carrying a key the
// validator does not declare. `workflowPackEventLog.test.ts` proves that refusal rather than
// asserting the convention.
//
// NO COST AND NO LATENCY EVENT KINDS. `spendEvents` owns cost (rail `reasoning`, index
// `by_correlation`) and `telemetry.durationMs` / `agentSteps` own latency; both are joined by
// `correlationId`. See `PACK_DERIVED_METRIC_SOURCES` in `@pikar/core`.
//
// THE EMISSION GATE IS NOT HERE. 27-07 lands the call sites that make real pack runs write these
// rows; this plan proves the plane exists and is privacy-bounded.

import { PACK_EVENTS, PACK_OUTCOMES, type PackMetricEvent } from "@pikar/core";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

/** Bounded page size for the read model. A metric never needs an unbounded scan. */
export const PACK_EVENT_PAGE_MAX = 500;

/**
 * The closed argument surface. Each validator is the SAME closed union the table declares, restated
 * here so a bad `event` or `outcome` is refused at the function boundary rather than at the insert —
 * a boundary refusal names the argument, an insert refusal names the table.
 */
const eventArg = v.union(...PACK_EVENTS.map((name) => v.literal(name)));
const outcomeArg = v.union(...PACK_OUTCOMES.map((name) => v.literal(name)));
const packIdArg = v.union(
  v.literal("business-pulse"),
  v.literal("campaign-plan"),
  v.literal("customer-complaint"),
  v.literal("sales-call-prep"),
  v.literal("process-sop"),
  v.literal("brand-review"),
);

/**
 * Record one pack event. INSERT ONLY — there is no update path in this module, deliberately.
 *
 * `tenantId` is an argument rather than wrapper-derived because the emitters are ACTIONS (the agent
 * loop) reaching this through `ctx.runMutation`, which carries no browser identity — the `audit.log`
 * shape exactly. The tenant-derived surface is `forTenant` below, and that is the one a client can
 * reach.
 */
export const record = internalMutation({
  args: {
    tenantId: v.string(),
    packId: packIdArg,
    runId: v.string(),
    event: eventArg,
    skillVersion: v.optional(v.number()),
    outcome: v.optional(outcomeArg),
    recommendationId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    planId: v.optional(v.id("plans")),
    artifactId: v.optional(v.id("vaultDocuments")),
    sourceExpectedCount: v.optional(v.number()),
    sourceAvailableCount: v.optional(v.number()),
    preflightMissingCount: v.optional(v.number()),
    runtimeMissingCount: v.optional(v.number()),
    claimCount: v.optional(v.number()),
    citedClaimCount: v.optional(v.number()),
    unsupportedClaimCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("workflowPackEvents", { ...args, createdAt: Date.now() });
  },
});

/** Normalise a stored row into the ONE shape `@pikar/core`'s metrics read. */
export function toMetricEvent(row: Doc<"workflowPackEvents">): PackMetricEvent {
  return {
    event: row.event,
    packId: row.packId,
    runId: row.runId,
    createdAt: row.createdAt,
    // `?? null` at the boundary, once: the metric type uses `| null` rather than `?` so a reducer
    // cannot silently treat "not recorded" and "recorded as zero" as the same thing.
    outcome: row.outcome ?? null,
    recommendationId: row.recommendationId ?? null,
    sourceExpectedCount: row.sourceExpectedCount ?? null,
    sourceAvailableCount: row.sourceAvailableCount ?? null,
    preflightMissingCount: row.preflightMissingCount ?? null,
    runtimeMissingCount: row.runtimeMissingCount ?? null,
    claimCount: row.claimCount ?? null,
    citedClaimCount: row.citedClaimCount ?? null,
    unsupportedClaimCount: row.unsupportedClaimCount ?? null,
  };
}

/**
 * The tenant-scoped read model. `tenantQuery` derives `tenantId` from the caller's identity
 * (CLAUDE.md §2) — it is never an argument, so no caller can ask for another tenant's events.
 *
 * Returns the METRIC shape, not raw rows: nothing this query returns can carry a field the pure
 * metric type does not declare.
 */
export const forTenant = tenantQuery({
  args: { packId: v.optional(packIdArg), limit: v.optional(v.number()) },
  handler: async (ctx, { packId, limit }): Promise<PackMetricEvent[]> => {
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
    return rows.map(toMetricEvent);
  },
});
