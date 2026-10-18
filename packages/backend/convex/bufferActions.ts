import {
  BUFFER_AUTH_URL,
  BUFFER_ID,
  BUFFER_MCP_URL,
  BUFFER_REGISTER_URL,
  BUFFER_SCOPES,
  BUFFER_TOKEN_URL,
  bufferCreateArguments,
  bufferRecord,
  normalizeBufferChannels,
  normalizeBufferMetrics,
} from "@pikar/core/buffer";
import { openCredential, sealCredential } from "@pikar/revenue";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { requireCredentialKey } from "./connectorCredentials";
import { BufferFailure, bufferJson, callBufferTool } from "./lib/bufferMcp";
import { tenantAction } from "./lib/functions";
import { internalAction } from "./lib/tenantLifecycle";

type Grant = { clientId: string; accessToken: string; refreshToken: string; scope: string };
function storedGrant(value: Record<string, unknown>): Grant {
  if (
    ![value.clientId, value.accessToken, value.refreshToken, value.scope].every(
      (field) => typeof field === "string" && field.length > 0,
    )
  )
    throw new Error("BUFFER_RECONNECT");
  return {
    clientId: value.clientId as string,
    accessToken: value.accessToken as string,
    refreshToken: value.refreshToken as string,
    scope: value.scope as string,
  };
}
const scopeFor = (tenantId: string, connectionId: string) => ({
  tenantId,
  connectionId,
  provider: "buffer" as const,
  environment: "production" as const,
});
const nonce = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`buffer-state:${value}`)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
function callbackUrl(): string {
  const origin = new URL(process.env.CONVEX_SITE_URL ?? "");
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".convex.site"))
    throw new Error("BUFFER_NOT_CONFIGURED");
  return new URL("/buffer/callback", origin).toString();
}
function tokenGrant(
  value: Record<string, unknown>,
  clientId: string,
  previousScope?: string,
): Grant {
  const granted = typeof value.scope === "string" ? value.scope : previousScope;
  if (
    typeof value.access_token !== "string" ||
    !value.access_token ||
    typeof value.refresh_token !== "string" ||
    !value.refresh_token ||
    typeof granted !== "string" ||
    !BUFFER_SCOPES.filter((s) => s !== "offline_access").every((s) =>
      granted.split(/\s+/).includes(s),
    )
  )
    throw new Error("BUFFER_INCOMPLETE_GRANT");
  return {
    clientId,
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    scope: granted,
  };
}
function expiresAt(value: Record<string, unknown>): number {
  if (
    typeof value.expires_in !== "number" ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    value.expires_in > 86400
  )
    throw new Error("BUFFER_INVALID_TOKEN_EXPIRY");
  return Date.now() + value.expires_in * 1000;
}
async function seal(tenantId: string, connectionId: string, value: unknown) {
  const encrypted = await sealCredential(
    await requireCredentialKey(),
    scopeFor(tenantId, connectionId),
    JSON.stringify(value),
  );
  return {
    ciphertextB64: encrypted.ciphertextB64,
    ivB64: encrypted.ivB64,
    keyVersion: encrypted.keyVersion,
  };
}
async function open(
  row: {
    tenantId: string;
    connectionId: string;
    keyVersion: "v1" | "v2";
    ciphertextB64?: string;
    ivB64?: string;
  },
  state = false,
): Promise<Record<string, unknown>> {
  if (!row.ciphertextB64 || !row.ivB64) throw new Error("BUFFER_RECONNECT");
  return bufferRecord(
    JSON.parse(
      await openCredential(
        await requireCredentialKey(row.keyVersion),
        scopeFor(row.tenantId, row.connectionId + (state ? ":state" : "")),
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

export const startConnect = tenantAction({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    await requireCredentialKey();
    const redirectUri = callbackUrl();
    const client = await bufferJson(BUFFER_REGISTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Pikar AI social marketing",
        client_uri: process.env.SITE_URL,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: BUFFER_SCOPES.join(" "),
      }),
    });
    if (typeof client.client_id !== "string" || !client.client_id)
      throw new Error("BUFFER_REGISTRATION_FAILED");
    const state = nonce();
    const verifier = nonce();
    const connectionId = crypto.randomUUID();
    const challenge = btoa(
      String.fromCharCode(
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
        ),
      ),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    await ctx.runMutation(internal.buffer.storeState, {
      tenantId: ctx.tenantId,
      connectionId,
      stateHash: await hash(state),
      ...(await seal(ctx.tenantId, `${connectionId}:state`, {
        clientId: client.client_id,
        verifier,
        redirectUri,
      })),
    });
    const url = new URL(BUFFER_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: BUFFER_SCOPES.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: BUFFER_MCP_URL,
      prompt: "consent",
    }).toString();
    return { url: url.toString() };
  },
});

