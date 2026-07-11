// The Phase-2 spine (02-06): one durable workflow sequencing
//   route → draft → review gate (regenerate loop) → Gmail delivery,
// transitioning requests.status at every observable stage and writing exactly
// one OPSG-01 telemetry row at each terminal (sent | rejected | expired).
//
// A thrown route (unknown_route / route_not_implemented) fails the workflow →
// onComplete (result.kind "failed") → deadLetter.onPipelineComplete, which owns
// the `failed` terminal (status + telemetry). No silent default — AGNT-03.
//
// pipeline.ts is on the raw-builder allowlist (internalMutation, not a tenant
// wrapper — the workflow carries no client identity).
import { workflow } from "./index";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { reviewEventValidator } from "./review";

// The 11-member requests.status union (kept in sync with schema.ts).
export const REQUEST_STATUS = v.union(
  v.literal("submitted"),
  v.literal("routing"),
  v.literal("drafting"),
  v.literal("awaiting_review"),
  v.literal("approved"),
  v.literal("delivering"),
  v.literal("sent"),
  v.literal("rejected"),
  v.literal("expired"),
  v.literal("failed"),
  v.literal("awaiting_reauth"),
);

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
// ponytail: MAX_REGENERATE cap is Phase-7 REVW-02's upgrade path (per-tenant policy).
// Exported so the review UI stops offering "Ask for changes" at the cap — past it, a
// `regenerate` decision falls through the loop to delivery (an unapproved send).
export const MAX_REGENERATE = 3;

/** One accumulated LLM usage (route/draft/regenerate) for the OPSG-01 row. */
type Usage = { inputTokens: number; outputTokens: number; costUsd: number };
// ponytail: costUsd is 0 until GRDL-03 (Phase 3) prices tokens in one place; the AI
// SDK usage carries only token counts today.
const toUsage = (u: { inputTokens?: number; outputTokens?: number }): Usage => ({
  inputTokens: u?.inputTokens ?? 0,
  outputTokens: u?.outputTokens ?? 0,
  costUsd: 0,
});

