"use client";

import { api } from "@pikar/backend/api";
import { resolveMimeType } from "@pikar/core/validateSubmit";
// The SUBPATH, never the barrel: `@pikar/vault` pulls xlsx (~1 MB) and fflate into the client
// bundle. `@pikar/voice` is the precedent for a source-export workspace package imported by a
// client component with no `transpilePackages` entry.
import { capMB, VAULT_FILE_CAP_BYTES, VAULT_VIDEO_CAP_BYTES } from "@pikar/vault/constants";
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
//
// TWO RAILS, one component. The SINGLE-FILE rail above ingests here, hash and all. The FOLDER rail
// only PICKS: it hands a PickedFolder up and uploads nothing, because folder hashing moved
// server-side (plan 04) and the pre-flight owns Start.

// Convex storageId brand, derived from the mutation arg (no dataModel import — repo convention).
type StorageId = FunctionArgs<typeof api.vault.vaultUpload>["storageId"];

const SEARCHABLE_MIME = new Set(["text/plain", "text/markdown", "text/csv"]);

// Browser file.type is unreliable for .md/.csv (often empty) — the extension fallback lives in
// @pikar/core/validateSubmit so this and the cockpit AttachmentPicker cannot drift apart.

/** A picked directory. Produced here, HELD BY `VaultPage` (page.tsx's Refresh `key` would otherwise
 *  destroy it and force a re-pick of a 1.5 GB tree), consumed by `PreFlight`. */
export type PickedFolder = {
  /** First segment of `File.webkitRelativePath` ("MyCompany/2025/pl.xlsx" → "MyCompany"). */
  name: string;
  /** File handles in pick order. Held so Start uploads without a re-pick. */
  files: File[];
  /** THE reserve manifest, INDEX-ALIGNED with `files` and built ONCE at pick time so the reference
   *  (and therefore the Convex query token) is stable across renders. NO FILENAME EVER — a filename
   *  would be content in an audit payload (guardrails.ts:464-466). This exact array is what
   *  `folderEstimate` prices AND what `reserveFolder` receives, which is what makes the number on
   *  the pre-flight card the number the reserve actually takes. */
  manifest: { size: number; mimeType: string }[];
  /** Sum of `manifest[].size`. */
  totalBytes: number;
};

// React's input typings omit the browser-standard directory-picker attributes. Spreading this
// object keeps them declarative in the first render instead of racing a post-mount setAttribute.
export const DIRECTORY_INPUT_ATTRIBUTES = {
  webkitdirectory: "",
  directory: "",
} as const;

export function pickedFolderFromFiles(files: FileList | null): PickedFolder | null {
  const picked = Array.from(files ?? []);
  if (picked.length === 0) return null;
  const name = picked[0]?.webkitRelativePath.split("/")[0] || "Folder";
  const manifest = picked.map((file) => ({
    size: file.size,
    mimeType: resolveMimeType(file.name, file.type),
  }));
  return {
    name,
    files: picked,
    manifest,
    totalBytes: manifest.reduce((total, item) => total + item.size, 0),
  };
}

/** One file's result. Replaces the single `error` string the upload loop used to overwrite. */
export type FileOutcome = { name: string; ok: boolean; note?: string };

/** The surface's two pill geometries, lifted out of this file's own Brain-Dump buttons so
 *  `PreFlight` and `FolderBreadcrumb` reuse them instead of re-typing the literal three times.
 *  `--teal-600` is a FILL with `#fff` text only — never small teal body text (BRAND §6, ~2.9:1). */
export const pillPrimary = (disabled: boolean): React.CSSProperties => ({
  padding: "0.5rem 1.2rem",
  borderRadius: "999px",
  border: "none",
  cursor: disabled ? "default" : "pointer",
  background: "var(--teal-600)",
  color: "#fff",
  fontFamily: "inherit",
  fontWeight: 600,
  opacity: disabled ? 0.5 : 1,
});

export const pillSecondary = (disabled: boolean): React.CSSProperties => ({
  padding: "0.5rem 1.2rem",
  borderRadius: "999px",
  border: "1px solid var(--rule)",
  cursor: disabled ? "default" : "pointer",
  background: "transparent",
  color: "var(--ink-soft)",
  fontFamily: "inherit",
  opacity: disabled ? 0.5 : 1,
});

