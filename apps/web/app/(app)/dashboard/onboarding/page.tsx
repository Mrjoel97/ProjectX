"use client";

import { api } from "@pikar/backend/api";
import {
  BEHAVIOR_PRESETS,
  type BehaviorPreset,
  type OnboardingSlots,
  type ProfileInput,
  type SlotName,
} from "@pikar/core";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrainIcon, MicIcon, PaperclipIcon, SendIcon } from "../../../(auth)/icons";

// ONBD-01/02 first-run onboarding — the forced-but-resumable gate's destination (layout.tsx redirects
// here until a business_profile is committed). It reuses the cockpit's chat idiom (BRAND §5 — agent
// bubble + rounded composer + teal Send, adapted, NOT the thread-bound ChatPane) and runs entirely
// through the UNGATED api.onboarding.* adapter, never the gated cockpit-agent tool-loop.
//
// Phase 15.1 (design §6, plan 07) — THE FLOW, in order:
//   1. Opening turn. The three intake modalities all reduce to ONE `intakeText`:
//        • pasted text  → the compose box text, straight through
//        • uploaded file → vault.vaultUpload → poll vaultDocText until the extracted `text` lands
//        • spoken brief → MediaRecorder one-shot → uploaded as audio → the SAME transcription poll
//   2. `extractProfile(intakeText)` fills the NARRATIVE fields once. It returns no classification —
//      `profileSchema` has no persona property, so there is nowhere for a guess to go (defect 1a).
//   3. The fact conversation: `converse({slots, userMessage, history})` per user turn. The SERVER
//      picks the next question (`missingSlots` in REQUIRED_SLOTS order) and owns `done`
//      (`canComplete`) — this page never chooses either, and never renders a checklist of slot
//      names. Design §6 is a conversation, not a form wearing chat's clothes.
//   4. Agent identity (D4): a free-text name (server-sanitized) and a behaviour PRESET.
//   5. The closing beat (§6): the model's own words, elicited by the registry prompt — see
//      `runTurn` for why that costs one extra turn.
//   6. Commit, on confirm, FACTS FIRST: `tenantProfile.saveFacts` derives and persists the tier,
//      then `onboarding.commitProfile` writes the narrative (it REFUSES until the tier row exists).
//
// SC#1: nothing is silently committed — the extracted narrative is reviewed and edited first, and
// the closing beat asks for the confirmation. **There is NO tier control on this page**: the tier is
// never a choice, never a pill, never a mutation argument. The one place pills ARE correct is the
// behaviour preset, because a preset genuinely IS a user preference — see PresetGroup below.
//
// ponytail: the "spoken brief" reuses the vault transcription rail (record → upload audio →
// transcribe → text), not the Phase-6 live WebRTC session — onboarding needs a one-shot brief, not a
// live call. Upgrade path: wire dashboard/voice/LiveSession here if live intake is ever wanted.

/**
 * v2, not v1. A pre-15.1 draft carries a `persona` (deleted in plan 03) and no `slots`, so it cannot
 * rehydrate into this shape. An unknown/absent version is DROPPED rather than migrated — a
 * half-migrated draft would resume a conversation whose facts were never asked.
 */
const DRAFT_KEY = "pikar:onboarding-draft-v2";
const DRAFT_VERSION = 2 as const;

/** Display cap only. `sanitizeAgentName` on the server is the authoritative trust boundary. */
const AGENT_NAME_MAX = 40;

/**
 * The three behaviour presets (15.1-05). Each maps to a VERSIONED style directive in the skill
 * registry, which is why this is a closed enum and not a free-text box (§5, design §7).
 */
const PRESET_COPY = {
  direct:
    "Blunt. Names the binding constraint in the first sentence, no preamble, and never softens into “you might consider”.",
  coaching:
    "Opens with the tradeoff and asks the one question that would change the recommendation — then still lands a concrete next step.",
  concise: "Minimum words. The step, the proof metric, the risk. No framing prose.",
} as const satisfies Record<BehaviorPreset, string>;

const PRESET_TITLE = {
  direct: "Direct",
  coaching: "Coaching",
  concise: "Concise",
} as const satisfies Record<BehaviorPreset, string>;

/**
 * The user's language for a slot, for the recoverable INCOMPLETE_ONBOARDING message. A raw slot name
 * (or a raw error code) is never shown — a refusal the user cannot act on is a dead end.
 */
