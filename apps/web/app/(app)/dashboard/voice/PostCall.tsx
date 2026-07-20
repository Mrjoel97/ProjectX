"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Turn, VoiceSession } from "./useVoiceSession";

// VOIC-03 (clean-end review→store) + VOIC-04 (brief→plan handoff). The always-available post-call
// surface both end types land on: render the brief markdown for review/edit, store it to the vault
// on confirm, and offer the plan handoff that seeds a cockpit thread and drops the user at the
// EXISTING single-Approve gate (no new pipeline, no new gate — RESEARCH Pattern 7).
//
// Everything starts from ONE brief string: a clean end composes it from the in-memory transcript
// here; the abnormal path stored its own on the server and surfaces via AbnormalBriefBanner — both
// converge on this same review+ask UI. BRAND tokens only, no component library (§10); fully
// keyboard-operable with screen-reader status (§6).

const two = (n: number) => String(n).padStart(2, "0");
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// Compose the editable brief from the transcript (client-side, no model call — plan-05's clean-end
// contract: "the client already composed the markdown"). Decisions + Action items lead (empty for
// the user to fill from what was discussed — the agent's T-2min wrap-up is the tail of the
// conversation below), the narrative follows. ponytail: naive transcript weld; the structured
// draftVoiceBrief model path is the server's abnormal-end story, not a per-review spend here.
export function composeBriefMarkdown(transcript: Turn[]): string {
  const narrative = transcript
    .filter((t) => t.text.trim())
    .map((t) => `- **${t.speaker === "user" ? "You" : "Pikar AI"}:** ${t.text.trim()}`)
    .join("\n");
  return [
    `# Voice brief — ${today()}`,
    "",
    "## Decisions",
    "",
    "- ",
    "",
    "## Action items",
    "",
    "- ",
    "",
    "## Conversation",
    "",
    narrative || "_No transcript was captured for this session._",
    "",
  ].join("\n");
}

