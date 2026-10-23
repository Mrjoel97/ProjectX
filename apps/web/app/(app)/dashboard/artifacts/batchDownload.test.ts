// @vitest-environment jsdom
import { Blob as NativeBlob } from "node:buffer";
import { strFromU8, unzipSync } from "@pikar/vault/archive";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type BatchDownloadManifest, downloadOwnedBatch } from "./batchDownload";

const { limit } = vi.hoisted(() => ({ limit: 16 * 1024 }));
// Exercise real stream/ZIP admission with small real buffers, not 200MiB allocations in CI.
vi.mock("./originalDownload", async (original) => ({
  ...(await original<typeof import("./originalDownload")>()),
  ORIGINAL_DOWNLOAD_MAX_BYTES: limit,
}));

const source = "https://storage.example.test/owned/";
const manifest = (): BatchDownloadManifest => ({
  title: "Refill campaign",
  total: 3,
  entries: [
    {
      index: 2,
      label: "A calmer routine",
      kind: "video",
      url: `${source}video`,
      captioned: true,
      musicCredit: "Clean Soul — Kevin MacLeod (CC BY 4.0)",
    },
    { index: 0, label: "../../Hero image", kind: "image", url: `${source}image`, captioned: false },
  ],
  omitted: [
    { index: 1, label: "Kitchen detail", status: "needs_reconciliation", reason: "not_ready" },
  ],
});
const videoEntry = manifest().entries[0];
const imageEntry = manifest().entries[1];
if (!videoEntry || !imageEntry) throw new Error("Missing batch fixtures");
let blobs: Blob[];
let filenames: string[];
const revoke = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  blobs = [];
  filenames = [];
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL(blob: Blob) {
        blobs.push(blob);
        return "blob:batch";
      }
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filenames.push(this.download);
  });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("stores exact originals with safe unique names, partial disclosure and credits without capabilities", async () => {
  const image = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const video = new Uint8Array([0, 255, 14, 10, 93]);
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response(image, { headers: { "content-type": "image/svg+xml" } }))
    .mockResolvedValueOnce(new Response(video, { headers: { "content-type": "video/mp4" } }));
  const progress = vi.fn();
  const controller = new AbortController();
  await downloadOwnedBatch(manifest(), controller.signal, progress);
  expect(filenames).toEqual(["media-batch.zip"]);
  expect(document.querySelector("a")).toBeNull();
  const blob = blobs[0];
  if (!blob) throw new Error("Missing archive");
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(Object.keys(files)).toEqual(["01-image.svg", "03-video-captioned.mp4", "README.txt"]);
  expect(Array.from(files["01-image.svg"] ?? [])).toEqual(Array.from(image));
  expect(Array.from(files["03-video-captioned.mp4"] ?? [])).toEqual(Array.from(video));
  const note = strFromU8(files["README.txt"] ?? new Uint8Array());
  expect(note).toContain("2 of 3 outputs available");
  expect(note).toContain("Kitchen detail — needs reconciliation (not ready when download started)");
  expect(note).toContain("Clean Soul — Kevin MacLeod (CC BY 4.0)");
  expect(note).not.toContain(source);
  expect(progress).toHaveBeenLastCalledWith({
    completed: 2,
    total: 2,
    bytes: image.byteLength + video.byteLength,
  });
  expect(fetch).toHaveBeenNthCalledWith(1, `${source}image`, {
    signal: controller.signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    `${source}video`,
    expect.objectContaining({ credentials: "omit" }),
  );
  expect(revoke).not.toHaveBeenCalled();
  controller.abort();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:batch");
});

test.each([
  { ...manifest(), total: 16 },
  { ...manifest(), entries: [] },
  { ...manifest(), entries: [{ ...videoEntry, index: 1 }] },
  {
    ...manifest(),
    entries: [{ ...videoEntry, url: "javascript:alert(1)" }, imageEntry],
  },
])("refuses invalid or oversized manifests before fetch", async (input) => {
  await expect(downloadOwnedBatch(input, new AbortController().signal)).rejects.toMatchObject({
    code: "invalid_manifest",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(filenames).toEqual([]);
});

test("does not save a partial archive when a later original becomes unavailable", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response(new Uint8Array([1])))
    .mockResolvedValueOnce(new Response("gone", { status: 404 }));
  await expect(downloadOwnedBatch(manifest(), new AbortController().signal)).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(blobs).toEqual([]);
});

test("checks aggregate declared size, cancels the response and never saves", async () => {
  const body = new ReadableStream();
  const cancel = vi.spyOn(body, "cancel");
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response(new Uint8Array([1])))
    .mockResolvedValueOnce(new Response(body, { headers: { "content-length": String(limit) } }));
  await expect(downloadOwnedBatch(manifest(), new AbortController().signal)).rejects.toMatchObject({
    code: "byte_limit",
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(blobs).toEqual([]);
});

test("counts actual streamed bytes when content length is absent", async () => {
  const cancel = vi.fn();
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response(new Uint8Array([1])))
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(limit));
          },
          cancel,
        }),
      ),
    );
  await expect(downloadOwnedBatch(manifest(), new AbortController().signal)).rejects.toMatchObject({
    code: "byte_limit",
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(blobs).toEqual([]);
});

test("includes ZIP headers and README in the output ceiling", async () => {
  const input = manifest();
  input.total = 1;
  input.entries = [imageEntry];
  input.omitted = [];
  vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(1)));
  await downloadOwnedBatch(input, new AbortController().signal);
  const baseline = blobs[0];
  if (!baseline) throw new Error("Missing reference archive");
  // STORE's metadata size is unchanged: this input fits with README, but the final ZIP
  // is exactly one byte over the ceiling. It must fail even if input admission passes.
  const dataSize = limit - (baseline.size - 1) + 1;
  blobs = [];
  filenames = [];
  vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(dataSize)));
  await expect(downloadOwnedBatch(input, new AbortController().signal)).rejects.toMatchObject({
    code: "byte_limit",
  });
  expect(blobs).toEqual([]);
});

test("cancels a late response and never fetches the next item or creates a ZIP", async () => {
  let settle!: (value: Response) => void;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = downloadOwnedBatch(manifest(), controller.signal);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  controller.abort();
  const late = new Response(new Uint8Array([1]));
  if (!late.body) throw new Error("Missing body");
  const cancel = vi.spyOn(late.body, "cancel");
  settle(late);
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(blobs).toEqual([]);
});

test("starts no second fetch while the first file is still streaming", async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
        }),
      ),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array([3])));
  const pending = downloadOwnedBatch(manifest(), new AbortController().signal);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  stream.enqueue(new Uint8Array([1, 2]));
  expect(fetch).toHaveBeenCalledTimes(1);
  stream.close();
  await pending;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(filenames).toEqual(["media-batch.zip"]);
});