const SLOT_LABEL = {
  oneLineDescription: "what your business does",
  headcount: "how many people work on this",
  paidStaff: "how many of them are paid staff",
  revenueStage: "where you are on revenue",
  funding: "how it's funded",
  yearsOperating: "how long it's been running",
} as const satisfies Record<SlotName, string>;

type Turn = { role: "user" | "agent"; text: string };

type Draft = {
  v: typeof DRAFT_VERSION;
  profile: ProfileInput | null;
  slots: OnboardingSlots;
  transcript: Turn[];
  agentName: string;
  behaviorPreset: BehaviorPreset | null;
  closed: boolean;
};

// Convex storageId brand, derived from the mutation arg (no dataModel import — repo convention,
// same as Dropzone.tsx / IntakeControls.tsx).
type StorageId = FunctionArgs<typeof api.vault.vaultUpload>["storageId"];
// Same derive-from-the-function idiom (no dataModel import — repo convention).
type VaultDocId = FunctionArgs<typeof api.vault.vaultDocText>["vaultDocId"];

async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * `{code, missing}` off a ConvexError, or null. `INCOMPLETE_ONBOARDING` (commitProfile) and
 * `INCOMPLETE_FACTS` (saveFacts) deliberately share the shape, so one branch renders both.
 */
function readMissing(err: unknown): SlotName[] | null {
  if (!(err instanceof ConvexError)) return null;
  const data = err.data as { code?: unknown; missing?: unknown } | undefined;
  if (!data || !Array.isArray(data.missing)) return null;
  if (data.code !== "INCOMPLETE_ONBOARDING" && data.code !== "INCOMPLETE_FACTS") return null;
  return data.missing as SlotName[];
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

// User chat bubble (BRAND §5 — user = --teal-900 fill, white text, right-aligned).
const userBubble: React.CSSProperties = {
  padding: "0.7rem 0.95rem",
  borderRadius: "1rem 1rem 0.25rem 1rem",
  background: "var(--teal-900)",
  color: "#fff",
  maxWidth: "32rem",
  whiteSpace: "pre-wrap",
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

const card: React.CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1.1rem",
  padding: "1.25rem",
  boxShadow: "0 12px 32px -24px rgb(14 20 25 / 45%)",
  display: "grid",
  gap: "1rem",
};

export default function OnboardingPage() {
  const router = useRouter();
  const extract = useAction(api.onboarding.extractProfile);
  const converse = useAction(api.onboarding.converse);
  const commit = useMutation(api.onboarding.commitProfile);
  const saveFacts = useMutation(api.tenantProfile.saveFacts);
  const generateUploadUrl = useMutation(api.requests.generateUploadUrl);
  const vaultUpload = useMutation(api.vault.vaultUpload);

  const [text, setText] = useState("");
  const [profile, setProfile] = useState<ProfileInput | null>(null);
  const [slots, setSlots] = useState<OnboardingSlots>({});
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [behaviorPreset, setBehaviorPreset] = useState<BehaviorPreset | null>(null);

  const [busy, setBusy] = useState(false);
  const [waitMsg, setWaitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gaps, setGaps] = useState<SlotName[] | null>(null);
  const [pendingDocId, setPendingDocId] = useState<VaultDocId | null>(null);
  const [recording, setRecording] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Resumability (RESEARCH Open-Q2 — no new onboarding table): restore on mount, persist on every
  // change, clear only after BOTH writes succeed. A draft whose `v` is not this version is dropped.
  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw) as Partial<Draft>;
        if (d.v === DRAFT_VERSION) {
          setProfile(d.profile ?? null);
          setSlots(d.slots ?? {});
          setTranscript(d.transcript ?? []);
          setAgentName(d.agentName ?? "");
          setBehaviorPreset(d.behaviorPreset ?? null);
          setClosed(d.closed ?? false);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!profile && transcript.length === 0) return;
    const draft: Draft = {
      v: DRAFT_VERSION,
      profile,
      slots,
      transcript,
      agentName,
      behaviorPreset,
      closed,
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [hydrated, profile, slots, transcript, agentName, behaviorPreset, closed]);

  // Poll the uploaded doc (file/voice) until the ingest rail populates its extracted `text`. The row
  // sits at pending_extraction/extracting first (no text yet) — only feed the opening turn once text
  // lands; a `failed` row means the format couldn't be read.
  // ONE document, by id — deliberately not `listVaultDocs`, which no longer carries `text` at all
  // (15.3-02: the grid projection dropped it, because collecting every row's blob to read one
  // document's text is what blew the 16 MiB read cap).
  const doc = useQuery(api.vault.vaultDocText, pendingDocId ? { vaultDocId: pendingDocId } : "skip");
  useEffect(() => {
    if (!pendingDocId || !doc) return;
    if (doc.status === "failed") {
      setPendingDocId(null);
      setBusy(false);
      setError("We couldn't read that file. Try pasting or recording your brief instead.");
      return;
    }
    if (doc.text && doc.text.trim() !== "") {
      const extracted = doc.text;
      setPendingDocId(null);
      void openingTurn(extracted);
    }
  }, [pendingDocId, doc]);

  /**
   * Step 2 + the first pass of step 3. `extractProfile` runs ONCE, on the intake text; the same text
   * is then the first user message of the fact conversation.
   */
  async function openingTurn(intakeText: string) {
    setBusy(true);
    setError(null);
    setGaps(null);
    setWaitMsg("Understanding your business…");
    try {
      const p = await extract({ intakeText });
      setProfile(p);
      const seeded: OnboardingSlots =
        p.oneLineDescription.trim() === "" ? {} : { oneLineDescription: p.oneLineDescription };
      setWaitMsg("Thinking…");
      await runTurn(intakeText, seeded, []);
    } catch {
      setError("Something went wrong reading that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * ONE user turn of the fact conversation.
   *
   * The closing beat costs a SECOND `converse` call, and that is deliberate: the server derives the
   * turn's instruction from the slots it was GIVEN, so the turn that finally completes the slot set
   * was still under "obtain <last fact>" and its reply is an acknowledgement, not a closing beat.
   * Re-asking with the completed slots is what puts the registry prompt on its
   * "nothing left to obtain" branch. The wording is the model's throughout — design §6's beat is a
   * registry-owned prompt's job (§5), and a sentence composed here would be prompt content in source
   * and would drift from the skill body.
   *
   * ponytail: two model calls on the final turn only. Ceiling — `converse` computes `nextSlot` from
   * the PRE-merge slots. Upgrade path: have it also report a post-merge closing instruction, so one
   * call covers the last turn; that is a backend change this plan does not own.
   */
  async function runTurn(userMessage: string, fromSlots: OnboardingSlots, history: Turn[]) {
    const withUser: Turn[] = [...history, { role: "user", text: userMessage }];
    setTranscript(withUser);
    const turn = await converse({ slots: fromSlots, userMessage, history });
    setSlots(turn.slots);
    setRemaining(turn.missing.length);
    if (!turn.done) {
      setTranscript([...withUser, { role: "agent", text: turn.reply }]);
      return;
    }
    try {
      const closing = await converse({ slots: turn.slots, userMessage, history });
      setTranscript([...withUser, { role: "agent", text: closing.reply }]);
    } catch {
      // The facts ARE complete; losing the closing beat must not strand the user mid-onboarding.
      setTranscript([...withUser, { role: "agent", text: turn.reply }]);
    }
    setClosed(true);
  }

  function onSend() {
    const t = text.trim();
    if (t === "" || busy) return;
    setText("");
    if (!profile) {
      void openingTurn(t);
      return;
    }
    void (async () => {
      setBusy(true);
      setError(null);
      setGaps(null);
      setWaitMsg("Thinking…");
      try {
        await runTurn(t, slots, transcript);
      } catch {
        setError("That didn't go through. Say it again and I'll pick up where we left off.");
      } finally {
        setBusy(false);
      }
    })();
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
      setPendingDocId(vaultDocId); // busy stays true — the poll effect clears it via openingTurn
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

  // Sparse-start (idea-stage): only a one-line description is required to enter. Mirrors @pikar/core
  // validateProfile so the button and the mutation agree. The FIVE FACT slots are a separate gate
  // that lives in `commitProfile` (SC#3b) — deliberately not mirrored here, because a client-side
  // mirror of a fail-closed server gate is exactly how a gate quietly stops being one. `closed` is
  // the conversation's own signal, and it comes from the server's `done`.
  const description = slots.oneLineDescription ?? profile?.oneLineDescription ?? "";
  const requiredFilled = description.trim() !== "";

  /**
   * Step 6. FACTS FIRST, then the narrative: `saveFacts` is what DERIVES and persists the tier (there
   * is no tier argument to send), and `commitProfile` REFUSES until that row exists. Reversing the
   * order would fail every first-time onboarding. The draft is cleared only after BOTH succeed.
   */
  async function onConfirm() {
    if (!profile || committing || !requiredFilled) return;
    setCommitting(true);
    setError(null);
    setGaps(null);
    try {
      await saveFacts({
        headcount: slots.headcount,
        paidStaff: slots.paidStaff,
        revenueStage: slots.revenueStage,
        funding: slots.funding,
        yearsOperating: slots.yearsOperating,
        agentName: agentName.trim() === "" ? undefined : agentName,
        behaviorPreset: behaviorPreset ?? undefined,
      });
      // Field-by-field, never a spread of `profile`. A `v.object` arg validator rejects an EXTRA key
      // outright, so a stale draft field would turn Confirm into a hard validation failure — and a
      // future field cannot leak into the write by accident.
      await commit({
        profile: {
          name: profile.name,
          oneLineDescription: description,
          stage: profile.stage,
          offering: profile.offering,
          targetCustomer: profile.targetCustomer,
          primaryGoals: profile.primaryGoals.map((s) => s.trim()).filter(Boolean),
          knownConstraints: profile.knownConstraints.map((s) => s.trim()).filter(Boolean),
        },
      });
      localStorage.removeItem(DRAFT_KEY);
      router.replace("/dashboard"); // gate now passes → cockpit released
    } catch (err) {
      const missing = readMissing(err);
      if (missing) {
        // Recoverable, never a dead end: back to the conversation with the gap named in the user's
        // own language. The raw code is never shown.
        setGaps(missing);
        setClosed(false);
      } else {
        setError("Couldn't save your profile. Please check the fields and try again.");
      }
      setCommitting(false);
    }
  }

  const inConversation = !closed;

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

      {/* The transcript is a live region: a new agent turn is announced, not silently painted. */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        style={{ display: "grid", gap: "0.75rem" }}
      >
        <AgentTurn>
          Good to meet you, Executive. Tell me about your business — <strong>type it</strong>,
          upload a document, or record a quick spoken brief. I&apos;ll ask you a few things about
          how it runs, then show you what I understood before anything is saved.
        </AgentTurn>

        {transcript.map((t, i) =>
          t.role === "agent" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: an append-only transcript has no id
            <AgentTurn key={`a${i}`}>{t.text}</AgentTurn>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: an append-only transcript has no id
            <div key={`u${i}`} style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={userBubble}>{t.text}</div>
            </div>
          ),
        )}

        {busy && (
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
        )}
      </div>

      {gaps && gaps.length > 0 && (
        <p role="alert" style={{ color: "var(--held-text)", fontSize: "0.9rem", margin: 0 }}>
          Before we finish I still need {gaps.map((s) => SLOT_LABEL[s]).join(", ")}. Let&apos;s
          cover that and try again.
        </p>
      )}

      {inConversation ? (
        /* ── The composer. The three modalities show only on the opening turn — after that the
              conversation is typed, because it is a conversation. ── */
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <div
            style={{
              border: "1px solid var(--rule)",
              borderRadius: "1rem",
              padding: "0.6rem 0.75rem",
              background: "rgb(255 255 255 / 88%)",
              boxShadow: "0 10px 30px -24px rgb(14 20 25 / 45%)",
              display: "grid",
              gap: "0.5rem",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder={
                profile
                  ? "Type your answer…"
                  : "Describe your business — what you do, who you serve, where you're at…"
              }
              rows={3}
              disabled={busy}
              aria-label={profile ? "Your answer" : "Describe your business"}
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
              {!profile && (
                <>
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
                </>
              )}
              {profile && remaining !== null && remaining > 0 && (
                // A subtle "still to cover" affordance (BRAND §3 tracked caps) — a COUNT, never a
                // checklist of slot names. Design §6 is a conversation, not a form in chat's clothes.
                <span style={label}>{remaining} more to cover</span>
              )}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                aria-label="Send"
                title="Send"
                disabled={busy || text.trim() === ""}
                onClick={onSend}
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
                  cursor: busy || text.trim() === "" ? "default" : "pointer",
                  opacity: busy || text.trim() === "" ? 0.5 : 1,
                  boxShadow: "0 8px 18px -8px rgb(0 150 137 / 70%)",
                }}
              >
                <SendIcon size={16} />
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>
              {error}
            </p>
          )}
        </div>
      ) : (
        /* ── The close: review the narrative, name the agent, pick a voice, confirm.
              No tier control — design §9. ── */
        <div style={card}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <span style={label}>Here&apos;s what I understood — edit anything</span>
            <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
              Nothing is saved until you confirm below.
            </p>
          </div>

          <LabeledField label="Business name (optional)">
            <input
              style={field}
              value={profile?.name ?? ""}
              onChange={(e) => set("name", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="One-line description">
            <input
              style={field}
              value={description}
              onChange={(e) => {
                set("oneLineDescription", e.target.value);
                setSlots((s) => ({ ...s, oneLineDescription: e.target.value }));
              }}
            />
          </LabeledField>
          <LabeledField label="Stage (optional)">
            <input
              style={field}
              value={profile?.stage ?? ""}
              onChange={(e) => set("stage", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="Offering (optional)">
            <textarea
              style={field}
              rows={2}
              value={profile?.offering ?? ""}
              onChange={(e) => set("offering", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="Target customer (optional)">
            <textarea
              style={field}
              rows={2}
              value={profile?.targetCustomer ?? ""}
              onChange={(e) => set("targetCustomer", e.target.value)}
            />
          </LabeledField>
          <LabeledField label="Primary goals (one per line)">
            <textarea
              style={field}
              rows={3}
              value={(profile?.primaryGoals ?? []).join("\n")}
              onChange={(e) => set("primaryGoals", e.target.value.split("\n"))}
            />
          </LabeledField>
          <LabeledField label="Known constraints (one per line)">
            <textarea
              style={field}
              rows={2}
              value={(profile?.knownConstraints ?? []).join("\n")}
              onChange={(e) => set("knownConstraints", e.target.value.split("\n"))}
            />
          </LabeledField>

          {/* Agent identity (D4, design §7) */}
          <div style={{ display: "grid", gap: "0.75rem", paddingTop: "0.25rem" }}>
            <span style={label}>Your agent</span>
            <LabeledField label="What should I go by?">
              <input
                style={field}
                value={agentName}
                maxLength={AGENT_NAME_MAX}
                placeholder="Atlas"
                onChange={(e) => setAgentName(e.target.value)}
              />
            </LabeledField>
            <PresetGroup value={behaviorPreset} onChange={setBehaviorPreset} />
          </div>

          {error && (
            <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={committing || !requiredFilled}
              onClick={() => void onConfirm()}
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
              {committing ? "Saving…" : "Yes — that's right"}
            </button>
            <button
              type="button"
              disabled={committing}
              onClick={() => setClosed(false)}
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
              Not quite — let&apos;s talk
            </button>
            <button
              type="button"
              disabled={committing}
              onClick={() => {
                localStorage.removeItem(DRAFT_KEY);
                setProfile(null);
                setSlots({});
                setTranscript([]);
                setRemaining(null);
                setClosed(false);
                setAgentName("");
                setBehaviorPreset(null);
                setError(null);
                setGaps(null);
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

function AgentTurn({ children }: { children: React.ReactNode }) {
  return (
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
      <div style={{ ...agentBubble, whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

/**
 * The ONE place a pill/choice set is correct on this page.
 *
 * These are NOT the persona pills returning. A behaviour preset is a genuine user PREFERENCE — the
 * user is choosing how they want to be spoken to, and `BEHAVIOR_PRESETS` is a closed enum mapping to
 * a versioned style directive in the skill registry (design §7, §5). The TIER is the opposite: a
 * derived fact about the business that no control may set (design §9, D2). If you are ever tempted
 * to copy this component for the tier, that is the defect this whole phase removed.
 *
 * A real `fieldset`/`legend` + `input[type=radio]` group, not `role="radio"` buttons: the native
 * element carries the checked state, the group semantics AND arrow-key navigation for free
 * (ponytail rung 4), which a hand-rolled version has to re-implement and usually doesn't.
 */
function PresetGroup({
  value,
  onChange,
}: {
  value: BehaviorPreset | null;
  onChange: (p: BehaviorPreset) => void;
}) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
      <legend style={{ ...label, padding: 0 }}>How should I talk to you?</legend>
      {BEHAVIOR_PRESETS.map((p) => {
        const selected = value === p;
        return (
          <label
            key={p}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "0.6rem",
              alignItems: "start",
              padding: "0.7rem 0.9rem",
              borderRadius: "0.9rem",
              border: `1px solid ${selected ? "var(--teal-600)" : "var(--rule)"}`,
              background: selected
                ? "color-mix(in srgb, var(--teal-400) 12%, transparent)"
                : "var(--card)",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="behaviorPreset"
              value={p}
              checked={selected}
              onChange={() => onChange(p)}
              style={{ marginTop: "0.2rem", accentColor: "var(--teal-600)" }}
            />
            <span style={{ display: "grid", gap: "0.2rem" }}>
              <span style={{ fontWeight: 700, color: "var(--ink)", fontSize: "0.9rem" }}>
                {PRESET_TITLE[p]}
              </span>
              <span style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
                {PRESET_COPY[p]}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
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
