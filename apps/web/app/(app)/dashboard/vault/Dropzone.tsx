"use client";

import { api } from "@pikar/backend/api";
import { resolveMimeType } from "@pikar/core/validateSubmit";
import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useRef, useState } from "react";
import { UploadCloudIcon } from "./icons";

// The upload dropzone + Brain-Dump paste (brand-024242 / brand-024258). Upload flow mirrors the
// AttachmentPicker idiom: requests.generateUploadUrl → POST the bytes → vault.vaultUpload. A
// searchable text file (TXT/MD/CSV) is read client-side so the server starts the ingest workflow
// immediately (processing → ready); a binary uploads bytes with NO text → the server stores it
// `pending_extraction` (accept-but-defer). contentHash is the SHA-256 of the actual bytes (the
// dedup key). The Brain-Dump textarea routes to vault.vaultIngestText({ source: "paste" }).
//
// The URL from generateUploadUrl is a short-lived upload capability — never logged (§4).

// Convex storageId brand, derived from the mutation arg (no dataModel import — repo convention).
type StorageId = FunctionArgs<typeof api.vault.vaultUpload>["storageId"];

// Client-side mirror of the server caps (@pikar/vault constants.ts — the source of truth that
// actually enforces). Duplicated as two plain numbers so this client component needn't depend on
// the Node-oriented @pikar/vault barrel; keep in sync if the server caps change.
const FILE_CAP_BYTES = 100 * 1024 * 1024; // VAULT_FILE_CAP_BYTES
const VIDEO_CAP_BYTES = 25 * 1000 * 1000; // VAULT_VIDEO_CAP_BYTES

const SEARCHABLE_MIME = new Set(["text/plain", "text/markdown", "text/csv"]);

// Browser file.type is unreliable for .md/.csv (often empty) — the extension fallback lives in
// @pikar/core/validateSubmit so this and the cockpit AttachmentPicker cannot drift apart.

async function hashBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function Dropzone() {
  const generateUploadUrl = useMutation(api.requests.generateUploadUrl);
  const vaultUpload = useMutation(api.vault.vaultUpload);
  const ingestText = useMutation(api.vault.vaultIngestText);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");

  async function ingestOne(file: File) {
    const mimeType = resolveMimeType(file.name, file.type);
    // Client-side size guard: fail fast with a clear message BEFORE uploading the bytes, so an
    // oversize file doesn't waste a full upload round-trip only to be rejected server-side.
    if (mimeType.startsWith("video/")) {
      if (file.size > VIDEO_CAP_BYTES) throw new Error(`${file.name}: video too large — max 25 MB`);
    } else if (file.size > FILE_CAP_BYTES) {
      throw new Error(`${file.name}: file too large — max 100 MB`);
    }
    const buf = await file.arrayBuffer();
    const contentHash = await hashBytes(buf);
    const searchable = SEARCHABLE_MIME.has(mimeType);
    const text = searchable ? new TextDecoder().decode(buf) : undefined;

    const url = await generateUploadUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: file,
    });
    if (!res.ok) throw new Error(`${file.name}: upload failed`);
    const { storageId } = (await res.json()) as { storageId: StorageId };
    await vaultUpload({
      storageId,
      filename: file.name,
      mimeType,
      size: file.size,
      contentHash,
      text,
    });
  }

  async function handleFiles(files: FileList | File[]) {
    const picked = Array.from(files);
    if (picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of picked) {
        try {
          await ingestOne(file);
        } catch (e) {
          setError(e instanceof Error ? e.message : `${file.name}: upload failed`);
        }
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function submitPaste() {
    const text = paste.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ingestText({ text, source: "paste" });
      setPaste("");
      setPasteOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that Brain Dump.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: "1.5rem 0" }}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        aria-label="Click to upload or drag and drop"
        className="clay-dropzone"
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.75rem",
          padding: "2.5rem 1rem",
          borderRadius: "1rem",
          border: `2px dashed ${dragOver ? "var(--teal-600)" : "var(--rule)"}`,
          // On drag-over, a teal tint overrides the class fill; otherwise the frosted glass shows.
          background: dragOver ? "color-mix(in srgb, var(--teal-400) 12%, transparent)" : undefined,
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          className="clay-badge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "3.5rem",
            height: "3.5rem",
            borderRadius: "999px",
            background: "color-mix(in srgb, var(--teal-400) 28%, var(--card))",
            color: "var(--teal-600)",
          }}
        >
          <UploadCloudIcon size={28} />
        </span>
        <span style={{ fontSize: "1.05rem", color: "var(--ink-soft)" }}>
          <span style={{ color: "var(--teal-600)", fontWeight: 700 }}>Click to upload</span> or drag
          and drop
        </span>
        <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)", textAlign: "center" }}>
          Searchable: PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown
          <br />
          Images & Videos: text extracted automatically — searchable too
          <br />
          Up to 100 MB per file (video 25 MB)
        </span>
        {busy && <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>Uploading…</span>}
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => void handleFiles(e.target.files ?? [])}
      />

      {error && (
        <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
          {error}
        </p>
      )}

      <div style={{ marginTop: "0.75rem" }}>
        {!pasteOpen ? (
          <button
            type="button"
            onClick={() => setPasteOpen(true)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--teal-600)",
              fontWeight: 600,
              fontSize: "0.9rem",
              padding: 0,
            }}
          >
            + Paste a Brain Dump
          </button>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Paste or type anything — notes, ideas, a transcript…"
              rows={4}
              aria-label="Brain Dump text"
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--rule)",
                fontFamily: "inherit",
                fontSize: "0.95rem",
                resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                disabled={busy || !paste.trim()}
                onClick={() => void submitPaste()}
                style={{
                  padding: "0.5rem 1.2rem",
                  borderRadius: "999px",
                  border: "none",
                  cursor: "pointer",
                  background: "var(--teal-600)",
                  color: "#fff",
                  fontWeight: 600,
                  opacity: busy || !paste.trim() ? 0.5 : 1,
                }}
              >
                Save Brain Dump
              </button>
              <button
                type="button"
                onClick={() => {
                  setPasteOpen(false);
                  setPaste("");
                }}
                style={{
                  padding: "0.5rem 1.2rem",
                  borderRadius: "999px",
                  border: "1px solid var(--rule)",
                  cursor: "pointer",
                  background: "transparent",
                  color: "var(--ink-soft)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
