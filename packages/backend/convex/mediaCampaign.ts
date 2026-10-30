import { brandImageDirection } from "@pikar/core/brandKit";
import { mediaTaskIncreaseCents } from "@pikar/core/mediaBudget";
import {
  ambiguousCampaignFailure,
  type CampaignStatus,
  campaignMaximumCents,
  campaignStartIndexes,
  campaignStatus,
  MEDIA_CAMPAIGN_CONCURRENCY,
  MEDIA_CAMPAIGN_MAX_ITEMS,
  MEDIA_CAMPAIGN_SETTLEMENT_MS,
  validateCampaignInput,
} from "@pikar/core/mediaCampaign";
import { MEDIA_DEFAULT_IMAGE_QUALITY } from "@pikar/cost/media";
import { ConvexError, type ObjectType, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { approvedBrandForTenant } from "./brandKits";
import { mediaDailyBudgetInner } from "./guardrails";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { readMediaBatch } from "./lib/mediaRead";
import { internalMutation } from "./lib/tenantLifecycle";
import { TOOL_CONTEXT_ARGS } from "./lib/toolContextArgs";
import {
  cancelQueuedCampaignBatchInner,
  estimateCampaignPlanInner,
  type MediaDailyOverageAllowance,
  nativeReelReviewHash,
  reserveCampaignPlanInner,
} from "./media";
import { ensureCoverage } from "./spendLedger";

const itemInput = v.union(
  v.object({ kind: v.literal("image"), label: v.string(), prompt: v.string() }),
  v.object({ kind: v.literal("video"), label: v.string(), brief: v.string() }),
);
const stageArgs = {
  tenantId: v.string(),
  threadId: v.string(),
  title: v.string(),
  items: v.array(itemInput),
  maxCostCents: v.number(),
  creationKey: v.optional(v.string()),
  directorContext: v.optional(
    v.object({
      rootRequestId: v.string(),
      envelopeCents: v.number(),
      skillVersions: TOOL_CONTEXT_ARGS.skillVersions,
      tenantSkillIds: TOOL_CONTEXT_ARGS.tenantSkillIds,
    }),
  ),
};
type Item = Doc<"mediaCampaigns">["items"][number];
type StageArgs = ObjectType<typeof stageArgs>;
type StageResult = {
  campaignId: Id<"mediaCampaigns">;
  videoPlans: { planId: Id<"plans">; brief: string }[];
};

async function ownedCampaign(
  ctx: Pick<QueryCtx, "db">,
  tenantId: string,
  id: Id<"mediaCampaigns">,
) {
  const row = await ctx.db.get(id);
  if (!row || row.tenantId !== tenantId) throw new Error("CAMPAIGN_NOT_FOUND");
  return row;
}

/** Bounded index existence reads make the two campaign workers a tenant-wide ceiling.
 * Ordinary single-media jobs retain their existing independent admission and spend rails. */
async function activeCampaign(ctx: Pick<QueryCtx, "db">, tenantId: string) {
  const active = await Promise.all(
    (["running", "needs_reconciliation"] as const).map((status) =>
      ctx.db
        .query("mediaCampaigns")
        .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId).eq("status", status))
        .first(),
    ),
  );
  return active.find((campaign) => campaign !== null) ?? null;
}

