import { BUFFER_SCOPES } from "@pikar/core/buffer";
import { importCredentialKey, openCredential, sealCredential } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { bufferGraphql, bufferJson, callBufferTool } from "./lib/bufferMcp";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const channelId = "1234567890abcdef12345678";
const organizationId = "1234567890abcdef12345679";
const envelope = { ciphertextB64: "test-ciphertext", ivB64: "test-iv", keyVersion: "v1" as const };
const receipt = "a".repeat(43);
async function stateHash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`buffer-state:${value}`)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", {}));
  const otherId = await t.run((ctx) => ctx.db.insert("users", {}));
  const tenantId = String(userId);
  const asUser = t.withIdentity({ subject: `${userId}|session1` });
  const asOther = t.withIdentity({ subject: `${otherId}|session2` });
  return { t, tenantId, userId, otherId, asUser, asOther };
}
async function connect(h: Awaited<ReturnType<typeof setup>>) {
  await pendingGrant(h);
  await h.asUser.mutation(api.buffer.completeConnect, { receipt });
  await h.t.mutation(internal.buffer.storeChannels, {
    tenantId: h.tenantId,
    connectionId: "connection1",
    organizationId,
    organizationName: "Own organization",
    channels: [{ id: channelId, name: "Own channel", service: "linkedin", available: true }],
  });
  await h.asUser.mutation(api.buffer.selectChannels, {
    channelIds: [channelId],
    dailyReports: false,
  });
}
async function pendingGrant(h: Awaited<ReturnType<typeof setup>>) {
  await h.t.mutation(internal.buffer.storeState, {
    tenantId: h.tenantId,
    stateHash: "request",
    connectionId: "connection1",
    ...envelope,
  });
  await h.t.mutation(internal.buffer.consumeState, { stateHash: "request" });
  await h.t.mutation(internal.buffer.storePendingGrant, {
    tenantId: h.tenantId,
    connectionId: "connection1",
    requestStateHash: "request",
    stateHash: await stateHash(receipt),
    tokenExpiresAt: Date.now() + 3600000,
    ...envelope,
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Buffer account isolation and lifecycle", () => {
  test("only the initiating authenticated tenant can finish a callback receipt; receipts cannot replay", async () => {
    const h = await setup();
    await pendingGrant(h);
    await expect(h.asOther.mutation(api.buffer.completeConnect, { receipt })).rejects.toThrow(
      "BUFFER_INVALID_STATE",
    );
    await h.asUser.mutation(api.buffer.completeConnect, { receipt });
    await expect(h.asUser.mutation(api.buffer.completeConnect, { receipt })).rejects.toThrow(
      "BUFFER_INVALID_STATE",
    );
    expect((await h.asOther.query(api.buffer.status, {})).connected).toBe(false);
    const safe = await h.asUser.query(api.buffer.status, {});
    expect(JSON.stringify(safe)).not.toContain("test-ciphertext");
    expect(JSON.stringify(safe)).not.toContain("ivB64");
    await expect(h.t.query(api.buffer.status, {})).rejects.toThrow("UNAUTHENTICATED");
  });
  test("consumes OAuth nonces once and refuses an expired request", async () => {
    const h = await setup();
    await h.t.mutation(internal.buffer.storeState, {
      tenantId: h.tenantId,
      stateHash: "statehash",
      connectionId: "connection1",
      ...envelope,
    });
    expect(
      await h.t.mutation(internal.buffer.consumeState, { stateHash: "statehash" }),
    ).not.toBeNull();
    expect(await h.t.mutation(internal.buffer.consumeState, { stateHash: "statehash" })).toBeNull();
    await h.t.run((ctx) =>
      ctx.db.insert("bufferOAuthStates", {
        tenantId: h.tenantId,
        phase: "request",
        stateHash: "expired",
        connectionId: "x",
        expiresAt: 1,
        ...envelope,
      }),
    );
    expect(await h.t.mutation(internal.buffer.consumeState, { stateHash: "expired" })).toBeNull();
  });
  test("rejects unselected channels and stale approval; another tenant cannot approve or discard a draft", async () => {
    vi.useFakeTimers();
    const h = await setup();
    await connect(h);
    const draft = {
      campaign: "Launch",
      channelId,
      text: "Post awaiting review",
      mode: "addToQueue" as const,
    };
    await expect(
      h.asUser.mutation(api.buffer.stagePost, { ...draft, channelId: organizationId }),
    ).rejects.toThrow("BUFFER_CHANNEL_NOT_ALLOWED");
    const postId = await h.asUser.mutation(api.buffer.stagePost, draft);
    await expect(
      h.asOther.mutation(api.buffer.approvePost, { postId, revision: 1 }),
    ).rejects.toThrow("BUFFER_DRAFT_CHANGED");
    await expect(h.asOther.mutation(api.buffer.discardPost, { postId })).rejects.toThrow(
      "BUFFER_DRAFT_CHANGED",
    );
    await expect(
      h.asUser.mutation(api.buffer.approvePost, { postId, revision: 2 }),
    ).rejects.toThrow("BUFFER_DRAFT_CHANGED");
    expect(await h.asOther.query(api.buffer.posts, {})).toEqual([]);
    await h.asUser.mutation(api.buffer.approvePost, { postId, revision: 1 });
    const claimed = await h.t.mutation(internal.buffer.claimPost, { tenantId: h.tenantId, postId });
    expect(claimed?.text).toBe(draft.text);
    expect(
      await h.t.mutation(internal.buffer.claimPost, { tenantId: h.tenantId, postId }),
    ).toBeNull();
    await h.t.mutation(internal.buffer.finishPost, {
      tenantId: h.tenantId,
      postId,
      status: "unknown",
      failure: "check_buffer_before_retry",
    });
    await expect(
      h.asUser.mutation(api.buffer.approvePost, { postId, revision: 1 }),
    ).rejects.toThrow();
    vi.useRealTimers();
  });
  test("disconnect clears encrypted credentials, pending callbacks and background reporting", async () => {
    const h = await setup();
    await connect(h);
    await expect(
      h.asUser.mutation(api.buffer.selectChannels, {
        channelIds: [channelId],
        dailyReports: true,
      }),
    ).rejects.toThrow("BUFFER_REPORTS_UNAVAILABLE_FOR_APP_CLIENTS");
    // A pre-upgrade opt-in must still be cleared on disconnect.
    await h.t.run(async (ctx) => {
      const row = await ctx.db
        .query("bufferConnections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", h.tenantId))
        .unique();
      await ctx.db.patch(row!._id, { dailyReports: true });
    });
    await h.t.mutation(internal.buffer.storeState, {
      tenantId: h.tenantId,
      stateHash: "new-state",
      connectionId: "new-connection",
      ...envelope,
    });
    await h.asUser.mutation(api.buffer.disconnect, {});
    const row = await h.t.query(internal.buffer.connection, { tenantId: h.tenantId });
    expect(row?.ciphertextB64).toBeUndefined();
    expect(row?.ivB64).toBeUndefined();
    expect(row?.dailyReports).toBe(false);
    expect(row?.selectedChannelIds).toEqual([]);
    expect(await h.t.mutation(internal.buffer.consumeState, { stateHash: "new-state" })).toBeNull();
  });
  test("only one refresh wins and stale/disconnected refreshes cannot restore credentials", async () => {
    const h = await setup();
    await connect(h);
    const args = { tenantId: h.tenantId, connectionId: "connection1", revision: 1 };
    expect(await h.t.mutation(internal.buffer.claimRefresh, { ...args, lease: "first" })).toBe(
      true,
    );
    expect(await h.t.mutation(internal.buffer.claimRefresh, { ...args, lease: "second" })).toBe(
      false,
    );
    await h.asUser.mutation(api.buffer.disconnect, {});
    expect(
      await h.t.mutation(internal.buffer.finishRefresh, {
        ...args,
        lease: "first",
        expiresAt: Date.now() + 3600000,
        credential: envelope,
      }),
    ).toBe(false);
    expect((await h.asUser.query(api.buffer.status, {})).connected).toBe(false);
  });
  test("disconnect cancels an OAuth exchange already in flight", async () => {
    const h = await setup();
    await h.t.mutation(internal.buffer.storeState, {
      tenantId: h.tenantId,
      stateHash: "request",
      connectionId: "connection1",
      ...envelope,
    });
    await h.t.mutation(internal.buffer.consumeState, { stateHash: "request" });
    await h.asUser.mutation(api.buffer.disconnect, {});
    await expect(
      h.t.mutation(internal.buffer.storePendingGrant, {
        tenantId: h.tenantId,
        connectionId: "connection1",
        requestStateHash: "request",
        stateHash: await stateHash(receipt),
        tokenExpiresAt: Date.now() + 3600000,
        ...envelope,
      }),
    ).rejects.toThrow("BUFFER_INVALID_STATE");
    expect((await h.asUser.query(api.buffer.status, {})).connected).toBe(false);
  });
  test("reports are tenant-scoped and cannot save a response for an outdated selection", async () => {
    const h = await setup();
    await connect(h);
    const report = {
      tenantId: h.tenantId,
      connectionId: "connection1",
      organizationId,
      channelIds: [channelId],
      startAt: 1,
      endAt: 2,
      metricsUpdatedAt: null,
      metrics: [{ type: "comments", name: "Comments", value: 0, unit: "count" as const }],
    };
    await h.t.mutation(internal.buffer.saveReport, report);
    expect(await h.asOther.query(api.buffer.reports, {})).toEqual([]);
    expect((await h.asUser.query(api.buffer.reports, {}))[0]?.metrics[0]?.value).toBe(0);
    await h.asUser.mutation(api.buffer.selectChannels, { channelIds: [], dailyReports: false });
    await expect(h.t.mutation(internal.buffer.saveReport, report)).rejects.toThrow(
      "BUFFER_SELECTION_CHANGED",
    );
  });
  test("an expired approved schedule is failed before any provider submission", async () => {
    vi.useFakeTimers();
    const h = await setup();
    await connect(h);
    const postId = await h.asUser.mutation(api.buffer.stagePost, {
      campaign: "Launch",
      channelId,
      text: "Scheduled",
      mode: "customScheduled",
      dueAt: Date.now() + 120_000,
    });
    await h.asUser.mutation(api.buffer.approvePost, { postId, revision: 1 });
    vi.setSystemTime(Date.now() + 180_000);
    expect(
      await h.t.mutation(internal.buffer.claimPost, { tenantId: h.tenantId, postId }),
    ).toBeNull();
    expect((await h.asUser.query(api.buffer.posts, {}))[0]?.status).toBe("failed");
  });
  test("expired OAuth material is swept without deleting live requests", async () => {
    const h = await setup();
    await h.t.mutation(internal.buffer.storeState, {
      tenantId: h.tenantId,
      stateHash: "live",
      connectionId: "live",
      ...envelope,
    });
    await h.t.run((ctx) =>
      ctx.db.insert("bufferOAuthStates", {
        tenantId: h.tenantId,
        phase: "complete",
        stateHash: "expired",
        connectionId: "old",
        expiresAt: 1,
        ...envelope,
      }),
    );
    await h.t.mutation(internal.buffer.tickReports, {});
    expect(
      await h.t.run((ctx) =>
        ctx.db
          .query("bufferOAuthStates")
          .withIndex("by_tenant", (q) => q.eq("tenantId", h.tenantId))
          .collect(),
      ),
    ).toHaveLength(1);
    expect(await h.t.mutation(internal.buffer.consumeState, { stateHash: "live" })).not.toBeNull();
  });
  test("the erasure fence prevents scheduler reads and OAuth completion", async () => {
    const h = await setup();
    await connect(h);
    await h.t.run((ctx) =>
      ctx.db.insert("authRevocations", {
        userId: h.tenantId,
        state: "deleting",
        expiresAt: Number.MAX_SAFE_INTEGER,
      }),
    );
    await expect(h.t.query(internal.buffer.connection, { tenantId: h.tenantId })).rejects.toThrow();
    await expect(
      h.t.mutation(internal.buffer.storeState, {
        tenantId: h.tenantId,
        stateHash: "new-state",
        connectionId: "new",
        ...envelope,
      }),
    ).rejects.toThrow();
  });
  test("Buffer envelopes cannot be moved to a revenue provider or another tenant", async () => {
    const key = await importCredentialKey(btoa("0".repeat(32)), "v1");
    const scope = {
      tenantId: "t1",
      connectionId: "c1",
      provider: "buffer" as const,
      environment: "production" as const,
    };
    const sealed = await sealCredential(key, scope, "synthetic credential");
    expect(await openCredential(key, scope, sealed)).toBe("synthetic credential");
    await expect(openCredential(key, { ...scope, provider: "hubspot" }, sealed)).rejects.toThrow();
    await expect(openCredential(key, { ...scope, tenantId: "t2" }, sealed)).rejects.toThrow();
  });
});