export const pipelineWorkflow = workflow.define({
  args: { correlationId: v.string(), requestId: v.id("requests"), tenantId: v.string() },
  handler: async (step, { correlationId, requestId, tenantId }): Promise<null> => {
    // Date.now()/Math.random() are patched deterministic inside a workflow handler,
    // so this elapsed measure is stable across replays.
    const startedAt = Date.now();
    const decisionCounts: Record<string, number> = {};
    let regenerateCount = 0;
    const usages: Usage[] = [];

    const setStatusStep = (status: typeof REQUEST_STATUS.type) =>
      step.runMutation(internal.pipeline.setStatus, { requestId, status });
    const audit = (eventType: string) =>
      step.runMutation(internal.audit.log, {
        tenantId,
        correlationId,
        eventType,
        actor: "system",
        payload: { requestId }, // ref only — redaction-safe (CLAUDE.md §4)
      });
    // Write-once terminal telemetry from the accumulated outcome (idempotent by cid).
    const writeTelemetry = (reviewOutcome: "sent" | "rejected" | "expired") =>
      step.runMutation(internal.telemetry.writeTerminal, {
        requestId,
        correlationId,
        outcome: {
          reviewOutcome,
          durationMs: Date.now() - startedAt,
          decisionCounts,
          regenerateCount,
          usages,
        },
      });

    // 1. ROUTE — throws unknown_route (parse fail, inside llm.route) or
    //    route_not_implemented (sub_agent) → onComplete → distinct DLQ reasons (AGNT-03).
    // ponytail: the GRDL-01 redact step (Phase 3) slots in AHEAD of llm.route here.
    await setStatusStep("routing");
    const { routing, usage: routeUsage } = await step.runAction(internal.llm.route, { requestId });
    usages.push(toUsage(routeUsage));
    if (routing.route === "sub_agent") throw new Error("route_not_implemented");
    // Persist the route so the review gate can show it read-only (AGNT-02).
    await step.runMutation(internal.pipeline.saveDraft, { requestId, route: routing.route });

    // 2. DRAFT — direct_llm drafts via the LLM; direct_tool uses the user's verbatim
    //    goal as the draft but STILL gates it (REVW-01 reviews every response).
    await setStatusStep("drafting");
    if (routing.route === "direct_llm") {
      const { body, usage } = await step.runAction(internal.llm.draft, { requestId });
      usages.push(toUsage(usage));
      await step.runMutation(internal.pipeline.saveDraft, { requestId, draft: body });
    } else {
      await step.runMutation(internal.pipeline.useVerbatimDraft, { requestId });
    }

    // 3. REVIEW GATE — arm timeout from inside a step, await the attempt-suffixed union
    //    event; regenerate loops up to the cap (issue #177 workaround lives in review.ts).
    await setStatusStep("awaiting_review");
    let attempt = 0;
    while (true) {
      await step.runMutation(internal.review.armTimeout, {
        workflowId: step.workflowId,
        correlationId,
        timeoutMs: SEVEN_DAYS,
        attempt,
      });
      const evt = await step.awaitEvent({
        name: `review:${correlationId}:${attempt}`,
        validator: reviewEventValidator,
      });

      if (evt.kind === "timeout") {
        await setStatusStep("expired");
        await audit("review.expired");
        await writeTelemetry("expired");
        return null; // NO delivery
      }

      decisionCounts[evt.decision] = (decisionCounts[evt.decision] ?? 0) + 1;

      if (evt.decision === "reject") {
        await step.runMutation(internal.pipeline.saveDraft, { requestId, rejectReason: evt.reason });
        await setStatusStep("rejected");
        await audit("review.rejected");
        await writeTelemetry("rejected");
        return null; // NO delivery
      }

      if (evt.decision === "regenerate" && attempt < MAX_REGENERATE) {
        // ponytail: the regenerate instruction is not yet threaded into llm.draft (its
        // prompt is the goal); Phase 3 wires instruction + redaction into the draft step.
        if (routing.route === "direct_llm") {
          const { body, usage } = await step.runAction(internal.llm.draft, { requestId });
          usages.push(toUsage(usage));
          await step.runMutation(internal.pipeline.saveDraft, { requestId, draft: body });
        }
        regenerateCount++;
        attempt++;
        continue;
      }

      // approve | edit_text (| regenerate past the cap — the UI stops offering it).
      if (evt.decision === "edit_text") {
        await step.runMutation(internal.pipeline.saveDraft, { requestId, editedBody: evt.editedText });
      }
      break;
    }

    // 4. DELIVER — gmail.send owns awaiting_reauth (dead token → returns, no throw); the
    //    workflow ends in that hold state and delivery re-fires on reconnect. Otherwise
    //    the pipeline owns the `sent` transition + its telemetry. A 5xx throws → workflow
    //    retries (workpool default), then onComplete → failed terminal.
    await setStatusStep("delivering");
    const result = await step.runAction(internal.gmail.send, { requestId });
    if (!result.delivered) return null; // hold at awaiting_reauth (already set by gmail.send)

    await setStatusStep("sent");
    await writeTelemetry("sent");
    return null;
  },
});

// Reused by 02-05 (awaiting_reauth) and the spine above (every stage transition).
export const setStatus = internalMutation({
  args: { requestId: v.id("requests"), status: REQUEST_STATUS },
  handler: async (ctx, { requestId, status }) => {
    await ctx.db.patch(requestId, { status });
  },
});

/** Persist the reviewed content plane: the drafted body, an inline edit, or a reject
 *  reason. Raw content lives on `requests` (CLAUDE.md §4), never in audit/DLQ payloads. */
export const saveDraft = internalMutation({
  args: {
    requestId: v.id("requests"),
    route: v.optional(v.string()),
    draft: v.optional(v.string()),
    editedBody: v.optional(v.string()),
    rejectReason: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, route, draft, editedBody, rejectReason }) => {
    const patch: { route?: string; draft?: string; editedBody?: string; rejectReason?: string } = {};
    if (route !== undefined) patch.route = route;
    if (draft !== undefined) patch.draft = draft;
    if (editedBody !== undefined) patch.editedBody = editedBody;
    if (rejectReason !== undefined) patch.rejectReason = rejectReason;
    await ctx.db.patch(requestId, patch);
  },
});

/** direct_tool: the user's goal text IS the draft (skip the LLM, still gate it). */
export const useVerbatimDraft = internalMutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const req = await ctx.db.get(requestId);
    if (!req) throw new Error(`pipeline.useVerbatimDraft: no request ${requestId}`);
    await ctx.db.patch(requestId, { draft: req.goal });
  },
});
