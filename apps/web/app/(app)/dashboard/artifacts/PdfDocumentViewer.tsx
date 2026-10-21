"use client";

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import styles from "./artifactViewer.module.css";
import { PDF_PREVIEW_MAX_CANVAS_PIXELS, PdfPreviewError, readPdfBytes } from "./pdfDocumentLoader";

const PDFJS_VERSION = "6.4.299";
const assets = `/pdfjs/${PDFJS_VERSION}/`;

export function PdfDocumentViewer({
  url,
  title,
  onDownload,
}: {
  url: string;
  title: string;
  onDownload?: () => void | Promise<void>;
}) {
  const [document, setDocument] = useState<{ url: string; pdf: PDFDocumentProxy } | null>(null);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(720);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const pdf = document?.url === url ? document.pdf : null;

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(200, element.clientWidth - 48));
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    void retry; // A user retry reloads this same selected source without changing its URL.
    const controller = new AbortController();
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    setDocument(null);
    setPage(1);
    setPageInput("1");
    setZoom(1);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [bytes, library] = await Promise.all([
          readPdfBytes(url, controller.signal),
          import("pdfjs-dist"),
        ]);
        if (!active) return;
        if (library.version !== PDFJS_VERSION) throw new Error("PDF viewer version mismatch");
        library.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
        task = library.getDocument({
          data: bytes,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
          // Per-image admission and worker resize threshold, not a total worker-memory sandbox.
          maxImageSize: PDF_PREVIEW_MAX_CANVAS_PIXELS,
          canvasMaxAreaInBytes: PDF_PREVIEW_MAX_CANVAS_PIXELS * 4,
          enableXfa: false,
          useWorkerFetch: false,
          disableAutoFetch: true,
          disableStream: true,
        });
        // Canvas and text only. We do not instantiate scripting, forms or external-link annotations.
        const loaded = await task.promise;
        if (!active) {
          await task.destroy();
          return;
        }
        setDocument({ url, pdf: loaded });
      } catch (failure) {
        if (!active) return;
        setLoading(false);
        setError(
          failure instanceof PdfPreviewError && failure.code === "byte_limit"
            ? "This PDF is larger than the 32 MB preview limit. Download the original to read the full file."
            : failure instanceof Error && failure.name === "PasswordException"
              ? "This PDF is password-protected. Download the original to open it in a PDF app."
              : "We couldn't display this PDF. You can still download the original.",
        );
      }
    })();
    return () => {
      active = false;
      controller.abort();
      void task?.destroy().catch(() => {});
    };
  }, [url, retry]);

  useEffect(() => {
    if (!pdf || !canvas.current || !text.current) return;
    let active = true;
    let render: RenderTask | undefined;
    let layer: TextLayer | undefined;
    const canvasElement = canvas.current,
      textElement = text.current;
    setLoading(true);
    setError(null);
    textElement.replaceChildren();
    void (async () => {
      try {
        const selected = await pdf.getPage(page);
        if (!active) return;
        const library = await import("pdfjs-dist");
        if (!active) return;
        const natural = selected.getViewport({ scale: 1 });
        const viewport = selected.getViewport({
          scale: Math.max(0.1, width / natural.width) * zoom,
        });
        if (
          !Number.isFinite(viewport.width) ||
          !Number.isFinite(viewport.height) ||
          viewport.width <= 0 ||
          viewport.height <= 0 ||
          viewport.width > 10_000 ||
          viewport.height > 10_000
        )
          throw new Error("Page exceeds canvas limits");
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(PDF_PREVIEW_MAX_CANVAS_PIXELS / (viewport.width * viewport.height)),
          8192 / Math.max(viewport.width, viewport.height),
        );
        canvasElement.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvasElement.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvasElement.style.width = `${viewport.width}px`;
        canvasElement.style.height = `${viewport.height}px`;
        const context = canvasElement.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas unavailable");
        render = selected.render({
          canvas: canvasElement,
          canvasContext: context,
          viewport,
          annotationMode: library.AnnotationMode.DISABLE,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        if (!active) return;
        textElement.style.width = `${viewport.width}px`;
        textElement.style.height = `${viewport.height}px`;
        textElement.style.setProperty("--scale-factor", String(viewport.scale));
        textElement.style.setProperty("--total-scale-factor", String(viewport.scale));
        const textContent = await selected.getTextContent();
        if (!active) return;
        layer = new library.TextLayer({
          textContentSource: textContent,
          container: textElement,
          viewport,
        });
        await layer.render();
        if (active) setLoading(false);
      } catch (failure) {
        if (!active || (failure instanceof Error && failure.name === "RenderingCancelledException"))
          return;
        setLoading(false);
        setError(
          "This page couldn't be displayed at this zoom. Try Fit width or download the original.",
        );
      }
    })();
    return () => {
      active = false;
      render?.cancel();
      layer?.cancel();
      textElement.replaceChildren();
    };
  }, [pdf, page, zoom, width]);

  function move(next: number) {
    if (!pdf) return;
    const value = Math.max(1, Math.min(pdf.numPages, Math.trunc(next)));
    if (value !== page) setLoading(true);
    setPage(value);
    setPageInput(String(value));
    scroll.current?.scrollTo({ top: 0 });
  }
  return (
    <section className={styles.pdfViewer} aria-label={`${title} PDF reader`}>
      <div className={styles.controls} role="toolbar" aria-label="PDF controls">
        <div className={styles.controlGroup}>
          <button
            type="button"
            aria-label="Previous page"
            disabled={!pdf || page === 1}
            onClick={() => move(page - 1)}
          >
            ‹
          </button>
          <label className={styles.pageField}>
            Page{" "}
            <input
              aria-label="Page number"
              type="number"
              min={1}
              max={pdf?.numPages ?? 1}
              value={pageInput}
              disabled={!pdf}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={() => move(Number(pageInput) || 1)}
              onKeyDown={(event) => {
                if (event.key === "Enter") move(Number(pageInput) || 1);
              }}
            />
          </label>
          <span className={styles.muted}>of {pdf?.numPages ?? "…"}</span>
          <button
            type="button"
            aria-label="Next page"
            disabled={!pdf || page === pdf.numPages}
            onClick={() => move(page + 1)}
          >
            ›
          </button>
        </div>
        <div className={styles.controlGroup}>
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!pdf || zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          >
            −
          </button>
          <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={!pdf || zoom >= 2}
            onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
          >
            +
          </button>
          <button type="button" disabled={!pdf} onClick={() => setZoom(1)}>
            Fit width
          </button>
        </div>
      </div>
      <div className={styles.pdfScroll} ref={scroll}>
        {error ? (
          <div className={styles.emptyState} role="alert">
            <h3>PDF preview unavailable</h3>
            <p>{error}</p>
            <div className={styles.controlGroup}>
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                Try preview again
              </button>
              {onDownload ? (
                <button type="button" onClick={() => void onDownload()}>
                  Download original
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {loading && !error ? (
          <p className={styles.loadingLabel} role="status">
            {pdf ? `Rendering page ${page}…` : "Opening PDF…"}
          </p>
        ) : null}
        <div
          key={`${url}:${page}`}
          className={styles.pdfPage}
          data-pdf-page={page}
          style={{
            display: pdf && !error ? "block" : "none",
            visibility: loading ? "hidden" : "visible",
          }}
        >
          <canvas ref={canvas} aria-label={`Page ${page} of ${pdf?.numPages ?? ""}`} role="img" />
          <div ref={text} className={styles.textLayer} />
        </div>
      </div>
    </section>
  );
}