test("the MCP transport handles the real multi-block response without exposing errors or following redirects", async () => {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      const request = JSON.parse(String(init.body));
      requests.push(request);
      if (request.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result:
            request.method === "initialize"
              ? {}
              : {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        metrics: [{ type: "comments", value: 0, unit: "count" }],
                      }),
                    },
                    { type: "text", text: "Quota: 98" },
                  ],
                },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  expect(
    (await callBufferTool("synthetic-token", "get_aggregated_post_metrics", { organizationId }))
      .metrics,
  ).toHaveLength(1);
  expect(requests.map((r) => r.method)).toEqual([
    "initialize",
    "notifications/initialized",
    "tools/call",
  ]);
  await expect(callBufferTool("synthetic-token", "delete_post", {})).rejects.toThrow(
    "BUFFER_REJECTED",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("private vendor detail", { status: 429 })),
  );
  await expect(bufferJson("https://auth.buffer.com/token", { method: "POST" })).rejects.toThrow(
    "BUFFER_RATE_LIMITED",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("uncertain upstream failure", { status: 503 })),
  );
  await expect(callBufferTool("synthetic-token", "create_post", {})).rejects.toThrow(
    "BUFFER_UNAVAILABLE",
  );
  vi.unstubAllGlobals();
});

test("the production grant uses only supported app-client scopes and background access", () => {
  expect(BUFFER_SCOPES).not.toContain("insights:read");
  expect(BUFFER_SCOPES).toContain("offline_access");
  expect(BUFFER_SCOPES).not.toContain("account:write");
});

