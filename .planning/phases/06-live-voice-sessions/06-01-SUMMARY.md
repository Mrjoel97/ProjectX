---
phase: 06-live-voice-sessions
plan: 01
subsystem: infra
tags: [openai-realtime, webrtc, voice, pricing, playbook, pure-ts, vitest]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "@pikar/core Result/err/ok, packages/* pure-TS layout, tsconfig.base"
  - phase: earlier
    provides: "@pikar/cost priceTranscription fail-closed Result pattern; docs/playbooks Stop-hook + watch.json"
provides:
  - "@pikar/voice pure package: realtime.ts (pinned OpenAI Realtime API shapes), brief.ts (buildBriefMarkdown), session.ts (capEndsAt/CAP_MS + FSM), metering.ts (accumulateUsage)"
  - "priceRealtime + REALTIME_PRICING in @pikar/cost (fail-closed)"
  - "docs/playbooks/voice.md + watch.json registration covering all future voice paths"
affects: [06-02, 06-03, 06-04, 06-05, 06-06, 06-07, 06-08, voice, cockpit]

# Tech tracking
tech-stack:
  added: ["@pikar/voice (new workspace package)"]
  patterns:
    - "Pin post-cutoff external-API shapes as typed constants in one module with a sourced ponytail comment (URL + date + re-fetch upgrade path)"
    - "readUsage(): single reader of the pinned response.done usage field paths welds them to the metering tuple"
    - "priceRealtime mirrors priceTranscription fail-closed Result guard"

key-files:
  created:
    - packages/voice/package.json
    - packages/voice/tsconfig.json
    - packages/voice/vitest.config.ts
    - packages/voice/src/index.ts
    - packages/voice/src/realtime.ts
    - packages/voice/src/realtime.test.ts
    - packages/voice/src/brief.ts
    - packages/voice/src/brief.test.ts
    - packages/voice/src/session.ts
    - packages/voice/src/session.test.ts
    - packages/voice/src/metering.ts
    - packages/voice/src/metering.test.ts
    - docs/playbooks/voice.md
  modified:
    - packages/cost/src/cost.ts
    - packages/cost/src/index.ts
    - packages/cost/src/cost.test.ts
    - docs/playbooks/watch.json

key-decisions:
  - "Realtime shapes pinned from the phase RESEARCH doc citing the live OpenAI docs (no network fetch tool available in this env); each carries a sourced ponytail comment + re-fetch upgrade path"
  - "DEFAULT_REALTIME_MODEL = gpt-realtime-2.1 (GA snapshot); semantic_vad turn detection for barge-in"
  - "buildBriefMarkdown records the spoken language as a leading HTML-comment metadata marker (gives the language param a real, testable job without localizing the fixed structure)"
  - "No 'wrapping' session state — T-2min wrap-up is a client agent instruction, not a server status"

patterns-established:
  - "One pinned-constants module per post-cutoff external API; every consumer imports from it, nothing re-derives a literal"
  - "TDD RED (test commit) → GREEN (feat commit) for the pure logic modules"

requirements-completed: [VOIC-02, VOIC-03]

# Metrics
duration: 9min
completed: 2026-07-20
---

# Phase 6 Plan 01: Voice Foundations Summary

**Pure-TS `@pikar/voice` (pinned OpenAI Realtime API shapes, fixed-section brief composer, 15-min session FSM, usage-metering fold) + fail-closed `priceRealtime` in `@pikar/cost` + the voice playbook registered so the whole phase clears the Stop hook.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-19T22:34:16Z
- **Completed:** 2026-07-19T22:43:09Z
- **Tasks:** 3
- **Files modified:** 17 (13 created, 4 modified)

## Accomplishments
- Pinned the live OpenAI Realtime GA shapes (`client_secrets`/`calls`/`hangup` endpoints, `gpt-realtime-2.1` snapshot, `semantic_vad`, `response.done` usage field names) in `realtime.ts` with a sourced ponytail comment and a `readUsage()` flattener that is the single reader of those field paths.
- Built the pure `@pikar/voice` domain: `buildBriefMarkdown` (fixed section order, empty→"None", transcript welded in code), `capEndsAt`/`CAP_MS` + `canTransition`/`isEnded` session FSM (no 'wrapping' state), and `accumulateUsage` metering fold.
- Added `priceRealtime` + `REALTIME_PRICING` to `@pikar/cost`, fail-closed exactly like `priceTranscription`.
- Registered `docs/playbooks/voice.md` and its watched-path prefixes in `watch.json`, pre-covering every later voice file (packages/voice, convex/voice*.ts, the dashboard voice route) so the Stop hook cannot block the phase.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold @pikar/voice + register voice playbook** - `7098953` (chore)
2. **Task 2: Pin live OpenAI Realtime API shapes** - `aa71ca5` (feat)
3. **Task 3: Brief composer + session FSM + metering + priceRealtime** (TDD) - `5974d97` (test, RED) → `5022a51` (feat, GREEN)

_No refactor commit needed — GREEN implementation was clean._