/** Proposal only. Creation, every director schedule, and replay identity commit atomically. */
export async function stageCampaignInner(ctx: MutationCtx, args: StageArgs): Promise<StageResult> {
  const refusal = validateCampaignInput(args.title, args.items, args.maxCostCents);
  if (refusal || !args.threadId.trim() || args.threadId.length > 512)
    throw new ConvexError({ code: "CAMPAIGN_REFUSED", reason: refusal ?? "invalid_thread" });
  const inputs = args.items.map((item) =>
    item.kind === "image"
      ? { kind: item.kind, label: item.label.trim(), prompt: item.prompt.trim() }
      : { kind: item.kind, label: item.label.trim(), brief: item.brief.trim() },
  );
  const context = args.directorContext;
  if (
    context &&
    (!context.rootRequestId.trim() ||
      !Number.isSafeInteger(context.envelopeCents) ||
      context.envelopeCents < 0 ||
      (inputs.some((item) => item.kind === "video") && context.envelopeCents < 1))
  )
    throw new ConvexError({ code: "CAMPAIGN_REFUSED", reason: "invalid_director_context" });
  const creationKey = context
    ? await contentHash(
        JSON.stringify({
          rootRequestId: context.rootRequestId,
          title: args.title.trim(),
          items: inputs,
          maxCostCents: args.maxCostCents,
        }),
      )
    : undefined;
  if (args.creationKey !== undefined && args.creationKey !== creationKey)
    throw new ConvexError({ code: "CAMPAIGN_REFUSED", reason: "invalid_creation_key" });
  if (creationKey) {
    const existing = await ctx.db
      .query("mediaCampaigns")
      .withIndex("by_tenant_creationKey", (q) =>
        q.eq("tenantId", args.tenantId).eq("creationKey", creationKey),
      )
      .unique();
    if (existing) {
      if (existing.threadId !== args.threadId) throw new Error("CAMPAIGN_CREATION_THREAD_MISMATCH");
      const videoInputs = inputs.filter((item) => item.kind === "video");
      return {
        campaignId: existing._id,
        videoPlans: existing.items
          .filter((item) => item.kind === "video")
          .map((item, index) => {
            const input = videoInputs[index];
            if (!input) throw new Error("CAMPAIGN_CREATION_MISMATCH");
            return { planId: item.planId, brief: input.brief };
          }),
      };
    }
  }
  const now = Date.now();
  const campaignId = await ctx.db.insert("mediaCampaigns", {
    tenantId: args.tenantId,
    threadId: args.threadId,
    title: args.title.trim(),
    status: "draft",
    maxCostCents: args.maxCostCents,
    reservedCents: 0,
    concurrency: MEDIA_CAMPAIGN_CONCURRENCY,
    items: [],
    createdAt: now,
    updatedAt: now,
    ...(creationKey ? { creationKey } : {}),
  });
  const items: Item[] = [];
  const brand = await approvedBrandForTenant(ctx, args.tenantId);
  const videoPlans: StageResult["videoPlans"] = [];
  for (const input of inputs) {
    const imagePrompt =
      input.kind === "image"
        ? [input.prompt.trim(), ...(brand ? [brandImageDirection(brand.kit)] : [])].join("\n\n")
        : undefined;
    if (imagePrompt && new TextEncoder().encode(imagePrompt).length > 4096)
      throw new ConvexError({ code: "CAMPAIGN_REFUSED", reason: "invalid_prompt" });
    const planId = await ctx.db.insert("plans", {
      tenantId: args.tenantId,
      threadId: args.threadId,
      subject: input.label,
      kind: input.kind === "image" ? "media" : "memo",
      mediaMode: input.kind === "image" ? "image" : "reel",
      ...(input.kind === "video" ? { mediaAudioMode: "native" as const } : {}),
      mediaCampaignId: campaignId,
      ...(brand
        ? {
            brandKitRef: {
              docId: brand.docId,
              revision: brand.revision,
              contentHash: brand.contentHash,
            },
          }
        : {}),
      ...(input.kind === "image" ? { mediaImageQuality: MEDIA_DEFAULT_IMAGE_QUALITY } : {}),
      ...(imagePrompt === undefined ? {} : { imagePrompt }),
      status: input.kind === "image" ? "proposed" : "collecting",
      createdAt: now,
    });
    items.push({
      planId,
      kind: input.kind,
      label: input.label.trim(),
      estimateCents: 0,
      status: input.kind === "image" ? "ready" : "proposal",
    });
    if (input.kind === "video") videoPlans.push({ planId, brief: input.brief.trim() });
  }
  await ctx.db.patch(campaignId, { items });
  if (context)
    for (const video of videoPlans)
      await ctx.scheduler.runAfter(0, internal.dispatchRun.startDispatchRun, {
        kind: "media",
        tenantId: args.tenantId,
        threadId: args.threadId,
        planId: video.planId,
        gapIndex: 0,
        route: "media",
        question: video.brief,
        rootRequestId: context.rootRequestId,
        // Verified against llm.ts EXECUTIVE_AGENT_ID; importing that node module here is forbidden.
        parentAgentId: "executive",
        depth: 1,
        ancestry: [],
        envelopeCents: context.envelopeCents,
        spentCents: 0,
        skillVersions: context.skillVersions,
        tenantSkillIds: context.tenantSkillIds,
      });
  return { campaignId, videoPlans };
}

