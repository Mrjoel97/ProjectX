"use client";

import { useEffect, useRef, useState } from "react";
import { MicIcon, SendIcon } from "../../../(auth)/icons";
import type { Speaker, VoiceSession } from "./useVoiceSession";

// VOIC-01/02 live surface (CONTEXT "Live session UI"): a scrolling two-sided transcript (the
// ChatPane bubble idiom), a small speaking orb showing who's talking, an ALWAYS-visible 15-min
// countdown (understated early, emphasized near the cap), a prominent End button behind a lightweight
// confirm (a mis-tap must not lose a long conversation), and a text-input fallback so the session is
// usable without a working mic. Screen-reader announcements for every state change; full keyboard
// operation. BRAND tokens only, no component library (§6/§10).

const two = (n: number) => String(n).padStart(2, "0");
function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

// Mirror the ChatPane bubble geometry so the transcript reads as the same product surface.
function bubble(mine: boolean): React.CSSProperties {
  return {
    padding: "0.55rem 0.8rem",
    borderRadius: mine ? "1rem 1rem 0.25rem 1rem" : "1rem 1rem 1rem 0.25rem",
    background: mine ? "var(--teal-900)" : "var(--card)",
    color: mine ? "#fff" : "var(--ink)",
    border: mine ? "none" : "1px solid var(--rule)",
    maxWidth: "80%",
    whiteSpace: "pre-wrap",
  };
}

function speakerLabel(s: Speaker | null): string {
  if (s === "user") return "You are speaking";
  if (s === "agent") return "Pikar AI is speaking";
  return "";
}

