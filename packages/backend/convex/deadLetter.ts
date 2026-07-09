// Dead-letter via workflow `onComplete` (OPSG-04).
//
// A workflow started with `{ onComplete: internal.deadLetter.onPipelineComplete,
// context }` routes here when it finishes. On a failed/canceled run we archive a
// `deadLetters` row (payload + error + correlationId) and append a
// `deadletter.written` audit event — reusing the SOLE insert-only audit surface.
//
// `context.payload` and the audit payload are REDACTION-SAFE (refs/ids/counts
// only — CLAUDE.md #4). Callers pass synthetic/ref data, never raw user content.
import { vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const onPipelineComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({
      tenantId: v.string(),
      correlationId: v.string(),
      payload: v.any(),
    }),
  },
  handler: async (ctx, { workflowId, result, context }) => {
    // Success needs no dead-letter. Only failed/canceled runs are archived.
    if (result.kind === "success") return;

    const error = result.kind === "failed" ? String(result.error) : "canceled";
    await ctx.db.insert("deadLetters", {
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      workflowId,
      payload: context.payload, // redaction-safe: refs/synthetic only
      error,
      status: "new",
      createdAt: Date.now(),
    });

    // Refs/ids/flags only — no raw error content in the audit payload.
    await ctx.runMutation(internal.audit.log, {
      tenantId: context.tenantId,
      correlationId: context.correlationId,
      eventType: "deadletter.written",
      actor: "system",
      payload: { workflowId: String(workflowId), kind: result.kind, status: "new" },
    });
  },
});
