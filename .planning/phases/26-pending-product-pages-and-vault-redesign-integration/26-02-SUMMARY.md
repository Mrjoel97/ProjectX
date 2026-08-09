---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 02
subsystem: database
tags: [convex, schema, approvals, spend-ledger, provenance, pagination]

requires: []
provides:
  - Additive tenant/status/time indexes for Approvals and bounded dashboard readers
  - Legacy-safe cancellation, delivery-progress, and Vault provenance fields
  - Append-only spend event schema with explicit per-tenant coverage start
affects: [26-03, 26-04, 26-06, 26-09, 26-11, 26-12, 26-14, 26-15, 26-19]

tech-stack:
  added: []
  patterns: [optional legacy-compatible fields, tenant-prefixed time indexes, append-only reporting facts]

key-files:
  created: [packages/backend/convex/dashboardSchema.test.ts]
  modified: [packages/backend/convex/schema.ts]

key-decisions:
  - "Spend coverage is a separate one-row-per-tenant fact; absence means tracking has not begun, never historical zero."
  - "Delivery counters remain optional behind counterComplete so legacy plans stay explicitly partial."
  - "No report snapshot table was added: Phase 26 can capture one immutable transactional input and persist the existing non-groundable artifact without speculative raw-content metadata."

patterns-established:
  - "Dashboard list indexes place tenant first and createdAt last after any equality discriminator."
  - "Historical compatibility is default-on-read; Phase 26 performs no fabricated backfill."

requirements-completed: [DASH-01]

duration: 20min
completed: 2026-08-05
---

# Phase 26 Plan 02: Additive Dashboard Schema Foundation Summary

**Tenant/time indexes, legacy-safe Approvals and provenance fields, and an append-only cents ledger with explicit coverage start now support every connected page without rewriting history.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-04T22:37:00Z
- **Completed:** 2026-08-04T22:56:40Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added the compound indexes required by Approvals, Finance, Content, Reports, and Command Center readers without removing or narrowing any existing schema member.
- Added optional cancellation provenance, delivery counters, counter completeness, and direct Vault source provenance while proving representative legacy rows still validate unchanged.
- Added refs-only `spendEvents` and `spendCoverage` tables so later instrumentation can distinguish tracked history from pre-coverage unknowns.
- Pinned all additions with four focused schema contract tests and passed the backend typecheck.

## Task Commits

1. **Task 1 RED: Pin the additive schema contract** - `c6a541f` (test)
2. **Task 1 GREEN: Add the connected dashboard schema foundation** - `c6c4bff` (feat)
3. **Task 2: Close backend schema static gates** - `c6c5d0e` (fix)

## Files Created/Modified

- `packages/backend/convex/dashboardSchema.test.ts` - Source-contract assertions plus runtime legacy-row validation.
- `packages/backend/convex/schema.ts` - Optional Phase 26 fields, bounded indexes, spend events, and coverage start.

## Decisions Made

- Coverage starts per tenant in `spendCoverage`; a missing row is an explicit untracked state rather than a zero-dollar history.
- `spendEvents.correlationId` remains the replay key used by Plan 06, whose writer will include movement phase in the constructed identity so estimate/reserve/actual movements can coexist.
- Report snapshot schema was not added. The board-pack plan can capture all bounded source projections in one Convex read transaction and render from that immutable returned value, while the existing non-groundable artifact path persists the output. This avoids a speculative `v.any()` snapshot/content store and mutable joins.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed an unavailable `vite/client` type reference**

- **Found during:** Task 2 (Close schema static gates)
- **Issue:** The focused Vitest run passed, but backend typecheck correctly rejected the new test's `vite/client` reference because this package intentionally installs no Vite client type package.
- **Fix:** Removed the directive and reused the repository's established `import.meta.glob` test pattern under the existing TypeScript configuration.
- **Files modified:** `packages/backend/convex/dashboardSchema.test.ts`
- **Verification:** `pnpm --filter @pikar/backend typecheck` and `pnpm --filter @pikar/backend test -- schema dashboardSchema`
- **Committed in:** `c6c5d0e`

---

**Total deviations:** 1 auto-fixed (1 blocking issue).
**Impact on plan:** Test configuration only; no production scope or dependency changed.

## Issues Encountered

- The mandated foreground `graphify update .` waited behind concurrent commit-hook rebuilds in the shared multi-agent working tree and emitted no progress for over 90 seconds, so that foreground invocation was stopped safely. Each plan commit successfully launched the repository's background graph rebuild hook; no graph output was staged by this lane.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 26-03 and 26-04 can build Approvals transitions and reads on the stable plan index and optional progress contract.
- Plans 26-06 through 26-09 can instrument and expose spend without inventing pre-ledger history.
- Plans 26-11 onward can attach direct artifact provenance and consume bounded tenant/time indexes.

## Self-Check: PASSED

- Created contract test and modified schema exist.
- Commits `c6a541f`, `c6c4bff`, and `c6c5d0e` are present in repository history.
- Backend typecheck passed with zero errors.
- Focused schema contract passed: 1 file, 4 tests.

---
*Phase: 26-pending-product-pages-and-vault-redesign-integration*
*Completed: 2026-08-05*
