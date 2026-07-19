"use client";

import { PreFlight } from "./PreFlight";
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
        <PreFlight
          onStart={() => void voice.start()}
          starting={voice.status === "connecting"}
          error={voice.error}
        />
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
