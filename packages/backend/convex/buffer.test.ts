import { BUFFER_SCOPES } from "@pikar/core/buffer";
import { importCredentialKey, openCredential, sealCredential } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { bufferJson, callBufferTool } from "./lib/bufferMcp";
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
    await h.asUser.mutation(api.buffer.selectChannels, {
      channelIds: [channelId],
      dailyReports: true,
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

test("the requested production grant includes insights and background access", () => {
  expect(BUFFER_SCOPES).toContain("insights:read");
  expect(BUFFER_SCOPES).toContain("offline_access");
  expect(BUFFER_SCOPES).not.toContain("account:write");
});
