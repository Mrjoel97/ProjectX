---
phase: 28-connector-backed-revenue-pack
plan: 13
subsystem: governed-invoice-reminders
tags: [revenue, invoices, reminders, approval, suppression, email]
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: normalized invoice reads and the governed executive/revenue tool boundary
provides:
  - Deterministic reminder selection and code-owned draft rendering from a refetched invoice
  - Executive-only staging into an existing proposed email plan
  - Static and behavioral proof that all sends remain behind Phase 19 delivery governance
affects: [28-19, 28-20, phase-19-email-delivery]
tech-stack:
  added: []
  patterns:
    - Refetch and revalidate an opaque provider ref immediately before an inert proposed-plan write
    - Treat staging and delivery as separate ownership domains joined only by human approval
key-files:
  created:
    - packages/revenue/src/reminders.ts
    - packages/revenue/src/reminders.test.ts
    - packages/backend/convex/invoiceReminders.ts
    - packages/backend/convex/invoiceReminders.test.ts
  modified:
    - packages/backend/convex/llm.ts
    - packages/backend/convex/cockpitTools.test.ts
    - packages/backend/convex/revenueTools.test.ts
    - docs/playbooks/cockpit.md
    - docs/playbooks/revenue-connectors.md
key-decisions:
  - "Only the executive loop receives stageInvoiceReminder; the revenue specialist remains a three-tool read/refusal grant."
  - "A reminder may patch one tenant-owned collecting email plan to proposed, but may not create requests, workflows, schedules, audits or sends."
  - "Immediate, scheduled and legacy sends keep the existing shared terminal, where suppression and the postal footer are checked again."
patterns-established:
  - "Reminder retry contract: refetch every attempt; an exact proposed draft is idempotent; changed source state or conflicting content refuses."
  - "Grouped suppression contract: normalize every comma-joined member and refuse the whole terminal if any member is suppressed."
requirements-completed: [REVN-06]
duration: 67min
completed: 2026-08-31
---

# Phase 28 Plan 13: Governed Invoice Reminders Summary

**An explicitly requested unpaid invoice can now become a deterministic proposed email plan, while every external effect remains behind the existing human approval and delivery rails.**

## Performance

- **Duration:** 67 min
- **Started:** 2026-08-31T16:10:00Z
- **Completed:** 2026-08-31T17:17:00Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Added pure selection and draft contracts that validate the exact provider/ref, payment state,
  minor-unit amount/currency, due date and source freshness without delegating arithmetic or wording
  to a model.
- Added an executive-only closed-schema tool that re-fetches QuickBooks or Stripe invoice evidence
  and stages code-owned subject/body text on an existing tenant-owned email plan.
- Made staging idempotent and inert: it creates no request, workflow, scheduler, audit row, provider
  mutation or mail call and never overwrites a conflicting proposed plan.
- Proved that immediate and scheduled cockpit delivery share one workflow start, the legacy path
  reaches the same dispatcher, and Gmail/Microsoft both retain the terminal suppression/footer guard.
- Documented the ownership seam: Phase 28 selects and stages; Phase 19 owns contacts, approval,
  fan-out, suppression, footer enforcement and delivery.

## Task Commits

1. **Task 1: Define deterministic reminder inputs and source guards** — `2b1e9ed` (test), `ce355e2` (feat)
2. **Task 2: Stage the reminder as an existing proposed email plan** — `4f766ba` (test), `fc31c54` (feat), `8ad2e78` (feat)
3. **Task 3: Prove suppression across every delivery terminal and document ownership** — `0bfdb22` (test/docs)
4. **Verification fix: Make new boundary tests pass the TypeScript gate** — `912bfa3` (fix)

## Zero-Send Proof

