import { socialHash } from "@pikar/core/social";
import { importCredentialKey, sealCredential } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function setup(refreshToken: string | undefined = "synthetic-refresh") {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  const other = await t.run((ctx) => ctx.db.insert("users", {}));
  const tenantId = String(user);
  const key = btoa("k".repeat(32));
  vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_V1", key);
  const sealed = await sealCredential(
    await importCredentialKey(key, "v1"),
    { tenantId, provider: "youtube", connectionId: "original", environment: "production" },
    JSON.stringify({ accessToken: "synthetic-access", refreshToken, accountId: "channel" }),
  );
  const connection = await t.run((ctx) =>
    ctx.db.insert("socialConnections", {
      tenantId,
      provider: "youtube",
      connectionId: "original",
      accountIdHash: "hash",
      accountName: "Private channel",
      ciphertextB64: sealed.ciphertextB64,
      ivB64: sealed.ivB64,
      keyVersion: "v1",
      scopes: [],
      expiresAt: Date.now() + 3600000,
      revision: 1,
      updatedAt: Date.now(),
      status: "connected",
    }),
  );
  return {
    t,
    tenantId,
    connection,
    owner: t.withIdentity({ subject: user + "|session" }),
    other: t.withIdentity({ subject: other + "|session" }),
  };
}
const consent = { provider: "youtube" as const, acknowledgedGoogleProjectRevocation: true };

