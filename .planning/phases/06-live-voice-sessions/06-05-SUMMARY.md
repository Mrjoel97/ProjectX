---
phase: 06-live-voice-sessions
plan: 05
subsystem: backend
tags: [voice, convex, watchdog, scheduler, cas, metering, vault-ingest, redaction, tdd]

# Dependency graph
requires:
  - phase: 06-live-voice-sessions
    provides: "@pikar/voice capEndsAt/CAP_MS + isEnded FSM + accumulateUsage (06-01); @pikar/cost priceRealtime (06-01)"
  - phase: 06-live-voice-sessions
    provides: "voiceToken.hangupCall force-terminate seam (06-03); llm.draftVoiceBrief toolless composer + voice-brief skill (06-04)"
  - phase: earlier
    provides: "cockpit.executePlan scheduler.runAt deferred-send + cancelScheduledPlan CAS; review.ts armTimeout; vault.vaultIngestText text-first insert → vaultIngest.ingestDoc; guardrails.recordSpend; audit.log refs-only insert-only"
provides:
  - "voice.ts session engine: startSession (persist callId + arm the ONE watchdog), getActiveSession (parallel guard), recordUsage (metering), endSessionClean (CAS cancel + brief), forceEndSession (hangup + auto-store), storeBrief/persistBrief (brief → vault ingest)"
  - "voiceSessions rows: active → ended_clean | ended_abnormal, refs/counts-only session_started/ended audits"
  - "mutation-checked refs-only voice session-audit static scan in llmRedaction.test.ts"
