import { SOCIAL_PROVIDERS, socialHash } from "@pikar/core/social";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery, type MutationCtx } from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { assertTenantWritable, internalMutation } from "./lib/tenantLifecycle";

export const socialProvider = v.union(
  v.literal("x"),
  v.literal("meta"),
  v.literal("tiktok"),
  v.literal("youtube"),
);
export function youtubeConnectionEnabled() {
  return (
    process.env.SOCIAL_YOUTUBE_CONNECT_ENABLED === "true" &&
    process.env.SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED === "true"
  );
}
// Read guards close the deadline even if a scheduled cleanup is delayed. Legacy rows
// use conservative initial-connection bounds below, never a fabricated provider refresh.
const DAY_MS = 24 * 60 * 60 * 1000;
export const YOUTUBE_METADATA_MAX_AGE_MS = 30 * DAY_MS;
export function youtubeMetadataFresh(checkedAt: number | undefined, now = Date.now()) {
  return (
    checkedAt !== undefined &&
    Number.isFinite(checkedAt) &&
    checkedAt <= now &&
    checkedAt > now - YOUTUBE_METADATA_MAX_AGE_MS
  );
}
/** Legacy retention bounds are conservative dates, not provider refresh evidence. */
export function youtubeConnectionMetadataBound(
  row:
    | {
        _creationTime: number;
        providerMetadataCheckedAt?: number;
      }
    | null
    | undefined,
) {
  return row?.providerMetadataCheckedAt ?? (row ? row._creationTime - 10 * 60 * 1000 : undefined);
}
export function youtubeConnectionConsentBound(
  row:
    | {
        _creationTime: number;
        providerConsentCheckedAt?: number;
      }
    | null
    | undefined,
) {
  return row?.providerConsentCheckedAt ?? (row ? row._creationTime - 10 * 60 * 1000 : undefined);
}
export function youtubePostMetadataBound(
  post: {
    _creationTime: number;
    connectionId: string;
    providerMetadataCheckedAt?: number;
  },
  row: { _creationTime: number; connectionId: string } | null | undefined,
) {
  if (!row || row.connectionId !== post.connectionId) return undefined;
  return (
    post.providerMetadataCheckedAt ??
    Math.min(post._creationTime, row._creationTime - 10 * 60 * 1000)
  );
}
export function youtubePostMetadataCleared() {
  return {
    assetId: "",
    assetName: "",
    providerPostId: undefined,
    providerMetadataCheckedAt: undefined,
  };
}
const envelope = {
  ciphertextB64: v.string(),
  ivB64: v.string(),
  keyVersion: v.union(v.literal("v1"), v.literal("v2")),
};
export const status = tenantQuery({
  args: {},
  handler: async (ctx) =>
    Promise.all(
      SOCIAL_PROVIDERS.map(async (provider) => {
        const row = await ctx.db
          .query("socialConnections")
          .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId).eq("provider", provider))
          .unique();
        const prefix = provider === "youtube" ? "YOUTUBE" : provider.toUpperCase();
        const configured =
          (provider !== "youtube" || youtubeConnectionEnabled()) &&
          !!process.env[`${prefix}_OAUTH_CLIENT_ID`] &&
          !!process.env[`${prefix}_OAUTH_CLIENT_SECRET`] &&
          !!process.env.CONNECTOR_CREDENTIAL_KEY_V1 &&
          !!process.env.CONVEX_SITE_URL &&
          !!process.env.SITE_URL &&
          (provider !== "meta" ||
            /^v[1-9][0-9]\.0$/.test(process.env.META_GRAPH_API_VERSION ?? ""));
        const metadataVisible =
          provider !== "youtube" || youtubeMetadataFresh(youtubeConnectionMetadataBound(row));
        return {
          provider,
          connectionId: row?.connectionId ?? null,
          assets: metadataVisible ? (row?.assets ?? []) : [],
          selectedAssetIds: metadataVisible ? (row?.selectedAssetIds ?? []) : [],
          selectionRevision: row?.selectionRevision ?? 0,
          assetsCheckedAt: metadataVisible ? (row?.assetsCheckedAt ?? null) : null,
          publishEnabled:
            process.env[`SOCIAL_${provider.toUpperCase()}_PUBLISH_ENABLED`] === "true",
          configured,
          connected: row?.status === "connected" && row.expiresAt > Date.now(),
          status: row?.status ?? "disconnected",
          accountName: metadataVisible ? (row?.accountName ?? null) : null,
          scopes: row?.scopes ?? [],
          expiresAt: row?.expiresAt ?? null,
          updatedAt: row?.updatedAt ?? null,
        };
      }),
    ),
});
export const connection = internalQuery({
  args: { tenantId: v.string(), provider: socialProvider },
  handler: async (ctx, a) => {
    const revocation = await ctx.db
      .query("authRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", a.tenantId))
      .unique();
    if (revocation?.state) throw new Error("SOCIAL_RECONNECT");
    return ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", a.provider))
      .unique();
  },
});
export const storeState = internalMutation({
  args: {
    tenantId: v.string(),
    provider: socialProvider,
    connectionId: v.string(),
    stateHash: v.string(),
    ...envelope,
  },
  handler: async (ctx, a) => {
    await assertTenantWritable(ctx, a.tenantId);
    for (const row of await ctx.db
      .query("socialOAuthStates")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", a.provider))
      .take(20))
      await ctx.db.delete(row._id);
    await ctx.db.insert("socialOAuthStates", {
      ...a,
      phase: "request",
      expiresAt: Date.now() + 600000,
    });
  },
});
export const consumeState = internalMutation({
  args: { provider: socialProvider, stateHash: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("socialOAuthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", a.stateHash))
      .unique();
    if (
      !row ||
      row.provider !== a.provider ||
      row.phase !== "request" ||
      row.expiresAt <= Date.now()
    )
      return null;
    await assertTenantWritable(ctx, row.tenantId);
    if (a.provider === "youtube" && !youtubeConnectionEnabled()) {
      await ctx.db.delete(row._id);
      return null;
    }
    await ctx.db.patch(row._id, { phase: "exchanging" });
    return row;
  },
});
export const storePendingGrant = internalMutation({
  args: {
    tenantId: v.string(),
    provider: socialProvider,
    connectionId: v.string(),
    requestHash: v.string(),
    stateHash: v.string(),
    tokenExpiresAt: v.number(),
    accountIdHash: v.string(),
    accountName: v.string(),
    scopes: v.array(v.string()),
    ...envelope,
  },
  handler: async (ctx, a) => {
    await assertTenantWritable(ctx, a.tenantId);
    const row = await ctx.db
      .query("socialOAuthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", a.requestHash))
      .unique();
    if (
      !row ||
      row.provider !== a.provider ||
      row.tenantId !== a.tenantId ||
      row.connectionId !== a.connectionId ||
      row.phase !== "exchanging" ||
      row.expiresAt <= Date.now()
    )
      throw new Error("SOCIAL_INVALID_STATE");
    if (a.provider === "youtube" && !youtubeConnectionEnabled()) {
      await ctx.db.delete(row._id);
      return false;
    }
    const { requestHash: _requestHash, ...pending } = a;
    await ctx.db.delete(row._id);
    await ctx.db.insert("socialOAuthStates", {
      ...pending,
      phase: "complete",
      expiresAt: Date.now() + 600000,
    });
    return true;
  },
});
export const completeConnect = tenantMutation({
  args: { provider: socialProvider, receipt: v.string() },
  handler: async (ctx, a) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(a.receipt)) throw new Error("SOCIAL_INVALID_STATE");
    const hash = await socialHash(`${a.provider}:receipt:${a.receipt}`);
    const pending = await ctx.db
      .query("socialOAuthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", hash))
      .unique();
    if (
      !pending ||
      pending.tenantId !== ctx.tenantId ||
      pending.provider !== a.provider ||
      pending.phase !== "complete" ||
      pending.expiresAt <= Date.now() ||
      !pending.tokenExpiresAt ||
      pending.tokenExpiresAt <= Date.now() ||
      !pending.accountIdHash ||
      !pending.accountName ||
      !pending.scopes
    )
      throw new Error("SOCIAL_INVALID_STATE");
    if (a.provider === "youtube" && !youtubeConnectionEnabled()) {
      await ctx.db.delete(pending._id);
      return { connected: false as const, reason: "SOCIAL_NOT_CONFIGURED" };
    }
    const old = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId).eq("provider", a.provider))
      .unique();
    const row = {
      tenantId: ctx.tenantId,
      provider: a.provider,
      connectionId: pending.connectionId,
      accountIdHash: pending.accountIdHash,
      accountName: pending.accountName,
      scopes: pending.scopes,
      ciphertextB64: pending.ciphertextB64,
      ivB64: pending.ivB64,
      keyVersion: pending.keyVersion,
      expiresAt: pending.tokenExpiresAt,
      revision: (old?.revision ?? 0) + 1,
      updatedAt: Date.now(),
      status: "connected" as const,
      ...(a.provider === "youtube"
        ? {
            // Pending completion was created only after the real channel identity request.
            providerMetadataCheckedAt: pending._creationTime,
            providerConsentCheckedAt: pending._creationTime,
          }
        : {}),
    };
    if (old?.provider === "youtube")
      await ctx.scheduler.runAfter(0, internal.social.clearYouTubePostMetadata, {
        tenantId: ctx.tenantId,
        connectionId: old.connectionId,
      });
    if (old) await ctx.db.replace(old._id, row);
    else await ctx.db.insert("socialConnections", row);
    await ctx.db.delete(pending._id);
    return { connected: true as const };
  },
});
/** Remove local access before any network request; return sealed material internally only. */
async function disconnectLocal(
  ctx: MutationCtx,
  tenantId: string,
  provider: "x" | "meta" | "tiktok" | "youtube",
) {
  const row = await ctx.db
    .query("socialConnections")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("provider", provider))
    .unique();
  if (row) await ctx.db.delete(row._id);
  if (provider === "youtube")
    await ctx.scheduler.runAfter(0, internal.social.clearYouTubePostMetadata, {
      tenantId,
      ...(row ? { connectionId: row.connectionId } : {}),
    });
  for (const pending of await ctx.db
    .query("socialOAuthStates")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId).eq("provider", provider))
    .take(20))
    await ctx.db.delete(pending._id);
  return row;
}
export const disconnect = tenantMutation({
  args: { provider: socialProvider },
  handler: async (ctx, a) => {
    // A public mutation cannot revoke remotely; require the action for YouTube.
    if (a.provider === "youtube") throw new Error("SOCIAL_USE_DISCONNECT_ACTION");
    await disconnectLocal(ctx, ctx.tenantId, a.provider);
    return {
      disconnectedHere: true,
      upstreamRevoked: false,
      upstreamRevocation:
        "Remove Pikar AI in your social account's connected-app settings to revoke provider access.",
    };
  },
});
/** Also usable after tenant erasure begins: deletion is allowed, resurrection is not. */
export const beginDisconnect = internalMutation({
  args: { tenantId: v.string(), provider: socialProvider },
  handler: (ctx, a) => disconnectLocal(ctx, a.tenantId, a.provider),
});
export const claimRefresh = internalMutation({
  args: {
    tenantId: v.string(),
    provider: socialProvider,
    connectionId: v.string(),
    revision: v.number(),
    lease: v.string(),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", a.provider))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.revision !== a.revision ||
      row.status !== "connected"
    )
      return false;
    if (row.refreshLease) {
      if ((row.refreshStartedAt ?? 0) < Date.now() - 60000) {
        if (a.provider === "youtube") {
          await ctx.db.delete(row._id);
          await ctx.scheduler.runAfter(0, internal.social.clearYouTubePostMetadata, {
            tenantId: a.tenantId,
            connectionId: row.connectionId,
          });
          return false;
        }
        await ctx.db.patch(row._id, {
          status: "reconnect_required",
          ciphertextB64: undefined,
          ivB64: undefined,
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
    provider: socialProvider,
    connectionId: v.string(),
    revision: v.number(),
    lease: v.string(),
    scopes: v.optional(v.array(v.string())),
    expiresAt: v.optional(v.number()),
    ciphertextB64: v.optional(v.string()),
    ivB64: v.optional(v.string()),
    keyVersion: v.union(v.literal("v1"), v.literal("v2")),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", a.provider))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.revision !== a.revision ||
      row.refreshLease !== a.lease ||
      row.status !== "connected"
    )
      return false;
    if (a.provider === "youtube" && !a.ciphertextB64) {
      // A failed/revoked refresh cannot leave API identifiers behind indefinitely.
      await ctx.db.delete(row._id);
      await ctx.scheduler.runAfter(0, internal.social.clearYouTubePostMetadata, {
        tenantId: a.tenantId,
        connectionId: row.connectionId,
      });
      return true;
    }
    await ctx.db.patch(row._id, {
      ciphertextB64: a.ciphertextB64,
      ivB64: a.ivB64,
      keyVersion: a.keyVersion,
      expiresAt: a.expiresAt ?? row.expiresAt,
      ...(a.ciphertextB64 && a.scopes ? { scopes: a.scopes } : {}),
      status: a.ciphertextB64 ? "connected" : "reconnect_required",
      refreshLease: undefined,
      refreshStartedAt: undefined,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});
/** A genuine provider identity read, fenced against disconnect/reconnect and token rotation. */
export const recordYouTubeMetadata = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    revision: v.number(),
    accountId: v.string(),
    accountName: v.string(),
  },
  handler: async (ctx, a) => {
    await assertTenantWritable(ctx, a.tenantId);
    const row = await ctx.db
      .query("socialConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", "youtube"))
      .unique();
    if (
      !row ||
      row.connectionId !== a.connectionId ||
      row.revision !== a.revision ||
      row.status !== "connected" ||
      row.refreshLease ||
      row.accountIdHash !== (await socialHash(`youtube:account:${a.accountId}`))
    )
      throw new Error("SOCIAL_RECONNECT");
    const checkedAt = Date.now();
    await ctx.db.patch(row._id, {
      accountName: a.accountName,
      providerMetadataCheckedAt: checkedAt,
      providerConsentCheckedAt: checkedAt,
      assets: row.assets?.map((asset) =>
        asset.id === a.accountId ? { ...asset, name: a.accountName } : asset,
      ),
      ...(row.assets ? { assetsCheckedAt: checkedAt } : {}),
    });
  },
});

/** No provider network calls. Only API-derived destinations/receipts are removed;
 * original customer captions, titles, media and disclosure choices are preserved. */
export const clearYouTubePostMetadata = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.optional(v.string()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<void> => {
    const page =
      a.connectionId === undefined
        ? await ctx.db
            .query("socialPosts")
            .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId))
            .paginate({ numItems: 50, cursor: a.cursor ?? null })
        : await ctx.db
            .query("socialPosts")
            .withIndex("by_connection", (q) =>
              q
                .eq("tenantId", a.tenantId)
                .eq("provider", "youtube")
                .eq("connectionId", a.connectionId!),
            )
            .paginate({ numItems: 50, cursor: a.cursor ?? null });
    for (const post of page.page) {
      if (post.provider !== "youtube") continue;
      // A disconnected old connection must never delete a newer reconnect's metadata.
      if (a.connectionId === undefined) {
        const current = await ctx.db
          .query("socialConnections")
          .withIndex("by_tenant", (q) => q.eq("tenantId", a.tenantId).eq("provider", "youtube"))
          .unique();
        if (current?.connectionId === post.connectionId) continue;
      }
      await ctx.db.patch(post._id, youtubePostMetadataCleared());
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.social.clearYouTubePostMetadata, {
        ...a,
        cursor: page.continueCursor,
      });
  },
});

