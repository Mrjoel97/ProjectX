// The governed spine (02-06 + 03-04): one durable workflow sequencing
//   guard (scan→kill-switch→budget) → route → draft → review gate (regenerate loop)
//   → Gmail delivery,
// transitioning requests.status at every observable stage and writing exactly one
// OPSG-01 telemetry row at each terminal (sent | rejected | expired | blocked).
//
// GRDL-01/03: `guardrails.prepare` runs BEFORE any model step. A guard rejection
// (prepare OR a mid-flight preCall stop surfaced by the llm wrappers) ends in the
// governed `blocked` terminal — status + guardrail.blocked audit + notification +
// blocked telemetry — never a silent proceed and never a DLQ throw.
//
// A thrown route (unknown_route, from a parse fail inside llm.route) still fails the
// workflow → onComplete (result.kind "failed") → deadLetter.onPipelineComplete, which
// owns the `failed` terminal (status + telemetry). No silent default — AGNT-03.
//
// LLM steps run with { retry: false }: the retry budget lives in ONE layer (SDK
// maxRetries:1 + one CHEAP_MODEL fallback inside the action), killing the
// 12-calls-per-draft multiplication trap. Delivery keeps the workpool default.
//
// pipeline.ts is on the raw-builder allowlist (internalMutation, not a tenant
// wrapper — the workflow carries no client identity).

import { classifyReviewDecision, notificationMessage } from "@pikar/core";
import { priceUsage } from "@pikar/cost";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { workflow } from "./index";
import { reviewEventValidator } from "./review";

// The 13-member requests.status union (kept in sync with schema.ts).
export const REQUEST_STATUS = v.union(
  v.literal("submitted"),
  v.literal("routing"),
  v.literal("scanning"),
  v.literal("drafting"),
  v.literal("awaiting_review"),
  v.literal("approved"),
  v.literal("delivering"),
  v.literal("sent"),
  v.literal("rejected"),
  v.literal("blocked"),
  v.literal("expired"),
  // REVW-02 fail-closed terminal: a regenerate past MAX_REGENERATE, escalated not sent.
  v.literal("escalated"),
  v.literal("failed"),
  v.literal("awaiting_reauth"),
);

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// REVW-02: the regenerate cap is now @pikar/core's single source of truth —
// classifyReviewDecision enforces it in the gate below (fail closed at the cap: escalate,
// never deliver). Re-exported so requests.ts's `canRegenerate` hint and the review UI read
// the SAME value the gate enforces (07-01 consolidation, CLAUDE.md §8 root-cause).
export { MAX_REGENERATE } from "@pikar/core";

/** One accumulated LLM usage (route/draft/regenerate) for the OPSG-01 row. */
type Usage = { inputTokens: number; outputTokens: number; costUsd: number };
// GRDL-03: real costUsd from priceUsage of the actual SDK usage; 0 on a cache hit
// (GRDL-04 — a hit spent nothing).
const toUsage = (
  u: { inputTokens?: number; outputTokens?: number } | undefined,
  model: string,
  cacheHit: boolean,
): Usage => {
  const priced = priceUsage(model, u ?? {});
  // ponytail: model ids come from our own PRICING keys, so Err is unreachable; coalesce 0
  // over throwing in a replayed handler.
  return {
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    costUsd: cacheHit ? 0 : priced.ok ? priced.value : 0,
  };
};

/** The prepare/preCall governed-stop reasons → operator-facing labels (INTK-04 mirror). */
type BlockReason =
  | "kill_switch"
  | "pii_scan_failed"
  | "cost_estimate_failed"
  | "over_budget"
  | "daily_budget_exhausted"
  | "deployment_budget_exhausted";