export const stage = internalMutation({
  args: stageArgs,
  handler: stageCampaignInner,
});

type CampaignView = {
  id: Id<"mediaCampaigns">;
  threadId: string;
  title: string;
  status: CampaignStatus;
  updatedAt: number;
  reviewHash: string;
  maxCostCents: number;
  reservedCents: number;
  nextMaximumCents: number;
  cancelled: boolean;
  tenantBusy: boolean;
  dailyRemainingCents: number;
  dailyLimitCents: number;
  dailyWindowStartMs: number;
  deploymentRemainingCents: number;
  items: {
    planId: Id<"plans">;
    kind: "image" | "video";
    label: string;
    status: Item["status"];
    estimateCents: number;
    refusal: string | null;
    failureReason: string | null;
    downloadable: boolean;
    musicCredit: Doc<"plans">["musicCredit"] | null;
  }[];
};

/** Native children bind current generation/pricing policy as well as their reviewed plan rows.
 * Preserve the exact legacy review digest when no child uses the new native workflow. */
async function campaignReviewHash(plans: readonly Doc<"plans">[]): Promise<string> {
  if (!plans.some((plan) => plan.mediaAudioMode === "native"))
    return contentHash(JSON.stringify(plans));
  return contentHash(
    JSON.stringify({
      plans,
      nativeReviews: await Promise.all(
        plans.map((plan) => (plan.mediaAudioMode === "native" ? nativeReelReviewHash(plan) : null)),
      ),
    }),
  );
}

async function campaignView(
  ctx: QueryCtx & { tenantId: string },
  campaign: Doc<"mediaCampaigns">,
  active: Doc<"mediaCampaigns"> | null,
): Promise<CampaignView> {
  const items: CampaignView["items"] = [];
  const reviewedPlans: Doc<"plans">[] = [];
  for (const item of campaign.items) {
    const plan = await ctx.db.get(item.planId);
    // A corrupt manifest must not become a cross-tenant signed-download capability.
    if (
      !plan ||
      plan.tenantId !== ctx.tenantId ||
      plan.threadId !== campaign.threadId ||
      plan.mediaCampaignId !== campaign._id
    )
      throw new Error("CAMPAIGN_PLAN_NOT_OWNED");
    reviewedPlans.push(plan);
    const estimate =
      item.status === "ready" || item.status === "proposal" || item.status === "failed"
        ? plan.status === "collecting"
          ? { ok: false as const, reason: "planning_in_progress" }
          : await estimateCampaignPlanInner(ctx, ctx.tenantId, item.planId)
        : null;
    items.push({
      planId: item.planId,
      kind: item.kind,
      label: item.label,
      status: item.status === "proposal" && estimate?.ok ? "ready" : item.status,
      estimateCents: estimate?.ok ? campaignMaximumCents(estimate.estUsd) : item.estimateCents,
      refusal: estimate && !estimate.ok ? estimate.reason : null,
      failureReason: item.failureReason ?? null,
      downloadable: item.status === "succeeded",
      musicCredit: plan.musicCredit ?? null,
    });
  }
  return {
    id: campaign._id,
    threadId: campaign.threadId,
    title: campaign.title,
    status: campaign.status,
    updatedAt: campaign.updatedAt,
    reviewHash: await campaignReviewHash(reviewedPlans),
    ...(await mediaDailyBudgetInner(ctx, ctx.tenantId)),
    maxCostCents: campaign.maxCostCents,
    reservedCents: campaign.reservedCents,
    nextMaximumCents: items
      .filter((item) => item.status === "ready")
      .reduce((n, item) => n + item.estimateCents, 0),
    cancelled: campaign.cancelledAt !== undefined,
    tenantBusy: active !== null && active._id !== campaign._id,
    items,
  };
}

