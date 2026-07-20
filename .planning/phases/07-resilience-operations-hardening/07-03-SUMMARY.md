---
phase: 07-resilience-operations-hardening
plan: 03
subsystem: api
tags: [convex, workflow, review-gate, fail-closed, notifications, telemetry]

# Dependency graph
requires:
  - phase: 07-01
    provides: "@pikar/core classifyReviewDecision + MAX_REGENERATE (shared fail-closed classifier), notificationMessage (static §4 labels), ReviewOutcome += escalated"
provides:
  - "Fail-closed pipeline review gate: a regenerate past MAX_REGENERATE terminates as escalated (audit + notify + telemetry, NO send) — the unapproved-send bug is fixed at the workflow boundary"
  - "escalated as a first-class terminal across REQUEST_STATUS (pipeline.ts) + schema.ts requests.status + telemetry reviewOutcome validator"
  - "review.expired notification on the review-inactivity timeout branch (REVW-03)"
  - "smoke:pipeline coverage for the expiry + breach terminals + fireReviewTimeout driver + assertReviewExpired/assertReviewEscalated"
affects: [07-04, opsg-05, cockpit-review-gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every review-gate decision routes through one shared @pikar/core classifier (root-cause fix; the cockpit gate reuses it in 07-04)"
    - "Governed escalated terminal mirrors stopBlocked: setStatus + audit + notify + telemetry as one atomic fail-closed terminal, never a fall-through to DELIVER"

key-files:
  created:
    - packages/backend/convex/pipeline.test.ts
  modified:
    - packages/backend/convex/pipeline.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/telemetry.ts
    - packages/backend/convex/smoke.ts
    - packages/backend/convex/smokeAssert.ts
    - packages/backend/scripts/run-smoke-pipeline.mjs
    - docs/playbooks/cockpit.md

key-decisions:
  - "Widen schema.ts requests.status + telemetry.ts reviewOutcome validator for escalated (Rule 3): the escalated terminal's setStatus/writeTerminal writes fail the arg validators otherwise"
  - "Re-export MAX_REGENERATE from @pikar/core in pipeline.ts (single source of truth) — requests.ts still imports it for its canRegenerate hint"
  - "smoke:fireReviewTimeout cancels the real SEVEN_DAYS scheduled timeout and re-fires review.fireTimeout at delay 0 — drives a live expiry without waiting 7 days"

patterns-established:
  - "Shared fail-closed classifier at the decision chokepoint over a per-caller guard (CLAUDE.md §8)"
  - "New terminal = widen ALL three status unions in lockstep (pipeline REQUEST_STATUS, schema requests.status, telemetry reviewOutcome)"

requirements-completed: [REVW-02, REVW-03, OPSG-05]

# Metrics
duration: 25min
completed: 2026-07-21
---

# Phase 7 Plan 03: Fail-Closed Pipeline Review Gate Summary

**Routed the durable-workflow review gate through @pikar/core classifyReviewDecision so a regenerate past MAX_REGENERATE terminates as an escalated fail-closed terminal (audit + retry.limit notify + telemetry, NO send) instead of falling through to delivery, and added the missing review.expired timeout notification.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-21
- **Tasks:** 3
- **Files modified:** 8 (1 created, 7 modified)

## Accomplishments
- **REVW-02 (the security fix):** the review-gate loop now classifies every decision via `@pikar/core classifyReviewDecision`; a past-cap `regenerate` hits the `escalate` branch and drives a governed `escalated` terminal — it can no longer reach the `break` that led to DELIVER (the unapproved-send hole). Fail closed at the workflow boundary, not by the UI hiding a button.
- Added `escalated` as a first-class terminal across all three status unions (pipeline `REQUEST_STATUS`, `schema.ts` `requests.status`, `telemetry.ts` `reviewOutcome`) plus the `escalate` terminal helper (mirrors `stopBlocked`).
- **REVW-03:** the review-inactivity timeout branch now fires a `review.expired` notification between its existing audit and telemetry write (was audit+telemetry only); still NO delivery on timeout.
- Extended `smoke:pipeline` to drive both new terminals live (expiry → expired + review.expired notify + NO send; 4-regenerate breach → escalated + retry.limit notify + NO send) with a `fireReviewTimeout` driver and two new assertions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fail-closed review gate via classifyReviewDecision + escalated terminal** - `e73c000` (feat, tdd: RED→GREEN in one commit — test + impl)
2. **Task 2: Review-inactivity timeout notification (REVW-03)** - `450231f` (feat)
3. **Task 3: Extend smoke:pipeline + playbook** - `b16b879` (test)

_Task 1 combined the RED test and GREEN impl in one commit; the RED failure ("Validator error: got `escalated`") was confirmed before widening the unions._

## Files Created/Modified
- `packages/backend/convex/pipeline.ts` - review-gate loop routes through classifyReviewDecision; escalate terminal helper; escalated in REQUEST_STATUS; writeTelemetry widened; review.expired notify in the timeout branch; MAX_REGENERATE re-exported from @pikar/core
- `packages/backend/convex/pipeline.test.ts` - (created) classifier wiring at the cap + the escalated terminal write seam (convex-test, auditCounts aggregate registered)
- `packages/backend/convex/schema.ts` - requests.status += escalated (14 stages)
- `packages/backend/convex/telemetry.ts` - terminalOutcome reviewOutcome += escalated
- `packages/backend/convex/smoke.ts` - fireReviewTimeout driver (fires the armed gate's timeout NOW)
- `packages/backend/convex/smokeAssert.ts` - assertReviewExpired + assertReviewEscalated
- `packages/backend/scripts/run-smoke-pipeline.mjs` - expiry + breach scenarios
- `docs/playbooks/cockpit.md` - fail-closed review-gate invariant + timeout/breach notifications; Last verified bumped

## Decisions Made
- **Widen schema.ts + telemetry.ts validators for escalated (not only pipeline.ts):** the escalate terminal's `setStatus("escalated")` and `writeTerminal(reviewOutcome:"escalated")` writes are validated against `requests.status` and `terminalOutcome` respectively — both must accept the new member or the write throws. The RED test caught this precisely.
- **Re-export MAX_REGENERATE from @pikar/core** rather than keep the local `const = 3`: `requests.ts` imports it from `./pipeline`, so the export must stay, but its VALUE now lives once in core (07-01) — the classifier and the UI hint read the same number.
- **fireReviewTimeout for the live smoke:** the real pipeline arms a SEVEN_DAYS timeout, so the driver cancels that scheduled function and re-fires `review.fireTimeout` at delay 0 against the same namespaced gate — a live expiry without a 7-day wait.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Widen schema.ts requests.status + telemetry.ts reviewOutcome for `escalated`**
- **Found during:** Task 1
- **Issue:** The plan listed only pipeline.ts's REQUEST_STATUS. The escalate terminal writes `status:"escalated"` (validated by schema.ts `requests.status`) and `reviewOutcome:"escalated"` (validated by telemetry.ts `terminalOutcome`); neither union contained it, so both writes threw a validator error (confirmed by the RED test).
- **Fix:** Added `v.literal("escalated")` to both unions (schema comment updated to 14 stages), keeping all three status unions in lockstep.
- **Files modified:** packages/backend/convex/schema.ts, packages/backend/convex/telemetry.ts
- **Verification:** RED→GREEN on pipeline.test.ts (the escalated terminal write seam)
- **Committed in:** e73c000 (Task 1 commit)

**2. [Rule 3 - Blocking] Add smoke driver + assertions the extended smoke script references**
- **Found during:** Task 3
- **Issue:** The plan's Task 3 files listed run-smoke-pipeline.mjs + cockpit.md, but the extended script must call server-side functions that did not exist: a way to fire the armed gate's timeout live (the real one is SEVEN_DAYS out) and assertions for the two new terminals.
- **Fix:** Added `smoke:fireReviewTimeout` (smoke.ts) and `assertReviewExpired`/`assertReviewEscalated` (smokeAssert.ts).
- **Files modified:** packages/backend/convex/smoke.ts, packages/backend/convex/smokeAssert.ts
- **Verification:** backend source typecheck clean; check-playbooks exit 0
- **Committed in:** b16b879 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking)
**Impact on plan:** Both are the load-bearing plumbing the plan's intent requires (the escalated write must validate; the live smoke must have functions to call). No scope creep.

## Issues Encountered
- None beyond the deviations above. The backend `tsc --noEmit` surfaces pre-existing test-file errors (untouched files: `import.meta.glob` TS2339 pattern, possibly-undefined in tests) — none in the files this plan touched.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 07-04 wires the SAME `classifyReviewDecision` into the LIVE cockpit gate (`executePlan`/`plans.reviseCount`/`plans.escalated`) — the shared fix reaches both gates; this plan proves the classifier + escalated terminal on the pipeline substrate.
- Both terminals feed the OPSG-05 notification matrix (`retry.limit` + `review.expired` kinds).
- **Manual phase-gate not yet run:** `npm run smoke:pipeline` (expiry + breach) requires a live dev deployment; the automated verification (`pnpm --filter @pikar/backend test pipeline`, `check-playbooks`) is green.

---
*Phase: 07-resilience-operations-hardening*
*Completed: 2026-07-21*

## Self-Check: PASSED

All 9 files present on disk; all 3 task commits (e73c000, 450231f, b16b879) present in git history.
