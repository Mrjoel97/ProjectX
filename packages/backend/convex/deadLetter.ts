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
import { buildTelemetry } from "@pikar/core";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
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

    // OPSG-01 failed terminal — the single choke point every workflow failure routes
    // through. A mis-routed request must NOT hang at "routing": set status="failed" and
    // write exactly one `failed` telemetry row. requestId is a redaction-safe id carried
    // in context.payload (plan 02-03). Inline insert = single transaction (no need to
    // hop through telemetry.writeTerminal). Smoke pipelines that pass no requestId
    // (e.g. smoke.ts) skip this branch untouched.
    const requestId = context.payload?.requestId as Id<"requests"> | undefined;
    if (!requestId) return;
    const request = await ctx.db.get(requestId);
    if (!request) return;

    await ctx.db.patch(requestId, { status: "failed" });

    // Idempotent: never a second telemetry row for the same request.
    const existing = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", context.correlationId))
      .first();
    if (existing) return;

    const row = buildTelemetry({
      reviewOutcome: "failed",
      durationMs: Date.now() - request._creationTime,
      decisionCounts: {},
      regenerateCount: 0,
      usages: [], // no LLM usage credited to a failed run → tokens/cost null → 0
    });
    await ctx.db.insert("telemetry", {
      tenantId: request.tenantId,
      correlationId: context.correlationId,
      requestId,
      tokensIn: row.tokensIn ?? 0,
      tokensOut: row.tokensOut ?? 0,
      costUsd: row.costUsd ?? 0,
      durationMs: row.durationMs,
      decisionCounts: row.decisionCounts,
      regenerateCount: row.regenerateCount,
      reviewOutcome: row.reviewOutcome,
      createdAt: Date.now(),
    });
  },
});
