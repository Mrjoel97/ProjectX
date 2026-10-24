import {
  SOCIAL_SCOPES,
  type SocialProvider,
  socialAuthorizationUrl,
  socialChallenge,
  socialExpiry,
  socialHash,
  socialJson,
  socialMetaTokenExpiry,
  socialNonce,
  socialRecord,
  socialString,
  validMetaVersion,
} from "@pikar/core/social";
import { requestedSocialScopes } from "@pikar/core/socialPublishing";
import { socialHmac } from "@pikar/core/socialWebhook";
import { openCredential, sealCredential } from "@pikar/revenue";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { requireCredentialKey } from "./connectorCredentials";
import { tenantAction } from "./lib/functions";
import { internalAction } from "./lib/tenantLifecycle";
import { socialProvider, youtubeConnectionEnabled } from "./social";

type Grant = { accessToken: string; refreshToken?: string; accountId: string; scopes: string[] };
function config(provider: SocialProvider) {
  const prefix = provider === "youtube" ? "YOUTUBE" : provider.toUpperCase();
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`]?.trim();
  const secret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`]?.trim();
  if (!clientId || !secret) throw new Error("SOCIAL_NOT_CONFIGURED");
  if (provider === "meta") validMetaVersion(process.env.META_GRAPH_API_VERSION);
  return { clientId, secret };
}
const scopeFor = (tenantId: string, provider: SocialProvider, connectionId: string) => ({
  tenantId,
  provider,
  connectionId,
  environment: "production" as const,
});
async function seal(
  tenantId: string,
  provider: SocialProvider,
  connectionId: string,
  grant: unknown,
) {
  const { ciphertextB64, ivB64, keyVersion } = await sealCredential(
    await requireCredentialKey(),
    scopeFor(tenantId, provider, connectionId),
    JSON.stringify(grant),
  );
  return { ciphertextB64, ivB64, keyVersion };
}
async function open(
  row: {
    tenantId: string;
    provider: SocialProvider;
    connectionId: string;
    keyVersion: "v1" | "v2";
    ciphertextB64?: string;
    ivB64?: string;
  },
  state = false,
) {
  if (!row.ciphertextB64 || !row.ivB64) throw new Error("SOCIAL_RECONNECT");
  return socialRecord(
    JSON.parse(
      await openCredential(
        await requireCredentialKey(row.keyVersion),
        scopeFor(row.tenantId, row.provider, row.connectionId + (state ? ":state" : "")),
        {
          ciphertextB64: row.ciphertextB64,
          ivB64: row.ivB64,
          keyVersion: row.keyVersion,
          algorithm: "AES-256-GCM",
        },
      ),
    ),
  );
}
function callbackUrl(provider: SocialProvider) {
  const origin = new URL(process.env.CONVEX_SITE_URL ?? "");
  if (
    origin.protocol !== "https:" ||
    !origin.hostname.endsWith(".convex.site") ||
    origin.username ||
    origin.password
  )
    throw new Error("SOCIAL_NOT_CONFIGURED");
  return new URL(`/social/${provider}/callback`, origin).toString();
}
function tokenUrl(provider: SocialProvider) {
  return provider === "x"
    ? "https://api.x.com/2/oauth2/token"
    : provider === "tiktok"
      ? "https://open.tiktokapis.com/v2/oauth/token/"
      : provider === "youtube"
        ? "https://oauth2.googleapis.com/token"
        : "https://graph.facebook.com/" +
          validMetaVersion(process.env.META_GRAPH_API_VERSION) +
          "/oauth/access_token";
}
async function tokens(provider: SocialProvider, values: Record<string, string>) {
  const { clientId, secret } = config(provider);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (provider === "x")
    headers.Authorization = `Basic ${btoa(`${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`)}`;
  return socialJson(tokenUrl(provider), {
    method: "POST",
    headers,
    body: new URLSearchParams({
      ...values,
      [provider === "tiktok" ? "client_key" : "client_id"]: clientId,
      ...(provider !== "x" ? { client_secret: secret } : {}),
    }),
  });
}
async function identity(
  provider: SocialProvider,
  accessToken: string,
): Promise<{ id: string; name: string }> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  if (provider === "x") {
    const user = socialRecord((await socialJson("https://api.x.com/2/users/me", { headers })).data);
    return { id: socialString(user.id), name: socialString(user.username) };
  }
  if (provider === "tiktok") {
    const result = await socialJson(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
      { headers },
    );
    const user = socialRecord(socialRecord(result.data).user);
    return { id: socialString(user.open_id), name: socialString(user.display_name) };
  }
  if (provider === "youtube") {
    const result = await socialJson(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50",
      { headers },
    );
    if (!Array.isArray(result.items) || result.items.length !== 1)
      throw new Error("SOCIAL_CHANNEL_SELECTION_REQUIRED");
    const channel = socialRecord(result.items[0]);
    return {
      id: socialString(channel.id),
      name: socialString(socialRecord(channel.snippet).title),
    };
  }
  const result = await socialJson(
    "https://graph.facebook.com/" +
      validMetaVersion(process.env.META_GRAPH_API_VERSION) +
      "/me?fields=id,name",
    { headers },
  );
  return { id: socialString(result.id), name: socialString(result.name) };
}
async function grantedScopes(
  provider: SocialProvider,
  value: Record<string, unknown>,
  token: string,
  previous?: string[],
  required: readonly string[] = SOCIAL_SCOPES[provider],
): Promise<string[]> {
  let scopes: string[];
  if (provider === "meta") {
    const result = await socialJson(
      "https://graph.facebook.com/" +
        validMetaVersion(process.env.META_GRAPH_API_VERSION) +
        "/me/permissions",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!Array.isArray(result.data)) throw new Error("SOCIAL_INCOMPLETE_GRANT");
    scopes = result.data
      .map(socialRecord)
      .filter((row) => row.status === "granted")
      .map((row) => socialString(row.permission));
  } else
    scopes =
      typeof value.scope === "string"
        ? value.scope.split(/[ ,]+/).filter(Boolean)
        : (previous ?? []);
  if (
    !required.filter((scope) => scope !== "offline.access").every((scope) => scopes.includes(scope))
  )
    throw new Error("SOCIAL_INCOMPLETE_GRANT");
  const accepted = new Set([...required, ...(previous ?? [])]);
  return [...new Set(scopes)].filter((scope) => accepted.has(scope));
}
export const startConnect = tenantAction({
  args: {
    provider: socialProvider,
    intent: v.optional(
      v.union(
        v.literal("identity"),
        v.literal("read"),
        v.literal("publish"),
        v.literal("publish_facebook"),
        v.literal("publish_instagram"),
      ),
    ),
  },
  handler: async (ctx, { provider, intent = "identity" }): Promise<{ url: string }> => {
    if (provider === "youtube" && !youtubeConnectionEnabled())
      throw new Error("SOCIAL_NOT_CONFIGURED");
    const existing = await ctx.runQuery(internal.social.connection, {
      tenantId: ctx.tenantId,
      provider,
    });
    const allowed = requestedSocialScopes(provider, provider === "x" ? "identity" : "publish");
    const scopes = [
      ...new Set([
        ...requestedSocialScopes(provider, intent),
        ...(existing?.scopes ?? []).filter((scope) => allowed.includes(scope)),
      ]),
    ];
    const facebook = scopes.includes("pages_manage_posts"),
      instagram = scopes.includes("instagram_content_publish");
    const publishing = facebook || instagram;
    const metaConfigId =
      provider === "meta" && publishing
        ? (facebook && instagram
            ? process.env.META_PUBLISH_CONFIG_ID
            : facebook
              ? process.env.META_FACEBOOK_PUBLISH_CONFIG_ID
              : process.env.META_INSTAGRAM_PUBLISH_CONFIG_ID
          )?.trim()
        : process.env.META_LOGIN_CONFIG_ID?.trim();
    if (provider === "meta" && publishing && !metaConfigId)
      throw new Error("SOCIAL_PUBLISH_NOT_CONFIGURED");
    const { clientId } = config(provider);
    await requireCredentialKey();
    const redirectUri = callbackUrl(provider),
      state = socialNonce(),
      verifier = socialNonce(),
      connectionId = crypto.randomUUID();
    await ctx.runMutation(internal.social.storeState, {
      tenantId: ctx.tenantId,
      provider,
      connectionId,
      stateHash: await socialHash(`${provider}:state:${state}`),
      ...(await seal(ctx.tenantId, provider, `${connectionId}:state`, {
        clientId,
        verifier,
        redirectUri,
        scopes,
      })),
    });
    return {
      url: socialAuthorizationUrl(provider, {
        clientId,
        redirectUri,
        state,
        challenge: await socialChallenge(verifier),
        metaVersion: process.env.META_GRAPH_API_VERSION,
        metaConfigId,
        scopes,
      }),
    };
  },
});

