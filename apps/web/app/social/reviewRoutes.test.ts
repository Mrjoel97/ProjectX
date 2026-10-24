import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET as proof } from "./media/[filename]/route";
import { GET as video } from "./media/video/route";
import { GET as tiktok } from "./tiktok/callback/route";
import { GET as youtube } from "./youtube/callback/route";

const APP = "https://review.pikar-ai.com";
const CLOUD = "https://review-backend-123.convex.cloud";
const SITE = "https://review-backend-123.convex.site";
const STATE = "s".repeat(43),
  RECEIPT = "r".repeat(43),
  TICKET = "t".repeat(43);
const secretHeaders = {
  Cookie: "synthetic-session",
  Authorization: "Bearer synthetic-user",
  "X-Forwarded-Host": "evil.example",
};
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CLOUD));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function stub(response: Response) {
  const fetcher = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function targetCall(fetcher: ReturnType<typeof stub>) {
  return fetcher.mock.calls[0] as unknown as [URL, RequestInit];
}
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("set-cookie")).toBeNull();
}
describe.each([
  ["youtube", youtube],
  ["tiktok", tiktok],
] as const)("%s review callback", (provider, handler) => {
  const path = `/social/${provider}/callback`;
  const fail = `${APP}/connect-social?provider=${provider}&result=failed`;
  const result = `${APP}/connect-social?provider=${provider}&complete=${RECEIPT}`;
  const request = (query = `state=${STATE}&code=synthetic-code`) =>
    new Request(`${APP + path}?${query}`, { headers: secretHeaders });
  test("uses only the trusted backend and returns an owned review receipt without credentials", async () => {
    const fetcher = stub(new Response(null, { status: 303, headers: { Location: result } }));
    const response = await handler(
      request(`state=${STATE}&code=synthetic-code&scope=ignored&next=https://evil.example`),
    );
    const [target, init] = targetCall(fetcher);
    expect(target.origin).toBe(SITE);
    expect(target.pathname).toBe(path);
    expect([...target.searchParams.keys()].sort()).toEqual(["code", "state"]);
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
    });
    expect(init.headers).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(result);
    privateHeaders(response);
  });
  test("normalizes provider denial and strips private error descriptions", async () => {
    const location = `${APP}/connect-social?provider=${provider}&result=cancelled`;
    const fetcher = stub(new Response(null, { status: 303, headers: { Location: location } }));
    const response = await handler(
      request(`state=${STATE}&error=server_error&error_description=private`),
    );
    const [target] = targetCall(fetcher);
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect([...target.searchParams.keys()].sort()).toEqual(["error", "state"]);
    expect(response.headers.get("location")).toBe(location);
  });
  test.each([
    `state=${STATE}&state=${STATE}&code=x`,
    `state=${STATE}&code=x&error=access_denied`,
    "state=short&code=x",
    `state=${STATE}&code=%0Aprivate`,
    `state=${STATE}&code=${"x".repeat(4097)}`,
  ])("rejects invalid consent input before forwarding: %s", async (query) => {
    const fetcher = stub(new Response(null, { status: 303, headers: { Location: result } }));
    expect((await handler(request(query))).headers.get("location")).toBe(fail);
    expect(fetcher).not.toHaveBeenCalled();
  });
  test.each([
    `https://evil.example/connect-social?provider=${provider}&complete=${RECEIPT}`,
    `https://www.pikar-ai.com/connect-social?provider=${provider}&complete=${RECEIPT}`,
    `${result}&code=private`,
    `${result}&complete=${RECEIPT}`,
    `${result}&result=failed`,
    `${result}#private`,
    `${APP}/connect-social?provider=${provider}&result=private`,
  ])("refuses an untrusted or ambiguous backend redirect: %s", async (location) => {
    stub(new Response(null, { status: 303, headers: { Location: location } }));
    expect((await handler(request())).headers.get("location")).toBe(fail);
  });
  test("unknown hosts and POST never call the backend", async () => {
    const fetcher = stub(new Response(null, { status: 303, headers: { Location: result } }));
    const unknown = await handler(new Request(`https://evil.example${path}?state=${STATE}&code=x`));
    expect(unknown.headers.get("location")).toBe(
      `https://www.pikar-ai.com/connect-social?provider=${provider}&result=failed`,
    );
    expect((await handler(new Request(APP + path, { method: "POST" }))).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
test("TikTok cannot activate on the production callback origin", async () => {
  const fetcher = stub(new Response(null));
  await tiktok(
    new Request(`https://www.pikar-ai.com/social/tiktok/callback?state=${STATE}&code=x`),
  );
  expect(fetcher).not.toHaveBeenCalled();
});

const mediaPath = "/social/media/video";
const mediaUrl = `${APP + mediaPath}?postId=synthetic-post-id&ticket=${TICKET}`;
function mp4(body = "video", extra: HeadersInit = {}, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(body.length),
      ...extra,
    },
  });
}
test("streams a bounded MP4 from the fixed backend without forwarding session or response credentials", async () => {
  const fetcher = stub(
    mp4("video", { "Set-Cookie": "private", "X-Private": "private", "Accept-Ranges": "bytes" }),
  );
  const response = await video(new Request(mediaUrl, { headers: secretHeaders }));
  const [target, init] = targetCall(fetcher);
  expect(target.origin).toBe(SITE);
  expect(target.pathname).toBe(mediaPath);
  expect([...target.searchParams.keys()].sort()).toEqual(["postId", "ticket"]);
  expect(init).toMatchObject({
    method: "GET",
    credentials: "omit",
    redirect: "manual",
    cache: "no-store",
  });
  expect(init.headers).toBeUndefined();
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("video/mp4");
  expect(response.headers.get("accept-ranges")).toBe("bytes");
  expect(response.headers.get("x-private")).toBeNull();
  expect(await response.text()).toBe("video");
  privateHeaders(response);
});
test.each([
  "?postId=post&ticket=short",
  `?postId=post&ticket=${TICKET}&ticket=${TICKET}`,
  `?postId=post&postId=other&ticket=${TICKET}`,
  `?postId=post&ticket=${TICKET}&url=https://evil.example`,
  `?postId=${"p".repeat(129)}&ticket=${TICKET}`,
  `?postId=..%2Fprivate&ticket=${TICKET}`,
])("rejects malformed/extra media parameters without fetching: %s", async (query) => {
  const fetcher = stub(mp4());
  expect((await video(new Request(APP + mediaPath + query))).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});
test.each([
  "bytes=0-1,4-5",
  "items=0-1",
  "bytes=-0",
  "bytes=3-1",
  "bytes=0-20971520",
  "bytes=20971520-",
  "bytes=-20971521",
])("refuses malformed or oversized byte ranges: %s", async (range) => {
  const fetcher = stub(mp4());
  const response = await video(new Request(mediaUrl, { headers: { Range: range } }));
  expect(response.status).toBe(416);
  expect(fetcher).not.toHaveBeenCalled();
  privateHeaders(response);
});
test.each([
  ["bytes=1-3", "bytes 1-3/8"],
  ["bytes=5-", "bytes 5-7/8"],
  ["bytes=-3", "bytes 5-7/8"],
])("forwards only a valid range and validates its206 response: %s", async (range, contentRange) => {
  const fetcher = stub(mp4("abc", { "Content-Range": contentRange }, 206));
  const response = await video(
    new Request(mediaUrl, { headers: { ...secretHeaders, Range: range } }),
  );
  const [, init] = targetCall(fetcher);
  expect(init.headers).toEqual({ Range: range });
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(contentRange);
  expect(await response.text()).toBe("abc");
});
test("allows a backend to ignore Range and return the complete bounded file", async () => {
  stub(mp4());
  const response = await video(new Request(mediaUrl, { headers: { Range: "bytes=0-1" } }));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("video");
});
test.each([
  () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } }),
  () => mp4("video", { "Content-Type": "text/html" }),
  () => mp4("video", { "Content-Length": "20971521" }),
  () => mp4("video", { "Content-Encoding": "gzip" }),
  () => mp4("video", { "Content-Range": "bytes 0-4/5" }),
  () => mp4("abc", { "Content-Range": "bytes 2-4/8" }, 206),
])("rejects unsafe upstream response metadata or redirects", async (upstream) => {
  stub(upstream());
  const response = await video(new Request(mediaUrl, { headers: { Range: "bytes=1-3" } }));
  expect(response.status).toBe(502);
  expect(await response.text()).toBe("");
  privateHeaders(response);
});
test.each([
  ["v", "2"],
  ["video", "2"],
])("terminates a stream that disagrees with its declared length", async (body, length) => {
  stub(mp4(body, { "Content-Length": length }));
  const response = await video(new Request(mediaUrl));
  await expect(response.text()).rejects.toThrow();
});
test("media cancellation cancels the upstream reader", async () => {
  const cancel = vi.fn();
  stub(
    new Response(new ReadableStream({ cancel }), {
      headers: { "Content-Type": "video/mp4", "Content-Length": "1" },
    }),
  );
  const response = await video(new Request(mediaUrl));
  await response.body?.cancel();
  expect(cancel).toHaveBeenCalledTimes(1);
});
test("invalid build backend, unknown host and non-GET media requests fail without forwarding", async () => {
  const fetcher = stub(mp4());
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://evil.example");
  expect((await video(new Request(mediaUrl))).status).toBe(404);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CLOUD);
  expect((await video(new Request(mediaUrl.replace(APP, "https://evil.example")))).status).toBe(
    404,
  );
  expect((await video(new Request(mediaUrl, { method: "POST" }))).status).toBe(405);
  expect(fetcher).not.toHaveBeenCalled();
});

