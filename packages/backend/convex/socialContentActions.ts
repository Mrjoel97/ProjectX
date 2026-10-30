import {
  type SocialProvider,
  socialFailureDiagnostic,
  socialHash,
  socialJson,
  socialNonce,
  socialRecord,
  socialString,
  validMetaVersion,
} from "@pikar/core/social";
import {
  assertSocialScopes,
  mp4Duration,
  publishingScopes,
  safeSocialLink,
  socialAsset,
  socialUploadTarget,
  validateSocialMedia,
} from "@pikar/core/socialPublishing";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

import { tenantAction } from "./lib/functions";
import { internalAction } from "./lib/tenantLifecycle";
import { socialProvider } from "./social";
import { authorized, verifyYouTubeMetadata } from "./socialActions";

const graph = () =>
  `https://graph.facebook.com/${validMetaVersion(process.env.META_GRAPH_API_VERSION)}`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("SOCIAL_INVALID_RESPONSE");
  return value.map(socialRecord);
}
async function pages(token: string) {
  return rows(
    (
      await socialJson(
        graph() +
          "/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100",
        { headers: bearer(token) },
      )
    ).data,
  );
}
async function pageFor(token: string, id: string, instagram = false) {
  const page = (await pages(token)).find((p) =>
    instagram ? socialRecord(p.instagram_business_account ?? {}).id === id : p.id === id,
  );
  if (!page) throw new Error("SOCIAL_ASSET_UNAVAILABLE");
  return page;
}
async function discover(
  ctx: ActionCtx,
  tenantId: string,
  provider: SocialProvider,
): Promise<{
  accounts: import("@pikar/core/socialPublishing").SocialAsset[];
  checkedAt: number;
  limit: number;
  mayBeTruncated: boolean;
}> {
  if (provider === "x") throw new Error("SOCIAL_X_DEFERRED");
  const { grant, connectionId } = await authorized(ctx, tenantId, provider);
  let assets: import("@pikar/core/socialPublishing").SocialAsset[] = [];
  if (provider === "meta") {
    for (const p of await pages(grant.accessToken)) {
      assets.push(
        socialAsset({ id: socialString(p.id), name: socialString(p.name), kind: "facebook_page" }),
      );
      if (p.instagram_business_account) {
        const ig = socialRecord(p.instagram_business_account);
        assets.push(
          socialAsset({
            id: socialString(ig.id),
            name: socialString(ig.username),
            kind: "instagram",
          }),
        );
      }
    }
  } else if (provider === "youtube") {
    const account = await verifyYouTubeMetadata(ctx, tenantId, connectionId, grant);
    assets = [socialAsset({ id: account.id, name: account.name, kind: "youtube" })];
  } else {
    const row = await ctx.runQuery(internal.social.connection, { tenantId, provider });
    if (!row || row.connectionId !== connectionId) throw new Error("SOCIAL_RECONNECT");
    assets = [socialAsset({ id: grant.accountId, name: row.accountName, kind: provider })];
  }
  // An account list never includes access tokens, page tokens or an automatic selection.
  const unique = [...new Map(assets.map((a) => [a.id, a])).values()];
  await ctx.runMutation(internal.socialPublishing.saveAssets, {
    tenantId,
    provider,
    connectionId,
    assets: unique.slice(0, 100),
  });
  return {
    accounts: unique.slice(0, 100),
    checkedAt: Date.now(),
    limit: 100,
    mayBeTruncated: provider === "meta" && unique.length >= 100,
  };
}
export const discoverAccounts = tenantAction({
  args: { provider: socialProvider },
  handler: (ctx, a) => discover(ctx, ctx.tenantId, a.provider),
});
export const agentAccounts = internalAction({
  args: { tenantId: v.string(), provider: socialProvider },
  handler: async (
    ctx,
    a,
  ): Promise<{
    accounts: import("@pikar/core/socialPublishing").SocialAsset[];
    checkedAt: number;
    limit: number;
    mayBeTruncated: boolean;
    selectedAccountIds: string[];
    scopes: string[];
  }> => {
    const result = await discover(ctx, a.tenantId, a.provider);
    const row = await ctx.runQuery(internal.social.connection, a);
    return {
      ...result,
      selectedAccountIds: row?.selectedAssetIds ?? [],
      scopes: row?.scopes ?? [],
    };
  },
});
async function read(
  ctx: ActionCtx,
  tenantId: string,
  provider: SocialProvider,
  assetId: string,
): Promise<{
  provider: SocialProvider;
  account: import("@pikar/core/socialPublishing").SocialAsset;
  checkedAt: number;
  limit: number;
  mayBeTruncated: boolean;
  untrustedContent: boolean;
  posts: { id: string; text: string; title?: string; publishedAt: string; url?: string }[];
}> {
  const { grant, connectionId } = await authorized(ctx, tenantId, provider);
  const selected = await ctx.runQuery(internal.socialPublishing.selectedConnection, {
    tenantId,
    provider,
    connectionId,
    assetId,
  });
  let items: Record<string, unknown>[];
  if (provider === "meta") {
    const page = await pageFor(grant.accessToken, assetId, selected.asset.kind === "instagram");
    items = rows(
      (
        await socialJson(
          graph() +
            "/" +
            encodeURIComponent(assetId) +
            (selected.asset.kind === "instagram"
              ? "/media?fields=id,caption,permalink,timestamp,media_type&limit=20"
              : "/published_posts?fields=id,message,permalink_url,created_time&limit=20"),
          { headers: bearer(socialString(page.access_token, 8192)) },
        )
      ).data,
    );
  } else if (provider === "tiktok") {
    assertSocialScopes(grant.scopes, ["video.list"]);
    const result = await socialJson(
      "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,share_url,create_time",
      {
        method: "POST",
        headers: { ...bearer(grant.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({ max_count: 20 }),
      },
    );
    if (socialRecord(result.error).code !== "ok") throw new Error("SOCIAL_PROVIDER_UNAVAILABLE");
    items = rows(socialRecord(result.data).videos);
  } else if (provider === "youtube") {
    const channel = rows(
      (
        await socialJson(
          "https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true",
          { headers: bearer(grant.accessToken) },
        )
      ).items,
    ).find((c) => c.id === assetId);
    if (!channel) throw new Error("SOCIAL_ASSET_UNAVAILABLE");
    const uploads = socialString(
      socialRecord(socialRecord(channel.contentDetails).relatedPlaylists).uploads,
    );
    items = rows(
      (
        await socialJson(
          "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=20&playlistId=" +
            encodeURIComponent(uploads),
          { headers: bearer(grant.accessToken) },
        )
      ).items,
    );
  } else throw new Error("SOCIAL_X_DEFERRED");
  // Recheck after external reads so stale/in-flight reads cannot return another selection.
  const final = await ctx.runQuery(internal.socialPublishing.selectedConnection, {
    tenantId,
    provider,
    connectionId,
    assetId,
  });
  if (final.selectionRevision !== selected.selectionRevision)
    throw new Error("SOCIAL_SELECTION_CHANGED");
  return {
    provider,
    account: selected.asset,
    checkedAt: Date.now(),
    limit: 20,
    mayBeTruncated: items.length >= 20,
    untrustedContent: true,
    posts: items.slice(0, 20).map((item) => {
      const snippet = item.snippet ? socialRecord(item.snippet) : item;
      const video = snippet.resourceId ? socialRecord(snippet.resourceId).videoId : undefined;
      return {
        id: socialString(item.id),
        text: String(
          item.message ??
            item.caption ??
            item.video_description ??
            snippet.description ??
            item.title ??
            snippet.title ??
            "",
        ).slice(0, 4000),
        title: typeof snippet.title === "string" ? snippet.title.slice(0, 200) : undefined,
        publishedAt: String(
          item.created_time ?? item.timestamp ?? item.create_time ?? snippet.publishedAt ?? "",
        ).slice(0, 64),
        url: safeSocialLink(
          item.permalink_url ??
            item.permalink ??
            item.share_url ??
            (typeof video === "string"
              ? `https://www.youtube.com/watch?v=${encodeURIComponent(video)}`
              : undefined),
        ),
      };
    }),
  };
}
export const readContent = tenantAction({
  args: { provider: socialProvider, assetId: v.string() },
  handler: (ctx, a) => read(ctx, ctx.tenantId, a.provider, a.assetId),
});
export const agentReadContent = internalAction({
  args: { tenantId: v.string(), provider: socialProvider, assetId: v.string() },
  handler: (ctx, a) => read(ctx, a.tenantId, a.provider, a.assetId),
});
export const creatorInfo = tenantAction({
  args: {},
  handler: async (ctx) => {
    const { grant } = await authorized(ctx, ctx.tenantId, "tiktok");
    assertSocialScopes(grant.scopes, ["video.publish"]);
    return creator(grant.accessToken);
  },
});
async function creator(token: string) {
  const r = await socialJson("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: { ...bearer(token), "Content-Type": "application/json" },
    body: "{}",
  });
  if (socialRecord(r.error).code !== "ok") throw new Error("SOCIAL_PROVIDER_UNAVAILABLE");
  const d = socialRecord(r.data);
  return {
    name: socialString(d.creator_nickname),
    privacyOptions: rowsOrStrings(d.privacy_level_options),
    commentsDisabled: d.comment_disabled === true,
    duetDisabled: d.duet_disabled === true,
    stitchDisabled: d.stitch_disabled === true,
    maxDurationSeconds:
      typeof d.max_video_post_duration_sec === "number" ? d.max_video_post_duration_sec : 0,
  };
}
function rowsOrStrings(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 10 || !v.every((x) => typeof x === "string"))
    throw new Error("SOCIAL_INVALID_RESPONSE");
  return v;
}
export const publishPost = internalAction({
  args: { tenantId: v.string(), postId: v.id("socialPosts") },
  handler: async (ctx, a): Promise<void> => {
    const post = await ctx.runMutation(internal.socialPublishing.claimPost, a);
    if (!post) return;
    let attempted = false;
    let phase:
      | "authorize"
      | "selection"
      | "media"
      | "facebook_page"
      | "facebook_publish"
      | "instagram_page"
      | "instagram_container"
      | "instagram_status"
      | "instagram_publish"
      | "youtube_init"
      | "youtube_upload"
      | "tiktok_creator"
      | "tiktok_ticket"
      | "tiktok_init"
      | "provider_receipt"
      | "save_receipt" = "authorize";
    try {
      const { grant, connectionId } = await authorized(ctx, a.tenantId, post.provider);
      if (connectionId !== post.connectionId) throw new Error("SOCIAL_RECONNECT");
      assertSocialScopes(grant.scopes, publishingScopes(post.kind));
      phase = "selection";
      const selected = await ctx.runQuery(internal.socialPublishing.selectedConnection, {
        tenantId: a.tenantId,
        provider: post.provider,
        connectionId,
        assetId: post.assetId,
      });
      if (selected.selectionRevision !== post.selectionRevision)
        throw new Error("SOCIAL_SELECTION_CHANGED");
      async function recheck() {
        if (process.env[`SOCIAL_${post!.provider.toUpperCase()}_PUBLISH_ENABLED`] !== "true")
          throw new Error("SOCIAL_PUBLISH_NOT_QUALIFIED");
        const current = await ctx.runQuery(internal.socialPublishing.selectedConnection, {
          tenantId: a.tenantId,
          provider: post!.provider,
          connectionId,
          assetId: post!.assetId,
        });
        if (current.selectionRevision !== post!.selectionRevision)
          throw new Error("SOCIAL_SELECTION_CHANGED");
      }
      let blob: Blob | undefined;
      phase = "media";
      if (post.storageId) {
        await ctx.runQuery(internal.uploads.requireOwned, {
          tenantId: a.tenantId,
          storageId: post.storageId,
        });
        blob = (await ctx.storage.get(post.storageId)) ?? undefined;
        if (!blob) throw new Error("SOCIAL_MEDIA_REQUIRED");
        validateSocialMedia(post.kind, blob.size, blob.type);
      }
      if (post.kind === "facebook_page") {
        phase = "facebook_page";
        const page = await pageFor(grant.accessToken, post.assetId);
        await recheck();
        // Only a customer-approved immutable post reaches the provider write.
        attempted = true;
        phase = "facebook_publish";
        const result = await socialJson(`${graph()}/${encodeURIComponent(post.assetId)}/feed`, {
          method: "POST",
          headers: {
            ...bearer(socialString(page.access_token, 8192)),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ message: post.text }),
        });
        phase = "provider_receipt";
        const providerPostId = socialString(result.id);
        phase = "save_receipt";
        await ctx.runMutation(internal.socialPublishing.finishPost, {
          ...a,
          status: "sent",
          providerPostId,
        });
      } else if (post.kind === "instagram") {
        phase = "instagram_page";
        const page = await pageFor(grant.accessToken, post.assetId, true);
        const headers = {
          ...bearer(socialString(page.access_token, 8192)),
          "Content-Type": "application/x-www-form-urlencoded",
        };
        const url = await ctx.storage.getUrl(post.storageId!);
        if (!url) throw new Error("SOCIAL_MEDIA_REQUIRED");
        await recheck();
        attempted = true;
        phase = "instagram_container";
        const container = await socialJson(`${graph()}/${post.assetId}/media`, {
          method: "POST",
          headers,
          body: new URLSearchParams({ image_url: url, caption: post.text }),
        });
        const id = socialString(container.id);
        let ready = false;
        for (let i = 0; i < 5; i++) {
          phase = "instagram_status";
          const state = await socialJson(
            `${graph()}/${encodeURIComponent(id)}?fields=status_code`,
            { headers },
          );
          if (state.status_code === "FINISHED") {
            ready = true;
            break;
          }
          if (state.status_code === "ERROR" || state.status_code === "EXPIRED") break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        if (!ready) throw new Error("SOCIAL_MEDIA_NOT_READY");
        const final = await ctx.runQuery(internal.socialPublishing.selectedConnection, {
          tenantId: a.tenantId,
          provider: post.provider,
          connectionId,
          assetId: post.assetId,
        });
        if (final.selectionRevision !== post.selectionRevision)
          throw new Error("SOCIAL_SELECTION_CHANGED");
        await recheck();
        phase = "instagram_publish";
        const result = await socialJson(`${graph()}/${post.assetId}/media_publish`, {
          method: "POST",
          headers,
          body: new URLSearchParams({ creation_id: id }),
        });
        phase = "provider_receipt";
        const providerPostId = socialString(result.id);
        phase = "save_receipt";
        await ctx.runMutation(internal.socialPublishing.finishPost, {
          ...a,
          status: "sent",
          providerPostId,
        });
      } else if (post.kind === "youtube") {
        await recheck();
        attempted = true;
        phase = "youtube_init";
        const init = await fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            headers: {
              ...bearer(grant.accessToken),
              "Content-Type": "application/json",
              "X-Upload-Content-Type": "video/mp4",
              "X-Upload-Content-Length": String(blob!.size),
            },
            body: JSON.stringify({
              snippet: { title: post.title, description: post.text },
              status: {
                privacyStatus: post.privacy,
                selfDeclaredMadeForKids: post.madeForKids,
                containsSyntheticMedia: post.aiGenerated,
              },
            }),
          },
        );
        if (!init.ok) throw new Error("SOCIAL_PROVIDER_UNAVAILABLE");
        const upload = socialUploadTarget("youtube", init.headers.get("location") ?? "");
        await init.body?.cancel();
        await recheck();
        phase = "youtube_upload";
        const result = await socialJson(upload, {
          method: "PUT",
          headers: { ...bearer(grant.accessToken), "Content-Type": "video/mp4" },
          body: blob,
        });
        phase = "provider_receipt";
        const providerPostId = socialString(result.id);
        phase = "save_receipt";
        await ctx.runMutation(internal.socialPublishing.finishPost, {
          ...a,
          status: "processing",
          providerPostId,
        });
      } else {
        phase = "tiktok_creator";
        const info = await creator(grant.accessToken);
        if (
          !info.privacyOptions.includes(post.privacy ?? "") ||
          (info.commentsDisabled && post.allowComments) ||
          (info.duetDisabled && post.allowDuet) ||
          (info.stitchDisabled && post.allowStitch)
        )
          throw new Error("SOCIAL_TIKTOK_CREATOR_SETTINGS_CHANGED");
        if (mp4Duration(new Uint8Array(await blob!.arrayBuffer())) > info.maxDurationSeconds)
          throw new Error("SOCIAL_TIKTOK_DURATION");
        const prefix = process.env.TIKTOK_MEDIA_URL_PREFIX,
          expected = `${process.env.CONVEX_SITE_URL}/social/media/`;
        if (prefix !== expected) throw new Error("SOCIAL_MEDIA_DOMAIN_NOT_VERIFIED");
        const ticket = socialNonce();
        phase = "tiktok_ticket";
        await ctx.runMutation(internal.socialPublishing.issueMediaTicket, {
          ...a,
          ticketHash: await socialHash(`media:${ticket}`),
        });
        const mediaUrl =
          expected +
          "video?postId=" +
          encodeURIComponent(post._id) +
          "&ticket=" +
          encodeURIComponent(ticket);
        await recheck();
        attempted = true;
        phase = "tiktok_init";
        const init = await socialJson("https://open.tiktokapis.com/v2/post/publish/video/init/", {
          method: "POST",
          headers: { ...bearer(grant.accessToken), "Content-Type": "application/json" },
          body: JSON.stringify({
            post_info: {
              title: post.text,
              privacy_level: post.privacy,
              disable_comment: !post.allowComments,
              disable_duet: !post.allowDuet,
              disable_stitch: !post.allowStitch,
              brand_content_toggle: post.paidPartnership,
              brand_organic_toggle: post.ownBrand,
              is_aigc: post.aiGenerated,
            },
            source_info: {
              source: "PULL_FROM_URL",
              video_url: mediaUrl,
            },
          }),
        });
        if (socialRecord(init.error).code !== "ok") throw new Error("SOCIAL_PROVIDER_UNAVAILABLE");
        phase = "provider_receipt";
        const data = socialRecord(init.data);
        const providerPostId = socialString(data.publish_id);
        phase = "save_receipt";
        await ctx.runMutation(internal.socialPublishing.finishPost, {
          ...a,
          status: "processing",
          providerPostId,
        });
      }
    } catch (error) {
      console.warn("SOCIAL_PUBLISH_FAILURE", {
        provider: post.provider,
        phase,
        ...socialFailureDiagnostic(error),
      });
      await ctx.runMutation(internal.socialPublishing.finishPost, {
        ...a,
        status: attempted ? "unknown" : "failed",
        failure: attempted
          ? "check_platform_before_retry"
          : "account_permission_or_media_unavailable",
      });
    }
  },
});

