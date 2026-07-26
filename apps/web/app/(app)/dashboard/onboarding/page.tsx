"use client";

import { api } from "@pikar/backend/api";
import type { ProfileInput } from "@pikar/core";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrainIcon, MicIcon, PaperclipIcon, SendIcon } from "../../../(auth)/icons";

// ONBD-01/02 first-run onboarding — the forced-but-resumable gate's destination (layout.tsx redirects
// here until a business_profile is committed). This is the conversational SURFACE half of the
// 11-RESEARCH Open-Q1 split: it reuses the cockpit's chat idiom (BRAND §5 — agent bubble + rounded
// composer + teal Send, adapted, NOT the thread-bound ChatPane) but runs extraction through the
// UNGATED api.onboarding.* adapter, never the gated cockpit-agent tool-loop (that would endanger the
// golden fixtures). Three intake modalities all reduce to `intakeText` for extractProfile:
//   • pasted text  → the compose box text, straight through
//   • uploaded file → vault.vaultUpload → poll listVaultDocs until the row's extracted `text` lands
//   • spoken brief → MediaRecorder one-shot → uploaded as audio → SAME vault transcription/poll path
// SC#1: nothing is silently committed — the extracted draft is reviewed and edited first, and
// commitProfile is the sole write. Resumable via a lightweight localStorage draft (RESEARCH Open-Q2
// — no new onboarding table): the edited profile survives a reload; it's cleared on commit.
//
// Phase 15.1 (design §9, defect 1b): there is NO tier control on this page. The persona confirm/change
// pill block is GONE — not hidden — and `commitProfile`'s arg validator has no field for a tier, so
// this page could not send one if it returned. `commitProfile` now also REFUSES until the tier FACTS
// exist (INCOMPLETE_ONBOARDING), which the conversational rewrite in plan 07 asks for. Between this
// plan and that one this page is therefore non-functional at the final step. That is INTENTIONAL and
// fail-closed: nothing ships mid-phase, and a placeholder facts form here would be the silent
// fallback this phase exists to remove.
//
// ponytail: the "spoken brief" reuses the vault transcription rail (record → upload audio → transcribe
// → text), not the Phase-6 live WebRTC session — onboarding needs a one-shot brief, not a live call.
// Upgrade path: wire dashboard/voice/LiveSession here if a conversational live intake is ever wanted.

const DRAFT_KEY = "pikar:onboarding-draft-v1";

// Convex storageId brand, derived from the mutation arg (no dataModel import — repo convention,
// same as Dropzone.tsx / IntakeControls.tsx).
type StorageId = FunctionArgs<typeof api.vault.vaultUpload>["storageId"];

async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Agent chat bubble (BRAND §5 — agent = white card, --ink, left-aligned).
const agentBubble: React.CSSProperties = {
  padding: "0.7rem 0.95rem",
  borderRadius: "1rem 1rem 1rem 0.25rem",
  background: "var(--card)",
  color: "var(--ink)",
  border: "1px solid var(--rule)",
  boxShadow: "0 8px 24px -20px rgb(14 20 25 / 45%)",
  maxWidth: "36rem",
};

const label: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  borderRadius: "0.7rem",
  border: "1px solid var(--rule)",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  background: "var(--card)",
  color: "var(--ink)",
  resize: "vertical",
};