test("YouTube disconnect requires project-wide acknowledgement and the old public mutation cannot bypass it", async () => {
  const h = await setup();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    h.owner.action(api.socialActions.disconnect, { provider: "youtube" }),
  ).rejects.toThrow("SOCIAL_GOOGLE_PROJECT_REVOCATION_ACK_REQUIRED");
  await expect(h.owner.mutation(api.social.disconnect, { provider: "youtube" })).rejects.toThrow(
    "SOCIAL_USE_DISCONNECT_ACTION",
  );
  expect(await h.t.run((ctx) => ctx.db.get(h.connection))).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

test("local access is removed before immediate fixed-origin POST, preferring refresh token and returning no credentials", async () => {
  const h = await setup();
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe("https://oauth2.googleapis.com/revoke");
    expect(await h.t.run((ctx) => ctx.db.get(h.connection))).toBeNull();
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(String(init?.body)).toBe("token=synthetic-refresh");
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await h.owner.action(api.socialActions.disconnect, consent);
  expect(result).toMatchObject({ disconnectedHere: true, upstreamRevoked: true });
  expect(result.upstreamRevocation).toContain("including its other integrations");
  expect(JSON.stringify(result)).not.toMatch(/synthetic-|ciphertext|ivB64|Private channel/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("without a refresh token the access token is revoked", async () => {
  const h = await setup("");
  // An absent property, rather than an empty or malformed token, is the supported fallback.
  const row = await h.t.run((ctx) => ctx.db.get(h.connection));
  const key = btoa("k".repeat(32));
  const sealed = await sealCredential(
    await importCredentialKey(key, "v1"),
    {
      tenantId: h.tenantId,
      provider: "youtube",
      connectionId: "original",
      environment: "production",
    },
    JSON.stringify({ accessToken: "synthetic-access", accountId: "channel" }),
  );
  await h.t.run((ctx) =>
    ctx.db.patch(row!._id, {
      ciphertextB64: sealed.ciphertextB64,
      ivB64: sealed.ivB64,
      keyVersion: sealed.keyVersion,
    }),
  );
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(String(init?.body)).toBe("token=synthetic-access");
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  expect((await h.owner.action(api.socialActions.disconnect, consent)).upstreamRevoked).toBe(true);
});

test.each([
  "http",
  "transport",
  "redirect",
])("failed %s revocation stays unconfirmed, locally disabled and is never retried later", async (kind) => {
  const h = await setup();
  const fetcher = vi.fn(async () => {
    if (kind !== "http") throw new Error("synthetic-access secret provider text");
    return new Response("synthetic-refresh secret vendor body", { status: 400 });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await h.owner.action(api.socialActions.disconnect, consent);
  expect(result).toMatchObject({ disconnectedHere: true, upstreamRevoked: false });
  expect(result.upstreamRevocation).toContain("unconfirmed");
  expect(JSON.stringify(result)).not.toMatch(/synthetic-|vendor body|secret provider/);
  expect(await h.t.run((ctx) => ctx.db.get(h.connection))).toBeNull();
  expect((await h.owner.action(api.socialActions.disconnect, consent)).upstreamRevoked).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("foreign tenant disconnect cannot read or revoke another customer's grant", async () => {
  const h = await setup();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const result = await h.other.action(api.socialActions.disconnect, consent);
  expect(result.upstreamRevoked).toBe(false);
  expect(await h.t.run((ctx) => ctx.db.get(h.connection))).not.toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(h.t.action(api.socialActions.disconnect, consent)).rejects.toThrow(
    "UNAUTHENTICATED",
  );
});

test("an old disconnect continuation never removes a new connection created while Google responds", async () => {
  vi.useFakeTimers();
  const h = await setup();
  let reconnected: typeof h.connection | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      reconnected = await h.t.run((ctx) =>
        ctx.db.insert("socialConnections", {
          tenantId: h.tenantId,
          provider: "youtube",
          connectionId: "new",
          accountIdHash: "newhash",
          accountName: "New name",
          keyVersion: "v1",
          scopes: [],
          expiresAt: Date.now() + 3600000,
          revision: 1,
          updatedAt: Date.now(),
          status: "connected",
        }),
      );
      return new Response(null, { status: 200 });
    }),
  );
  await h.owner.action(api.socialActions.disconnect, consent);
  await h.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await h.t.run((ctx) => ctx.db.get(reconnected!)))?.connectionId).toBe("new");
});

test.each([
  [undefined, undefined],
  ["true", undefined],
  [undefined, "true"],
  ["false", "true"],
])("YouTube new consent fails closed unless both connection and cleanup gates are true (%s/%s)", async (connect, cleanup) => {
  const h = await setup();
  vi.stubEnv("SOCIAL_YOUTUBE_CONNECT_ENABLED", connect);
  vi.stubEnv("SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED", cleanup);
  vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "synthetic-client");
  vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "synthetic-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://test.convex.site");
  vi.stubEnv("SITE_URL", "https://test.example");
  const status = (await h.owner.query(api.social.status, {})).find(
    (row) => row.provider === "youtube",
  );
  expect(status?.configured).toBe(false);
  expect(status?.connected).toBe(true);
  await expect(
    h.owner.action(api.socialActions.startConnect, { provider: "youtube" }),
  ).rejects.toThrow("SOCIAL_NOT_CONFIGURED");
  expect(await h.t.run((ctx) => ctx.db.query("socialOAuthStates").collect())).toHaveLength(0);
});

test("erasure revocation remains available after the tenant write fence starts", async () => {
  const h = await setup();
  await h.t.run((ctx) =>
    ctx.db.insert("authRevocations", {
      userId: h.tenantId,
      state: "deleting",
      expiresAt: Number.MAX_SAFE_INTEGER,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  const result = await h.t.action(internal.socialActions.disconnectForTenant, {
    tenantId: h.tenantId,
    provider: "youtube",
  });
  expect(result.upstreamRevoked).toBe(true);
  expect(await h.t.run((ctx) => ctx.db.get(h.connection))).toBeNull();
});

test("disabling YouTube readiness consumes pending callback state before any token exchange", async () => {
  const h = await setup();
  const state = "s".repeat(43);
  await h.t.mutation(internal.social.storeState, {
    tenantId: h.tenantId,
    provider: "youtube",
    connectionId: "pending",
    stateHash: await socialHash("youtube:state:" + state),
    ciphertextB64: "synthetic-sealed",
    ivB64: "synthetic-iv",
    keyVersion: "v1",
  });
  vi.stubEnv("SOCIAL_YOUTUBE_CONNECT_ENABLED", "false");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    h.t.action(internal.socialActions.callback, {
      provider: "youtube",
      state,
      code: "synthetic-code",
      denied: false,
    }),
  ).rejects.toThrow("SOCIAL_INVALID_STATE");
  expect(await h.t.run((ctx) => ctx.db.query("socialOAuthStates").collect())).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  "exchange",
  "activation",
])("disabling YouTube readiness discards a late %s grant without replacing the old connection", async (phase) => {
  const h = await setup();
  vi.stubEnv("SOCIAL_YOUTUBE_CONNECT_ENABLED", "true");
  vi.stubEnv("SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED", "true");
  const receipt = "r".repeat(43);
  await h.t.mutation(internal.social.storeState, {
    tenantId: h.tenantId,
    provider: "youtube",
    connectionId: "pending",
    stateHash: "request",
    ciphertextB64: "synthetic-sealed",
    ivB64: "synthetic-iv",
    keyVersion: "v1",
  });
  await h.t.mutation(internal.social.consumeState, { provider: "youtube", stateHash: "request" });
  if (phase === "exchange") vi.stubEnv("SOCIAL_YOUTUBE_CONNECT_ENABLED", "false");
  const saved = await h.t.mutation(internal.social.storePendingGrant, {
    tenantId: h.tenantId,
    provider: "youtube",
    connectionId: "pending",
    requestHash: "request",
    stateHash: await socialHash("youtube:receipt:" + receipt),
    tokenExpiresAt: Date.now() + 3600000,
    accountIdHash: "newhash",
    accountName: "Pending name",
    scopes: [],
    ciphertextB64: "synthetic-sealed",
    ivB64: "synthetic-iv",
    keyVersion: "v1",
  });
  if (phase === "exchange") expect(saved).toBe(false);
  else {
    expect(saved).toBe(true);
    vi.stubEnv("SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED", "false");
    expect(
      await h.owner.mutation(api.social.completeConnect, { provider: "youtube", receipt }),
    ).toEqual({ connected: false, reason: "SOCIAL_NOT_CONFIGURED" });
  }
  expect(await h.t.run((ctx) => ctx.db.query("socialOAuthStates").collect())).toHaveLength(0);
  expect((await h.t.run((ctx) => ctx.db.get(h.connection)))?.connectionId).toBe("original");
});
