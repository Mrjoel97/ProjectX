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
import { buildTelemetry, notificationMessage } from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
      source: "workflow",
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

    // OPSG-05: a dead-letter surfaces to the USER (in-app + best-effort external), beside the audit
    // above — keyed by the redaction-safe requestId ref + the static §4 label ONLY. This is the ONLY
    // notify on the DLQ path: the external-send failure path lives in notifyExternal and never reaches
    // here (the notify-loop guard). Fired only when a requestId ref is present (synthetic smokes skip it).
    await ctx.runMutation(internal.notifications.notify, {
      tenantId: context.tenantId,
      kind: "deadletter",
      requestId,
      message: notificationMessage("deadletter"),
    });

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

// Per-recipient dead-letter (DLVR-01 / SC5). The fan-out workflow (deliverApprovedPlan)
// catches a recipient whose send throws terminally and calls this to archive JUST that
// row, then continues the loop — isolation. Mirrors onPipelineComplete's three per-request
// writes (deadLetters row + deadletter.written audit + failed status + one failed telemetry
// row), keyed by the recipient's OWN correlationId. Payloads carry the requestId ref ONLY —
// never recipient/subject/body (CLAUDE.md §4).
//
// ponytail: converges with onPipelineComplete's per-request terminal writes; unify the two
// if @convex-dev/workflow ever exposes a per-step completion hook (today onComplete only
// fires for the whole workflow, and per-row isolation needs the loop to continue).
export const deadLetterRecipient = internalMutation({
  args: {
    tenantId: v.string(),
    requestId: v.id("requests"),
    correlationId: v.string(),
    workflowId: v.optional(v.string()),
    error: v.string(),
  },
  handler: async (ctx, { tenantId, requestId, correlationId, workflowId, error }) => {
    await ctx.db.insert("deadLetters", {
      tenantId,
      correlationId,
      // 28.1-05: pass-through, no `?? ""`. The field is optional now, and an empty string was
      // only ever a placeholder for a required column that had no value to put in it.
      workflowId,
      source: "workflow",
      payload: { requestId }, // ref only — redaction-safe (CLAUDE.md §4)
      error,
      status: "new",
      createdAt: Date.now(),
    });

    await ctx.runMutation(internal.audit.log, {
      tenantId,
      correlationId,
      eventType: "deadletter.written",
      actor: "system",
      payload: { requestId, status: "new" }, // refs/flags only
    });

    // OPSG-05: the per-recipient dead-letter also surfaces to the user (in-app + external), beside its
    // audit — requestId ref + static §4 label only. requestId is always present here (a required arg).
    await ctx.runMutation(internal.notifications.notify, {
      tenantId,
      kind: "deadletter",
      requestId,
      message: notificationMessage("deadletter"),
    });

    await ctx.db.patch(requestId, { status: "failed" });

    // Idempotent by correlationId: a replayed catch never doubles the terminal row.
    const existing = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (existing) return;
    const request = await ctx.db.get(requestId);
    if (!request) return;

    const row = buildTelemetry({
      reviewOutcome: "failed",
      durationMs: Date.now() - request._creationTime,
      decisionCounts: {},
      regenerateCount: 0,
      usages: [], // no LLM ran → tokens/cost null → 0
    });
    await ctx.db.insert("telemetry", {
      tenantId: request.tenantId,
      correlationId,
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
