import { getAuthUserId } from "@convex-dev/auth/server";
import { jsonSchema, type Tool, tool } from "ai";
import { api } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { contentHash } from "./lib/hash";

const SERVICE_ID = "social-marketing";
const SETTINGS_PATH = "/dashboard/skills-workflows";
const noArguments = jsonSchema<Record<string, never>>({
  type: "object",
  properties: {},
  additionalProperties: false,
});

/** Ordinary attended Executive access only; authentication remains on the same public UI seam. */
export function buildManagedServiceTools(
  ctx: ActionCtx,
  tenantId: string,
  rootRequestId: string,
): Record<"readSocialService" | "startSocialService", Tool<Record<string, never>, unknown>> {
  const authenticated = async () => {
    const userId = await getAuthUserId(ctx);
    if (!userId || String(userId) !== tenantId) throw new Error("SERVICE_AUTHENTICATION_REQUIRED");
  };
  const saved = async () => {
    await authenticated();
    return ctx.runQuery(api.managedServices.status, { serviceId: SERVICE_ID });
  };
  const path = (threadId: string | null) =>
    threadId ? `/dashboard/workspace?thread=${encodeURIComponent(threadId)}` : null;
  return {
    readSocialService: tool<Record<string, never>, unknown, Record<string, never>>({
      description:
        "Read your saved social service setup, readiness, business sources and latest outcomes. Does not start work, connect accounts or change settings.",
      inputSchema: noArguments,
      execute: async () => {
        const service = await saved();
        if (!service) return { state: "not_configured", settingsPath: SETTINGS_PATH };
        const runs = await ctx.runQuery(api.managedServiceRuns.list, { serviceId: SERVICE_ID });
        const latest = runs.items[0];
        const brain = await ctx.runQuery(api.serviceOutcomes.serviceBrainView, {
          serviceId: SERVICE_ID,
        });
        return {
          state: service.readiness.ready ? "ready" : "needs_setup",
          goal: service.goal,
          controlState: service.controlState,
          reasons: service.readiness.reasons,
          brain,
          latestRun: latest
            ? {
                runId: latest.runId,
                state: latest.state,
                workspacePath: path(latest.threadId),
                outcome: brain?.latestOutcome?.runId === latest.runId ? brain.latestOutcome : null,
              }
            : null,
          settingsPath: SETTINGS_PATH,
        };
      },
    }),
    startSocialService: tool<Record<string, never>, unknown, Record<string, never>>({
      description:
        "Start your saved social service once when requested. Uses saved accounts, goals and budget; drafts still need human approval before scheduling.",
      inputSchema: noArguments,
      execute: async () => {
        const service = await saved();
        if (!service) return { state: "not_configured", settingsPath: SETTINGS_PATH };
        const requestKey = await contentHash(`managed-service:${SERVICE_ID}:${rootRequestId}`);
        // SAME public start action as the setup UI. It resolves identity, readiness and duplicate
        // request keys itself; there is no internal scheduler/admin fallback on auth failure.
        const started = await ctx.runAction(api.managedServiceRuns.start, {
          serviceId: SERVICE_ID,
          expectedRevision: service.revision,
          expectedControlRevision: service.controlRevision,
          requestKey,
        });
        return {
          state: started.state,
          existing: started.existing,
          runId: started.runId,
          workspacePath: path(started.threadId),
          settingsPath: SETTINGS_PATH,
          publicationRequiresReview: true,
        };
      },
    }),
  };
}
