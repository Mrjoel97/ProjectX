"use client";

import { api } from "@pikar/backend/api";
import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fmtSize, type VaultDoc } from "./DocGrid";
import { DownloadIcon, TrashIcon, XIcon } from "./icons";

// The in-place preview modal (VALT-04, surfaces VALT-02 in the UI). Opening a doc renders it here —
// NOT a route change — so Esc/X/backdrop closes back to the exact grid scroll. The left pane shows
// the stored text (or the image/video itself for those kinds); the right detail panel carries the
// metadata (kind, source, size, added, status), the entities & relationships extracted from THIS
// doc (api.vault.docEntities — the graph plane in the UI), a Download that fetches the signed URL
// on demand, a Delete (the grid re-renders reactively when the row is gone), and a plain link to the
// workspace (navigate only — no Lane-A edits).
//
// A signed download/media URL is a bearer capability: it is rendered into <img>/<video>/<a> only,
// and NEVER logged (CLAUDE.md §4). Text docs skip the URL subscription entirely ("skip").

// How much extracted text the modal shows before the "Show full text" expander. Keeps the card
// readable (and the modal short) instead of dumping a whole document into the preview pane.
const SNIPPET_CHARS = 1500;

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}
function isVideo(mime: string): boolean {
  return mime.startsWith("video/");
}

