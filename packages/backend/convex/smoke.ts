// Smoke-test workflows exercising the two "new learning cost" durable patterns
// against the DEV DEPLOYMENT (convex-test cannot emulate component-backed
// workflows — Research Open Question 2). Runnable via `npx convex run`.
//
//   1. runFailingPipeline -> failingPipeline (throws) -> onComplete -> deadLetters (OPSG-04)
//   2. startReviewGate    -> reviewGate (awaitEvent race, issue #177 workaround)
//
// All payloads are synthetic (`{ note: "synthetic" }`) — never raw content.
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { DAILY_BUDGET_CENTS, rateLimiter } from "./guardrails";
import { workflow } from "./index";
import { reviewEventValidator } from "./review";

// --- Pattern 1: dead-letter via onComplete ---------------------------------

/** A step that always throws — the deliberate failure that lands in the DLQ. */
export const boom = internalAction({
  args: {},
  handler: async () => {
    throw new Error("SMOKE_FAILURE");
  },
});

/** Single-step workflow whose step throws with retry disabled → fails fast. */
export const failingPipeline = workflow.define({
  args: { correlationId: v.string() },
  handler: async (step): Promise<null> => {
    await step.runAction(internal.smoke.boom, {}, { retry: false });
    return null;
  },
});

/** Entry point: start the failing workflow, routing onComplete to the DLQ. */
export const runFailingPipeline = internalMutation({
  args: { correlationId: v.optional(v.string()) },
  // Explicit return type: returning workflow.start's result (which references
  // internal.smoke.*) otherwise makes this module's api type self-referential →
  // TS7022 the moment a typechecked consumer (apps/web) imports the generated api
  // (Convex guidelines §96). WorkflowId widens to string.
  handler: async (ctx, { correlationId }): Promise<{ correlationId: string; workflowId: string }> => {
    const cid = correlationId ?? `smoke-dlq-${crypto.randomUUID()}`;
    const workflowId = await workflow.start(
      ctx,
      internal.smoke.failingPipeline,
      { correlationId: cid },
      {
        onComplete: internal.deadLetter.onPipelineComplete,
        context: { tenantId: "smoke", correlationId: cid, payload: { note: "synthetic" } },
      },
    );
    return { correlationId: cid, workflowId };
  },
});

// --- Pattern 2: awaitEvent-timeout race ------------------------------------

/** Record the branch the gate took as an audit event (reuses insert-only audit). */
export const recordReviewOutcome = internalMutation({
  args: {
    correlationId: v.string(),
    branch: v.union(v.literal("decision"), v.literal("timeout")),
  },
  handler: async (ctx, { correlationId, branch }) => {
    await ctx.runMutation(internal.audit.log, {
      tenantId: "smoke",
      correlationId,
      eventType: `smoke.reviewgate.${branch}`,
      actor: "system",
      payload: { branch },
    });
  },
});

/** Review gate: arm a timeout from inside a step, then await the union event. */
export const reviewGate = workflow.define({
  args: { correlationId: v.string(), timeoutMs: v.number() },
  handler: async (step, { correlationId, timeoutMs }): Promise<null> => {
    // Smoke drives a single gate iteration — attempt 0 (no regenerate loop here).
    await step.runMutation(internal.review.armTimeout, {
      workflowId: step.workflowId,
      correlationId,
      timeoutMs,
      attempt: 0,
    });
    const evt = await step.awaitEvent({
      name: `review:${correlationId}:0`,
      validator: reviewEventValidator,
    });
    const branch = evt.kind === "timeout" ? "timeout" : "decision";
    await step.runMutation(internal.smoke.recordReviewOutcome, { correlationId, branch });
    return null;
  },
});

/** Entry point: start a review gate; the caller drives decision vs. timeout. */
export const startReviewGate = internalMutation({
  args: { correlationId: v.optional(v.string()), timeoutMs: v.optional(v.number()) },
  handler: async (
    ctx,
    { correlationId, timeoutMs },
  ): Promise<{ correlationId: string; workflowId: string }> => {
    const cid = correlationId ?? `smoke-review-${crypto.randomUUID()}`;
    const workflowId = await workflow.start(ctx, internal.smoke.reviewGate, {
      correlationId: cid,
      timeoutMs: timeoutMs ?? 8000,
    });
    return { correlationId: cid, workflowId };
  },
});

