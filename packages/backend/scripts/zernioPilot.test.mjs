import assert from "node:assert/strict";
import { test } from "node:test";
import { zernioMetrics, zernioPilotAccounts, zernioPilotPage } from "../../core/src/zernioPilot.ts";
import { runZernioPilot, safePilotError, serveZernioPilot } from "./zernioPilot.mjs";

const profileId = "1234567890abcdef12345678";
const instagram = "1234567890abcdef12345679";
const tiktok = "1234567890abcdef12345670";
const key = `zrk_${"a".repeat(64)}`;
const accounts = [
  { _id: instagram, profileId, platform: "instagram", isActive: true },
  { _id: tiktok, profileId, platform: "tiktok", isActive: true },
];
const post = (accountId, platform, id) => ({
  platform,
  accountId,
  isExternal: true,
  platformPostId: id,
  analytics: { likes: 0, views: 12, lastUpdated: "2026-10-18T12:00:00Z" },
});

test("normalization preserves actual zeros, excludes missing metrics and rejects unsafe responses", () => {
  assert.deepEqual(zernioMetrics({ likes: 0, views: null }), { likes: 0 });
  for (const v of [-1, NaN, Infinity, "0"]) assert.throws(() => zernioMetrics({ likes: v }));
  assert.throws(() => zernioPilotAccounts({ accounts: [...accounts, accounts[0]] }, profileId));
  assert.throws(() =>
    zernioPilotAccounts({ accounts: [{ ...accounts[0], platform: "twitter" }] }, profileId),
  );
  assert.throws(() =>
    zernioPilotAccounts({ accounts: [{ ...accounts[0], profileId: tiktok }] }, profileId),
  );
  assert.throws(() =>
    zernioPilotPage(
      { posts: [post(tiktok, "instagram", "1")], pagination: { page: 1, pages: 1 } },
      instagram,
      "instagram",
      1,
    ),
  );
  assert.throws(() =>
    zernioPilotPage({ posts: [], pagination: { page: 1, pages: 6 } }, instagram, "instagram", 1),
  );
});

test("pilot reads only the selected profile/accounts and requires an exact external Buffer post match", async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), method: init.method });
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(url.origin, "https://zernio.com");
    if (url.pathname.endsWith("/auth/verify")) return Response.json({ valid: true });
    assert.equal(url.searchParams.get("profileId"), profileId);
    if (url.pathname.endsWith("/accounts")) return Response.json({ accounts });
    assert.equal(url.pathname, "/api/v1/analytics");
    assert.equal(url.searchParams.get("source"), "all");
    assert.equal(url.searchParams.get("fromDate"), "2026-07-22");
    assert.equal(url.searchParams.get("toDate"), "2026-10-19");
    const id = url.searchParams.get("accountId");
    assert.ok([instagram, tiktok].includes(id));
    return Response.json({
      posts: [
        post(id, id === instagram ? "instagram" : "tiktok", id === instagram ? "100" : "200"),
      ],
      pagination: { page: 1, pages: 1 },
    });
  };
  const result = await runZernioPilot({
    key,
    profileId,
    bufferPostIds: ["200"],
    fetcher,
    now: Date.parse("2026-10-19T12:00:00Z"),
  });
  assert.equal(result.complete, true);
  assert.equal(result.bufferMatchCount, 1);
  assert.equal(requests.length, 4);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(!JSON.stringify(result).includes(profileId));
  assert.deepEqual(result.accounts[0].metrics[0].metrics, { likes: 0, views: 12 });
  const incomplete = await runZernioPilot({
    key,
    profileId,
    fetcher,
    now: Date.parse("2026-10-19T12:00:00Z"),
  });
  assert.equal(incomplete.complete, false);
});

test("account failure stays unavailable, with no provider-body disclosure or write retry", async () => {
  const fetcher = async (url) => {
    if (url.pathname.endsWith("/auth/verify")) return Response.json({ valid: true });
    if (url.pathname.endsWith("/accounts")) return Response.json({ accounts });
    return new Response("private vendor content", { status: 403 });
  };
  const result = await runZernioPilot({ key, profileId, fetcher });
  assert.equal(result.complete, false);
  assert.ok(result.accounts.every((a) => a.state === "ZERNIO_ACCESS_DENIED"));
  assert.ok(!JSON.stringify(result).includes("private vendor content"));
  assert.equal(safePilotError(new Error(key)), "ZERNIO_PILOT_FAILED");
});

test("empty metrics, inactive accounts and two accounts of one platform cannot qualify the pilot", async () => {
  for (const scenario of ["empty", "inactive", "same_platform"]) {
    const scoped = accounts.map((a) => ({
      ...a,
      isActive: scenario !== "inactive",
      platform: scenario === "same_platform" ? "instagram" : a.platform,
    }));
    const result = await runZernioPilot({
      key,
      profileId,
      bufferPostIds: ["200"],
      fetcher: async (url) => {
        if (url.pathname.endsWith("/auth/verify")) return Response.json({ valid: true });
        if (url.pathname.endsWith("/accounts")) return Response.json({ accounts: scoped });
        const account = scoped.find((a) => a._id === url.searchParams.get("accountId"));
        return Response.json({
          posts: [
            {
              ...post(account._id, account.platform, "200"),
              analytics: scenario === "empty" ? {} : { likes: 0 },
            },
          ],
          pagination: { page: 1, pages: 1 },
        });
      },
    });
    assert.equal(result.complete, false, scenario);
    if (scenario === "empty")
      assert.ok(result.accounts.every((a) => a.state === "metrics_unavailable"));
  }
});

test("combined post rows use only the selected account metrics, never the shared aggregate", () => {
  const own = {
    platform: "tiktok",
    accountId: { _id: tiktok },
    platformPostId: "200",
    analytics: { likes: 5, views: 100 },
  };
  const other = {
    platform: "instagram",
    accountId: instagram,
    platformPostId: "300",
    analytics: { likes: 20 },
  };
  const page = {
    posts: [{ isExternal: false, analytics: { likes: 999 }, platforms: [own, other] }],
    pagination: { page: 1, pages: 1 },
  };
  const result = zernioPilotPage(page, tiktok, "tiktok", 1);
  assert.equal(result.metrics.length, 1);
  assert.equal(result.metrics[0].source, "zernio");
  assert.deepEqual(result.metrics[0].metrics, { likes: 5, views: 100 });
  assert.throws(() =>
    zernioPilotPage(
      {
        ...page,
        posts: [{ ...page.posts[0], platforms: [{ ...own, analytics: undefined }, other] }],
      },
      tiktok,
      "tiktok",
      1,
    ),
  );
});

test("local intake is one-use, origin checked and never echoes a key", async () => {
  let calls = 0;
  const { server, url } = await serveZernioPilot({
    profileId,
    port: 0,
    run: async (input) => {
      calls++;
      assert.equal(input.key, key);
      return { complete: false };
    },
  });
  try {
    const page = await fetch(url);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.ok((await page.text()).includes('type="password"'));
    const bad = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://other.example",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ key }),
    });
    assert.equal(bad.status, 403);
    assert.equal(calls, 0);
    const options = {
      method: "POST",
      headers: { Origin: new URL(url).origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key }),
    };
    const good = await fetch(url, options);
    assert.equal(good.status, 200);
    assert.ok(!(await good.text()).includes(key));
    assert.equal(calls, 1);
    assert.equal((await fetch(url, options)).status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
