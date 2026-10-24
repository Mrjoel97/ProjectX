import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { metaTokenExpiry } from "./socialActions";

const now = 1700000000000;
const proof = {
  is_valid: true,
  type: "USER",
  app_id: "111",
  user_id: "333",
  expires_at: 0,
  data_access_expires_at: now / 1000 + 3600,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("META_OAUTH_CLIENT_ID", "111");
  vi.stubEnv("META_OAUTH_CLIENT_SECRET", "synthetic-app-secret");
  vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
test("Meta expiry introspection uses only the fixed Graph endpoint and app authorization header", async () => {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe("/v26.0/debug_token");
    expect([...url.searchParams.entries()]).toEqual([["input_token", "synthetic-user-token"]]);
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({ Authorization: "Bearer 111|synthetic-app-secret" });
    return Response.json({ data: proof });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await metaTokenExpiry("synthetic-user-token", "333")).toBe(now + 3600000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("Meta expiry introspection rejects another app or another user despite a valid lifetime", async () => {
  for (const patch of [{ app_id: "foreign-app" }, { user_id: "foreign-user" }]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: { ...proof, ...patch } })),
    );
    await expect(metaTokenExpiry("synthetic-user-token", "333")).rejects.toMatchObject({
      message: "SOCIAL_TOKEN_EXPIRY_UNAVAILABLE",
    });
  }
});
test("Meta introspection sanitizes network errors that contain token-bearing URLs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error(
        "Failed https://graph.facebook.com/v26.0/debug_token?input_token=synthetic-user-token app-secret=synthetic-app-secret",
      );
    }),
  );
  const error = await metaTokenExpiry("synthetic-user-token", "333").catch((error) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe("SOCIAL_META_TOKEN_METADATA_UNAVAILABLE");
  expect(String(error)).not.toMatch(/synthetic-user-token|synthetic-app-secret|https:/);
});
