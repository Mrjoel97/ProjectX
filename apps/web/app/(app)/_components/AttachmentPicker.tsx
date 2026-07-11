"use client";

import { api } from "@pikar/backend/api";
import {
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS,
  MIME_ALLOWLIST,
} from "@pikar/core/validateSubmit";
import type { FunctionArgs } from "convex/server";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";

// The exact descriptor the submit mutation accepts (branded storageId included) — derived
// from the api so the picker and requests.submit share one source of truth, no dataModel import.
export type UploadedAttachment = FunctionArgs<typeof api.requests.submit>["attachments"][number];

// Upload-first (CONTEXT): the file goes to Convex storage as it is picked, so requests.submit
// receives a ready storageId and there is no orphaned half-request to reap. Client validation
// mirrors validateSubmit's server checks — same constants, UX only; the server is the boundary.
export function AttachmentPicker({
  attachments,
  onChange,
}: {
  attachments: UploadedAttachment[];
  onChange: (next: UploadedAttachment[]) => void;
}) {
  const generateUploadUrl = useMutation(api.requests.generateUploadUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const picked = Array.from(e.target.files ?? []);
    // Reset so re-picking the same file re-fires change.
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;

    if (attachments.length + picked.length > MAX_ATTACHMENTS) {
      setError(`Max ${MAX_ATTACHMENTS} attachments.`);
      return;
    }

    setBusy(true);
    const next = [...attachments];
    try {
      for (const file of picked) {
        if (!MIME_ALLOWLIST.has(file.type)) {
          setError(`${file.name}: unsupported file type.`);
          continue;
        }
        if (file.size > MAX_ATTACHMENT_SIZE) {
          setError(`${file.name}: over ${Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024))}MB.`);
          continue;
        }
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) {
          setError(`${file.name}: upload failed.`);
          continue;
        }
        const { storageId } = (await res.json()) as { storageId: UploadedAttachment["storageId"] };
        next.push({ storageId, filename: file.name, mimeType: file.type, size: file.size });
      }
      onChange(next);
    } finally {
      setBusy(false);
    }
  }

  function remove(storageId: UploadedAttachment["storageId"]) {
    onChange(attachments.filter((a) => a.storageId !== storageId));
    setError(null);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={busy || attachments.length >= MAX_ATTACHMENTS}
        onChange={(e) => void onPick(e)}
      />
      {busy && <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem" }}>Uploading…</span>}
      {error && (
        <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: "0.4rem 0 0" }}>
          {error}
        </p>
      )}
      {attachments.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0.6rem 0 0", display: "grid", gap: "0.4rem" }}>
          {attachments.map((a) => (
            <li
              key={a.storageId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.4rem 0.6rem",
                border: "1px solid var(--border, #e5e5e5)",
                borderRadius: "0.5rem",
                fontSize: "0.85rem",
              }}
            >
              <span style={{ fontWeight: 600 }}>{a.filename}</span>
              {/* Honest inline caveat (CONTEXT) — one line, deleted when Phase 4 (INTK-02) reads contents. */}
              <span style={{ color: "#666" }}>Attached. Pikar can't read file contents yet.</span>
              <button
                type="button"
                onClick={() => remove(a.storageId)}
                style={{ marginLeft: "auto", cursor: "pointer" }}
                aria-label={`Remove ${a.filename}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
