---
phase: 03-guardrails
plan: 01
subsystem: domain-logic
tags: [cost, pii, fallback, ai-sdk, result, branded-types, vitest]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "@pikar/core Result<T,E> primitives (ok/err/isOk/unwrap)"
  - phase: 03-guardrails (03-RESEARCH)
    provides: "AI-SDK error taxonomy, Gateway pricing, PII engine spike (@pikar/pii scanText)"
provides:
  - "@pikar/cost — fail-closed estimateCostUsd/priceUsage/chooseModel + PRICING/DEFAULT_MODEL/CHEAP_MODEL"
  - "isFallbackEligible error classifier in @pikar/core (GRDL-05)"
  - "SafeText brand on packages/pii — compile-time GRDL-02 layer"
affects: [03-02, 03-03, 03-04, 03-05, cost-guardrail, pii-guardrail, llm-gateway]

# Tech tracking
tech-stack:
  added: ["@pikar/cost workspace package", "ai@7.0.20 in @pikar/core"]
  patterns:
    - "Branded string (SafeText) threads redaction through the type system into cost estimation"
    - "SDK .isInstance static guards (never instanceof) survive duplicate ai package instances"
    - "Result-typed fail-closed domain functions (never NaN/throw) so convex adapter fails closed"

key-files:
  created:
    - packages/cost/src/cost.ts
    - packages/cost/src/cost.test.ts
    - packages/cost/src/index.ts
    - packages/cost/package.json
    - packages/cost/tsconfig.json
    - packages/cost/vitest.config.ts
    - packages/core/src/fallback.ts
    - packages/core/src/fallback.test.ts
  modified:
    - packages/pii/src/scan.ts
    - packages/pii/src/index.ts
    - packages/core/src/index.ts
    - packages/core/package.json

key-decisions:
  - "chooseModel accepts SafeText ONLY — unbranded strings rejected at compile time (GRDL-02/03 coupling)"
  - "estCents = Math.max(1, ceil(usd*100)) — integer cents with fail-closed bias (research Open Q5)"
  - "RetryError unwraps to lastError and re-classifies; timeout/abort matched by error.name"

patterns-established:
  - "Pure-TS domain packages return Result and fail closed; convex/ stays a thin adapter (CLAUDE.md §1)"
  - "Error classifiers read taxonomy, never message text (CLAUDE.md §4)"

requirements-completed: [GRDL-02, GRDL-03, GRDL-05]

# Metrics
duration: 10min
completed: 2026-07-12
---

# Phase 3 Plan 01: Guardrails Domain Logic Summary

**Fail-closed @pikar/cost package (estimate/price/downgrade), the isFallbackEligible AI-SDK error classifier in @pikar/core, and a SafeText brand threading PII-redaction through the type system into cost estimation.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-12T04:24:14+03:00
- **Completed:** 2026-07-12T04:34:04+03:00
- **Tasks:** 3
- **Files created:** 8 / **modified:** 4

## Accomplishments
- `@pikar/cost` linked workspace package: `estimateCostUsd`/`priceUsage`/`chooseModel` return `Result` and fail closed (unknown model → Err, over-budget → Err, never NaN/throw); GRDL-03 downgrade default→cheap proven by test.
- `isFallbackEligible` (GRDL-05): classifies retryable API errors, model-quality failures, and timeout/abort as fallback-eligible; config/auth/our-bugs → rethrow → DLQ. Uses `.isInstance` statics, never reads message text.
- `SafeText` brand (GRDL-02 layer 2): flows out of `scanText`, and `chooseModel` refuses unbranded strings at compile time.

## Task Commits

1. **Task 1: SafeText brand in packages/pii** — `4436eca` (feat)
2. **Task 2: @pikar/cost package (TDD)** — `d951ae7` (feat)
3. **Task 3: isFallbackEligible classifier (TDD)** — `c9eae16` (feat)

_Task 1 arrived partially applied from an interrupted prior run (scan.ts had the brand type but no construction-site cast and no index export); reconciled and completed._

## Files Created/Modified
- `packages/cost/src/cost.ts` — PRICING, estimateTokens, estimateCostUsd, priceUsage, chooseModel, DEFAULT/CHEAP_MODEL
- `packages/cost/src/cost.test.ts` — 11 behavior tests (token/cost/price/choose paths)
- `packages/cost/src/index.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts` — package scaffold mirroring @pikar/pii
- `packages/core/src/fallback.ts` — isFallbackEligible (9 tests)
- `packages/core/src/fallback.test.ts` — real APICallError/NoObjectGeneratedError/RetryError instances
- `packages/core/src/index.ts` — export fallback; `packages/core/package.json` — add ai@7.0.20
- `packages/pii/src/scan.ts` — SafeText brand + construction-site cast; `packages/pii/src/index.ts` — export SafeText

## Decisions Made
- `chooseModel(safeText: SafeText, ...)` — brand-only signature makes "cost estimated from redacted text" a compile-time guarantee, not a convention.
- Integer `estCents` with `Math.max(1, ...)` floor — a sub-cent estimate still consumes ≥1 cent of budget (fail-closed bias).
- `ai@7.0.20` pinned exact in @pikar/core to match the backend pin (CLAUDE.md §6).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Completed a partially-applied Task 1 from an interrupted run**
- **Found during:** Task 1
- **Issue:** `scan.ts` on disk had `PiiScanResult.safeText: SafeText` but no `as SafeText` cast at the construction site (typecheck failed TS2322) and `index.ts` did not export `SafeText`.
- **Fix:** Added the construction-site cast and the `SafeText` export.
- **Files modified:** packages/pii/src/scan.ts, packages/pii/src/index.ts
- **Verification:** `pnpm --filter @pikar/pii test` (8) + `typecheck` clean.
- **Committed in:** 4436eca

---

**Total deviations:** 1 auto-fixed (1 blocking). No scope creep.

## Issues Encountered
- **Ran in parallel with a separate 03-02 executor on the same branch.** Uncommitted backend `action-cache` edits on disk at start belonged to 03-02, not this plan — correctly left unstaged; 03-02 committed them itself (`9b409ba`). All three 03-01 commits are present and interleaved cleanly with 03-02's.
- **Out of scope (deferred):** `pnpm -r typecheck` (turbo) fails printing tsc help text for the untouched `@pikar/audit` package; each of pii/cost/core/audit typechecks clean via direct `pnpm --filter`. Logged in `03-guardrails/deferred-items.md`.

## Self-Check: PASSED
- Files exist: packages/cost/src/cost.ts, packages/core/src/fallback.ts, packages/pii/src/scan.ts (SafeText) — FOUND
- Commits exist: 4436eca, d951ae7, c9eae16 — FOUND
- Tests: @pikar/pii 8, @pikar/cost 11, @pikar/core 27 (incl. 9 fallback) — all green
- Typecheck: pii, cost, core all clean in isolation

## User Setup Required
None — pure-TS domain packages, no external service configuration.

## Next Phase Readiness
- 03-02/03-03/03-04 can now import `@pikar/cost` (chooseModel/priceUsage), `@pikar/core` `isFallbackEligible`, and the `SafeText` brand.
- No blockers introduced.

---
*Phase: 03-guardrails*
*Completed: 2026-07-12*
