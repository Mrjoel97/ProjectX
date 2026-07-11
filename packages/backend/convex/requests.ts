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
import { tenantMutation, tenantQuery } from "./lib/functions";
import { workflow } from "./index";
import { REQUEST_STATUS } from "./pipeline";

/** SHA-256 hex — a redaction-safe fingerprint of the goal for the audit payload. */
async function contentHash(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

/** One request, tenant-scoped (ctx.db.get bypasses scope — the check is load-bearing). */
export const get = tenantQuery({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const row = await ctx.db.get(requestId);
    if (!row || row.tenantId !== ctx.tenantId) return null;
    return row;
  },
});
