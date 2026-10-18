import { BUFFER_ID, bufferCreateArguments, validateBufferDraft } from "@pikar/core/buffer";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";

const envelope = {
  ciphertextB64: v.string(),
  ivB64: v.string(),
  keyVersion: v.union(v.literal("v1"), v.literal("v2")),
};
const channel = v.object({
  id: v.string(),
  name: v.string(),
  service: v.string(),
  available: v.boolean(),
  boards: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))),
});
const draftArgs = {
  campaign: v.string(),
  channelId: v.string(),
  text: v.string(),
  imageUrl: v.optional(v.string()),
  videoUrl: v.optional(v.string()),
  mediaTitle: v.optional(v.string()),
  categoryId: v.optional(v.string()),
  boardId: v.optional(v.string()),
  isAiGenerated: v.optional(v.boolean()),
  mode: v.union(v.literal("addToQueue"), v.literal("customScheduled")),
  dueAt: v.optional(v.number()),
};

export const status = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    return {
      configured:
        !!process.env.CONNECTOR_CREDENTIAL_KEY_V1 &&
        !!process.env.CONVEX_SITE_URL &&
        !!process.env.SITE_URL,
      connected: row?.status === "connected",
      status: row?.status ?? "disconnected",
      organizationId: row?.organizationId ?? null,
      organizationName: row?.organizationName ?? null,
      channels: row?.channels ?? [],
      selectedChannelIds: row?.selectedChannelIds ?? [],
      dailyReports: row?.dailyReports ?? false,
    };
  },
});

export const connection = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const revocation = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", tenantId))
      .unique();
    if (revocation?.state) throw new Error("BUFFER_RECONNECT");
    return ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
  },
});

export const storeState = internalMutation({
  args: { tenantId: v.string(), stateHash: v.string(), connectionId: v.string(), ...envelope },
  handler: async (ctx, args) => {
    await assertTenantWritable(ctx, args.tenantId);
    const pending = await ctx.db
      .query("bufferOAuthStates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(20);
    for (const row of pending) await ctx.db.delete(row._id);
    await ctx.db.insert("bufferOAuthStates", {
      ...args,
      phase: "request",
      expiresAt: Date.now() + 10 * 60_000,
    });
  },
});

/** Public callback exception: one domain-separated nonce hash; consumed before token exchange. */
export const consumeState = internalMutation({
  args: { stateHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("bufferOAuthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      await ctx.db.delete(row._id);
      return null;
    }
    if (row.phase !== "request") return null;
    await assertTenantWritable(ctx, row.tenantId);
    // Keep a cancellation fence while the external token exchange is in flight.
    await ctx.db.patch(row._id, { phase: "exchanging" });
    return row;
  },
});

export const storePendingGrant = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    requestStateHash: v.string(),
    stateHash: v.string(),
    tokenExpiresAt: v.number(),
    ...envelope,
  },
  handler: async (ctx, a) => {
    await assertTenantWritable(ctx, a.tenantId);
    const request = await ctx.db
      .query("bufferOAuthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", a.requestStateHash))
      .unique();
    if (
      !request ||
      request.tenantId !== a.tenantId ||
      request.connectionId !== a.connectionId ||
      request.phase !== "exchanging" ||
      request.expiresAt <= Date.now()
    )
      throw new Error("BUFFER_INVALID_STATE");
    const { requestStateHash: _requestStateHash, ...pending } = a;
    await ctx.db.delete(request._id);
    await ctx.db.insert("bufferOAuthStates", {
      ...pending,
      phase: "complete",
      expiresAt: Date.now() + 10 * 60_000,
    });
  },
});

