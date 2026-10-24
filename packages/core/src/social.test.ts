import { afterEach, describe, expect, test, vi } from "vitest";
import {
  SOCIAL_PROVIDERS,
  SOCIAL_SCOPES,
  socialAuthorizationUrl,
  socialChallenge,
  socialExpiry,
  socialFailureDiagnostic,
  socialJson,
  socialMetaTokenExpiry,
  socialProviderFailure,
} from "./social";
import { socialHmac, verifySocialWebhook } from "./socialWebhook";

afterEach(() => vi.unstubAllGlobals());
test.each([
  200, 400,
])("Meta HTTP %s error envelopes keep only numeric allowlisted fields", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          error: {
            code: 100,
            error_subcode: 33,
            message: "synthetic-token-must-not-log",
            fbtrace_id: "private-trace",
          },
        },
        { status },
      ),
    ),
  );
  const error = await socialJson("https://graph.facebook.com/v26.0/page/feed").catch(
    (value: unknown) => value,
  );
  expect(socialFailureDiagnostic(error)).toEqual({
    code: "provider_error",
    httpStatus: status,
    providerCode: 100,
    providerSubcode: 33,
  });
  expect(JSON.stringify(error)).not.toMatch(/synthetic|private-trace|message|fbtrace/);
});
test("provider diagnostics allow only known codes and numeric statuses, never provider prose", () => {
  const secret = "synthetic-token-must-not-log";
  expect(
    socialProviderFailure("meta", 400, {
      error: {
        code: 190,
        error_subcode: 463,
        message: secret,
        fbtrace_id: secret,
      },
    }),
  ).toEqual({ code: "provider_error", httpStatus: 400, providerCode: 190, providerSubcode: 463 });
  expect(
    socialProviderFailure("meta", 999, {
      error: {
        code: "190",
        error_subcode: 123456789,
        message: secret,
      },
    }),
  ).toEqual({ code: "provider_error" });
  expect(
    socialProviderFailure("tiktok", 403, {
      error: {
        code: "unaudited_client_can_only_post_to_private_accounts",
        message: secret,
        log_id: secret,
      },
    }),
  ).toEqual({ code: "unaudited_client_can_only_post_to_private_accounts", httpStatus: 403 });
  expect(socialProviderFailure("tiktok", 200, { error: { code: secret } })).toEqual({
    code: "provider_error",
    httpStatus: 200,
  });
  expect(
    socialFailureDiagnostic(
      Object.assign(new Error(secret), {
        diagnostic: { code: secret, httpStatus: secret },
      }),
    ),
  ).toEqual({ code: "internal_failure" });
});
test.each([403, 200])("TikTok HTTP %s errors retain only a safe diagnostic", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "url_ownership_unverified",
            message: "synthetic-token-must-not-log",
            log_id: "synthetic-private-trace",
          },
        },
        { status },
      ),
    ),
  );
  const error = await socialJson("https://open.tiktokapis.com/v2/post/publish/video/init/").catch(
    (value: unknown) => value,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe("SOCIAL_PROVIDER_UNAVAILABLE");
  expect(socialFailureDiagnostic(error)).toEqual({
    code: "url_ownership_unverified",
    httpStatus: status,
  });
  expect(JSON.stringify(error)).not.toMatch(/synthetic|message|log_id/);
});
test.each([
  "malformed",
  "oversized",
  "network",
])("%s provider failures never expose raw data", async (kind) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (kind === "network")
        throw new Error("https://private.invalid/?token=synthetic-token-must-not-log");
      return new Response(
        kind === "oversized" ? "x".repeat(262145) : "synthetic-token-must-not-log",
      );
    }),
  );
  const error = await socialJson("https://graph.facebook.com/v26.0/me").catch(
    (value: unknown) => value,
  );
  expect(socialFailureDiagnostic(error)).toEqual(
    kind === "network"
      ? { code: "transport_error" }
      : { code: "invalid_response", httpStatus: 200 },
  );
  expect(JSON.stringify(error)).not.toMatch(/synthetic|private.invalid/);
});
describe("direct social provider boundaries", () => {
  test.each(
    SOCIAL_PROVIDERS,
  )("%s requests minimum account scopes with the exact callback", async (provider) => {
    const url = new URL(
      socialAuthorizationUrl(provider, {
        clientId: "test-app",
        redirectUri: "https://test.convex.site/social/" + provider + "/callback",
        state: "random-state",
        challenge: await socialChallenge("verifier"),
        metaVersion: "v25.0",
      }),
    );
    expect(url.searchParams.get("state")).toBe("random-state");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://test.convex.site/social/" + provider + "/callback",
    );
    expect(url.searchParams.get("scope")).toBe(
      SOCIAL_SCOPES[provider].join(provider === "meta" || provider === "tiktok" ? "," : " "),
    );
    expect(url.toString()).not.toMatch(/secret|tweet.write|youtube.upload|video.publish/);
    if (provider === "x" || provider === "youtube")
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
  test("Meta business configuration replaces scopes and preserves the code flow", () => {
    const input = {
      clientId: "test-app",
      redirectUri: "https://test.convex.site/social/meta/callback",
      state: "state",
      challenge: "unused",
      metaVersion: "v26.0",
      metaConfigId: "123456789",
    };
    const url = new URL(socialAuthorizationUrl("meta", input));
    expect(url.searchParams.get("config_id")).toBe("123456789");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("override_default_response_type")).toBe("true");
    for (const metaConfigId of ["", "123&scope=ads_management", "x", "1".repeat(33)])
      expect(() => socialAuthorizationUrl("meta", { ...input, metaConfigId })).toThrow(
        "SOCIAL_NOT_CONFIGURED",
      );
    expect(new URL(socialAuthorizationUrl("x", input)).searchParams.has("config_id")).toBe(false);
  });
  test("invalid Meta version, expiry, foreign hosts and oversized provider responses fail closed", async () => {
    expect(() =>
      socialAuthorizationUrl("meta", {
        clientId: "test",
        redirectUri: "https://test.convex.site",
        state: "state",
        challenge: "challenge",
      }),
    ).toThrow();
    for (const value of [0, -1, Infinity, "not-a-number", 86400 * 400])
      expect(() => socialExpiry(value)).toThrow();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(socialJson("https://attacker.test/tokens")).rejects.toThrow(
      "SOCIAL_INVALID_ENDPOINT",
    );
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(new Response("a".repeat(262145)));
    await expect(socialJson("https://api.x.com/2/users/me")).rejects.toThrow(
      "SOCIAL_INVALID_RESPONSE",
    );
  });
  test.each([
    "x",
    "meta",
    "tiktok",
    "youtube",
  ] as const)("%s verifies original webhook bytes and rejects alteration", async (provider) => {
    const body = '{"event":"test"}',
      secret = "synthetic-secret",
      now = 1700000000000;
    const header =
      provider === "tiktok"
        ? "t=1700000000,s=" + (await socialHmac(secret, "1700000000." + body))
        : provider === "youtube"
          ? "sha1=" + (await socialHmac(secret, body, "SHA-1"))
          : "sha256=" + (await socialHmac(secret, body, "SHA-256", provider === "x"));
    expect(await verifySocialWebhook(provider, secret, body, header, now)).toBe(true);
    expect(await verifySocialWebhook(provider, secret, body + " ", header, now)).toBe(false);
    expect(await verifySocialWebhook(provider, "wrong-secret", body, header, now)).toBe(false);
    if (provider === "tiktok")
      expect(await verifySocialWebhook(provider, secret, body, header, now + 301000)).toBe(false);
  });
});

