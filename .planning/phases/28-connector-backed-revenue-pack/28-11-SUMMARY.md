---
phase: 28-connector-backed-revenue-pack
plan: 11
subsystem: business-finance
tags: [revenue, quickbooks, stripe, paypal, convex, deterministic-finance, tenant-isolation]

requires:
  - phase: 28-02
    provides: Pure money, aging, reconciliation, cash-timeline, payroll-gap and coverage functions
  - phase: 28-09
    provides: Provider gate and normalized connector read surfaces
provides:
  - Gate-first composition of independently available QuickBooks, Stripe and PayPal projections
  - Deterministic source-authority, currency-separation, cash, receivables and payroll results
  - Executable tenant-isolation, number-lineage, malformed-input and review-semantics evidence
  - Business-finance operating and rollback playbook distinct from Phase 26 product-spend Finance
affects: [28-12-revenue-tools, revenue-specialist, business-finance-workflows]

tech-stack:
  added: []
  patterns:
    - Provider gates resolve before optional normalized read actions
    - Convex orchestrates validated projections while pure package functions own every calculation
    - Accounting authority wins within its currency/window and every exclusion names its reason

key-files:
  created:
    - packages/backend/convex/revenueFinance.ts
    - packages/backend/convex/revenueFinance.test.ts
  modified:
    - packages/backend/convex/_generated/api.d.ts
    - docs/playbooks/revenue-finance.md

key-decisions:
  - "QuickBooks owns receivables, opening cash and booked receipts in every currency its accounting window covers; payment rails remain useful only where accounting has no authority."
  - "Currencies are returned separately; no FX conversion or inferred rate is permitted."
  - "Payroll confidence requires an explicit normalized payroll obligation, and every output carries coverage plus the qualified-professional review notice."

patterns-established:
  - "Independent rail degradation: an absent, parked, expired or refreshed-failed provider lowers only the outputs it could support."
  - "No-model arithmetic boundary: normalized inputs are validated, pure functions compute, and downstream skills may explain immutable results only."

requirements-completed: [REVN-05]

duration: 5h (interrupted continuation)
completed: 2026-08-31
---

# Phase 28 Plan 11: Deterministic Business Finance Summary

**Gate-first QuickBooks, Stripe and PayPal composition with accounting authority, separate currencies, explicit payroll obligations, and pure-function-only financial arithmetic.**

## Performance

- **Duration:** 5h including the interrupted executor handoff; about 20 minutes in the recovery continuation
- **Started:** 2026-08-31T10:50:53Z
- **Completed:** 2026-08-31T15:50:29Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added a tenant-scoped `businessFinance` action that checks deployment-global provider eligibility before resolving each optional adapter and remains useful when only one rail passes.
- Kept all aging, reconciliation, totals, timelines, payroll gaps and confidence classification in `@pikar/revenue`; malformed normalized numbers become unavailable rather than entering a prompt or displayed result.
- Proved accounting-window de-duplication, separate currencies, refreshed-failure degradation, two-tenant isolation with anti-vacuous sentinels, result-scoped exclusions and the standing accountant-review notice.
- Replaced the playbook's pre-implementation status with shipped operations, coverage/staleness diagnosis and a rollback that leaves Phase 26 Pikar-spend Finance untouched.

## Task Commits

Each task was committed atomically:

1. **Task 1: Orchestrate normalized sources with explicit authority**
   - `c06e2c3` — RED: failing independent-rail, authority, currency and refreshed-failure cases
   - `10bd289` — GREEN: bounded provider reads and deterministic business-finance composition
2. **Task 2: Prove provenance, tenant isolation and no-LLM arithmetic**
   - `afc7610` — RED: two-tenant sentinels, no-model boundary, malformed-number and review assertions
   - `3d76cb3` — GREEN: result-scoped exclusions for every unavailable normalized input
3. **Task 3: Add finance operations and accountant-review semantics**
   - `b566ad8` — shipped source authority, coverage, review and rollback operations

## Files Created/Modified

- `packages/backend/convex/revenueFinance.ts` — gate-first provider reads and thin composition over pure finance functions.
- `packages/backend/convex/revenueFinance.test.ts` — 10 orchestration and provenance tests.
- `packages/backend/convex/_generated/api.d.ts` — generated `revenueFinance` API registration.
- `docs/playbooks/revenue-finance.md` — live invariants, diagnostics, verification and rollback semantics.

## Decisions Made

- QuickBooks is the accounting authority. Stripe and PayPal may contribute only where the books provide no authority, and `reconcilePayments` excludes overlapping rail receipts inside the accounting coverage window.
- Money never crosses a currency boundary. Results are grouped by currency, and no model or adapter may invent an FX rate.
- No payroll obligation is not evidence of safety. `payrollGap` stays unknown and the orchestrator records a payroll exclusion until an explicit normalized payroll obligation exists.
- Business Finance is tenant cash/receivables/payroll. Phase 26 Finance is Pikar product usage/spend; rollback and naming keep the two subsystems separate.

## Deviations from Plan

None - the plan was executed as written. The interrupted predecessor's staged Task 2 GREEN change was audited, verified and adopted rather than duplicated.

## Issues Encountered

- The first executor stopped after its Task 2 RED commit because of a usage limit. Recovery verified `c06e2c3`, `10bd289` and `afc7610`, inspected the staged source-only continuation, ran its tests, and committed only that plan-owned change.
- The shared dirty-worktree `pnpm --filter @pikar/backend typecheck` and `node scripts/check-playbooks.mjs` remain red only because concurrent 28-12/28-13 files (`revenueTools*`, `invoiceReminders*`, and the invoice-reminder-owned `revenue-connectors.md`) are still in flight. No 28-11 diagnostic appears in either failure. An isolated TypeScript project containing `revenueFinance.ts` and its imports exited 0; its temporary config was deleted and not committed.

## Verification

- `pnpm --filter @pikar/backend test -- revenueFinance` — 10/10 passed.
- `pnpm --filter @pikar/revenue test` — 337/337 passed, including 38 finance tests.
- Isolated `revenueFinance.ts` TypeScript check — exit 0.
- `git diff --check -- docs/playbooks/revenue-finance.md` — clean.
- Shared backend typecheck/playbook gate — blocked only by concurrent non-28-11 work described above.

## User Setup Required

None - no external service configuration was added by this plan. Provider eligibility remains governed by the existing Phase 28 gate process.

## Next Phase Readiness

- `businessFinance` is ready for the 28-12 revenue tool boundary without making every provider a prerequisite.
- The remaining shared-gate failures belong to the still-running 28-12/28-13 work and do not block this plan's artifacts.

## Self-Check: PASSED

All four recorded plan files and this summary exist; commits `c06e2c3`, `10bd289`, `afc7610`,
`3d76cb3` and `b566ad8` resolve; the temporary isolated-typecheck config is absent; and the only
scoped worktree change before the metadata commit is this summary.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-08-31*