## Files Created/Modified
- `packages/voice/src/realtime.ts` - Pinned Realtime endpoints, model snapshot, session-config keys, usage field names + `readUsage()`
- `packages/voice/src/brief.ts` - `buildBriefMarkdown(sections, transcript, language)` pure composer
- `packages/voice/src/session.ts` - `capEndsAt`/`CAP_MS` + `canTransition`/`isEnded` FSM
- `packages/voice/src/metering.ts` - `accumulateUsage` fold + `ZERO_USAGE`
- `packages/voice/src/{realtime,brief,session,metering}.test.ts` - unit coverage / self-checks
- `packages/voice/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}` - package scaffold (mirrors `@pikar/cost`)
- `packages/cost/src/cost.ts` + `index.ts` - `priceRealtime` + `REALTIME_PRICING`
- `packages/cost/src/cost.test.ts` - priceRealtime fail-closed cases
- `docs/playbooks/voice.md` - voice subsystem playbook (invariants, data flow, verify)
- `docs/playbooks/watch.json` - `voice.md` watched-path registration

## Decisions Made
- **Realtime shapes pinned from RESEARCH, not a live fetch.** No Context7/WebFetch tool was available in this execution environment. The phase RESEARCH doc was itself compiled 2026-07-20 from the live OpenAI docs it cites; those values were pinned and each carries a `ponytail:` comment naming the doc URL + pin date + the re-fetch upgrade path. Flagged so plan 03/04 (the first code to actually hit the API) re-confirm the mint/handshake/hangup shapes against a live 200 before trusting them.
- **`gpt-realtime-2.1`** as the default model snapshot; `semantic_vad` turn detection (barge-in).
- **Language recorded as an HTML-comment marker** in the brief rather than localizing headers — keeps the fixed structure stable (it becomes the plan-04 `generateObject` schema) while giving `language` a real, testable job.
- **No 'wrapping' server state** — the FSM is `active → ended_clean | ended_abnormal` only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `packages/voice/vitest.config.ts` and a `@pikar/core` dep**
- **Found during:** Task 1 (scaffold)
- **Issue:** Plan listed the package files but not the vitest config; `@pikar/cost` carries one and `pnpm --filter test` needs it. Added `@pikar/core` to dependencies for parity (Result type is imported by voice consumers).
- **Fix:** Mirrored `@pikar/cost`'s `vitest.config.ts`; added `@pikar/core: workspace:*`.
- **Files modified:** packages/voice/vitest.config.ts, packages/voice/package.json
- **Verification:** `pnpm --filter @pikar/voice test` runs; typecheck clean.
- **Committed in:** `7098953` (Task 1 commit)

**2. [Rule 2 - Missing test] Added `metering.test.ts` (not in the plan file list)**
- **Found during:** Task 3
- **Issue:** `accumulateUsage` is money-adjacent (feeds pricing) — ponytail mandates one runnable check for non-trivial logic; the plan's file list omitted a metering test.
- **Fix:** Added a 2-case `metering.test.ts` (fold correctness + ZERO_USAGE identity).
- **Files modified:** packages/voice/src/metering.test.ts
- **Verification:** passes in the voice suite.
- **Committed in:** `5974d97` (RED) / `5022a51` (GREEN)

---

**Total deviations:** 2 auto-fixed (1 blocking scaffold, 1 missing test)
**Impact on plan:** Both are necessary-for-correctness parity/coverage additions. No scope creep — all files remain within the plan's declared `packages/voice/*` + `packages/cost/*` boundary.

## Issues Encountered
- Ran in parallel with plan 06-02 in the same working tree; `packages/backend/convex/schema.ts` showed as modified (06-02's file). Staged only my own files with explicit `git add <path>` so 06-02's work was never cross-staged. The shared `pnpm-lock.yaml` was staged with Task 1 (my new package's importer entry).

## User Setup Required
None - no external service configuration required for this plan (the pure modules + pricing table have no runtime env needs; `OPENAI_API_KEY` is consumed by later plans' convex adapters).

## Next Phase Readiness
- Every downstream voice plan can now import a pinned Realtime constant, the pure brief composer, the session FSM, and `priceRealtime` — none re-derives a field name or the cap math.
- The Stop hook is satisfied for all future `packages/voice/`, `convex/voice*.ts`, and dashboard voice-route files.
- **Flag for plan 03/04:** re-confirm the exact `client_secrets` / `calls` / `hangup` JSON against a live OpenAI 200 before the first real handshake (shapes are MEDIUM-confidence, pinned from docs, not a live call).

---
*Phase: 06-live-voice-sessions*
*Completed: 2026-07-20*

## Self-Check: PASSED
- FOUND: packages/voice/src/realtime.ts, brief.ts, session.ts, metering.ts (+ tests)
- FOUND: packages/cost/src/cost.ts priceRealtime, docs/playbooks/voice.md
- FOUND commits: 7098953, aa71ca5, 5974d97, 5022a51
- pnpm --filter @pikar/voice test: 18 passed · @pikar/cost test: 22 passed · check-playbooks exit 0