export function LiveSession({ session }: { session: VoiceSession }) {
  const { status, transcript, speaking, remainingMs, nearingCap, end, sendText } = session;
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState("");
  const [announce, setAnnounce] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const warnedRef = useRef(false);
  const prevSpeaking = useRef<Speaker | null>(null);
  const prevStatus = useRef<string>("");

  // Keep the newest turn in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  // SR announcements for state changes (CONTEXT a11y: session started, who's speaking, 2-min warning,
  // ended). One polite live region; we only push a message when a value actually changes.
  useEffect(() => {
    if (status === prevStatus.current) return;
    prevStatus.current = status;
    if (status === "connecting") setAnnounce("Connecting your session.");
    else if (status === "live") setAnnounce("Session started. You can begin speaking.");
    else if (status === "ended") setAnnounce("Session ended. Your brief is being prepared.");
  }, [status]);

  useEffect(() => {
    if (speaking === prevSpeaking.current) return;
    prevSpeaking.current = speaking;
    const label = speakerLabel(speaking);
    if (label) setAnnounce(label);
  }, [speaking]);

  useEffect(() => {
    if (nearingCap && !warnedRef.current) {
      warnedRef.current = true;
      setAnnounce("Two minutes remaining. The assistant will begin wrapping up.");
    }
  }, [nearingCap]);

  return (
    <div
      style={{
        width: "min(46rem, 100%)",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        gap: "1rem",
        height: "min(80vh, 44rem)",
      }}
    >
      {/* Screen-reader-only live region */}
      <div
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {announce}
      </div>

      {/* Header: orb + who's speaking, always-visible countdown, End */}
      <header style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flex: 1, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: "0.9rem",
              height: "0.9rem",
              borderRadius: "999px",
              flex: "none",
              background: speaking ? "var(--teal-600)" : "var(--rule)",
              boxShadow: speaking ? "0 0 0 6px rgb(0 150 137 / 18%)" : "none",
              transition: "background 150ms, box-shadow 150ms",
            }}
          />
          <span style={{ color: "var(--ink-soft)", fontSize: "0.9rem" }}>
            {status === "connecting"
              ? "Connecting…"
              : status === "paused"
                ? "Paused"
                : speaking
                  ? speakerLabel(speaking)
                  : "Listening…"}
          </span>
        </div>

        {/* Always-visible countdown — understated early, emphasized (bold + larger + ink) near cap.
            Never amber: BRAND reserves --held for the approval gate alone (§2). */}
        <span
          aria-hidden="true"
          style={{
            fontVariantNumeric: "tabular-nums",
            fontWeight: nearingCap ? 800 : 600,
            fontSize: nearingCap ? "1.35rem" : "1.05rem",
            color: nearingCap ? "var(--ink)" : "var(--ink-soft)",
            transition: "font-size 200ms, color 200ms",
          }}
        >
          {remainingMs === null ? "15:00" : fmt(remainingMs)}
        </span>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={status === "ended"}
          style={{
            padding: "0.5rem 1.2rem",
            borderRadius: "999px",
            border: "none",
            cursor: "pointer",
            background: "var(--ink)",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.9rem",
          }}
        >
          End
        </button>
      </header>

      {/* Transcript */}
      <div
        ref={scrollRef}
        style={{
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.6rem",
          padding: "0.25rem",
          minHeight: 0,
        }}
      >
        {transcript.length === 0 ? (
          <p style={{ color: "var(--ink-soft)", margin: "auto" }}>
            Say hello, or type a message below, to begin.
          </p>
        ) : (
          transcript.map((turn) => {
            const mine = turn.speaker === "user";
            return (
              <div
                key={turn.id}
                style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}
              >
                <div style={bubble(mine)}>{turn.text}</div>
              </div>
            );
          })
        )}
      </div>

      {/* Text-input fallback (accessibility): type a turn; the agent still replies by voice. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          sendText(t);
          setDraft("");
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          border: "1px solid var(--rule)",
          borderRadius: "999px",
          padding: "0.35rem 0.35rem 0.35rem 0.9rem",
          background: "var(--card)",
        }}
      >
        <MicIcon size={16} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={status === "ended"}
          aria-label="Type a message to the assistant"
          placeholder="Or type your turn…"
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontFamily: "inherit",
            fontSize: "0.95rem",
            color: "var(--ink)",
          }}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={draft.trim() === "" || status === "ended"}
          style={{
            width: "2.25rem",
            height: "2.25rem",
            flex: "none",
            borderRadius: "999px",
            border: "none",
            background: "var(--teal-600)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            cursor: draft.trim() === "" ? "default" : "pointer",
            opacity: draft.trim() === "" ? 0.5 : 1,
          }}
        >
          <SendIcon size={15} />
        </button>
      </form>

      {confirming && (
        <ConfirmEnd
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void end();
          }}
        />
      )}
    </div>
  );
}

// Lightweight confirm — a mis-tap on End must not lose a long conversation (CONTEXT). Focus-trapped
// enough to be keyboard-usable: Escape cancels, the confirm button auto-focuses.
function ConfirmEnd({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-end-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgb(14 20 25 / 45%)",
        display: "grid",
        placeItems: "center",
        padding: "1.5rem",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "var(--card)",
          borderRadius: "1rem",
          padding: "1.5rem",
          maxWidth: "24rem",
          display: "grid",
          gap: "1rem",
          boxShadow: "0 24px 60px -30px rgb(14 20 25 / 60%)",
        }}
      >
        <h2 id="voice-end-title" style={{ margin: 0, fontSize: "1.15rem", color: "var(--ink)" }}>
          End session & generate brief?
        </h2>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          We'll wrap up the conversation and prepare a brief from what you discussed.
        </p>
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "0.55rem 1.2rem",
              borderRadius: "999px",
              border: "1px solid var(--rule)",
              background: "var(--card)",
              color: "var(--ink)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Keep talking
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            style={{
              padding: "0.55rem 1.2rem",
              borderRadius: "999px",
              border: "none",
              background: "var(--teal-600)",
              color: "#fff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            End & generate brief
          </button>
        </div>
      </div>
    </div>
  );
}
