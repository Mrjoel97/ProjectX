"use client";

import { useEffect, useState } from "react";
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
//
// DOC SCOPE (Phase 14, DOCV-01): `/dashboard/voice?doc=<vaultDocId>` opens a session about ONE
// report. The param is read here, ONCE, and threaded down — neither <LiveSession> nor <PostCall>
// re-reads it, so there is exactly one reader on the page.
//
// WHY `window.location.search` AND NOT `useSearchParams`: this is the established idiom in this repo
// (`workspace/page.tsx` for the `?thread=` handoff, and the connect-gmail flow before it), and both
// carry the same comment — it avoids the `useSearchParams` Suspense boundary that Next.js's App
// Router otherwise requires, where a missing boundary either errors at prerender or silently deopts
// the whole page to client-side rendering. Reading in an effect REMOVES that failure class rather
// than guarding against it. Safe here because `?doc=` is only needed when the user presses Start,
// which is many frames after mount. Do not "modernise" this to `useSearchParams` without adding the
// boundary AND re-running `pnpm --filter @pikar/web build` — typecheck cannot see that bug.

export default function VoicePage() {
  const [docId, setDocId] = useState<string | undefined>(undefined);
  useEffect(() => {
    setDocId(new URLSearchParams(window.location.search).get("doc") ?? undefined);
  }, []);

  // The doc id is a client-supplied string and is NOT trusted here. Both server calls re-validate
  // it — `voiceToken.mintClientSecret` and `voice.startSession` each check tenant ownership and
  // `status: "ready"`, and throw `voicedoc: document not found` / `not ready` (14-03/14-04). No
  // client-side validation, which would wrongly imply the browser is the trust boundary.
  const voice = useVoiceSession(docId);

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
          // The SAME docId `?doc=` writes: arriving from the vault pre-selects the picker, and an
          // in-session pick fills it when the route carried none. `useVoiceSession` reads docId
          // inside start(), so a choice made before Start is picked up with no hook change.
          docId={docId}
          onPickDoc={setDocId}
        />
      )}

      {/* `docId` is threaded as a prop on purpose: page.tsx owns the route-param read, so plans
          14-07 (<DocStrip>) and 14-08 (the review outcome) consume it and must NOT add a second
          reader. Both children keep their Phase-6 behaviour when it is absent. */}
      {phase === "live" && <LiveSession session={voice} docId={docId} />}

      {phase === "postcall" && <PostCall session={voice} docId={docId} />}
    </div>
  );
}