/** Resolve omitted Meta expiry from provider metadata; never invent a token lifetime. */
export async function metaTokenExpiry(token: string, accountId: string): Promise<number> {
  const { clientId, secret } = config("meta");
  const target = new URL(
    "https://graph.facebook.com/" +
      validMetaVersion(process.env.META_GRAPH_API_VERSION) +
      "/debug_token",
  );
  target.searchParams.set("input_token", token);
  let response: Record<string, unknown>;
  try {
    response = await socialJson(target.toString(), {
      headers: { Authorization: `Bearer ${clientId}|${secret}` },
    });
  } catch {
    // Do not propagate request URLs or provider text: they may contain the input token.
    throw new Error("SOCIAL_META_TOKEN_METADATA_UNAVAILABLE");
  }
  return socialMetaTokenExpiry(response.data, clientId, accountId);
}

export const callback = internalAction({
  args: {
    provider: socialProvider,
    state: v.string(),
    code: v.optional(v.string()),
    denied: v.boolean(),
  },
  handler: async (ctx, a): Promise<{ receipt?: string }> => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(a.state)) throw new Error("SOCIAL_INVALID_STATE");
    const requestHash = await socialHash(`${a.provider}:state:${a.state}`);
    const pending = await ctx.runMutation(internal.social.consumeState, {
      provider: a.provider,
      stateHash: requestHash,
    });
    if (!pending) throw new Error("SOCIAL_INVALID_STATE");
    if (a.denied) return {};
    const code = socialString(a.code, 4096),
      state = await open(pending, true);
    if (
      state.redirectUri !== callbackUrl(a.provider) ||
      state.clientId !== config(a.provider).clientId
    )
      throw new Error("SOCIAL_INVALID_STATE");
    let result = await tokens(a.provider, {
      grant_type: "authorization_code",
      code,
      redirect_uri: String(state.redirectUri),
      ...(a.provider === "x" || a.provider === "youtube"
        ? { code_verifier: socialString(state.verifier) }
        : {}),
    });
    let accessToken = socialString(result.access_token, 8192);
    if (a.provider === "meta") {
      result = await tokens("meta", {
        grant_type: "fb_exchange_token",
        fb_exchange_token: accessToken,
      });
      accessToken = socialString(result.access_token, 8192);
    }
    const account = await identity(a.provider, accessToken);
    const required = Array.isArray(state.scopes)
      ? state.scopes.map((x) => socialString(x, 128))
      : SOCIAL_SCOPES[a.provider];
    const scopes = await grantedScopes(a.provider, result, accessToken, undefined, required);
    const refreshToken =
      a.provider === "meta" ? undefined : socialString(result.refresh_token, 8192);
    const receipt = socialNonce();
    const saved = await ctx.runMutation(internal.social.storePendingGrant, {
      tenantId: pending.tenantId,
      provider: a.provider,
      connectionId: pending.connectionId,
      requestHash,
      stateHash: await socialHash(`${a.provider}:receipt:${receipt}`),
      tokenExpiresAt:
        a.provider === "meta" && result.expires_in === undefined
          ? await metaTokenExpiry(accessToken, account.id)
          : socialExpiry(result.expires_in),
      accountIdHash: await socialHash(`${a.provider}:account:${account.id}`),
      accountName: account.name,
      scopes,
      ...(await seal(pending.tenantId, a.provider, pending.connectionId, {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        accountId: account.id,
        scopes,
      })),
    });
    return saved ? { receipt } : {};
  },
});
/** Called after a real channels read, never cached account rediscovery. */
export async function verifyYouTubeMetadata(
  ctx: ActionCtx,
  tenantId: string,
  connectionId: string,
  grant: Grant,
) {
  const row = await ctx.runQuery(internal.social.connection, { tenantId, provider: "youtube" });
  if (!row || row.connectionId !== connectionId || row.status !== "connected")
    throw new Error("SOCIAL_RECONNECT");
  const account = await identity("youtube", grant.accessToken);
  if (account.id !== grant.accountId) throw new Error("SOCIAL_ACCOUNT_MISMATCH");
  await ctx.runMutation(internal.social.recordYouTubeMetadata, {
    tenantId,
    connectionId,
    revision: row.revision,
    accountId: account.id,
    accountName: account.name,
  });
  return account;
}
export async function authorized(
  ctx: ActionCtx,
  tenantId: string,
  provider: SocialProvider,
): Promise<{ grant: Grant; connectionId: string }> {
  const row = await ctx.runQuery(internal.social.connection, { tenantId, provider });
  if (row?.status !== "connected") throw new Error("SOCIAL_RECONNECT");
  const value = await open(row);
  const grant: Grant = {
    accessToken: socialString(value.accessToken, 8192),
    ...(typeof value.refreshToken === "string" ? { refreshToken: value.refreshToken } : {}),
    accountId: socialString(value.accountId),
    scopes: row.scopes,
  };
  if (row.expiresAt > Date.now() + 60000) return { grant, connectionId: row.connectionId };
  const lease = crypto.randomUUID();
  if (
    !(await ctx.runMutation(internal.social.claimRefresh, {
      tenantId,
      provider,
      connectionId: row.connectionId,
      revision: row.revision,
      lease,
    }))
  )
    throw new Error("SOCIAL_REFRESH_BUSY");
  try {
    if (!grant.refreshToken) throw new Error("SOCIAL_RECONNECT");
    const result = await tokens(provider, {
      grant_type: "refresh_token",
      refresh_token: grant.refreshToken,
    });
    const next: Grant = {
      ...grant,
      accessToken: socialString(result.access_token, 8192),
      refreshToken:
        typeof result.refresh_token === "string"
          ? socialString(result.refresh_token, 8192)
          : grant.refreshToken,
      scopes: await grantedScopes(
        provider,
        result,
        socialString(result.access_token, 8192),
        grant.scopes,
      ),
    };
    const saved = await ctx.runMutation(internal.social.finishRefresh, {
      tenantId,
      provider,
      connectionId: row.connectionId,
      revision: row.revision,
      lease,
      expiresAt: socialExpiry(result.expires_in),
      scopes: next.scopes,
      ...(await seal(tenantId, provider, row.connectionId, next)),
    });
    if (!saved) throw new Error("SOCIAL_RECONNECT");
    return { grant: next, connectionId: row.connectionId };
  } catch {
    await ctx.runMutation(internal.social.finishRefresh, {
      tenantId,
      provider,
      connectionId: row.connectionId,
      revision: row.revision,
      lease,
      keyVersion: row.keyVersion,
    });
    throw new Error("SOCIAL_RECONNECT");
  }
}
type DisconnectResult = {
  disconnectedHere: true;
  upstreamRevoked: boolean;
  upstreamRevocation: string;
};
async function disconnectForScope(
  ctx: ActionCtx,
  tenantId: string,
  provider: SocialProvider,
): Promise<DisconnectResult> {
  // Fences callbacks, refreshes and provider writes before awaiting the provider.
  // The credential leaves the database only as a sealed in-memory action result.
  const row = await ctx.runMutation(internal.social.beginDisconnect, { tenantId, provider });
  let upstreamRevoked = false;
  if (provider === "youtube" && row?.ciphertextB64 && row.ivB64) {
    try {
      const grant = await open(row);
      const token = socialString(grant.refreshToken ?? grant.accessToken, 8192);
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      upstreamRevoked = response.ok;
      await response.body?.cancel();
    } catch {
      // No vendor body, request URL, token, or decrypted grant escapes this action.
      // Do not retry an old token later: Google revocation is project-wide and
      // could invalidate a customer's subsequent reconnect.
    }
  }
  return {
    disconnectedHere: true,
    upstreamRevoked,
    upstreamRevocation:
      provider === "youtube"
        ? upstreamRevoked
          ? "Google confirmed revocation of this user's access granted to the Google project, including its other integrations."
          : "Local access removed. Google revocation is unconfirmed; remove Pikar AI in Google Account connections to revoke project access."
        : "Remove Pikar AI in your social account's connected-app settings to revoke provider access.",
  };
}
/** Customer disconnect with an immediate, bounded Google revocation attempt. */
export const disconnect = tenantAction({
  args: {
    provider: socialProvider,
    acknowledgedGoogleProjectRevocation: v.optional(v.boolean()),
  },
  handler: async (ctx, a): Promise<DisconnectResult> => {
    if (a.provider === "youtube" && a.acknowledgedGoogleProjectRevocation !== true)
      throw new Error("SOCIAL_GOOGLE_PROJECT_REVOCATION_ACK_REQUIRED");
    return disconnectForScope(ctx, ctx.tenantId, a.provider);
  },
});
/** Account erasure already has explicit confirmation and may run after the write fence. */
export const disconnectForTenant = internalAction({
  args: { tenantId: v.string(), provider: v.literal("youtube") },
  handler: async (ctx, a): Promise<DisconnectResult> =>
    disconnectForScope(ctx, a.tenantId, a.provider),
});

