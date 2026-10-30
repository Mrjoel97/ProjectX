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
  args: {
    ...scopeArgs,
    workflow: v.optional(v.boolean()),
    sourceFingerprint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!/^[a-f0-9]{16}$/.test(args.runRef)) throw Error("PRESENCE_DESIGN_RUN_INVALID");
    const hashes = await ownedContext(ctx, args.tenantId, args.planId, args.revision);
    if (args.workflow && args.sourceFingerprint !== hashes.sourceHash)
      throw Error("PRESENCE_DESIGN_SOURCE_CHANGED");
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
        candidateOnly: !args.workflow,
        ...(args.workflow ? { workflow: true, sourceFingerprint: args.sourceFingerprint! } : {}),
      },
    });
    return { ...hashes, policy: REQUIRED_PRESENCE_DESIGN_POLICY, spendingAuthorized: false };
  },
});

/** Non-content provider operation journal, separate from the ordered completion receipt. */
export const attempt = internalMutation({
  args: {
    ...scopeArgs,
    payload: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
  },
  handler: async (ctx, args) => {
    await ownedContext(ctx, args.tenantId, args.planId, -1);
    const first = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) =>
        q.eq("correlationId", correlation(args.planId, args.runRef)),
      )
      .first();
    if (
      !first ||
      first.tenantId !== args.tenantId ||
      first.actor !== "presence-design-control" ||
      first.payload.revision !== args.revision
    )
      throw Error("PRESENCE_DESIGN_UNAVAILABLE");
    await appendAudit(ctx, {
      tenantId: args.tenantId,
      actor: "presence-design-control",
      correlationId: correlation(args.planId, args.runRef) + ":attempts",
      eventType: "presence_design.attempt",
      payload: args.payload,
    });
  },
});

/** Persist only bounded hashes/layout metadata after both providers complete, for no-spend recovery. */
export const checkpointCompletion = internalMutation({
  args: { ...scopeArgs, completionJson: v.string() },
  handler: async (ctx, args) => {
    await ownedContext(ctx, args.tenantId, args.planId, args.revision);
    if (new TextEncoder().encode(args.completionJson).length > 16000)
      throw Error("PRESENCE_COMPLETION_TOO_LARGE");
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) =>
        q.eq("correlationId", correlation(args.planId, args.runRef)),
      )
      .take(5);
    if (
      rows[0]?.tenantId !== args.tenantId ||
      rows[0]?.payload.workflow !== true ||
      rows.at(-1)?.eventType !== "presence_design.kimi_complete"
    )
      throw Error("PRESENCE_COMPLETION_UNAVAILABLE");
    await appendAudit(ctx, {
      tenantId: args.tenantId,
      actor: "presence-design-control",
      correlationId: correlation(args.planId, args.runRef) + ":completion",
      eventType: "presence_design.completion",
      payload: { completionJson: args.completionJson, revision: args.revision },
    });
  },
});

export const recoverCompletion = internalMutation({
  args: scopeArgs,
  handler: async (ctx, args): Promise<string | null> => {
    await ownedContext(ctx, args.tenantId, args.planId, args.revision);
    const row = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) =>
        q.eq("correlationId", correlation(args.planId, args.runRef) + ":completion"),
      )
      .first();
    if (!row) return null;
    if (
      row.tenantId !== args.tenantId ||
      row.actor !== "presence-design-control" ||
      row.payload.revision !== args.revision ||
      typeof row.payload.completionJson !== "string"
    )
      throw Error("PRESENCE_COMPLETION_UNAVAILABLE");
    return row.payload.completionJson;
  },
});

/** Claim a single read-only Stitch recovery; never reset a provider or spending journal. */
export const claimStitchRecovery = internalMutation({
  args: scopeArgs,
  handler: async (ctx, args): Promise<{ projectName: string } | null> => {
    const hashes = await ownedContext(ctx, args.tenantId, args.planId, args.revision);
    const correlationId = correlation(args.planId, args.runRef);
    const stages = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .take(6);
    if (!stages.length) return null;
    const claim = stages[0];
    if (
      !claim ||
      stages.length !== 1 ||
      claim.eventType !== "presence_design.claimed" ||
      claim.tenantId !== args.tenantId ||
      claim.actor !== "presence-design-control" ||
      claim.payload.workflow !== true ||
      claim.payload.revision !== args.revision ||
      claim.payload.briefHash !== hashes.briefHash ||
      claim.payload.sourceHash !== hashes.sourceHash
    )
      throw Error("PRESENCE_RECOVERY_UNAVAILABLE");
    const attempts = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId + ":attempts"))
      .take(51);
    const last = attempts.at(-1)?.payload;
    const projects = [
      ...new Set(
        attempts
          .map((r) => r.payload.projectRef)
          .filter((value): value is string => typeof value === "string"),
      ),
    ];
    const generationStarts = attempts.filter(
      (r) =>
        r.payload.operation === "generate_screen_from_text" &&
        r.payload.provider === "stitch" &&
        r.payload.outcome === undefined,
    );
    const projectName = projects[0];
    if (
      attempts.length > 50 ||
      attempts.some(
        (r) =>
          r.tenantId !== args.tenantId ||
          r.actor !== "presence-design-control" ||
          r.payload.recoveryClaimed === true,
      ) ||
      last?.stopped !== true ||
      last.reconciliationRequired !== true ||
      last.phase !== "claimed" ||
      projects.length !== 1 ||
      !projectName || !/^projects\/[A-Za-z0-9_-]{1,96}$/.test(projectName) ||
      generationStarts.length !== 1
    )
      throw Error("PRESENCE_RECOVERY_UNAVAILABLE");
    await appendAudit(ctx, {
      tenantId: args.tenantId,
      actor: "presence-design-control",
      correlationId: correlationId + ":attempts",
      eventType: "presence_design.attempt",
      payload: { recoveryClaimed: true, projectRef: projectName, revision: args.revision },
    });
    return { projectName };
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
