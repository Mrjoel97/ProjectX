---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 03
subsystem: approvals
tags: [convex, approvals, scheduling, cas, progress, audit]

requires:
  - phase: 26-01
    provides: Shared dashboard result and bounded/partial honesty contracts
  - phase: 26-02
    provides: Cancellation provenance and optional delivery-progress schema fields
provides:
  - Idempotent proposed-plan discard with permanent non-rearm provenance
  - Atomic current-schedule movement with truthful moved/already_fired/not_scheduled results
  - Retry-safe exact delivery counters for new email approvals and explicit legacy partial progress
affects: [26-04, 26-05, approvals, cockpit, delivery]

tech-stack:
  added: []
  patterns: [same-row scheduler CAS, stale-callback tokens, request-status terminal idempotency]

key-files:
  created: []
  modified:
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/cockpit.test.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/plans.test.ts
    - packages/backend/convex/deliverApprovedPlan.ts
    - docs/playbooks/cockpit.md

key-decisions:
  - "A scheduled callback carries its expected sendAt; callback, cancel and move all contend on the same plan row so only the serialized winner can claim the transition."
  - "Request status is the delivery-counter replay key: sent and failed are immutable terminals, while awaiting_reauth remains queued."
  - "Missing cancellation provenance is accepted only as a legacy scheduled cancellation; every new cancel writes a discriminator and discarded rows never reopen."

patterns-established:
  - "State-changing Approvals mutations return code-owned discriminated results and log refs-only audit payloads."
  - "Exact counters require counterComplete=true; absent legacy counters remain partial rather than defaulting to zero."

requirements-completed: [APRV-01]

duration: 36min
completed: 2026-08-05
---

# Phase 26 Plan 03: Approvals State Transitions and Delivery Progress Summary

**Discard, live schedule movement and per-recipient delivery progress now use guarded idempotent transitions without weakening the existing human execute gate.**

## Performance

- **Duration:** 36 min
- **Started:** 2026-08-04T23:58:00Z
- **Completed:** 2026-08-05T00:34:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added `discardPlan` as a tenant-guarded `proposed -> canceled` terminal with
  `cancelKind:"discarded"`, one refs-only audit and a hard exclusion from the legacy canceled-row
  reopen path.
- Added atomic `moveScheduledPlan` behavior with stale-callback protection, truthful scheduler-race
  results and replay that creates neither a second callback nor a duplicate audit.
- Seeded exact progress on new email approvals and made one transactional helper own both request
  terminal status and bounded plan counters, preventing sent/failed double-counting under retries.
- Kept legacy plans explicit: their request terminals still advance, but missing counters and
  `counterComplete` remain absent for the bounded partial read model in Plan 04.

## Task Commits

1. **TDD RED: Pin discard, schedule-race and progress contracts** - `f07c69e` (test)
2. **Task 1: Add discard and true schedule-move CAS transitions** - `d716825` (feat)
3. **Task 2: Maintain bounded delivery progress and document rollback** - `6c95954` (feat)

## Files Created/Modified

- `packages/backend/convex/cockpit.ts` - Discard, scheduled cancel provenance, atomic move,
  stale-callback guard and new-plan counter seed.
- `packages/backend/convex/cockpit.test.ts` - Double-discard, foreign/started guards, non-rearm,
  scheduler fire/cancel/move races, replay and seed/wiring evidence.
- `packages/backend/convex/plans.ts` - Idempotent per-request sent/failed terminal plus bounded counter
  transition.
- `packages/backend/convex/plans.test.ts` - Exact, replay-safe, legacy-partial and mismatched-ref
  progress tests.
- `packages/backend/convex/deliverApprovedPlan.ts` - Both sent and failed terminals now pass through
  the shared progress transition.
- `docs/playbooks/cockpit.md` - Transition table, race semantics, legacy boundary, verification and
  reversible Approvals rollback.

## Decisions Made

- `scheduledFor` is the callback freshness token. A moved schedule changes `sendAt`, making a stale
  callback harmless even if cancellation and dequeue overlap. Legacy callbacks without the token
  can run only while the stored time is still due.
- Schedule replay at the already-current instant returns `moved` without a write. This keeps the UI
  idempotent and prevents callback/audit multiplication.
- `queuedCount` means not yet terminal, including an `awaiting_reauth` hold. Only `sent` and `failed`
  decrement it; those terminal statuses cannot flip or increment twice.

## Deviations from Plan

None - the planned state transitions, progress ownership, tests and rollback documentation were
implemented without schema, dependency or route changes.

## Issues Encountered

- The first Task 1 commit attempt overlapped another shared-tree Git writer and could not acquire
  `.git/index.lock`; retrying after that writer finished succeeded without touching the lock.
- `graphify update .` completed AST extraction for 466 files but exceeded the 90-second finalization
  limit before completing the graph write. Per the orchestration instruction it was not rerun; each
  task commit also launched the repository's background graph rebuild hook.
- `node scripts/check-playbooks.mjs` exited `0` and accepted the updated Cockpit boundary, while its
  JSON decision remained `block` only for an unrelated concurrent `turbo.json` change requiring
  `docs/playbooks/ci-gate.md`. This lane did not edit or claim that file.

## Verification

- TDD RED: focused run failed on missing `discardPlan`, `moveScheduledPlan`, cancellation provenance
  and `recordDeliveryTerminal` as intended.
- `pnpm --filter @pikar/backend test -- cockpit plans` - 6 files, 182 tests passed.
- `pnpm --filter @pikar/backend typecheck` - passed with zero errors.
- Mutation check: removing the discarded-provenance guard made the named non-rearm test fail because
  the discarded row returned `{rescheduled:true}`; restoring the guard returned the tree to clean.
- `node scripts/check-playbooks.mjs` - process exit 0; unrelated `ci-gate.md` shared-tree demand noted
  above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 26-04 can project exact progress only when `counterComplete` is true and use its bounded
  partial fallback for legacy rows.
- Plan 26-05 can wire Discard and Move directly to code-owned idempotent results and must render
  `already_fired` as In Flight, never as a successful reschedule.

## Self-Check: PASSED

- All six owned implementation/test/playbook files exist and are committed.
- Commits `f07c69e`, `d716825` and `6c95954` exist in history.
- Focused tests, backend typecheck and the required mutation check match the claims above.

---
*Phase: 26-pending-product-pages-and-vault-redesign-integration*
*Completed: 2026-08-05*
