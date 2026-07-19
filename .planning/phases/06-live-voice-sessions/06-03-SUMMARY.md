---
phase: 06-live-voice-sessions
plan: 03
subsystem: api
tags: [openai-realtime, voice, convex-action, fetch, ephemeral-secret, skill-registry]

# Dependency graph
requires:
  - phase: 06-01
    provides: "@pikar/voice realtime.ts pinned shapes (CLIENT_SECRETS_URL, hangupUrl, DEFAULT_REALTIME_MODEL, TURN_DETECTION_TYPE, TRANSCRIPTION_MODEL, SESSION_CONFIG_KEYS)"
  - phase: 06-02
    provides: "voice-session skill row seeded via seedSkills (the registry persona minted into the secret)"
provides:
  - "voiceToken.mintClientSecret — tenant-scoped plain-runtime action minting a short-lived Realtime client secret with the registry persona; returns {clientSecret, expiresAt} only"
  - "voiceToken.hangupCall — plain-runtime internalAction that force-terminates a live call by callId (the VOIC-02 watchdog actuator)"
affects: [06-04, 06-05, voice-startSession, voice-forceEndSession, dashboard-voice-preflight]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plain (default V8) runtime Convex action calling api.openai.com via global fetch — avoids a 2nd use-node module re-tripping the TS circular-inference cliff"
    - "vi.stubGlobal fetch capture: assert the OUTGOING request URL/headers/body + prove the API key is structurally absent from the resolved value (first fetch-mock test in the backend)"

key-files:
  created:
    - packages/backend/convex/voiceToken.ts
    - packages/backend/convex/voiceToken.test.ts
  modified:
    - docs/playbooks/voice.md
    - packages/backend/package.json

key-decisions:
  - "Mint 200 shape read as {client_secret, expires_at} (flat), pinned from RESEARCH not a live 200 — single reader in voiceToken.ts carries a ponytail re-confirm-against-live comment"
  - "REALTIME_VOICE = 'marin' as a local literal (warm GA voice); the persona instructions still load from the registry, only the voice id is a product choice"
  - "No mint retry/backoff for beta — a failed mint surfaces to pre-flight UI as 'couldn't start' (ponytail ceiling named)"

patterns-established:
  - "fetch-mock via vi.stubGlobal + a captured {url,init} — the seam for testing outbound-only Convex actions with no fixture DB path"
  - "no-key-leak assertion: set a canary OPENAI_API_KEY, assert JSON.stringify(result) never contains it"

requirements-completed: [VOIC-01, VOIC-02]

# Metrics
duration: 20min
completed: 2026-07-20
---

# Phase 06 Plan 03: Voice Token Seam Summary

**mintClientSecret + hangupCall — the two OpenAI Realtime server seams: a short-lived client secret carrying the registry persona (browser never holds OPENAI_API_KEY) and a server-side force-terminate by callId (the VOIC-02 watchdog actuator), both plain-runtime fetch with proven no-key-leak.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-20T01:50:00Z
- **Completed:** 2026-07-20T02:00:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `mintClientSecret`: tenant-scoped plain-runtime action that loads the `voice-session` skill body from the registry (fail-closed if unseeded, §5), POSTs `client_secrets` with `Bearer OPENAI_API_KEY` + the session config from `realtime.ts`, and returns ONLY `{clientSecret, expiresAt}` — the key is structurally absent from the result (Pitfall 4).
- `hangupCall`: plain-runtime `internalAction` that POSTs `/v1/realtime/calls/{callId}/hangup` with the server key; 200 = ended, non-200 throws with the status only (refs-only) — the server's sole way to end a browser-direct call.
- First backend fetch-mock test (`vi.stubGlobal`): asserts the outgoing request shape (URL, Bearer header, session.instructions = skill body) and a no-key-leak canary; 5/5 green.
- Playbook `voice.md` bumped with the plain-runtime / no-key-leak / hangup-is-the-only-terminate invariants.

## Task Commits

1. **RED (both tasks): failing voiceToken tests** - `b14d27c` (test)
2. **Task 1: mintClientSecret** - `6ae31ae` (feat)
3. **Task 2: hangupCall + voice.md** - `192c4da` (feat)

_TDD: one combined RED commit (convex codegen needs the module to exist before the test can reference `internal.voiceToken`), then a GREEN feat commit per task._

## Files Created/Modified
- `packages/backend/convex/voiceToken.ts` - mintClientSecret (tenantAction) + hangupCall (internalAction), plain-runtime, global fetch, imports pinned shapes from @pikar/voice
- `packages/backend/convex/voiceToken.test.ts` - mock-fetch tests: request shape, no-key-leak, fail-closed persona, hangup targeting + non-200 throw
- `docs/playbooks/voice.md` - mint/hangup invariants; Last verified → 06-03
- `packages/backend/package.json` - added `@pikar/voice` workspace dependency

## Decisions Made
- **Mint response read as flat `{client_secret, expires_at}`** (per the plan's mock shape / RESEARCH). realtime.ts pins the REQUEST side only, so voiceToken.ts is the single reader of the response shape and carries a `ponytail:` re-confirm-against-live-200 comment (if OpenAI nests it as `{client_secret:{value,expires_at}}`, fix there).
- **`REALTIME_VOICE = "marin"`** local literal (warm GA voice) — not pinned in realtime.ts because the voice is a BRAND/product choice, not an API shape; the instructions load from the registry.
- **No mint retry/backoff for beta** — ponytail ceiling named; a failed mint is a pre-flight "couldn't start".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `@pikar/voice` as a backend dependency**
- **Found during:** Task 1 (mintClientSecret import)
- **Issue:** `packages/backend/package.json` did not declare `@pikar/voice`, so `import ... from "@pikar/voice"` would not resolve under pnpm's strict workspace linking.
- **Fix:** Added `"@pikar/voice": "workspace:*"` and ran `pnpm install` (removed a duplicate line the install tooling injected).
- **Files modified:** packages/backend/package.json
- **Verification:** `npx convex codegen` + `vitest run voiceToken` both resolve the import; 5/5 tests green.
- **Committed in:** `b14d27c` (RED commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for import resolution. No scope creep. (`package.json` is shared with parallel plan 06-04, which also needs `@pikar/voice`; the added line is identical and idempotent.)

## Issues Encountered
- Convex modules require `_generated/api` to include the new file before a test can reference `internal.voiceToken`, so strict test-file-first RED is impossible without a stub. Resolved by committing a throwing stub + the full test in the RED commit, then filling GREEN per task — genuine RED evidence (3 assertions failed on `not_implemented`), one codegen run.
- `convex codegen` noted "llm.ts changed right after esbuild invocation" — that is parallel plan 06-04 editing its own (disjoint) file; benign.

## User Setup Required
None - `OPENAI_API_KEY` (server-only) is the existing LLM-stack env var; no new secret.

## Next Phase Readiness
- The two OpenAI seams VOIC-01 (browser mint) and the VOIC-02 watchdog (server hangup) are ready for 06-05's `voice.startSession` / `forceEndSession` to wire in (`ctx.runAction(internal.voiceToken.hangupCall, {callId})`).
- Live 200 shapes (mint response nesting, hangup 200) are pinned-not-verified — the phase-gate human-verify is the first live confirmation; each carries a `ponytail:` re-fetch path.

---
*Phase: 06-live-voice-sessions*
*Completed: 2026-07-20*

## Self-Check: PASSED
- All 4 declared files present on disk.
- All 3 task commits (b14d27c, 6ae31ae, 192c4da) present in git history.
- Verification: voiceToken 5/5 tests green; check-playbooks exit 0; no "use node" pragma in voiceToken.ts.
