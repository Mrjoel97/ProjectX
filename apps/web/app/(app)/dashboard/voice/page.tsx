"use client";

import { useVoiceSession } from "./useVoiceSession";

// VOIC-01 — the /dashboard/voice phase machine: pre-flight → live → post-call. The single
// useVoiceSession hook is instantiated HERE and threaded to each phase so the WebRTC connection
// survives the pre-flight → live transition. Phase is derived from the hook's status (one source of
// truth), never a second piece of state that could drift.
//
// Post-call (the brief review + "turn into a plan?" handoff) is Plan 07 — this leaves a clean seam:
// when status is "ended" we render a placeholder carrying the sessionId + transcript Plan 07 fills.
//
// Task 1 ships the state machine with inline placeholders; Task 2 slots in <PreFlight>, Task 3
// <LiveSession>. BRAND tokens only, no component library (§10).

export default function VoicePage() {
  const voice = useVoiceSession();

  const phase =
    voice.status === "ended"
      ? "postcall"
      : voice.status === "connecting" || voice.status === "live" || voice.status === "paused"
        ? "live"
        : "preflight";

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "70vh", padding: "1.5rem" }}>
      {phase === "preflight" && (
        // ponytail: inline placeholder — Task 2 replaces this with <PreFlight onStart={voice.start} />.
        <section style={{ display: "grid", gap: "1rem", justifyItems: "center", textAlign: "center" }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontWeight: 800,
              fontSize: "clamp(1.6rem, 1.2rem + 1.4vw, 2.25rem)",
              letterSpacing: "-0.02em",
              color: "var(--ink)",
            }}
          >
            Live Voice
          </h1>
          <p style={{ margin: 0, color: "var(--ink-soft)", maxWidth: "26rem" }}>
            Talk through your next move with Pikar AI. The conversation is transcribed and saved to
            your vault.
          </p>
          {voice.error && (
            <p role="alert" style={{ margin: 0, color: "var(--held-text)" }}>
              {voice.error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void voice.start()}
            style={{
              padding: "0.7rem 1.6rem",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              background: "var(--teal-600)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.95rem",
            }}
          >
            Start session
          </button>
        </section>
      )}

      {phase === "live" && (
        // ponytail: inline placeholder — Task 3 replaces this with <LiveSession session={voice} />.
        <section style={{ display: "grid", gap: "1rem", justifyItems: "center", textAlign: "center" }}>
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>
            {voice.status === "connecting" ? "Connecting…" : "Live session"}
          </p>
          <button
            type="button"
            onClick={() => void voice.end()}
            style={{
              padding: "0.6rem 1.4rem",
              borderRadius: "999px",
              border: "none",
              cursor: "pointer",
              background: "var(--ink)",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            End session
          </button>
        </section>
      )}

      {phase === "postcall" && (
        // Plan-07 seam: the brief review + plan handoff mount here with voice.sessionId + transcript.
        <section style={{ display: "grid", gap: "0.5rem", justifyItems: "center", textAlign: "center" }}>
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>Session ended. Your brief is on its way.</p>
        </section>
      )}
    </div>
  );
}
