"use node";

import { COCKPIT_AGENT_SKILL } from "@pikar/contracts/skill";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { cockpitAgent, ensureThreadAndPlan } from "./cockpit";
import { requireCustomerWorkflowPilot } from "./lib/customerWorkflowPilot";
import { tenantAction } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { runSpecialistTurn, saveMarkdownDocument } from "./llm";

export const run = tenantAction({
  args: {
    workflowId: v.id("customerWorkflows"),
    expectedRevision: v.number(),
    brief: v.string(),
    requestId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    runId: Id<"customerWorkflowRuns">;
    threadId?: string;
    status: "running" | "completed" | "failed" | "needs_review";
  }> => {
    requireCustomerWorkflowPilot(ctx);
    const claim = await ctx.runMutation(internal.customerWorkflows.claim, {
      ...args,
      tenantId: ctx.tenantId,
    });
    const runId = claim._id;
    if (!claim.claimed) return { runId, threadId: claim.threadId, status: claim.status };
    let threadId: string | undefined;
    try {
      const context = await ensureThreadAndPlan(ctx, undefined, args.brief);
      threadId = context.threadId;
      await ctx.runMutation(internal.customerWorkflows.bindThread, {
        tenantId: ctx.tenantId,
        runId,
        ...context,
      });
      const snapshot = await ctx.runQuery(internal.customerWorkflows.executionContext, {
        tenantId: ctx.tenantId,
        runId,
      });
      await cockpitAgent.saveMessage(ctx, { threadId, prompt: args.brief, skipEmbeddings: true });
      const preflight = await ctx.runMutation(internal.guardrails.preCall, {
        tenantId: ctx.tenantId,
      });
      if (!preflight.ok) throw new Error("WORKFLOW_BUDGET_UNAVAILABLE");
      await ctx.runMutation(internal.customerWorkflows.markAgentStarted, {
        tenantId: ctx.tenantId,
        runId,
      });
      // Customer-authored configuration stays in the user message. The governing instructions
      // load from the exact active registry version approved when this run was claimed.
      const prompt = JSON.stringify({
        requestedDeliverable: "One complete Markdown report, delivered as a PDF and reading view",
        specialist: {
          name: snapshot.specialist.name,
          objective: snapshot.specialist.objective,
          audience: snapshot.specialist.audience,
          instructions: snapshot.specialist.instructions,
        },
        workflow: { name: snapshot.name, orderedReportRequirements: snapshot.steps },
        selectedKnowledge: snapshot.knowledge,
        productBrief: snapshot.brief,
      });
      const result = await runSpecialistTurn(ctx, {
        tenantId: ctx.tenantId,
        planId: context.planId,
        threadId,
        turnId: String(runId),
        skillName: COCKPIT_AGENT_SKILL,
        skillVersions: { [COCKPIT_AGENT_SKILL]: snapshot.executorSkillVersion },
        toolNames: [],
        prompt,
        customerWorkflowRunId: runId,
      });
      const incomplete = result.truncated || result.declaredUnsupported || !result.reply.trim();
      await ctx.runMutation(internal.customerWorkflows.recordResult, {
        tenantId: ctx.tenantId,
        runId,
        resultHash: await contentHash(result.reply),
        incomplete,
      });
      await ctx.runQuery(internal.customerWorkflows.executionContext, {
        tenantId: ctx.tenantId,
        runId,
      });
      if (result.reply.trim()) {
        await saveMarkdownDocument(ctx, {
          tenantId: ctx.tenantId,
          planId: context.planId,
          threadId,
          title: snapshot.name,
          markdown: result.reply,
        });
        await cockpitAgent.saveMessage(ctx, {
          threadId,
          message: { role: "assistant", content: result.reply },
          skipEmbeddings: true,
        });
      }
    } catch {
      // A failed or lost paid attempt is held for review. A replay never invokes the model again.
    }
    const terminal = await ctx.runMutation(internal.customerWorkflows.finish, {
      tenantId: ctx.tenantId,
      runId,
    });
    return { runId, threadId: terminal.threadId ?? threadId, status: terminal.status };
  },
});
