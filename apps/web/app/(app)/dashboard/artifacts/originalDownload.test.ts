// @vitest-environment jsdom
import { Blob as NativeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadOwnedOriginal, ORIGINAL_DOWNLOAD_MAX_BYTES } from "./originalDownload";

const source = "http://127.0.0.1:3340/api/storage/owned-original";
let clicked: { href: string; filename: string }[];
let blobs: Blob[];
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  clicked = [];
  blobs = [];
  createObjectURL.mockImplementation((blob: Blob) => {
    blobs.push(blob);
    return "blob:local-original";
  });
  vi.stubGlobal("Blob", NativeBlob);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, filename: this.download });
  });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const response = (bytes = new Uint8Array([37, 80, 68, 70, 0, 255])) =>
  new Response(bytes, { headers: { "content-type": "application/pdf" } });

describe("authorized original downloads", () => {
  it("downloads exact bytes through a local Blob URL without navigating to cross-origin storage", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
    vi.mocked(fetch).mockResolvedValue(response(bytes));
    const controller = new AbortController();
    await downloadOwnedOriginal(source, "Original report.pdf", controller.signal);
    expect(fetch).toHaveBeenCalledWith(source, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(bytes);
    expect(clicked).toEqual([{ href: "blob:local-original", filename: "Original report.pdf" }]);
    expect(document.querySelector("a")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:local-original");
  });
  it("refuses an unavailable original without triggering a download", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("denied", { status: 403 }));
    await expect(
      downloadOwnedOriginal(source, "report.pdf", new AbortController().signal),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toEqual([]);
  });
  it("cancels a declared file above the existing 200MiB file policy", async () => {
    const body = new ReadableStream();
    const cancel = vi.spyOn(body, "cancel");
    vi.mocked(fetch).mockResolvedValue(
      new Response(body, {
        headers: { "content-length": String(ORIGINAL_DOWNLOAD_MAX_BYTES + 1) },
      }),
    );
    await expect(
      downloadOwnedOriginal(source, "film.mp4", new AbortController().signal),
    ).rejects.toMatchObject({ code: "byte_limit" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it("enforces streamed size even without an honest content length", async () => {
    const chunk = new Uint8Array(1);
    Object.defineProperty(chunk, "byteLength", { value: ORIGINAL_DOWNLOAD_MAX_BYTES + 1 });
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
      },
      cancel,
    });
    vi.mocked(fetch).mockResolvedValue(new Response(body));
    await expect(
      downloadOwnedOriginal(source, "film.mp4", new AbortController().signal),
    ).rejects.toMatchObject({ code: "byte_limit" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(clicked).toEqual([]);
  });
  it("ignores a late fetch response after the selection was cancelled", async () => {
    let settle!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const controller = new AbortController();
    const pending = downloadOwnedOriginal(source, "old.pdf", controller.signal);
    controller.abort();
    const late = response();
    if (!late.body) throw new Error("Expected a streamed original fixture");
    const cancel = vi.spyOn(late.body, "cancel");
    settle(late);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it("cancels a late streamed chunk and never downloads after abort", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const cancelled = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
          cancel: cancelled,
        }),
      ),
    );
    const controller = new AbortController();
    const pending = downloadOwnedOriginal(source, "old.pdf", controller.signal);
    await Promise.resolve();
    controller.abort();
    stream.enqueue(new Uint8Array([1, 2]));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it("releases a completed object's URL on selection change without double revocation", async () => {
    vi.mocked(fetch).mockResolvedValue(response());
    const controller = new AbortController();
    await downloadOwnedOriginal(source, "report.pdf", controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:local-original");
  });
});
