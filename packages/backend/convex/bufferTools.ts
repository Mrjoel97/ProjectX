import type { BufferDraft } from "@pikar/core/buffer";
import type {
  ManagedServiceOperationId,
  ManagedServiceRuntimeScope,
} from "@pikar/core/managedServices";
import { jsonSchema, type ToolSet, tool } from "ai";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

/** The agent can read selected evidence and stage drafts. Approval/publishing are absent. */
export function buildBufferTools(
  ctx: ActionCtx,
  tenantId: string,
  service?: {
    runId: Id<"managedServiceRuns">;
    currentScope: () => Promise<ManagedServiceRuntimeScope>;
  },
): ToolSet {
  const current = async (operation: ManagedServiceOperationId) => {
    if (!service) return undefined;
    const scope = await service.currentScope();
    if (!scope.operationIds.includes(operation)) throw new Error("SERVICE_OPERATION_NOT_ALLOWED");
    return scope;
  };
  return {
    readZernioEngagement: tool({
      description:
        "Read cached Zernio Instagram/TikTok metrics. Reports contain lifetime snapshots; external posts do not establish the publisher. Missing metrics are unavailable. Check timestamps and sampling limits.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => {
        const scope = await current("social.report");
        try {
          const report = await ctx.runQuery(internal.zernio.agentReport, { tenantId });
          if (!scope) return report;
          await current("social.report");
          if (!("accounts" in report) || !Array.isArray(report.accounts)) return report;
          const ids = new Set(
            scope.accounts
              .filter((account) => account.provider === "zernio")
              .map((account) => account.accountId),
          );
          return {
            ...report,
            accounts: report.accounts.filter((account) => ids.has(account.accountId)),
          };
        } catch {
          return { state: "unavailable", settingsPath: "/connect-zernio" };
        }
      },
    }),
    readBufferChannels: tool({
      description:
        "Read the social channels this user selected in their Buffer connection. Returns channel IDs, names, platform and availability; never chooses another organization or connects an account.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => {
        const scope = await current("social.prepare");
        try {
          const evidence = await ctx.runAction(internal.bufferActions.agentChannels, { tenantId });
          if (scope) await current("social.prepare");
          const ids = new Set(
            scope?.accounts
              .filter((account) => account.provider === "buffer")
              .map((account) => account.accountId),
          );
          return {
            state: "ready",
            evidence: scope
              ? {
                  ...evidence,
                  channels: evidence.channels.filter((channel) => ids.has(channel.id)),
                }
              : evidence,
          };
        } catch {
          return {
            state: "unavailable",
            reason: "connect_or_select_buffer_channels",
            settingsPath: "/connect-buffer",
          };
        }
      },
    }),
    readBufferEngagement: tool({
      description:
        "Check Buffer engagement availability. Reports are unavailable for third-party app clients; reconnecting does not grant analytics. Never invent metrics.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => {
        if (service) throw new Error("SERVICE_OPERATION_NOT_ALLOWED");
        try {
          return {
            state: "ready",
            evidence: await ctx.runAction(internal.bufferActions.agentReport, { tenantId }),
          };
        } catch {
          return {
            state: "unavailable",
            reason: "buffer_reports_unavailable_for_app_clients",
          };
        }
      },
    }),
    stageBufferPost: tool({
      description:
        "Save a local campaign draft for human approval at /dashboard/marketing. Never publishes. Use an ID from readBufferChannels and media explicitly intended for publication.",
      inputSchema: jsonSchema<BufferDraft & { campaign: string }>({
        type: "object",
        additionalProperties: false,
        properties: {
          campaign: { type: "string", maxLength: 120 },
          channelId: { type: "string" },
          text: { type: "string", maxLength: 10000 },
          mode: { type: "string", enum: ["addToQueue", "customScheduled"] },
          dueAt: {
            type: "number",
            description: "Milliseconds since Unix epoch, required only for customScheduled.",
          },
          imageUrl: { type: "string" },
          videoUrl: { type: "string" },
          mediaTitle: { type: "string", maxLength: 100 },
          categoryId: { type: "string" },
          boardId: { type: "string" },
          isAiGenerated: { type: "boolean" },
        },
        required: ["campaign", "channelId", "text", "mode"],
      }),
      execute: async (args) => {
        const scope = await current("social.prepare");
        if (
          scope &&
          !scope.accounts.some(
            (account) => account.provider === "buffer" && account.accountId === args.channelId,
          )
        )
          throw new Error("SERVICE_ACCOUNT_NOT_ALLOWED");
        try {
          return {
            state: "draft",
            postId: await ctx.runMutation(internal.buffer.stageAgentPost, {
              tenantId,
              ...args,
              ...(service ? { managedServiceRunId: service.runId } : {}),
            }),
            reviewPath: "/dashboard/marketing",
          };
        } catch {
          return { state: "unavailable", reason: "buffer_draft_invalid_or_channel_unavailable" };
        }
      },
    }),
  };
}