export const byId = tenantQuery({
  args: { threadId: v.string(), campaignId: v.id("mediaCampaigns") },
  handler: async (ctx, { threadId, campaignId }): Promise<CampaignView | null> => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign || campaign.tenantId !== ctx.tenantId || campaign.threadId !== threadId)
      return null;
    return campaignView(ctx, campaign, await activeCampaign(ctx, ctx.tenantId));
  },
});

/** Bounded parent manifests; owned final bytes stay downloadable even after a sibling fails. */
export const list = tenantQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<CampaignView[]> => {
    const campaigns = await ctx.db
      .query("mediaCampaigns")
      .withIndex("by_tenant_thread", (q) => q.eq("tenantId", ctx.tenantId).eq("threadId", threadId))
      .order("desc")
      .take(5);
    const active = await activeCampaign(ctx, ctx.tenantId);
    return Promise.all(campaigns.map((campaign) => campaignView(ctx, campaign, active)));
  },
});

function ownsCampaignItem(
  plan: Doc<"plans"> | null,
  campaign: Doc<"mediaCampaigns">,
  item: Item,
): plan is Doc<"plans"> {
  return !!(
    plan &&
    plan.tenantId === campaign.tenantId &&
    plan.threadId === campaign.threadId &&
    plan.mediaCampaignId === campaign._id &&
    plan.mediaMode === (item.kind === "image" ? "image" : "reel")
  );
}

/** Both download paths resolve current owned rows, never a caller URL or an old final during retry. */
async function currentCampaignDownload(
  ctx: QueryCtx,
  campaign: Doc<"mediaCampaigns">,
  item: Item,
  plan: Doc<"plans">,
): Promise<{ url: string; captioned: boolean; musicCredit: string | null } | null> {
  if (!ownsCampaignItem(plan, campaign, item)) throw new Error("CAMPAIGN_PLAN_NOT_OWNED");
  if (item.status !== "succeeded" || !item.batchId) return null;
  if (item.kind === "image") {
    const jobs = await readMediaBatch(ctx, campaign.tenantId, item.batchId);
    if (jobs.some((job) => job.planId !== item.planId)) throw new Error("CAMPAIGN_BATCH_NOT_OWNED");
    const images = jobs.filter((job) => job.kind === "image" && job.blockIndex === 0);
    const image = images.length === 1 ? images[0] : undefined;
    const latest = await ctx.db
      .query("mediaJobs")
      .withIndex("by_plan_slot_kind_created", (q) =>
        q
          .eq("tenantId", campaign.tenantId)
          .eq("planId", plan._id)
          .eq("blockIndex", 0)
          .eq("kind", "image"),
      )
      .order("desc")
      .take(2);
    if (
      !image?.assetStorageId ||
      image.status !== "succeeded" ||
      latest[0]?._id !== image._id ||
      (latest[1] && latest[0]?.createdAt === latest[1].createdAt)
    )
      return null;
    const url = await ctx.storage.getUrl(image.assetStorageId);
    return url ? { url, captioned: false, musicCredit: null } : null;
  }
  if (
    plan.renderStatus !== "rendered" ||
    !plan.renderStorageId ||
    !plan.sidecarStorageId ||
    !plan.renderSummary ||
    (plan.captionStatus && ["pending", "transcribing", "burning"].includes(plan.captionStatus))
  )
    return null;
  const url = await ctx.storage.getUrl(plan.renderStorageId);
  return url
    ? {
        url,
        captioned: plan.captionStatus === "captioned",
        musicCredit: plan.musicCredit?.attribution ?? null,
      }
    : null;
}