const proofUrl = `${APP}/social/media/tiktokOfficialProof.txt`;
test("relays only bounded plain-text proof from the authoritative exact backend path", async () => {
  const fetcher = stub(
    new Response("synthetic public proof\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Set-Cookie": "private" },
    }),
  );
  const response = await proof(new Request(proofUrl, { headers: secretHeaders }));
  const [target, init] = targetCall(fetcher);
  expect(String(target)).toBe(`${SITE}/social/media/tiktokOfficialProof.txt`);
  expect(init.headers).toBeUndefined();
  expect(init).toMatchObject({ redirect: "manual", credentials: "omit", cache: "no-store" });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("synthetic public proof\n");
  privateHeaders(response);
});
test.each([
  `${APP}/social/media/arbitrary.txt`,
  `${proofUrl}?query=private`,
  `${APP}/social/media/tiktok${"x".repeat(160)}.txt`,
  "https://evil.example/social/media/tiktokOfficialProof.txt",
])("rejects arbitrary proof paths/queries/origins before fetching: %s", async (url) => {
  const fetcher = stub(new Response("proof"));
  expect((await proof(new Request(url))).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});
test.each([
  new Response("x".repeat(4097), { headers: { "Content-Type": "text/plain" } }),
  new Response("private", { headers: { "Content-Type": "text/html" } }),
  new Response("\u00e9", { headers: { "Content-Type": "text/plain" } }),
  new Response("  ", { headers: { "Content-Type": "text/plain" } }),
  new Response(null, { status: 302, headers: { Location: "https://evil.example" } }),
])("rejects unbounded or unsafe proof responses", async (response) => {
  stub(response);
  expect((await proof(new Request(proofUrl))).status).toBe(502);
});
test("the backend exact-filename404 stays a closed local404", async () => {
  stub(new Response(null, { status: 404 }));
  const response = await proof(new Request(proofUrl));
  expect(response.status).toBe(404);
  privateHeaders(response);
});
test("only exact callback/video middleware exceptions were added; relays never log", () => {
  const middleware = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
  for (const path of ["/social/youtube/callback", "/social/tiktok/callback", "/social/media/video"])
    expect(middleware).toContain(`"${path}",`);
  expect(middleware).not.toMatch(/"\/social(?:\/\(\.\*\)|\/\*|\(\.\*\))"/);
  for (const path of ["./_relay.ts", "./media/video/route.ts", "./media/[filename]/route.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).not.toMatch(/console\.(?:log|warn|error|debug)|logger\./);
  }
});
