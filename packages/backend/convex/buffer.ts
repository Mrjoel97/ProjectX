import {
  BUFFER_ID,
  BUFFER_REPORTS_AVAILABLE,
  type BufferDraft,
  type BufferPublicationReceipt,
  bufferCreateArguments,
  nativeSocialPostReference,
  validateBufferDraft,
} from "@pikar/core/buffer";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";
import { executionContextFor } from "./managedServiceRuns";

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
  nativeAccountId: v.optional(v.string()),
  boards: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))),
});
const publicationReceiptValue = v.object({
  source: v.literal("buffer-status-v1"),
  bufferPostId: v.string(),
  channelId: v.string(),
  platform: v.union(v.literal("instagram"), v.literal("tiktok")),
  nativeAccountId: v.string(),
  nativePostId: v.union(v.string(), v.null()),
  nativePostUrl: v.string(),
  sentAt: v.number(),
  observedAt: v.number(),
  draftRevision: v.number(),
  approvedAt: v.number(),
});
function assertPublicationReceipt(
  post: Doc<"bufferPosts">,
  status: string,
  receipt: BufferPublicationReceipt | undefined,
) {
  if (!receipt) return;
  const native = nativeSocialPostReference(receipt.platform, receipt.nativePostUrl);
  if (
    status !== "sent" ||
    (receipt.bufferPostId !== post.bufferPostId && post.status !== "submitting") ||
    receipt.channelId !== post.channelId ||
    receipt.platform !== post.platform ||
    receipt.draftRevision !== post.revision ||
    receipt.approvedAt !== post.approvedAt ||
    !Number.isSafeInteger(receipt.approvedAt) ||
    receipt.approvedAt < 0 ||
    !Number.isSafeInteger(receipt.observedAt) ||
    !Number.isSafeInteger(receipt.sentAt) ||
    receipt.sentAt < receipt.approvedAt ||
    receipt.sentAt > receipt.observedAt ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.nativeAccountId) ||
    !native ||
    native.url !== receipt.nativePostUrl ||
    native.postId !== receipt.nativePostId
  )
    throw new Error("BUFFER_INVALID_PUBLICATION_RECEIPT");
}
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
        !!process.env.BUFFER_OAUTH_CLIENT_ID?.trim() &&
        !!process.env.CONVEX_SITE_URL &&
        !!process.env.SITE_URL,
      connected: row?.status === "connected",
      status: row?.status ?? "disconnected",
      organizationId: row?.organizationId ?? null,
      organizationName: row?.organizationName ?? null,
      channels: row?.channels ?? [],
      selectedChannelIds: row?.selectedChannelIds ?? [],
      dailyReports: row?.dailyReports ?? false,
      reportsAvailable: BUFFER_REPORTS_AVAILABLE,
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
      grantRevision: (old?.grantRevision ?? old?.revision ?? 0) + 1,
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
          grantRevision: (row.grantRevision ?? row.revision) + 1,
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
        grantRevision: (row.grantRevision ?? row.revision) + 1,
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
        grantRevision: row.grantRevision ?? row.revision,
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
    const selectedChannelIds =
      row.organizationId === a.organizationId
        ? row.selectedChannelIds.filter((id) => a.channels.some((c) => c.id === id && c.available))
        : [];
    const permissionShape = (channels: typeof a.channels, selected: string[]) =>
      JSON.stringify(
        channels
          .filter((c) => selected.includes(c.id))
          .map((c) => [
            c.id,
            c.service,
            c.available,
            c.nativeAccountId ?? null,
            c.boards?.map((b) => b.id).sort() ?? [],
          ])
          .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      );
    const permissionChanged =
      row.organizationId !== a.organizationId ||
      JSON.stringify([...row.selectedChannelIds].sort()) !==
        JSON.stringify([...selectedChannelIds].sort()) ||
      permissionShape(row.channels, row.selectedChannelIds) !==
        permissionShape(a.channels, selectedChannelIds);
    await ctx.db.patch(row._id, {
      organizationId: a.organizationId,
      organizationName: a.organizationName.slice(0, 160),
      channels: a.channels,
      selectedChannelIds,
      grantRevision: (row.grantRevision ?? row.revision) + (permissionChanged ? 1 : 0),
      dailyReports: row.organizationId === a.organizationId && row.dailyReports,
      updatedAt: Date.now(),
    });
  },
});

