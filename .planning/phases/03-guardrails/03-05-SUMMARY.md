---
phase: 03-guardrails
plan: 05
subsystem: testing
tags: [convex, action-cache, rate-limiter, kill-switch, pii, smoke, phase-gate]

# Dependency graph
requires:
  - phase: 03-guardrails (03-01..03-04)
    provides: guardrails.prepare/preCall/recordSpend/setKillSwitch, tenant-namespaced route/draft action caches, in-action fallback, one governed blocked terminal, per-user submit rate limit
  - phase: 02-backend-spine
    provides: pipelineWorkflow, review gate, telemetry/audit/DLQ, smokeRun.mjs banner-judged runner
provides:
  - smoke:guardrails — the dev-deployment phase gate covering cache isolation/hit, real fallback, kill switch, budget (prepare AND mid-flight preCall), submit rate limit, and GRDL-02 no-raw-PII needle scan
  - parameterized seedPipeline (tenant + goal) for two-tenant cache-isolation seeds
  - five guardrail assertions + a non-consuming review-gate probe + three rate-limiter drivers
affects: [03-guardrails verify-work, 03.1-cockpit, future guardrail changes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Banner-judged dev-deployment smoke for component behaviors convex-test cannot emulate (extends the 01/02 smokeRun.mjs house pattern)"
    - "Assert-after-reject: assertions read append-only/content-plane rows that survive gate closure, so pollPass(sendDecision reject) doubles as the review-gate wait"
    - "Failure-proof cleanup: kill-switch + global spend window mutated only inside try/finally so a mid-section failure cannot brick the deployment"

key-files:
  created:
    - packages/backend/scripts/run-smoke-guardrails.mjs
  modified:
    - packages/backend/convex/smoke.ts
    - packages/backend/convex/smokeAssert.ts
    - packages/backend/package.json

key-decisions:
  - "safeTextHash is recovered from assertRedacted's JSON return (convex run prints returns on stdout), not re-derived in-script — the count/fallback/no-PII oracles key on the pipeline's exact hash"
  - "Added assertAtReview (non-consuming status probe) — the mid-flight budget test needs request A parked at awaiting_review before the drain, which sendDecision would consume"

patterns-established:
  - "Two-tenant identical-goal seeds prove action-cache isolation (same safeTextHash, per-tenant entries); the same tenant repeating a goal proves a model-free hit via the llm.called DRAFT-row count oracle"
  - "A governed stop is verified by assertBlocked's four-part check: status=blocked + guardrail.blocked audit reason + blocked telemetry + NO deadLetters row"

requirements-completed: [GRDL-02, GRDL-04, GRDL-05, GRDL-06]

# Metrics
duration: ~35min
completed: 2026-07-12
---

# Phase 3 Plan 05: Guardrails Phase-Gate Smoke Summary

**`smoke:guardrails` — a live dev-deployment suite asserting action-cache tenant isolation + model-free hits, real primary-failure fallback, kill-switch and daily-budget governed stops (prepare AND mid-flight preCall), submit-limiter rejection, and zero raw PII in any log plane; both it and the Phase-2 `smoke:pipeline` regression pass.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-12
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `smoke:guardrails` phase gate green across all six sections against the live `convex dev` deployment (banner-judged, exit codes ignored per the Windows/Node24 workaround).
- GRDL-04 proven live: two tenants with the identical goal each produce exactly one `llm.called` draft row (isolated cache entries keyed by `tenantId`+`safeTextHash`); the same tenant repeating the goal produces none (cache hit, no model call).
- GRDL-06 proven live on both governed-stop paths: kill switch blocks a fresh request, a drained daily window blocks a new request at `prepare`, and a mid-flight `regenerate` after the drain blocks at `preCall` — all landing at the ONE `blocked` terminal with NO dead letter; the submit token bucket rejects the 6th consume.
- GRDL-05: a forced primary failure produces an `llm.fallback` audit and the request still reaches the review gate. GRDL-02: a PII-bearing goal leaves zero raw email/SSN across audit (both cid and safeTextHash), deadLetters, and telemetry.
- `smoke:pipeline` regression still passes — the guardrails did not break the Phase-2 spine; cleanup left the kill switch off and the spend window reset.

## Task Commits

1. **Task 1: Seeds + assertion queries + limiter helpers** — `193dfce` (feat)
2. **Task 2: run-smoke-guardrails.mjs + full phase gate** — `d369594` (feat)

_Note: `assertAtReview` (discovered-needed while authoring the script) was committed with Task 2._

## Files Created/Modified
- `packages/backend/scripts/run-smoke-guardrails.mjs` — the 6-section phase-gate driver; try/finally around the kill-switch and budget sections; `JSON.parse(must(...))` recovers the pipeline's `safeTextHash`.
- `packages/backend/convex/smoke.ts` — `seedPipeline` gains optional `tenant`/`goal` (existing callers unchanged); `drainDailySpend`/`resetDailySpend`/`assertSubmitRateLimited` limiter drivers.
- `packages/backend/convex/smokeAssert.ts` — `assertBlocked`, `assertRedacted`, `assertNoRawPii`, `assertLlmCalledCount`, `assertFallback`, and the non-consuming `assertAtReview`.
- `packages/backend/package.json` — `smoke:guardrails` script.

## Decisions Made
- **Recover `safeTextHash` from `assertRedacted`'s return, not in-script derivation.** `convex run` prints the return value as JSON on stdout, so the count/fallback/no-PII oracles key on the pipeline's exact hash rather than a re-implementation of the redaction+hash that could drift byte-for-byte.
- **Assert-after-reject.** Redaction, audit, and `llm.called` rows are append-only / content-plane and survive gate closure, so `pollPass(sendDecision reject)` serves as both the "route+draft done" wait and the gate close for sections 1–3 — avoiding a bespoke wait primitive there.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `assertAtReview` non-consuming review-gate probe**
- **Found during:** Task 2 (authoring the mid-flight budget section)
- **Issue:** The mid-flight preCall test requires request A settled at `awaiting_review` BEFORE the daily window is drained (so its `regenerate` hits `preCall`, not `prepare`). The only existing gate signal, `sendDecision`, consumes the gate.
- **Fix:** Added a 10-line `internalQuery` that throws unless `status === "awaiting_review"`, polled via `pollPass`.
- **Files modified:** packages/backend/convex/smokeAssert.ts
- **Verification:** section 5 of `smoke:guardrails` passes — A parks at review, drain, B blocks at prepare, A blocks mid-flight.
- **Committed in:** `d369594` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The added query is the minimal primitive the plan's own section-5 scenario requires; no scope creep.

## Issues Encountered
- **Skills not active on the dev deployment initially** — `getActiveSkill` failed until `skills:seedSkills` ran (Phase-2 gotcha: seed skills or the pipeline dead-letters). Ran the seed against the live deployment; skills `executive-router`/`email-drafter` active thereafter. (Initial probe used the wrong name `executive_router`; the constants are hyphenated.)
- **Pre-existing, out-of-scope (already in `deferred-items.md`):** `audit.test.ts > "audit.log inserts exactly one row that round-trips"` fails under convex-test (unregistered `auditCounts` aggregate component) on HEAD with 03-05 stashed; `tsc --noEmit` reports errors only in `*.test.ts` (`import.meta.glob` / indexed-access). Non-test convex code typechecks clean; the other 8 test files / 50 tests pass. Neither is caused by 03-05 and neither affects the smoke phase gate.

## User Setup Required
None - no external service configuration required. The gate runs against the local `convex dev` deployment (must be running, NOT `--once`, so the workpool advances async steps).

## Next Phase Readiness
- Phase 3 (Guardrails) execution is complete: all five plans (03-01..03-05) executed. Ready for `/gsd:verify-work`.
- Optional manual (03-VALIDATION Manual-Only): real-network fallback via a bogus model id on a deployment with `AI_GATEWAY_API_KEY` set — not a blocker.

---
*Phase: 03-guardrails*
*Completed: 2026-07-12*

## Self-Check: PASSED

All created/modified files exist; both task commits (`193dfce`, `d369594`) present; `smoke:guardrails` script registered.