export default function OnboardingPage() {
  const router = useRouter();
  const extract = useAction(api.onboarding.extractProfile);
  const commit = useMutation(api.onboarding.commitProfile);
  const generateUploadUrl = useMutation(api.requests.generateUploadUrl);
  const vaultUpload = useMutation(api.vault.vaultUpload);

  const [text, setText] = useState("");
  const [profile, setProfile] = useState<ProfileInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitMsg, setWaitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Resumability: restore a saved draft on mount, persist on every edit, clear on commit.
  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      try {
        setProfile(JSON.parse(raw) as ProfileInput);
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
  }, []);
  useEffect(() => {
    if (profile) localStorage.setItem(DRAFT_KEY, JSON.stringify(profile));
  }, [profile]);

  // Poll the uploaded doc (file/voice) until the ingest rail populates its extracted `text`. The row
  // sits at pending_extraction/extracting first (no text yet) — only feed extractProfile once text
  // lands; a `failed` row means the format couldn't be read.
  const docs = useQuery(api.vault.listVaultDocs, pendingDocId ? {} : "skip");
  useEffect(() => {
    if (!pendingDocId || !docs) return;
    const doc = docs.find((d) => d._id === pendingDocId);
    if (!doc) return;
    if (doc.status === "failed") {
      setPendingDocId(null);
      setBusy(false);
      setError("We couldn't read that file. Try pasting or recording your brief instead.");
      return;
    }
    if (doc.text && doc.text.trim() !== "") {
      const extracted = doc.text;
      setPendingDocId(null);
      void runExtract(extracted);
    }
  }, [pendingDocId, docs]);

  async function runExtract(intakeText: string) {
    setBusy(true);
    setError(null);
    setWaitMsg("Understanding your business…");
    try {
      const p = await extract({ intakeText });
      setProfile(p);
    } catch {
      setError("Something went wrong reading that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function onSendText() {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    void runExtract(t);
  }

  async function uploadAndWait(blob: Blob, mimeType: string, filename: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setWaitMsg("Uploading…");
    try {
      const buf = await blob.arrayBuffer();
      const contentHash = await sha256(buf);
      const url = await generateUploadUrl();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: blob,
      });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = (await res.json()) as { storageId: StorageId };
      const { vaultDocId } = await vaultUpload({
        storageId,
        filename,
        mimeType,
        size: blob.size,
        contentHash,
      });
      setWaitMsg("Reading your brief…");
      setPendingDocId(vaultDocId); // busy stays true — the poll effect clears it via runExtract
    } catch {
      setBusy(false);
      setError("Upload failed. Try again, or paste your brief instead.");
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (file) void uploadAndWait(file, file.type || "application/octet-stream", file.name);
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
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        void uploadAndWait(blob, blob.type || "audio/webm", "spoken-brief.webm");
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError("Microphone access was denied — allow it to record a brief.");
    }
  }

  function set<K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  // Sparse-start (idea-stage): only a one-line description is required to enter — name/stage/
  // offering/target customer are optional and enriched later. Mirrors @pikar/core validateProfile so
  // the button and the mutation agree. The FACT slots are a separate gate that lives in
  // `commitProfile` (SC#3b) — deliberately not mirrored here, because a client-side mirror of a
  // fail-closed server gate is exactly how a gate quietly stops being one.
  const requiredFilled = !!profile && profile.oneLineDescription.trim() !== "";

  async function onCommit() {
    if (!profile || committing || !requiredFilled) return;
    setCommitting(true);
    setError(null);
    try {
      // Field-by-field, never a spread of `profile`. A `v.object` arg validator rejects an EXTRA key
      // outright, and a localStorage draft written before this plan still carries `persona` — a
      // spread would turn every such returning user's Confirm into a hard validation failure. This
      // also means a future field cannot leak into the write by accident.
      await commit({
        profile: {
          name: profile.name,
          oneLineDescription: profile.oneLineDescription,
          stage: profile.stage,
          offering: profile.offering,
          targetCustomer: profile.targetCustomer,
          primaryGoals: profile.primaryGoals.map((s) => s.trim()).filter(Boolean),
          knownConstraints: profile.knownConstraints.map((s) => s.trim()).filter(Boolean),
        },
      });
      localStorage.removeItem(DRAFT_KEY);
      router.replace("/dashboard"); // gate now passes → cockpit released
    } catch {
      setError("Couldn't save your profile. Please check the fields and try again.");
      setCommitting(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: "44rem",
        margin: "0 auto",
        padding: "2rem 1.25rem",
        display: "grid",
        gap: "1.5rem",
      }}
    >
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <span style={label}>Welcome to Pikar AI</span>
        <h1
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2rem)",
            fontWeight: 700,
            color: "var(--ink)",
            margin: 0,
          }}
        >
          Let&apos;s set up your business
        </h1>
      </header>

      {/* Agent greeting bubble (BRAND §5 chat idiom) */}
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            width: "1.9rem",
            height: "1.9rem",
            borderRadius: "999px",
            background: "var(--teal-900)",
            color: "var(--teal-400)",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <BrainIcon size={15} />
        </span>
        <div style={agentBubble}>
          Good to meet you, Executive. Tell me about your business — <strong>type it</strong>,
          upload a document, or record a quick spoken brief. I&apos;ll read it and show you what I
          understood before anything is saved.
        </div>
      </div>

      {!profile ? (
        /* ── Intake: composer with the three modalities ── */
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {busy ? (
            <div
              role="status"
              aria-live="polite"
              style={{ ...agentBubble, display: "flex", alignItems: "center", gap: "0.6rem" }}
            >
              <span
                className="btn-spinner"
                aria-hidden="true"
                style={{ borderTopColor: "var(--teal-600)" }}
              />
              {waitMsg || "Working…"}
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--rule)",
                borderRadius: "1rem",
                padding: "0.6rem 0.75rem",
                background: "rgb(255 255 255 / 88%)",
                boxShadow: "0 10px 30px -24px rgb(14 20 25 / 45%)",
                display: "grid",
                gap: "0.5rem",
              }}
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSendText();
                  }
                }}
                placeholder="Describe your business — what you do, who you serve, where you're at…"
                rows={3}
                aria-label="Describe your business"
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  fontFamily: "inherit",
                  fontSize: "0.95rem",
                  background: "transparent",
                  color: "var(--ink)",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  // Extensions listed alongside the MIME types: Windows has no registry entry for
                  // text/markdown, so a MIME-only accept hides .md files in the picker.
                  accept="image/*,application/pdf,audio/*,text/plain,text/markdown,text/csv,.txt,.md,.markdown,.csv"
                  aria-label="Upload a document"
                  onChange={onPickFile}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Upload a document"
                  title="Upload a document — a deck, a one-pager, notes"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <PaperclipIcon size={17} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={recording ? "Stop recording" : "Record a spoken brief"}
                  aria-pressed={recording}
                  title={recording ? "Stop recording" : "Record a spoken brief"}
                  onClick={() => void toggleRecord()}
                  style={recording ? { background: "var(--teal-600)", color: "#fff" } : undefined}
                >
                  <MicIcon size={17} />
                </button>
                {recording && (
                  <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                    Recording… tap to stop
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  aria-label="Send"
                  title="Send"
                  disabled={text.trim() === ""}
                  onClick={onSendText}
                  style={{
                    width: "2.5rem",
                    height: "2.5rem",
                    flex: "none",
                    borderRadius: "999px",
                    background: "var(--teal-600)",
                    color: "#fff",
                    border: "none",
                    display: "grid",
                    placeItems: "center",
                    cursor: text.trim() === "" ? "default" : "pointer",
                    opacity: text.trim() === "" ? 0.5 : 1,
                    boxShadow: "0 8px 18px -8px rgb(0 150 137 / 70%)",
                  }}
                >
                  <SendIcon size={16} />
                </button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>
              {error}
            </p>
          )}
        </div>
      ) : (
        /* ── Review gate: pre-filled, editable card (no tier control — design §9) ── */
        <div
          style={{
            background: "var(--card)",
            border: "1px solid var(--rule)",
            borderRadius: "1.1rem",
            padding: "1.25rem",
            boxShadow: "0 12px 32px -24px rgb(14 20 25 / 45%)",
            display: "grid",
            gap: "1rem",
          }}
        >
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <span style={label}>Here&apos;s what I understood — edit anything</span>
            <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
              Nothing is saved until you confirm below.
            </p>
          </div>

          <LabeledField label="Business name (optional)">
            <input
              style={field}
              value={profile.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="One-line description">
            <input
              style={field}
              value={profile.oneLineDescription}
              onChange={(e) => set("oneLineDescription", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="Stage (optional)">
            <input
              style={field}
              value={profile.stage}
              onChange={(e) => set("stage", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="Offering (optional)">
            <textarea
              style={field}
              rows={2}
              value={profile.offering}
              onChange={(e) => set("offering", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="Target customer (optional)">
            <textarea
              style={field}
              rows={2}
              value={profile.targetCustomer}
              onChange={(e) => set("targetCustomer", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="Primary goals (one per line)">
            <textarea
              style={field}
              rows={3}
              value={profile.primaryGoals.join("\n")}
              onChange={(e) => set("primaryGoals", e.target.value.split("\n"))}
            />
          </LabeledField>
          <LabeledField label="Known constraints (one per line)">
            <textarea
              style={field}
              rows={2}
              value={profile.knownConstraints.join("\n")}
              onChange={(e) => set("knownConstraints", e.target.value.split("\n"))}
            />
          </LabeledField>

          {error && (
            <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={committing || !requiredFilled}
              onClick={() => void onCommit()}
              style={{
                padding: "0.65rem 1.5rem",
                borderRadius: "999px",
                border: "none",
                background: "var(--teal-600)",
                color: "#fff",
                fontWeight: 700,
                fontSize: "0.95rem",
                cursor: committing || !requiredFilled ? "default" : "pointer",
                opacity: committing || !requiredFilled ? 0.5 : 1,
                boxShadow: "0 8px 18px -8px rgb(0 150 137 / 70%)",
              }}
            >
              {committing ? "Saving…" : "Confirm & enter Pikar AI"}
            </button>
            <button
              type="button"
              disabled={committing}
              onClick={() => {
                localStorage.removeItem(DRAFT_KEY);
                setProfile(null);
                setError(null);
              }}
              style={{
                padding: "0.65rem 1.25rem",
                borderRadius: "999px",
                border: "1px solid var(--rule)",
                background: "transparent",
                color: "var(--ink-soft)",
                fontWeight: 600,
                fontSize: "0.9rem",
                cursor: "pointer",
              }}
            >
              Start over
            </button>
            {!requiredFilled && (
              <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                Add a one-line description to continue — the rest is optional and you can fill it in
                later as your idea takes shape.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledField({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: "0.35rem" }}>
      <span style={label}>{text}</span>
      {children}
    </label>
  );
}