test("registered-app OAuth connects, reads channels and rotates tokens without DCR or MCP resources", async () => {
  const h = await setup();
  vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_V1", btoa("0".repeat(32)));
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("SITE_URL", "https://app.example.com");
  vi.stubEnv("BUFFER_OAUTH_CLIENT_ID", "");
  const requests: { url: string; init: RequestInit }[] = [];
  const provider = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    expect(init.redirect).toBe("error");
    if (url === "https://auth.buffer.com/token") {
      const form = new URLSearchParams(String(init.body));
      expect(form.get("resource")).toBeNull();
      expect(form.get("client_id")).toBe("registered-public-client");
      if (form.get("grant_type") === "authorization_code") {
        expect(form.get("redirect_uri")).toBe("https://test.convex.site/buffer/callback");
        expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      } else {
        expect(form.get("refresh_token")).toBe("first-refresh");
      }
      return Response.json({
        access_token: "synthetic-access",
        refresh_token:
          form.get("grant_type") === "authorization_code" ? "first-refresh" : "rotated-refresh",
        scope: BUFFER_SCOPES.join(" "),
        expires_in: 3600,
      });
    }
    expect(url).toBe("https://api.buffer.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-access");
    const body = JSON.parse(String(init.body));
    if (body.query.includes("PikarOrganizations"))
      return Response.json({
        data: { account: { organizations: [{ id: organizationId, name: "Own organization" }] } },
      });
    if (body.query.includes("PikarCreatePost"))
      return Response.json({
        data: {
          createPost: {
            __typename: "PostActionSuccess",
            post: { id: channelId, status: "scheduled" },
          },
        },
      });
    expect(body.variables).toEqual({ org: organizationId });
    return Response.json({
      data: {
        channels: [
          {
            id: channelId,
            name: "Own channel",
            service: "linkedin",
            isLocked: false,
            isDisconnected: false,
          },
        ],
      },
    });
  });
  vi.stubGlobal("fetch", provider);
  expect((await h.asUser.query(api.buffer.status, {})).configured).toBe(false);
  await expect(h.asUser.action(api.bufferActions.startConnect, {})).rejects.toThrow(
    "BUFFER_NOT_CONFIGURED",
  );
  expect(provider).not.toHaveBeenCalled();
  vi.stubEnv("BUFFER_OAUTH_CLIENT_ID", "registered-public-client");
  const start = new URL((await h.asUser.action(api.bufferActions.startConnect, {})).url);
  expect(provider).not.toHaveBeenCalled();
  expect(start.origin).toBe("https://auth.buffer.com");
  expect(start.searchParams.get("resource")).toBeNull();
  expect(start.searchParams.get("scope")).toBe(BUFFER_SCOPES.join(" "));
  expect(start.searchParams.get("client_id")).toBe("registered-public-client");
  expect(start.searchParams.get("code_challenge_method")).toBe("S256");
  const callback = await h.t.action(internal.bufferActions.callback, {
    state: start.searchParams.get("state")!,
    code: "synthetic-code",
    denied: false,
  });
  await h.asUser.mutation(api.buffer.completeConnect, { receipt: callback.receipt! });
  expect(await h.asUser.query(api.buffer.status, {})).toMatchObject({
    connected: true,
    configured: true,
    reportsAvailable: false,
  });
  expect(await h.asUser.action(api.bufferActions.organizations, {})).toEqual([
    { id: organizationId, name: "Own organization" },
  ]);
  await h.asUser.action(api.bufferActions.loadChannels, { organizationId });
  await h.asUser.mutation(api.buffer.selectChannels, {
    channelIds: [channelId],
    dailyReports: false,
  });
  const beforeReport = requests.length;
  await expect(h.asUser.action(api.bufferActions.refreshReport, {})).rejects.toThrow(
    "BUFFER_REPORTS_UNAVAILABLE_FOR_APP_CLIENTS",
  );
  expect(requests).toHaveLength(beforeReport);
  await h.t.run(async (ctx) => {
    const row = await ctx.db
      .query("bufferConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", h.tenantId))
      .unique();
    await ctx.db.patch(row!._id, { expiresAt: 0 });
  });
  await h.asUser.action(api.bufferActions.organizations, {});
  const renewed = await h.t.query(internal.buffer.connection, { tenantId: h.tenantId });
  const key = await importCredentialKey(btoa("0".repeat(32)), "v1");
  const grant = JSON.parse(
    await openCredential(
      key,
      {
        tenantId: h.tenantId,
        connectionId: renewed!.connectionId,
        provider: "buffer",
        environment: "production",
      },
      {
        ciphertextB64: renewed!.ciphertextB64!,
        ivB64: renewed!.ivB64!,
        keyVersion: "v1",
        algorithm: "AES-256-GCM",
      },
    ),
  );
  expect(grant.refreshToken).toBe("rotated-refresh");
  vi.useFakeTimers();
  const postId = await h.asUser.mutation(api.buffer.stagePost, {
    campaign: "Test",
    channelId,
    text: "Explicitly approved test fixture",
    mode: "addToQueue",
  });
  await h.asUser.mutation(api.buffer.approvePost, { postId, revision: 1 });
  await h.t.finishAllScheduledFunctions(vi.runAllTimers);
  await h.t.action(internal.bufferActions.publishPost, { tenantId: h.tenantId, postId });
  expect((await h.asUser.query(api.buffer.posts, {}))[0]?.status).toBe("scheduled");
  expect(requests.filter((r) => String(r.init.body).includes("PikarCreatePost"))).toHaveLength(1);
});

test("GraphQL partial errors remain uncertain and never expose provider details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: { createPost: null },
        errors: [{ message: "private upstream details" }],
      }),
    ),
  );
  await expect(
    bufferGraphql("synthetic-token", "mutation Fixture{createPost{__typename}}"),
  ).rejects.toThrow("BUFFER_INVALID_RESPONSE");
});
