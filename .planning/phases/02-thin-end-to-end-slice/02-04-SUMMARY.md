---
phase: 02-thin-end-to-end-slice
plan: 04
subsystem: api
tags: [convex, workflow, review-gate, telemetry, awaitEvent, opsg-01, revw-01]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "convex/review.ts awaitEvent-timeout gate (issue #177 workaround), workflow manager, insert-only audit, tenant wrappers"
  - phase: 02-thin-end-to-end-slice (02-01)
    provides: "telemetry + pendingTimeouts.by_correlation index, requests table, migrations/aggregate components"
provides:
  - "REVW-01 typed decision union (approve | edit_text | regenerate | reject) at the durable review gate"
  - "Attempt-suffixed review event (review:cid:attempt) making the regenerate loop safe against cross-attempt event leakage"
  - "sendDecision cancels the scheduled timeout via the by_correlation index (no full-table scan)"
  - "Pure OPSG-01 telemetry-row builder (@pikar/core buildTelemetry): present-or-null completeness"
  - "Write-once, idempotent telemetry.writeTerminal internalMutation persisting the built row"
affects: [02-06-pipeline, telemetry, ops-dashboard, phase-7-revw-02, phase-8-skillopt]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Attempt-suffixed durable-event names for a looping awaitEvent gate"
    - "Scheduler-arg propagation (attempt carried to fireTimeout) instead of a schema column"
    - "Pure domain builder (packages/core) + thin Convex adapter projection at the storage boundary"
    - "Idempotent write-once mutation keyed on an indexed correlationId lookup"

key-files:
  created:
    - packages/core/src/buildTelemetry.ts
    - packages/core/src/buildTelemetry.test.ts
    - packages/backend/convex/telemetry.ts
  modified:
    - packages/backend/convex/review.ts
    - packages/backend/convex/smoke.ts
    - packages/backend/scripts/run-smoke-reviewgate.mjs

key-decisions:
  - "attempt flows as a function/scheduler arg everywhere; no pendingTimeouts schema column (avoids a migration)"
  - "buildTelemetry returns number|null for token/cost (honest 'no LLM ran'); the mutation coalesces null->0 at the v.number() storage boundary"
  - "writeTerminal is idempotent by correlationId so a retried terminal workflow step cannot write a duplicate row"

patterns-established:
  - "Looping awaitEvent gates MUST attempt-suffix their event name (a late attempt-N event must not resume attempt N+1)"
  - "OPSG-01 telemetry is built once FROM the terminal outcome, never patched incrementally"

requirements-completed: [REVW-01, OPSG-01]

# Metrics
duration: 22min
completed: 2026-07-11
---

# Phase 2 Plan 04: Review Gate Decision Union + Write-Once Telemetry Summary

**Widened the durable review gate to REVW-01's typed 4-member decision union with an attempt-suffixed event making the regenerate loop race-safe, an indexed timeout-cancel, and a pure OPSG-01 telemetry builder wired to a write-once idempotent mutation.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-11T18:07:00Z
- **Completed:** 2026-07-11T18:19:20Z
- **Tasks:** 3 (Task 2 was TDD: RED + GREEN)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- Replaced the untyped `decision: v.string()` with the REVW-01 union `approve | edit_text | regenerate | reject` plus optional `editedText`/`instruction`/`reason` content-plane fields.
- Attempt-suffixed every gate event (`review:${cid}:${attempt}`) so the new regenerate loop cannot reintroduce the issue-#177 race (a late attempt-N event resuming attempt N+1). `attempt` rides the scheduler args to `fireTimeout` — no schema column, no migration.
- Converted `sendDecision`'s full `.collect()` scan to a `by_correlation` indexed `.first()` lookup before `scheduler.cancel` (removed the obsolete `ponytail:` full-scan comment).
- Built the pure `buildTelemetry` (packages/core): sums tokens/cost across route+draft+each regenerate, emits explicit `null` (not 0) when no LLM ran, carries counters through verbatim. 4/4 vitest.
- Wired `telemetry.writeTerminal` internalMutation: builds the row from the outcome, inserts exactly one row, idempotent on correlationId.

## Task Commits

