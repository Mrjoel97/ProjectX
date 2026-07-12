// Intake trust boundary (INTK-01, INTK-04).
//
// `submit` is the single door into the pipeline. It validates in pure domain
// logic (validateSubmit) BEFORE the un-testable workflow.start, so the worst
// failure mode — a hallucinated recipient mailing a stranger — is structurally
// impossible: the recipient is the explicit, validated `To:` field, NEVER
// model-derived. On rejection it writes an auditable event + an in-app
// notification and starts NO workflow.
//
// All handlers go through tenantQuery/tenantMutation (CLAUDE.md §2) — tenantId is
// injected from identity and an unauthenticated call fails closed (INTK-04 #1).
import { validateSubmit } from "@pikar/core/validateSubmit";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { rateLimiter } from "./guardrails";
import { contentHash } from "./lib/hash";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { workflow } from "./index";
import { MAX_REGENERATE, REQUEST_STATUS } from "./pipeline";
import { reviewDecisionValidator } from "./review";

/** Upload-first: client PUTs each file to this URL, then submits the storageIds. */
export const generateUploadUrl = tenantMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

const attachmentArg = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
  mimeType: v.string(),
  size: v.number(),
});

/**
 * Validate → (reject: audit + notify, no workflow | accept: create rows + start
 * the pipeline workflow). correlationId is minted server-side — it names the
 * resume event and must never be client-supplied.
 */
export const submit = tenantMutation({
  args: {
    goal: v.string(),
    recipient: v.string(),
    attachments: v.array(attachmentArg),
  },
  handler: async (ctx, { goal, recipient, attachments }) => {
    const correlationId = crypto.randomUUID();
    const result = validateSubmit({ goal, recipient, attachments });

    if (!result.ok) {
      // Redaction-safe payload: reason + counts + a goal hash — NEVER the raw
      // goal/recipient (CLAUDE.md §4). Raw content stays out of the audit log.
      await ctx.runMutation(internal.audit.log, {
        tenantId: ctx.tenantId,
        correlationId,
        eventType: "request.rejected",
        actor: ctx.tenantId,
        payload: {
          reason: result.reason,
          attachmentCount: attachments.length,
          goalHash: await contentHash(goal),
        },
      });
      await ctx.runMutation(internal.notifications.notify, {
        tenantId: ctx.tenantId,
        kind: "request.rejected",
        message: "Request Rejected — Validation Failed",
      });
      return { ok: false as const, reason: result.reason };
    }

    // Content plane: raw goal/recipient live here (CLAUDE.md §4), never in audit.
    const requestId = await ctx.db.insert("requests", {
      tenantId: ctx.tenantId,
      correlationId,
      goal,
      recipient,
      status: "submitted",
      attachmentRefs: [],
      createdAt: Date.now(),
    });

    // Metadata only — the agent sees filename/mime/size, never file contents (INTK-01).
    const attachmentRefs = [];
    for (const a of attachments) {
      attachmentRefs.push(
        await ctx.db.insert("attachments", {
          tenantId: ctx.tenantId,
          requestId,
          storageId: a.storageId,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        }),
      );
    }
    await ctx.db.patch(requestId, { attachmentRefs });

    // requestId in onComplete context.payload (an id — redaction-safe) lets the
    // failure path (02-06's extended deadLetter) write telemetry + patch status="failed".
    const workflowId = await workflow.start(
      ctx,
      internal.pipeline.pipelineWorkflow,
      { correlationId, requestId, tenantId: ctx.tenantId },
      {
        onComplete: internal.deadLetter.onPipelineComplete,
        context: {
          tenantId: ctx.tenantId,
          correlationId,
          payload: { correlationId, requestId },
        },
      },
    );
    await ctx.db.patch(requestId, { workflowId });

    return { ok: true as const, requestId, correlationId };
  },
});

/** The caller's requests, newest-first, optionally filtered by status. */
export const list = tenantQuery({
  args: { status: v.optional(REQUEST_STATUS) },
  handler: async (ctx, { status }) => {
    const rows = status
      ? await ctx.db
          .query("requests")
          .withIndex("by_tenant_status", (q) =>
            q.eq("tenantId", ctx.tenantId).eq("status", status),
          )
          .collect()
      : await ctx.db
          .query("requests")
          .withIndex("by_tenant_status", (q) => q.eq("tenantId", ctx.tenantId))
          .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * The client-facing review gate action (REVW-01). `review.sendDecision` is internal
 * (it resumes a workflow), so the browser never calls it directly (CLAUDE.md §2) — this
 * thin tenantMutation validates the caller owns the correlationId, then delegates.
 *
 * `attempt` is NOT client-supplied: the gate's live pendingTimeouts row carries the
 * authoritative attempt suffix. A client that guessed the attempt (stale after a
 * regenerate) would fire into a dead event name and silently lose the decision.
 */
export const submitDecision = tenantMutation({
  args: {
    correlationId: v.string(),
    decision: reviewDecisionValidator,
    editedText: v.optional(v.string()),
    instruction: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { correlationId, decision, editedText, instruction, reason }) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .unique();
    if (!req || req.tenantId !== ctx.tenantId) throw new Error("request not found");

    const pending = await ctx.db
      .query("pendingTimeouts")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!pending) throw new Error("no live review gate for this request");

    await ctx.runMutation(internal.review.sendDecision, {
      correlationId,
      attempt: pending.attempt ?? 0,
      decision,
      editedText,
      instruction,
      reason,
    });
    return { ok: true as const };
  },
});

/** One request, tenant-scoped (ctx.db.get bypasses scope — the check is load-bearing). */
export const get = tenantQuery({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get(requestId);
    if (!row || row.tenantId !== ctx.tenantId) return null;
    return row;
  },
});

/**
 * The review gate's read model: the request (route/plan/recipient/draft) plus the LIVE
 * regenerate attempt so the UI can hide "Ask for changes" at the cap. Past the cap a
 * `regenerate` decision falls through the workflow loop to delivery (an unapproved send),
 * so `canRegenerate` is a safety gate, not just cosmetics.
 */
export const reviewGate = tenantQuery({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request || request.tenantId !== ctx.tenantId) return null;
    const pending = await ctx.db
      .query("pendingTimeouts")
      .withIndex("by_correlation", (q) => q.eq("correlationId", request.correlationId))
      .first();
    const attempt = pending?.attempt ?? 0;
    return { request, attempt, canRegenerate: attempt < MAX_REGENERATE };
  },
});
