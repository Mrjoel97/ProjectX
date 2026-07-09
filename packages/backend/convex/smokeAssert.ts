// Integration assertions for the smoke workflows, runnable via `npx convex run`.
// Each throws on failure so `npx convex run` surfaces a failure banner (the node
// smoke scripts poll these, since workflow completion is asynchronous).
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/** OPSG-04: a failing pipeline produced a deadLetters row + a deadletter.written audit. */
export const assertDeadLetter = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const news = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    const row = news.find((r) => r.correlationId === correlationId);
    if (!row) throw new Error(`no deadLetters row for ${correlationId}`);
    if (!row.error.includes("SMOKE_FAILURE")) {
      throw new Error(`deadLetters error missing SMOKE_FAILURE: ${row.error}`);
    }

    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    if (!audits.some((a) => a.eventType === "deadletter.written")) {
      throw new Error(`no deadletter.written audit event for ${correlationId}`);
    }
    return { ok: true, error: row.error };
  },
});

/** Criterion 4: the review gate took the expected branch (and canceled the timeout). */
export const assertReviewOutcome = internalQuery({
  args: {
    correlationId: v.string(),
    expected: v.union(v.literal("decision"), v.literal("timeout")),
  },
  handler: async (ctx, { correlationId, expected }) => {
    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    const seen = audits.map((a) => a.eventType);
    if (!seen.includes(`smoke.reviewgate.${expected}`)) {
      throw new Error(
        `review outcome for ${correlationId}: expected smoke.reviewgate.${expected}, saw [${seen.join(", ")}]`,
      );
    }

    // Decision path must have canceled + cleared the scheduled timeout.
    if (expected === "decision") {
      const pending = await ctx.db.query("pendingTimeouts").collect();
      if (pending.some((r) => r.correlationId === correlationId)) {
        throw new Error(`pendingTimeouts row for ${correlationId} survived — timeout not canceled`);
      }
    }
    return { ok: true };
  },
});
