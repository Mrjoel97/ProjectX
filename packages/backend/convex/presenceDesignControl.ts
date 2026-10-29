import { sha256Bytes } from "@pikar/core/webRuntime";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { appendAudit } from "./audit";
import {
  REQUIRED_PRESENCE_DESIGN_POLICY,
  requiredDesignTransition,
  validDesignHash,
} from "./lib/presenceRequiredPipeline";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";

const digest = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
const correlation = (planId: string, runRef: string) => `presence-design:${planId}:${runRef}`;
async function ownedContext(
  ctx: MutationCtx,
  tenantId: string,
  planId: Id<"plans">,
  revision: number,
) {
  await assertTenantWritable(ctx, tenantId);
  const plan = await ctx.db.get(planId);
  const session = await ctx.db
    .query("onlinePresenceSessions")
    .withIndex("by_tenant_plan", (q) => q.eq("tenantId", tenantId).eq("planId", planId))
    .unique();
  if (!plan || plan.tenantId !== tenantId || !session || session.threadId !== plan.threadId)
    throw Error("PRESENCE_DESIGN_UNAVAILABLE");
  if (
    revision >= 0 &&
    (session.revision !== revision || !session.brief || !session.sourceSnapshots?.length)
  )
    throw Error("PRESENCE_DESIGN_CONTEXT_CHANGED");
  return {
    briefHash: digest(session.brief ?? null),
    sourceHash: digest(session.sourceSnapshots ?? []),
  };
}
const scopeArgs = {
  tenantId: v.string(),
  planId: v.id("plans"),
  revision: v.number(),
  runRef: v.string(),
};

/** Candidate-only durable claim. It does not admit spending, activate a skill or qualify a build. */
export const claim = internalMutation({
  args: scopeArgs,
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{16}$/.test(args.runRef)) throw Error("PRESENCE_DESIGN_RUN_INVALID");
    const hashes = await ownedContext(ctx, args.tenantId, args.planId, args.revision);
    const correlationId = correlation(args.planId, args.runRef);
    if (
      await ctx.db
        .query("audit")
        .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
        .first()
    )
      throw Error("PRESENCE_DESIGN_ALREADY_CLAIMED");
    await appendAudit(ctx, {
      tenantId: args.tenantId,
      correlationId,
      actor: "presence-design-control",
      eventType: "presence_design.claimed",
      payload: {
        ...hashes,
        revision: args.revision,
        policy: REQUIRED_PRESENCE_DESIGN_POLICY.version,
        candidateOnly: true,
      },
    });
    return { ...hashes, policy: REQUIRED_PRESENCE_DESIGN_POLICY, spendingAuthorized: false };
  },
});

export const advance = internalMutation({
  args: {
    ...scopeArgs,
    phase: v.union(v.literal("stitch_complete"), v.literal("kimi_complete"), v.literal("stopped")),
    designHash: v.optional(v.string()),
    proposalHash: v.optional(v.string()),
    documentHash: v.optional(v.string()),
    artifactsHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // A stale source must stop the original owned claim, rather than prevent its terminal receipt.
    const hashes = await ownedContext(
      ctx,
      args.tenantId,
      args.planId,
      args.phase === "stopped" ? -1 : args.revision,
    );
    const correlationId = correlation(args.planId, args.runRef);
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .take(5);
    const first = rows[0],
      previous = rows.at(-1);
    if (
      !first ||
      !previous ||
      rows.length > 3 ||
      first.tenantId !== args.tenantId ||
      rows.some((r) => r.actor !== "presence-design-control") ||
      first.payload.revision !== args.revision ||
      (args.phase !== "stopped" &&
        (first.payload.briefHash !== hashes.briefHash ||
          first.payload.sourceHash !== hashes.sourceHash))
    )
      throw Error("PRESENCE_DESIGN_CONTEXT_CHANGED");
    const previousPhase = previous.eventType.replace("presence_design.", "");
    if (
      !["claimed", "stitch_complete", "kimi_complete", "stopped"].includes(previousPhase) ||
      !requiredDesignTransition(
        previousPhase as "claimed" | "stitch_complete" | "kimi_complete" | "stopped",
        args.phase,
      )
    )
      throw Error("PRESENCE_DESIGN_PHASE_INVALID");
    if (args.phase !== "stopped" && !validDesignHash(args.designHash))
      throw Error("PRESENCE_DESIGN_HASH_INVALID");
    if (
      args.phase === "kimi_complete" &&
      (!validDesignHash(args.proposalHash) ||
        !validDesignHash(args.documentHash) ||
        !validDesignHash(args.artifactsHash) ||
        previous.payload.designHash !== args.designHash)
    )
      throw Error("PRESENCE_DESIGN_REFERENCE_CHANGED");
    await appendAudit(ctx, {
      tenantId: args.tenantId,
      correlationId,
      actor: "presence-design-control",
      eventType: `presence_design.${args.phase}`,
      payload: {
        candidateOnly: true,
        nativeBuildQualified: false,
        ...(args.designHash ? { designHash: args.designHash } : {}),
        ...(args.proposalHash ? { proposalHash: args.proposalHash } : {}),
        ...(args.documentHash ? { documentHash: args.documentHash } : {}),
        ...(args.artifactsHash ? { artifactsHash: args.artifactsHash } : {}),
      },
    });
    return { candidateOnly: true, nativeBuildQualified: false, publicationAuthorized: false };
  },
});
