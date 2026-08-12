"use client";

import { api } from "@pikar/backend/api";
import type { DocType } from "@pikar/core";
import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { docLabel, fmtSize, type VaultDoc } from "./DocGrid";
import { failureCopy } from "./failureCopy";
import { XIcon } from "./icons";
import {
  type PreviewActionId,
  type PreviewControlHandlers,
  PreviewControls,
} from "./PreviewControls";
import { derivePreviewState } from "./previewState";

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

function isVideo(mime: string): boolean {
  return mime.startsWith("video/");
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "select:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function PreviewModal({ doc, onClose }: { doc: VaultDoc; onClose: () => void }) {
  const convex = useConvex();
  const entities = useQuery(api.vault.docEntities, { vaultDocId: doc._id });
  const del = useMutation(api.vault.deleteVaultDoc);
  const retry = useMutation(api.vaultSweep.retryExtraction);
  const setIdentity = useMutation(api.vault.setDocIdentity);
  const [busy, setBusy] = useState<PreviewActionId | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [docType, setDocType] = useState<DocType | "">("");
  const [identityLine, setIdentityLine] = useState("");
  const [identitySaved, setIdentitySaved] = useState(false);
  const identitySeeded = useRef<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const media = isImage(doc.mimeType) || isVideo(doc.mimeType);
  const mediaUrl = useQuery(api.vault.vaultDownloadUrl, media ? { vaultDocId: doc._id } : "skip");
  const docText = useQuery(api.vault.vaultDocText, { vaultDocId: doc._id });
  const text = docText === undefined ? undefined : (docText?.text ?? null);
  const preview = derivePreviewState({
    status: doc.status,
    mimeType: doc.mimeType,
    text,
    // A resolved null URL means the metadata points at bytes that no longer exist. Keep undefined
    // as loading so a media document does not flash the missing-original state while its lazy
    // signed URL query settles.
    hasStoredBytes: Boolean(doc.storageId) && (!media || mediaUrl !== null),
    extractionTruncated: doc.extractionTruncated,
  });

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((control) => control.getAttribute("aria-hidden") !== "true");
      if (controls.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = priorOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    void doc._id;
    setExpanded(false);
    setDeleteConfirmation(false);
    setIdentitySaved(false);
  }, [doc._id]);

  useEffect(() => {
    if (identitySeeded.current === doc._id) return;
    const classified = doc.docType !== undefined || doc.identityLine !== undefined;
    if (doc.status !== "ready" && doc.status !== "failed" && !classified) return;
    identitySeeded.current = doc._id;
    setDocType(doc.docType ?? "");
    setIdentityLine(doc.identityLine ?? "");
  }, [doc._id, doc.status, doc.docType, doc.identityLine]);

  function armIdentityEdit() {
    identitySeeded.current = doc._id;
    setIdentitySaved(false);
  }

  async function handleSaveIdentity() {
    setBusy("save-identity");
    try {
      await setIdentity({
        vaultDocId: doc._id,
        docType: docType === "" ? undefined : docType,
        identityLine,
      });
      setIdentitySaved(true);
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload() {
    setBusy("download");
    try {
      const url = await convex.query(api.vault.vaultDownloadUrl, { vaultDocId: doc._id });
      if (!url) return;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = doc.title;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("confirm-delete");
    try {
      await del({ vaultDocId: doc._id });
      onCloseRef.current();
    } finally {
      setBusy(null);
    }
  }

  async function handleRetry() {
    setBusy("retry-extraction");
    try {
      await retry({ vaultDocId: doc._id });
    } finally {
      setBusy(null);
    }
  }

  const handlers: PreviewControlHandlers = {
    onDocTypeChange: (value) => {
      armIdentityEdit();
      setDocType(value);
    },
    onIdentityLineChange: (value) => {
      armIdentityEdit();
      setIdentityLine(value);
    },
    onSaveIdentity: () => void handleSaveIdentity(),
    onDownload: () => void handleDownload(),
    onRequestDelete: () => setDeleteConfirmation(true),
    onCancelDelete: () => setDeleteConfirmation(false),
    onConfirmDelete: () => void handleDelete(),
    onRetryExtraction: () => void handleRetry(),
  };

  const metaRows: [string, string][] = [
    ["File", doc.title],
    ["Kind", doc.kind],
    ["Source", doc.source],
    ["Size", fmtSize(doc.size)],
    ["Added", new Date(doc.createdAt).toLocaleString()],
    ["Status", doc.status],
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Backdrop dismissal supplements the dialog's close button and Escape handler.
    <div
      className="vault-preview-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "grid",
        placeItems: "center",
        padding: "clamp(0.75rem, 3vw, 2rem)",
        background: "color-mix(in srgb, var(--ink) 58%, transparent)",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-preview-title"
        aria-describedby="vault-preview-description"
        tabIndex={-1}
        className="vault-preview-grid"
        style={{
          width: "min(64rem, 100%)",
          overflow: "hidden",
          border: "1px solid var(--vault-border)",
          borderRadius: "1.25rem",
          background: "var(--vault-paper)",
          boxShadow: "0 28px 80px -32px rgb(14 20 25 / 72%)",
        }}
      >
        <div
          className="vault-preview-main"
          style={{
            minHeight: 0,
            // Media alone is floated in a fixed pane; media WITH a description has to scroll.
            overflow:
              preview.content.kind === "ready-binary" && !preview.content.text ? "hidden" : "auto",
            padding: "clamp(1.25rem, 3vw, 2rem)",
            background: "var(--canvas)",
          }}
        >
          <p className="caps-label" style={{ marginBottom: "0.75rem" }}>
            {preview.content.title}
          </p>
          {preview.content.kind === "ready-text" ? (
            <>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  fontFamily: "var(--font-sans), system-ui, sans-serif",
                  fontSize: "0.92rem",
                  lineHeight: 1.7,
                  color: "var(--ink)",
                }}
              >
                {expanded ? preview.content.text : preview.content.excerpt}
              </pre>
              {preview.content.canExpand && (
                <button
                  type="button"
                  className="vault-button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                  style={{ marginTop: "1rem" }}
                >
                  {expanded
                    ? "Show less"
                    : `Show full text (${Math.ceil(preview.content.text.length / 1000)}k chars)`}
                </button>
              )}
              {preview.content.extractionTruncated && (
                <p className="vault-preview-note" role="note">
                  Extracted the first part of this file. The original is longer than the extraction
                  limit.
                </p>
              )}
            </>
          ) : preview.content.kind === "ready-binary" && mediaUrl ? (
            // The media itself leads; its description/transcript rides beneath it. The media is
            // capped rather than stretched to the pane so the text below is reachable without
            // scrolling past a full-height picture.
            <div
              style={{
                display: "grid",
                gap: "1.25rem",
                height: preview.content.text ? undefined : "100%",
              }}
            >
              {preview.content.media === "image" ? (
                <div
                  style={{ display: "grid", placeItems: "center", gap: "0.75rem", minHeight: 0 }}
                >
                  {/* biome-ignore lint/performance/noImgElement: signed blob URL cannot be handled by next/image */}
                  <img
                    ref={imgRef}
                    src={mediaUrl}
                    alt={doc.title}
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      maxHeight: "60vh",
                      objectFit: "contain",
                    }}
                  />
                  <button
                    type="button"
                    className="vault-button"
                    onClick={() => void imgRef.current?.requestFullscreen?.()}
                  >
                    View full screen
                  </button>
                </div>
              ) : (
                // biome-ignore lint/a11y/useMediaCaption: user-uploaded media has no caption track
                <video
                  src={mediaUrl}
                  controls
                  style={{
                    display: "block",
                    width: "100%",
                    maxHeight: "60vh",
                    objectFit: "contain",
                  }}
                />
              )}
              {preview.content.text && (
                <section style={{ borderTop: "1px solid var(--vault-border)", paddingTop: "1rem" }}>
                  <p className="caps-label" style={{ marginBottom: "0.5rem" }}>
                    {preview.content.media === "image"
                      ? "What Pikar read in this image"
                      : "Transcript"}
                  </p>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      fontFamily: "var(--font-sans), system-ui, sans-serif",
                      fontSize: "0.92rem",
                      lineHeight: 1.7,
                      color: "var(--ink)",
                    }}
                  >
                    {expanded ? preview.content.text : preview.content.excerpt}
                  </pre>
                  {preview.content.canExpand && (
                    <button
                      type="button"
                      className="vault-button"
                      aria-expanded={expanded}
                      onClick={() => setExpanded((value) => !value)}
                      style={{ marginTop: "1rem" }}
                    >
                      {expanded
                        ? "Show less"
                        : `Show full text (${Math.ceil(preview.content.text.length / 1000)}k chars)`}
                    </button>
                  )}
                </section>
              )}
            </div>
          ) : preview.content.kind === "failure" ? (
            <div className="vault-state vault-state-error" role="alert">
              <h3>{failureCopy(doc.failureReason).title}</h3>
              <p>{failureCopy(doc.failureReason).remedy}</p>
            </div>
          ) : (
            <div
              className={
                preview.content.kind === "processing" || preview.content.kind === "loading"
                  ? "vault-state"
                  : "vault-state vault-state-empty"
              }
              role="status"
            >
              <h3>{preview.content.title}</h3>
              <p>{preview.content.detail}</p>
            </div>
          )}
        </div>

        <aside
          style={{ display: "flex", minHeight: 0, flexDirection: "column", overflow: "hidden" }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.75rem",
              padding: "1.5rem 1.5rem 1rem",
              borderBottom: "1px solid var(--vault-border)",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="caps-label" style={{ marginBottom: "0.35rem" }}>
                Document detail
              </p>
              <h2
                id="vault-preview-title"
                title={doc.title}
                style={{ margin: 0, overflowWrap: "anywhere" }}
              >
                {docLabel(doc)}
              </h2>
              <p
                id="vault-preview-description"
                style={{ margin: "0.3rem 0 0", color: "var(--ink-soft)", fontSize: "0.82rem" }}
              >
                {preview.content.title}. {doc.mimeType} · {fmtSize(doc.size)}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="vault-button"
              onClick={onClose}
              aria-label="Close preview"
            >
              <XIcon />
            </button>
          </header>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 1.5rem 1.5rem" }}>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr)",
                gap: "0.45rem 1rem",
                margin: "1.25rem 0",
              }}
            >
              {metaRows.map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}>
                  <dt style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}>{label}</dt>
                  <dd
                    style={{
                      margin: 0,
                      overflowWrap: "anywhere",
                      color: "var(--ink)",
                      fontSize: "0.85rem",
                    }}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <PreviewControls
              capabilities={preview.capabilities}
              docType={docType}
              identityLine={identityLine}
              identitySaved={identitySaved}
              identityUserSet={doc.identityUserSet === true}
              entities={entities?.nodes}
              relationships={entities?.edges}
              busy={busy}
              deleteConfirmation={deleteConfirmation}
              handlers={handlers}
            />

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem" }}>
              {preview.capabilities.discussByVoice ? (
                <Link
                  href={`/dashboard/voice?doc=${doc._id}`}
                  className="vault-button vault-button-primary"
                  aria-label={`Discuss by voice: ${docLabel(doc)}`}
                  style={{ textDecoration: "none" }}
                >
                  Discuss by voice
                </Link>
              ) : doc.status !== "failed" ? (
                <button type="button" className="vault-button" disabled>
                  Still reading your document…
                </button>
              ) : null}
              <Link
                href="/dashboard/workspace"
                className="vault-button"
                style={{ textDecoration: "none" }}
              >
                Open in workspace
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