/** Finish on the authenticated app origin, preventing account-linking across browser accounts. */
export const completeConnect = tenantMutation({
  args: { receipt: v.string() },
  handler: async (ctx, { receipt }) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(receipt)) throw new Error("BUFFER_INVALID_STATE");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`buffer-state:${receipt}`),
    );
    const stateHash = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const pending = await ctx.db
      .query("bufferOAuthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", stateHash))
      .unique();
    if (
      !pending ||
      pending.tenantId !== ctx.tenantId ||
      pending.phase !== "complete" ||
      pending.expiresAt <= Date.now() ||
      !pending.tokenExpiresAt
    )
      throw new Error("BUFFER_INVALID_STATE");
    const old = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    const row = {
      tenantId: ctx.tenantId,
      connectionId: pending.connectionId,
      ciphertextB64: pending.ciphertextB64,
      ivB64: pending.ivB64,
      keyVersion: pending.keyVersion,
      expiresAt: pending.tokenExpiresAt,
      status: "connected" as const,
      revision: (old?.revision ?? 0) + 1,
      updatedAt: Date.now(),
      channels: [],
      selectedChannelIds: [],
      dailyReports: false,
      nextReportAt: Date.now(),
      organizationId: undefined,
      organizationName: undefined,
      refreshLease: undefined,
      refreshStartedAt: undefined,
    };
    if (old) await ctx.db.replace(old._id, row);
    else await ctx.db.insert("bufferConnections", row);
    await ctx.db.delete(pending._id);
  },
});

/** A refresh may be attempted only once per token revision; an abandoned lease requires re-consent. */
export const claimRefresh = internalMutation({
  args: { tenantId: v.string(), connectionId: v.string(), revision: v.number(), lease: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.status !== "connected" ||
      row.revision !== a.revision
    )
      return false;
    if (row.refreshLease) {
      if ((row.refreshStartedAt ?? 0) < Date.now() - 60_000) {
        await ctx.db.patch(row._id, {
          status: "reauth_required",
          dailyReports: false,
          updatedAt: Date.now(),
        });
      }
      return false;
    }
    await ctx.db.patch(row._id, { refreshLease: a.lease, refreshStartedAt: Date.now() });
    return true;
  },
});

export const finishRefresh = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    revision: v.number(),
    lease: v.string(),
    expiresAt: v.optional(v.number()),
    credential: v.optional(v.object(envelope)),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.status !== "connected" ||
      row.revision !== a.revision ||
      row.refreshLease !== a.lease
    )
      return false;
    if (!a.credential || !a.expiresAt) {
      await ctx.db.patch(row._id, {
        status: "reauth_required",
        dailyReports: false,
        refreshLease: undefined,
        refreshStartedAt: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(row._id, {
        ...a.credential,
        expiresAt: a.expiresAt,
        revision: row.revision + 1,
        refreshLease: undefined,
        refreshStartedAt: undefined,
        updatedAt: Date.now(),
      });
    }
    return true;
  },
});

export const storeChannels = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    organizationId: v.string(),
    organizationName: v.string(),
    channels: v.array(channel),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (!row || row.status !== "connected" || row.connectionId !== a.connectionId)
      throw new Error("BUFFER_RECONNECT");
    if (a.channels.length > 100 || !BUFFER_ID.test(a.organizationId))
      throw new Error("BUFFER_INVALID_CHANNELS");
    await ctx.db.patch(row._id, {
      organizationId: a.organizationId,
      organizationName: a.organizationName.slice(0, 160),
      channels: a.channels,
      selectedChannelIds:
        row.organizationId === a.organizationId
          ? row.selectedChannelIds.filter((id) =>
              a.channels.some((c) => c.id === id && c.available),
            )
          : [],
      dailyReports: row.organizationId === a.organizationId && row.dailyReports,
      updatedAt: Date.now(),
    });
  },
});