/** Mint the bearer URL for the one artifact the human requested, never all hidden manifests. */
export const download = tenantQuery({
  args: { campaignId: v.id("mediaCampaigns"), itemIndex: v.number() },
  handler: async (ctx, { campaignId, itemIndex }): Promise<string | null> => {
    const campaign = await ownedCampaign(ctx, ctx.tenantId, campaignId);
    const item = Number.isInteger(itemIndex) ? campaign.items[itemIndex] : undefined;
    if (item?.status !== "succeeded") return null;
    const plan = await ctx.db.get(item.planId);
    if (!ownsCampaignItem(plan, campaign, item)) throw new Error("CAMPAIGN_PLAN_NOT_OWNED");
    return (await currentCampaignDownload(ctx, campaign, item, plan))?.url ?? null;
  },
});

type CampaignDownloadManifest = {
  campaignId: Id<"mediaCampaigns">;
  threadId: string;
  title: string;
  total: number;
  entries: {
    index: number;
    label: string;
    kind: Item["kind"];
    url: string;
    captioned: boolean;
    musicCredit: string | null;
  }[];
  omitted: {
    index: number;
    label: string;
    status: Item["status"];
    reason: "not_ready" | "final_unavailable";
  }[];
};

/** Explicit human download: one bounded transactional snapshot; never subscribe/persist these URLs. */
export const downloadManifest = tenantQuery({
  args: { campaignId: v.id("mediaCampaigns"), threadId: v.string() },
  handler: async (ctx, { campaignId, threadId }): Promise<CampaignDownloadManifest | null> => {
    const campaign = await ctx.db.get(campaignId);
    if (
      !campaign ||
      campaign.tenantId !== ctx.tenantId ||
      campaign.threadId !== threadId ||
      !threadId.trim() ||
      threadId.length > 512 ||
      !campaign.title.trim() ||
      campaign.title.length > 120 ||
      campaign.items.length < 1 ||
      campaign.items.length > MEDIA_CAMPAIGN_MAX_ITEMS ||
      new Set(campaign.items.map((item) => item.planId)).size !== campaign.items.length ||
      campaign.items.some((item) => !item.label.trim() || item.label.length > 160)
    )
      return null;
    const plans = await Promise.all(campaign.items.map((item) => ctx.db.get(item.planId)));
    // Validate ALL membership before resolving even one capability, including unfinished siblings.
    if (
      campaign.items.some((item, index) => !ownsCampaignItem(plans[index] ?? null, campaign, item))
    )
      return null;
    const manifest: CampaignDownloadManifest = {
      campaignId,
      threadId,
      title: campaign.title,
      total: campaign.items.length,
      entries: [],
      omitted: [],
    };
    for (const [index, item] of campaign.items.entries()) {
      const plan = plans[index];
      if (!plan) return null;
      let downloadable: Awaited<ReturnType<typeof currentCampaignDownload>>;
      try {
        downloadable = await currentCampaignDownload(ctx, campaign, item, plan);
      } catch {
        return null;
      }
      if (downloadable)
        manifest.entries.push({ index, label: item.label, kind: item.kind, ...downloadable });
      else
        manifest.omitted.push({
          index,
          label: item.label,
          status: item.status,
          reason: item.status === "succeeded" ? "final_unavailable" : "not_ready",
        });
    }
    return manifest;
  },
});

const approvalArgs = {
  campaignId: v.id("mediaCampaigns"),
  expectedUpdatedAt: v.number(),
  expectedReviewHash: v.string(),
  maxCostCents: v.number(),
  itemIndexes: v.optional(v.array(v.number())),
  approvedDailyIncreaseCents: v.optional(v.number()),
  expectedDailyWindowStartMs: v.optional(v.number()),
};
type ApprovalResult = { ok: true } | { ok: false; reason: string };

