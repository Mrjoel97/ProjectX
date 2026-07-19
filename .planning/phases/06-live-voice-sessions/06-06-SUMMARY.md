---
phase: 06-live-voice-sessions
plan: 06
subsystem: ui
tags: [webrtc, openai-realtime, voice, react-hook, accessibility, convex, nextjs]

# Dependency graph
requires:
  - phase: 06-live-voice-sessions (06-01)
    provides: "@pikar/voice pinned Realtime shapes (realtime.ts), session FSM + CAP_MS (session.ts), readUsage metering flattener"
  - phase: 06-live-voice-sessions (06-05)
    provides: "voice.ts session engine — startSession (arms the watchdog on callId), recordUsage, endSessionClean, forceEndSession abnormal path"
  - phase: 06-live-voice-sessions (06-03)
    provides: "voiceToken.mintClientSecret (ephemeral secret, registry persona) + hangupCall"
provides:
  - "/dashboard/voice route + Live Voice nav entry"
  - "useVoiceSession hook: mint → getUserMedia(echo-cancel) → RTCPeerConnection + oai-events data channel → /realtime/calls handshake → relay call_id → startSession; two-sided transcript assembly; throttled response.done → recordUsage; T-2min data-channel wrap-up; text-input fallback"
  - "PreFlight surface (mic permission + Web Audio level meter + one-time consent notice)"
  - "LiveSession surface (transcript + speaking orb + always-visible countdown + confirm-gated End + text fallback + mic-lost paused banner + a11y)"
  - "graceExpired(sinceMs, now, windowMs) pure predicate (mic-recovery + silence) in @pikar/voice"
  - "voice.abortSession — client gateway to the internal forceEndSession abnormal path"
  - "REALTIME_EVENTS / REALTIME_CLIENT_EVENTS pinned data-channel event names in realtime.ts"
