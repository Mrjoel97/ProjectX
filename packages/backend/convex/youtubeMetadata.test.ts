import { socialHash } from "@pikar/core/social";
import { exportableTables } from "@pikar/core/tenantData";
import { importCredentialKey, sealCredential } from "@pikar/revenue";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { youtubeConnectionMetadataBound, youtubeMetadataFresh } from "./social";

const modules = import.meta.glob("./**/*.*s");
const DAY = 24 * 60 * 60 * 1000;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function setup() {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  const other = await t.run((ctx) => ctx.db.insert("users", {}));
  const tenantId = String(user);
  const key = btoa("k".repeat(32));
  vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_V1", key);
  const sealed = await sealCredential(
    await importCredentialKey(key, "v1"),
    { tenantId, provider: "youtube", connectionId: "old", environment: "production" },
    JSON.stringify({
      accessToken: "synthetic-token",
      accountId: "channel1",
      scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    }),
  );
  const connection = await t.run(async (ctx) =>
    ctx.db.insert("socialConnections", {
      tenantId,
      provider: "youtube",
      connectionId: "old",
      accountIdHash: await socialHash("youtube:account:channel1"),
      accountName: "Old name",
      ciphertextB64: sealed.ciphertextB64,
      ivB64: sealed.ivB64,
      keyVersion: "v1",
      scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
      expiresAt: Date.now() + 3600000,
      revision: 1,
      updatedAt: Date.now(),
      status: "connected",
      assets: [{ id: "channel1", name: "Old name", kind: "youtube" }],
      selectedAssetIds: ["channel1"],
      providerMetadataCheckedAt: Date.now(),
      providerConsentCheckedAt: Date.now(),
    }),
  );
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob(["original customer media"], { type: "video/mp4" })),
  );
  const makePost = () =>
    t.run((ctx) =>
      ctx.db.insert("socialPosts", {
        tenantId,
        provider: "youtube",
        connectionId: "old",
        assetId: "channel1",
        assetName: "Old name",
        storageId,
        kind: "youtube",
        selectionRevision: 0,
        text: "Original customer caption",
        title: "Original customer title",
        privacy: "private",
        madeForKids: false,
        aiGenerated: false,
        status: "sent",
        revision: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        providerPostId: "provider-video",
        providerMetadataCheckedAt: Date.now(),
      }),
    );
  return {
    t,
    tenantId,
    otherId: String(other),
    connection,
    makePost,
    owner: t.withIdentity({ subject: `${user}|session` }),
  };
}

test("legacy creation time is a conservative bound, never a fabricated refresh", async () => {
  const initial = Date.now() - DAY;
  const row = { _creationTime: initial };
  expect(youtubeConnectionMetadataBound(row)).toBe(initial - 10 * 60 * 1000);
  expect(youtubeMetadataFresh(youtubeConnectionMetadataBound(row))).toBe(true);
  expect(youtubeMetadataFresh(undefined)).toBe(false);
  expect(youtubeMetadataFresh(Date.now() - 30 * DAY)).toBe(false);
  expect(youtubeMetadataFresh(Date.now() + DAY)).toBe(false);
});

test("stale projections hide API identifiers while preserving customer content before cleanup", async () => {
  const h = await setup(),
    postId = await h.makePost();
  await h.t.run(async (ctx) => {
    await ctx.db.patch(h.connection, { providerMetadataCheckedAt: Date.now() - 31 * DAY });
    await ctx.db.patch(postId, { providerMetadataCheckedAt: Date.now() - 31 * DAY });
  });
  const status = (await h.owner.query(api.social.status, {})).find((r) => r.provider === "youtube");
  expect(status?.accountName).toBeNull();
  expect(status?.assets).toEqual([]);
  const [post] = await h.owner.query(api.socialPublishing.posts, {});
  expect(post?.assetName).toBe("");
  expect(post?.providerPostId).toBeUndefined();
  expect(post?.text).toBe("Original customer caption");
  expect(post?.title).toBe("Original customer title");
  // Projection is not an undeclared live deletion.
  expect((await h.t.run((ctx) => ctx.db.get(postId)))?.providerPostId).toBe("provider-video");
});

