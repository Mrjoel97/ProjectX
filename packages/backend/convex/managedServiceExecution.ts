"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./lib/tenantLifecycle";

/** The existing Executive loop remains the only agent engine. No action retries. */
export const execute = internalAction({
  args: { tenantId: v.string(), runId: v.id("managedServiceRuns") },
  handler: async (ctx, args): Promise<null> => {
    try {
      const context = await ctx.runQuery(internal.managedServiceRuns.getExecutionContext, args);
      const result = await ctx.runAction(internal.llm.runCockpitAgent, {
        tenantId: context.tenantId,
        threadId: context.threadId,
        planId: context.planId,
        turnId: context.turnId,
        text: context.goal,
        managedServiceRunId: context.runId,
      });
      await ctx.runMutation(internal.managedServiceRuns.finish, {
        ...args,
        outcome: result.blocked ? "governed_stop" : "completed",
        reply: result.reply,
      });
    } catch {
      // An accepted provider attempt may still settle: record uncertainty, never retry it.
      await ctx.runMutation(internal.managedServiceRuns.finish, {
        ...args,
        outcome: "execution_uncertain",
      });
    }
    return null;
  },
});
