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

import {
  PACK_EVENTS,
  PACK_OUTCOMES,
  type PackMetricEvent,
  REVENUE_CONFIDENCE,
  REVENUE_COUNT_MAX,
  REVENUE_COVERAGE,
  REVENUE_EVENT_KINDS,
  REVENUE_PROVIDERS,
  REVENUE_STATUSES,
  REVENUE_WORKFLOWS,
  WORKFLOW_EVENT_STREAM_IDS,
} from "@pikar/core";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
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
const packIdArg = v.union(...WORKFLOW_EVENT_STREAM_IDS.map((name) => v.literal(name)));
const providerArg = v.union(...REVENUE_PROVIDERS.map((name) => v.literal(name)));
const workflowArg = v.union(...REVENUE_WORKFLOWS.map((name) => v.literal(name)));
const statusArg = v.union(...REVENUE_STATUSES.map((name) => v.literal(name)));
const coverageArg = v.union(...REVENUE_COVERAGE.map((name) => v.literal(name)));
const confidenceArg = v.union(...REVENUE_CONFIDENCE.map((name) => v.literal(name)));

export type WorkflowPackEventInput = Omit<
  Doc<"workflowPackEvents">,
  "_id" | "_creationTime" | "createdAt"
>;

const REVENUE_REF = /^rev:[a-z0-9][a-z0-9:_-]{0,123}$/i;
const CONNECTOR_LIFECYCLE = new Set(["connected", "reauth_required", "revoked", "revoke_partial"]);
const CONNECTOR_READ = new Set(["ready", "partial", "unavailable"]);
const PLAN_DECISION = new Set(["approved", "edited", "rejected"]);
const RECOVERY = new Set(["paid", "resolved"]);

function assertRevenueEvent(args: WorkflowPackEventInput): void {
  if (!REVENUE_EVENT_KINDS.includes(args.event as (typeof REVENUE_EVENT_KINDS)[number]))
    throw new Error("REVENUE_EVENT_KIND");
  if (!REVENUE_REF.test(args.runId)) throw new Error("REVENUE_RUN_REF");
  if (args.subjectRef !== undefined && !REVENUE_REF.test(args.subjectRef))
    throw new Error("REVENUE_SUBJECT_REF");

  for (const value of [
    args.sourceExpectedCount,
    args.sourceAvailableCount,
    args.preflightMissingCount,
    args.runtimeMissingCount,
    args.claimCount,
    args.citedClaimCount,
    args.unsupportedClaimCount,
    args.itemCount,
    args.pageCount,
    args.retryCount,
    args.evidenceCount,
    args.unknownCount,
    args.suppressedCount,
  ]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > REVENUE_COUNT_MAX))
      throw new Error("REVENUE_COUNT_BOUND");
  }
  if (
    args.observedAt !== undefined &&
    (!Number.isSafeInteger(args.observedAt) || args.observedAt < 0)
  )
    throw new Error("REVENUE_OBSERVED_AT");

  if (
    args.event === "connector_lifecycle" &&
    (args.provider === undefined ||
      args.status === undefined ||
      !CONNECTOR_LIFECYCLE.has(args.status))
  )
    throw new Error("REVENUE_LIFECYCLE_FIELDS");
  if (
    args.event === "connector_read" &&
    (args.provider === undefined || args.status === undefined || !CONNECTOR_READ.has(args.status))
  )
    throw new Error("REVENUE_READ_FIELDS");
  if (
    args.event === "workflow_completed" &&
    (args.workflow === undefined || args.outcome === undefined)
  )
    throw new Error("REVENUE_WORKFLOW_FIELDS");
  if (
    args.event === "finance_computed" &&
    (args.workflow === undefined || args.coverage === undefined || args.confidence === undefined)
  )
    throw new Error("REVENUE_FINANCE_FIELDS");
  if (
    args.event === "reminder_staged" &&
    (args.workflow !== "revenue-invoice-reminder" || args.itemCount === undefined)
  )
    throw new Error("REVENUE_REMINDER_FIELDS");
  if (
    args.event === "plan_decided" &&
    (args.status === undefined || !PLAN_DECISION.has(args.status))
  )
    throw new Error("REVENUE_DECISION_FIELDS");
  if (
    args.event === "recovery_observed" &&
    (args.provider === undefined ||
      args.status === undefined ||
      !RECOVERY.has(args.status) ||
      args.subjectRef === undefined ||
      args.observedAt === undefined)
  )
    throw new Error("REVENUE_RECOVERY_FIELDS");
}

/** The sole insert primitive. Revenue terminals and the internal endpoint both reuse it. */
export async function writeWorkflowPackEvent(
  ctx: Pick<MutationCtx, "db">,
  args: WorkflowPackEventInput,
): Promise<Id<"workflowPackEvents">> {
  if (args.packId === "revenue") {
    assertRevenueEvent(args);
    const duplicate = (
      await ctx.db
        .query("workflowPackEvents")
        .withIndex("by_tenant_run", (q) => q.eq("tenantId", args.tenantId).eq("runId", args.runId))
        .take(REVENUE_EVENT_KINDS.length)
    ).find((row) => row.packId === "revenue" && row.event === args.event);
    if (duplicate) return duplicate._id;
  }
  return await ctx.db.insert("workflowPackEvents", { ...args, createdAt: Date.now() });
}

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
    provider: v.optional(providerArg),
    workflow: v.optional(workflowArg),
    status: v.optional(statusArg),
    subjectRef: v.optional(v.string()),
    itemCount: v.optional(v.number()),
    pageCount: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    evidenceCount: v.optional(v.number()),
    unknownCount: v.optional(v.number()),
    suppressedCount: v.optional(v.number()),
    capped: v.optional(v.boolean()),
    partial: v.optional(v.boolean()),
    coverage: v.optional(coverageArg),
    confidence: v.optional(confidenceArg),
    hasGap: v.optional(v.boolean()),
    observedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await writeWorkflowPackEvent(ctx, args);
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
    provider: row.provider ?? null,
    workflow: row.workflow ?? null,
    status: row.status ?? null,
    subjectRef: row.subjectRef ?? null,
    itemCount: row.itemCount ?? null,
    pageCount: row.pageCount ?? null,
    retryCount: row.retryCount ?? null,
    evidenceCount: row.evidenceCount ?? null,
    unknownCount: row.unknownCount ?? null,
    suppressedCount: row.suppressedCount ?? null,
    capped: row.capped ?? null,
    partial: row.partial ?? null,
    coverage: row.coverage ?? null,
    confidence: row.confidence ?? null,
    hasGap: row.hasGap ?? null,
    observedAt: row.observedAt ?? null,
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
