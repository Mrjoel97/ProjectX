---
phase: 03-guardrails
plan: 02
subsystem: infra
tags: [convex, action-cache, schema, telemetry, guardrails]

# Dependency graph
requires:
  - phase: 02-thin-slice
    provides: requests/telemetry tables, REQUEST_STATUS union, buildTelemetry pure builder, pipeline workflow
provides:
  - "@convex-dev/action-cache 0.3.1 registered (components.actionCache) for GRDL-04 tenant-namespaced LLM cache"
  - "requests.safeText/safeTextHash/lastInstruction optional fields (redaction output, content plane)"
  - "requests by_tenant_safeTextHash index — deterministic hash→text cache recovery"
  - "guardrailConfig single-row table (GRDL-06 kill switch + per-request budget, default-on-read)"
  - "scanning + blocked request statuses (schema + pipeline REQUEST_STATUS, in lockstep)"
  - "blocked ReviewOutcome legal end-to-end (@pikar/core union, telemetry validator)"
affects: [03-03, 03-04, 03-05, cockpit]

# Tech tracking
tech-stack:
  added: ["@convex-dev/action-cache@0.3.1 (exact pin, pre-1.0)"]
  patterns:
    - "Default-on-read config table: missing row = switch OFF, zero seed, no migration"
    - "Optional schema fields + new union literals + default-on-read table need no @convex-dev/migrations run (Pitfall 7)"
    - "blocked is a first-class fail-closed terminal outcome, not an error (GRDL-01)"

key-files:
  created:
    - .planning/phases/03-guardrails/deferred-items.md
  modified:
    - packages/backend/package.json
    - packages/backend/convex/convex.config.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/pipeline.ts
    - packages/backend/convex/telemetry.ts
    - packages/core/src/buildTelemetry.ts
    - packages/core/src/buildTelemetry.test.ts

key-decisions:
  - "No migration created — all schema additions are optional fields, new union literals, or a default-on-read table (03-RESEARCH Pitfall 7)"
  - "guardrailConfig read with .first() (≤1 row), no index — kill switch defaults OFF when the row is absent"
  - "blocked telemetry outcome carries null token/cost (no LLM ran before a governed stop); schema column stays v.string(), no schema change"

patterns-established:
  - "Cache-key rails: safeTextHash + by_tenant_safeTextHash index recover redacted text from the tenant-namespaced cache key (03-RESEARCH Pattern 3)"
  - "Status unions in schema.ts and pipeline.ts REQUEST_STATUS are edited in lockstep by comment-contract"

requirements-completed: [GRDL-01, GRDL-04, GRDL-06]

# Metrics
duration: 15min
completed: 2026-07-12
---

# Phase 3 Plan 02: Guardrail Schema Rails Summary

**Installed @convex-dev/action-cache 0.3.1 (exact pin) and laid every schema/type rail the guardrail wiring needs — safeText fields + hash-recovery index, the guardrailConfig kill-switch table, scanning/blocked statuses, and a blocked telemetry outcome — with zero migration.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-12T01:20Z
- **Completed:** 2026-07-12T01:35Z
- **Tasks:** 3 (Task 3 TDD: RED → GREEN)
- **Files modified:** 7 (+1 deferred-items log)

## Accomplishments
- `@convex-dev/action-cache` 0.3.1 installed exact-pinned and registered (`app.use(cache)`); codegen emits `components.actionCache`.
- `requests` gains `safeText`/`safeTextHash`/`lastInstruction` optional fields plus the `by_tenant_safeTextHash` index (deterministic hash→text cache recovery).
- `guardrailConfig` single-row table added (GRDL-06 kill switch + per-request budget), default-on-read with zero seed.
- `scanning` + `blocked` statuses added to `requests.status` and `pipeline.REQUEST_STATUS` in lockstep (11→13).
- `blocked` is a legal `ReviewOutcome` end-to-end: `@pikar/core` union + telemetry `terminalOutcome` validator; core suite green.
- Dev deployment accepted the schema push ("Convex functions ready!") — no migration required.