affects: [06-06, 06-07, 06-08, voice, vault, cockpit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Durable watchdog via scheduler.runAt(endsAt, forceEndSession) armed ONCE; the fire time IS the wall-clock cap (cockpit deferred-send precedent)"
    - "Two-mutation end CAS: markEndedClean (cancels watchdog, status still active ⇒ pending id safe) vs markEndedAbnormal (no cancel — the watchdog is executing it); both no-op from a terminal status"
    - "Action → mutation split for a workflow-starting side effect: endSessionClean (mutation) persists inline; forceEndSession (action) drafts then runMutation(persistBrief); storeBrief (action) resolves markdown"
    - "Brief body is vault CONTENT (PII kept, text-first vaultDocuments insert → ingestDoc); session audit rows are refs/counts-only"

key-files:
  created:
    - packages/backend/convex/voice.ts
    - packages/backend/convex/voice.test.ts
  modified:
    - packages/backend/convex/llmRedaction.test.ts
    - docs/playbooks/voice.md

key-decisions:
  - "The watchdog uses scheduler.runAt(endsAt) (the exact cap instant); the parallel guard uses runAfter(0) to force-end a prior session — so exactly ONE runAt call exists (armed-once invariant)"
  - "End-CAS is split into markEndedClean (cancels the watchdog) and markEndedAbnormal (never cancels — the watchdog is the caller); both flip ONLY from active, which is what stops scheduler.cancel from throwing on a fired id"
  - "A gone-tab abnormal end with no captured transcript stores a fixed placeholder brief — never a draftVoiceBrief model call over an empty transcript (Rule 2 correctness; transcript is never server-stored per §4)"
  - "recordUsage prices the DELTA (not the cumulative) onto recordSpend and fails closed (priceRealtime Err) before any counter write — no NaN/negative counter, no negative spend"
  - "storeBrief/persistBrief are idempotent on session.briefRef — a re-store returns the existing vault doc, never a duplicate brief"

patterns-established:
  - "convex-test fake-timer coverage of a durable watchdog: arm → inspect _scheduled_functions.scheduledTime → assert CAS cancel/no-op"
  - "Durable ingest workflow steps do NOT run synchronously under convex-test — status:'processing' on the brief row IS the asserted seam effect (vault-ingest test convention)"

requirements-completed: [VOIC-02, VOIC-03]

# Metrics
duration: 15min
completed: 2026-07-20
---

# Phase 6 Plan 05: Voice Session Engine Summary

**The server-side voice-session engine — a thin `voice.ts` adapter over `@pikar/voice` — that caps every session at 15 min with ONE durable watchdog (armed once, force-terminated via `hangupCall`), runs the clean/abnormal end transitions under a status CAS, meters `response.done` usage onto the spend rails fail-closed, and always ingests a brief into the vault while keeping session audit rows refs/counts-only.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-19T23:07:42Z
- **Completed:** 2026-07-19T23:22:27Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `startSession` persists the `callId`, marks the row `active` (only WITH a callId — Pitfall 1), and arms exactly ONE `scheduler.runAt(endsAt, forceEndSession)` watchdog; a parallel guard force-ends any prior active session first (cancel its timer + schedule its abnormal end) so a tenant never runs two.
- `endSessionClean` cancels the watchdog under a status CAS and ingests the reviewed brief markdown; a clean end that races the 0:00 fire is a CAS no-op (never a double-cancel throw).
- `forceEndSession` (the watchdog actuator) CAS-marks `ended_abnormal`, force-terminates the call via `voiceToken.hangupCall` (a failed hangup swallowed refs-only), then auto-stores a brief — a gone-tab end with no transcript stores a placeholder rather than calling the model over nothing.
- `storeBrief`/`persistBrief` ingest the brief as an ordinary `kind:brief`/`source:voice` vault doc text-first (PII kept — NOT `scanText`-stripped), idempotent on `session.briefRef`, riding `vaultIngest.ingestDoc`.
- `recordUsage` folds `response.done` deltas into cumulative counters and prices the delta onto `recordSpend`, failing closed on a non-finite/negative count (no NaN counter, no negative spend).
- Extended `llmRedaction.test.ts` with a mutation-checked static scan proving the `voice.session_started`/`session_ended` audit payloads carry `{sessionId}` + counts only — never the transcript, the `callId`-as-secret, or the client/API secret.

## Task Commits

1. **Task 1: startSession + parallel guard + arm watchdog + endSessionClean (CAS cancel)** (TDD) — `5bc616e` (feat, tests+impl)
2. **Task 2: forceEndSession (hangup + auto-store) + storeBrief (ingest) + recordUsage (metering)** (TDD) — `facdf65` (feat, tests+impl)
3. **Task 3: refs-only session-audit static scan + voice.md invariants** — `f3f5b60` (test/docs)

_TDD note: because `internal.voice.*` references require Convex codegen to resolve, each task's tests + implementation landed in one `feat` commit (the RED-then-GREEN split is not runnable before the module exists in codegen); the RED discipline was still applied per-assertion, and the Task-3 scan was explicitly mutation-verified RED-then-reverted._

## Files Created/Modified
- `packages/backend/convex/voice.ts` — the session engine (startSession, getActiveSession, getSession, markEndedClean, markEndedAbnormal, endSessionClean, forceEndSession, recordUsage, persistBrief, storeBrief).
- `packages/backend/convex/voice.test.ts` — 8 convex-test + fake-timer cases (watchdog arm/fire/cancel, parallel guard, CAS + fire-race, forceEndSession hangup+auto-store, storeBrief SMOKE→ingest, recordUsage meter + fail-closed).
- `packages/backend/convex/llmRedaction.test.ts` — the mutation-checked refs/counts-only voice session-audit scan.
- `docs/playbooks/voice.md` — session-engine invariants (parallel guard, CAS cancel + fire-race, abnormal auto-store, metering-is-telemetry, refs-only audit) + `Last verified: 06-05`.

## Decisions Made
- **One `runAt`, one cap.** The watchdog is `scheduler.runAt(endsAt)` so its fire time *is* the wall-clock cap; the parallel guard force-ends a prior session with `runAfter(0)`. Grep confirms exactly one `ctx.scheduler.runAt(` call — the armed-once invariant.
- **The end-CAS is two mutations.** `markEndedClean` cancels the watchdog (safe: status still `active` ⇒ pending id); `markEndedAbnormal` never cancels (the watchdog is the caller). Both flip only from `active`, which is precisely what keeps `scheduler.cancel` from throwing on an already-fired id (the `cockpit.cancelScheduledPlan` Pitfall).
- **Placeholder over an empty-transcript model call.** A gone-tab abnormal end has no server-stored transcript (§4), so `storeBrief` ingests a fixed placeholder rather than drafting over `""` — correct *and* keeps the abnormal-end path offline-deterministic.
- **Brief body is content, audit is refs.** The brief `text` keeps PII (vault content — `ingestDoc` redacts only the vector); the only log-plane crossings are the `{sessionId}`+counts session audits, enforced by the new static scan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Gone-tab abnormal end stores a placeholder brief, not an empty-transcript model call**
- **Found during:** Task 2
- **Issue:** The plan wires `forceEndSession → storeBrief → draftVoiceBrief`, but the watchdog fires on a gone tab where no transcript is available (the transcript is never server-stored, §4). Drafting over an empty transcript is a wasted/failing model call for a degenerate input.
- **Fix:** `storeBrief` uses the edited markdown (clean end) or drafts from a *non-empty* transcript; with neither it ingests a fixed `ABANDONED_BRIEF_MD` placeholder (marked `ponytail:`, upgrade path = a client `pagehide`+`sendBeacon` carrying the last transcript).
- **Files modified:** packages/backend/convex/voice.ts
- **Committed in:** `facdf65`

**2. [Rule 3 - Blocking] `storeBrief`/`forceEndSession` are actions; the shared write is `persistBrief` (mutation)**
- **Found during:** Task 2
- **Issue:** The brief store needs both `draftVoiceBrief` (an action) and `workflow.start(ingestDoc)` (mutation ctx). A single function cannot do both; a mutation cannot `runAction`.
- **Fix:** Split into `persistBrief` (internalMutation: text-first insert + `ingestDoc` + patch `briefRef`) called via `runMutation` from both the clean path (`endSessionClean`, inline) and the abnormal/draft path (`storeBrief`, an action). No behavior change vs the plan's single `storeBrief` — just the runtime split Convex requires.
- **Files modified:** packages/backend/convex/voice.ts
- **Committed in:** `facdf65`

---

**Total deviations:** 2 auto-fixed (1 correctness, 1 blocking runtime split). No scope change — all work stayed within the plan's declared `voice.ts` / `voice.test.ts` / `llmRedaction.test.ts` / `voice.md` boundary.

## Issues Encountered
- **Component registration:** `voice.test.ts` needed `t.registerComponent` for `rateLimiter` / `auditCounts` / `workflow` / `workflow/workpool` (the `audit.log` aggregate + the `recordSpend` limiter + the ingest workflow). Copied the `vaultTranscribe.test.ts` registration set.
- **Benign stderr noise:** the SMOKE `storeBrief` test logs `Component "rag" is not registered` — the durable `ingestDoc` workflow begins an async embed step that convex-test does not fully run. The synchronous seam (`status:"processing"` on the brief row) is what the test asserts; the background step failure is inert (the vault-ingest test convention). Not a regression.

## User Setup Required
None — no new external service configuration. The `voice-brief` skill seed (06-04) and `OPENAI_API_KEY` are the existing runtime needs; the live 15:00 hangup + real brief round-trip is carried by the phase-gate human-verify (voice is not unit-testable).

## Next Phase Readiness
- The full VOIC-02/03 server spine is complete: a session is capped by a server timer that survives a gone tab, always yields a vault-indexed brief, and never writes transcript/secret into an audit row.
- Downstream (06-06 UI / 06-07 brief→plan handoff) can call `startSession`/`recordUsage`/`endSessionClean` and read the brief via `session.briefRef`.
- **Flag:** the live OpenAI mint/handshake/hangup 200 shapes remain MEDIUM-confidence pins (06-01/06-03) — the phase-gate human-verify is their first live confirmation.

---
*Phase: 06-live-voice-sessions*
*Completed: 2026-07-20*

## Self-Check: PASSED
- FOUND: packages/backend/convex/voice.ts, voice.test.ts; 06-05-SUMMARY.md
- FOUND commits: 5bc616e (Task 1), facdf65 (Task 2), f3f5b60 (Task 3)
- voice.test.ts: 8 passed · llmRedaction.test.ts: 31 passed (refs-only scan RED-verified then reverted)
- check-playbooks exit 0 · exactly one `ctx.scheduler.runAt(` in voice.ts · no `scanText(` call on the brief body · voice.ts module tsc-clean
