// biome-ignore-all lint/suspicious/noArrayIndexKey: immutable worksheet cells have stable coordinates; replacement swaps the whole data projection.
"use client";

import { api } from "@pikar/backend/api";
import {
  type PresentationSpec,
  renderPresentationHtml,
  validatePresentationSpec,
} from "@pikar/core/presentation";
import { useConvex, useQuery } from "convex/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { MarkdownDocument } from "../MarkdownDocument";
import type { VaultDoc } from "../vault/DocGrid";
import { binaryMediaKind, isSpreadsheet } from "../vault/previewState";
import type { SheetRowsView } from "../vault/SheetGrid";
import styles from "./artifactViewer.module.css";
import { PdfDocumentViewer } from "./PdfDocumentViewer";

export interface ArtifactViewerData {
  id: string;
  title: string;
  mimeType: string;
  markdown?: boolean;
  status?: string;
  url?: string | null;
  text?: string | null;
  presentation?: PresentationSpec | null;
  sheets?: { sheets: SheetRowsView[]; sheetCount: number } | null;
  hasOriginal: boolean;
  loading?: boolean;
  extractionTruncated?: boolean;
}

/** The selected document alone subscribes to owned content. Parent supplies owned metadata. */
export function ArtifactViewer({ doc, onClose }: { doc: VaultDoc; onClose?: () => void }) {
  const convex = useConvex();
  const mime = doc.storedMimeType ?? doc.mimeType;
  const pdf = mime === "application/pdf" || /\.pdf$/iu.test(doc.title);
  const binary = binaryMediaKind(mime) !== null || pdf;
  const workbook = isSpreadsheet(mime) || /\.(xlsx|xlsm|xls|xlsb|ods)$/iu.test(doc.title);
  const slides =
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const document = useQuery(api.vault.vaultDocText, { vaultDocId: doc._id });
  const url = useQuery(
    api.vault.vaultDownloadUrl,
    binary && doc.storageId ? { vaultDocId: doc._id } : "skip",
  );
  const sheets = useQuery(api.vault.vaultDocSheets, workbook ? { vaultDocId: doc._id } : "skip");
  const presentation = useQuery(api.vaultPresentations.byDoc, slides ? { docId: doc._id } : "skip");
  async function download() {
    const ownedUrl = await convex.query(api.vault.vaultDownloadUrl, { vaultDocId: doc._id });
    if (!ownedUrl) throw new Error("original_unavailable");
    const anchor = window.document.createElement("a");
    anchor.href = ownedUrl;
    anchor.download = doc.title;
    anchor.rel = "noopener";
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  return (
    <ArtifactViewerBody
      key={doc._id}
      artifact={{
        id: String(doc._id),
        title: doc.title,
        mimeType: pdf ? "application/pdf" : mime,
        markdown: doc.mimeType === "text/markdown",
        status: doc.status,
        url,
        text: document?.text,
        presentation,
        sheets,
        hasOriginal: Boolean(doc.storageId),
        loading: binary
          ? url === undefined && Boolean(doc.storageId)
          : document === undefined ||
            (slides && presentation === undefined) ||
            (workbook && sheets === undefined),
        extractionTruncated: doc.extractionTruncated,
      }}
      onDownload={download}
      onClose={onClose}
    />
  );
}

/** Pure reading canvas; attachments and offline fixtures can supply already-authorized data. */
export function ArtifactViewerBody({
  artifact,
  onDownload,
  onClose,
}: {
  artifact: ArtifactViewerData;
  onDownload?: () => void | Promise<void>;
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<"auto" | "reading" | "original">("auto");
  const [page, setPage] = useState(0);
  const [sheet, setSheet] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  useEffect(() => {
    void artifact.id;
    setMode("auto");
    setPage(0);
    setSheet(0);
    setZoom(1);
    setDownloadError(false);
  }, [artifact.id]);
  const mime = artifact.mimeType;
  const pdf = mime === "application/pdf";
  const image = mime.startsWith("image/");
  const video = mime.startsWith("video/");
  const workbook = isSpreadsheet(mime) || /\.(xlsx|xlsm|xls|xlsb|ods)$/iu.test(artifact.title);
  const slideFile =
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    /\.(pptx|ppt)$/iu.test(artifact.title);
  const presentation = useMemo(() => {
    try {
      return artifact.presentation ? validatePresentationSpec(artifact.presentation) : null;
    } catch {
      return null;
    }
  }, [artifact.presentation]);
  const currentPage = Math.min(page, Math.max(0, (presentation?.slides.length ?? 1) - 1));
  const slideHtml = useMemo(
    () => (presentation ? renderPresentationHtml(presentation, currentPage) : ""),
    [presentation, currentPage],
  );
  const currentSheet =
    artifact.sheets?.sheets[Math.min(sheet, Math.max(0, artifact.sheets.sheets.length - 1))];
  const reading = pdf && artifact.markdown && artifact.text && mode !== "original";
  const label = pdf
    ? "PDF"
    : slideFile
      ? "Slides"
      : workbook
        ? "Workbook"
        : image
          ? "Image"
          : video
            ? "Video"
            : "Document";
  const canZoom = !video && (!pdf || Boolean(reading));
  async function download() {
    if (!onDownload || downloadBusy) return;
    setDownloadBusy(true);
    setDownloadError(false);
    try {
      await onDownload();
    } catch {
      setDownloadError(true);
    } finally {
      setDownloadBusy(false);
    }
  }
  const downloadAvailable = artifact.hasOriginal && onDownload;
  const empty = (heading: string, detail: string) => (
    <div className={styles.emptyState}>
      <span className={styles.fileMark} aria-hidden="true">
        ▤
      </span>
      <h3>{heading}</h3>
      <p>{detail}</p>
      {downloadAvailable ? (
        <button type="button" onClick={() => void download()} disabled={downloadBusy}>
          Download original
        </button>
      ) : null}
    </div>
  );
  const columnLabel = (index: number): string =>
    index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;

  let content: ReactNode;
  if (reading)
    content = (
      <article className={styles.reading} style={{ fontSize: `${16 * zoom}px` }}>
        <MarkdownDocument markdown={artifact.text ?? ""} />
      </article>
    );
  else if (pdf && artifact.url)
    content = (
      <PdfDocumentViewer
        key={`${artifact.id}:${artifact.url}`}
        url={artifact.url}
        title={artifact.title}
        onDownload={downloadAvailable ? download : undefined}
      />
    );
  else if (presentation)
    content = (
      <div className={styles.slideScroll}>
        <div className={styles.slidePage} style={{ width: `${zoom * 100}%` }}>
          <iframe
            sandbox=""
            referrerPolicy="no-referrer"
            title={`Slide ${currentPage + 1}: ${presentation.slides[currentPage]?.title ?? artifact.title}`}
            srcDoc={slideHtml}
          />
        </div>
        <p className={styles.previewNote}>
          Slide layout preview. Fonts and spacing may vary in PowerPoint.
        </p>
        {presentation.slides[currentPage]?.notes ? (
          <details className={styles.notes}>
            <summary>Speaker notes</summary>
            <p>{presentation.slides[currentPage]?.notes}</p>
          </details>
        ) : null}
      </div>
    );
  else if (workbook && currentSheet) {
    const rows = currentSheet.rows.slice(0, 200);
    const columns = Math.min(30, Math.max(1, ...rows.map((row) => row.length)));
    content = (
      <div className={styles.sheetScroll}>
        <table className={styles.sheetTable} style={{ fontSize: `${13 * zoom}px` }}>
          <caption className={styles.screenReaderOnly}>
            {currentSheet.name} read-only data preview
          </caption>
          <thead>
            <tr>
              <th aria-label="Row number" />
              {Array.from({ length: columns }, (_, index) => (
                <th key={columnLabel(index)} scope="col">
                  {columnLabel(index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row">{rowIndex + 1}</th>
                {Array.from({ length: columns }, (_, index) => (
                  <td key={index}>{row[index] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.previewNote}>
          Showing {rows.length.toLocaleString()} of {currentSheet.totalRows.toLocaleString()} rows
          {currentSheet.totalCols && currentSheet.totalCols > columns
            ? ` and ${columns} of ${currentSheet.totalCols} columns`
            : ""}
          . Read-only data preview; download the original for complete formatting, formulas and
          charts.
          {artifact.sheets && artifact.sheets.sheetCount > artifact.sheets.sheets.length
            ? ` ${artifact.sheets.sheetCount - artifact.sheets.sheets.length} additional worksheets are in the original.`
            : ""}
        </p>
      </div>
    );
  } else if (image && artifact.url)
    content = (
      <div className={styles.mediaScroll}>
        {/* biome-ignore lint/performance/noImgElement: selected owned storage URL is not a Next image optimization source. */}
        <img
          src={artifact.url}
          alt={artifact.title}
          referrerPolicy="no-referrer"
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
    );
  else if (video && artifact.url)
    content = (
      <div className={styles.videoCanvas}>
        {/* biome-ignore lint/a11y/useMediaCaption: source media may not have a caption track. */}
        <video src={artifact.url} controls preload="metadata" aria-label={artifact.title} />
      </div>
    );
  else if (artifact.loading)
    content = (
      <div className={styles.emptyState} role="status">
        <span className={styles.loadingDot} />
        <p>Opening {label.toLowerCase()}…</p>
      </div>
    );
  else if (pdf || image || video)
    content = empty(
      "Original preview unavailable",
      "The file isn't available to display here. Try downloading the original.",
    );
  else if (slideFile)
    content = empty(
      "Slide preview unavailable",
      "Download the original presentation to view its complete layout in a presentation app.",
    );
  else if (workbook)
    content = empty(
      "Workbook preview unavailable",
      "Download the original workbook to view its sheets, formatting and calculations.",
    );
  else if (artifact.text)
    content = (
      <article className={styles.reading} style={{ fontSize: `${16 * zoom}px` }}>
        {artifact.markdown ? (
          <MarkdownDocument markdown={artifact.text} />
        ) : (
          <pre className={styles.plainText}>{artifact.text}</pre>
        )}
      </article>
    );
  else
    content = empty(
      artifact.status === "failed" ? "Preview couldn't be prepared" : "No preview available",
      "You can download the original file when one is available.",
    );

  return (
    <section className={styles.viewer} aria-label={`${artifact.title} artifact viewer`}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.typeLabel}>{label}</span>
          <h2 title={artifact.title}>{artifact.title}</h2>
        </div>
        <div className={styles.controlGroup}>
          {downloadAvailable ? (
            <button
              className={styles.downloadButton}
              type="button"
              onClick={() => void download()}
              disabled={downloadBusy}
            >
              {downloadBusy ? "Preparing…" : "Download original"}
            </button>
          ) : null}
          {onClose ? (
            <button type="button" aria-label="Close artifact" onClick={onClose}>
              ×
            </button>
          ) : null}
        </div>
      </header>
      {downloadError ? (
        <p className={styles.downloadError} role="alert">
          The original couldn't be opened. Please try again.
        </p>
      ) : null}
      {presentation || currentSheet || canZoom || (pdf && artifact.markdown && artifact.text) ? (
        <div className={styles.controls} role="toolbar" aria-label="Artifact controls">
          <div className={styles.controlGroup}>
            {pdf && artifact.markdown && artifact.text ? (
              <div className={styles.viewSwitch}>
                <button
                  type="button"
                  aria-pressed={Boolean(reading)}
                  onClick={() => setMode("reading")}
                >
                  Reading
                </button>
                <button type="button" aria-pressed={!reading} onClick={() => setMode("original")}>
                  Original PDF
                </button>
              </div>
            ) : null}
            {presentation ? (
              <>
                <button
                  type="button"
                  aria-label="Previous slide"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  ‹
                </button>
                <span className={styles.muted} aria-live="polite">
                  Slide {currentPage + 1} of {presentation.slides.length}
                </span>
                <button
                  type="button"
                  aria-label="Next slide"
                  disabled={currentPage === presentation.slides.length - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  ›
                </button>
              </>
            ) : null}
            {currentSheet ? (
              <label className={styles.sheetPicker}>
                Worksheet{" "}
                <select
                  aria-label="Worksheet"
                  value={Math.min(sheet, (artifact.sheets?.sheets.length ?? 1) - 1)}
                  onChange={(event) => setSheet(Number(event.target.value))}
                >
                  {artifact.sheets?.sheets.map((entry, index) => (
                    <option key={`${index}:${entry.name}`} value={index}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {canZoom && !video ? (
            <div className={styles.controlGroup}>
              <button
                type="button"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
              >
                −
              </button>
              <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={zoom >= 2}
                onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
              >
                +
              </button>
              <button type="button" onClick={() => setZoom(1)}>
                Fit
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={`${styles.content} ${pdf && !reading ? styles.pdfContent : ""}`}>
        {content}
      </div>
      {artifact.extractionTruncated && !pdf ? (
        <p className={styles.previewNote}>
          This text preview is shortened. Download the original for the complete file.
        </p>
      ) : null}
    </section>
  );
}
