import { describe, expect, test } from "vitest";
import { readZernioReport, zernioChannels, zernioFailure, zernioGet } from "./zernio";

const profile = "1234567890abcdef12345678",
  id = "1234567890abcdef12345679",
  other = "1234567890abcdef12345670",
  key = `zrk_${"a".repeat(64)}`;
const account = {
  _id: id,
  profileId: profile,
  platform: "tiktok",
  username: "business",
  isActive: true,
};
describe("Zernio production read boundaries", () => {
  test("retains only exact provider post permalinks under the already-verified account/platform scope", async () => {
    for (const platform of ["instagram", "tiktok"] as const) {
      const postId = platform === "instagram" ? "17891234567890123" : "7425678901234567890";
      const nativePostUrl =
        platform === "instagram"
          ? "https://www.instagram.com/reel/Cx_Ab-123/"
          : "https://www.tiktok.com/@business/video/7425678901234567890";
      const fetcher = async (input: RequestInfo | URL) =>
        String(input).includes("/accounts")
          ? Response.json({ accounts: [{ ...account, platform }] })
          : Response.json({
              posts: [
                {
                  isExternal: true,
                  content: "Private text",
                  platformAnalytics: [
                    {
                      platform,
                      accountId: id,
                      platformPostId: postId,
                      platformPostUrl: nativePostUrl,
                      analytics: { likes: 0 },
                    },
                  ],
                },
              ],
              pagination: { page: 1, pages: 1 },
            });
      const result = await readZernioReport(
        key,
        profile,
        [id],
        Date.parse("2026-10-24T10:00:00Z"),
        fetcher,
      );
      expect(result.report.accounts[0]?.posts[0]).toEqual({
        postId,
        source: "external",
        metrics: { likes: 0 },
        updatedAt: null,
        nativePostUrl,
      });
      expect(JSON.stringify(result.report)).not.toContain("Private text");
    }
  });
  test("unsupported, conflicting or other-platform URL metadata never creates a native mapping", async () => {
    for (const platformPostUrl of [
      "https://www.tiktok.com/@business/video/7425678901234567891",
      "https://www.instagram.com/p/Cx_Ab-123/",
      "https://evil.test/@business/video/7425678901234567890",
      "https://www.tiktok.com/@business/video/7425678901234567890?secret=private",
    ]) {
      const fetcher = async (input: RequestInfo | URL) =>
        String(input).includes("/accounts")
          ? Response.json({ accounts: [account] })
          : Response.json({
              posts: [
                {
                  isExternal: true,
                  platformAnalytics: [
                    {
                      platform: "tiktok",
                      accountId: id,
                      platformPostId: "7425678901234567890",
                      platformPostUrl,
                      analytics: { likes: 0 },
                    },
                  ],
                },
              ],
              pagination: { page: 1, pages: 1 },
            });
      const post = (
        await readZernioReport(key, profile, [id], Date.parse("2026-10-24T10:00:00Z"), fetcher)
      ).report.accounts[0]?.posts[0];
      expect(post?.metrics).toEqual({ likes: 0 });
      expect(post?.nativePostUrl).toBeUndefined();
    }
  });
  test("rejects foreign-profile and duplicate account data, and exposes only supported accounts", () => {
    expect(() =>
      zernioChannels({ accounts: [{ ...account, profileId: other }] }, profile),
    ).toThrow();
    expect(() => zernioChannels({ accounts: [account, account] }, profile)).toThrow();
    expect(
      zernioChannels(
        { accounts: [account, { ...account, _id: other, platform: "facebook" }] },
        profile,
      ),
    ).toHaveLength(1);
  });
  test("reads only fixed-origin GETs and normalizes actual nested post rows without contents", async () => {
    const requests: URL[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(url);
      expect(url.origin).toBe("https://zernio.com");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(url.searchParams.get("profileId")).toBe(profile);
      if (url.pathname.endsWith("/accounts")) return Response.json({ accounts: [account] });
      expect(url.searchParams.get("accountId")).toBe(id);
      expect(url.searchParams.get("source")).toBe("all");
      return Response.json({
        posts: [
          {
            isExternal: true,
            content: "private content must not escape",
            analytics: { likes: 0, views: 99, lastUpdated: "2026-10-18 15:13:29" },
            platforms: [{ platform: "tiktok", accountId: { _id: id }, platformPostId: "200" }],
          },
        ],
        pagination: { page: 1, pages: 1 },
      });
    };
    const { report } = await readZernioReport(
      key,
      profile,
      [id],
      Date.parse("2026-10-19T10:00:00Z"),
      fetcher,
    );
    expect(requests).toHaveLength(2);
    expect(report.fromDate).toBe("2026-07-22");
    expect(report.accounts[0]?.posts[0]?.metrics).toEqual({ likes: 0, views: 99 });
    expect(report.accounts[0]?.posts[0]?.updatedAt).toBe("2026-10-18 15:13:29");
    expect(JSON.stringify(report)).not.toContain("private content");
    expect(JSON.stringify(report)).not.toContain(key);
  });
  test("does not convert account health, missing metrics, foreign posts, or oversized pagination into a zero report", async () => {
    for (const variant of ["health", "metrics", "foreign", "pages"]) {
      const fetcher = async (input: RequestInfo | URL) =>
        String(input).includes("/accounts")
          ? Response.json({ accounts: [{ ...account, needsReconnection: variant === "health" }] })
          : Response.json({
              posts: [
                {
                  isExternal: true,
                  accountId: variant === "foreign" ? other : id,
                  platform: "tiktok",
                  platformPostId: "200",
                  analytics: variant === "metrics" ? {} : { likes: 1 },
                },
              ],
              pagination: { page: 1, pages: variant === "pages" ? 6 : 1 },
            });
      await expect(readZernioReport(key, profile, [id], Date.now(), fetcher)).rejects.toThrow();
    }
  });
  test("a genuine empty publication window stays distinct from missing metrics", async () => {
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).includes("/accounts")
        ? Response.json({ accounts: [account] })
        : Response.json({ posts: [], pagination: { page: 1, pages: 0 } });
    expect(
      (await readZernioReport(key, profile, [id], Date.now(), fetcher)).report.accounts[0]?.posts,
    ).toEqual([]);
  });
  test("closed errors exclude vendor bodies and enforce the bounded reader", async () => {
    for (const [status, reason] of [
      [401, "reauth_required"],
      [403, "access_denied"],
      [429, "rate_limited"],
      [402, "billing_required"],
      [500, "unavailable"],
    ] as const) {
      try {
        await zernioGet(
          key,
          "accounts",
          {},
          async () => new Response("private vendor credentials", { status }),
        );
        throw Error("must reject");
      } catch (error) {
        expect(zernioFailure(error)).toBe(reason);
        expect(String(error)).not.toContain("private");
      }
    }
    await expect(
      zernioGet(key, "accounts", {}, async () => new Response("x".repeat(2_000_001))),
    ).rejects.toThrow("report_too_large");
  });
});
