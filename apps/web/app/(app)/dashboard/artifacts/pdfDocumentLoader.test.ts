import { afterEach, describe, expect, it, vi } from "vitest";
import { PDF_PREVIEW_MAX_BYTES, PdfPreviewError, readPdfBytes } from "./pdfDocumentLoader";

afterEach(() => vi.unstubAllGlobals());

describe("selected PDF byte admission", () => {
  it("reads streamed original bytes without cookies or referrer", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([37, 80]));
            controller.enqueue(new Uint8Array([68, 70]));
            controller.close();
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await readPdfBytes("https://owned.example/selected", signal)).toEqual(
      new Uint8Array([37, 80, 68, 70]),
    );
    expect(fetcher).toHaveBeenCalledWith("https://owned.example/selected", {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  });

  it("cancels a declared oversize original before reading it", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream({ cancel }), {
          headers: { "content-length": String(PDF_PREVIEW_MAX_BYTES + 1) },
        }),
      ),
    );
    await expect(readPdfBytes("selected", new AbortController().signal)).rejects.toMatchObject({
      code: "byte_limit",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("also cancels when actual streamed bytes exceed an absent or misleading length", async () => {
    const cancel = vi.fn();
    let sent = false;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            pull(controller) {
              if (!sent) {
                sent = true;
                controller.enqueue(new Uint8Array(PDF_PREVIEW_MAX_BYTES + 1));
              }
            },
            cancel,
          }),
          { headers: { "content-length": "12" } },
        ),
      ),
    );
    await expect(readPdfBytes("selected", new AbortController().signal)).rejects.toMatchObject({
      code: "byte_limit",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("refuses unsuccessful or bodyless responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null));
    vi.stubGlobal("fetch", fetcher);
    await expect(readPdfBytes("selected", new AbortController().signal)).rejects.toBeInstanceOf(
      PdfPreviewError,
    );
    await expect(readPdfBytes("selected", new AbortController().signal)).rejects.toMatchObject({
      code: "load_failed",
    });
  });

  it("passes aborts through without retrying another file", async () => {
    const failure = new DOMException("Cancelled", "AbortError");
    const fetcher = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", fetcher);
    await expect(readPdfBytes("selected", new AbortController().signal)).rejects.toBe(failure);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