/** Public human approval. A nested mutation gives all-or-none reservation and a governed refusal. */
export const approve = tenantMutation({
  args: approvalArgs,
  handler: async (ctx, args): Promise<ApprovalResult> => {
    await ownedCampaign(ctx, ctx.tenantId, args.campaignId);
    // The outer transaction preserves coverage even if an expected refusal rolls back the
    // nested all-or-none reservations. A refused media gate is a confident zero, not ignorance.
    await ensureCoverage(ctx, ctx.tenantId, Date.now());
    try {
      await ctx.runMutation(internal.mediaCampaign.reserveApproved, {
        ...args,
        tenantId: ctx.tenantId,
      });
      return { ok: true };
    } catch (error) {
      if (
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "code" in error.data &&
        error.data.code === "CAMPAIGN_REFUSED" &&
        "reason" in error.data &&
        typeof error.data.reason === "string"
      )
        return { ok: false, reason: error.data.reason };
      throw error;
    }
  },
});

export const reserveApproved = internalMutation({
  args: { ...approvalArgs, tenantId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const campaign = await ownedCampaign(ctx, args.tenantId, args.campaignId);
    function refuse(reason: string): never {
      throw new ConvexError({ code: "CAMPAIGN_REFUSED", reason });
    }
    if (campaign.updatedAt !== args.expectedUpdatedAt) refuse("stale_campaign");
    const active = await activeCampaign(ctx, args.tenantId);
    if (active && active._id !== campaign._id) refuse("tenant_campaign_in_flight");
    const reviewedPlans: Doc<"plans">[] = [];
    for (const item of campaign.items) {
      const plan = await ctx.db.get(item.planId);
      if (!plan || plan.tenantId !== args.tenantId || plan.mediaCampaignId !== campaign._id)
        refuse("plan_not_owned");
      reviewedPlans.push(plan);
    }
    if ((await campaignReviewHash(reviewedPlans)) !== args.expectedReviewHash)
      refuse("stale_review");
    if (
      campaign.cancelledAt ||
      campaign.items.some((item) =>
        ["running", "reserved", "needs_reconciliation"].includes(item.status),
      )
    )
      refuse("campaign_in_flight");
    if (!Number.isSafeInteger(args.maxCostCents) || args.maxCostCents < 0)
      refuse("invalid_maximum");
    const selected =
      args.itemIndexes ??
      campaign.items.flatMap((item, index) =>
        item.status === "ready" || item.status === "proposal" ? [index] : [],
      );
    if (
      !selected.length ||
      selected.length > campaign.items.length ||
      new Set(selected).size !== selected.length
    )
      refuse("invalid_selection");
    const items = campaign.items.map((item) => ({ ...item }));
    let maximum = 0;
    for (const index of selected) {
      const item = Number.isInteger(index) ? items[index] : undefined;
      if (!item || !["ready", "proposal", "failed"].includes(item.status))
        refuse("invalid_selection");
      const plan = await ctx.db.get(item.planId);
      if (!plan || plan.tenantId !== args.tenantId || plan.mediaCampaignId !== campaign._id)
        refuse("plan_not_owned");
      if (plan.status === "collecting") refuse("planning_in_progress");
      const estimate = await estimateCampaignPlanInner(ctx, args.tenantId, item.planId);
      if (!estimate.ok) refuse(estimate.reason);
      item.estimateCents = campaignMaximumCents(estimate.estUsd);
      maximum += item.estimateCents;
    }
    if (campaign.reservedCents + maximum > args.maxCostCents) refuse("campaign_maximum_exceeded");
    const daily = await mediaDailyBudgetInner(ctx, args.tenantId);
    if (maximum > daily.deploymentRemainingCents) refuse("deployment_media_exhausted");
    const requiredIncreaseCents = mediaTaskIncreaseCents(maximum, daily.dailyRemainingCents);
    if (requiredIncreaseCents === null) refuse("invalid_maximum");
    if (args.approvedDailyIncreaseCents !== undefined) {
      if (
        !Number.isSafeInteger(args.approvedDailyIncreaseCents) ||
        args.approvedDailyIncreaseCents <= 0 ||
        args.approvedDailyIncreaseCents !== requiredIncreaseCents ||
        args.expectedDailyWindowStartMs !== daily.dailyWindowStartMs
      )
        refuse("stale_daily_limit_review");
    } else if (requiredIncreaseCents > 0) refuse("daily_limit_increase_required");
    const dailyOverage: MediaDailyOverageAllowance = {
      tenantId: args.tenantId,
      campaignId: campaign._id,
      remainingCents: args.approvedDailyIncreaseCents ?? 0,
    };
    for (const index of selected) {
      const item = items[index];
      if (!item) refuse("invalid_selection");
      const reserved = await reserveCampaignPlanInner(
        ctx,
        args.tenantId,
        item.planId,
        dailyOverage,
      );
      if (!reserved.ok) refuse(reserved.reason);
      // Any race/config drift rolls the whole subtransaction back, including all earlier reserves.
      if (campaignMaximumCents(reserved.estUsd) > item.estimateCents) refuse("estimate_changed");
      item.status = "reserved";
      item.batchId = reserved.batchId;
      delete item.startedAt;
      delete item.failureReason;
    }
    if (requiredIncreaseCents > 0) {
      if (dailyOverage.remainingCents !== 0) refuse("estimate_changed");
      await ctx.runMutation(internal.audit.log, {
        tenantId: args.tenantId,
        correlationId: `media-campaign-increase:${campaign._id}:${campaign.updatedAt}`,
        eventType: "media.campaign_task_budget_approved",
        actor: "user",
        payload: {
          campaignId: campaign._id,
          selectedCount: selected.length,
          approvedExtraCents: requiredIncreaseCents,
          maximumCents: maximum,
          dailyWindowStartMs: daily.dailyWindowStartMs,
        },
      });
    }
    const updatedAt = Math.max(Date.now(), campaign.updatedAt + 1);
    await ctx.db.patch(campaign._id, {
      items,
      status: "running",
      maxCostCents: args.maxCostCents,
      reservedCents: campaign.reservedCents + maximum,
      updatedAt,
    });
    await ctx.scheduler.runAfter(0, internal.mediaCampaign.advance, {
      tenantId: args.tenantId,
      campaignId: campaign._id,
      expectedUpdatedAt: updatedAt,
    });
  },
});