async function hashBytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function Dropzone({
  onPickFolder,
}: {
  /** A directory was chosen. Handed straight up — this subtree is remounted by page.tsx's
   *  `key={nonce}` on every Refresh, so Dropzone must never hold the selection itself. */
  onPickFolder: (picked: PickedFolder) => void;
}) {
  const generateUploadUrl = useMutation(api.requests.generateUploadUrl);
  const vaultUpload = useMutation(api.vault.vaultUpload);
  const ingestText = useMutation(api.vault.vaultIngestText);
  const inputRef = useRef<HTMLInputElement>(null);
  // A SECOND input: `webkitdirectory` makes an input directory-ONLY, so it cannot replace the file
  // input above. It is placed over the visible control so the browser receives a native user click.
  const dirRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // `error` stays for the SINGLE-LINE notes (a Brain-Dump failure, a dropped directory).
  // Per-file upload results are a LIST — see `outcomes`.
  const [error, setError] = useState<string | null>(null);
  // One entry per file, accumulated. The old code wrote every failure into `error`, so nine
  // failures out of ten files left only the last message and no record of which ones landed.
  const [outcomes, setOutcomes] = useState<FileOutcome[]>([]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");

  async function ingestOne(file: File) {
    const mimeType = resolveMimeType(file.name, file.type);
    // Client-side size guard: fail fast with a clear message BEFORE uploading the bytes, so an
    // oversize file doesn't waste a full upload round-trip only to be rejected server-side.
    if (mimeType.startsWith("video/")) {
      if (file.size > VAULT_VIDEO_CAP_BYTES)
        throw new Error(`${file.name}: video too large — max ${capMB(VAULT_VIDEO_CAP_BYTES)}`);
    } else if (file.size > VAULT_FILE_CAP_BYTES) {
      throw new Error(`${file.name}: file too large — max ${capMB(VAULT_FILE_CAP_BYTES)}`);
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
    setOutcomes([]);
    const results: FileOutcome[] = [];
    try {
      for (const file of picked) {
        try {
          await ingestOne(file);
          results.push({ name: file.name, ok: true });
        } catch (e) {
          // The loop CONTINUES: one bad file must not abandon the rest, and every result is kept
          // so the user is told exactly which files landed and which did not (BRAND §1).
          results.push({
            name: file.name,
            ok: false,
            note: e instanceof Error ? e.message : "upload failed",
          });
        }
        setOutcomes([...results]);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** A directory was picked. This rail does NOT hash in the browser — `vaultUploadFolderFile`
   *  hashes server-side (plan 04), and 400 client-side `arrayBuffer()` reads is exactly what that
   *  move avoided. Nothing is uploaded here; the pre-flight owns Start. */
  function handleFolderPick(files: FileList | null) {
    const picked = pickedFolderFromFiles(files);
    if (!picked) return;
    setError(null);
    setOutcomes([]);
    onPickFolder(picked);
    if (dirRef.current) dirRef.current.value = "";
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
    <section
      className="clay-card"
      aria-labelledby="vault-upload-heading"
      style={{
        display: "grid",
        gap: "0.85rem",
        margin: "1.5rem 0 0",
        padding: "clamp(1rem, 2.5vw, 1.5rem)",
        border: "1px solid var(--vault-border)",
        borderRadius: "1rem",
        background: "var(--vault-paper)",
        boxShadow: "var(--vault-shadow)",
      }}
    >
      <div>
        <p className="caps-label">Add to your vault</p>
        <h2 id="vault-upload-heading" style={{ margin: "0.25rem 0 0", fontSize: "1.1rem" }}>
          Upload source material
        </h2>
      </div>
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
          // A dropped DIRECTORY contributes nothing to `dataTransfer.files`, so this used to fall
          // through to handleFiles' `picked.length === 0` early return and appear to do nothing at
          // all — worse than not supporting it. Say so instead.
          // ponytail: detect and redirect, no traversal. Upgrade path: walk the tree here with
          // webkitGetAsEntry() + paginated readEntries().
          // `webkitGetAsEntry()` is only valid synchronously inside the drop handler.
          if (Array.from(e.dataTransfer.items).some((i) => i.webkitGetAsEntry()?.isDirectory)) {
            setError("Folders can't be dropped — use “Choose a folder” below.");
            return;
          }
          void handleFiles(e.dataTransfer.files);
        }}
        aria-label="Click to upload or drag and drop"
        className="vault-button clay-dropzone"
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
          <span style={{ color: "var(--ink)", fontWeight: 700 }}>Click to upload</span> or drag and
          drop
        </span>
        <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)", textAlign: "center" }}>
          Searchable: PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown
          <br />
          Images & Videos: text extracted automatically — searchable too
          <br />
          Up to {capMB(VAULT_FILE_CAP_BYTES)} per file (video {capMB(VAULT_VIDEO_CAP_BYTES)})
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

      {outcomes.some((o) => !o.ok) && (
        <div role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
          <p style={{ margin: 0 }}>
            {outcomes.filter((o) => !o.ok).length} of {outcomes.length} file
            {outcomes.length === 1 ? "" : "s"} couldn't be uploaded.
          </p>
          <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
            {outcomes.map((o, i) =>
              o.ok ? null : (
                // Two picked files can share a name across subdirectories, so the name alone is
                // not unique. `outcomes` is append-only and never reordered, so the rule's
                // reorder hazard cannot occur here.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only list, never reordered
                <li key={`${o.name}-${i}`}>
                  {o.name}: {o.note}
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      <div style={{ marginTop: "0.75rem" }}>
        {!pasteOpen ? (
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <span
              className={`vault-button vault-folder-picker${busy ? " is-disabled" : ""}`}
              style={pillSecondary(busy)}
            >
              <input
                {...DIRECTORY_INPUT_ATTRIBUTES}
                ref={dirRef}
                type="file"
                multiple
                disabled={busy}
                aria-label="Choose a folder to upload"
                onChange={(event) => handleFolderPick(event.target.files)}
              />
              Choose a folder
            </span>
            <button
              type="button"
              className="vault-button"
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
          </div>
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
                className="vault-button vault-button-primary"
                disabled={busy || !paste.trim()}
                onClick={() => void submitPaste()}
                style={pillPrimary(busy || !paste.trim())}
              >
                Save Brain Dump
              </button>
              <button
                type="button"
                className="vault-button"
                onClick={() => {
                  setPasteOpen(false);
                  setPaste("");
                }}
                style={pillSecondary(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