export const selectChannels = tenantMutation({
  args: { channelIds: v.array(v.string()), dailyReports: v.boolean() },
  handler: async (ctx, a) => {
    if (a.dailyReports && !BUFFER_REPORTS_AVAILABLE)
      throw new Error("BUFFER_REPORTS_UNAVAILABLE_FOR_APP_CLIENTS");
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
      grantRevision:
        (row.grantRevision ?? row.revision) +
        (JSON.stringify([...row.selectedChannelIds].sort()) === JSON.stringify([...unique].sort())
          ? 0
          : 1),
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
        grantRevision: (row.grantRevision ?? row.revision) + 1,
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

async function draftContext(
  ctx: Parameters<typeof assertTenantWritable>[0],
  tenantId: string,
  a: BufferDraft & { campaign: string },
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
  if (
    target.service === "pinterest" &&
    a.boardId !== undefined &&
    !target.boards?.some((board) => board.id === a.boardId)
  )
    throw new Error("BUFFER_PINTEREST_BOARD_REQUIRED");
  return { row, target, organizationId: row.organizationId };
}
async function stage(
  ctx: Parameters<typeof assertTenantWritable>[0],
  tenantId: string,
  a: BufferDraft & { campaign: string },
  managedServiceRunId?: Id<"managedServiceRuns">,
) {
  const { row, target, organizationId } = await draftContext(ctx, tenantId, a);
  return ctx.db.insert("bufferPosts", {
    ...a,
    ...(managedServiceRunId ? { managedServiceRunId } : {}),
    tenantId,
    connectionId: row.connectionId,
    organizationId,
    platform: target.service,
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
/** Editing never approves or replays a provider write. A stale review cannot approve new content. */
export const editPost = tenantMutation({
  args: { postId: v.id("bufferPosts"), revision: v.number(), ...draftArgs },
  handler: async (ctx, { postId, revision, ...draft }) => {
    const post = await ctx.db.get(postId);
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision >= Number.MAX_SAFE_INTEGER ||
      !post ||
      post.tenantId !== ctx.tenantId ||
      post.status !== "draft" ||
      post.revision !== revision
    )
      throw new Error("BUFFER_DRAFT_CHANGED");
    const { row, target } = await draftContext(ctx, ctx.tenantId, draft);
    if (row.connectionId !== post.connectionId || row.organizationId !== post.organizationId)
      throw new Error("BUFFER_CONNECTION_CHANGED");
    const nextRevision = revision + 1;
    await ctx.db.patch(post._id, {
      ...draft,
      revision: nextRevision,
      platform: target.service,
      // Omitted fields mean remove the previous media/schedule, not silently retain it.
      dueAt: draft.dueAt,
      imageUrl: draft.imageUrl,
      videoUrl: draft.videoUrl,
      mediaTitle: draft.mediaTitle,
      categoryId: draft.categoryId,
      boardId: draft.boardId,
      isAiGenerated: draft.isAiGenerated,
      approvedAt: undefined,
      bufferPostId: undefined,
      failure: undefined,
      updatedAt: Date.now(),
    });
    return { postId: post._id, revision: nextRevision };
  },
});
/** Explicit replacement of a known never-accepted submission, never replay of an uncertain write. */
export const restageFailedPost = tenantMutation({
  args: { postId: v.id("bufferPosts"), revision: v.number(), ...draftArgs },
  handler: async (ctx, { postId, revision, ...draft }) => {
    const post = await ctx.db.get(postId);
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      revision >= Number.MAX_SAFE_INTEGER ||
      !post ||
      post.tenantId !== ctx.tenantId ||
      post.revision !== revision ||
      post.status !== "failed" ||
      post.bufferPostId ||
      post.replacementPostId ||
      !["connection_changed", "schedule_expired", "provider_rejected"].includes(post.failure ?? "")
    )
      throw new Error("BUFFER_REPLACEMENT_NOT_ALLOWED");
    const replacement = await stage(ctx, ctx.tenantId, draft, post.managedServiceRunId);
    await ctx.db.patch(post._id, {
      revision: revision + 1,
      replacementPostId: replacement,
      updatedAt: Date.now(),
    });
    return { postId: replacement, revision: 1 };
  },
});
export const stageAgentPost = internalMutation({
  args: {
    tenantId: v.string(),
    managedServiceRunId: v.optional(v.id("managedServiceRuns")),
    ...draftArgs,
  },
  handler: async (ctx, { tenantId, managedServiceRunId, ...a }) => {
    if (managedServiceRunId) {
      const scope = await executionContextFor(ctx, { tenantId, runId: managedServiceRunId });
      if (
        !scope.operationIds.includes("social.prepare") ||
        !scope.accounts.some((pin) => pin.provider === "buffer" && pin.accountId === a.channelId)
      )
        throw new Error("SERVICE_TOOL_NOT_ALLOWED");
    }
    return stage(ctx, tenantId, a, managedServiceRunId);
  },
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
    const { row, target } = await draftContext(ctx, ctx.tenantId, post);
    if (row.connectionId !== post.connectionId || row.organizationId !== post.organizationId)
      throw new Error("BUFFER_CHANNEL_NOT_ALLOWED");
    // An incomplete local draft is safe to retain, but can never enter the outbound queue.
    bufferCreateArguments(post, target.service);
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
  args: { postId: v.id("bufferPosts"), revision: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const post = await ctx.db.get(a.postId);
    if (
      !post ||
      post.tenantId !== ctx.tenantId ||
      post.status !== "draft" ||
      (a.revision !== undefined &&
        (!Number.isSafeInteger(a.revision) || a.revision !== post.revision)) ||
      post.revision >= Number.MAX_SAFE_INTEGER
    )
      throw new Error("BUFFER_DRAFT_CHANGED");
    await ctx.db.patch(post._id, {
      status: "discarded",
      revision: post.revision + 1,
      updatedAt: Date.now(),
    });
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
    publicationReceipt: v.optional(publicationReceiptValue),
  },
  handler: async (ctx, a) => {
    const post = await ctx.db.get(a.postId);
    if (!post || post.tenantId !== a.tenantId || post.status !== "submitting") return;
    if (
      a.publicationReceipt?.bufferPostId !== undefined &&
      a.publicationReceipt.bufferPostId !== a.bufferPostId
    )
      throw new Error("BUFFER_INVALID_PUBLICATION_RECEIPT");
    assertPublicationReceipt(post, a.status, a.publicationReceipt);
    await ctx.db.patch(post._id, {
      status: a.status,
      bufferPostId: a.bufferPostId,
      failure: a.failure,
      ...(a.publicationReceipt ? { publicationReceipt: a.publicationReceipt } : {}),
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
          (["scheduled", "buffer_review"].includes(post.status) ||
            (post.status === "sent" && !post.publicationReceipt)),
      )
      .slice(0, 20)
      .map((post) => ({
        postId: post._id,
        bufferPostId: post.bufferPostId!,
        channelId: post.channelId,
        platform: post.platform ?? null,
        revision: post.revision,
        approvedAt: post.approvedAt ?? null,
        text: post.text,
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
        publicationReceipt: v.optional(publicationReceiptValue),
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
      if (
        !["scheduled", "buffer_review"].includes(post.status) &&
        !(post.status === "sent" && !post.publicationReceipt && update.status === "sent")
      )
        continue;
      assertPublicationReceipt(post, update.status, update.publicationReceipt);
      await ctx.db.patch(post._id, {
        status: update.status,
        updatedAt: Date.now(),
        ...(update.status === "failed" ? { failure: "buffer_publishing_error" } : {}),
        ...(!post.publicationReceipt && update.publicationReceipt
          ? { publicationReceipt: update.publicationReceipt }
          : {}),
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
