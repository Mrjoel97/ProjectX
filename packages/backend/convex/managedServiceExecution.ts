"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction } from "./lib/tenantLifecycle";

/** The existing Executive loop remains the only agent engine. No action retries. */
export const execute = internalAction({
  args: { tenantId: v.string(), runId: v.id("managedServiceRuns") },
  handler: async (ctx, args): Promise<null> => {
    let agentStarted = false;
    try {
      const context = await ctx.runQuery(internal.managedServiceRuns.getExecutionContext, args);
      if (context.operationIds.includes("social.report")) {
        const pins = context.accounts.filter((account) => account.provider === "zernio");
        const matches = (row: Doc<"zernioConnections"> | null) =>
          row?.status === "connected" &&
          pins.length > 0 &&
          row.selectedAccountIds.length === pins.length &&
          pins.every(
            (pin) =>
              pin.connectionId === row.connectionId &&
              pin.connectionRevision === (row.grantRevision ?? row.revision) &&
              row.selectedAccountIds.includes(pin.accountId),
          );
        const connection = await ctx.runQuery(internal.zernio.connection, {
          tenantId: args.tenantId,
        });
        if (!connection || !matches(connection)) throw new Error("SERVICE_REPORT_SCOPE_CHANGED");
        // Reuse the bounded provider refresh; this does not enable the independent daily timer.
        const refreshed = await ctx.runAction(internal.zernioActions.refreshScheduled, {
          tenantId: args.tenantId,
          connectionId: connection.connectionId,
          revision: connection.revision,
        });
        await ctx.runQuery(internal.managedServiceRuns.getExecutionContext, args);
        const current = await ctx.runQuery(internal.zernio.connection, { tenantId: args.tenantId });
        if (!matches(current) || current?.revision !== connection.revision)
          throw new Error("SERVICE_REPORT_SCOPE_CHANGED");
        if (refreshed.state !== "updated" && refreshed.state !== "not_due_or_connection_changed")
          throw new Error("SERVICE_REPORT_REFRESH_FAILED");
        const report = await ctx.runQuery(internal.zernio.agentReport, { tenantId: args.tenantId });
        // A rate-limited refresh may reuse an already fresh native snapshot, with its original
        // timestamp. Missing/stale/withdrawn evidence must stop before any paid agent turn.
        if (
          report.state !== "ready" ||
          !("accounts" in report) ||
          report.fetchedAt > Date.now() ||
          report.accounts.length !== pins.length ||
          report.accounts.some(
            (account) => !pins.some((pin) => pin.accountId === account.accountId),
          )
        )
          throw new Error("SERVICE_REPORT_NOT_READY");
      }
      agentStarted = true;
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
        outcome: agentStarted ? "execution_uncertain" : "governed_stop",
        ...(!agentStarted
          ? {
              reply:
                "Work stopped before the agent started. Check your connections and reporting availability, then try again.",
            }
          : {}),
      });
    }
    return null;
  },
});
