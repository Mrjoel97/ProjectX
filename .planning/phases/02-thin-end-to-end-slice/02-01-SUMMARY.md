---
phase: 02-thin-end-to-end-slice
plan: 01
subsystem: database
tags: [convex, migrations, aggregate, schema, vitest, workflow]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "tenant wrappers, audit insert-only module, WorkflowManager + ActionRetrier, smokeRun CLI helper, importGuard static scan"
provides:
  - "Two registered Convex components: components.migrations + components.auditCounts (named aggregate)"
  - "Five tenant-scoped Phase-2 tables: requests, attachments, telemetry, notifications, gmailTokens"
  - "New indexes: requests by_tenant_status/by_correlation, pendingTimeouts by_correlation, deadLetters by_tenant_status"
  - "A tracked migration harness (migrations.ts) with a migration that actually runs (backfillRequestDefaults)"
  - "audit aggregate wired at the sole insert surface + countAudit (O(log n), no .collect()) + backfillAuditCounts"
  - "pipeline.ts Wave-1 stub: no-op pipelineWorkflow + reusable setStatus internalMutation + REQUEST_STATUS union"
  - "vitest wired into @pikar/core and @pikar/contracts for Wave-2 TDD"
affects: [02-02, 02-03, 02-04, 02-05, 02-06, 03-migrations]

# Tech tracking
tech-stack:
  added: ["@convex-dev/migrations@0.3.5", "@convex-dev/aggregate@0.2.2", "ai@7.0.20", "zod@^4.4.3 (contracts)", "vitest@3.2.7 (core+contracts)"]
  patterns:
    - "Register Convex components BEFORE the first schema change so codegen emits their bindings before any plan imports them"
    - "TableAggregate mirrored at the single insert surface covers the count invariant without Triggers"
    - "A migration that has never run is a migration that does not work — ship + smoke one migration now (OPSG-06)"

key-files:
  created:
    - packages/backend/convex/migrations.ts
    - packages/backend/convex/aggregates.ts
    - packages/backend/convex/pipeline.ts
    - packages/backend/scripts/run-smoke-migration.mjs
    - packages/core/vitest.config.ts
    - packages/contracts/vitest.config.ts
  modified:
    - packages/backend/convex/convex.config.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/audit.ts
    - packages/backend/convex/smokeAssert.ts
    - packages/backend/convex/lib/allowlist.ts

key-decisions:
  - "audit.log is the SOLE aggregate insert site — no Triggers needed for OPSG-01"
  - "assertMigrationRan asserts state==success && isDone via migrations.getStatus by name string"
  - "backfillAuditCounts (clearAll + re-insert) reconciles pre-existing dev rows; idempotent"
  - "Pre-existing tsc test-file failures (import.meta.glob, smoke.ts self-ref) left out of scope — logged to deferred-items.md"

patterns-established:
  - "Named aggregate registration: app.use(aggregate, { name: 'auditCounts' })"
  - "Migration smoke via smokeRun.must/pollPass so Windows/Node24 bogus exit codes are ignored"

requirements-completed: [OPSG-06, OPSG-01]

# Metrics
duration: 65min
completed: 2026-07-11
---

# Phase 2 Plan 01: Phase-2 Data Substrate Summary

**Registered @convex-dev/migrations + @convex-dev/aggregate, added five tenant-scoped tables, shipped a migration that actually runs (proven against the live deployment), and wired the audit count aggregate at its sole insert surface.**

## Performance

- **Duration:** ~65 min
- **Started:** 2026-07-11T09:50:00Z
- **Completed:** 2026-07-11T10:55:58Z
- **Tasks:** 3
- **Files created/modified:** 11 code files (+ pnpm-lock.yaml, deferred-items.md)

## Accomplishments
- Two new Convex components registered BEFORE the first schema change; codegen emits `components.migrations` and `components.auditCounts`.
- Five Phase-2 tables (`requests`, `attachments`, `telemetry`, `notifications`, `gmailTokens`) with the exact indexes their reactive queries need, plus `pendingTimeouts.by_correlation` and `deadLetters.by_tenant_status` for later plans.
- A tracked migration (`backfillRequestDefaults`) that ran against the live dev deployment and recorded a `success` state — OPSG-06's "prove the harness" done before Phase 3's first breaking change.
- The audit aggregate wired at `audit.log` (the single insert surface): `countAudit` returns a number in O(log n) with no `.collect()`, and `audit.log` writes were proven to increment the count (0 → 1).
- `pipeline.ts` Wave-1 stub so 02-03/02-05 forward references typecheck at their own wave; `vitest` wired into the two pure packages for Wave-2 TDD.

