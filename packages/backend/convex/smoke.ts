// Smoke-test workflows exercising the two "new learning cost" durable patterns
// against the DEV DEPLOYMENT (convex-test cannot emulate component-backed
// workflows — Research Open Question 2). Runnable via `npx convex run`.
//
//   1. runFailingPipeline -> failingPipeline (throws) -> onComplete -> deadLetters (OPSG-04)
//
// All payloads are synthetic (`{ note: "synthetic" }`) — never raw content.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { workflow } from "./index";

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
