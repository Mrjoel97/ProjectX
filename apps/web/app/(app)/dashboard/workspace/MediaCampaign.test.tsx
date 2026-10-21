// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  campaigns: [] as unknown[],
  mutations: [] as { name: string; args: unknown }[],
  downloads: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => (args === "skip" ? undefined : state.campaigns),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => async (args: unknown) => {
    state.mutations.push({ name: getFunctionName(ref), args });
    return { ok: true };
  },
  useConvex: () => ({
    query: async (_ref: unknown, args: unknown) => {
      state.downloads.push(args);
      return "https://owned.example/image.png";
    },
  }),
}));

import { MediaCampaign } from "./MediaCampaign";

function fixture(status = "draft") {
  return {
    id: "campaign",
    threadId: "current-thread",
    title: "Product launch",
    status,
    updatedAt: 100,
    reviewHash: "review-hash",
    maxCostCents: 100,
    reservedCents: status === "draft" ? 0 : 20,
    nextMaximumCents: 20,
    cancelled: false,
    items: [
      {
        planId: "private-image",
        kind: "image",
        label: "Hero image",
        status: status === "draft" ? "ready" : "succeeded",
        estimateCents: 20,
        refusal: null,
        failureReason: null,
        downloadable: status !== "draft",
      },
    ],
  };
}
beforeEach(() => {
  state.campaigns = [fixture()];
  state.mutations = [];
  state.downloads = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => vi.unstubAllGlobals());

test("reviewing a campaign displays its maximum without generating or minting download URLs", () => {
  const html = renderToStaticMarkup(<MediaCampaign threadId="current-thread" />);
  expect(html).toContain("Approve and generate campaign");
  expect(html).toContain("$0.20");
  expect(html).toContain("does not publish");
  expect(html).toContain("thread=current-thread&amp;plan=private-image");
  expect(state.mutations).toEqual([]);
  expect(state.downloads).toEqual([]);
  expect(renderToStaticMarkup(<MediaCampaign threadId={null} />)).toBe("");
});

test("only the explicit approval click reserves generation against the displayed revision", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MediaCampaign threadId="current-thread" />));
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Approve and generate campaign",
    );
    expect(button).toBeTruthy();
    await act(async () => button?.click());
    expect(state.mutations).toEqual([
      {
        name: "mediaCampaign:approve",
        args: {
          campaignId: "campaign",
          expectedUpdatedAt: 100,
          expectedReviewHash: "review-hash",
          maxCostCents: 100,
        },
      },
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});

test("a completed image mints one owned URL only when its download is requested", async () => {
  state.campaigns = [fixture("complete")];
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MediaCampaign threadId="current-thread" />));
    expect(state.downloads).toEqual([]);
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === "Prepare image download",
    );
    await act(async () => button?.click());
    expect(state.downloads).toEqual([{ campaignId: "campaign", itemIndex: 0 }]);
    const link = [...container.querySelectorAll("a")].find(
      (item) => item.textContent === "Download image",
    );
    expect(link?.href).toBe("https://owned.example/image.png");
    expect(state.mutations).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});