// --- Pattern 3 (02-06): drive the REAL pipeline spine end-to-end -------------
// Seeds a real `requests` row and starts internal.pipeline.pipelineWorkflow with
// the same onComplete-DLQ + redaction-safe (requestId ref) context as
// requests.submit. The goal carries the llm.ts SMOKE::route sentinel so the spine
// runs deterministically offline (no LLM key on the local backend):
//   route=direct_tool/direct_llm → gate (script approves) → delivery → awaiting_reauth
//     (tenant "smoke" has no Gmail token) or sent (if one exists) + telemetry.
//   route=sub_agent → pipeline throws route_not_implemented → DLQ (AGNT-03).
//   route=unknown  → llm.route throws unknown_route → DLQ (AGNT-03).
// Both DLQ paths exercise the failed-terminal wiring (status=failed + failed telemetry).

export const seedPipeline = internalMutation({
  args: {
    correlationId: v.string(),
    route: v.union(
      v.literal("direct_llm"),
      v.literal("direct_tool"),
      v.literal("sub_agent"),
      v.literal("unknown"),
    ),
    // 03-05 phase gate: parameterize tenant + goal so the guardrails smoke can drive
    // two-tenant cache isolation and PII-bearing goals. Existing callers pass neither
    // and get the historic behavior (tenant "smoke", route-derived sentinel goal).
    tenant: v.optional(v.string()),
    goal: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { correlationId, route, tenant, goal },
  ): Promise<{ requestId: Id<"requests"> }> => {
    const tenantId = tenant ?? "smoke";
    const requestId = await ctx.db.insert("requests", {
      tenantId,
      correlationId,
      goal: goal ?? `SMOKE::route=${route}:: thank a colleague`,
      recipient: "smoke@example.com",
      status: "submitted",
      attachmentRefs: [],
      createdAt: Date.now(),
    });
    await workflow.start(
      ctx,
      internal.pipeline.pipelineWorkflow,
      { correlationId, requestId, tenantId },
      {
        onComplete: internal.deadLetter.onPipelineComplete,
        context: { tenantId, correlationId, payload: { correlationId, requestId } },
      },
    );
    return { requestId };
  },
});

// --- 03-05: rate-limiter drivers (synthetic keys / global window ONLY) --------
// The daily-spend window is GLOBAL (keyless) — draining it blocks EVERY later
// smoke, so resetDailySpend is mandatory finally-cleanup (03-RESEARCH Pitfall 5).

/** Exhaust the global daily-spend window so the next prepare/preCall fails closed. */
export const drainDailySpend = internalMutation({
  args: {},
  handler: async (ctx) => {
    await rateLimiter.limit(ctx, "dailySpendCents", { count: DAILY_BUDGET_CENTS, reserve: true });
  },
});

/** Refill the global daily-spend window — MANDATORY cleanup after drainDailySpend. */
export const resetDailySpend = internalMutation({
  args: {},
  handler: async (ctx) => {
    await rateLimiter.reset(ctx, "dailySpendCents");
  },
});

/** GRDL-06: prove the submit token bucket (capacity 5) rejects the 6th consume.
 *  Uses a random synthetic key so it never poisons a real tenant, and resets it
 *  after. The submit-form wiring itself is verified by test/typecheck in 03-03. */
export const assertSubmitRateLimited = internalMutation({
  args: {},
  handler: async (ctx) => {
    const key = `smoke-${crypto.randomUUID()}`;
    try {
      for (let i = 1; i <= 6; i++) {
        const { ok } = await rateLimiter.limit(ctx, "submitRequest", { key });
        const expectOk = i <= 5; // capacity 5: attempts 1–5 ok, the 6th rejected
        if (ok !== expectOk) {
          throw new Error(`submitRequest attempt ${i}: ok=${ok}, expected ${expectOk} (capacity 5)`);
        }
      }
    } finally {
      await rateLimiter.reset(ctx, "submitRequest", { key });
    }
    return { ok: true };
  },
});