export const callback = internalAction({
  args: { state: v.string(), code: v.optional(v.string()), denied: v.boolean() },
  handler: async (ctx, a): Promise<{ receipt?: string }> => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(a.state)) throw new Error("BUFFER_INVALID_STATE");
    const pending = await ctx.runMutation(internal.buffer.consumeState, {
      stateHash: await hash(a.state),
    });
    if (!pending) throw new Error("BUFFER_INVALID_STATE");
    if (a.denied) return {};
    if (!a.code || a.code.length > 4096) throw new Error("BUFFER_INVALID_STATE");
    const state = await open(pending, true);
    if (
      typeof state.clientId !== "string" ||
      typeof state.verifier !== "string" ||
      state.redirectUri !== callbackUrl()
    )
      throw new Error("BUFFER_INVALID_STATE");
    const tokens = await bufferJson(BUFFER_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: state.clientId,
        redirect_uri: state.redirectUri,
        code: a.code,
        code_verifier: state.verifier,
        resource: BUFFER_MCP_URL,
      }),
    });
    const grant = tokenGrant(tokens, state.clientId);
    const receipt = nonce();
    await ctx.runMutation(internal.buffer.storePendingGrant, {
      tenantId: pending.tenantId,
      connectionId: pending.connectionId,
      requestStateHash: pending.stateHash,
      stateHash: await hash(receipt),
      tokenExpiresAt: expiresAt(tokens),
      ...(await seal(pending.tenantId, pending.connectionId, grant)),
    });
    return { receipt };
  },
});

async function authorized(
  ctx: ActionCtx,
  tenantId: string,
): Promise<{ row: Doc<"bufferConnections">; grant: Grant }> {
  let row = await ctx.runQuery(internal.buffer.connection, { tenantId });
  if (!row || row.status !== "connected") throw new Error("BUFFER_RECONNECT");
  let stored = await open(row);
  let grant = storedGrant(stored);
  if (row.expiresAt <= Date.now() + 60_000) {
    const lease = crypto.randomUUID();
    if (
      !(await ctx.runMutation(internal.buffer.claimRefresh, {
        tenantId,
        connectionId: row.connectionId,
        revision: row.revision,
        lease,
      }))
    )
      throw new Error("BUFFER_REFRESH_IN_PROGRESS");
    try {
      const tokens = await bufferJson(BUFFER_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: grant.clientId,
          refresh_token: grant.refreshToken,
          resource: BUFFER_MCP_URL,
        }),
      });
      grant = tokenGrant(tokens, grant.clientId, grant.scope);
      if (
        !(await ctx.runMutation(internal.buffer.finishRefresh, {
          tenantId,
          connectionId: row.connectionId,
          revision: row.revision,
          lease,
          expiresAt: expiresAt(tokens),
          credential: await seal(tenantId, row.connectionId, grant),
        }))
      )
        throw new Error("BUFFER_RECONNECT");
    } catch {
      await ctx.runMutation(internal.buffer.finishRefresh, {
        tenantId,
        connectionId: row.connectionId,
        revision: row.revision,
        lease,
      });
      throw new Error("BUFFER_RECONNECT");
    }
    row = await ctx.runQuery(internal.buffer.connection, { tenantId });
    if (!row || row.status !== "connected") throw new Error("BUFFER_RECONNECT");
    stored = await open(row);
    grant = storedGrant(stored);
  }
  return { row, grant };
}