/** Bounded read-only rollout impact: counts only, no credentials, content or identifiers.
 * Follow next until null; counts apply to this page, not an invented global total. */
export const youtubeMetadataCleanupImpact = internalQuery({
  args: {
    phase: v.optional(v.union(v.literal("connections"), v.literal("posts"))),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const phase = a.phase ?? "connections";
    const cutoff = Date.now() - 29 * DAY_MS;
    let stale = 0,
      legacy = 0,
      inspected = 0;
    if (phase === "connections") {
      const page = await ctx.db
        .query("socialConnections")
        .withIndex("by_provider", (q) => q.eq("provider", "youtube"))
        .paginate({ numItems: 50, cursor: a.cursor ?? null });
      for (const row of page.page) {
        inspected++;
        if (row.providerMetadataCheckedAt === undefined) legacy++;
        if (
          !youtubeMetadataFresh(youtubeConnectionMetadataBound(row)) ||
          (youtubeConnectionMetadataBound(row) ?? 0) <= cutoff ||
          !youtubeMetadataFresh(youtubeConnectionConsentBound(row)) ||
          (youtubeConnectionConsentBound(row) ?? 0) <= cutoff
        )
          stale++;
      }
      return {
        phase,
        inspected,
        legacy,
        stale,
        next: page.isDone
          ? { phase: "posts" as const, cursor: null }
          : { phase, cursor: page.continueCursor },
      };
    }
    const page = await ctx.db
      .query("socialPosts")
      .withIndex("by_provider", (q) => q.eq("provider", "youtube"))
      .paginate({ numItems: 50, cursor: a.cursor ?? null });
    for (const post of page.page) {
      inspected++;
      if (post.providerMetadataCheckedAt === undefined) legacy++;
      const row = await ctx.db
        .query("socialConnections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", post.tenantId).eq("provider", "youtube"))
        .unique();
      if (
        row?.status !== "connected" ||
        !youtubeMetadataFresh(youtubePostMetadataBound(post, row)) ||
        (youtubePostMetadataBound(post, row) ?? 0) <= cutoff
      )
        stale++;
    }
    return {
      phase,
      inspected,
      legacy,
      stale,
      next: page.isDone ? null : { phase, cursor: page.continueCursor },
    };
  },
});

