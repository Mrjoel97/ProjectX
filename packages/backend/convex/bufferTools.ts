import type { BufferDraft } from "@pikar/core/buffer";
import { jsonSchema, type ToolSet, tool } from "ai";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

/** The agent can read selected evidence and stage drafts. Approval/publishing are absent. */
export function buildBufferTools(ctx: ActionCtx, tenantId: string): ToolSet {
  return {
    readZernioEngagement: tool({
      description:
        "Read this user's latest cached Zernio Instagram/TikTok report. Check freshness and availability. Metrics are lifetime snapshots of posts in the stated publication window; external posts are not necessarily Buffer-published. Never invent missing metrics or sum reach or engagement rates.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => {
        try {
          return await ctx.runQuery(internal.zernio.agentReport, { tenantId });
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
        try {
          return {
            state: "ready",
            evidence: await ctx.runAction(internal.bufferActions.agentChannels, { tenantId }),
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
        try {
          return {
            state: "draft",
            postId: await ctx.runMutation(internal.buffer.stageAgentPost, { tenantId, ...args }),
            reviewPath: "/dashboard/marketing",
          };
        } catch {
          return { state: "unavailable", reason: "buffer_draft_invalid_or_channel_unavailable" };
        }
      },
    }),
  };
}
