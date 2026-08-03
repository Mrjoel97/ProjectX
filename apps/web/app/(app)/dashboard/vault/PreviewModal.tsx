"use client";

import { api } from "@pikar/backend/api";
import { DOC_TYPE_LABEL, DOC_TYPES, type DocType } from "@pikar/core";
import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { field, label as labelStyle, primaryButton } from "../profile/styles";
import { docLabel, fmtSize, type VaultDoc } from "./DocGrid";
import { failureCopy } from "./failureCopy";
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

/** The tracked-caps section label (BRAND §3) — one object, both sections that use it. */
const sectionLabel: React.CSSProperties = {
  margin: "0 0 0.6rem",
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
};

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
  const setIdentity = useMutation(api.vault.setDocIdentity);
  // ONE busy state, WIDENED with "identity" rather than a second useState: every action in this
  // modal already disables on `busy !== null`, so widening cross-disables Download/Delete/Retry
  // while an identity save is in flight for free — which is the behaviour we want anyway.
  const [busy, setBusy] = useState<null | "download" | "delete" | "retry" | "identity">(null);
  const [expanded, setExpanded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // The identity form (VALT-12). `""` is "not classified" — the same absent-vs-unclassified
  // distinction the schema draws, kept out of the union rather than smuggled into it.
  const [docType, setDocType] = useState<DocType | "">("");
  const [identityLine, setIdentityLine] = useState("");
  const [identitySaved, setIdentitySaved] = useState(false);
  // KEYED BY DOC ID, not a boolean. `page.tsx` renders this modal WITHOUT a `key`, so switching
  // the selected document reuses the SAME component instance and a boolean guard stays armed —
  // the form would keep document A's type and identity line while displaying document B, and Save
  // would write A's identity onto B. Reachable without closing the modal: there is no focus trap,
  // so Shift+Tab reaches a grid card behind it and Enter re-opens with a different doc.
  const identitySeeded = useRef<string | null>(null);

  const media = isImage(doc.mimeType) || isVideo(doc.mimeType);
  // Only subscribe to a signed URL when we actually render media; text docs never fetch one.
  const mediaUrl = useQuery(api.vault.vaultDownloadUrl, media ? { vaultDocId: doc._id } : "skip");
  // The stored text of THIS one document. It is deliberately NOT on the grid row any more:
  // listVaultDocs returns a projection with no `text`, because shipping every row's blob to the
  // browser to serve this one pane is what blew the 16 MiB read cap (15.3-02).
  const docText = useQuery(api.vault.vaultDocText, { vaultDocId: doc._id });
  const text = docText?.text ?? null;

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

  // Seed the identity form ONCE (the `ShapePanel.tsx:108-122` guard). `doc` comes off
  // `listVaultDocs`, a LIVE subscription, so re-seeding on every row update would clobber an edit
  // in progress the moment any other write touched the row.
  //
  // A still-ingesting row is this surface's "still settling" case (ShapePanel's
  // `tierRow === undefined`): classification lands DURING `processing`, so arming the guard before
  // the row is terminal would pin both fields empty and never fill them. The OTHER arming path is
  // the user's first keystroke (`armIdentityEdit`) — without it a document that finished reading
  // mid-edit would seed straight over what they had typed.
  useEffect(() => {
    if (identitySeeded.current === doc._id) return;
    // Terminal OR already classified. The status test alone was not enough: `applyClassification`
    // patches these fields while the row is still `processing` (the classify step runs before
    // `markReady`), so a row that stalls there — precisely what `vaultSweep` exists to recover —
    // showed an EMPTY form despite carrying a classifier answer, and Save then wrote `""` with
    // `identityUserSet: true`, blanking and LOCKING it for good.
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
    setBusy("identity");
    try {
      // `""` ⇒ omit, never a written empty string: the schema field is optional and the mutation
      // reads an absent one as "leave the type alone".
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
    // The FILENAME, which the heading no longer shows once a document has an identity line. It is
    // what Download hands the browser, so it must stay visible somewhere in the panel.
    ["File", doc.title],
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
      aria-label={`Preview: ${docLabel(doc)}`}
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
          ) : text ? (
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
                {expanded || text.length <= SNIPPET_CHARS
                  ? text
                  : `${text.slice(0, SNIPPET_CHARS)}…`}
              </pre>
              {text.length > SNIPPET_CHARS && (
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
                    : `Show full text (${Math.ceil(text.length / 1000)}k chars)`}
                </button>
              )}
            </>
          ) : (
            <p style={{ color: "var(--ink-soft)", margin: 0 }}>
              {/* `undefined` is the text subscription still settling — say so rather than showing
                  "no inline preview" for a beat and then swapping it for a wall of text. */}
              {docText === undefined
                ? "Loading…"
                : doc.status === "pending_extraction"
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
              title={doc.title}
            >
              {docLabel(doc)}
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

            {/* DOCUMENT IDENTITY (VALT-12) — the classifier's guess, and the user's correction of
                it. Saving here is the ONE writer that flips `identityUserSet`, after which no
                re-classification ever touches these two fields again; the guarantee is an ABSENCE
                of any overwrite branch in `applyClassification`, not a rule in a prompt. The note
                below makes that promise visible to the person it was made to. */}
            <section style={{ marginTop: "1.5rem" }}>
              <h3 style={sectionLabel}>Document identity</h3>
              <div style={{ display: "grid", gap: "0.6rem" }}>
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span style={labelStyle}>Type</span>
                  <select
                    style={field}
                    value={docType}
                    onChange={(e) => {
                      armIdentityEdit();
                      setDocType(e.target.value as DocType | "");
                    }}
                  >
                    {/* Absent is a real state, not a missing one — every pre-15.3 row is here. */}
                    <option value="">Not classified</option>
                    {DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {DOC_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span style={labelStyle}>What this is</span>
                  {/* ponytail: no `maxLength`. The length cap is the mutation's
                      (`vault.ts sanitizeIdentityLine`), and re-typing it here is the exact
                      single-source defect 15.3-02 recorded for the size caps. Ceiling: an
                      over-long line is shortened on save without warning. Upgrade path: export
                      the cap from `@pikar/core` and pass it as `maxLength`. */}
                  <input
                    style={field}
                    value={identityLine}
                    placeholder="2025 P&L"
                    onChange={(e) => {
                      armIdentityEdit();
                      setIdentityLine(e.target.value);
                    }}
                  />
                </label>

                <div
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleSaveIdentity()}
                    style={primaryButton(busy !== null)}
                  >
                    {busy === "identity" ? "Saving…" : "Save identity"}
                  </button>
                  {/* Cleared by the next keystroke, never by a timer — nothing on this surface is
                      allowed to poll or self-dismiss. `--ink-soft`, not a green: the WORD carries
                      the meaning (BRAND §6) and `--released` is ~2.7:1 at this size. */}
                  {identitySaved && busy === null && (
                    <span
                      role="status"
                      aria-live="polite"
                      style={{ color: "var(--ink-soft)", fontWeight: 600, fontSize: "0.85rem" }}
                    >
                      Saved.
                    </span>
                  )}
                </div>

                {doc.identityUserSet === true && (
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                    You set this. Re-reading this document will never change it.
                  </p>
                )}
              </div>
            </section>

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
                {/* The reason CODE is refs-only (§4) and is never shown — it rides in `title=` as a
                    debugging affordance only. What the user reads is failureCopy's title + remedy;
                    the previous hardcoded "scanned or image-only PDFs" sentence was DELETED because
                    it is wrong for most reason codes (a legacy .xls is not an image-only PDF). */}
                <p
                  style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b", fontWeight: 600 }}
                  title={doc.failureReason}
                >
                  {failureCopy(doc.failureReason).title}
                </p>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "#991b1b" }}>
                  {failureCopy(doc.failureReason).remedy}
                </p>
                {/* DOCV-01's first honesty moment, in the user's terms. A failed document offers NO
                    voice action anywhere — we will not open a grounded conversation the agent has
                    nothing to ground in, and a silent degradation to "chat about it anyway" would be
                    worse than the refusal. Unrelated to WHICH reason failed, so it survives the
                    copy rewrite verbatim. */}
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", color: "#991b1b" }}>
                  It can&apos;t be discussed by voice until it reads successfully.
                </p>
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
              <h3 style={sectionLabel}>Entities & Relationships</h3>
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
            {/* "Discuss by voice" (DOCV-01) — the primary action for a ready report, so it leads the
                footer. Only `ready` gets it: a failed doc is refused in the explainer above, and a
                still-extracting one shows the disabled wait state below. The gate is
                subscription-driven (the row is a live query), so it enables itself the moment the
                status flips — no poll, no timer, no second query. */}
            {doc.status === "ready" && (
              <Link
                href={`/dashboard/voice?doc=${doc._id}`}
                aria-label={`Discuss by voice: ${docLabel(doc)}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.55rem 1rem",
                  borderRadius: "0.6rem",
                  border: "none",
                  background: "var(--teal-600)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  textDecoration: "none",
                }}
              >
                Discuss by voice
              </Link>
            )}
            {(doc.status === "processing" ||
              doc.status === "extracting" ||
              doc.status === "pending_extraction") && (
              // A real `disabled` button, not a styled-dead Link — a screen reader must not announce
              // an actionable control that silently does nothing.
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Still reading your document — this becomes available when it's ready"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.55rem 1rem",
                  borderRadius: "0.6rem",
                  border: "1px solid var(--rule)",
                  background: "var(--card)",
                  color: "var(--ink-soft)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "default",
                }}
              >
                Still reading your document…
              </button>
            )}
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
