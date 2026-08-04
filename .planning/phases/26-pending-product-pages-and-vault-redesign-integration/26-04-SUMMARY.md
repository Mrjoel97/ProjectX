---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 04
subsystem: api
tags: [convex, approvals, pagination, tenant-isolation, scorecard, dlq]

requires:
  - phase: 26-01
    provides: bounded result, stable order and page-state contracts
  - phase: 26-02
    provides: tenant/status/time plan index and legacy-safe progress/cancellation fields
provides:
  - One bounded Approvals summary for both the page header and navigation badge
  - Tenant-safe awaiting, scheduled, in-flight and cleared plan projections
  - Code-validated diagnostic decisions and a content-free blocked Ops summary
affects: [26-05, 26-19, approvals, command-center]

tech-stack:
  added: []
  patterns: [native cursor pagination, narrow page projections, closed decision validators]

key-files:
  created:
    - packages/backend/convex/approvals.ts
    - packages/backend/convex/approvals.test.ts
  modified:
    - docs/playbooks/dashboard-pages.md

key-decisions:
  - "Plan lanes expose refs, enums, timestamps and counts only; raw subjects, bodies, recipients and attachment capabilities remain on their ownership-checked detail surfaces."
  - "Native Convex cursors own timestamp ties for single-status lanes; the cleared union is bounded by both an absolute window and rows and declares a row-cap instead of using a lossy timestamp cursor."
  - "Approvals diagnostic writes use a discriminated four-field validator and recheck that the latest tenant/thread evaluation still exposes the question before patching."

patterns-established:
  - "Legacy schedule/cancellation/progress and pre-ledger cost gaps are explicit unknown or partial states, never zero-shaped defaults."
  - "Cross-surface blocked facts are aggregate timestamps/counts plus an Ops link; raw DLQ and notification content never crosses the adapter."

requirements-completed: [APRV-01]

duration: 32min
completed: 2026-08-05
---

# Phase 26 Plan 04: Approvals Read Model Summary

**Bounded tenant-indexed Approvals projections now provide one honest badge summary, stable plan lanes, validated Scorecard decisions and a sanitized Ops blocker signal without exposing raw content.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-08-05T01:53:00+03:00
- **Completed:** 2026-08-05T02:25:00+03:00
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `summary`, cursor-paginated awaiting/scheduled/in-flight lanes and a time-and-row-bounded
  cleared union on the tenant/status/time index.
- Kept all public plan rows narrow: no tenant id, subject, body, recipient address, candidate hint,
  attachment URL or raw database row crosses the adapter.
- Added explicit legacy schedule, cancellation and delivery-progress states plus unknown pre-ledger
  cost; invalid or incomplete counters cannot masquerade as exact zero progress.
- Added code-owned financial questions with field-specific number/boolean validators, current-state
  rechecks and tenant/thread isolation.
- Replaced direct DLQ/notification reuse with a capped aggregate containing only count, timestamps
  and `/ops`; injected payload/error secrets are absent from the result.

## Task Commits

1. **Tasks 1-2 RED: Pin Approvals read and decision boundaries** - `f196191` (test)
2. **Tasks 1-2 GREEN: Implement bounded Approvals adapters** - `48c622b` (feat)
3. **Task 2: Document projection, partial and rollback contracts** - `b6c2ac4` (docs)

## Files Created/Modified

- `packages/backend/convex/approvals.ts` - Summary, plan lanes, validated decision write and
  sanitized blocked summary.
- `packages/backend/convex/approvals.test.ts` - Six auth, isolation, cap, cursor-tie, legacy-honesty,
  field-validation and no-content tests.
- `docs/playbooks/dashboard-pages.md` - Exact Approvals bounds, safe projection, legacy semantics,
  Ops ownership and rollback boundary.

## Decisions Made

- Used Convex's opaque cursor for the single-status lanes because it retains the index's hidden tie
  ordering. A custom `{createdAt,id}` cursor cannot be ranged correctly on the shipped index.
- Kept Cleared as a seven-day-style caller window plus a 50-row cap. It merges separate indexed
  `done` and `canceled` reads and returns `partialReason: "row-cap"`; it does not issue a cursor that
  could skip equal timestamps.
- Limited diagnostic decisions to CAC, LTGP, 30-day cash and 30-day payback, the exact closed inputs
  requested by the deterministic diagnosis. Stored `notEnoughData.needs` text is not treated as a
  field name or browser prompt.
- Kept blocked resolution in `/ops`; Approvals receives no row id or resolution mutation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced an over-generic tenant-query context type**

- **Found during:** Task 2 final backend typecheck
- **Issue:** Deriving the helper context through the generic `tenantQuery` builder lost its handler
  shape and made the pagination callback implicit `any`.
- **Fix:** Typed the helper as `QueryCtx & { tenantId: string }` and added narrow recursive-result
  annotations in the cursor test.
- **Files modified:** `packages/backend/convex/approvals.ts`,
  `packages/backend/convex/approvals.test.ts`
- **Verification:** `pnpm --filter @pikar/backend typecheck` passed with zero errors.
- **Committed in:** `48c622b`

---

**Total deviations:** 1 auto-fixed blocking issue.
**Impact on plan:** Type precision only; no API, persistence or authorization scope changed.

## Issues Encountered

- `node scripts/check-playbooks.mjs` exited `0` and found no stale dashboard-pages ownership, but its
  repository-global JSON remains `decision: block` for concurrent foreign changes covered by
  `ci-gate.md` (`turbo.json`) and `cockpit.md` (Gmail/Calendar plus Plan 26-03 Cockpit/delivery files).
  This lane did not edit or claim those playbooks.
- The mandated `graphify update .` reached `468/468` AST files, then timed out after 122 seconds
  during finalization without completing its post-processing. The commit hook also launched the
  normal background rebuild after each commit; graph output was not staged by this lane.

## Verification

- TDD RED: `pnpm --filter @pikar/backend test -- approvals` - 6/6 failed because the module did not
  exist.
- Final focused test: `pnpm --filter @pikar/backend test -- approvals` - 6/6 passed.
- `pnpm --filter @pikar/backend typecheck` - passed with zero errors.
- `node scripts/check-playbooks.mjs` - process exit `0`; only the foreign shared-tree warnings above
  remain.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 26-05 can compose the hidden Approvals route and rail badge from the same `summary`
  subscription, page the three live plan lanes, show bounded Cleared/Decisions/Ops states and wire
  existing governed mutations/deep links without receiving raw plan or DLQ rows.
- Navigation remains disabled until Plan 26-05's executed authenticated browser gate and blocking
  owner UAT pass.

## Self-Check: PASSED

- Both created modules and the updated playbook exist.
- Commits `f196191`, `48c622b` and `b6c2ac4` are present in repository history.
- Summary claims match the final 6/6 focused test, zero-error typecheck and watcher output.

---
*Phase: 26-pending-product-pages-and-vault-redesign-integration*
*Completed: 2026-08-05*