export const selectChannels = tenantMutation({
  args: { channelIds: v.array(v.string()), dailyReports: v.boolean() },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    const unique = [...new Set(a.channelIds)];
    if (!row || row.status !== "connected" || !row.organizationId)
      throw new Error("BUFFER_RECONNECT");
    if (
      unique.length > 100 ||
      unique.some((id) => !row.channels.some((c) => c.id === id && c.available))
    )
      throw new Error("BUFFER_CHANNEL_NOT_ALLOWED");
    await ctx.db.patch(row._id, {
      selectedChannelIds: unique,
      dailyReports: a.dailyReports && unique.length > 0,
      nextReportAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const disconnect = tenantMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (row)
      await ctx.db.patch(row._id, {
        status: "disconnected",
        ciphertextB64: undefined,
        ivB64: undefined,
        revision: row.revision + 1,
        refreshLease: undefined,
        refreshStartedAt: undefined,
        selectedChannelIds: [],
        dailyReports: false,
        updatedAt: Date.now(),
      });
    const pending = await ctx.db
      .query("bufferOAuthStates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .take(20);
    for (const state of pending) await ctx.db.delete(state._id);
    return { disconnectedHere: true, revokeAtBuffer: "https://publish.buffer.com/settings/api" };
  },
});

async function stage(
  ctx: Parameters<typeof assertTenantWritable>[0],
  tenantId: string,
  a: {
    campaign: string;
    channelId: string;
    text: string;
    mode: "addToQueue" | "customScheduled";
    dueAt?: number;
    imageUrl?: string;
    videoUrl?: string;
    mediaTitle?: string;
    categoryId?: string;
    boardId?: string;
    isAiGenerated?: boolean;
  },
) {
  validateBufferDraft(a, Date.now());
  if (!a.campaign.trim() || a.campaign.length > 120) throw new Error("BUFFER_INVALID_CAMPAIGN");
  const row = await ctx.db
    .query("bufferConnections")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  const target = row?.channels.find((c) => c.id === a.channelId && c.available);
  if (
    !row ||
    row.status !== "connected" ||
    !row.organizationId ||
    !target ||
    !row.selectedChannelIds.includes(a.channelId)
  )
    throw new Error("BUFFER_CHANNEL_NOT_ALLOWED");
  bufferCreateArguments(a, target.service);
  if (target.service === "pinterest" && !target.boards?.some((board) => board.id === a.boardId))
    throw new Error("BUFFER_PINTEREST_BOARD_REQUIRED");
  return ctx.db.insert("bufferPosts", {
    ...a,
    tenantId,
    connectionId: row.connectionId,
    organizationId: row.organizationId,
    revision: 1,
    status: "draft",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}
export const stagePost = tenantMutation({
  args: draftArgs,
  handler: (ctx, a) => stage(ctx, ctx.tenantId, a),
});
export const stageAgentPost = internalMutation({
  args: { tenantId: v.string(), ...draftArgs },
  handler: (ctx, { tenantId, ...a }) => stage(ctx, tenantId, a),
});

export const posts = tenantQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("bufferPosts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(100),
});
export const reports = tenantQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("bufferReports")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(12),
});

export const approvePost = tenantMutation({
  args: { postId: v.id("bufferPosts"), revision: v.number() },
  handler: async (ctx, a) => {
    const post = await ctx.db.get(a.postId);
    if (
      !post ||
      post.tenantId !== ctx.tenantId ||
      post.status !== "draft" ||
      post.revision !== a.revision
    )
      throw new Error("BUFFER_DRAFT_CHANGED");
    validateBufferDraft(post, Date.now());
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .unique();
    if (
      !row ||
      row.status !== "connected" ||
      row.connectionId !== post.connectionId ||
      row.organizationId !== post.organizationId ||
      !row.selectedChannelIds.includes(post.channelId)
    )
      throw new Error("BUFFER_CHANNEL_NOT_ALLOWED");
    await ctx.db.patch(post._id, {
      status: "approved",
      approvedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.bufferActions.publishPost, {
      tenantId: ctx.tenantId,
      postId: post._id,
    });
  },
});

export const discardPost = tenantMutation({
  args: { postId: v.id("bufferPosts") },
  handler: async (ctx, a) => {
    const post = await ctx.db.get(a.postId);
    if (!post || post.tenantId !== ctx.tenantId || post.status !== "draft")
      throw new Error("BUFFER_DRAFT_CHANGED");
    await ctx.db.patch(post._id, { status: "discarded", updatedAt: Date.now() });
  },
});

/** Claim once before the external write. A crashed/submitting attempt is never silently retried. */
export const claimPost = internalMutation({
  args: { tenantId: v.string(), postId: v.id("bufferPosts") },
  handler: async (ctx, a) => {
    const post = await ctx.db.get(a.postId);
    if (!post || post.tenantId !== a.tenantId || post.status !== "approved") return null;
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (
      !row ||
      row.status !== "connected" ||
      row.connectionId !== post.connectionId ||
      row.organizationId !== post.organizationId ||
      !row.selectedChannelIds.includes(post.channelId)
    ) {
      await ctx.db.patch(post._id, {
        status: "failed",
        failure: "connection_changed",
        updatedAt: Date.now(),
      });
      return null;
    }
    try {
      validateBufferDraft(post, Date.now());
    } catch {
      await ctx.db.patch(post._id, {
        status: "failed",
        failure: "schedule_expired",
        updatedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.patch(post._id, { status: "submitting", updatedAt: Date.now() });
    return post;
  },
});

export const finishPost = internalMutation({
  args: {
    tenantId: v.string(),
    postId: v.id("bufferPosts"),
    status: v.union(
      v.literal("scheduled"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("unknown"),
      v.literal("buffer_review"),
    ),
    bufferPostId: v.optional(v.string()),
    failure: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const post = await ctx.db.get(a.postId);
    if (!post || post.tenantId !== a.tenantId || post.status !== "submitting") return;
    await ctx.db.patch(post._id, {
      status: a.status,
      bufferPostId: a.bufferPostId,
      failure: a.failure,
      updatedAt: Date.now(),
    });
  },
});

export const pendingPosts = internalQuery({
  args: { tenantId: v.string(), connectionId: v.string() },
  handler: async (ctx, a) => {
    const posts = await ctx.db
      .query("bufferPosts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .order("desc")
      .take(100);
    return posts
      .filter(
        (post) =>
          post.connectionId === a.connectionId &&
          !!post.bufferPostId &&
          ["scheduled", "buffer_review"].includes(post.status),
      )
      .slice(0, 20)
      .map((post) => ({
        postId: post._id,
        bufferPostId: post.bufferPostId!,
        channelId: post.channelId,
      }));
  },
});

export const savePostStatuses = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    updates: v.array(
      v.object({
        postId: v.id("bufferPosts"),
        bufferPostId: v.string(),
        channelId: v.string(),
        status: v.union(
          v.literal("scheduled"),
          v.literal("sent"),
          v.literal("failed"),
          v.literal("buffer_review"),
        ),
      }),
    ),
  },
  handler: async (ctx, a) => {
    if (a.updates.length > 20) throw new Error("BUFFER_INVALID_RESPONSE");
    for (const update of a.updates) {
      const post = await ctx.db.get(update.postId);
      if (
        !post ||
        post.tenantId !== a.tenantId ||
        post.connectionId !== a.connectionId ||
        post.bufferPostId !== update.bufferPostId ||
        post.channelId !== update.channelId
      )
        throw new Error("BUFFER_POST_NOT_OWNED");
      if (!["scheduled", "buffer_review"].includes(post.status)) continue;
      await ctx.db.patch(post._id, {
        status: update.status,
        updatedAt: Date.now(),
        ...(update.status === "failed" ? { failure: "buffer_publishing_error" } : {}),
      });
    }
  },
});

export const saveReport = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    organizationId: v.string(),
    channelIds: v.array(v.string()),
    startAt: v.number(),
    endAt: v.number(),
    metricsUpdatedAt: v.union(v.number(), v.null()),
    metrics: v.array(
      v.object({
        type: v.string(),
        name: v.string(),
        value: v.number(),
        unit: v.union(v.literal("count"), v.literal("percentage")),
      }),
    ),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
      .unique();
    if (
      !row ||
      row.status !== "connected" ||
      row.connectionId !== a.connectionId ||
      row.organizationId !== a.organizationId ||
      a.channelIds.some((id) => !row.selectedChannelIds.includes(id))
    )
      throw new Error("BUFFER_SELECTION_CHANGED");
    return ctx.db.insert("bufferReports", { ...a, createdAt: Date.now() });
  },
});

/** Deployment scheduler exception: due rows only, bounded claim, no credential returned to callers. */
export const tickReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("bufferOAuthStates")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(100);
    for (const state of expired) await ctx.db.delete(state._id);
    const due = await ctx.db
      .query("bufferConnections")
      .withIndex("by_report_due", (q) => q.eq("dailyReports", true).lte("nextReportAt", Date.now()))
      .take(25);
    for (const row of due) {
      const revocation = await ctx.db
        .query("authRevocations")
        .withIndex("by_userId", (q) => q.eq("userId", row.tenantId))
        .unique();
      if (revocation?.state) continue;
      await ctx.db.patch(row._id, { nextReportAt: Date.now() + 86400_000 });
      if (row.status === "connected" && row.selectedChannelIds.length)
        await ctx.scheduler.runAfter(0, internal.bufferActions.dailyReport, {
          tenantId: row.tenantId,
          connectionId: row.connectionId,
        });
    }
  },
});