1. **Task 1: Decision union + attempt-suffix + indexed cancel** - `e1cb701` (feat)
2. **Task 2 (TDD RED): failing telemetry-builder test** - `ef0ee20` (test)
3. **Task 2 (TDD GREEN): pure buildTelemetry** - `a43cada` (feat)
4. **Task 3: write-once telemetry mutation** - `5bfb19e` (feat)

_(Commits interleave with parallel Wave-2 plans 02-02/02-03/02-05 in `git log`.)_

## Files Created/Modified
- `packages/backend/convex/review.ts` - 4-member decision union, attempt-suffixed event name, by_correlation indexed cancel; header rewritten to THREE defensive rules.
- `packages/backend/convex/smoke.ts` - reviewGate arms with `attempt: 0` and awaits `review:${cid}:0`.
- `packages/backend/scripts/run-smoke-reviewgate.mjs` - sendDecision call passes `attempt: 0`.
- `packages/core/src/buildTelemetry.ts` - pure OPSG-01 terminal-row builder + exported types.
- `packages/core/src/buildTelemetry.test.ts` - completeness/null/accumulation/carry-through tests.
- `packages/backend/convex/telemetry.ts` - `writeTerminal` internalMutation (write-once, idempotent).

## Decisions Made
- **attempt as an arg, not a column.** `fireTimeout` needs the attempt to target the right suffix; the scheduler already delivers its args, so `armTimeout` schedules `fireTimeout` with `attempt` rather than persisting it on `pendingTimeouts`. Keeps `schema.ts` untouched (no migration) and matches the plan's `files_modified` (schema absent).
- **null in the builder, 0 at storage.** The `telemetry` table declares token/cost as `v.number()` (02-01), while OPSG-01 wants "present or explicitly null." Resolved by the thin-adapter split: `buildTelemetry` returns the honest `number | null` (Task 2 tests assert null); `writeTerminal` coalesces `?? 0` at the insert. `ponytail:` comment names the schema-widen migration as the upgrade path if "no LLM" must ever differ from "measured zero" in storage.
- **Idempotent writeTerminal (Rule 2).** Workflow steps can be retried; without a guard a retried terminal step would double-write. Added a `by_correlation` existence check that returns the existing row's id — makes "exactly one row per request" robust, not just expected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Idempotency guard on writeTerminal**
- **Found during:** Task 3 (write-once telemetry mutation)
- **Issue:** The plan says "inserts exactly one row per request" but durable workflow steps can retry; a bare insert would write duplicate telemetry rows on retry.
- **Fix:** Added a `by_correlation` indexed existence check; if a row exists, return its id without inserting.
- **Files modified:** packages/backend/convex/telemetry.ts
- **Verification:** convex codegen (authoritative typecheck) exit 0; importGuard 11/11.
- **Committed in:** `5bfb19e` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** The idempotency guard is required for the "write-once" guarantee to hold under Convex step retries. No scope creep.

## Issues Encountered
- **Root `tsc --noEmit` backend typecheck is pre-existing red** (test files use `import.meta.glob`; `smoke.ts` workflow self-inference). Verified by stashing 02-04's edits — identical error set, zero new errors from this plan. The authoritative backend typecheck is `npx convex codegen` (exit 0), which uses `convex/tsconfig.json` (resolves the vite types). Logged in `deferred-items.md` (already recorded by 02-01/02-03). Task-1 behavioral verification is the `run-smoke-reviewgate.mjs` dev-deployment smoke — both gates PASS.
- **Parallel Wave-2 execution** (02-02/02-03/02-05) concurrently modified shared files (`packages/core/src/index.ts` barrel). Staged only 02-04's own diffs; confirmed the barrel diff was solely the `buildTelemetry` export (validateSubmit was already at HEAD). The `tokenExpiry.test.ts` core typecheck error belongs to 02-05's in-flight RED, not this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **Ready for 02-06 (pipeline):** the gate accepts the typed union and loops safely on `regenerate` via attempt suffixes; `telemetry.writeTerminal` is ready to be called at each terminal transition (`sent | rejected | expired | failed`) with the accumulated `usages`/counters.
- **Note for 02-06:** the pipeline must increment `attempt` and re-arm/await the suffixed event on each regenerate, and must accumulate LLM `usages` across route + draft + regenerates to hand to `writeTerminal`.

---
*Phase: 02-thin-end-to-end-slice*
*Completed: 2026-07-11*