test("cached asset saves do not extend metadata age; actual channel verification does", async () => {
  const h = await setup(),
    checkedAt = Date.now() - DAY;
  await h.t.run((ctx) => ctx.db.patch(h.connection, { providerMetadataCheckedAt: checkedAt }));
  await h.t.mutation(internal.socialPublishing.saveAssets, {
    tenantId: h.tenantId,
    provider: "youtube",
    connectionId: "old",
    assets: [{ id: "channel1", name: "Old name", kind: "youtube" }],
  });
  expect((await h.t.run((ctx) => ctx.db.get(h.connection)))?.assetsCheckedAt).toBe(checkedAt);
  const fetch = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50",
    );
    return new Response(
      JSON.stringify({ items: [{ id: "channel1", snippet: { title: "New name" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetch);
  await h.owner.action(api.socialActions.verifyConnection, { provider: "youtube" });
  const row = await h.t.run((ctx) => ctx.db.get(h.connection));
  expect(row?.accountName).toBe("New name");
  expect(row?.assets?.[0]?.name).toBe("New name");
  expect(row?.providerMetadataCheckedAt).toBeGreaterThan(checkedAt);
  expect(row?.providerConsentCheckedAt).toBe(row?.providerMetadataCheckedAt);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("an old verification cannot resurrect metadata after disconnect or token revision change", async () => {
  const h = await setup();
  const args = {
    tenantId: h.tenantId,
    connectionId: "old",
    revision: 1,
    accountId: "channel1",
    accountName: "Never restored",
  };
  await h.t.run((ctx) => ctx.db.patch(h.connection, { revision: 2 }));
  await expect(h.t.mutation(internal.social.recordYouTubeMetadata, args)).rejects.toThrow(
    "SOCIAL_RECONNECT",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  await h.owner.action(api.socialActions.disconnect, {
    provider: "youtube",
    acknowledgedGoogleProjectRevocation: true,
  });
  await expect(
    h.t.mutation(internal.social.recordYouTubeMetadata, { ...args, revision: 2 }),
  ).rejects.toThrow("SOCIAL_RECONNECT");
});

test("disconnect immediately hides old receipts and its continuation cannot scrub a reconnect", async () => {
  vi.useFakeTimers();
  const h = await setup(),
    oldPost = await h.makePost();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  await h.owner.action(api.socialActions.disconnect, {
    provider: "youtube",
    acknowledgedGoogleProjectRevocation: true,
  });
  expect((await h.owner.query(api.socialPublishing.posts, {}))[0]?.providerPostId).toBeUndefined();
  const newPost = await h.t.run(async (ctx) => {
    await ctx.db.insert("socialConnections", {
      tenantId: h.tenantId,
      provider: "youtube",
      connectionId: "new",
      accountIdHash: "different",
      accountName: "Fresh name",
      keyVersion: "v1",
      scopes: [],
      expiresAt: Date.now() + DAY,
      revision: 1,
      updatedAt: Date.now(),
      status: "connected",
      providerMetadataCheckedAt: Date.now(),
      providerConsentCheckedAt: Date.now(),
    });
    const original = await ctx.db.get(oldPost);
    const { _id, _creationTime, ...copy } = original!;
    return ctx.db.insert("socialPosts", {
      ...copy,
      connectionId: "new",
      providerPostId: "fresh-video",
    });
  });
  await h.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await h.t.run((ctx) => ctx.db.get(oldPost)))?.providerPostId).toBeUndefined();
  expect((await h.t.run((ctx) => ctx.db.get(newPost)))?.providerPostId).toBe("fresh-video");
  expect((await h.t.run((ctx) => ctx.db.get(oldPost)))?.text).toBe("Original customer caption");
});

test("dry run is read-only and gated cleanup continues beyond one page without touching another tenant", async () => {
  vi.useFakeTimers();
  const h = await setup();
  await h.t.run((ctx) =>
    ctx.db.patch(h.connection, {
      providerMetadataCheckedAt: Date.now() - 29 * DAY - 1,
      providerConsentCheckedAt: Date.now() - 29 * DAY - 1,
    }),
  );
  const posts = [];
  for (let i = 0; i < 55; i++) posts.push(await h.makePost());
  const foreign = await h.t.run((ctx) =>
    ctx.db.insert("socialPosts", {
      tenantId: h.otherId,
      provider: "meta",
      connectionId: "unrelated",
      assetId: "other-page",
      assetName: "Other customer",
      kind: "facebook_page",
      selectionRevision: 0,
      text: "Other customer content",
      status: "sent",
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      providerPostId: "other-receipt",
    }),
  );
  const impact = await h.t.query(internal.social.youtubeMetadataCleanupImpact, {});
  expect(impact).toMatchObject({ phase: "connections", inspected: 1, stale: 1 });
  expect(await h.t.run((ctx) => ctx.db.get(h.connection))).not.toBeNull();
  await h.t.mutation(internal.social.cleanupYouTubeMetadata, {});
  expect(await h.t.run((ctx) => ctx.db.get(h.connection))).not.toBeNull();
  vi.stubEnv("SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED", "true");
  await h.t.mutation(internal.social.cleanupYouTubeMetadata, {});
  await h.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await h.t.run((ctx) => ctx.db.get(h.connection))).toBeNull();
  for (const id of posts) {
    const post = await h.t.run((ctx) => ctx.db.get(id));
    expect(post?.providerPostId).toBeUndefined();
    expect(post?.text).toBe("Original customer caption");
  }
  expect((await h.t.run((ctx) => ctx.db.get(foreign)))?.providerPostId).toBe("other-receipt");
});

test("failed refresh scrubs old connection metadata without deleting the customer post", async () => {
  vi.useFakeTimers();
  const h = await setup(),
    post = await h.makePost();
  await h.t.mutation(internal.social.claimRefresh, {
    tenantId: h.tenantId,
    provider: "youtube",
    connectionId: "old",
    revision: 1,
    lease: "synthetic-lease",
  });
  await h.t.mutation(internal.social.finishRefresh, {
    tenantId: h.tenantId,
    provider: "youtube",
    connectionId: "old",
    revision: 1,
    lease: "synthetic-lease",
    keyVersion: "v1",
  });
  await h.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await h.t.run((ctx) => ctx.db.get(h.connection))).toBeNull();
  const saved = await h.t.run((ctx) => ctx.db.get(post));
  expect(saved?.providerPostId).toBeUndefined();
  expect(saved?.text).toBe("Original customer caption");
  expect(saved?.title).toBe("Original customer title");
  const storageId = saved?.storageId;
  if (!storageId) throw new Error("Original customer media was removed");
  expect(await h.t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(true);
});

test("exports enforce connection freshness independently of a fresh receipt and preserve authored data", async () => {
  const h = await setup();
  await h.makePost();
  await h.t.run((ctx) =>
    ctx.db.patch(h.connection, {
      providerMetadataCheckedAt: Date.now() - 31 * DAY,
    }),
  );
  const cursor = {
    tableIndex: exportableTables().indexOf("socialPosts"),
    cursor: null,
    rowsExported: 0,
    tableRows: 0,
    truncated: false,
    generatedAt: new Date().toISOString(),
  };
  const posts = await h.owner.query(api.tenantExport.exportTenantData, { cursor });
  expect(posts.table.name).toBe("socialPosts");
  expect(posts.table.rows[0]).toMatchObject({
    assetId: "",
    assetName: "",
    text: "Original customer caption",
    title: "Original customer title",
  });
  expect(JSON.stringify(posts.table.rows)).not.toContain("provider-video");
  expect(JSON.stringify(posts.table.rows)).not.toContain("Old name");
  const connections = await h.owner.query(api.tenantExport.exportTenantData, {
    cursor: { ...cursor, tableIndex: exportableTables().indexOf("socialConnections") },
  });
  expect(connections.table.rows[0]).toMatchObject({
    accountName: null,
    assets: [],
    selectedAssetIds: [],
  });
});

test("legacy matching connection bounds preserve recent receipts without stamping a new checkedAt", async () => {
  const h = await setup(),
    post = await h.makePost();
  await h.t.run(async (ctx) => {
    await ctx.db.patch(h.connection, {
      providerMetadataCheckedAt: undefined,
      providerConsentCheckedAt: undefined,
    });
    await ctx.db.patch(post, { providerMetadataCheckedAt: undefined });
  });
  const [visible] = await h.owner.query(api.socialPublishing.posts, {});
  expect(visible?.providerPostId).toBe("provider-video");
  expect((await h.t.query(internal.social.youtubeMetadataCleanupImpact, {})).stale).toBe(0);
  expect(
    (await h.t.run((ctx) => ctx.db.get(h.connection)))?.providerMetadataCheckedAt,
  ).toBeUndefined();
});