## Task Commits

1. **Task 1: Install + register @convex-dev/action-cache 0.3.1** — `9b409ba` (chore)
2. **Task 2: Schema rails — safeText fields, index, guardrailConfig, new statuses** — `d7396a5` (feat)
3. **Task 3 (TDD RED): failing test for blocked outcome** — `9fa300d` (test)
4. **Task 3 (TDD GREEN): blocked telemetry outcome end-to-end** — `c7bcad0` (feat)

_No REFACTOR commit — the GREEN diff was already minimal._

## Files Created/Modified
- `packages/backend/package.json` - action-cache 0.3.1 exact dep
- `packages/backend/convex/convex.config.ts` - `app.use(cache)` registration
- `packages/backend/convex/schema.ts` - safeText fields, by_tenant_safeTextHash index, guardrailConfig table, scanning/blocked literals
- `packages/backend/convex/pipeline.ts` - scanning/blocked added to REQUEST_STATUS
- `packages/backend/convex/telemetry.ts` - `v.literal("blocked")` in terminalOutcome validator
- `packages/core/src/buildTelemetry.ts` - `blocked` added to ReviewOutcome union
- `packages/core/src/buildTelemetry.test.ts` - blocked in both outcome-loop test arrays
- `.planning/phases/03-guardrails/deferred-items.md` - logged pre-existing out-of-scope failures

## Decisions Made
- **No migration.** All additions are optional fields, new union literals, or a default-on-read table (03-RESEARCH Pitfall 7). Dev deployment accepted the push directly.
- **blocked → null token/cost.** A governed guardrail stop runs no LLM, so the telemetry row carries explicit nulls (schema column stays `v.string()` — no schema change).
- **guardrailConfig defaults OFF.** Read with `.first()`; a missing row means the kill switch is off — no seed, no index.

## Deviations from Plan

None - plan executed exactly as written. (Task 1's package.json/convex.config.ts edits were already present on disk from the interrupted prior run; reconciled and verified rather than redone.)

## Issues Encountered

**Reconciled an interrupted prior run.** Task 1's file edits (exact-pinned dep, `app.use(cache)`) and codegen were already on disk with no commit landed. Verified state, settled the lockfile (`pnpm install`), confirmed `components.actionCache` in codegen, and committed. No 03-02 commits pre-existed.

**Parallel executor observed.** A concurrent 03-01 executor committed `feat(03-01)` work (SafeText brand in `packages/pii/src/scan.ts`, `@pikar/cost` package) during execution — this claimed the out-of-scope `scan.ts` working-tree change, so nothing cross-plan was staged here. My Task 1 commit remains an ancestor of HEAD.

**Two pre-existing, out-of-scope failures logged (not fixed):**
1. `pnpm --filter @pikar/backend typecheck` reports 14 errors, ALL in test files (`import.meta.glob` untyped; convex-test `.first()` not null-guarded). Production code type-checks clean. Confirmed independent of this plan.
2. `convex/audit.test.ts` fails ("Component auditCounts is not registered") — a Phase-2 aggregate test-harness gap; reproduces against the pre-execution convex.config.ts and with 03-02 edits stashed. Backend suite otherwise: 40 passing.

Both documented in `deferred-items.md`. Per the scope boundary they belong to prior phases / a repo-wide test-harness fix, not this schema/rails plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Every rail plans 03-03/04/05 build on is in place: action-cache component, safeText/hash fields + recovery index, guardrailConfig kill switch, scanning/blocked statuses, blocked telemetry outcome. Later diffs can be purely behavioral.
- **Local backend note:** `convex dev --once` pushed the schema and regenerated codegen, then stopped (workpool halted). Continued local dev / smoke runs need a `npx convex dev` restart (backend was down at plan start; state note: it does not survive session compaction).

## Self-Check: PASSED

All 7 claimed files exist; all 4 task commits (9b409ba, d7396a5, 9fa300d, c7bcad0) reachable.

---
*Phase: 03-guardrails*
*Completed: 2026-07-12*