const LABELS: Record<BlockReason, string> = {
  kill_switch: "cost kill-switch is on",
  pii_scan_failed: "PII scan failed",
  cost_estimate_failed: "over budget",
  over_budget: "over budget",
  daily_budget_exhausted: "daily budget exhausted",
  deployment_budget_exhausted: "service-wide daily budget exhausted",
};

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
    const writeTelemetry = (
      reviewOutcome: "sent" | "rejected" | "expired" | "blocked" | "escalated",
    ) =>
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

    // The ONE governed blocked terminal — prepare AND every mid-flight preCall stop end here
    // (status + guardrail.blocked audit + notify + blocked telemetry). A governed stop, NOT a throw.
    const stopBlocked = async (reason: BlockReason) => {
      await setStatusStep("blocked");
      await step.runMutation(internal.audit.log, {
        tenantId,
        correlationId,
        eventType: "guardrail.blocked",
        actor: "system",
        payload: { requestId, reason }, // refs + reason only (CLAUDE.md §4)
      });
      await step.runMutation(internal.notifications.notify, {
        tenantId,
        kind: "guardrail.blocked",
        requestId,
        message: `Request stopped — ${LABELS[reason]}`,
      });
      await writeTelemetry("blocked");
    };

    // The ONE governed escalated terminal — a regenerate past MAX_REGENERATE fails closed here
    // (status + review.escalated audit + retry.limit notify + escalated telemetry, NO send).
    // Mirrors stopBlocked: one governed terminal, never a throw and never a fall-through to DELIVER.
    const escalate = async () => {
      await setStatusStep("escalated");
      await audit("review.escalated");
      await step.runMutation(internal.notifications.notify, {
        tenantId,
        kind: "retry.limit",
        requestId,
        message: notificationMessage("retry.limit"), // static §4 label, refs only
      });
      await writeTelemetry("escalated");
    };

    // 0. GUARD — scan → kill-switch → budget/model, BEFORE any model call (GRDL-01/03).
    await setStatusStep("scanning");
    const guard = await step.runMutation(internal.guardrails.prepare, { requestId });
    if (!guard.ok) {
      await stopBlocked(guard.reason);
      return null; // governed stop, NOT a throw
    }
    const { model, safeTextHash, piiCounts } = guard;
    await step.runMutation(internal.audit.log, {
      tenantId,
      correlationId,
      eventType: "request.redacted",
      actor: "system",
      payload: { requestId, piiCounts, safeTextHash }, // counts + hash only
    });

    // Consume a real model call's spend + emit the SC-4 cache-hit observable. Hits spent
    // nothing, so recordSpend (zero-skip) leaves the budget untouched.
    const recordLlm = async (
      usage: { inputTokens?: number; outputTokens?: number } | undefined,
      cacheHit: boolean,
      stage: "route" | "draft",
    ) => {
      const u = toUsage(usage, model, cacheHit);
      usages.push(u);
      await step.runMutation(internal.guardrails.recordSpend, { tenantId, costUsd: u.costUsd });
      if (cacheHit) {
        await step.runMutation(internal.audit.log, {
          tenantId,
          correlationId,
          eventType: "llm.cache_hit",
          actor: "system",
          payload: { requestId, safeTextHash, model, stage },
        });
      }
    };

    // 1. ROUTE — retry:false; a mid-flight preCall stop returns `blocked` → SAME governed
    //    terminal (never the DLQ). unknown_route still THROWS inside the wrapper → DLQ (AGNT-03).
    await setStatusStep("routing");
    const routeRes = await step.runAction(
      internal.llm.route,
      { tenantId, requestId, safeTextHash, model },
      { retry: false },
    );
    if (routeRes.blocked) {
      await stopBlocked(routeRes.blocked);
      return null;
    }
    const { routing, usage: routeUsage, cacheHit: routeCacheHit } = routeRes;
    await recordLlm(routeUsage, routeCacheHit, "route");
    // direct_llm and sub_agent both produce their draft via the LLM (sub_agent is the
    // email specialist — same draft → review → send spine in this thin slice); direct_tool
    // uses the user's goal verbatim. Every route still passes through the review gate.
    const draftsViaLLM = routing.route === "direct_llm" || routing.route === "sub_agent";
    // Persist the route so the review gate can show it read-only (AGNT-02).
    await step.runMutation(internal.pipeline.saveDraft, { requestId, route: routing.route });

    // 2. DRAFT — direct_llm & sub_agent draft via the LLM; direct_tool uses the user's
    //    verbatim goal as the draft but STILL gates it (REVW-01 reviews every response).
    await setStatusStep("drafting");
    if (draftsViaLLM) {
      const res = await step.runAction(
        internal.llm.draft,
        { tenantId, requestId, safeTextHash, model },
        { retry: false },
      );
      if (res.blocked) {
        await stopBlocked(res.blocked);
        return null;
      }
      await recordLlm(res.usage, res.cacheHit, "draft");
      await step.runMutation(internal.pipeline.saveDraft, { requestId, draft: res.body });
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
        // REVW-03: notify the human that their review lapsed (was audit+telemetry only).
        // Mirrors stopBlocked's ordering; static §4 label, refs only — no content.
        await step.runMutation(internal.notifications.notify, {
          tenantId,
          kind: "review.expired",
          requestId,
          message: notificationMessage("review.expired"),
        });
        await writeTelemetry("expired");
        return null; // NO delivery
      }

      decisionCounts[evt.decision] = (decisionCounts[evt.decision] ?? 0) + 1;

      // REVW-02 (fail closed): route EVERY gate decision through @pikar/core's shared
      // classifier — the SAME one the cockpit gate uses (07-04) — so the regenerate cap is
      // enforced at the workflow boundary, never by the UI hiding a button. A past-cap
      // regenerate returns "escalate" and can no longer reach the DELIVER `break`.
      // Note: edit_text/reject are single-shot terminals per the classifier (proceed/terminate),
      // so their decisionCounts can't exceed 1 — the one enforced threshold is the regenerate
      // cap (REVW-02 scope honesty).
      const decisionAction = classifyReviewDecision({ decision: evt.decision, regenerateCount });

      if (decisionAction.action === "terminate") {
        // reject → rejected terminal (unchanged).
        await step.runMutation(internal.pipeline.saveDraft, {
          requestId,
          rejectReason: evt.reason,
        });
        await setStatusStep("rejected");
        await audit("review.rejected");
        await writeTelemetry("rejected");
        return null; // NO delivery
      }

      if (decisionAction.action === "escalate") {
        // THE BUG FIX: a regenerate past MAX_REGENERATE fails closed to the human here —
        // audit + notify + telemetry, NO send. It can no longer fall through to DELIVER.
        await escalate();
        return null; // NO delivery
      }

      if (decisionAction.action === "regenerate") {
        if (draftsViaLLM) {
          // force:true so an identical-args fetch cannot hand back the byte-identical draft
          // the user just asked to change (Pitfall 2); instruction is threaded + redacted +
          // hashed into the cache key inside the wrapper. A mid-flight budget drain here is
          // exactly the preCall path → SAME blocked terminal.
          const res = await step.runAction(
            internal.llm.draft,
            { tenantId, requestId, safeTextHash, model, instruction: evt.instruction, force: true },
            { retry: false },
          );
          if (res.blocked) {
            await stopBlocked(res.blocked);
            return null;
          }
          await recordLlm(res.usage, res.cacheHit, "draft");
          await step.runMutation(internal.pipeline.saveDraft, { requestId, draft: res.body });
        }
        regenerateCount++;
        attempt++;
        continue;
      }

      // decisionAction.action === "proceed": approve | edit_text → DELIVER.
      if (evt.decision === "edit_text") {
        await step.runMutation(internal.pipeline.saveDraft, {
          requestId,
          editedBody: evt.editedText,
        });
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
    const patch: { route?: string; draft?: string; editedBody?: string; rejectReason?: string } =
      {};
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
