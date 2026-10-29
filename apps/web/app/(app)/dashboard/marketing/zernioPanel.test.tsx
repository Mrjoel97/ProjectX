// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ZernioConnect, ZernioMarketing, ZernioReportView } from "./ZernioPanel";

const mocks = vi.hoisted(() => ({
  queries: {} as Record<string, unknown>,
  calls: {} as Record<string, ReturnType<typeof vi.fn>>,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => mocks.queries[getFunctionName(ref)],
  useMutation: (ref: never) =>
    (mocks.calls[getFunctionName(ref)] ??= vi.fn().mockResolvedValue(undefined)),
  useAction: (ref: never) =>
    (mocks.calls[getFunctionName(ref)] ??= vi.fn().mockResolvedValue({ state: "updated" })),
}));
let host: HTMLDivElement, root: Root;
const id = "1234567890abcdef12345679";
beforeEach(() => {
  mocks.queries = {
    "zernio:status": {
      configured: true,
      status: "connected",
      channels: [{ id, name: "Business account", platform: "tiktok", available: true }],
      selectedAccountIds: [id],
      dailyReports: false,
    },
    "zernio:latestReport": null,
  };
  mocks.calls = {};
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
test("report shows true zero and unavailable separately, with lifetime and publisher caveats", async () => {
  await act(async () =>
    root.render(
      <ZernioReportView
        channels={[]}
        report={{
          fromDate: "2026-07-22",
          toDate: "2026-10-19",
          fetchedAt: 1000,
          accounts: [
            {
              accountId: id,
              platform: "tiktok",
              posts: [
                {
                  postId: "200",
                  source: "external",
                  updatedAt: null,
                  metrics: { likes: 0, views: 99 },
                },
              ],
            },
          ],
        }}
      />,
    ),
  );
  expect(host.textContent).toContain("lifetime snapshots");
  expect(host.textContent).toContain("does not identify Buffer");
  const cells = [...host.querySelectorAll("td")].map((e) => e.textContent);
  expect(cells).toEqual(["99", "0", "—", "—", "—"]);
});
test("an empty report window says no posts, without fabricating zero totals", async () => {
  await act(async () =>
    root.render(
      <ZernioReportView
        channels={[]}
        report={{
          fromDate: "2026-07-22",
          toDate: "2026-10-19",
          fetchedAt: 1000,
          accounts: [{ accountId: id, platform: "tiktok", posts: [] }],
        }}
      />,
    ),
  );
  expect(host.textContent).toContain("No posts were returned");
  expect(host.querySelector("table")).toBeNull();
});
test("failed refresh keeps the previous report and labels it as an earlier snapshot", async () => {
  mocks.queries["zernio:status"] = {
    ...(mocks.queries["zernio:status"] as object),
    lastFailure: "rate_limited",
  };
  mocks.queries["zernio:latestReport"] = {
    fromDate: "2026-07-22",
    toDate: "2026-10-19",
    fetchedAt: 1000,
    accounts: [{ accountId: id, platform: "tiktok", posts: [] }],
  };
  await act(async () => root.render(<ZernioMarketing />));
  expect(host.textContent).toContain("earlier snapshot");
  expect(host.textContent).toContain("2026-07-22");
});
test("credentials go only to the one-use HTTP intake; authenticated mutation gets only the profile", async () => {
  mocks.queries["zernio:status"] = {
    configured: true,
    status: "disconnected",
    channels: [],
    selectedAccountIds: [],
    dailyReports: false,
  };
  const begin = vi
    .fn()
    .mockResolvedValue({ url: "https://test.convex.site/zernio/connect?ticket=oneuse" });
  mocks.calls["zernio:beginConnect"] = begin;
  const outbound = vi.fn().mockResolvedValue(Response.json({ connected: true }));
  vi.stubGlobal("fetch", outbound);
  await act(async () => root.render(<ZernioConnect />));
  const form = host.querySelector("form");
  if (!form) throw Error("form missing");
  const profile = "1234567890abcdef12345678",
    key = `zrk_${"a".repeat(64)}`;
  (form.elements.namedItem("profileId") as HTMLInputElement).value = profile;
  (form.elements.namedItem("key") as HTMLInputElement).value = key;
  await act(async () =>
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(begin).toHaveBeenCalledWith({ profileId: profile });
  expect(JSON.stringify(begin.mock.calls)).not.toContain(key);
  expect(outbound.mock.calls[0]?.[1]).toMatchObject({
    method: "POST",
    credentials: "omit",
    redirect: "error",
    body: JSON.stringify({ key }),
  });
  expect((form.elements.namedItem("key") as HTMLInputElement).value).toBe("");
});

test("cached evidence has a readable narrative without another provider request", async () => {
  mocks.queries["zernio:latestReport"] = {
    fromDate: "2026-07-22",
    toDate: "2026-10-19",
    fetchedAt: 1000,
    accounts: [
      {
        accountId: id,
        platform: "tiktok",
        posts: [
          {
            postId: "200",
            source: "external",
            updatedAt: null,
            metrics: { views: 99, likes: 0 },
          },
        ],
      },
    ],
  };
  await act(async () => root.render(<ZernioMarketing />));
  const summary = host.querySelector('[aria-label="Engagement summary"]');
  expect(summary?.textContent).toContain("views: 99");
  expect(summary?.textContent).toContain("likes: 0");
  expect(summary?.textContent).toContain("comments: unavailable");
  expect(summary?.textContent).toContain("cached snapshot is old");
  expect(summary?.textContent).toContain("cannot establish growth");
  expect(mocks.calls["zernioActions:refreshReport"]).not.toHaveBeenCalled();
});
