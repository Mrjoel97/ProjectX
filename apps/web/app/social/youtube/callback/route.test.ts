import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET } from "./route";

const APP = "https://www.pikar-ai.com";
const CLOUD = "https://opulent-octopus-494.convex.cloud";
const SITE = "https://opulent-octopus-494.convex.site";
const PATH = "/social/youtube/callback";
const STATE = "s".repeat(43);
const RECEIPT = "r".repeat(43);
const CODE = "4/synthetic+code&opaque";
const FAIL = APP + "/connect-social?provider=youtube&result=failed";
const success = APP + "/connect-social?provider=youtube&complete=" + RECEIPT;
function request(query: Record<string, string> = { state: STATE, code: CODE }) {
  return new Request(APP + PATH + "?" + new URLSearchParams(query), {
    headers: { Cookie: "synthetic-app-session", Authorization: "Bearer synthetic-user-token" },
  });
}
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CLOUD));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function upstream(location: string | null = success, status = 303) {
  const fetcher = vi.fn(
    async () =>
      new Response(null, {
        status,
        headers: location === null ? {} : { Location: location },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function checkHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
}

test("relays only opaque OAuth material to the fixed backend and returns only the tenant-activation receipt", async () => {
  const fetcher = upstream();
  const response = await GET(
    request({ state: STATE, code: CODE, scope: "ignored", authuser: "ignored" }),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [target, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(target.origin).toBe(SITE);
  expect(target.pathname).toBe(PATH);
  expect([...target.searchParams.keys()].sort()).toEqual(["code", "state"]);
  expect(target.searchParams.get("code")).toBe(CODE);
  expect(target.searchParams.get("state")).toBe(STATE);
  expect(init).toMatchObject({
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    cache: "no-store",
  });
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(init.headers).toBeUndefined();
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(success);
  expect(response.headers.get("location")).not.toContain(CODE);
  expect(response.headers.get("location")).not.toContain(STATE);
  expect(await response.text()).toBe("");
  checkHeaders(response);
});

test("provider denial is relayed without descriptions or account hints and returns a closed cancellation", async () => {
  const fetcher = upstream(APP + "/connect-social?provider=youtube&result=cancelled");
  const response = await GET(
    request({ state: STATE, error: "access_denied", error_description: "private-provider-text" }),
  );
  const [target] = fetcher.mock.calls[0] as unknown as [URL];
  expect([...target.searchParams.keys()].sort()).toEqual(["error", "state"]);
  expect(target.searchParams.get("error")).toBe("access_denied");
  expect(String(target)).not.toContain("private-provider-text");
  expect(response.headers.get("location")).toBe(
    APP + "/connect-social?provider=youtube&result=cancelled",
  );
  checkHeaders(response);
});

test.each([
  "?code=synthetic",
  "?state=" + STATE,
  "?state=short&code=synthetic",
  "?state=" + STATE + "&state=" + STATE + "&code=synthetic",
  "?state=" + STATE + "&code=one&code=two",
  "?state=" + STATE + "&error=access_denied&error=server_error",
  "?state=" + STATE + "&code=synthetic&error=access_denied",
  "?state=" + STATE + "&code=%0Aprivate",
  "?state=" + STATE + "&error=",
])("rejects malformed or ambiguous incoming OAuth parameters before forwarding: %s", async (query) => {
  const fetcher = upstream();
  const response = await GET(new Request(APP + PATH + query));
  expect(fetcher).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBe(FAIL);
  checkHeaders(response);
});

test.each([
  "",
  "http://opulent-octopus-494.convex.cloud",
  "https://evil.example",
  "https://opulent-octopus-494.convex.cloud.evil.example",
  "https://user:password@opulent-octopus-494.convex.cloud",
  CLOUD + ":8443",
  CLOUD + "/other",
  CLOUD + "?target=evil",
  CLOUD + "#fragment",
])("refuses an invalid backend origin before forwarding: %s", async (cloud) => {
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", cloud);
  const fetcher = upstream();
  expect((await GET(request())).headers.get("location")).toBe(FAIL);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  "https://evil.example/connect-social?provider=youtube&complete=" + RECEIPT,
  APP + "/steal?provider=youtube&complete=" + RECEIPT,
  APP + "/connect-social?provider=meta&complete=" + RECEIPT,
  APP + "/connect-social?provider=youtube&complete=short",
  success + "&result=failed",
  success + "&code=private-code",
  success + "&complete=" + RECEIPT,
  success + "#private",
  APP + "/connect-social?provider=youtube&result=private-provider-text",
])("refuses an unsafe or ambiguous upstream destination: %s", async (location) => {
  upstream(location);
  const response = await GET(request());
  expect(response.headers.get("location")).toBe(FAIL);
  checkHeaders(response);
});

test.each([200, 302, 500])("refuses an unexpected upstream status %s", async (status) => {
  upstream(success, status);
  expect((await GET(request())).headers.get("location")).toBe(FAIL);
});
test("network/provider failure emits no private words and has a closed fallback", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error(CODE + " private state " + STATE);
    }),
  );
  const response = await GET(request());
  expect(response.headers.get("location")).toBe(FAIL);
  expect(await response.text()).toBe("");
  checkHeaders(response);
});
test("missing upstream location is a closed failure", async () => {
  upstream(null);
  expect((await GET(request())).headers.get("location")).toBe(FAIL);
});
test("only the exact canonical callback origin/path and GET are accepted", async () => {
  const fetcher = upstream();
  for (const url of ["https://pikar-ai.com" + PATH, APP + "/social/meta/callback"]) {
    expect(
      (await GET(new Request(url + "?state=" + STATE + "&code=x"))).headers.get("location"),
    ).toBe(FAIL);
  }
  const response = await GET(new Request(APP + PATH, { method: "POST" }));
  expect(response.status).toBe(405);
  checkHeaders(response);
  expect(fetcher).not.toHaveBeenCalled();
});
test("the public middleware exception is exact and the relay has no logging surface", () => {
  const proxy = readFileSync(new URL("../../../../proxy.ts", import.meta.url), "utf8");
  expect(proxy).toContain('"/social/youtube/callback",');
  expect(proxy).not.toMatch(/"\/social(?:\/\(\.\*\)|\/\*|\(\.\*\))"/);
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/console\.(?:log|warn|error|debug)|logger\./);
});
