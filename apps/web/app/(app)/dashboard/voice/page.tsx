"use client";

import { LiveSession } from "./LiveSession";
import { PostCall } from "./PostCall";
import { PreFlight } from "./PreFlight";
import { useVoiceSession } from "./useVoiceSession";

// VOIC-01 — the /dashboard/voice phase machine: pre-flight → live → post-call. The single
// useVoiceSession hook is instantiated HERE and threaded to each phase so the WebRTC connection
// survives the pre-flight → live transition. Phase is derived from the hook's status (one source of
// truth), never a second piece of state that could drift.
//
// Post-call (Plan 07): when status is "ended" — a clean End here, or an on-page abnormal
// fall-through — <PostCall> reviews/stores the brief and offers the plan handoff. A session dropped
// on a CLOSED tab is surfaced instead by <AbnormalBriefBanner> (app shell) on next open. BRAND
// tokens only, no component library (§10).

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

      {phase === "live" && <LiveSession session={voice} />}

      {phase === "postcall" && <PostCall session={voice} />}
    </div>
  );
}