/** Durable claim of whole deliverables before scheduling existing exactly-once provider claims. */
async function advanceInner(ctx: MutationCtx, campaign: Doc<"mediaCampaigns">): Promise<void> {
  const now = Date.now();
  const items = campaign.items.map((item) => ({ ...item }));
  for (const item of items) {
    if ((item.status !== "running" && item.status !== "needs_reconciliation") || !item.batchId)
      continue;
    const plan = await ctx.db.get(item.planId);
    if (!plan || plan.tenantId !== campaign.tenantId || plan.mediaCampaignId !== campaign._id) {
      item.status = "needs_reconciliation";
      item.failureReason = "plan_not_owned";
      continue;
    }
    const jobs = await readMediaBatch(ctx, campaign.tenantId, item.batchId);
    const picture = jobs.find((job) => job.kind === "image");
    const ready =
      item.kind === "image"
        ? picture?.status === "succeeded" && !!picture.assetStorageId
        : plan.renderStatus === "rendered" &&
          !!plan.renderStorageId &&
          !!plan.sidecarStorageId &&
          !!plan.renderSummary;
    const active = jobs.some(
      (job) => job.status === "submitted" || (job.status === "queued" && job.kind !== "stt"),
    );
    const failures = jobs.filter((job) => job.status === "failed" || job.status === "blocked");
    const captionsActive =
      item.kind === "video" &&
      plan.captionStatus !== undefined &&
      ["pending", "transcribing", "burning"].includes(plan.captionStatus);
    if (ready && !captionsActive) item.status = "succeeded";
    else if (!active && failures.length) {
      item.failureReason =
        failures.find((job) => ambiguousCampaignFailure(job.failureReason))?.failureReason ??
        failures[0]?.failureReason;
      item.status = failures.some((job) => ambiguousCampaignFailure(job.failureReason))
        ? "needs_reconciliation"
        : "failed";
    } else if (!active && item.kind === "video" && plan.renderStatus === "failed") {
      item.status = "failed";
      item.failureReason = plan.renderReason ?? "render_failed";
    } else if (now - (item.startedAt ?? now) >= MEDIA_CAMPAIGN_SETTLEMENT_MS) {
      item.status = "needs_reconciliation";
      item.failureReason = "settlement_timeout";
    }
  }
  for (const index of campaignStartIndexes(
    items,
    campaign.cancelledAt !== undefined,
    campaign.concurrency,
  )) {
    const item = items[index];
    if (!item?.batchId) throw new Error("CAMPAIGN_RESERVATION_MISSING");
    item.status = "running";
    item.startedAt = now;
    await ctx.scheduler.runAfter(0, internal.media.submitBatch, {
      tenantId: campaign.tenantId,
      batchId: item.batchId,
    });
  }
  const status = campaignStatus(items, campaign.cancelledAt !== undefined);
  const updatedAt = Math.max(now, campaign.updatedAt + 1);
  await ctx.db.patch(campaign._id, { items, status, updatedAt });
  // ponytail: two durable workers per campaign; a two-hour settlement ceiling stops orphan polling.
  // Unknown paid outcomes freeze the queue. Operator reconciliation, never blind repurchase, resumes it.
  if (status === "running")
    await ctx.scheduler.runAfter(5000, internal.mediaCampaign.advance, {
      tenantId: campaign.tenantId,
      campaignId: campaign._id,
      expectedUpdatedAt: updatedAt,
    });
}