// Pull the Decisions + Action items sections for the plan seed (VOIC-04): the handoff opens a
// cockpit thread with what to DO, not the whole transcript. Falls back to the full brief when the
// user left both sections empty, so the agent always has something to plan from.
export function planSeedFromBrief(markdown: string): string {
  const section = (name: string): string => {
    const re = new RegExp(`##\\s+${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    const body = markdown.match(re)?.[1] ?? "";
    // Drop empty bullet placeholders ("- " with nothing after).
    return body
      .split("\n")
      .filter((l) => l.trim() && l.trim() !== "-")
      .join("\n")
      .trim();
  };
  const decisions = section("Decisions");
  const actions = section("Action items");
  if (!decisions && !actions) return markdown.trim();
  return [
    "Turn this voice brief into a plan.",
    decisions && `\nDecisions:\n${decisions}`,
    actions && `\nAction items:\n${actions}`,
  ]
    .filter(Boolean)
    .join("\n");
}

type Phase = "review" | "saving" | "saved" | "handoff";

export function PostCall({ session }: { session: VoiceSession }) {
  const { sessionId, transcript } = session;
  const router = useRouter();
  const endSessionClean = useMutation(api.voice.endSessionClean);
  const sendCockpitMessage = useAction(api.cockpit.sendCockpitMessage);

  const [markdown, setMarkdown] = useState(() => composeBriefMarkdown(transcript));
  const [phase, setPhase] = useState<Phase>("review");
  const [error, setError] = useState<string | null>(null);
  const busy = phase === "saving" || phase === "handoff";

  // Store the (edited) brief to the vault. Idempotent server-side on briefRef, so re-clicking or a
  // race with the watchdog's auto-store never double-writes. Returns false on failure so the caller
  // does not navigate away from unsaved work.
  const store = async (): Promise<boolean> => {
    if (!sessionId) return false;
    setError(null);
    try {
      await endSessionClean({ sessionId, editedMarkdown: markdown });
      return true;
    } catch {
      setError("Couldn't save your brief. Please try again.");
      return false;
    }
  };

  const onJustSave = async () => {
    setPhase("saving");
    const ok = await store();
    setPhase(ok ? "saved" : "review");
  };

  // VOIC-04: store the brief, seed a cockpit thread with the Decisions + Action items, then land the
  // user at the existing PLAN card + single Approve. sendCockpitMessage's first turn mints the thread
  // and its plans row; navigating with ?thread=<id> re-opens exactly that conversation.
  const onTurnIntoPlan = async () => {
    setPhase("handoff");
    if (!(await store())) {
      setPhase("review");
      return;
    }
    try {
      const { threadId } = await sendCockpitMessage({ text: planSeedFromBrief(markdown) });
      router.push(`/dashboard/workspace?thread=${encodeURIComponent(threadId)}`);
    } catch {
      setError("Saved your brief, but couldn't start the plan. Open the workspace to try again.");
      setPhase("saved");
    }
  };

  return (
    <section
      aria-labelledby="voice-postcall-title"
      style={{
        width: "min(46rem, 100%)",
        background: "var(--card)",
        border: "1px solid var(--rule)",
        borderRadius: "1.25rem",
        boxShadow: "0 24px 60px -40px rgb(14 20 25 / 45%)",
        padding: "clamp(1.5rem, 1rem + 2vw, 2.25rem)",
        display: "grid",
        gap: "1.1rem",
      }}
    >
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <span
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontSize: "0.72rem",
            fontWeight: 700,
            color: "var(--ink-soft)",
          }}
        >
          Session brief
        </span>
        <h1
          id="voice-postcall-title"
          style={{
            margin: 0,
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontWeight: 800,
            fontSize: "clamp(1.35rem, 1.1rem + 1vw, 1.75rem)",
            letterSpacing: "-0.02em",
            color: "var(--ink)",
          }}
        >
          {phase === "saved" ? "Brief saved to your vault" : "Review your brief"}
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          {phase === "saved"
            ? "It's indexed in your Knowledge Vault. Turn it into a plan whenever you're ready."
            : "Edit the decisions and action items, then save it or turn it into a plan for approval."}
        </p>
      </div>

      {phase === "saved" ? (
        <pre
          aria-label="Saved brief"
          style={{
            margin: 0,
            padding: "1rem",
            background: "var(--canvas)",
            border: "1px solid var(--rule)",
            borderRadius: "0.75rem",
            color: "var(--ink)",
            fontSize: "0.9rem",
            whiteSpace: "pre-wrap",
            fontFamily: "inherit",
            maxHeight: "22rem",
            overflowY: "auto",
          }}
        >
          {markdown}
        </pre>
      ) : (
        <label style={{ display: "grid", gap: "0.4rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--ink-soft)" }}>
            Brief (Markdown)
          </span>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            disabled={busy}
            aria-label="Edit your session brief"
            rows={16}
            style={{
              width: "100%",
              resize: "vertical",
              padding: "0.9rem 1rem",
              border: "1px solid var(--rule)",
              borderRadius: "0.75rem",
              background: "var(--canvas)",
              color: "var(--ink)",
              fontFamily: "inherit",
              fontSize: "0.9rem",
              lineHeight: 1.6,
              outline: "none",
            }}
          />
        </label>
      )}

      {/* Polite status for screen readers on every state change. */}
      <p
        aria-live="polite"
        role={error ? "alert" : undefined}
        style={{ margin: 0, minHeight: "1.2rem", fontSize: "0.85rem", color: error ? "var(--held-text)" : "var(--ink-soft)" }}
      >
        {error ??
          (phase === "saving"
            ? "Saving your brief…"
            : phase === "handoff"
              ? "Saving your brief and preparing a plan…"
              : "")}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", justifyContent: "flex-end" }}>
        {phase === "saved" ? (
          <button type="button" onClick={() => void onTurnIntoPlan()} disabled={busy} style={primaryBtn}>
            Turn this into a plan
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void onJustSave()} disabled={busy} style={secondaryBtn}>
              Just save
            </button>
            <button type="button" onClick={() => void onTurnIntoPlan()} disabled={busy} style={primaryBtn}>
              Turn this into a plan?
            </button>
          </>
        )}
      </div>
    </section>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "0.65rem 1.5rem",
  borderRadius: "999px",
  border: "none",
  cursor: "pointer",
  background: "var(--teal-600)",
  color: "#fff",
  fontWeight: 600,
  fontSize: "0.9rem",
  fontFamily: "inherit",
};

const secondaryBtn: React.CSSProperties = {
  padding: "0.65rem 1.5rem",
  borderRadius: "999px",
  border: "1px solid var(--rule)",
  cursor: "pointer",
  background: "var(--card)",
  color: "var(--ink)",
  fontWeight: 600,
  fontSize: "0.9rem",
  fontFamily: "inherit",
};
