import { SOCIAL_SCOPES } from "@pikar/core/social";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const OWNED = "https://www.pikar-ai.com/social/youtube/callback";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function setup() {
  const t = convexTest(schema, modules);
  const user = await t.run((ctx) => ctx.db.insert("users", {}));
  vi.stubEnv("SOCIAL_YOUTUBE_CONNECT_ENABLED", "true");
  vi.stubEnv("SOCIAL_YOUTUBE_METADATA_CLEANUP_ENABLED", "true");
  vi.stubEnv("YOUTUBE_OAUTH_CLIENT_ID", "synthetic-client");
  vi.stubEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "synthetic-client-secret");
  vi.stubEnv("CONNECTOR_CREDENTIAL_KEY_V1", btoa("k".repeat(32)));
  vi.stubEnv("CONVEX_SITE_URL", "https://synthetic.convex.site");
  vi.stubEnv("SITE_URL", "https://www.pikar-ai.com");
  vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", undefined);
  vi.stubEnv("TIKTOK_OAUTH_REDIRECT_URI", undefined);
  vi.stubEnv("TIKTOK_OAUTH_CLIENT_ID", "synthetic-tiktok");
  vi.stubEnv("TIKTOK_OAUTH_CLIENT_SECRET", "synthetic-tiktok-secret");
  return { t, owner: t.withIdentity({ subject: user + "|session" }) };
}
test.each([
  undefined,
  OWNED,
])("authorization and code exchange use the same validated redirect URI (%s)", async (override) => {
  const h = await setup();
  vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", override);
  const expected = override ?? "https://synthetic.convex.site/social/youtube/callback";
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("redirect_uri")).toBe(expected);
      expect(body.get("code")).toBe("synthetic-code");
      expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      return Response.json({
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        expires_in: 3600,
        scope: SOCIAL_SCOPES.youtube.join(" "),
      });
    }
    if (url.startsWith("https://www.googleapis.com/youtube/v3/channels?"))
      return Response.json({
        items: [{ id: "synthetic-channel", snippet: { title: "Synthetic channel" } }],
      });
    throw new Error("Unexpected endpoint");
  });
  vi.stubGlobal("fetch", fetcher);
  const auth = new URL(
    (await h.owner.action(api.socialActions.startConnect, { provider: "youtube" })).url,
  );
  expect(auth.searchParams.get("redirect_uri")).toBe(expected);
  const state = auth.searchParams.get("state");
  if (!state) throw new Error("OAuth state missing");
  const result = await h.t.action(internal.socialActions.callback, {
    provider: "youtube",
    state,
    code: "synthetic-code",
    denied: false,
  });
  expect(result.receipt).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toMatch(/synthetic-access|synthetic-refresh|synthetic-code/);
});

test.each([
  "",
  "http://www.pikar-ai.com/social/youtube/callback",
  "https://evil.example/social/youtube/callback",
  "https://pikar-ai.com/social/youtube/callback",
  OWNED + "/",
  OWNED + "?extra=x",
  OWNED + "#fragment",
  "https://user@www.pikar-ai.com/social/youtube/callback",
  "https://www.pikar-ai.com:443/social/youtube/callback",
  "https://www.pikar-ai.com/social/meta/callback",
  "https://www.pikar-ai.com/social/%79outube/callback",
])("refuses a noncanonical, empty or foreign explicit YouTube redirect before saving OAuth state: %s", async (override) => {
  const h = await setup();
  vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", override);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    h.owner.action(api.socialActions.startConnect, { provider: "youtube" }),
  ).rejects.toThrow("SOCIAL_NOT_CONFIGURED");
  expect(await h.t.run((ctx) => ctx.db.query("socialOAuthStates").collect())).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
});
test("an owned callback on a mismatched app origin is refused", async () => {
  const h = await setup();
  vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", OWNED);
  vi.stubEnv("SITE_URL", "https://pikar-social-test.example");
  await expect(
    h.owner.action(api.socialActions.startConnect, { provider: "youtube" }),
  ).rejects.toThrow("SOCIAL_NOT_CONFIGURED");
});
test("changing the registered redirect during OAuth cannot exchange an old authorization code", async () => {
  const h = await setup();
  vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", OWNED);
  const auth = new URL(
    (await h.owner.action(api.socialActions.startConnect, { provider: "youtube" })).url,
  );
  const state = auth.searchParams.get("state");
  if (!state) throw new Error("OAuth state missing");
  vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", undefined);
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
  expect(fetcher).not.toHaveBeenCalled();
  expect(await h.t.run((ctx) => ctx.db.query("socialConnections").collect())).toHaveLength(0);
});
test("the YouTube override does not change Meta's callback", async () => {
  const h = await setup();
  vi.stubEnv("YOUTUBE_OAUTH_REDIRECT_URI", "invalid-value");
  vi.stubEnv("META_OAUTH_CLIENT_ID", "synthetic-meta-client");
  vi.stubEnv("META_OAUTH_CLIENT_SECRET", "synthetic-meta-secret");
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  const auth = new URL(
    (await h.owner.action(api.socialActions.startConnect, { provider: "meta" })).url,
  );
  expect(auth.searchParams.get("redirect_uri")).toBe(
    "https://synthetic.convex.site/social/meta/callback",
  );
});