async function organizationsFor(token: string): Promise<{ id: string; name: string }[]> {
  const account = await callBufferTool(token, "get_account", {});
  if (!Array.isArray(account.organizations) || account.organizations.length > 100)
    throw new Error("BUFFER_INVALID_RESPONSE");
  return account.organizations.map((value) => {
    const org = bufferRecord(value);
    if (typeof org.id !== "string" || !BUFFER_ID.test(org.id) || typeof org.name !== "string")
      throw new Error("BUFFER_INVALID_RESPONSE");
    return { id: org.id, name: org.name.slice(0, 160) };
  });
}
export const organizations = tenantAction({
  args: {},
  handler: async (ctx) => organizationsFor((await authorized(ctx, ctx.tenantId)).grant.accessToken),
});

export const loadChannels = tenantAction({
  args: { organizationId: v.string() },
  handler: async (ctx, a): Promise<void> => {
    const { row, grant } = await authorized(ctx, ctx.tenantId);
    const organization = (await organizationsFor(grant.accessToken)).find(
      (org) => org.id === a.organizationId,
    );
    if (!organization) throw new Error("BUFFER_ORGANIZATION_NOT_ALLOWED");
    const result = await callBufferTool(grant.accessToken, "execute_query", {
      summary: "Read connected social channels for the selected Buffer organization",
      query:
        "query PikarChannels($org:OrganizationId!){channels(input:{organizationId:$org}){id name service isDisconnected isLocked metadata{... on PinterestMetadata{boards{serviceId name}}}}}",
      variables: { org: organization.id },
    });
    if (result.errors) throw new Error("BUFFER_CHANNEL_READ_FAILED");
    const data = bufferRecord(result.data ?? result);
    const channels = normalizeBufferChannels(data.channels);
    await ctx.runMutation(internal.buffer.storeChannels, {
      tenantId: ctx.tenantId,
      connectionId: row.connectionId,
      organizationId: organization.id,
      organizationName: organization.name,
      channels,
    });
  },
});

async function reportFor(ctx: ActionCtx, tenantId: string, expectedConnectionId?: string) {
  const { row, grant } = await authorized(ctx, tenantId);
  if (expectedConnectionId && (row.connectionId !== expectedConnectionId || !row.dailyReports))
    return;
  if (!row.organizationId || !row.selectedChannelIds.length)
    throw new Error("BUFFER_SELECT_CHANNELS");
  const endAt = Date.now();
  const startAt = endAt - 30 * 86400_000;
  const result = await callBufferTool(grant.accessToken, "get_aggregated_post_metrics", {
    organizationId: row.organizationId,
    channelIds: row.selectedChannelIds,
    startDateTime: new Date(startAt).toISOString(),
    endDateTime: new Date(endAt).toISOString(),
  });
  const metrics = normalizeBufferMetrics(result.metrics);
  const refreshed =
    result.metricsUpdatedAt === null
      ? null
      : typeof result.metricsUpdatedAt === "string"
        ? Date.parse(result.metricsUpdatedAt)
        : NaN;
  if (refreshed !== null && (!Number.isFinite(refreshed) || refreshed > endAt + 60_000))
    throw new Error("BUFFER_INVALID_METRICS");
  await ctx.runMutation(internal.buffer.saveReport, {
    tenantId,
    connectionId: row.connectionId,
    organizationId: row.organizationId,
    channelIds: row.selectedChannelIds,
    startAt,
    endAt,
    metricsUpdatedAt: refreshed,
    metrics,
  });
  return { metrics, metricsUpdatedAt: refreshed, startAt, endAt };
}
export const refreshReport = tenantAction({
  args: {},
  handler: (ctx) => reportFor(ctx, ctx.tenantId),
});
export const dailyReport = internalAction({
  args: { tenantId: v.string(), connectionId: v.string() },
  handler: async (ctx, a) => {
    try {
      await reportFor(ctx, a.tenantId, a.connectionId);
    } finally {
      await syncFor(ctx, a.tenantId, a.connectionId);
    }
  },
});
export const agentReport = internalAction({
  args: { tenantId: v.string() },
  handler: (ctx, a) => reportFor(ctx, a.tenantId),
});
export const agentChannels = internalAction({
  args: { tenantId: v.string() },
  handler: async (ctx, a) => {
    const { row } = await authorized(ctx, a.tenantId);
    return {
      organization: row.organizationName ?? null,
      channels: row.channels.filter((channel) => row.selectedChannelIds.includes(channel.id)),
    };
  },
});