export function PreviewModal({ doc, onClose }: { doc: VaultDoc; onClose: () => void }) {
  const convex = useConvex();
  const entities = useQuery(api.vault.docEntities, { vaultDocId: doc._id });
  const del = useMutation(api.vault.deleteVaultDoc);
  const retry = useMutation(api.vaultSweep.retryExtraction);
  const [busy, setBusy] = useState<null | "download" | "delete" | "retry">(null);
  const [expanded, setExpanded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const media = isImage(doc.mimeType) || isVideo(doc.mimeType);
  // Only subscribe to a signed URL when we actually render media; text docs never fetch one.
  const mediaUrl = useQuery(api.vault.vaultDownloadUrl, media ? { vaultDocId: doc._id } : "skip");

  // Esc closes; lock the background scroll while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function handleDownload() {
    setBusy("download");
    try {
      // On-demand: mint a fresh short-lived URL only at click, then hand it to the browser. Never log it.
      const url = await convex.query(api.vault.vaultDownloadUrl, { vaultDocId: doc._id });
      if (!url) return; // paste/brain-dump has no stored bytes
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.title;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    try {
      await del({ vaultDocId: doc._id });
      onClose(); // the grid drops the row reactively
    } finally {
      setBusy(null);
    }
  }

  async function handleRetry() {
    setBusy("retry");
    try {
      await retry({ vaultDocId: doc._id }); // status pill + panel update reactively
    } finally {
      setBusy(null);
    }
  }

  // node id → name, so an edge reads "Alice —works_with→ Bob".
  const nodeName = new Map((entities?.nodes ?? []).map((n) => [n._id, n.name] as const));
  const canDownload = Boolean(doc.storageId);

  const metaRows: [string, string][] = [
    ["Kind", doc.kind],
    ["Source", doc.source],
    ["Size", fmtSize(doc.size)],
    ["Added", new Date(doc.createdAt).toLocaleString()],
    ["Status", doc.status],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${doc.title}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "rgb(14 20 25 / 55%)",
      }}
    >
      <div
        className="vault-preview-grid"
        style={{
          // Height comes from .vault-preview-grid (fixed geometry — identical card for every kind).
          gap: 0,
          width: "min(60rem, 100%)",
          overflow: "hidden",
          background: "var(--card)",
          borderRadius: "1.25rem",
          boxShadow: "0 24px 70px -24px rgb(14 20 25 / 55%)",
        }}
      >
        {/* Preview pane — the stored text, or the image/video for those kinds. Media NEVER
            scrolls (a single image/video always fits the pane — overflow hidden guarantees it);
            text scrolls, because that's how reading works. */}
        <div
          className="vault-preview-main"
          style={{
            overflow: media ? "hidden" : "auto",
            padding: "1.75rem",
            background: "var(--canvas)",
            // Media floats centered in the fixed-height pane; text stays top-aligned for reading.
            ...(media ? { display: "grid", placeItems: "center" } : {}),
          }}
        >
          {media && isImage(doc.mimeType) && mediaUrl ? (
            <div
              style={{
                minHeight: 0,
                maxHeight: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: signed blob URL, not a static asset (next/image can't sign it) */}
              <img
                ref={imgRef}
                src={mediaUrl}
                alt={doc.title}
                style={{
                  display: "block",
                  minHeight: 0,
                  maxWidth: "100%",
                  maxHeight: "100%", // pane height is definite — the whole image is always in view
                  objectFit: "contain",
                  borderRadius: "0.5rem",
                }}
              />
              {/* Native fullscreen — the same full-view the video player's control gives. */}
              <button
                type="button"
                onClick={() => void imgRef.current?.requestFullscreen?.()}
                style={{
                  flex: "none",
                  padding: "0.35rem 0.9rem",
                  borderRadius: "999px",
                  border: "1px solid var(--rule)",
                  background: "var(--card)",
                  color: "var(--teal-600)",
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                View full screen
              </button>
            </div>
          ) : media && isVideo(doc.mimeType) && mediaUrl ? (
            // biome-ignore lint/a11y/useMediaCaption: user-uploaded media has no caption track
            <video
              src={mediaUrl}
              controls
              style={{
                display: "block",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: "0.5rem",
              }}
            />
          ) : doc.text ? (
            <>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "var(--font-sans), system-ui, sans-serif",
                  fontSize: "0.9rem",
                  lineHeight: 1.6,
                  color: "var(--ink)",
                }}
              >
                {expanded || doc.text.length <= SNIPPET_CHARS
                  ? doc.text
                  : `${doc.text.slice(0, SNIPPET_CHARS)}…`}
              </pre>
              {doc.text.length > SNIPPET_CHARS && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  style={{
                    marginTop: "0.9rem",
                    padding: "0.35rem 0.9rem",
                    borderRadius: "999px",
                    border: "1px solid var(--rule)",
                    background: "var(--card)",
                    color: "var(--teal-600)",
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    cursor: "pointer",
                  }}
                >
                  {expanded
                    ? "Show less"
                    : `Show full text (${Math.ceil(doc.text.length / 1000)}k chars)`}
                </button>
              )}
            </>
          ) : (
            <p style={{ color: "var(--ink-soft)", margin: 0 }}>
              {doc.status === "pending_extraction"
                ? "Stored — text not yet extracted."
                : doc.status === "extracting"
                  ? "Extracting text from this file…"
                  : "No inline preview for this file. Use Download."}
            </p>
          )}
        </div>

        {/* Detail panel: fixed header (title + close), scrollable middle, PINNED actions footer —
            a doc with many entities must never scroll Download/Delete/Workspace out of sight. */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.75rem",
              padding: "1.5rem 1.5rem 0",
            }}
          >
            <h2
              style={{
                margin: 0,
                flex: 1,
                minWidth: 0, // let a long unbroken filename shrink + wrap instead of pushing past the panel
                fontSize: "1.15rem",
                fontWeight: 700,
                lineHeight: 1.3,
                color: "var(--ink)",
                wordBreak: "break-word",
              }}
            >
              {doc.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "2rem",
                height: "2rem",
                flex: "none",
                borderRadius: "0.5rem",
                border: "1px solid var(--rule)",
                background: "transparent",
                color: "var(--ink-soft)",
                cursor: "pointer",
              }}
            >
              <XIcon />
            </button>
          </div>

          {/* Scrollable middle: metadata, failure/truncation notes, entities. */}
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 1.5rem 1.25rem" }}>
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "0.35rem 1rem",
                margin: "1.25rem 0 0",
              }}
            >
              {metaRows.map(([k, val]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>{k}</dt>
                  <dd
                    style={{
                      margin: 0,
                      fontSize: "0.85rem",
                      color: "var(--ink)",
                      wordBreak: "break-word",
                    }}
                  >
                    {val}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Failed: the honest refs-only reason + the same Retry the card carries (EXTR-F). */}
            {doc.status === "failed" && (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "0.75rem 1rem",
                  borderRadius: "0.6rem",
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                }}
              >
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}>
                  Extraction failed
                </p>
                {doc.failureReason && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "#991b1b" }}>
                    Reason: {doc.failureReason.replace(/_/g, " ")}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleRetry()}
                  disabled={busy !== null}
                  style={{
                    marginTop: "0.6rem",
                    padding: "0.4rem 1rem",
                    borderRadius: "999px",
                    border: "none",
                    cursor: busy ? "default" : "pointer",
                    background: "var(--teal-600)",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    opacity: busy === "retry" ? 0.6 : 1,
                  }}
                >
                  Retry extraction
                </button>
              </div>
            )}

            {/* Truncation honesty (extractionTruncated — EXTR-F). Calm note, no amber (BRAND §2). */}
            {doc.extractionTruncated && (
              <p
                style={{
                  marginTop: "1rem",
                  marginBottom: 0,
                  padding: "0.6rem 1rem",
                  borderRadius: "0.6rem",
                  border: "1px solid var(--rule)",
                  fontSize: "0.85rem",
                  color: "var(--ink-soft)",
                }}
              >
                Extracted the first part of this file — large file truncated.
              </p>
            )}

            {/* Entities & relationships from this doc (VALT-02). */}
            <section style={{ marginTop: "1.5rem" }}>
              <h3
                style={{
                  margin: "0 0 0.6rem",
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--ink-soft)",
                }}
              >
                Entities & Relationships
              </h3>
              {entities === undefined ? (
                <p style={{ fontSize: "0.85rem", color: "var(--ink-soft)", margin: 0 }}>Loading…</p>
              ) : entities.nodes.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "var(--ink-soft)", margin: 0 }}>
                  No entities extracted for this document.
                </p>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {entities.nodes.map((n) => (
                      <span
                        key={n._id}
                        title={n.type}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          padding: "0.2rem 0.6rem",
                          borderRadius: "999px",
                          border: "1px solid var(--rule)",
                          background: "color-mix(in srgb, var(--teal-400) 12%, transparent)",
                          color: "var(--ink)",
                          fontSize: "0.8rem",
                        }}
                      >
                        {n.name}
                        <span style={{ color: "var(--ink-soft)", fontSize: "0.7rem" }}>
                          {n.type}
                        </span>
                      </span>
                    ))}
                  </div>
                  {entities.edges.length > 0 && (
                    <ul
                      style={{
                        listStyle: "none",
                        margin: "0.75rem 0 0",
                        padding: 0,
                        display: "grid",
                        gap: "0.3rem",
                      }}
                    >
                      {entities.edges.map((e) => (
                        <li key={e._id} style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                          {nodeName.get(e.fromNodeId) ?? "?"}{" "}
                          <span style={{ color: "var(--teal-600)", fontWeight: 600 }}>{e.rel}</span>{" "}
                          {nodeName.get(e.toNodeId) ?? "?"}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          </div>

          {/* Actions — a pinned footer, always visible (never scrolled away by long content). */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              flex: "none",
              padding: "1rem 1.5rem",
              borderTop: "1px solid var(--rule)",
            }}
          >
            {canDownload && (
              <button
                type="button"
                onClick={handleDownload}
                disabled={busy !== null}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.55rem 1rem",
                  borderRadius: "0.6rem",
                  border: "1px solid var(--rule)",
                  background: "var(--card)",
                  color: "var(--ink)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy === "download" ? 0.6 : 1,
                }}
              >
                <DownloadIcon size={16} />
                Download
              </button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy !== null}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.55rem 1rem",
                borderRadius: "0.6rem",
                border: "1px solid #fecaca",
                background: "#fef2f2",
                color: "#991b1b",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: busy ? "default" : "pointer",
                opacity: busy === "delete" ? 0.6 : 1,
              }}
            >
              <TrashIcon size={16} />
              Delete
            </button>
            <Link
              href="/dashboard/workspace"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.55rem 1rem",
                borderRadius: "0.6rem",
                border: "1px solid var(--rule)",
                background: "var(--card)",
                color: "var(--teal-600)",
                fontWeight: 600,
                fontSize: "0.85rem",
                textDecoration: "none",
              }}
            >
              Open in workspace
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
