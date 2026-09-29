// Durable golden-evaluator invocation boundary. The CLI may lose stdout after a successful
// `convex run`; an attempt id therefore names one Workflow execution, not one CLI process.
// Request/response content stays in the Workflow component journal. The application table stores
// only refs and a hash so it cannot become a second prompt/reply data plane (CLAUDE.md §4).
import type { WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { workflow } from "./index";
import { TOOL_CONTEXT_ARGS } from "./lib/toolContextArgs";

const OPERATION = v.union(
  v.literal("llm:runCockpitAgent"),
  v.literal("llm:runRevenueCandidateEval"),
  v.literal("vaultSmoke:seedCorpus"),
  v.literal("evaluations:actOnGapInternal"),
);

const COCKPIT_REQUEST = v.object({
  operation: v.literal("llm:runCockpitAgent"),
  args: v.object({
    tenantId: v.string(),
    threadId: v.string(),
    planId: v.id("plans"),
    text: v.string(),
    model: v.optional(v.string()),
    clientContext: v.optional(v.object({ tz: v.string(), nowMs: v.number() })),
    ...TOOL_CONTEXT_ARGS,
    turnId: v.optional(v.string()),
    history: v.optional(
      v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("assistant")),
          content: v.string(),
        }),
      ),
    ),
    omitRecipientEdits: v.optional(v.boolean()),
  }),
});

const REVENUE_REQUEST = v.object({
  operation: v.literal("llm:runRevenueCandidateEval"),
  args: v.object({
    tenantId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    planId: v.id("plans"),
    fixtureId: v.string(),
    skillName: v.string(),
    skillVersion: v.number(),
    prompt: v.string(),
  }),
});

const VAULT_REQUEST = v.object({
  operation: v.literal("vaultSmoke:seedCorpus"),
  args: v.object({
    tenantId: v.string(),
    needle: v.string(),
    evalBudgetId: v.optional(v.id("spendEvents")),
  }),
});

const ACT_ON_GAP_REQUEST = v.object({
  operation: v.literal("evaluations:actOnGapInternal"),
  args: v.object({
    tenantId: v.string(),
    threadId: v.string(),
    gapIndex: v.number(),
    skillVersions: v.optional(v.record(v.string(), v.number())),
    tenantSkillIds: v.optional(v.record(v.string(), v.id("tenantSkills"))),
    evalBudgetId: v.optional(v.id("spendEvents")),
  }),
});

const REQUEST = v.union(COCKPIT_REQUEST, REVENUE_REQUEST, VAULT_REQUEST, ACT_ON_GAP_REQUEST);

const START_ARGS = {
  attemptId: v.string(),
  requestSha256: v.string(),
  request: REQUEST,
};

/**
 * The sole paid Workflow step. The wrapper itself performs exactly one selected Convex call. An
 * explicit `retry:false` on the workflow step below means neither a thrown provider call nor a
 * lost worker can cause the Workflow component's default three-attempt action retry.
 */
export const invokePaid = internalAction({
  args: { request: REQUEST },
  handler: async (ctx, { request }): Promise<unknown> => {
    switch (request.operation) {
      case "llm:runCockpitAgent":
        return await ctx.runAction(internal.llm.runCockpitAgent, request.args);
      case "llm:runRevenueCandidateEval":
        return await ctx.runAction(internal.llm.runRevenueCandidateEval, request.args);
      case "vaultSmoke:seedCorpus":
        return await ctx.runAction(internal.vaultSmoke.seedCorpus, request.args);
      case "evaluations:actOnGapInternal":
        return await ctx.runMutation(internal.evaluations.actOnGapInternal, request.args);
    }
  },
});

export const run = workflow.define({
  args: START_ARGS,
  handler: async (step, { request }): Promise<unknown> => {
    // PAID SINGLE-SHOT FENCE: never remove `{ retry: false }`.
    return await step.runAction(
      internal.goldenEvalAttempts.invokePaid,
      { request },
      { retry: false },
    );
  },
});

const assertIdentity = (attemptId: string, requestSha256: string): void => {
  if (!/^[0-9a-f-]{36}$/.test(attemptId) || !/^[0-9a-f]{64}$/.test(requestSha256)) {
    throw new Error("GOLDEN_PAID_CALL_INVALID");
  }
};

/** Free and idempotent. A retry after lost stdout returns the first workflow id. */
export const start = internalMutation({
  args: START_ARGS,
  handler: async (
    ctx,
    { attemptId, requestSha256, request },
  ): Promise<{ state: "started" | "existing"; workflowId: string }> => {
    assertIdentity(attemptId, requestSha256);
    const existing = await ctx.db
      .query("goldenEvalAttempts")
      .withIndex("by_attempt_id", (q) => q.eq("attemptId", attemptId))
      .unique();
    if (existing) {
      if (existing.requestSha256 !== requestSha256 || existing.operation !== request.operation) {
        throw new Error("GOLDEN_PAID_ATTEMPT_CONFLICT");
      }
      return { state: "existing" as const, workflowId: existing.workflowId };
    }

    const workflowId = await workflow.start(
      ctx,
      internal.goldenEvalAttempts.run,
      { attemptId, requestSha256, request },
      { startAsync: true },
    );
    const evalBudgetId = "evalBudgetId" in request.args ? request.args.evalBudgetId : undefined;
    await ctx.db.insert("goldenEvalAttempts", {
      attemptId,
      requestSha256,
      operation: request.operation,
      workflowId,
      ...(evalBudgetId === undefined ? {} : { evalBudgetId }),
      createdAt: Date.now(),
    });
    return { state: "started" as const, workflowId };
  },
});

/**
 * Free and idempotent. Completion returns the Workflow's exact Convex JSON value. Failures and
 * cancellation expose only code-owned states; provider/model error text can contain content.
 */
export const status = internalQuery({
  args: { attemptId: v.string(), requestSha256: v.string(), operation: OPERATION },
  handler: async (
    ctx,
    { attemptId, requestSha256, operation },
  ): Promise<
    { state: "in_progress" | "failed" | "canceled" } | { state: "completed"; result: unknown }
  > => {
    assertIdentity(attemptId, requestSha256);
    const attempt = await ctx.db
      .query("goldenEvalAttempts")
      .withIndex("by_attempt_id", (q) => q.eq("attemptId", attemptId))
      .unique();
    if (!attempt || attempt.requestSha256 !== requestSha256 || attempt.operation !== operation) {
      throw new Error("GOLDEN_PAID_ATTEMPT_NOT_FOUND");
    }
    const current = await workflow.status(ctx, attempt.workflowId as WorkflowId);
    switch (current.type) {
      case "inProgress":
        return { state: "in_progress" as const };
      case "completed":
        return { state: "completed" as const, result: current.result };
      case "failed":
        return { state: "failed" as const };
      case "canceled":
        return { state: "canceled" as const };
    }
  },
});
