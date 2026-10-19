"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { MicIcon, PaperclipIcon } from "../../../(auth)/icons";
import { normalizeAudio } from "../../../lib/normalizeAudio";
import { browserClientContext } from "./useSendCockpitMessage";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;
const ATTACH_ACCEPT = "image/*,application/pdf,audio/*,text/plain,text/markdown,.txt,.md,.markdown";
type Uploaded = FunctionArgs<typeof api.intake.submitInputs>["files"][number];
type Staged = { id: string; file: File };
export type IntakeControlsHandle = {
  hasPending: () => boolean;
  isRecording: () => boolean;
  isBusy: () => boolean;
  submit: (instructions: string, threadId?: string) => Promise<boolean>;
};
type Props = {
  threadId?: string;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onRecordingChange?: (recording: boolean) => void;
  onThread: (id: string, label: string) => void;
  onTranscribed: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
  children: ReactNode;
};

/** Files wait for one explicit Send with optional instructions. Recording Stop produces editable text only.
 * A first submission creates only conversation metadata, then enters the same governed intake
 * pipeline. No greeting or preliminary model turn is needed. Failed inputs stay available. */
export const IntakeControls = forwardRef<IntakeControlsHandle, Props>(function IntakeControls(
  {
    threadId,
    disabled = false,
    onPendingChange,
    onRecordingChange,
    onThread,
    onTranscribed,
    onBusyChange,
    children,
  },
  ref,
) {
  const generateUploadUrl = useMutation(api.intakeDb.generateUploadUrl);
  const prepareThread = useAction(api.cockpit.prepareIntakeThread);
  const submitInputs = useAction(api.intake.submitInputs);
  const transcribeDraft = useAction(api.intake.transcribeDraft);
  const [voiceDraft, setVoiceDraft] = useState<Blob | null>(null);
  const [pending, setPending] = useState<Staged[]>([]);
  const pendingRef = useRef<Staged[]>([]);
  const uploads = useRef(new Map<string, Uploaded>());
  const destination = useRef(threadId);
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const submission = useRef(false);
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const acquiring = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dictationInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    destination.current = threadId;
  }, [threadId]);
  useEffect(() => {
    onPendingChange?.(pending.length > 0);
  }, [pending, onPendingChange]);
  useEffect(() => {
    onRecordingChange?.(recording);
  }, [recording, onRecordingChange]);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      for (const track of recorder.current?.stream.getTracks() ?? []) track.stop();
    };
  }, []);
  const update = (next: Staged[]) => {
    pendingRef.current = next;
    setPending(next);
  };
  const remove = (id: string) => {
    uploads.current.delete(id);
    update(pendingRef.current.filter((item) => item.id !== id));
  };
  function stage(files: File[]): boolean {
    if (!files.length || submission.current) return false;
    if (pendingRef.current.length + files.length > 20) {
      setError("Choose up to 20 files per message. Split larger folders into smaller groups.");
      return false;
    }
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      setError("Each file or recording must be 20 MB or smaller.");
      return false;
    }
    if (
      [...pendingRef.current.map((item) => item.file), ...files].reduce(
        (size, file) => size + file.size,
        0,
      ) > MAX_BATCH_BYTES
    ) {
      setError("Keep the files in one message under 50 MB.");
      return false;
    }
    setError(null);
    update([
      ...pendingRef.current,
      ...files.map((file) => ({ id: String(sequence.current++), file })),
    ]);
    return true;
  }
  async function submit(
    instructions: string,
    existingThreadId = destination.current,
  ): Promise<boolean> {
    if (submission.current || recordingRef.current || !pendingRef.current.length) return false;
    submission.current = true;
    setBusy(true);
    setError(null);
    const batch = [...pendingRef.current];
    try {
      let target = existingThreadId;
      if (!target) {
        const created = await prepareThread({});
        target = created.threadId;
        destination.current = target;
        onThread(target, "Uploaded files");
      }
      const files: Uploaded[] = [];
      let total = 0;
      for (const item of batch) {
        let uploaded = uploads.current.get(item.id);
        if (!uploaded) {
          const payload = item.file.type.startsWith("audio/")
            ? await normalizeAudio(item.file)
            : item.file;
          total += payload.size;
          if (payload.size > MAX_FILE_BYTES || total > MAX_BATCH_BYTES)
            throw new Error("INPUT_TOO_LARGE");
          const url = await generateUploadUrl({});
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": payload.type || "application/octet-stream" },
            body: payload,
          });
          if (!response.ok) throw new Error("UPLOAD_FAILED");
          const { storageId } = await response.json();
          uploaded = {
            storageId,
            filename: item.file.webkitRelativePath || item.file.name,
            mimeType: payload.type || "application/octet-stream",
          };
          uploads.current.set(item.id, uploaded);
        }
        files.push(uploaded);
      }
      await submitInputs({
        threadId: target,
        files,
        instructions: instructions || undefined,
        clientContext: browserClientContext(),
      });
      const accepted = new Set(batch.map((item) => item.id));
      for (const id of accepted) uploads.current.delete(id);
      update(pendingRef.current.filter((item) => !accepted.has(item.id)));
      return true;
    } catch {
      setError(
        "Could not finish this submission. Your inputs are kept. Check this conversation before trying again; use smaller files if needed.",
      );
      return false;
    } finally {
      submission.current = false;
      setBusy(false);
    }
  }
  useImperativeHandle(ref, () => ({
    hasPending: () => pendingRef.current.length > 0,
    isRecording: () => recordingRef.current,
    isBusy: () => submission.current,
    submit,
  }));
  async function readyVoice(blob: Blob) {
    if (!mounted.current || submission.current) return;
    setVoiceDraft(blob);
    submission.current = true;
    setBusy(true);
    setError(null);
    try {
      if (blob.size > MAX_FILE_BYTES) throw new Error("DICTATION_TOO_LARGE");
      const pcm = await normalizeAudio(blob);
      if (pcm.size > MAX_FILE_BYTES) throw new Error("DICTATION_TOO_LARGE");
      const url = await generateUploadUrl({});
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: pcm,
      });
      if (!response.ok) throw new Error("UPLOAD_FAILED");
      const { storageId } = await response.json();
      const result = await transcribeDraft({
        storageId,
        ...(destination.current ? { threadId: destination.current } : {}),
      });
      if (!mounted.current) return;
      onTranscribed(result.text);
      setVoiceDraft(null);
    } catch {
      if (mounted.current)
        setError(
          "Could not transcribe this recording. It is kept here so you can retry. Nothing was sent to the agent.",
        );
    } finally {
      submission.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function toggleRecord() {
    if (busy || disabled || submission.current || acquiring.current) return;
    if (recordingRef.current) {
      recorder.current?.stop();
      return;
    }
    setError(null);
    let stream: MediaStream | undefined;
    acquiring.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      rec.onstop = () => {
        for (const track of rec.stream.getTracks()) track.stop();
        recordingRef.current = false;
        if (!mounted.current) return;
        setRecording(false);
        void readyVoice(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      recorder.current = rec;
      recordingRef.current = true;
      rec.start();
      setRecording(true);
    } catch {
      for (const track of stream?.getTracks() ?? []) track.stop();
      recordingRef.current = false;
      setRecording(false);
      setError(
        "Microphone access or recording failed. Check your microphone permission and try again.",
      );
    } finally {
      acquiring.current = false;
    }
  }
  const locked = busy || disabled || recording;
  return (
    <div style={{ display: "contents" }}>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ATTACH_ACCEPT}
        aria-label="Attach a file"
        data-testid="attach-file-input"
        disabled={locked}
        onChange={(event) => {
          stage(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
        style={{ display: "none" }}
      />
      <input
        ref={folderInput}
        type="file"
        accept={ATTACH_ACCEPT}
        aria-label="Attach a folder"
        data-testid="attach-folder-input"
        disabled={locked}
        onChange={(event) => {
          stage(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
        style={{ display: "none" }}
        {...({ directory: "", webkitdirectory: "" } as Record<string, string>)}
      />
      <button
        type="button"
        className="icon-btn"
        aria-label="Attach a file"
        title="Attach files and add optional instructions"
        disabled={locked}
        onClick={() => fileInput.current?.click()}
      >
        <PaperclipIcon size={17} />
      </button>
      <button
        type="button"
        className="composer-pill"
        aria-label="Attach a folder"
        title="Attach a folder and add optional instructions"
        disabled={locked}
        onClick={() => folderInput.current?.click()}
      >
        Folder
      </button>
      <span
        style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center", marginLeft: "auto" }}
      >
        <button
          type="button"
          className="icon-btn"
          aria-label={recording ? "Stop recording" : "Record dictation"}
          title={recording ? "Stop and transcribe voice note" : "Record a voice note"}
          aria-pressed={recording}
          disabled={busy || disabled}
          onClick={() => void toggleRecord()}
          style={{
            minWidth: 44,
            minHeight: 44,
            ...(recording ? { background: "var(--teal-600)", color: "var(--card)" } : {}),
          }}
        >
          <MicIcon size={17} />
        </button>
        {children}
      </span>
      {recording && (
        <span role="status" style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}>
          Recording… Stop to review the text.
        </span>
      )}
      {busy && (
        <span role="status" style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}>
          {voiceDraft ? "Transcribing voice note…" : "Processing files…"}
        </span>
      )}
      {pending.length > 0 && (
        <div
          data-testid="pending-intake"
          role="status"
          style={{ flexBasis: "100%", display: "grid", gap: "0.3rem" }}
        >
          <span style={{ color: "var(--ink-soft)", fontSize: "0.78rem" }}>
            Ready to send. Add instructions if you want, then Send.
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            {pending.map(({ id, file }) => (
              <button
                key={id}
                type="button"
                className="composer-pill"
                disabled={locked}
                aria-label={`Remove ${file.webkitRelativePath || file.name}`}
                onClick={() => remove(id)}
                style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" }}
              >
                {file.webkitRelativePath || file.name} ×
              </button>
            ))}
          </div>
        </div>
      )}
      {voiceDraft && !busy && (
        <div style={{ flexBasis: "100%", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="composer-pill"
            disabled={locked}
            onClick={() => void readyVoice(voiceDraft)}
          >
            Retry transcription
          </button>
          <button
            type="button"
            className="composer-pill"
            disabled={locked}
            onClick={() => {
              setVoiceDraft(null);
              setError(null);
            }}
          >
            Clear voice draft
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          style={{ color: "var(--ink)", fontSize: "0.8rem", margin: 0, flexBasis: "100%" }}
        >
          {error}
        </p>
      )}
      <input
        ref={dictationInput}
        type="file"
        accept="audio/*"
        data-testid="dictation-test-input"
        disabled={locked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void readyVoice(file);
        }}
        style={{ display: "none" }}
      />
    </div>
  );
});