export const publishPost = internalAction({
  args: { tenantId: v.string(), postId: v.id("bufferPosts") },
  handler: async (ctx, a): Promise<void> => {
    const post = await ctx.runMutation(internal.buffer.claimPost, a);
    if (!post) return;
    let attempted = false;
    try {
      const { row, grant } = await authorized(ctx, a.tenantId);
      if (row.connectionId !== post.connectionId || row.organizationId !== post.organizationId)
        throw new Error("BUFFER_CONNECTION_CHANGED");
      const target = row.channels.find(
        (channel) => channel.id === post.channelId && channel.available,
      );
      if (!target || !row.selectedChannelIds.includes(post.channelId))
        throw new Error("BUFFER_CHANNEL_NOT_ALLOWED");
      const args = bufferCreateArguments(post, target.service);
      attempted = true;
      const result = await callBufferTool(grant.accessToken, "create_post", args);
      const saved = bufferRecord(result.post ?? result);
      if (typeof saved.id !== "string" || !BUFFER_ID.test(saved.id))
        throw new Error("BUFFER_UNCONFIRMED_POST");
      const status = postStatus(saved.status);
      if (!status) throw new Error("BUFFER_UNCONFIRMED_POST");
      await ctx.runMutation(internal.buffer.finishPost, { ...a, status, bufferPostId: saved.id });
    } catch (error) {
      const knownRejection =
        error instanceof BufferFailure &&
        ["rejected", "reauth", "rate_limited"].includes(error.reason);
      await ctx.runMutation(internal.buffer.finishPost, {
        ...a,
        status: attempted && !knownRejection ? "unknown" : "failed",
        failure: attempted && !knownRejection ? "check_buffer_before_retry" : "provider_rejected",
      });
    }
  },
});

function postStatus(value: unknown): "scheduled" | "sent" | "failed" | "buffer_review" | null {
  return value === "sent"
    ? "sent"
    : value === "scheduled" || value === "sending"
      ? "scheduled"
      : value === "error"
        ? "failed"
        : value === "needs_approval" || value === "draft"
          ? "buffer_review"
          : null;
}
async function syncFor(
  ctx: ActionCtx,
  tenantId: string,
  expectedConnectionId?: string,
): Promise<{ checked: number }> {
  const { row, grant } = await authorized(ctx, tenantId);
  if (expectedConnectionId && row.connectionId !== expectedConnectionId) return { checked: 0 };
  const posts = (
    await ctx.runQuery(internal.buffer.pendingPosts, { tenantId, connectionId: row.connectionId })
  ).filter((post) => row.selectedChannelIds.includes(post.channelId));
  if (!posts.length) return { checked: 0 };
  const definitions = posts.map((_, index) => `$id${index}: PostId!`).join(", ");
  const fields = posts
    .map((_, index) => `p${index}: post(input: { id: $id${index} }) { id channelId status }`)
    .join(" ");
  const result = await callBufferTool(grant.accessToken, "execute_query", {
    summary: "Check publishing status for Pikar's approved Buffer posts",
    query: `query PikarPostStatus(${definitions}) { ${fields} }`,
    variables: Object.fromEntries(posts.map((post, index) => [`id${index}`, post.bufferPostId])),
  });
  if (result.errors) throw new Error("BUFFER_STATUS_UNAVAILABLE");
  const data = bufferRecord(result.data ?? result);
  const updates = posts.flatMap((post, index) => {
    if (!data[`p${index}`]) return [];
    const value = bufferRecord(data[`p${index}`]);
    const status = postStatus(value.status);
    if (value.id !== post.bufferPostId || value.channelId !== post.channelId || !status) return [];
    return [{ ...post, status }];
  });
  await ctx.runMutation(internal.buffer.savePostStatuses, {
    tenantId,
    connectionId: row.connectionId,
    updates,
  });
  return { checked: updates.length };
}
export const refreshPosts = tenantAction({
  args: {},
  handler: (ctx) => syncFor(ctx, ctx.tenantId),
});
