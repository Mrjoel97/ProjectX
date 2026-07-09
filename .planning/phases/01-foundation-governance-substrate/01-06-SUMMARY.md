---
phase: 01-foundation-governance-substrate
plan: 06
subsystem: infra
tags: [convex, workflow, dead-letter-queue, awaitEvent, scheduler, onComplete, audit]

# Dependency graph
requires:
  - phase: 01-01
    provides: Convex backend + WorkflowManager (index.ts) + schema (deadLetters, pendingTimeouts, audit)
  - phase: 01-02
    provides: raw-builder allow-list + importGuard static scan (internal modules exempt)
  - phase: 01-03
    provides: insert-only audit.log surface (reused for deadletter.written + smoke.reviewgate events)
provides:
  - "Dead-letter-via-onComplete pattern: failing workflow -> deadLetters row (payload+error+correlationId) + deadletter.written audit (OPSG-04)"
  - "awaitEvent-timeout race workaround (issue #177): arm-in-step, cancel-on-decision, correlationId-namespaced events"
  - "Dev-deployment integration smoke harness (npx convex run) reusable by later phases"
affects: [phase-02, phase-03, phase-06, human-review-gates, delivery-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onComplete DLQ: workflow.start({ onComplete, context }) -> internalMutation archives failed/canceled runs"
    - "Scheduled-mutation timeout race: step.runMutation(armTimeout) -> scheduler.runAfter(fireTimeout); sendDecision cancels via pendingTimeouts lookup"
    - "Component-backed workflows verified against the live dev deployment (convex-test cannot emulate them)"

key-files:
  created:
    - packages/backend/convex/deadLetter.ts
    - packages/backend/convex/review.ts
    - packages/backend/convex/smoke.ts
    - packages/backend/convex/smokeAssert.ts
    - packages/backend/scripts/smokeRun.mjs
    - packages/backend/scripts/run-smoke-dlq.mjs
    - packages/backend/scripts/run-smoke-reviewgate.mjs
  modified:
    - packages/backend/convex/lib/allowlist.ts
    - packages/backend/package.json

key-decisions:
  - "workpool result kind is 'failed' (not 'error' as the plan interface block stated) — branched on the verified 0.4.x validator"
  - "sendDecision resolves the workflowId via a pendingTimeouts scan keyed on correlationId, so smoke drivers only pass the correlationId they generate (no stdout parsing)"
  - "Smoke drivers detect success by CLI output, not exit code — the convex CLI crashes on exit on Windows/Node24 (UV_HANDLE_CLOSING) returning a bogus non-zero code"

patterns-established:
  - "DLQ: onComplete handler inserts deadLetters + appends deadletter.written audit; payload stays redaction-safe (synthetic/refs only)"
  - "Timeout race: BOTH defenses — cancel-on-decision AND correlationId-namespaced event names"

requirements-completed: [OPSG-04]

# Metrics
duration: ~35min
completed: 2026-07-09
---

# Phase 01 Plan 06: DLQ + awaitEvent-Timeout Race Smoke Patterns Summary

**Dead-letter-via-onComplete (OPSG-04) and the issue-#177 awaitEvent-timeout race both proven end-to-end on the live Convex dev deployment, with cancel-on-decision + correlationId-namespaced events.**

## Performance

- **Duration:** ~35 min (session resumed after an earlier API-limit cutoff; no prior code had been written)
- **Completed:** 2026-07-09T23:05Z
- **Tasks:** 2
- **Files modified:** 9 (7 created, 2 modified)

## Accomplishments
- `deadLetter.onPipelineComplete`: failed/canceled workflows archive a `deadLetters` row (payload + error + correlationId) and append a `deadletter.written` audit event via the insert-only audit surface. Verified: `pnpm --filter backend smoke:dlq` green.
- `review.ts` timeout-race workaround: `armTimeout` (scheduler.runAfter + `pendingTimeouts` bookkeeping), `fireTimeout` (sends the timeout variant to the `review:${correlationId}` event), `sendDecision` (sends the decision AND cancels the scheduled timeout). Both Pitfall-5 defenses applied.
- `smoke.ts` review gate arms the timeout from INSIDE a step (workflows cannot touch `ctx.scheduler`), awaits the union event, records the branch. Verified BOTH branches: `pnpm --filter backend smoke:reviewgate` green — decision cancels the timeout (pendingTimeouts row cleared), no-decision fires the escalation branch.
- Full unit suite still green: `pnpm --filter backend vitest run` → 21/21 (importGuard now scans the 4 new modules; all exempt via allow-list).

## Task Commits

1. **Task 1: Dead-letter onComplete + failing smoke workflow (OPSG-04)** - `7957d81` (feat)
2. **Task 2: awaitEvent-timeout race review gate, both branches (issue #177)** - `9ce5d60` (feat)

_Note: `smoke.ts`/`smokeAssert.ts`/`package.json` are shared by both tasks. To keep each commit's tree buildable, Task 1 committed a DLQ-only snapshot of those files (with `review.ts` and the reviewgate driver left untracked); Task 2 restored the full review-gate versions alongside `review.ts`._

## Files Created/Modified
- `packages/backend/convex/deadLetter.ts` - onComplete handler; inserts deadLetters + deadletter.written audit on failed/canceled runs
- `packages/backend/convex/review.ts` - armTimeout / fireTimeout / sendDecision (scheduled-mutation timeout-race workaround)
- `packages/backend/convex/smoke.ts` - failingPipeline + reviewGate smoke workflows and their entry mutations
- `packages/backend/convex/smokeAssert.ts` - assertDeadLetter / assertReviewOutcome (runnable via npx convex run)
- `packages/backend/scripts/smokeRun.mjs` - convex-run helper (output-based pass/fail; no shell quoting)
- `packages/backend/scripts/run-smoke-dlq.mjs` / `run-smoke-reviewgate.mjs` - the two smoke drivers
- `packages/backend/convex/lib/allowlist.ts` - added `smokeAssert.ts` to the internal-builder allow-list
- `packages/backend/package.json` - `smoke:dlq` + `smoke:reviewgate` scripts

## Research Open Question 1 — empirical answer (stale sendEvent when no step awaits)

The smoke run does NOT exercise a stale, non-awaited `sendEvent`, and that is by design: on the decision path `sendDecision` cancels the scheduled `fireTimeout` before it can run (`assertReviewOutcome` confirms the `pendingTimeouts` row is gone and the timeout event never fires), so no orphaned timeout event is ever produced. Because both defenses are in place — cancel-on-decision removes the stale *sender*, and correlationId-namespaced event names make any leaked event unconsumable by a different gate — the buffered-vs-dropped-vs-error semantics of a non-awaited `sendEvent` are rendered **moot**, exactly as the research recommended. Observed behavior: decision branch fires exactly once with zero residual timeout; timeout branch (no decision) fires exactly once at ~3s. No cross-gate contamination was observable because each gate's event name is unique.

## Decisions Made
- **workpool result kind is `failed`, not `error`.** The plan's interface block and 01-RESEARCH Pattern 5 said `result.kind === "error"`; the verified `vResultValidator` (workpool 0.4.7 behind workflow 0.4.4) uses `"success" | "failed" | "canceled"`. Branched on `"failed"`/`"canceled"`. (Deviation Rule 1.)
- **`sendDecision` looks up the workflow via a `pendingTimeouts` scan keyed on correlationId** rather than requiring the caller to pass a workflowId — the smoke drivers only ever pass a correlationId they generated, avoiding fragile stdout parsing. (ponytail: full scan on a tiny dev table; add a `by_correlation` index only if it grows.)
- **Smoke drivers judge success by CLI output, not exit code.** On Windows + Node 24 the convex CLI process crashes during exit teardown (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`), returning a bogus non-zero code even on success; the runner detects genuine failures via the CLI's "Failed to run function" / "Uncaught Error" banner.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] onComplete branched on the wrong result kind**
- **Found during:** Task 1
- **Issue:** Plan interface + research said `result.kind === "error"`; the actual workpool validator emits `"failed"`, so the plan's branch would never fire and no dead-letter would ever be written.
- **Fix:** Branch on `result.kind === "failed"` (and `"canceled"`); early-return on `"success"`.
- **Files modified:** packages/backend/convex/deadLetter.ts
- **Verification:** `pnpm --filter backend smoke:dlq` green.
- **Committed in:** `7957d81`

**2. [Rule 3 - Blocking] Smoke drivers had to tolerate the convex CLI's non-zero exit-on-success**
- **Found during:** Task 1 (first full DLQ run)
- **Issue:** `execFileSync`-based runner treated every `npx convex run` as failed because the CLI crashes on process teardown on Windows/Node24, returning exit code 3221226505 despite the function succeeding (correct result printed to stdout).
- **Fix:** Rewrote `smokeRun.mjs` to use `spawnSync` and decide pass/fail from the CLI output banner instead of the exit code; made `sendDecision` return a value so its run is observable.
- **Files modified:** packages/backend/scripts/smokeRun.mjs, packages/backend/convex/review.ts
- **Verification:** both smoke scripts green.
- **Committed in:** `7957d81` (runner) + `9ce5d60` (sendDecision return)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking). **Impact:** both essential for the smoke tests to pass; no scope creep.

## Issues Encountered
- **The local dev backend must stay running for async workflow completion.** An initial run used `convex dev --once`, which pushes then exits and stops advancing the workpool — the failing workflow's `onComplete` never fired, so `deadLetters` stayed empty. Running `convex dev` continuously in the background resolved it; both smoke suites then passed against the live deployment. (This is a run-harness fact for later phases, not a code issue.)

## User Setup Required
None - no external service configuration required. (Smoke scripts require a running dev deployment: `npx convex dev` in `packages/backend`.)

## Next Phase Readiness
- OPSG-04 satisfied; the DLQ and awaitEvent-timeout-race patterns are ready to copy verbatim into later phases (human-review gates in Phase 2/6, delivery pipeline).
- Plan 01-07 (WORM export cron stub) is the remaining Criterion-4 half and is unblocked.

---
*Phase: 01-foundation-governance-substrate*
*Completed: 2026-07-09*

## Self-Check: PASSED
- All 6 key files exist on disk.
- Both task commits (`7957d81`, `9ce5d60`) present in git history.
- `pnpm --filter backend smoke:dlq`, `smoke:reviewgate`, and `vitest run` (21/21) all green against the live dev deployment.
