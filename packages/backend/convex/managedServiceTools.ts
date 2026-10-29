import { getAuthUserId } from "@convex-dev/auth/server";
import { SERVICE_KNOWLEDGE_KEYS, type ServiceKnowledgeKey } from "@pikar/core/serviceKnowledge";
import { jsonSchema, type Tool, tool } from "ai";
import { api } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { contentHash } from "./lib/hash";

const SERVICE_ID = "social-marketing";
const SETTINGS_PATH = "/dashboard/marketing";
const noArguments = jsonSchema<Record<string, never>>({
  type: "object",
  properties: {},
  additionalProperties: false,
});
type ManagedServiceTools = {
  readSocialService: Tool<Record<string, never>, unknown>;
  startSocialService: Tool<Record<string, never>, unknown>;
  saveSocialServiceAnswer: Tool<{ key: ServiceKnowledgeKey; value: string }, unknown>;
};

/** Ordinary attended Executive access only; authentication remains on the same public UI seam. */
export function buildManagedServiceTools(
  ctx: ActionCtx,
  tenantId: string,
  rootRequestId: string,
): ManagedServiceTools {
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
        const conversation = await ctx.runQuery(api.serviceConversations.read, {
          serviceId: SERVICE_ID,
        });
        return {
          state: service.readiness.ready ? "ready" : "needs_setup",
          goal: service.goal,
          controlState: service.controlState,
          reasons: service.readiness.reasons,
          brain,
          conversation,
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
        if (service.readiness.reasons.includes("business_information_required")) {
          const conversation = await ctx.runQuery(api.serviceConversations.read, {
            serviceId: SERVICE_ID,
          });
          return { state: "needs_information", conversation, settingsPath: SETTINGS_PATH };
        }
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
    saveSocialServiceAnswer: tool<
      { key: ServiceKnowledgeKey; value: string },
      unknown,
      Record<string, never>
    >({
      description:
        "Propose the user's answer as a draft for review. Read the current question first. The user confirms it; this tool cannot confirm facts, start work or approve publishing.",
      inputSchema: jsonSchema<{ key: ServiceKnowledgeKey; value: string }>({
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", enum: [...SERVICE_KNOWLEDGE_KEYS] },
          value: { type: "string", minLength: 1, maxLength: 4000 },
        },
        required: ["key", "value"],
      }),
      execute: async ({ key, value }) => {
        const service = await saved();
        if (!service) return { state: "not_configured", settingsPath: SETTINGS_PATH };
        let conversation = await ctx.runQuery(api.serviceConversations.read, {
          serviceId: SERVICE_ID,
        });
        if (!conversation) return { state: "not_configured", settingsPath: SETTINGS_PATH };
        if (conversation.conversationRevision === 0 || conversation.needsRebind)
          conversation = await ctx.runMutation(api.serviceConversations.begin, {
            serviceId: SERVICE_ID,
            expectedRevision: service.revision,
            expectedControlRevision: service.controlRevision,
            expectedConversationRevision: conversation.conversationRevision,
          });
        const updated = await ctx.runMutation(api.serviceConversations.save, {
          serviceId: SERVICE_ID,
          expectedRevision: conversation.revision,
          expectedControlRevision: conversation.controlRevision,
          expectedConversationRevision: conversation.conversationRevision,
          key,
          value,
        });
        return { state: "draft_saved", conversation: updated, settingsPath: SETTINGS_PATH };
      },
    }),
  };
}
