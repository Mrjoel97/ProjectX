"use node";

import { ONLINE_PRESENCE_TOOLS } from "@pikar/core/onlinePresence";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./lib/tenantLifecycle";
import { runSpecialistTurn } from "./llm";

/** Bind the attended workflow to the existing bounded skill runner, never a second model loop. */
export const run = internalAction({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    planId: v.id("plans"),
    text: v.string(),
    runId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; reply: string; costUsd: number; outcome: string }> => {
    const context = await ctx.runQuery(internal.onlinePresence.contextForTenant, {
      tenantId: args.tenantId,
      planId: args.planId,
    });
    if (context.threadId !== args.threadId) throw new Error("ONLINE_PRESENCE_UNAVAILABLE");
    if (context.latestUserMessage !== args.text.trim())
      throw new Error("ONLINE_PRESENCE_USER_MESSAGE_MISMATCH");
    const pre = await ctx.runMutation(internal.guardrails.preCall, { tenantId: args.tenantId });
    if (!pre.ok)
      return {
        ok: false,
        reply: "I've paused for a moment. Please try again shortly.",
        costUsd: 0,
        outcome: "blocked",
      };
    const result = await runSpecialistTurn(ctx, {
      tenantId: args.tenantId,
      planId: args.planId,
      threadId: args.threadId,
      turnId: args.runId ?? crypto.randomUUID(),
      skillName: "online-presence-specialist",
      toolNames: ONLINE_PRESENCE_TOOLS,
      // Business content is data. Governing behavior lives only in the versioned registry body.
      prompt: JSON.stringify({
        request: args.text,
        sessionRevision: context.revision,
        previousBrief: context.brief,
        artifact: context.artifact,
      }),
    });
    const after = await ctx.runQuery(internal.onlinePresence.contextForTenant, {
      tenantId: args.tenantId,
      planId: args.planId,
    });
    const outcome = result.truncated
      ? "partial"
      : after.artifact && after.briefBuilt
        ? "awaiting_review"
        : after.assessment?.ok
          ? "ready_to_build"
          : after.assessment?.missing.some((entry) => entry.reason === "commerce_unavailable")
            ? "blocked"
            : "needs_information";
    const reply =
      after.assessment?.ok && !after.briefBuilt
        ? `Your changes are saved, but the revised website has not been built yet.${
            after.artifact
              ? ` The existing website is still version ${after.artifact.version}; it does not include these saved changes.`
              : ""
          }`
        : result.reply;
    return { ok: true, reply, costUsd: result.costUsd, outcome };
  },
});