/** An explicit authenticated read; connection success never implies publishing/analytics rights. */
export const verifyConnection = tenantAction({
  args: { provider: socialProvider },
  handler: async (ctx, { provider }): Promise<{ verified: true; accountName: string }> => {
    const { grant, connectionId } = await authorized(ctx, ctx.tenantId, provider);
    const account = await identity(provider, grant.accessToken);
    if (account.id !== grant.accountId) throw new Error("SOCIAL_ACCOUNT_MISMATCH");
    const row = await ctx.runQuery(internal.social.connection, {
      tenantId: ctx.tenantId,
      provider,
    });
    if (
      !row ||
      row.connectionId !== connectionId ||
      row.status !== "connected" ||
      row.accountIdHash !== (await socialHash(`${provider}:account:${account.id}`))
    )
      throw new Error("SOCIAL_RECONNECT");
    if (provider === "youtube")
      await ctx.runMutation(internal.social.recordYouTubeMetadata, {
        tenantId: ctx.tenantId,
        connectionId,
        revision: row.revision,
        accountId: account.id,
        accountName: account.name,
      });
    return { verified: true, accountName: account.name };
  },
});

/** Subscribe to the connected channel's public feed only; a hub acknowledgement is not delivery proof. */
export const subscribeYouTube = tenantAction({
  args: {},
  handler: async (ctx): Promise<{ requested: true }> => {
    const { grant } = await authorized(ctx, ctx.tenantId, "youtube");
    const secret = process.env.YOUTUBE_WEBHOOK_SECRET;
    if (!secret || secret.length < 32) throw new Error("SOCIAL_WEBHOOK_NOT_CONFIGURED");
    const topic =
      "https://www.youtube.com/xml/feeds/videos.xml?channel_id=" +
      encodeURIComponent(grant.accountId);
    const response = await fetch("https://pubsubhubbub.appspot.com/subscribe", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "hub.callback": callbackUrl("youtube").replace("/callback", "/webhook"),
        "hub.topic": topic,
        "hub.mode": "subscribe",
        "hub.verify": "async",
        "hub.secret": secret,
        "hub.verify_token": await socialHmac(secret, topic),
        "hub.lease_seconds": "86400",
      }),
    });
    if (!response.ok) throw new Error("SOCIAL_WEBHOOK_UNAVAILABLE");
    await response.body?.cancel();
    return { requested: true };
  },
});
