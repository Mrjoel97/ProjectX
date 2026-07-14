"use client";

import { api } from "@pikar/backend/api";
import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
  const [busy, setBusy] = useState<null | "download" | "delete">(null);

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
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.5fr) minmax(18rem, 1fr)",
          gap: 0,
          width: "min(60rem, 100%)",
          maxHeight: "85vh",
          overflow: "hidden",
          background: "var(--card)",
          borderRadius: "1.25rem",
          boxShadow: "0 24px 70px -24px rgb(14 20 25 / 55%)",
        }}
      >
        {/* Preview pane — the stored text, or the image/video for those kinds. */}
        <div
          style={{
            overflow: "auto",
            padding: "1.75rem",
            background: "var(--canvas)",
            borderRight: "1px solid var(--rule)",
          }}
        >
          {media && isImage(doc.mimeType) && mediaUrl ? (
            // biome-ignore lint/performance/noImgElement: signed blob URL, not a static asset (next/image can't sign it)
            <img
              src={mediaUrl}
              alt={doc.title}
              style={{ maxWidth: "100%", height: "auto", borderRadius: "0.5rem" }}
            />
          ) : media && isVideo(doc.mimeType) && mediaUrl ? (
            // biome-ignore lint/a11y/useMediaCaption: user-uploaded media has no caption track
            <video src={mediaUrl} controls style={{ maxWidth: "100%", borderRadius: "0.5rem" }} />
          ) : doc.text ? (
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
              {doc.text}
            </pre>
          ) : (
            <p style={{ color: "var(--ink-soft)", margin: 0 }}>
              {doc.status === "pending_extraction"
                ? "Stored — text not yet extracted."
                : "No inline preview for this file. Use Download."}
            </p>
          )}
        </div>

        {/* Detail panel. */}
        <div
          style={{ display: "flex", flexDirection: "column", overflow: "auto", padding: "1.5rem" }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
            <h2
              style={{
                margin: 0,
                flex: 1,
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
                      <span style={{ color: "var(--ink-soft)", fontSize: "0.7rem" }}>{n.type}</span>
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

          {/* Actions. */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              margin: "auto 0 0",
              paddingTop: "1.5rem",
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
