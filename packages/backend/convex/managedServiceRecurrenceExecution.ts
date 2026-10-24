import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { cockpitAgent } from "./cockpit";
import { internalAction } from "./lib/tenantLifecycle";

/** Native, identity-bound startup for the existing workflow; no browser session or model here. */
export async function startStandingServiceRun(
  ctx: ActionCtx,
  args: { tenantId: string; runId: Id<"managedServiceRuns"> },
): Promise<null> {
  try {
    const service: { goal: string } = await ctx.runQuery(
      internal.managedServiceRuns.claimedGoal,
      args,
    );
    const { threadId }: { threadId: string } = await cockpitAgent.createThread(ctx, {
      userId: args.tenantId,
      title: service.goal.trim().replace(/\s+/g, " ").slice(0, 60) || "Scheduled preparation",
    });
    const planId: Id<"plans"> = await ctx.runMutation(internal.plans.insertPlan, {
      tenantId: args.tenantId,
      threadId,
    });
    await ctx.runMutation(internal.managedServiceRuns.bindAndStart, {
      ...args,
      threadId,
      planId,
    });
  } catch {
    // A committed startup might already be running. setupFailed only touches a still-claimed run.
    await ctx.runMutation(internal.managedServiceRuns.setupFailed, args);
  }
  return null;
}

export const start = internalAction({
  args: { tenantId: v.string(), runId: v.id("managedServiceRuns") },
  handler: startStandingServiceRun,
});