export const advance = internalMutation({
  args: { tenantId: v.string(), campaignId: v.id("mediaCampaigns"), expectedUpdatedAt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const campaign = await ownedCampaign(ctx, args.tenantId, args.campaignId);
    if (campaign.status !== "running" || campaign.updatedAt !== args.expectedUpdatedAt) return;
    await advanceInner(ctx, campaign);
  },
});

/** Re-check a late callback after a settlement timeout without creating another purchase. */
export const refresh = tenantMutation({
  args: { campaignId: v.id("mediaCampaigns") },
  handler: async (ctx, { campaignId }): Promise<void> => {
    const campaign = await ownedCampaign(ctx, ctx.tenantId, campaignId);
    if (campaign.status === "running" || campaign.status === "needs_reconciliation")
      await advanceInner(ctx, campaign);
  },
});

export const cancel = tenantMutation({
  args: { campaignId: v.id("mediaCampaigns") },
  handler: async (ctx, { campaignId }): Promise<void> => {
    const campaign = await ownedCampaign(ctx, ctx.tenantId, campaignId);
    if (campaign.cancelledAt) return;
    const items = campaign.items.map((item) => ({ ...item }));
    for (const item of items) {
      if (!["ready", "proposal", "reserved"].includes(item.status)) continue;
      if (item.batchId) {
        // A stray external submit has to settle; never call an already submitted purchase cancelled.
        if (!(await cancelQueuedCampaignBatchInner(ctx, campaign, item.planId, item.batchId))) {
          item.status = "running";
          item.startedAt ??= Date.now();
          continue;
        }
      }
      item.status = "cancelled";
    }
    const next = { ...campaign, items, cancelledAt: Date.now() };
    const updatedAt = Math.max(Date.now(), campaign.updatedAt + 1);
    await ctx.db.patch(campaignId, {
      items,
      cancelledAt: next.cancelledAt,
      status: campaignStatus(items, true),
      updatedAt,
    });
    if (items.some((item) => item.status === "running"))
      await ctx.scheduler.runAfter(0, internal.mediaCampaign.advance, {
        tenantId: ctx.tenantId,
        campaignId,
        expectedUpdatedAt: updatedAt,
      });
  },
});
