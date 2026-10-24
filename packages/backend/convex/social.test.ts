import { SOCIAL_PROVIDERS, SOCIAL_SCOPES, socialHash } from "@pikar/core/social";
import { socialHmac } from "@pikar/core/socialWebhook";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const envelope = {
  ciphertextB64: "synthetic-ciphertext",
  ivB64: "synthetic-iv",
  keyVersion: "v1" as const,
};
const receipt = "a".repeat(43);
async function setup() {
  vi.stubEnv("SOCIAL_YOUTUBE_CONNECT_ENABLED", "true");
  vi.stubEnv("SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED", "true");
  const t = convexTest(schema, modules);
  const owner = await t.run((ctx) => ctx.db.insert("users", {})),
    other = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantId: String(owner),
    asOwner: t.withIdentity({ subject: owner + "|session" }),
    asOther: t.withIdentity({ subject: other + "|session" }),
  };
}
async function pending(
  h: Awaited<ReturnType<typeof setup>>,
  provider: (typeof SOCIAL_PROVIDERS)[number] = "x",
) {
  await h.t.mutation(internal.social.storeState, {
    tenantId: h.tenantId,
    provider,
    connectionId: "own-connection",
    stateHash: "request",
    ...envelope,
  });
  await h.t.mutation(internal.social.consumeState, { provider, stateHash: "request" });
  await h.t.mutation(internal.social.storePendingGrant, {
    tenantId: h.tenantId,
    provider,
    connectionId: "own-connection",
    requestHash: "request",
    stateHash: await socialHash(provider + ":receipt:" + receipt),
    tokenExpiresAt: Date.now() + 3600000,
    accountIdHash: "account-hash",
    accountName: "Own account",
    scopes: ["read"],
    ...envelope,
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("native social tenant isolation", () => {
  test.each(
    SOCIAL_PROVIDERS,
  )("%s receipt activates only the initiating tenant once", async (provider) => {
    const h = await setup();
    await pending(h, provider);
    await expect(
      h.asOther.mutation(api.social.completeConnect, { provider, receipt }),
    ).rejects.toThrow("SOCIAL_INVALID_STATE");
    await h.asOwner.mutation(api.social.completeConnect, { provider, receipt });
    await expect(
      h.asOwner.mutation(api.social.completeConnect, { provider, receipt }),
    ).rejects.toThrow("SOCIAL_INVALID_STATE");
    const rows = await h.asOwner.query(api.social.status, {});
    expect(rows.find((row) => row.provider === provider)?.connected).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/ciphertext|ivB64|account-hash/);
    expect((await h.asOther.query(api.social.status, {})).every((row) => !row.connected)).toBe(
      true,
    );
    await expect(h.t.query(api.social.status, {})).rejects.toThrow("UNAUTHENTICATED");
  });
  test("wrong provider and replay cannot consume OAuth state", async () => {
    const h = await setup();
    await h.t.mutation(internal.social.storeState, {
      tenantId: h.tenantId,
      provider: "x",
      connectionId: "connection",
      stateHash: "request",
      ...envelope,
    });
    expect(
      await h.t.mutation(internal.social.consumeState, { provider: "meta", stateHash: "request" }),
    ).toBeNull();
    expect(
      await h.t.mutation(internal.social.consumeState, { provider: "x", stateHash: "request" }),
    ).not.toBeNull();
    expect(
      await h.t.mutation(internal.social.consumeState, { provider: "x", stateHash: "request" }),
    ).toBeNull();
    await h.asOwner.mutation(api.social.disconnect, { provider: "x" });
    await expect(
      h.t.mutation(internal.social.storePendingGrant, {
        tenantId: h.tenantId,
        provider: "x",
        connectionId: "connection",
        requestHash: "request",
        stateHash: "receipt",
        tokenExpiresAt: Date.now() + 100000,
        accountIdHash: "account",
        accountName: "Name",
        scopes: [],
        ...envelope,
      }),
    ).rejects.toThrow("SOCIAL_INVALID_STATE");
  });
  test("disconnect defeats pending receipts and late refresh; refresh can only be claimed once", async () => {
    const h = await setup();
    await pending(h);
    await h.asOwner.mutation(api.social.completeConnect, { provider: "x", receipt });
    const claim = {
      tenantId: h.tenantId,
      provider: "x" as const,
      connectionId: "own-connection",
      revision: 1,
      lease: "lease",
    };
    expect(await h.t.mutation(internal.social.claimRefresh, claim)).toBe(true);
    expect(await h.t.mutation(internal.social.claimRefresh, { ...claim, lease: "other" })).toBe(
      false,
    );
    await h.asOwner.mutation(api.social.disconnect, { provider: "x" });
    expect(
      await h.t.mutation(internal.social.finishRefresh, {
        ...claim,
        expiresAt: Date.now() + 3600000,
        ...envelope,
      }),
    ).toBe(false);
    await pending(h);
    await h.asOwner.mutation(api.social.disconnect, { provider: "x" });
    await expect(
      h.asOwner.mutation(api.social.completeConnect, { provider: "x", receipt }),
    ).rejects.toThrow("SOCIAL_INVALID_STATE");
  });
  test("erasure prevents late state writes and provider access", async () => {
    const h = await setup();
    await h.t.run((ctx) =>
      ctx.db.insert("authRevocations", {
        userId: h.tenantId,
        state: "deleting",
        expiresAt: Date.now() + 100000,
      }),
    );
    await expect(
      h.t.mutation(internal.social.storeState, {
        tenantId: h.tenantId,
        provider: "x",
        connectionId: "connection",
        stateHash: "request",
        ...envelope,
      }),
    ).rejects.toThrow();
    await expect(
      h.t.query(internal.social.connection, { tenantId: h.tenantId, provider: "x" }),
    ).rejects.toThrow();
  });
  test("callback redirects expose only opaque receipts and reject duplicate state", async () => {
    const h = await setup();
    vi.stubEnv("SITE_URL", "https://pikar.example");
    const response = await h.t.fetch("/social/x/callback?state=a&state=b&code=synthetic-code");
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "https://pikar.example/connect-social?provider=x&result=failed",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  test("webhooks reject forged requests; verified receipt contains no event content", async () => {
    const h = await setup();
    vi.stubEnv("X_OAUTH_CLIENT_SECRET", "synthetic-secret");
    const body = JSON.stringify({ privateContent: "must-not-persist" });
    const rejected = await h.t.fetch("/social/x/webhook", {
      method: "POST",
      body,
      headers: { "x-twitter-webhooks-signature-oauth2": "wrong" },
    });
    expect(rejected.status).toBe(401);
    const response = await h.t.fetch("/social/x/webhook", {
      method: "POST",
      body,
      headers: {
        "x-twitter-webhooks-signature-oauth2":
          "sha256=" + (await socialHmac("synthetic-secret", body, "SHA-256", true)),
      },
    });
    expect(response.status).toBe(200);
    const receipts = await h.t.run((ctx) => ctx.db.query("socialWebhookReceipts").collect());
    expect(receipts).toHaveLength(1);
    expect(JSON.stringify(receipts)).not.toContain("must-not-persist");
  });
});

describe("direct OAuth and token refresh orchestration", () => {
  test.each(
    SOCIAL_PROVIDERS,
  )("%s roundtrip verifies identity and stores only encrypted tokens", async (provider) => {
    const h = await setup();
    const prefix = provider === "youtube" ? "YOUTUBE" : provider.toUpperCase();
    vi.stubEnv("SOCIAL_YOUTUBE_CONNECT_ENABLED", "true");
    vi.stubEnv("SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED", "true");
    vi.stubEnv(prefix + "_OAUTH_CLIENT_ID", "synthetic-app");
    vi.stubEnv(prefix + "_OAUTH_CLIENT_SECRET", "synthetic-secret");
    vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_V1", btoa("k".repeat(32)));
    vi.stubEnv("CONVEX_SITE_URL", "https://synthetic.convex.site");
    vi.stubEnv("SITE_URL", "https://pikar.example");
    vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://pubsubhubbub.appspot.com/subscribe")
        return new Response(null, { status: 202 });
      if (url.includes("/token") || url.includes("/oauth/access_token"))
        return Response.json({
          access_token: "synthetic-access-token",
          refresh_token: "synthetic-refresh-token",
          expires_in: 3600,
          scope: SOCIAL_SCOPES[provider].join(provider === "tiktok" ? "," : " "),
        });
      if (url.endsWith("/me/permissions"))
        return Response.json({
          data: SOCIAL_SCOPES.meta.map((permission) => ({ permission, status: "granted" })),
        });
      if (url.includes("/channels?"))
        return Response.json({ items: [{ id: "channel-1", snippet: { title: "Own channel" } }] });
      if (url.includes("/user/info/"))
        return Response.json({
          data: { user: { open_id: "own-tiktok", display_name: "Own TikTok" } },
        });
      if (url.endsWith("/2/users/me"))
        return Response.json({ data: { id: "own-x", username: "own_x" } });
      if (url.endsWith("/me?fields=id,name"))
        return Response.json({ id: "own-meta", name: "Own Meta" });
      throw new Error("Unexpected provider endpoint");
    });
    vi.stubGlobal("fetch", fetcher);
    const started = await h.asOwner.action(api.socialActions.startConnect, { provider });
    const state = new URL(started.url).searchParams.get("state")!;
    const callback = await h.t.action(internal.socialActions.callback, {
      provider,
      state,
      code: "synthetic-code",
      denied: false,
    });
    expect(callback.receipt).toBeTruthy();
    await expect(
      h.t.action(internal.socialActions.callback, {
        provider,
        state,
        code: "synthetic-code",
        denied: false,
      }),
    ).rejects.toThrow("SOCIAL_INVALID_STATE");
    await h.asOwner.mutation(api.social.completeConnect, { provider, receipt: callback.receipt! });
    const saved = await h.t.query(internal.social.connection, { tenantId: h.tenantId, provider });
    expect(JSON.stringify(saved)).not.toMatch(/synthetic-access-token|synthetic-refresh-token/);
    expect(
      (await h.asOwner.action(api.socialActions.verifyConnection, { provider })).verified,
    ).toBe(true);
    if (provider !== "meta") {
      await h.t.run((ctx) => ctx.db.patch(saved!._id, { expiresAt: Date.now() - 1000 }));
      expect(
        (await h.asOwner.action(api.socialActions.verifyConnection, { provider })).verified,
      ).toBe(true);
      const refreshed = await h.t.query(internal.social.connection, {
        tenantId: h.tenantId,
        provider,
      });
      expect(refreshed!.revision).toBe(2);
    }
    if (provider === "youtube") {
      vi.stubEnv("YOUTUBE_WEBHOOK_SECRET", "s".repeat(32));
      expect(await h.asOwner.action(api.socialActions.subscribeYouTube, {})).toEqual({
        requested: true,
      });
    }
    await h.asOwner.action(api.socialActions.disconnect, {
      provider,
      ...(provider === "youtube" ? { acknowledgedGoogleProjectRevocation: true } : {}),
    });
    await expect(
      h.asOwner.action(api.socialActions.verifyConnection, { provider }),
    ).rejects.toThrow("SOCIAL_RECONNECT");
  });
});

test("provider challenge endpoints require the expected verification material", async () => {
  const h = await setup();
  vi.stubEnv("X_OAUTH_CLIENT_SECRET", "synthetic-secret");
  const x = await h.t.fetch("/social/x/webhook?crc_token=synthetic-challenge");
  expect(await x.json()).toEqual({
    response_token:
      "sha256=" + (await socialHmac("synthetic-secret", "synthetic-challenge", "SHA-256", true)),
  });
  vi.stubEnv("META_OAUTH_CLIENT_SECRET", "synthetic-meta-secret");
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "synthetic-verifier");
  const meta = await h.t.fetch(
    "/social/meta/webhook?hub.mode=subscribe&hub.challenge=challenge&hub.verify_token=synthetic-verifier",
  );
  expect(await meta.text()).toBe("challenge");
  const wrong = await h.t.fetch(
    "/social/meta/webhook?hub.mode=subscribe&hub.challenge=challenge&hub.verify_token=wrong",
  );
  expect(wrong.status).toBe(400);
  vi.stubEnv("YOUTUBE_WEBHOOK_SECRET", "s".repeat(32));
  const topic = "https://www.youtube.com/xml/feeds/videos.xml?channel_id=channel-1";
  const params = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.challenge": "yt-challenge",
    "hub.topic": topic,
    "hub.verify_token": await socialHmac("s".repeat(32), topic),
  });
  const youtube = await h.t.fetch("/social/youtube/webhook?" + params);
  expect(await youtube.text()).toBe("yt-challenge");
  params.set("hub.topic", "https://attacker.example/feed");
  expect((await h.t.fetch("/social/youtube/webhook?" + params)).status).toBe(400);
});
