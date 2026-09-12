// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsView, FunnelRows, MarketingView } from "./MarketingView";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  deactivate: vi.fn(),
  record: vi.fn(),
  loadMore: vi.fn(),
  queryFailure: false,
  artifacts: [] as { id: string; title: string; mimeType: string }[],
}));
vi.mock("convex/react", () => ({
  useQuery: (api: unknown) => {
    const name = getFunctionName(api as never);
    if (name === "funnels:list") {
      if (mocks.queryFailure) throw new Error("offline");
      return { items: [], hasMore: false };
    }
    return name === "gmailAuth:gmailStatus" ? { connected: false } : { configured: true };
  },
  usePaginatedQuery: () => ({
    results: mocks.artifacts,
    status: "CanLoadMore",
    loadMore: mocks.loadMore,
  }),
  useMutation: (api: unknown) => {
    const name = getFunctionName(api as never);
    return name === "funnels:create"
      ? mocks.create
      : name === "funnels:deactivate"
        ? mocks.deactivate
        : mocks.record;
  },
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryFailure = false;
  mocks.artifacts = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
describe("Marketing surface", () => {
  it("exposes one approved Marketing entry through desktop and compact navigation", () => {
    const layout = readFileSync("app/(app)/layout.tsx", "utf8");
    const nav = layout.slice(layout.indexOf("const NAV:"), layout.indexOf("const RAIL_KEY"));
    expect(nav.match(/label: "Marketing"/g)).toHaveLength(1);
    expect(nav).toMatch(/label: "Marketing", href: "\/dashboard\/marketing", icon: <GlobeIcon \/>/);
    const compact = layout.slice(
      layout.indexOf("const TABBAR_HREFS"),
      layout.indexOf("// OPSG-07"),
    );
    expect(compact.match(/"\/dashboard\/marketing"/g)).toHaveLength(1);
    expect(layout).toContain("title={collapsed ? item.label : undefined}");
    expect(
      layout.match(/aria-current=\{isActive\(item.href\) \? "page" : undefined\}/g),
    ).toHaveLength(2);
  });
  it("keeps writes confined to link management and lead capture without model or publisher hooks", () => {
    const source = readFileSync("app/(app)/dashboard/marketing/MarketingView.tsx", "utf8");
    expect(
      [...source.matchAll(/useMutation\(api\.([\w.]+)\)/g)].map((match) => match[1]).sort(),
    ).toEqual(["contacts.recordMarketingLead", "funnels.create", "funnels.deactivate"]);
    expect(source).not.toMatch(
      /\buseAction\b|\bfetch\s*\(|useSendCockpitMessage|api\.(?:gmail|cockpit|media)\./,
    );
  });
  it("creates once and holds secret URLs only until the panel closes", async () => {
    mocks.artifacts = [{ id: "doc", title: "Synthetic file", mimeType: "application/pdf" }];
    mocks.create.mockResolvedValue({
      id: "f",
      token: "synthetic-secret",
      urls: {
        visit: "https://test.convex.site/f/synthetic-secret/visit?s=test",
        claim: "https://test.convex.site/f/synthetic-secret/claim?s=test",
        download: "https://test.convex.site/f/synthetic-secret/download?s=test",
      },
    });
    await act(async () => root.render(<MarketingView />));
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "doc";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const inputs = select.closest("form")!.querySelectorAll("input");
    for (const [index, value] of ["Synthetic", "test"].entries())
      await act(async () => {
        const input = inputs[index];
        if (!input) throw new Error("Expected tracked-link form input");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await act(async () =>
      select
        .closest("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      vaultDocId: "doc",
      title: "Synthetic",
      source: "test",
    });
    expect(host.querySelectorAll("input[readonly]")).toHaveLength(3);
    expect(host.querySelector('a[href*="synthetic-secret"]')).toBeNull();
    expect(host.textContent).toContain("Copy these links now");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Close links")!
        .click(),
    );
    expect(host.querySelectorAll("input[readonly]")).toHaveLength(0);
    expect(host.innerHTML).not.toContain("synthetic-secret");
  });
  it("renders all channels and explicit social gates without fake connections", () => {
    const html = renderToStaticMarkup(<ChannelsView connected={false} configured={true} />);
    for (const name of ["Gmail", "Meta/Instagram", "LinkedIn", "TikTok", "X", "YouTube"])
      expect(html).toContain(name);
    expect(html.match(/legal entity is not formed/g)).toHaveLength(5);
    expect(html.match(/provider suitability and permissions review has not started/g)).toHaveLength(
      5,
    );
    expect(html).toContain("/connect-gmail");
    expect(html).toContain("intent=marketing");
    expect(renderToStaticMarkup(<ChannelsView />)).toContain("Checking connection");
  });
  it("preserves unknown versus zero and full safe integer counts", () => {
    const html = renderToStaticMarkup(
      <FunnelRows
        data={{
          items: [
            {
              id: "f" as never,
              title: "Test",
              source: "test",
              status: "deactivated",
              createdAt: 1,
              deactivatedAt: 2,
              counters: { visits: 9007199254740991, claims: 0, downloads: 2 },
            },
          ],
          hasMore: false,
        }}
        pending={false}
        onDeactivate={() => {}}
      />,
    );
    expect(html).toContain("9007199254740991");
    expect(html).toContain("Claims: 0");
    expect(html).toContain("bots and retries");
    expect(renderToStaticMarkup(<FunnelRows pending={false} onDeactivate={() => {}} />)).toContain(
      "Loading tracked links",
    );
  });
  it("allows paging past an empty filtered artifact page and does not submit", async () => {
    await act(async () => root.render(<MarketingView />));
    const button = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Load more files",
    )!;
    await act(async () => button.click());
    expect(mocks.loadMore).toHaveBeenCalledWith(25);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("captures without implied consent and truthfully displays suppression", async () => {
    mocks.record.mockResolvedValue({ reason: "suppressed" });
    await act(async () => root.render(<MarketingView />));
    const email = host.querySelector<HTMLInputElement>('input[name="email"]')!;
    email.value = "synthetic@example.test";
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    const form = email.closest("form")!;
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mocks.record).toHaveBeenCalledWith({
      email: "synthetic@example.test",
      name: undefined,
      company: undefined,
    });
    expect(host.textContent).toContain("Suppressed: outbound email remains blocked.");
  });
  it("keeps lead and channel sections available when links fail", async () => {
    mocks.queryFailure = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => root.render(<MarketingView />));
    expect(host.textContent).toContain("This section could not load");
    expect(host.querySelector('input[name="email"]')).not.toBeNull();
    expect(host.textContent).toContain("TikTok");
    log.mockRestore();
  });
  it("requires explicit deactivation confirmation", async () => {
    const deactivate = vi.fn();
    await act(async () =>
      root.render(
        <FunnelRows
          data={{
            items: [
              {
                id: "f" as never,
                title: "Test",
                source: "test",
                status: "active",
                createdAt: 1,
                deactivatedAt: null,
                counters: null,
              },
            ],
            hasMore: false,
          }}
          pending={false}
          onDeactivate={deactivate}
        />,
      ),
    );
    await act(async () => host.querySelector("button")!.click());
    expect(deactivate).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Visits: —");
    await act(async () => host.querySelector("button")!.click());
    expect(deactivate).toHaveBeenCalledWith("f");
  });
});
