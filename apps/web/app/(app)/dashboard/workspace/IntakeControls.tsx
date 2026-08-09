"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useRef, useState } from "react";
import { MicIcon, PaperclipIcon } from "../../../(auth)/icons";

// The intake-specific composer controls (INTK-02 attach / INTK-03 one-shot dictate). Fully
// self-contained — ChatPane.tsx's composer mounts ONE line `<IntakeControls threadId={threadId} />`
// once `threadId` is minted (cross-lane note, 04-05-SUMMARY.md; mount landed post-merge).
//
// Upload flow mirrors AttachmentPicker.tsx/requests.ts's precedent: generateUploadUrl -> POST
// the raw bytes -> the resulting storageId feeds the governed intake action, which classifies,
// extracts (bounded GRDL-01 exception), redacts (fail-closed), costs, audits (refs-only), and
// MERGES into the SAME conversation via the existing api.cockpit.sendCockpitMessage (intake.ts,
// Plan 04) — IntakeControls never touches the conversation directly; it only drives the upload.
//
// ONE-SHOT dictation only (record -> stop -> transcribe). NO WebRTC/realtime/ephemeral tokens
// (that boundary is Phase 6 — 04-05-PLAN.md Pitfall 6).

// Client-side mirror of intake.ts's INTAKE_UPLOAD_CAP_BYTES — that module is a "use node" Convex
// action (server-only), not importable into this client bundle. UX guard only; the server always
// re-derives the authoritative cap from the real loaded bytes (intake.ts's Rule-2 discipline).
const INTAKE_UPLOAD_CAP_BYTES = 20 * 1024 * 1024; // 20 MiB — keep in sync with intake.ts
const CAP_LABEL = `${Math.floor(INTAKE_UPLOAD_CAP_BYTES / (1024 * 1024))}MB`;

// Extensions are listed ALONGSIDE the MIME types on purpose: Chrome resolves an `accept` MIME type
// to extensions via the OS registry, and Windows has no entry for text/markdown — so a MIME-only
// list makes .md files invisible in the picker (the folder just looks empty). classify() already
// routes both text/markdown and a .md filename to the "document" path.
const ATTACH_ACCEPT = "image/*,application/pdf,audio/*,text/plain,text/markdown,.txt,.md,.markdown";

type StorageId = FunctionArgs<typeof api.intake.attachToThread>["storageId"];

/**
 * Attach picker + one-shot MediaRecorder dictation, wired through generateUploadUrl -> POST ->
 * intake.attachToThread/dictateToThread. Self-contained: takes `threadId` (minted by the first
 * chat turn, same lift ChatPane already does) and renders no conversation output itself — the
 * merge happens server-side and the existing chat/card views pick it up reactively.
 */
export function IntakeControls({ threadId }: { threadId: string }) {
  const generateUploadUrl = useMutation(api.intakeDb.generateUploadUrl);
  const attachToThread = useAction(api.intake.attachToThread);
  const dictateToThread = useAction(api.intake.dictateToThread);

  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dictationTestInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function upload(file: Blob, mimeType: string): Promise<StorageId | null> {
    const url = await generateUploadUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: file,
    });
    if (!res.ok) return null;
    const { storageId } = (await res.json()) as { storageId: StorageId };
    return storageId;
  }

  async function runAttach(file: File) {
    if (busy) return;
    if (file.size > INTAKE_UPLOAD_CAP_BYTES) {
      setError(`${file.name}: over ${CAP_LABEL}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const mimeType = file.type || "application/octet-stream";
      const storageId = await upload(file, mimeType);
      if (!storageId) {
        setError(`${file.name}: upload failed.`);
        return;
      }
      await attachToThread({ threadId, storageId, filename: file.name, mimeType, size: file.size });
    } catch {
      setError(`${file.name}: couldn't process that file. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function runDictate(blob: Blob) {
    if (busy) return;
    if (blob.size > INTAKE_UPLOAD_CAP_BYTES) {
      setError(`Recording: over ${CAP_LABEL}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const storageId = await upload(blob, blob.type || "audio/webm");
      if (!storageId) {
        setError("Dictation upload failed.");
        return;
      }
      await dictateToThread({ threadId, storageId });
    } catch {
      setError("Couldn't process the dictation. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (file) void runAttach(file);
  }

  // Headless-safe dictation seam: a headless Playwright run can't grant a real microphone, so
  // this hidden test-only input drives the SAME upload -> dictateToThread path a real
  // recording's onstop handler takes below (intake.spec.ts, Task 2). Never rendered for real use.
  function onPickDictationTestFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (dictationTestInputRef.current) dictationTestInputRef.current.value = "";
    if (file) void runDictate(file);
  }

  async function toggleRecord() {
    if (busy) return;
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        void runDictate(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("Microphone access was denied — dictation needs it to record.");
    }
  }

  const locked = busy || recording;

  // display:contents — the paperclip/mic triggers sit inline in the composer's icon row
  // (BRAND.md §5, same idiom as AttachmentPicker) while the error line wraps full-width below.
  return (
    <div style={{ display: "contents" }}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACH_ACCEPT}
        aria-label="Attach a file"
        data-testid="attach-file-input"
        disabled={locked}
        onChange={onPickFile}
        style={{ display: "none" }}
      />
      <button
        type="button"
        className="icon-btn"
        aria-label="Attach a file"
        title="Attach a file — its content joins the conversation"
        disabled={locked}
        onClick={() => fileInputRef.current?.click()}
      >
        <PaperclipIcon size={17} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={recording ? "Stop recording" : "Record dictation"}
        aria-pressed={recording}
        title={recording ? "Stop recording" : "Record dictation"}
        disabled={busy && !recording}
        onClick={() => void toggleRecord()}
        style={recording ? { background: "var(--teal-600)", color: "#fff" } : undefined}
      >
        <MicIcon size={17} />
      </button>
      {recording && (
        <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>Recording…</span>
      )}
      {busy && !recording && (
        <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>Extracting…</span>
      )}
      {error && (
        <p
          role="alert"
          style={{ color: "#dc2626", fontSize: "0.8rem", margin: 0, flexBasis: "100%" }}
        >
          {error}
        </p>
      )}
      <input
        ref={dictationTestInputRef}
        type="file"
        accept="audio/*"
        data-testid="dictation-test-input"
        disabled={locked}
        onChange={onPickDictationTestFile}
        style={{ display: "none" }}
      />
    </div>
  );
}
