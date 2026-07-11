// awaitEvent-timeout race — the workflow issue #177 workaround.
//
// Workflows cannot touch `ctx.scheduler`, so a review gate arms its timeout from
// INSIDE a step (`step.runMutation(internal.review.armTimeout, ...)`). The gate
// then `awaitEvent`s a correlationId-namespaced union event; either a real
// decision or the scheduled timeout resumes it.
//
// THREE defensive rules (Research Pitfall 5 + the regenerate loop — all, not some):
//   1. cancel the scheduled timeout on a real decision (pendingTimeouts lookup
//      -> ctx.scheduler.cancel) so a stale timeout can never fire into a later gate;
//   2. namespace event names by correlationId AND attempt (`review:${cid}:${attempt}`)
//      so even a leaked event can never be consumed by a different gate — critically,
//      because REVW-01's `regenerate` loops the gate, a late event from attempt N must
//      not be consumed by attempt N+1 (re-introduces issue #177 within one request);
//   3. the decision is the typed REVW-01 union (approve | edit_text | regenerate |
//      reject), not an untyped string.
import type { WorkflowId } from "@convex-dev/workflow";
import { vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./index";

/** The REVW-01 decision union: what the user can do at the gate. */
export const reviewDecisionValidator = v.union(
  v.literal("approve"),
  v.literal("edit_text"),
  v.literal("regenerate"),
  v.literal("reject"),
);

/** The gate's event: a real typed decision OR the scheduled-timeout marker. */
export const reviewEventValidator = v.union(
  v.object({
    kind: v.literal("decision"),
    decision: reviewDecisionValidator,
    // Optional decision payloads (content plane): the inline-edited body,
    // the regenerate instruction, the reject reason. All optional — a bare
    // `approve` carries none.
    editedText: v.optional(v.string()),
    instruction: v.optional(v.string()),
    reason: v.optional(v.string()),
  }),
  v.object({ kind: v.literal("timeout") }),
);

/** Build the attempt-suffixed event name the gate awaits for this iteration. */
const eventName = (correlationId: string, attempt: number) =>
  `review:${correlationId}:${attempt}`;

/** Arm the scheduled timeout and record the bookkeeping row (called from a step). */
export const armTimeout = internalMutation({
  args: {
    workflowId: vWorkflowId,
    correlationId: v.string(),
    timeoutMs: v.number(),
    attempt: v.number(),
  },
  handler: async (ctx, { workflowId, correlationId, timeoutMs, attempt }) => {
    // The scheduler carries `attempt` to fireTimeout, so it targets the right
    // suffix without a schema column on pendingTimeouts.
    const scheduledId = await ctx.scheduler.runAfter(
      timeoutMs,
      internal.review.fireTimeout,
      { workflowId, correlationId, attempt },
    );
    await ctx.db.insert("pendingTimeouts", { workflowId, correlationId, scheduledId });
  },
});

/** The scheduled callback: deliver the timeout variant to the namespaced event. */
export const fireTimeout = internalMutation({
  args: { workflowId: vWorkflowId, correlationId: v.string(), attempt: v.number() },
  handler: async (ctx, { workflowId, correlationId, attempt }) => {
    await workflow.sendEvent(ctx, {
      workflowId: workflowId as WorkflowId,
      name: eventName(correlationId, attempt),
      validator: reviewEventValidator,
      value: { kind: "timeout" },
    });
    // Best-effort cleanup of our bookkeeping (the timeout has now fired).
    const rows = await ctx.db
      .query("pendingTimeouts")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});

/** Send a real decision AND cancel the scheduled timeout (both defensive rules). */
export const sendDecision = internalMutation({
  args: {
    correlationId: v.string(),
    attempt: v.number(),
    decision: reviewDecisionValidator,
    editedText: v.optional(v.string()),
    instruction: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { correlationId, attempt, decision, editedText, instruction, reason }) => {
    // Indexed lookup — unbounded concurrent requests make a full .collect() scan
    // a read-limit risk. Each correlationId has at most one live gate at a time.
    const row = await ctx.db
      .query("pendingTimeouts")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!row) throw new Error(`no pending review gate for ${correlationId}`);

    await workflow.sendEvent(ctx, {
      workflowId: row.workflowId as WorkflowId,
      name: eventName(correlationId, attempt),
      validator: reviewEventValidator,
      value: { kind: "decision", decision, editedText, instruction, reason },
    });
    await ctx.scheduler.cancel(row.scheduledId as Id<"_scheduled_functions">);
    await ctx.db.delete(row._id);
    return { ok: true };
  },
});