affects: [07-brief-plan-handoff, 08-live-verify-phase-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Raw RTCPeerConnection + a single oai-events data channel (no @openai/agents-realtime SDK, no new npm dep) — the browser half of the OpenAI Realtime session"
    - "Phase machine derived from hook status (single source of truth), not a second state field"
    - "Pure, fail-safe grace/expiry predicate (graceExpired) shared by mic-recovery + silence timers, unit-tested without a mic"

key-files:
  created:
    - "apps/web/app/(app)/dashboard/voice/useVoiceSession.ts"
    - "apps/web/app/(app)/dashboard/voice/PreFlight.tsx"
    - "apps/web/app/(app)/dashboard/voice/LiveSession.tsx"
    - "apps/web/app/(app)/dashboard/voice/page.tsx"
  modified:
    - "apps/web/app/(app)/layout.tsx"
    - "packages/voice/src/session.ts"
    - "packages/voice/src/session.test.ts"
    - "packages/voice/src/realtime.ts"
    - "packages/voice/src/index.ts"
    - "packages/backend/convex/voice.ts"
    - "apps/web/package.json"
    - "docs/playbooks/voice.md"

key-decisions:
  - "Client mic-loss/silence fall-through routes through a new thin tenant-guarded voice.abortSession — the browser cannot call the internalAction forceEndSession directly"
  - "Realtime data-channel event-type names pinned in realtime.ts (single-source, MEDIUM confidence, ponytail re-confirm) rather than scattered in the hook"
  - "Session Id type derived via FunctionArgs (IntakeControls precedent) — @pikar/backend exports only ./api, not dataModel"
  - "MIC_GRACE_MS=30s, SILENCE_MS=90s (Claude's Discretion) — both consume cap time, tunable after live-verify"

patterns-established:
  - "WebRTC lifecycle owned entirely by one hook; the two surfaces are pure presenters of {status, transcript, speaking, remainingMs, ...}"
  - "aria-live announcements for every voice state change (start / who's speaking / 2-min / mic-lost / ended); confirm-gated destructive End"

requirements-completed: [VOIC-01, VOIC-02]

# Metrics
duration: 21min
completed: 2026-07-19
---

# Phase 6 Plan 6: Live Voice Session Client Summary

**The browser half of live voice: a `/dashboard/voice` route with a WebRTC hook (mint → mic → SDP handshake → call_id relay → transcript + metering), a mic-check/consent pre-flight, a transcript+orb+countdown live surface with a confirm-gated End and text fallback, and a mic-loss pause/recover + silence timeout that falls through to the existing abnormal-end brief — never re-arming the wall-clock cap.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-07-19T23:29:16Z
- **Completed:** 2026-07-19T23:50:41Z
- **Tasks:** 4
- **Files modified:** 12

## Accomplishments
- `useVoiceSession` drives the whole WebRTC loop with raw `RTCPeerConnection` + one data channel (no SDK, no new dep): mints an ephemeral secret, captures the mic with echo cancellation, does the SDP handshake, reads the `Location`-header `call_id`, relays it to `startSession` (arming the server watchdog), assembles a two-sided transcript from `input_audio_transcription` + assistant output-transcript events, forwards throttled `response.done` usage to `recordUsage`, and sends a T-2min wrap-up instruction over the channel.
- Pre-flight gate confirms a working mic with a Web Audio RMS level meter and shows the one-time consent notice before Start — no capped time is spent on a dead mic.
- Live surface: scrolling two-sided transcript (ChatPane bubble idiom), a speaking orb, an always-visible 15-min countdown (emphasized near the cap, never amber), a confirm-gated End → `endSessionClean`, a text-input fallback (`sendText`), and a mic-lost paused banner with a keyboard Reconnect.
- Mic-loss pause/recover + silence timeout resolved by the pure, fail-safe `graceExpired` predicate (unit-tested RED→GREEN), both falling through to `voice.abortSession` → the existing `forceEndSession` abnormal path — the watchdog is never re-armed and `remainingMs` keeps counting through a pause.
- Full keyboard operation + `aria-live` announcements for every state change.

## Task Commits

1. **Task 1: Nav + route shell + useVoiceSession WebRTC hook** - `ce758a5` (feat)
2. **Task 2: Pre-flight — mic permission + level meter + consent** - `31fe8f1` (feat)
3. **Task 3: Live surface — transcript + orb + countdown + End + text fallback** - `856ea36` (feat)
4. **Task 4: Mic-loss/silence → abnormal-end (TDD)**
   - `8581bbf` (test — RED failing graceExpired tests)
   - `97a1db9` (feat — GREEN graceExpired implementation)
   - `330ba94` (feat — wire hook + LiveSession paused state + abortSession + voice.md)

**Plan metadata:** _(this commit)_

## Files Created/Modified
- `apps/web/app/(app)/dashboard/voice/useVoiceSession.ts` - WebRTC lifecycle + transcript + metering + wrap-up + mic-loss/silence expiry
- `apps/web/app/(app)/dashboard/voice/PreFlight.tsx` - mic permission + live level meter + consent + Start
- `apps/web/app/(app)/dashboard/voice/LiveSession.tsx` - transcript + orb + countdown + End confirm + text fallback + paused banner + a11y
- `apps/web/app/(app)/dashboard/voice/page.tsx` - phase machine (pre-flight → live → post-call seam for Plan 07)
- `apps/web/app/(app)/layout.tsx` - Live Voice nav entry → /dashboard/voice
- `packages/voice/src/session.ts` - `graceExpired` pure predicate
- `packages/voice/src/session.test.ts` - graceExpired unit tests (elapsed / not-elapsed / fail-safe)
- `packages/voice/src/realtime.ts` - `REALTIME_EVENTS` / `REALTIME_CLIENT_EVENTS` pinned event names
- `packages/voice/src/index.ts` - export graceExpired + the event-name constants
- `packages/backend/convex/voice.ts` - `abortSession` client gateway to `forceEndSession`
- `apps/web/package.json` - add `@pikar/voice` workspace dep
- `docs/playbooks/voice.md` - pause/recover-then-end invariant + frontend key files (Last verified 06-06)

## Decisions Made
- **`voice.abortSession` gateway.** `forceEndSession` is an `internalAction` the browser cannot call. Rather than duplicate the abnormal path, `abortSession` is a thin tenant-guarded `tenantMutation` that schedules `internal.voice.forceEndSession` — mirroring exactly what `startSession`'s own parallel-guard already does. Reuses the hangup + auto-store path; adds no second pipeline.
- **Realtime event-type names pinned in `realtime.ts`.** The hook needs post-cutoff data-channel event `type` strings; per CLAUDE.md/ponytail they live in the single pin module (`REALTIME_EVENTS`/`REALTIME_CLIENT_EVENTS`) with re-confirm comments, not scattered in the hook.
- **`SessionId` via `FunctionArgs`.** `@pikar/backend` exports only `./api`; the row id type is derived from `api.voice.recordUsage`'s args (the IntakeControls precedent) — no need to export Convex `dataModel` types to the client.
- **Grace windows (Claude's Discretion):** `MIC_GRACE_MS=30s`, `SILENCE_MS=90s`, both consuming cap time, marked `ponytail:` tunable after live-verify.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `forceEndSession` is not client-callable — added `voice.abortSession`**
- **Found during:** Task 4 (mic-loss/silence fall-through)
- **Issue:** The plan's interface says the fall-through calls `voice.forceEndSession({sessionId})`, but that function is an `internalAction` — a browser client cannot invoke it. The mic-loss/silence path had no reachable route to the abnormal-end brief.
- **Fix:** Added a thin tenant-guarded `abortSession` `tenantMutation` to `voice.ts` that validates ownership and schedules `internal.voice.forceEndSession` (the same call `startSession`'s parallel guard already makes). No new abnormal pipeline; reuses hangup + auto-store.
- **Files modified:** packages/backend/convex/voice.ts (+ hook calls it, voice.md documents it)
- **Verification:** backend `tsc` clean on voice.ts; web `tsc` resolves `api.voice.abortSession`; check-playbooks exit 0
- **Committed in:** 330ba94

**2. [Rule 3 - Blocking] `@pikar/voice` not a dependency of `@pikar/web`**
- **Found during:** Task 1 (hook imports @pikar/voice)
- **Issue:** The hook imports the pinned Realtime shapes + `graceExpired` from `@pikar/voice`, which was not in `apps/web`'s dependencies — `tsc` could not resolve the module.
- **Fix:** Added `"@pikar/voice": "workspace:*"` to `apps/web/package.json` + `pnpm install`.
- **Files modified:** apps/web/package.json, pnpm-lock.yaml
- **Verification:** web `tsc --noEmit` exit 0
- **Committed in:** ce758a5

**3. [Consistency] Pinned Realtime event-type names extended `realtime.ts`**
- **Found during:** Task 1 (transcript/orb/metering event handling)
- **Issue:** The hook must match post-cutoff data-channel event `type` strings; scattering those literals violates the single-source rule (CLAUDE.md, realtime.ts docstring).
- **Fix:** Added `REALTIME_EVENTS` + `REALTIME_CLIENT_EVENTS` to `realtime.ts` (with `ponytail:` re-confirm) and exported them — the pin module's intended purpose.
- **Files modified:** packages/voice/src/realtime.ts, packages/voice/src/index.ts
- **Verification:** voice `tsc` + `test session` green
- **Committed in:** ce758a5

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 consistency)
**Impact on plan:** All three were necessary to make the plan's own interfaces compile and reach the abnormal-end path. No scope creep; the abnormal pipeline was reused, not rebuilt.

## Issues Encountered
- A broad `biome format --write` reflowed pre-existing, non-voice lines in `layout.tsx`/`page.tsx`/`PreFlight.tsx` (the committed repo is not biome-format-enforced — the baseline itself has format diffs). Reverted the reflow on committed files and re-applied the Task 4 hook edits by hand to keep diffs scoped to the change. No behavior affected.

## Not Verifiable Without the Live Phase-Gate (Plan 08)

This plan is the client that actually opens the WebRTC connection, but no live browser + mic + OpenAI Realtime loop exists in this sandbox. The following are wired to the MEDIUM-confidence pins (06-01/06-03, compiled from RESEARCH, not a live 200) and carry `ponytail:` re-confirm comments — they can only be proven on the live gate:
- The `/v1/realtime/calls` SDP handshake 200, the `Location`-header `call_id` shape, and the `client_secrets` mint body.
- The data-channel event names (`input_audio_transcription.completed`, `response.output_audio_transcript.delta/done`, `response.done.usage`, `input_audio_buffer.speech_*`, `output_audio_buffer.*`) — if a transcript stops assembling or the orb never lights, re-confirm these first.
- Real audio round-trip, barge-in, echo cancellation, multilingual auto-detect, the orb/countdown feel, and the real mic-loss recovery UX (VALIDATION manual-only rows).

## User Setup Required
None - no new external service configuration (reuses the existing `OPENAI_API_KEY` server-side).

## Next Phase Readiness
- Plan 07 (brief review + "turn into a plan?" handoff) mounts on the `page.tsx` post-call seam with `voice.sessionId` + the exposed `transcript`.
- Plan 08 is the live human-verify phase-gate for everything flagged above.

## Self-Check: PASSED

- Files: FOUND useVoiceSession.ts, PreFlight.tsx, LiveSession.tsx, page.tsx, session.ts
- Commits: FOUND ce758a5, 31fe8f1, 856ea36, 8581bbf, 97a1db9, 330ba94

---
*Phase: 06-live-voice-sessions*
*Completed: 2026-07-19*