| Boundary | Proof |
|---|---|
| Pure reminder package | Accepts normalized projections and returns immutable draft facts; owns no Convex/provider/mail dependency |
| `invoiceReminders.ts` | Contains no Gmail, Graph, delivery, workflow start, scheduler, HTTP verb/fetch, action type or external target |
| Persistence | Has one `ctx.db.patch` site and writes only `status: "proposed"` plus deterministic subject/body |
| Behavioral fixture | Exact retry creates zero `requests` and zero `audit` rows; foreign tenant, empty recipient and conflicting plan refuse |
| Runtime grant | Executive loop receives the staging tool; the exact revenue specialist tuple does not |

## Delivery Terminal Matrix

| Entry path | Convergence | Terminal governance |
|---|---|---|
| Immediate cockpit approval | shared `startFanout` | `internal.delivery.send` -> provider `prepareGovernedMessage` |
| Scheduled cockpit approval | shared `startFanout` | `internal.delivery.send` -> provider `prepareGovernedMessage` |
| Legacy pipeline | existing pipeline delivery call | `internal.delivery.send` -> provider `prepareGovernedMessage` |

`prepareGovernedMessage` rechecks current suppression and the required postal footer. Contact
suppression normalizes every address in a grouped recipient; one suppressed member refuses the
entire terminal before any member is sent.

## Decisions Made

- Explicit intent is a closed literal, not model-inferred permission.
- Provider state is re-fetched for every attempt; an invoice becoming paid between attempts stops
  before the plan write.
- The existing plan row and recipient collection are prerequisites. The reminder lane does not
  invent recipients or create its own lifecycle substrate.
- Static architecture assertions complement behavioral tests so a later alternate mail/provider
  path fails visibly even if a fixture never executes it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed transpile-only assumptions from the new test fixtures**

- **Found during:** Final backend TypeScript verification
- **Issue:** Optional AI-SDK tool keys were dereferenced without non-null proof, the new Convex module
  was absent from the stale generated API type map, and a test queried a nonexistent workflow table.
- **Fix:** Used a typed `makeFunctionReference`, asserted tool construction explicitly, excluded test
  modules from the Convex glob, and kept workflow absence as a structural assertion.
- **Files modified:** `invoiceReminders.test.ts`, `revenueTools.test.ts`
- **Verification:** focused tests 12/12; backend TypeScript exit 0
- **Committed in:** `912bfa3`

**Total deviations:** 1 auto-fixed verification blocker. **Impact:** Test typing now matches the
runtime contract; production authority and behavior did not change.

## Issues Encountered

- The original parallel executors reached the account usage ceiling after committing partial work.
  The shared-tree commits were preserved and completed without rewriting history.
- The broad delivery suite emits expected background fixture errors for unregistered Convex
  components and absent media credentials; its process completed successfully with 471/471 tests.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @pikar/revenue test -- reminders` | 11/11 passed |
| `pnpm --filter @pikar/backend test -- invoiceReminders contacts gmail plans cockpit --reporter=dot` | 13 files, 471/471 passed |
| `pnpm --filter @pikar/backend test -- invoiceReminders revenueTools --reporter=dot` | 12/12 passed after type fix |
| `pnpm --filter @pikar/backend typecheck` | exit 0 |
| `'{}' \| node scripts/check-playbooks.mjs check` | silent/pass |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Candidate evaluation and activation can inspect a fully inert proposed-plan seam without gaining
  new provider-write or delivery authority.
- Provider lane rollout can use these reminders only after its own gate passes; reminder containment
  does not imply provider activation.

## Self-Check: PASSED

- `packages/revenue/src/reminders.ts` — FOUND
- `packages/revenue/src/reminders.test.ts` — FOUND
- `packages/backend/convex/invoiceReminders.ts` — FOUND
- `packages/backend/convex/invoiceReminders.test.ts` — FOUND
- Commits `2b1e9ed`, `ce355e2`, `4f766ba`, `fc31c54`, `8ad2e78`, `0bfdb22`, `912bfa3` — FOUND
- No `## Self-Check: FAILED` marker — CONFIRMED

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-08-31*