const metaNow = 1700000000000;
const metaDebug = {
  is_valid: true,
  type: "USER",
  app_id: "app-1",
  user_id: "user-1",
  expires_at: metaNow / 1000 + 3600,
};
test("Meta debug-token expiry takes the earliest provider bound and preserves exact timestamps", () => {
  expect(socialMetaTokenExpiry(metaDebug, "app-1", "user-1", metaNow)).toBe(metaNow + 3600000);
  expect(
    socialMetaTokenExpiry(
      { ...metaDebug, data_access_expires_at: metaNow / 1000 + 1800 },
      "app-1",
      "user-1",
      metaNow,
    ),
  ).toBe(metaNow + 1800000);
  expect(
    socialMetaTokenExpiry(
      { ...metaDebug, expires_at: 0, data_access_expires_at: metaNow / 1000 + 1800 },
      "app-1",
      "user-1",
      metaNow,
    ),
  ).toBe(metaNow + 1800000);
  expect(
    socialMetaTokenExpiry({ ...metaDebug, data_access_expires_at: 0 }, "app-1", "user-1", metaNow),
  ).toBe(metaNow + 3600000);
  expect(
    socialMetaTokenExpiry(
      { ...metaDebug, expires_at: metaNow / 1000 + 366 * 86400 },
      "app-1",
      "user-1",
      metaNow,
    ),
  ).toBe(metaNow + 366 * 86400000);
});
test.each([
  { is_valid: false },
  { is_valid: "true" },
  { type: "PAGE" },
  { type: "user" },
  { app_id: "other-app" },
  { user_id: "other-user" },
  { expires_at: undefined },
  { expires_at: null },
  { expires_at: "1700003600" },
  { expires_at: -1 },
  { expires_at: NaN },
  { expires_at: Infinity },
  { expires_at: 1.5 },
  { expires_at: 0 },
  { expires_at: 0, data_access_expires_at: 0 },
  { expires_at: metaNow / 1000 },
  { expires_at: metaNow / 1000 - 1 },
  { data_access_expires_at: metaNow / 1000 - 1 },
  { data_access_expires_at: null },
  { data_access_expires_at: -1 },
  { data_access_expires_at: "1700003600" },
  { expires_at: metaNow / 1000 + 366 * 86400 + 1 },
])("Meta expiry rejects invalid, expired, foreign or unbounded metadata %#", (patch) => {
  expect(() =>
    socialMetaTokenExpiry({ ...metaDebug, ...patch }, "app-1", "user-1", metaNow),
  ).toThrow("SOCIAL_TOKEN_EXPIRY_UNAVAILABLE");
});
