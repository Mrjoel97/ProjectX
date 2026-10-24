// @vitest-environment jsdom
import { getFunctionName } from "convex/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  campaign: null as unknown,
  downloads: vi.fn(),
  manifests: vi.fn(),
  batchDownload: vi.fn(),
  openPlan: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: fixture.manifests }),
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
vi.mock("../artifacts/batchDownload", () => ({
  downloadOwnedBatch: fixture.batchDownload,
  BatchDownloadError: class extends Error {
    constructor(public readonly code: "byte_limit" | "unavailable" | "invalid_manifest") {
      super(code);
    }
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

import { BatchDownloadError } from "../artifacts/batchDownload";
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
const manifest = () => ({
  campaignId: "campaign1",
  threadId: "chat",
  title: "Launch collection",
  total: 3,
  entries: [
    {
      index: 0,
      label: "Cover",
      kind: "image",
      url: "https://owned.invalid/image",
      captioned: false,
    },
    { index: 1, label: "Reel", kind: "video", url: "https://owned.invalid/video", captioned: true },
  ],
  omitted: [{ index: 2, label: "Retry me", status: "failed", reason: "not_completed" }],
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.campaign = campaign();
  fixture.downloads.mockClear();
  fixture.openPlan.mockClear();
  fixture.manifests.mockReset().mockResolvedValue(manifest());
  fixture.batchDownload.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(campaignId = "campaign1", threadId = "chat") {
  await act(async () =>
    root.render(
      <CampaignCollection
        campaignId={campaignId as never}
        threadId={threadId}
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
  expect(fixture.manifests).not.toHaveBeenCalled();
});

test("ZIP URLs are resolved only after an explicit download, with exact campaign and chat", async () => {
  await render();
  expect(fixture.manifests).not.toHaveBeenCalled();
  expect(fixture.batchDownload).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Download ready files (2)");
  expect(host.textContent).toContain("ZIP · 200 MiB max");
  await click("Download ready files");
  expect(getFunctionName(fixture.manifests.mock.calls[0]?.[0])).toBe(
    "mediaCampaign:downloadManifest",
  );
  expect(fixture.manifests.mock.calls[0]?.[1]).toEqual({
    campaignId: "campaign1",
    threadId: "chat",
  });
  expect(fixture.batchDownload.mock.calls[0]?.[0]).toEqual(manifest());
  expect(host.querySelector('[role="status"]')?.textContent).toContain("2 files");
  expect(host.textContent).toContain("1 item was omitted");
});

test("a batch with no completed files cannot request a ZIP manifest", async () => {
  fixture.campaign = campaign(false);
  await render();
  const button = [...host.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Download ready files (0)"),
  );
  expect(button?.disabled).toBe(true);
  await act(async () => button?.click());
  expect(fixture.manifests).not.toHaveBeenCalled();
  expect(fixture.batchDownload).not.toHaveBeenCalled();
});

test("succeeded status alone does not enable an unavailable original ZIP", async () => {
  const snapshot = campaign();
  for (const item of snapshot.items) item.downloadable = false;
  fixture.campaign = snapshot;
  await render();
  const button = [...host.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Download ready files (0)"),
  );
  expect(button?.disabled).toBe(true);
  await act(async () => button?.click());
  expect(fixture.manifests).not.toHaveBeenCalled();
});

test("ZIP progress stays in the batch and cancellation stops work and ignores its late failure", async () => {
  let signal: AbortSignal | undefined;
  let reject: ((error: Error) => void) | undefined;
  fixture.batchDownload.mockImplementation((_snapshot, value, onProgress) => {
    signal = value;
    onProgress({ completed: 1, total: 2, bytes: 1024 * 1024 });
    return new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
  });
  await render();
  await click("Download ready files");
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    "Downloading file 2 of 2 · 1.0 MiB",
  );
  await click("Cancel ZIP");
  expect(signal?.aborted).toBe(true);
  await act(async () => reject?.(new Error("late fetch failure")));
  expect(host.textContent).toContain("ZIP download cancelled");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test("cancelling a pending manifest prevents its late response from starting any fetch", async () => {
  let resolve: ((value: ReturnType<typeof manifest>) => void) | undefined;
  fixture.manifests.mockImplementation(
    () =>
      new Promise((accept) => {
        resolve = accept;
      }),
  );
  await render();
  await click("Download ready files");
  await click("Cancel ZIP");
  await act(async () => resolve?.(manifest()));
  expect(fixture.batchDownload).not.toHaveBeenCalled();
  expect(host.textContent).toContain("ZIP download cancelled");
});

test.each([
  ["campaign2", "chat"],
  ["campaign1", "other-chat"],
])("changing the selected scope aborts a ZIP: %s/%s", async (campaignId, threadId) => {
  let signal: AbortSignal | undefined;
  let finish: (() => void) | undefined;
  fixture.batchDownload.mockImplementation((_snapshot, value) => {
    signal = value;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  await render();
  await click("Download ready files");
  await render(campaignId, threadId);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish?.());
  expect(host.textContent).not.toContain("ZIP download started");
  expect(host.textContent).not.toContain("Preparing ZIP");
});

test("unmounting or losing the campaign aborts an active ZIP", async () => {
  let signal: AbortSignal | undefined;
  fixture.batchDownload.mockImplementation((_snapshot, value) => {
    signal = value;
    return new Promise<void>(() => {});
  });
  await render();
  await click("Download ready files");
  fixture.campaign = null;
  await render();
  expect(signal?.aborted).toBe(true);
  fixture.campaign = campaign();
  await render();
  await click("Download ready files");
  const mountedSignal = signal;
  await act(async () => root.render(null));
  expect(mountedSignal?.aborted).toBe(true);
});

test("a failed or oversized ZIP explains the result and retry resolves a fresh manifest", async () => {
  fixture.batchDownload.mockRejectedValueOnce(new BatchDownloadError("byte_limit"));
  await render();
  await click("Download ready files");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("200 MiB limit");
  await click("Download ready files");
  expect(fixture.manifests).toHaveBeenCalledTimes(2);
  expect(fixture.batchDownload).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  fixture.batchDownload.mockRejectedValueOnce(new Error("failed original"));
  await click("Download ready files");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("No partial ZIP was saved");
});

test.each([
  null,
  { ...manifest(), threadId: "other-chat" },
  { ...manifest(), entries: [] },
])("unavailable, mismatched or empty fresh manifests never start a ZIP", async (snapshot) => {
  fixture.manifests.mockResolvedValueOnce(snapshot);
  await render();
  await click("Download ready files");
  expect(fixture.batchDownload).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
