"use client";

import { api } from "@pikar/backend/api";
import { composeBrief, planSeedFromBrief } from "@pikar/voice";
import { useAction, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markVoiceBriefSeen } from "./AbnormalBriefBanner";
import type { VoiceSession } from "./useVoiceSession";

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

// The brief text is composed client-side from the transcript (no model call — plan-05's clean-end
// contract) and parsed for the plan seed. Both live in @pikar/voice's pure `brief` module, sharing
// BRIEF_HEADERS with the server drafter so a composer and the parser can never drift, and emitting
// clean PLAIN TEXT (no `#`/`*`) — the brief is read in the vault and welded into the plan seed.

type Phase = "review" | "saving" | "saved" | "handoff";

// `docId` is threaded from page.tsx (the single `?doc=` reader). Absent ⇒ the Phase-6 brief flow,
// unchanged. Plan 14-08 branches the review outcome (memo vs gap-bridging plan) off this prop.
export function PostCall({ session, docId }: { session: VoiceSession; docId?: string }) {
  const { sessionId, transcript } = session;
  const router = useRouter();
  const endSessionClean = useMutation(api.voice.endSessionClean);
  const sendCockpitMessage = useAction(api.cockpit.sendCockpitMessage);

  const [markdown, setMarkdown] = useState(() => composeBrief(transcript, today()));
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
      const res = await endSessionClean({ sessionId, editedMarkdown: markdown });
      // This brief was JUST reviewed here — mark it seen so the dropped-session banner never
      // re-surfaces it on the next app open (only auto-stored, unreviewed briefs surface there).
      if (res.vaultDocId) markVoiceBriefSeen(res.vaultDocId);
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
            ? "It's indexed in your Knowledge Vault. Continue with your agent whenever you're ready."
            : "Edit the decisions and action items, then save it or continue with your agent to act on it."}
        </p>
      </div>

      {phase === "saved" ? (
        <pre
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
            Brief
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
        style={{
          margin: 0,
          minHeight: "1.2rem",
          fontSize: "0.85rem",
          color: error ? "var(--held-text)" : "var(--ink-soft)",
        }}
      >
        {error ??
          (phase === "saving"
            ? "Saving your brief…"
            : phase === "handoff"
              ? "Saving your brief and preparing a plan…"
              : "")}
      </p>

      {/* While an action is in flight the CLICKED button shows a spinning ring + a "…" label and
          both buttons disable (mirrors the workspace send button) — so a click reads as "working",
          never "stuck", even though "Continue with your agent" then navigates away. During handoff we
          collapse to the single primary button so the layout doesn't jump. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", justifyContent: "flex-end" }}>
        {phase === "saved" || phase === "handoff" ? (
          <ActionButton
            variant="primary"
            onClick={() => void onTurnIntoPlan()}
            busy={phase === "handoff"}
            disabled={busy}
            label="Continue with your agent"
            busyLabel="Opening workspace…"
          />
        ) : (
          <>
            <ActionButton
              variant="secondary"
              onClick={() => void onJustSave()}
              busy={phase === "saving"}
              disabled={busy}
              label="Just save"
              busyLabel="Saving…"
            />
            <ActionButton
              variant="primary"
              onClick={() => void onTurnIntoPlan()}
              busy={false}
              disabled={busy}
              label="Continue with your agent"
              busyLabel="Opening workspace…"
            />
          </>
        )}
      </div>
    </section>
  );
}

// A pill button with a busy affordance: while `busy`, it shows the shared `.btn-spinner` ring + a
// "…" label and reads `aria-busy` (not colour-dependent, BRAND §6). `.btn-spinner` inherits the
// button's text colour (currentColor) → white on the teal primary, ink on the light secondary.
function ActionButton({
  onClick,
  variant,
  busy,
  disabled,
  label,
  busyLabel,
}: {
  onClick: () => void;
  variant: "primary" | "secondary";
  busy: boolean;
  disabled: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      aria-label={busy ? busyLabel : label}
      style={{
        ...(variant === "primary" ? primaryBtn : secondaryBtn),
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {busy && <span className="btn-spinner" aria-hidden="true" />}
      {busy ? busyLabel : label}
    </button>
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
