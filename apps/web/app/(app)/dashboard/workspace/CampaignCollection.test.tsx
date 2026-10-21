// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  campaign: null as unknown,
  downloads: vi.fn(),
  openPlan: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (getFunctionName(ref) === "mediaCampaign:byId") return fixture.campaign;
    if (getFunctionName(ref) === "mediaCampaign:download") {
      fixture.downloads(args);
      return args === "skip" ? undefined : "https://owned.invalid/selected";
    }
    throw new Error("Unexpected query");
  },
  useMutation: () => {
    throw new Error("Browsing may not generate");
  },
}));
vi.mock("../artifacts/ArtifactViewer", () => ({
  ArtifactViewerBody: ({ artifact }: { artifact: { id: string; mimeType: string } }) => (
    <div data-selected={artifact.id}>{artifact.mimeType}</div>
  ),
}));
vi.mock("./MediaCampaign", () => ({
  CampaignCard: () => <button type="button">Approval controls</button>,
}));

import { CampaignCollection } from "./CampaignCollection";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const campaign = (ready = true) => ({
  _id: "campaign1",
  title: "Launch collection",
  cancelled: false,
  items: [
    {
      planId: "image1",
      label: "Cover",
      kind: "image",
      status: ready ? "succeeded" : "running",
      downloadable: ready,
    },
    {
      planId: "video2",
      label: "Reel",
      kind: "video",
      status: ready ? "succeeded" : "ready",
      downloadable: ready,
    },
    { planId: "failed3", label: "Retry me", kind: "image", status: "failed", downloadable: false },
  ],
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.campaign = campaign();
  fixture.downloads.mockClear();
  fixture.openPlan.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <CampaignCollection
        campaignId={"campaign1" as never}
        threadId="chat"
        onOpenPlan={fixture.openPlan}
      />,
    ),
  );
}
async function click(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(text),
  );
  if (!node) throw new Error(`Missing ${text}`);
  await act(async () => node.click());
}
test("one batch tab browses images and videos without mounting a long stack of previews", async () => {
  await render();
  expect(host.querySelectorAll("[data-selected]")).toHaveLength(1);
  expect(host.textContent).toContain("image/png");
  await click("Next");
  expect(host.querySelector("[data-selected]")?.getAttribute("data-selected")).toBe("video2");
  expect(host.textContent).toContain("video/mp4");
  await click("Open production plan");
  expect(fixture.openPlan).toHaveBeenCalledWith("video2");
  await click("Retry me");
  expect(host.querySelector("[data-selected]")).toBeNull();
  expect(host.textContent).toContain("Needs attention");
  expect(
    fixture.downloads.mock.calls.some(([args]) => args !== "skip" && args.itemIndex === 2),
  ).toBe(false);
});
test("completed output does not replace production controls while the user is using them", async () => {
  fixture.campaign = campaign(false);
  await render();
  const control = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === "Approval controls",
  );
  if (!control) throw new Error("Missing production control");
  await act(async () => control.focus());
  fixture.campaign = campaign(true);
  await render();
  expect(host.textContent).toContain("Approval controls");
  expect(host.querySelector("[data-selected]")).toBeNull();
  await click("Gallery");
  expect(host.querySelectorAll("[data-selected]")).toHaveLength(1);
});
test("a collection unavailable to this chat never requests a media URL", async () => {
  fixture.campaign = null;
  await render();
  expect(host.textContent).toContain("unavailable in this conversation");
  expect(fixture.downloads.mock.calls.every(([args]) => args === "skip")).toBe(true);
});