/** A one-day margin before the 30-day deadline. Legacy rows use conservative
 * initial-connection bounds; orphaned/unknown bounds fail closed.
 * Every invocation is bounded; cursors continue across all YouTube rows, not just
 * the first batch. No whole-history or customer-authored-content deletion. */
export const cleanupYouTubeMetadata = internalMutation({
  args: {
    phase: v.optional(v.union(v.literal("connections"), v.literal("posts"))),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<void> => {
    // Disabled until the bounded dry-run impact is reviewed for this deployment.
    if (process.env.SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED !== "true") return;
    const phase = a.phase ?? "connections";
    const cutoff = Date.now() - 29 * DAY_MS;
    if (phase === "connections") {
      const page = await ctx.db
        .query("socialConnections")
        .withIndex("by_provider", (q) => q.eq("provider", "youtube"))
        .paginate({ numItems: 50, cursor: a.cursor ?? null });
      for (const row of page.page) {
        if (
          youtubeMetadataFresh(youtubeConnectionMetadataBound(row)) &&
          (youtubeConnectionMetadataBound(row) ?? 0) > cutoff &&
          youtubeMetadataFresh(youtubeConnectionConsentBound(row)) &&
          (youtubeConnectionConsentBound(row) ?? 0) > cutoff
        )
          continue;
        await ctx.db.delete(row._id);
        await ctx.scheduler.runAfter(0, internal.social.clearYouTubePostMetadata, {
          tenantId: row.tenantId,
          connectionId: row.connectionId,
        });
      }
      await ctx.scheduler.runAfter(
        0,
        internal.social.cleanupYouTubeMetadata,
        page.isDone ? { phase: "posts" as const } : { phase, cursor: page.continueCursor },
      );
    } else {
      const page = await ctx.db
        .query("socialPosts")
        .withIndex("by_provider", (q) => q.eq("provider", "youtube"))
        .paginate({ numItems: 50, cursor: a.cursor ?? null });
      for (const post of page.page) {
        const current = await ctx.db
          .query("socialConnections")
          .withIndex("by_tenant", (q) => q.eq("tenantId", post.tenantId).eq("provider", "youtube"))
          .unique();
        if (
          current?.connectionId === post.connectionId &&
          current.status === "connected" &&
          youtubeMetadataFresh(youtubePostMetadataBound(post, current)) &&
          (youtubePostMetadataBound(post, current) ?? 0) > cutoff
        )
          continue;
        await ctx.db.patch(post._id, youtubePostMetadataCleared());
      }
      if (!page.isDone)
        await ctx.scheduler.runAfter(0, internal.social.cleanupYouTubeMetadata, {
          phase,
          cursor: page.continueCursor,
        });
    }
  },
});

/** Only expiry-indexed internal cleanup; no provider calls or automatic publishing. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("socialOAuthStates")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", Date.now()))
      .take(100);
    for (const row of rows) await ctx.db.delete(row._id);
  },
});