export const checkPost = tenantAction({
  args: { postId: v.id("socialPosts") },
  handler: async (ctx, a): Promise<{ status: string }> => {
    const p = await ctx.runQuery(internal.socialPublishing.postForCheck, {
      tenantId: ctx.tenantId,
      ...a,
    });
    if (!p?.providerPostId) throw new Error("SOCIAL_POST_NOT_PROCESSING");
    const { grant, connectionId } = await authorized(ctx, ctx.tenantId, p.provider);
    if (connectionId !== p.connectionId) throw new Error("SOCIAL_RECONNECT");
    await ctx.runQuery(internal.socialPublishing.selectedConnection, {
      tenantId: ctx.tenantId,
      provider: p.provider,
      connectionId,
      assetId: p.assetId,
    });
    let status: "sent" | "failed" | undefined;
    if (p.provider === "tiktok") {
      const result = await socialJson("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
        method: "POST",
        headers: { ...bearer(grant.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({ publish_id: p.providerPostId }),
      });
      if (socialRecord(result.error).code !== "ok") throw new Error("SOCIAL_PROVIDER_UNAVAILABLE");
      const value = socialRecord(result.data).status;
      if (value === "PUBLISH_COMPLETE") status = "sent";
      else if (value === "FAILED") status = "failed";
    } else if (p.provider === "youtube") {
      const items = rows(
        (
          await socialJson(
            "https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=" +
              encodeURIComponent(p.providerPostId),
            { headers: bearer(grant.accessToken) },
          )
        ).items,
      );
      const video = items.find((x) => x.id === p.providerPostId);
      if (video) {
        const value = socialRecord(video.status).uploadStatus;
        if (value === "processed") status = "sent";
        else if (["failed", "rejected", "deleted"].includes(String(value))) status = "failed";
      }
    }
    if (status)
      await ctx.runMutation(internal.socialPublishing.updateProcessing, {
        tenantId: ctx.tenantId,
        ...a,
        providerPostId: p.providerPostId,
        status,
      });
    return { status: status ?? "processing" };
  },
});
