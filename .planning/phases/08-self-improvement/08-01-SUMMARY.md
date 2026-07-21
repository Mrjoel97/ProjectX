---
phase: 08-self-improvement
plan: 01
subsystem: database
tags: [convex, schema, feedback, kill-switch, optimizer, skillopt]

# Dependency graph
requires:
  - phase: 03-guardrails
    provides: guardrailConfig single-row default-on-read + upsert pattern (mirrored here)
  - phase: 03.1-cockpit
    provides: plans/requests content-plane tables that gain the skillVersion attribution field
provides:
  - feedback table (tenant-owned, keyed to requestId + skillName/skillVersion, up/down + optional scrubbed comment)
  - plans.skillVersion + requests.skillVersion optional attribution fields
  - optimizerConfig single-row table (kill switch + tunable thresholds)
  - optimizerConfig.ts default-off-on-read + owner upsert toggle (getOptimizerConfig / setOptimizerConfig)
affects: [08-02 feedback capture, 08-03 eligibility, 08-04 trajectory export, 08-07 CI job]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-row config: default-on-read (first() ?? DEFAULT) + partial-arg upsert, mirroring guardrails.ts"
    - "Optional attribution fields (skillVersion) → no migration (append-only schema discipline)"

key-files:
  created:
    - packages/backend/convex/optimizerConfig.ts
    - packages/backend/convex/optimizerConfig.test.ts
  modified:
    - packages/backend/convex/schema.ts

key-decisions:
  - "Optimizer ships DORMANT: DEFAULT_OPTIMIZER_CONFIG.enabled=false, a missing row reads enabled=false (the CONTEXT lock)"
  - "Starting thresholds (Claude's discretion): negativeRateThreshold 0.30, minSampleFloor 20, cooldownMs 604800000 (7d)"
  - "feedback.comment is content-plane (raw at rest on the tenant-owned row, PII-scrubbed at the export boundary in Plan 04), never audit/DLQ"

patterns-established:
  - "optimizerConfig mirrors guardrailConfig verbatim: exported DEFAULT, internalQuery reader, internalMutation partial-arg upsert stamping updatedAt"

requirements-completed: [IMPR-01, IMPR-02]

# Metrics
duration: ~15min
completed: 2026-07-21
---

# Phase 8 Plan 01: Self-Improvement Schema Substrate Summary

**feedback table + plans/requests.skillVersion attribution + a DORMANT-by-default optimizerConfig kill switch, mirroring the guardrails single-row config pattern.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments
- `feedback` table: tenant-owned, keyed to requestId + skillName/skillVersion, up/down rating + optional scrubbed comment; `by_tenant_request` (one editable row per tenant+request) + `by_skill` (eligibility rolls the negative-rate over this) indexes
- `plans.skillVersion` + `requests.skillVersion` optional attribution fields — a rating is attributable to the exact skill version that produced the response; optional → no migration
- `optimizerConfig` single-row table (kill switch + tunable thresholds) + `optimizerConfig.ts` default-off-on-read reader and owner upsert toggle — the optimizer ships DORMANT (enabled=false) as the locked CONTEXT decision requires

## Task Commits

1. **Task 1: Schema substrate (four additions)** - `e486749` (feat)
2. **Task 2 RED: failing optimizerConfig test** - `04dd3bb` (test)
3. **Task 2 GREEN: optimizerConfig implementation** - `ce07b79` (feat)

_TDD: Task 2 was RED (test first, 4 failing) → GREEN (module, 4 passing). No refactor needed._

## Files Created/Modified
- `packages/backend/convex/schema.ts` - added feedback + optimizerConfig tables, plans.skillVersion + requests.skillVersion optional fields
- `packages/backend/convex/optimizerConfig.ts` - DEFAULT_OPTIMIZER_CONFIG (enabled:false), getOptimizerConfig internalQuery, setOptimizerConfig internalMutation (partial-arg upsert)
- `packages/backend/convex/optimizerConfig.test.ts` - default-off-on-read, enable-keeps-defaults, single-row upsert, lastRunAt anchor

## Decisions Made
- **Optimizer DORMANT at ship** — DEFAULT_OPTIMIZER_CONFIG.enabled=false; a missing/false row reads enabled=false. Kill switch is OFF until an owner flips it (CONTEXT lock).
- **Starting thresholds (Claude's discretion, per CONTEXT):** negativeRateThreshold 0.30, minSampleFloor 20, cooldownMs 604800000 (7d). Exported so Plan 03 eligibility + Plan 07 CI share the same floor.
- **setOptimizerConfig drops undefined args before patch** — a partial write (e.g. CI setting only lastRunAt) never clobbers a set field with undefined.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **Pre-existing tsc error** `convex/lib/functions.ts(25,3): error TS2322` — present on the base commit (verified by stashing the schema.ts change; the error stands alone). Unrelated to the additive Phase-8 schema additions, which introduce zero new source errors. Logged to `deferred-items.md`, not fixed (out of scope — SCOPE BOUNDARY).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Feedback + attribution + kill-switch substrate exists. Plan 02 can wire feedback capture (tenant-scoped mutation) + set plans.skillVersion at propose and copy it to requests at executePlan.
- Plan 03 eligibility + Plan 07 CI can import DEFAULT_OPTIMIZER_CONFIG and read getOptimizerConfig.
- Playbook/watch.json updates for all of Phase 8 are centralized in Plan 08-08 (deliberately untouched here).

## Self-Check: PASSED

All created files exist (optimizerConfig.ts, optimizerConfig.test.ts, schema.ts) and all three task commits (e486749, 04dd3bb, ce07b79) are present in git history.

---
*Phase: 08-self-improvement*
*Completed: 2026-07-21*