## Task Commits

1. **Task 1: Install + register migrations and aggregate components** - `1fdd36f` (chore)
2. **Task 2: Add five tables + first migration + pipeline stub** - `f4e7f52` (feat)
3. **Task 3: Wire the audit aggregate + prove the migration runs** - `eaf4119` (feat)

## Files Created/Modified
- `packages/backend/convex/convex.config.ts` - registers `migrations` + named `auditCounts` aggregate after the five Phase-1 components
- `packages/backend/convex/schema.ts` - five new tables + three new indexes; requests carries the 11-member status union
- `packages/backend/convex/migrations.ts` - Migrations client + runner + `backfillRequestDefaults`
- `packages/backend/convex/aggregates.ts` - `TableAggregate` over `audit` namespaced by `tenantId`
- `packages/backend/convex/audit.ts` - aggregate insert after each audit insert; `countAudit` + `backfillAuditCounts`
- `packages/backend/convex/pipeline.ts` - no-op `pipelineWorkflow` + reusable `setStatus` + `REQUEST_STATUS`
- `packages/backend/convex/smokeAssert.ts` - `assertMigrationRan` (state==success && isDone)
- `packages/backend/convex/lib/allowlist.ts` - allowlist `migrations.ts` + `pipeline.ts`
- `packages/backend/scripts/run-smoke-migration.mjs` - OPSG-06 automated proof
- `packages/core/package.json`, `packages/contracts/package.json` - vitest@3.2.7 (exact) + test script
- `packages/core/vitest.config.ts`, `packages/contracts/vitest.config.ts` - node-env run-only configs

## Decisions Made
- Followed plan as specified. `assertMigrationRan` uses `migrations.getStatus` with the migration's string name (avoids importing the internal ref) and asserts both `state === "success"` and `isDone`.
- `backfillAuditCounts` uses `clearAll` then re-insert (12 pre-existing dev rows reconciled) so counts match the table exactly; it is idempotent.

## Deviations from Plan

None functionally — plan executed as written. One scope-boundary note:

**[Scope boundary] Pre-existing `tsc --noEmit` failures left unfixed**
- **Found during:** Task 1 (typecheck gate)
- **Issue:** `pnpm --filter @pikar/backend typecheck` reports errors in test files (`import.meta.glob` untyped under `tsc`: audit.test.ts, tenant.test.ts, worm.test.ts, importGuard.test.ts) and `smoke.ts` (self-referential workflow type pattern).
- **Verification:** Stashed ALL 02-01 edits, regenerated `_generated`, and diffed the error set — **byte-identical to HEAD**. My changes introduce zero new errors (Task 2 incidentally resolved 3 pre-existing strict-null errors via the schema change).
- **Action:** Logged to `.planning/phases/02-thin-end-to-end-slice/deferred-items.md`. Not fixed — none are in files this plan created or modified.

**Total deviations:** 0 code auto-fixes. 1 out-of-scope discovery deferred.
**Impact on plan:** None. All verify gates pass for this plan's changes.

## Issues Encountered
- `pnpm add` failed when run via `cd packages/backend` (workspace manifest resolution error); using `pnpm --filter @pikar/backend add ...` from the repo root worked. This matches the plan's own command form.

## Verify Gates
- **codegen:** green — `components.migrations` + `components.auditCounts` emitted.
- **typecheck:** zero new errors vs HEAD (pre-existing test-file/smoke.ts failures deferred).
- **importGuard:** green (8 tests; new `aggregates.ts` scanned clean).
- **run-smoke-migration.mjs:** PASSED against the live `convex dev`:
  ```
  [smoke:migration] running migrations:backfillRequestDefaults via the runner...
  [smoke:migration] asserting the migration recorded a completed state...
  [smoke:migration] PASSED — backfillRequestDefaults ran and is tracked as success
  ```
- **aggregate proof:** `backfillAuditCounts` reinserted 12 rows; a fresh `audit.log` moved `countAudit` from 0 → 1.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The five tables exist for every other Wave-2 plan to build on; `pipeline.ts` and `setStatus` are ready for 02-03/02-05/02-06 to import.
- Migration harness proven — Phase 3's first breaking change inherits a working, tested migration path.
- Follow-up (non-blocking): a cleanup pass should add a `vite/client` type reference and annotate `smoke.ts` to make the full `tsc` gate green (see deferred-items.md).

## Self-Check: PASSED

All created files exist on disk; all three task commits (`1fdd36f`, `f4e7f52`, `eaf4119`) present in git history.

---
*Phase: 02-thin-end-to-end-slice*
*Completed: 2026-07-11*
