---
phase: 08-self-improvement
plan: 03
subsystem: optimizer
tags: [convex, optimizer, skillopt, eligibility, trigger-policy, pure-core]

# Dependency graph
requires:
  - phase: 08-self-improvement
    provides: feedback table (by_skill) + optimizerConfig (getOptimizerConfig / DEFAULT thresholds) from Plan 01
  - phase: 07-resilience
    provides: reviewThreshold.ts pure-classifier precedent (packages/core, no Date.now)
provides:
  - classifyBreach pure decision (packages/core) — floor → threshold → cooldown → eligible, inclusive boundaries
  - optimizerEligibility internalQuery — per-skill negative-rate roll + breach classification, callable via convex run
affects: [08-05 write-back audit (negativeRate + sampleCount evidence), 08-07 CI job (reads eligibility before spending minutes)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure decision in @pikar/core, thin Convex adapter over it (CLAUDE.md §1) — threshold math in exactly one unit-testable place"
    - "nowMs as a param, no Date.now in core (emailIntent.classify / reviewThreshold precedent)"

key-files:
  created:
    - packages/core/src/optimizerBreach.ts
    - packages/core/src/optimizerBreach.test.ts
    - packages/backend/convex/optimizerEligibility.ts
    - packages/backend/convex/optimizerEligibility.test.ts
  modified:
    - packages/core/src/index.ts

key-decisions:
  - "Order of checks: sample floor FIRST (also guards divide-by-zero) → threshold → cooldown → eligible; all boundaries inclusive"
  - "The roll is per-SKILL across all versions (by_skill eq skillName) — the question is 'is this skill underperforming', not 'which version'"
  - "optimizerEligibility is an internalQuery (allowlist, optimizerConfig precedent), NOT a tenant wrapper: the roll is global-per-skill and the CI job has no tenant identity"
  - "Full-index scan (ponytail) — a time-windowed variant is the upgrade path when volume grows; the sample floor + cadence make it a non-issue at beta scale"

patterns-established:
  - "Breach eligibility = pure classifyBreach(downCount,total,lastRunAt,nowMs,cfg) + a Convex query that only gathers counts"

requirements-completed: [IMPR-02]

# Metrics
duration: ~15min
completed: 2026-07-21
---

# Phase 8 Plan 03: Optimizer Eligibility (Trigger Policy) Summary

**A conservative, floor-guarded, cooldown-bounded breach check (IMPR-02): a pure `classifyBreach` in @pikar/core + a thin `optimizerEligibility` Convex query that rolls the per-skill feedback negative-rate and applies it — so one bad rating can never trigger the loop and it can't re-fire immediately.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `classifyBreach` (packages/core): pure, no Date.now — `{ downCount, total, lastRunAt?, nowMs, cfg }` → `{ eligible, reason, negativeRate }`. Order: sample floor → threshold → cooldown → eligible, all boundaries INCLUSIVE. Below the floor (incl. total 0) → `below_sample_floor` with no divide-by-zero; rate under threshold → `below_threshold`; crossed but too soon → `cooldown`.
- `optimizerEligibility` (packages/backend): an `internalQuery` the CI job runs via `convex run`. Rolls up/down feedback for a skill (default `cockpit-agent`) via the `by_skill` index across ALL versions, reads `optimizerConfig` (default-on-read) + its `lastRunAt` cooldown anchor, calls `classifyBreach`, and returns `{ eligible, reason, negativeRate, sampleCount, threshold, skillName }` — the shape Plan 05's write-back audit carries as triggering evidence and Plan 07's CI logs.

## Task Commits

1. **Task 1: Pure classifyBreach in @pikar/core (TDD)** - `96314f2` (feat)
2. **Task 2: optimizerEligibility query (thin adapter)** - `ee86646` (feat)

_TDD on Task 1: test written first (RED — module missing), then the classifier (GREEN, 7/7). No refactor needed._

## Files Created/Modified
- `packages/core/src/optimizerBreach.ts` - pure `classifyBreach` + `BreachInput`/`BreachResult`/`BreachConfig`/`BreachReason` types
- `packages/core/src/optimizerBreach.test.ts` - 7 assert cases (eligible, below-floor, zero, below-threshold, cooldown, inclusive boundary, floor-wins-over-high-rate)
- `packages/core/src/index.ts` - re-export `./optimizerBreach`
- `packages/backend/convex/optimizerEligibility.ts` - the internalQuery adapter (per-skill roll → classifyBreach)
- `packages/backend/convex/optimizerEligibility.test.ts` - 6 cases seeding feedback + config (empty, below-floor, below-threshold, eligible, cooldown, per-skill isolation)

## Decisions Made
- **Sample floor checked FIRST** — it doubles as the divide-by-zero guard (total 0 → `below_sample_floor`, negativeRate 0) and makes "one bad rating below the floor can NEVER make it eligible" structural, not a downstream check.
- **Roll is per-skill across all versions** — `by_skill` with `eq("skillName")` only; the eligibility question is whether the ACTIVE skill is underperforming, not per-version attribution.
- **internalQuery, not a tenant wrapper** — the roll is global-per-skill and the CI job carries no tenant identity, so a `tenantQuery` (which scopes to one tenant's feedback) would be wrong here; `internalQuery` is the allowlisted, `convex run`-callable choice (the optimizerConfig/guardrails precedent). Threshold math is NOT duplicated — the query only gathers counts and delegates to the shared pure classifier (CLAUDE.md §1).

## Deviations from Plan

None - plan executed exactly as written. (Two mechanical adjustments during test authoring: the `requests` seed row needs `attachmentRefs: []` + `createdAt`; `lastRunAt` is read off the config `row` directly so its type is `number | undefined` — neither changes behavior or intent.)

## Issues Encountered
- **Pre-existing test-file tsc noise** — `optimizerEligibility.test.ts(8,29): import.meta.glob TS2339` is the documented convex-test glob pattern present on every backend `.test.ts` (STATE non-regression). The SOURCE file `optimizerEligibility.ts` typechecks clean. Not a regression, out of scope.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The CI job (Plan 07) can gate its spend on `convex run optimizerEligibility:optimizerEligibility` before pulling a trajectory export.
- Plan 05's write-back audit has `negativeRate` + `sampleCount` as the IMPR-03 triggering evidence, ready off this query's return.
- Playbook/watch.json updates for all of Phase 8 remain centralized in Plan 08-08 (deliberately untouched here; `optimizerEligibility.ts` is a new uncovered file the 08-08 sweep registers).

## Self-Check: PASSED

All four created files exist (optimizerBreach.ts, optimizerBreach.test.ts, optimizerEligibility.ts, optimizerEligibility.test.ts) and both task commits (96314f2, ee86646) are in git history. Tests: core optimizerBreach 7/7, backend optimizerEligibility 6/6, both green.

---
*Phase: 08-self-improvement*
*Completed: 2026-07-21*
