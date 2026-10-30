// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  read: vi.fn(),
  getDocument: vi.fn(),
  getPage: vi.fn(),
  destroy: vi.fn(),
  render: vi.fn(),
  cancel: vi.fn(),
  textCancel: vi.fn(),
  worker: { workerSrc: "" },
}));
vi.mock("./pdfDocumentLoader", async () => ({
  ...(await vi.importActual<typeof import("./pdfDocumentLoader")>("./pdfDocumentLoader")),
  readPdfBytes: state.read,
}));
vi.mock("pdfjs-dist", () => ({
  version: "6.4.299",
  GlobalWorkerOptions: state.worker,
  getDocument: state.getDocument,
  AnnotationMode: { DISABLE: 0 },
  TextLayer: class {
    constructor(private options: { container: HTMLElement }) {}
    async render() {
      const span = document.createElement("span");
      span.textContent = "Selectable page text";
      this.options.container.append(span);
    }
    cancel = state.textCancel;
  },
}));

import { PdfDocumentViewer } from "./PdfDocumentViewer";
import { PdfPreviewError } from "./pdfDocumentLoader";

let element: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.read.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  state.destroy.mockResolvedValue(undefined);
  state.render.mockImplementation(() => ({ promise: Promise.resolve(), cancel: state.cancel }));
  state.getPage.mockImplementation(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
    }),
    render: state.render,
    getTextContent: async () => ({ items: [] }),
  }));
  state.getDocument.mockImplementation(() => ({
    promise: Promise.resolve({ numPages: 3, getPage: state.getPage, destroy: state.destroy }),
    destroy: state.destroy,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { value: vi.fn(), configurable: true });
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.restoreAllMocks();
});
async function show(url = "https://owned.example/selected") {
  await act(async () => {
    root.render(<PdfDocumentViewer url={url} title="Selected PDF" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(label: string) {
  const button = Array.from(element.querySelectorAll("button")).find(
    (item) => item.getAttribute("aria-label") === label || item.textContent === label,
  );
  expect(button, label).toBeTruthy();
  await act(async () => button?.click());
}

describe("actual PDF page reader", () => {
  it("loads only local versioned support assets with scripting surfaces absent", async () => {
    await show();
    expect(state.worker.workerSrc).toBe("/pdfjs/6.4.299/pdf.worker.min.mjs");
    expect(state.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: new Uint8Array([37, 80, 68, 70]),
        maxImageSize: 16_000_000,
        canvasMaxAreaInBytes: 64_000_000,
        enableXfa: false,
        useWorkerFetch: false,
        cMapUrl: "/pdfjs/6.4.299/cmaps/",
        standardFontDataUrl: "/pdfjs/6.4.299/standard_fonts/",
        wasmUrl: "/pdfjs/6.4.299/wasm/",
      }),
    );
    expect(state.render).toHaveBeenCalledWith(expect.objectContaining({ annotationMode: 0 }));
    expect(element.querySelector("canvas")?.getAttribute("aria-label")).toBe("Page 1 of 3");
    expect(element.textContent).toContain("Selectable page text");
    expect(element.querySelector("iframe,a,form")).toBeNull();
  });

  it("renders only the chosen page, cancels the previous render and keeps page controls bounded", async () => {
    await show();
    await click("Next page");
    expect(state.getPage.mock.calls.map((call) => call[0])).toEqual([1, 2]);
    expect(state.cancel).toHaveBeenCalled();
    expect(state.textCancel).toHaveBeenCalled();
    await click("Next page");
    await click("Next page");
    expect(state.getPage.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
    expect(element.querySelector("canvas")?.getAttribute("aria-label")).toBe("Page 3 of 3");
    await click("Previous page");
    expect(element.querySelector("canvas")?.getAttribute("aria-label")).toBe("Page 2 of 3");
  });

  it("zooms with a bounded raster and resets to fit width", async () => {
    await show();
    await click("Zoom in");
    expect(element.textContent).toContain("125%");
    const canvas = element.querySelector("canvas");
    expect((canvas?.width ?? 0) * (canvas?.height ?? 0)).toBeLessThanOrEqual(16_000_000);
    await click("Fit width");
    expect(element.textContent).toContain("100%");
  });

  it("fits the page to the current reader padding and keeps its controls below the document", async () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingLeft: "14px",
      paddingRight: "14px",
    } as CSSStyleDeclaration);
    await show();
    expect(state.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ viewport: expect.objectContaining({ width: 772 }) }),
    );
    const toolbar = element.querySelector('[role="toolbar"][aria-label="PDF controls"]');
    const page = element.querySelector("[data-pdf-page]");
    expect(page?.compareDocumentPosition(toolbar as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(toolbar?.querySelector('[aria-label="Page number"]')).toBeTruthy();
    expect(toolbar?.querySelector('[aria-label="Fit width"]')).toBeTruthy();
  });

  it("keeps the current page visible when its unchanged number is submitted", async () => {
    await show();
    await act(async () =>
      element
        .querySelector("input")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(element.querySelector("[data-pdf-page]")?.getAttribute("style")).toContain(
      "visibility: visible",
    );
    expect(element.querySelector("[role=status]")).toBeNull();
  });

  it("keeps raster rounding inside the hard pixel cap on a tall high-DPI page", async () => {
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    state.getPage.mockImplementation(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 3000 * scale,
        scale,
      }),
      render: state.render,
      getTextContent: async () => ({ items: [] }),
    }));
    await show();
    for (let index = 0; index < 4; index++) await click("Zoom in");
    const canvas = element.querySelector("canvas");
    expect((canvas?.width ?? 0) * (canvas?.height ?? 0)).toBeLessThanOrEqual(16_000_000);
    expect(canvas?.height).toBeLessThanOrEqual(8192);
  });

  it("aborts and destroys the old document when the selected source changes", async () => {
    await show();
    const firstSignal = state.read.mock.calls[0]?.[1] as AbortSignal;
    await click("Next page");
    await show("https://owned.example/second");
    expect(firstSignal.aborted).toBe(true);
    expect(state.destroy).toHaveBeenCalled();
    expect(state.read.mock.calls.map((call) => call[0])).toEqual([
      "https://owned.example/selected",
      "https://owned.example/second",
    ]);
    expect(element.querySelector("canvas")?.getAttribute("aria-label")).toBe("Page 1 of 3");
    expect(element.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("discards a late first-file response before it reaches the PDF parser", async () => {
    let resolveFirst: (value: Uint8Array) => void = () => {};
    state.read.mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await show();
    await show("https://owned.example/second");
    await act(async () => resolveFirst(new Uint8Array([1])));
    expect(state.getDocument).toHaveBeenCalledOnce();
    expect(state.getDocument.mock.calls[0]?.[0].data).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("states the original byte ceiling and can retry the same source", async () => {
    state.read.mockRejectedValueOnce(new PdfPreviewError("byte_limit"));
    await show();
    expect(element.querySelector("[role=alert]")?.textContent).toContain("32 MB preview limit");
    expect(state.getDocument).not.toHaveBeenCalled();
    await click("Try preview again");
    expect(element.textContent).toContain("Selectable page text");
    expect(state.read.mock.calls.map((call) => call[0])).toEqual([
      "https://owned.example/selected",
      "https://owned.example/selected",
    ]);
  });
});