test.each([
  ["youtube", "https://review.pikar-ai.com"],
  ["youtube", "https://review.pikar-ai.com/"],
  ["tiktok", "https://review.pikar-ai.com"],
  ["tiktok", "https://review.pikar-ai.com/"],
  ["tiktok", "https://www.pikar-ai.com"],
] as const)("%s auth and exchange preserve the exact review override or absent isolated default (%s)", async (provider, site) => {
  const h = await setup();
  const override = site.startsWith("https://review.")
    ? `https://review.pikar-ai.com/social/${provider}/callback`
    : undefined;
  vi.stubEnv("SITE_URL", site);
  vi.stubEnv(
    provider === "youtube" ? "YOUTUBE_OAUTH_REDIRECT_URI" : "TIKTOK_OAUTH_REDIRECT_URI",
    override,
  );
  const expected = override ?? `https://synthetic.convex.site/social/${provider}/callback`;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (
      url === "https://oauth2.googleapis.com/token" ||
      url === "https://open.tiktokapis.com/v2/oauth/token/"
    ) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("redirect_uri")).toBe(expected);
      return Response.json({
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        expires_in: 3600,
        scope: SOCIAL_SCOPES[provider].join(provider === "tiktok" ? "," : " "),
      });
    }
    if (url.includes("/user/info/"))
      return Response.json({
        data: { user: { open_id: "synthetic-tiktok", display_name: "Synthetic" } },
      });
    if (url.startsWith("https://www.googleapis.com/youtube/v3/channels?"))
      return Response.json({
        items: [{ id: "synthetic-channel", snippet: { title: "Synthetic" } }],
      });
    throw new Error("Unexpected endpoint");
  });
  vi.stubGlobal("fetch", fetcher);
  const auth = new URL((await h.owner.action(api.socialActions.startConnect, { provider })).url);
  expect(auth.searchParams.get("redirect_uri")).toBe(expected);
  const state = auth.searchParams.get("state");
  if (!state) throw new Error("OAuth state missing");
  const result = await h.t.action(internal.socialActions.callback, {
    provider,
    state,
    code: "synthetic-code",
    denied: false,
  });
  expect(result.receipt).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(result)).not.toMatch(/synthetic-access|synthetic-refresh|synthetic-code/);
});

test.each([
  "youtube",
  "tiktok",
] as const)("%s review override rejects wrong sites, malformed URLs and cross-provider callbacks before state creation", async (provider) => {
  const h = await setup();
  const env = provider === "youtube" ? "YOUTUBE_OAUTH_REDIRECT_URI" : "TIKTOK_OAUTH_REDIRECT_URI";
  const exact = `https://review.pikar-ai.com/social/${provider}/callback`;
  const cases = [
    ["https://www.pikar-ai.com", exact],
    ["https://review.pikar-ai.com.evil.example", exact],
    ["http://review.pikar-ai.com", exact],
    ["https://review.pikar-ai.com/path", exact],
    ["https://review.pikar-ai.com", ""],
    ["https://review.pikar-ai.com", exact + "/"],
    ["https://review.pikar-ai.com", exact + "?x=1"],
    ["https://review.pikar-ai.com", exact + "#x"],
    ["https://review.pikar-ai.com", exact.replace("https:", "http:")],
    ["https://review.pikar-ai.com", exact.replace("review.", "user@review.")],
    ["https://review.pikar-ai.com", exact.replace(".com/", ".com:443/")],
    ["https://review.pikar-ai.com", exact.replace(provider + "/callback", "meta/callback")],
    ["https://review.pikar-ai.com", "https://www.pikar-ai.com/social/" + provider + "/callback"],
  ];
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const [site, redirect] of cases) {
    vi.stubEnv("SITE_URL", site);
    vi.stubEnv(env, redirect);
    await expect(h.owner.action(api.socialActions.startConnect, { provider })).rejects.toThrow(
      "SOCIAL_NOT_CONFIGURED",
    );
  }
  expect(await h.t.run((ctx) => ctx.db.query("socialOAuthStates").collect())).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  "youtube",
  "tiktok",
] as const)("%s review state cannot exchange after the deployment origin changes", async (provider) => {
  const h = await setup();
  vi.stubEnv("SITE_URL", "https://review.pikar-ai.com");
  vi.stubEnv(
    provider === "youtube" ? "YOUTUBE_OAUTH_REDIRECT_URI" : "TIKTOK_OAUTH_REDIRECT_URI",
    `https://review.pikar-ai.com/social/${provider}/callback`,
  );
  const auth = new URL((await h.owner.action(api.socialActions.startConnect, { provider })).url);
  const state = auth.searchParams.get("state");
  if (!state) throw new Error("OAuth state missing");
  vi.stubEnv("SITE_URL", "https://www.pikar-ai.com");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    h.t.action(internal.socialActions.callback, {
      provider,
      state,
      code: "synthetic-code",
      denied: false,
    }),
  ).rejects.toThrow("SOCIAL_NOT_CONFIGURED");
  expect(fetcher).not.toHaveBeenCalled();
  expect(await h.t.run((ctx) => ctx.db.query("socialConnections").collect())).toHaveLength(0);
});

test("TikTok cannot use the production www callback even when SITE_URL is www", async () => {
  const h = await setup();
  vi.stubEnv("TIKTOK_OAUTH_REDIRECT_URI", "https://www.pikar-ai.com/social/tiktok/callback");
  await expect(
    h.owner.action(api.socialActions.startConnect, { provider: "tiktok" }),
  ).rejects.toThrow("SOCIAL_NOT_CONFIGURED");
});
