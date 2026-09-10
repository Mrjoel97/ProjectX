// Vertical outcomes share the insert-only audit plane. No bodies, free-text refs or second ledger.
import { VERTICAL_IDS, verticalSkillName } from "@pikar/core/verticalPacks";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

const EVENTS = [
  "recommendation_shown",
  "recommendation_accepted",
  "artifact_created",
  "run_completed",
  "repeat_use",
  "review_approved",
  "review_edited",
  "review_rejected",
  "blocked",
  "rollback",
] as const;
export const VERTICAL_EVENT_TYPE = "vertical_pack.outcome";
export const VERTICAL_EVENT_LIMIT = 200;

export const record = internalMutation({
  args: {
    tenantId: v.string(),
    verticalId: v.union(...VERTICAL_IDS.map((id) => v.literal(id))),
    candidateId: v.union(v.id("tenantSkills"), v.id("skills")),
    event: v.union(...EVENTS.map((event) => v.literal(event))),
    preview: v.optional(v.boolean()),
    artifactId: v.optional(v.id("vaultDocuments")),
    claimCount: v.optional(v.number()),
    citedClaimCount: v.optional(v.number()),
    unsupportedClaimCount: v.optional(v.number()),
    outcome: v.optional(
      v.union(v.literal("useful"), v.literal("partial"), v.literal("blocked"), v.literal("failed")),
    ),
    reason: v.optional(
      v.union(
        v.literal("disabled"),
        v.literal("missing_source"),
        v.literal("review_required"),
        v.literal("not_released"),
      ),
    ),
    costBucket: v.optional(
      v.union(
        v.literal("zero"),
        v.literal("under_one_dollar"),
        v.literal("one_to_five_dollars"),
        v.literal("over_five_dollars"),
      ),
    ),
    latencyBucket: v.optional(
      v.union(
        v.literal("under_minute"),
        v.literal("one_to_five_minutes"),
        v.literal("over_five_minutes"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.candidateId);
    if (
      !row ||
      ("tenantId" in row && row.tenantId !== args.tenantId) ||
      row.name !== verticalSkillName(args.verticalId)
    )
      throw new Error("NOT_FOUND");
    for (const count of [args.claimCount, args.citedClaimCount, args.unsupportedClaimCount]) {
      if (count !== undefined && (!Number.isSafeInteger(count) || count < 0 || count > 100_000))
        throw new Error("COUNT_BOUND");
    }
    if ((args.citedClaimCount ?? 0) + (args.unsupportedClaimCount ?? 0) > (args.claimCount ?? 0))
      throw new Error("CLAIM_COUNT_MISMATCH");
    if (args.artifactId !== undefined) {
      const artifact = await ctx.db.get(args.artifactId);
      if (!artifact || artifact.tenantId !== args.tenantId) throw new Error("NOT_FOUND");
    }
    if (
      (args.event === "artifact_created" || args.event === "repeat_use") &&
      args.artifactId === undefined
    )
      throw new Error("ARTIFACT_REQUIRED");
    const { tenantId, ...payload } = args;
    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId: String(args.candidateId),
      eventType: VERTICAL_EVENT_TYPE,
      actor: "system",
      payload,
    });
  },
});

export async function verticalEventsFor(ctx: QueryCtx, tenantId: string) {
  const rows = await ctx.db
    .query("audit")
    .withIndex("by_tenant_event_ts", (q) =>
      q.eq("tenantId", tenantId).eq("eventType", VERTICAL_EVENT_TYPE),
    )
    .order("desc")
    .take(VERTICAL_EVENT_LIMIT + 1);
  return { rows: rows.slice(0, VERTICAL_EVENT_LIMIT), partial: rows.length > VERTICAL_EVENT_LIMIT };
}

export const summary = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const { rows, partial } = await verticalEventsFor(ctx, ctx.tenantId);
    return {
      partial,
      sampledEvents: rows.length,
      counts: Object.fromEntries(
        EVENTS.map((event) => [event, rows.filter((row) => row.payload?.event === event).length]),
      ),
    };
  },
});
