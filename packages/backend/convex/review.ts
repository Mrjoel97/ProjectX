// awaitEvent-timeout race — the workflow issue #177 workaround.
//
// Workflows cannot touch `ctx.scheduler`, so a review gate arms its timeout from
// INSIDE a step (`step.runMutation(internal.review.armTimeout, ...)`). The gate
// then `awaitEvent`s a correlationId-namespaced union event; either a real
// decision or the scheduled timeout resumes it.
//
// TWO defensive rules (Research Pitfall 5 — both, not either):
//   1. cancel the scheduled timeout on a real decision (pendingTimeouts lookup
//      -> ctx.scheduler.cancel) so a stale timeout can never fire into a later gate;
//   2. namespace event names by correlationId (`review:${correlationId}`) so even
//      a leaked event can never be consumed by a different gate.
import type { WorkflowId } from "@convex-dev/workflow";
import { vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./index";

/** The gate's event: a real decision OR the scheduled-timeout marker. */
export const reviewEventValidator = v.union(
  v.object({ kind: v.literal("decision"), decision: v.string() }),
  v.object({ kind: v.literal("timeout") }),
);

/** Arm the scheduled timeout and record the bookkeeping row (called from a step). */
export const armTimeout = internalMutation({
  args: { workflowId: vWorkflowId, correlationId: v.string(), timeoutMs: v.number() },
  handler: async (ctx, { workflowId, correlationId, timeoutMs }) => {
    const scheduledId = await ctx.scheduler.runAfter(
      timeoutMs,
      internal.review.fireTimeout,
      { workflowId, correlationId },
    );
    await ctx.db.insert("pendingTimeouts", { workflowId, correlationId, scheduledId });
  },
});

/** The scheduled callback: deliver the timeout variant to the namespaced event. */
export const fireTimeout = internalMutation({
  args: { workflowId: vWorkflowId, correlationId: v.string() },
  handler: async (ctx, { workflowId, correlationId }) => {
    await workflow.sendEvent(ctx, {
      workflowId: workflowId as WorkflowId,
      name: `review:${correlationId}`,
      validator: reviewEventValidator,
      value: { kind: "timeout" },
    });
    // Best-effort cleanup of our bookkeeping (the timeout has now fired).
    const rows = await ctx.db
      .query("pendingTimeouts")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .collect();
    for (const r of rows) {
      if (r.correlationId === correlationId) await ctx.db.delete(r._id);
    }
  },
});

/** Send a real decision AND cancel the scheduled timeout (both defensive rules). */
export const sendDecision = internalMutation({
  args: { correlationId: v.string(), decision: v.string() },
  handler: async (ctx, { correlationId, decision }) => {
    // Small dev/smoke table — a scan keyed on correlationId is fine (ponytail:
    // full scan, add a by_correlation index if this table ever grows).
    const rows = await ctx.db.query("pendingTimeouts").collect();
    const row = rows.find((r) => r.correlationId === correlationId);
    if (!row) throw new Error(`no pending review gate for ${correlationId}`);

    await workflow.sendEvent(ctx, {
      workflowId: row.workflowId as WorkflowId,
      name: `review:${correlationId}`,
      validator: reviewEventValidator,
      value: { kind: "decision", decision },
    });
    await ctx.scheduler.cancel(row.scheduledId as Id<"_scheduled_functions">);
    await ctx.db.delete(row._id);
    return { ok: true };
  },
});
