// Smoke-test workflows exercising the two "new learning cost" durable patterns
// against the DEV DEPLOYMENT (convex-test cannot emulate component-backed
// workflows — Research Open Question 2). Runnable via `npx convex run`.
//
//   1. runFailingPipeline -> failingPipeline (throws) -> onComplete -> deadLetters (OPSG-04)
//   2. startReviewGate    -> reviewGate (awaitEvent race, issue #177 workaround)
//
// All payloads are synthetic (`{ note: "synthetic" }`) — never raw content.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
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
  handler: async (ctx, { correlationId }) => {
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
    await step.runMutation(internal.review.armTimeout, {
      workflowId: step.workflowId,
      correlationId,
      timeoutMs,
    });
    const evt = await step.awaitEvent({
      name: `review:${correlationId}`,
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
  handler: async (ctx, { correlationId, timeoutMs }) => {
    const cid = correlationId ?? `smoke-review-${crypto.randomUUID()}`;
    const workflowId = await workflow.start(ctx, internal.smoke.reviewGate, {
      correlationId: cid,
      timeoutMs: timeoutMs ?? 8000,
    });
    return { correlationId: cid, workflowId };
  },
});
