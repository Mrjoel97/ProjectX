---
phase: 06-live-voice-sessions
plan: 08
subsystem: voice
tags: [voice, webrtc, openai-realtime, convex, adr, playbook, human-verify, vault, cockpit]

# Dependency graph
requires:
  - phase: 06-live-voice-sessions (01-07)
    provides: pinned Realtime shapes, voiceSessions engine, watchdog, draftVoiceBrief, WebRTC client, post-call surface + brief→plan handoff
  - phase: 05 vault
    provides: vaultIngest brief indexing (the brief lands here)
  - phase: 03.x cockpit
    provides: sendCockpitMessage → PLAN + single-Approve pipeline (reused for the handoff)
provides:
  - ADR-005 — the immutable browser-direct OpenAI Realtime WebRTC + wall-clock watchdog + metering-as-telemetry decision record
  - Finalized voice.md playbook (definitive subsystem contract)
  - The passed live human-verify gate (VOIC-01..04) — the proof no unit can substitute for
  - UAT-fix chain: live mint shape, transcript completeness, plain-text brief, visible wrap-up, ingest-failure resilience, honest handoff
affects: [phase 7 (resilience hardens these error paths), voice, vault, cockpit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Voice is not unit-testable → the live human-verify walk-through IS the phase gate (RPLY-01 precedent)"
    - "External live-service shapes (OpenAI Realtime) are pin-then-live-verify — the mock cannot catch a 400"

key-files:
  created:
    - docs/decisions/005-live-voice-browser-direct-realtime.md
    - .planning/phases/06-live-voice-sessions/deferred-items.md
  modified:
    - docs/playbooks/voice.md
    - packages/voice/src/brief.ts
    - packages/backend/convex/vaultIngest.ts
    - apps/web/app/(app)/dashboard/voice/PostCall.tsx

key-decisions:
  - "Browser-direct OpenAI Realtime over WebRTC with a server-minted ephemeral secret — no LiveKit, no new pinned component (ADR-005)"
  - "The 15-min cap is ONE server-side wall-clock watchdog armed once, never re-armed; a mic-drop grace consumes cap time"
  - "The brief is clean PLAIN TEXT (no markdown) — read in the vault + welded into the plan seed"
  - "The cockpit agent is an email composer; a brief→plan handoff correctly draws a clarifying question, not an instant plan — button renamed to match; richer non-email plan deferred"

patterns-established:
  - "An ingest run can never strand a doc at 'processing' — every start routes through startIngest + its failure-handling onComplete"
  - "All brief string logic lives in one pure module behind a shared BRIEF_HEADERS set (composers + parser can never drift)"

requirements-completed: [VOIC-01, VOIC-02, VOIC-03, VOIC-04]

# Metrics
duration: multi-session (phase-close + live UAT fix chain)
completed: 2026-07-21
---

# Phase 6: Live Voice Sessions — Close Summary

**ADR-005 records the browser-direct Realtime WebRTC + wall-clock watchdog architecture; the live human-verify passed (real audio, barge-in, multilingual, brief→vault, brief→plan→Approve→send), and the UAT surfaced + fixed six live-only defects unit tests could not catch.**

## Performance

- **Completed:** 2026-07-21
- **Tasks:** 2 (Task 1 automated close; Task 2 blocking human-verify)
- **Type:** phase close (autonomous: false — gated on the live walk-through)

## Accomplishments

- **ADR-005 accepted** (`docs/decisions/005-live-voice-browser-direct-realtime.md`) — the immutable architecture record: browser-direct OpenAI Realtime over WebRTC with a server-minted ephemeral client secret (no LiveKit / no new dep / no new pinned component); the 15-min cap as a single server wall-clock watchdog armed once and never re-armed (mic-drop grace consumes cap time); server force-terminate via the callId hangup endpoint; client-reported usage as telemetry/best-effort budget (the cap is the real cost bound); raw audio discarded (transcript + brief only); brief as first-class vault content (PII kept) vs refs-only session audit.
- **voice.md finalized** — the definitive subsystem contract (invariants, how to change safely, how to verify, operations), Last verified bumped across the UAT-fix chain.
- **Live human-verify APPROVED by owner** — the VOIC-01..04 phase gate: real bidirectional audio, barge-in, multilingual auto-detect, the always-visible countdown + T-2min wrap-up, a structured brief indexed in the vault, and a voice-derived brief driven through the cockpit → single-Approve → real governed send (owner sent a real email + PDF from a brief).

## Task Commits

1. **Task 1: ADR-005 + finalize voice playbook + green sweep** — `39f058f` (docs)
2. **Task 2: Live human-verify + the UAT-fix chain** (defects found during the walk-through, each root-caused not symptom-patched):
   - `f22b2e3` — correct live OpenAI Realtime mint shape (audio.input nesting + `value` response) — the mock could not catch a real 400
   - `292eb41` — agent transcript no longer drops turns (brief gaps) — done-authoritative + response-boundary reset
   - `61a36a1` — voice UAT polish: clean plain-text brief (shared BRIEF_HEADERS), visible T-2min wrap-up banner + deferred nudge, PostCall busy spinner, honest handoff rename ("Continue with your agent")
   - `68d47e6` — vault ingest failure no longer strands docs at "processing" (startIngest + onIngestComplete + retryStuckIngests; recovered 4 stranded docs live)

## Files Created/Modified

- `docs/decisions/005-live-voice-browser-direct-realtime.md` — the voice architecture ADR (immutable)
- `docs/playbooks/voice.md` — finalized subsystem contract + UAT invariants (plain-text brief, visible wrap-up, transcript completeness)
- `packages/voice/src/brief.ts` — all brief string logic consolidated (BRIEF_HEADERS, buildBriefMarkdown, composeBrief, planSeedFromBrief) — clean plain text
- `packages/backend/convex/vaultIngest.ts` — startIngest (sole starter) + onIngestComplete failure handler + retryStuckIngests
- `apps/web/app/(app)/dashboard/voice/{PostCall,LiveSession,useVoiceSession}.tsx` — plain-text brief, visible wrap-up banner, collision-safe nudge, busy spinner, honest rename
- `.planning/phases/06-live-voice-sessions/deferred-items.md` — the richer non-email "plan" capability, deliberately deferred

## Decisions Made

- Kept the brief→plan handoff behavior (agent clarifies before proposing) and renamed the button to match — the cockpit agent is an email composer, so a brief with no recipient/subject cannot become an instant plan safely (ADR-004: never guess an outward action). A true non-email plan type is genuinely new capability, logged in deferred-items rather than squeezed into a closed phase.

## Deviations from Plan

The plan's Task 2 was a pass/fail human gate. In practice the walk-through surfaced six live-only defects (404/missing-nav on a stale prod build, mint 400 shape, unseeded voice-session skill, transcript gaps, hashes/stars in the brief, and the pre-existing ingest-stranding bug). All were root-caused and fixed with tests + playbook updates during the gate — the intended purpose of a live gate no unit can substitute for. No scope creep; the richer plan type was explicitly deferred, not built.

## Issues Encountered

- The stranded-"processing" vault bug was pre-existing (missing onComplete on all 5 ingest start sites) and surfaced only because this session's repeated backend restarts interrupted in-flight ingests — fixed at the shared choke point, and 4 historically-stranded docs recovered.

## Next Phase Readiness

- Phase 6 complete (8/8 plans). Phase 7 (Resilience & Operations Hardening) is next and hardens exactly these error paths (timeouts, retry escalation, notifications, dead-letter completeness, WORM export) — the ingest-failure resilience added here is a down-payment on that theme. Phase 7 is unplanned (0/TBD) and needs `/gsd:plan-phase 7` before execution.

---
*Phase: 06-live-voice-sessions*
*Completed: 2026-07-21*
