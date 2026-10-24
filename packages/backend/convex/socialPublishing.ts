import {
  assertSocialScopes,
  publishingScopes,
  validateSocialDraft,
  validateSocialMedia,
} from "@pikar/core/socialPublishing";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, type MutationCtx } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";
import {
  socialProvider,
  youtubeConnectionMetadataBound,
  youtubeMetadataFresh,
  youtubePostMetadataBound,
  youtubePostMetadataCleared,
} from "./social";
import { claimOwnedUpload, issueUpload } from "./uploads";

export const assetValidator = v.object({
  id: v.string(),
  name: v.string(),
  kind: v.union(
    v.literal("facebook_page"),
    v.literal("instagram"),
    v.literal("youtube"),
    v.literal("tiktok"),
  ),
});
export const draftArgs = {
  provider: socialProvider,
  assetId: v.string(),
  text: v.string(),
  title: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  privacy: v.optional(v.string()),
  madeForKids: v.optional(v.boolean()),
  aiGenerated: v.optional(v.boolean()),
  ownBrand: v.optional(v.boolean()),
  paidPartnership: v.optional(v.boolean()),
  allowComments: v.optional(v.boolean()),
  allowDuet: v.optional(v.boolean()),
  allowStitch: v.optional(v.boolean()),
};
async function selected(
  ctx: MutationCtx,
  tenantId: string,
  provider: "x" | "meta" | "tiktok" | "youtube",
  assetId: string,
  connectionId?: string,
) {
  const row = await ctx.db
    .query("socialConnections")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("provider", provider))
    .unique();
  const asset = row?.assets?.find((a) => a.id === assetId);
  if (
    row?.status !== "connected" ||
    row.expiresAt <= Date.now() ||
    (provider === "youtube" && !youtubeMetadataFresh(youtubeConnectionMetadataBound(row))) ||
    !asset ||
    !row.selectedAssetIds?.includes(assetId) ||
    (connectionId && row.connectionId !== connectionId)
  )
    throw new Error("SOCIAL_ACCOUNT_NOT_SELECTED");
  return { row, asset };
}
export const saveAssets = internalMutation({
  args: {
    tenantId: v.string(),
    provider: socialProvider,
    connectionId: v.string(),
    assets: v.array(assetValidator),
  },
  handler: async (ctx, a) => {
    await assertTenantWritable(ctx, a.tenantId);
    if (a.assets.length > 100 || new Set(a.assets.map((x) => x.id)).size !== a.assets.length)
      throw new Error("SOCIAL_INVALID_ASSETS");
    const row = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", a.provider))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.status !== "connected" ||
      (a.provider === "youtube" && !youtubeMetadataFresh(youtubeConnectionMetadataBound(row)))
    )
      throw new Error("SOCIAL_RECONNECT");
    await ctx.db.patch(row._id, {
      assets: a.assets,
      // Cached saveAssets calls never count as refreshing YouTube API metadata.
      assetsCheckedAt: a.provider === "youtube" ? row.providerMetadataCheckedAt : Date.now(),
      selectedAssetIds: (row.selectedAssetIds ?? []).filter((id) =>
        a.assets.some((x) => x.id === id),
      ),
    });
  },
});
export const selectAccounts = tenantMutation({
  args: { provider: socialProvider, connectionId: v.string(), assetIds: v.array(v.string()) },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId).eq("provider", a.provider))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.status !== "connected" ||
      (a.provider === "youtube" && !youtubeMetadataFresh(youtubeConnectionMetadataBound(row))) ||
      a.assetIds.length > 100 ||
      new Set(a.assetIds).size !== a.assetIds.length ||
      !a.assetIds.every((id) => row.assets?.some((x) => x.id === id))
    )
      throw new Error("SOCIAL_INVALID_SELECTION");
    if (
      (row.selectedAssetIds ?? []).length === a.assetIds.length &&
      a.assetIds.every((id) => row.selectedAssetIds?.includes(id))
    )
      return;
    await ctx.db.patch(row._id, {
      selectedAssetIds: a.assetIds,
      selectionRevision: (row.selectionRevision ?? 0) + 1,
    });
  },
});
export const uploadUrl = tenantMutation({ args: {}, handler: (ctx) => issueUpload(ctx) });
async function stage(
  ctx: MutationCtx,
  tenantId: string,
  a: {
    provider: "x" | "meta" | "youtube" | "tiktok";
    assetId: string;
    text: string;
    title?: string;
    storageId?: import("./_generated/dataModel").Id<"_storage">;
    privacy?: string;
    madeForKids?: boolean;
    aiGenerated?: boolean;
    ownBrand?: boolean;
    paidPartnership?: boolean;
    allowComments?: boolean;
    allowDuet?: boolean;
    allowStitch?: boolean;
  },
  customerChoicesConfirmed: boolean,
) {
  await assertTenantWritable(ctx, tenantId);
  const { row, asset } = await selected(ctx, tenantId, a.provider, a.assetId);
  validateSocialDraft(a, asset.kind);
  if (a.storageId) {
    const owned = await claimOwnedUpload(ctx, tenantId, a.storageId);
    validateSocialMedia(asset.kind, owned.size ?? 0, owned.mimeType);
  }
  const drafts = await ctx.db
    .query("socialPosts")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .order("desc")
    .take(100);
  if (drafts.filter((d) => d.status === "draft").length >= 50)
    throw new Error("SOCIAL_DRAFT_LIMIT");
  return ctx.db.insert("socialPosts", {
    ...a,
    tenantId,
    connectionId: row.connectionId,
    assetName: asset.name,
    ...(a.provider === "youtube"
      ? { providerMetadataCheckedAt: row.providerMetadataCheckedAt }
      : {}),
    kind: asset.kind,
    selectionRevision: row.selectionRevision ?? 0,
    customerChoicesConfirmed,
    status: "draft",
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}
export const stagePost = tenantMutation({
  args: draftArgs,
  handler: (ctx, a) => stage(ctx, ctx.tenantId, a, true),
});
export const stageAgentPost = internalMutation({
  args: { tenantId: v.string(), ...draftArgs },
  handler: (ctx, { tenantId, ...a }) => stage(ctx, tenantId, a, false),
});
export const posts = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("socialPosts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(50);
    const youtube = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId).eq("provider", "youtube"))
      .unique();
    return Promise.all(
      rows.map(async (p) => ({
        ...p,
        ...(p.provider === "youtube" &&
        (!youtubeMetadataFresh(youtubePostMetadataBound(p, youtube)) ||
          !youtubeMetadataFresh(youtubeConnectionMetadataBound(youtube)) ||
          youtube?.connectionId !== p.connectionId ||
          youtube.status !== "connected")
          ? youtubePostMetadataCleared()
          : {}),
        mediaUrl: p.storageId ? await ctx.storage.getUrl(p.storageId) : null,
      })),
    );
  },
});
export const discardPost = tenantMutation({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.postId);
    if (!p || p.tenantId !== ctx.tenantId || p.status !== "draft")
      throw new Error("SOCIAL_DRAFT_CHANGED");
    await ctx.db.patch(p._id, { status: "discarded", updatedAt: Date.now() });
  },
});
export const approvePost = tenantMutation({
  args: { postId: v.id("socialPosts"), revision: v.number() },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.postId);
    if (!p || p.tenantId !== ctx.tenantId || p.status !== "draft" || p.revision !== a.revision)
      throw new Error("SOCIAL_DRAFT_CHANGED");
    const { row, asset } = await selected(ctx, ctx.tenantId, p.provider, p.assetId, p.connectionId);
    if ((row.selectionRevision ?? 0) !== p.selectionRevision)
      throw new Error("SOCIAL_SELECTION_CHANGED");
    validateSocialDraft(p, asset.kind);
    if (p.kind === "tiktok" && p.customerChoicesConfirmed !== true)
      throw new Error("SOCIAL_TIKTOK_CUSTOMER_CHOICES_REQUIRED");
    assertSocialScopes(row.scopes, publishingScopes(p.kind));
    if (process.env[`SOCIAL_${p.provider.toUpperCase()}_PUBLISH_ENABLED`] !== "true")
      throw new Error("SOCIAL_PUBLISH_NOT_QUALIFIED");
    await ctx.db.patch(p._id, {
      status: "approved",
      approvedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.socialContentActions.publishPost, {
      tenantId: ctx.tenantId,
      postId: p._id,
    });
  },
});
export const claimPost = internalMutation({
  args: { tenantId: v.string(), postId: v.id("socialPosts") },
  handler: async (ctx, a) => {
    await assertTenantWritable(ctx, a.tenantId);
    const p = await ctx.db.get(a.postId);
    if (!p || p.tenantId !== a.tenantId || p.status !== "approved") return null;
    try {
      const { row } = await selected(ctx, a.tenantId, p.provider, p.assetId, p.connectionId);
      if ((row.selectionRevision ?? 0) !== p.selectionRevision)
        throw new Error("SOCIAL_SELECTION_CHANGED");
      if (p.kind === "tiktok" && p.customerChoicesConfirmed !== true)
        throw new Error("SOCIAL_TIKTOK_CUSTOMER_CHOICES_REQUIRED");
      assertSocialScopes(row.scopes, publishingScopes(p.kind));
      if (process.env[`SOCIAL_${p.provider.toUpperCase()}_PUBLISH_ENABLED`] !== "true")
        throw new Error("SOCIAL_PUBLISH_NOT_QUALIFIED");
    } catch {
      await ctx.db.patch(p._id, {
        status: "failed",
        failure: "account_or_permission_changed",
        updatedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.patch(p._id, { status: "submitting", updatedAt: Date.now() });
    return p;
  },
});
export const finishPost = internalMutation({
  args: {
    tenantId: v.string(),
    postId: v.id("socialPosts"),
    status: v.union(
      v.literal("sent"),
      v.literal("processing"),
      v.literal("unknown"),
      v.literal("failed"),
    ),
    providerPostId: v.optional(v.string()),
    failure: v.optional(v.string()),
  },
  handler: async (ctx, { tenantId, postId, ...a }) => {
    const p = await ctx.db.get(postId);
    if (!p || p.tenantId !== tenantId || p.status !== "submitting") return;
    if (p.provider === "youtube") {
      const row = await ctx.db
        .query("socialConnections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("provider", "youtube"))
        .unique();
      if (
        !row ||
        row.connectionId !== p.connectionId ||
        row.status !== "connected" ||
        !youtubeMetadataFresh(youtubeConnectionMetadataBound(row)) ||
        !youtubeMetadataFresh(youtubePostMetadataBound(p, row))
      ) {
        await ctx.db.patch(p._id, {
          ...youtubePostMetadataCleared(),
          status: "unknown",
          failure: "check_platform_before_retry",
          updatedAt: Date.now(),
        });
        return;
      }
    }
    await ctx.db.patch(p._id, { ...a, updatedAt: Date.now() });
  },
});
export const selectedConnection = internalQuery({
  args: {
    tenantId: v.string(),
    provider: socialProvider,
    connectionId: v.string(),
    assetId: v.string(),
  },
  handler: async (ctx, a) => {
    const revocation = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", a.tenantId))
      .unique();
    if (revocation?.state) throw new Error("SOCIAL_RECONNECT");
    const row = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", a.provider))
      .unique();
    const asset = row?.assets?.find((x) => x.id === a.assetId);
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.status !== "connected" ||
      (a.provider === "youtube" && !youtubeMetadataFresh(youtubeConnectionMetadataBound(row))) ||
      !asset ||
      !row.selectedAssetIds?.includes(a.assetId)
    )
      throw new Error("SOCIAL_ACCOUNT_NOT_SELECTED");
    return { asset, selectionRevision: row.selectionRevision ?? 0 };
  },
});

// TikTok may download for one hour after init; allow five minutes for the bounded init handoff.
const TIKTOK_MEDIA_LEASE_MS = 65 * 60 * 1000;
export const issueMediaTicket = internalMutation({
  args: { tenantId: v.string(), postId: v.id("socialPosts"), ticketHash: v.string() },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.postId);
    if (
      !p ||
      p.tenantId !== a.tenantId ||
      p.kind !== "tiktok" ||
      p.status !== "submitting" ||
      !p.storageId
    )
      throw new Error("SOCIAL_MEDIA_UNAVAILABLE");
    await selected(ctx, a.tenantId, p.provider, p.assetId, p.connectionId);
    await ctx.db.patch(p._id, {
      mediaTicketHash: a.ticketHash,
      mediaTicketExpiresAt: Date.now() + TIKTOK_MEDIA_LEASE_MS,
    });
  },
});
export const mediaForTicket = internalQuery({
  args: { postId: v.string(), ticketHash: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("socialPosts", a.postId);
    if (!id) return null;
    const p = await ctx.db.get(id);
    if (
      p?.kind !== "tiktok" ||
      !["submitting", "processing", "unknown"].includes(p.status) ||
      p.mediaTicketHash !== a.ticketHash ||
      (p.mediaTicketExpiresAt ?? 0) <= Date.now()
    )
      return null;
    const revoked = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", p.tenantId))
      .unique();
    if (revoked?.state) return null;
    const row = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", p.tenantId).eq("provider", p.provider))
      .unique();
    if (
      row?.status !== "connected" ||
      row.connectionId !== p.connectionId ||
      !row.selectedAssetIds?.includes(p.assetId) ||
      (row.selectionRevision ?? 0) !== p.selectionRevision
    )
      return null;
    // Ordinary OAuth expiry cannot interrupt this already-approved handoff. Revocation,
    // disconnect, changed connection/selection and the independent media lease still fence it.
    if (!p.storageId) return null;
    const owned = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_storage", (q) => q.eq("storageId", p.storageId))
      .unique();
    if (
      !owned ||
      owned.tenantId !== p.tenantId ||
      owned.state !== "complete" ||
      owned.expiresAt <= Date.now()
    )
      return null;
    return p.storageId;
  },
});
export const postForCheck = internalQuery({
  args: { tenantId: v.string(), postId: v.id("socialPosts") },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.postId);
    if (!p || p.tenantId !== a.tenantId || p.status !== "processing") return null;
    if (p.provider === "youtube") {
      const row = await ctx.db
        .query("socialConnections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", "youtube"))
        .unique();
      if (row?.status !== "connected" || !youtubeMetadataFresh(youtubePostMetadataBound(p, row)))
        return null;
    }
    return p;
  },
});
export const updateProcessing = internalMutation({
  args: {
    tenantId: v.string(),
    postId: v.id("socialPosts"),
    providerPostId: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
  },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.postId);
    if (
      !p ||
      p.tenantId !== a.tenantId ||
      p.status !== "processing" ||
      p.providerPostId !== a.providerPostId
    )
      return;
    if (p.provider === "youtube") {
      const row = await ctx.db
        .query("socialConnections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", "youtube"))
        .unique();
      if (
        !row ||
        row.connectionId !== p.connectionId ||
        row.status !== "connected" ||
        !youtubeMetadataFresh(youtubeConnectionMetadataBound(row)) ||
        !youtubeMetadataFresh(youtubePostMetadataBound(p, row))
      )
        return;
    }
    await ctx.db.patch(p._id, { status: a.status, updatedAt: Date.now() });
  },
});

/** Only an unapproved draft can change. A stale browser revision can never release new content. */
export const editDraft = tenantMutation({
  args: {
    postId: v.id("socialPosts"),
    revision: v.number(),
    text: v.string(),
    title: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const p = await ctx.db.get(a.postId);
    if (!p || p.tenantId !== ctx.tenantId || p.status !== "draft" || p.revision !== a.revision)
      throw new Error("SOCIAL_DRAFT_CHANGED");
    const { row, asset } = await selected(ctx, ctx.tenantId, p.provider, p.assetId, p.connectionId);
    if ((row.selectionRevision ?? 0) !== p.selectionRevision)
      throw new Error("SOCIAL_SELECTION_CHANGED");
    validateSocialDraft({ ...p, text: a.text, title: a.title ?? p.title }, asset.kind);
    await ctx.db.patch(p._id, {
      text: a.text,
      ...(a.title !== undefined ? { title: a.title } : {}),
      revision: p.revision + 1,
      updatedAt: Date.now(),
    });
  },
});
