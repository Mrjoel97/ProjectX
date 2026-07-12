---
phase: 03-guardrails
plan: 03
subsystem: api
tags: [convex, rate-limiter, guardrails, pii, cost, kill-switch, fail-closed]

# Dependency graph
requires:
  - phase: 03-01
    provides: "@pikar/pii scanText→SafeText, @pikar/cost chooseModel, SafeText brand"
  - phase: 03-02
    provides: "requests.safeText/safeTextHash/lastInstruction + by_tenant_safeTextHash index, guardrailConfig table, scanning/blocked statuses, blocked telemetry outcome"
provides:
  - "convex/guardrails.ts guard choke point: rateLimiter, prepare, preCall, recordSpend, getSafeTextByHash, setKillSwitch, getConfig, DAILY_BUDGET_CENTS"
  - "convex/lib/hash.ts — the one shared SHA-256 contentHash (extracted from requests.ts)"
  - "per-tenant submit rate limit in requests.submit (GRDL-06) with INTK-04-shaped auditable rejection"
  - "convex-test coverage of prepare/preCall/getSafeTextByHash fail-closed branches"
affects: [03-04, 03-05, llm-gateway, pipeline]

# Tech tracking
tech-stack:
  added: ["@pikar/pii (workspace dep on backend)", "@pikar/cost (workspace dep on backend)", "@convex-dev/rate-limiter (FIRST real use)"]
  patterns:
    - "Governed stop = discriminated RETURN, never a throw (prepare + preCall share the contract); only bugs throw"
    - "Fail-closed reader: getSafeTextByHash THROWS when redaction is missing — a model call structurally cannot read raw goal text"
    - "Spend accounting = check-before (estimate, prepare) + reserve-after (actual, recordSpend, integer cents, zero-skip)"

key-files:
  created:
    - packages/backend/convex/guardrails.ts
    - packages/backend/convex/guardrails.test.ts
    - packages/backend/convex/lib/hash.ts
  modified:
    - packages/backend/convex/requests.ts
    - packages/backend/package.json

key-decisions:
  - "prepare returns over_budget BEFORE the component spend check, so the fail-closed branches run under convex-test (which does not load components here); happy path + daily_budget_exhausted deferred to 03-05 smoke"
  - "guardrails.ts must not contain the literal raw-PII field name (03-04 static scan greps it) — comment reworded to avoid tripping the gate"

patterns-established:
  - "Kill switch checked FIRST (component-free) in both prepare and preCall — before any scan/estimate/component work"
  - "recordSpend uses reserve:true so actual spend drives the daily window negative; the NEXT prepare/preCall fails closed (runaway spend structurally impossible)"

requirements-completed: [GRDL-01, GRDL-03, GRDL-06]

# Metrics
duration: 30min
completed: 2026-07-12
---

# Phase 3 Plan 03: Guardrails Guard Choke Point Summary

**Single transactional guard mutation (kill switch → PII scan→persist → cost→model choice → daily-spend window) plus a per-tenant submit rate limit, with fail-closed governed stops that RETURN (never DLQ) and a redaction-gated safeText reader.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 (Task 2 was TDD: RED → GREEN)
- **Files created:** 3
- **Files modified:** 2 (+ pnpm-lock.yaml)

## Accomplishments
- `convex/guardrails.ts`: rateLimiter (submitRequest token-bucket + dailySpendCents fixed-window), `prepare` guard mutation, `preCall` mid-flight re-check, `recordSpend` reserve-consume, `getSafeTextByHash` fail-closed reader, `setKillSwitch` upsert, `getConfig` default-on-read.
- `prepare` and `preCall` return discriminated governed stops (`kill_switch` / `pii_scan_failed` / `cost_estimate_failed` / `over_budget` / `daily_budget_exhausted`) — expected rejections RETURN, only bugs throw. safeText+hash persisted only on the ok path.
- `getSafeTextByHash` THROWS when the row/safeText is missing — the structural GRDL-01 guarantee that a model call cannot obtain raw goal text.
- Per-tenant submit rate limit at the top of `requests.submit`, before `validateSubmit`/any insert; over-rate rejection is audited (reason `rate_limited`, `goalHash` — never raw goal) + notified, no workflow.
- `contentHash` extracted to `convex/lib/hash.ts` — one implementation, reused by requests.ts and guardrails.prepare.
- 5 convex-test cases green covering the fail-closed branches.

## Task Commits

1. **Task 1: limiter, config, readers, spend plumbing** - `bedd979` (feat)
2. **Task 2 RED: failing prepare fail-closed tests** - `b594209` (test)
3. **Task 2 GREEN: implement guardrails.prepare** - `751c4cb` (feat)
4. **Task 3: per-user submit rate limit** - `3d89b2d` (feat)
5. **Static-scan hygiene: drop literal PII-field name from comment** - `ed311da` (chore)

## Files Created/Modified
- `packages/backend/convex/guardrails.ts` - The guard choke point (all six exports + getConfig).
- `packages/backend/convex/guardrails.test.ts` - convex-test coverage of the governed-stop branches.
- `packages/backend/convex/lib/hash.ts` - Shared SHA-256 contentHash.
- `packages/backend/convex/requests.ts` - imports rateLimiter+contentHash; rate-limit branch at submit top.
- `packages/backend/package.json` - @pikar/pii + @pikar/cost workspace deps.

## Decisions Made
- Ordered `prepare` so `over_budget` returns before the rateLimiter component check — keeps the fail-closed branches testable under convex-test (components don't load here); the happy path + `daily_budget_exhausted` are 03-05 smoke's job (as the plan specifies).
- Reworded the "raw-PII field" comment to omit the literal field name so the 03-04 static scan (which greps for it) stays green.

## Deviations from Plan

None — plan executed exactly as written. (One in-scope hygiene fix: the plan's own verification requires the literal PII-field name to appear nowhere in guardrails.ts; my explanatory comment initially used it, so I reworded it — committed as `ed311da`.)

## Issues Encountered
- **Pre-existing suite/typecheck failures (out of scope):** `pnpm --filter @pikar/backend typecheck` is red on `*.test.ts` only (`import.meta.glob` not typed under node-only tsconfig), and `convex/audit.test.ts` fails (`auditCounts` component not registered under convex-test). Both confirmed to reproduce on clean HEAD with my changes stashed — already logged in `deferred-items.md`. Production convex code type-checks clean; my 5 new guardrails tests pass; no NEW failures introduced.

## User Setup Required
None — no external service configuration required. (Operator kill-switch is invoked via `npx convex run guardrails:setKillSwitch '{"on":true}'` when needed.)

## Next Phase Readiness
- 03-04 can wire `llm.ts` to `getSafeTextByHash` (redaction-gated read) and the static PII-field scan; 03-05 can wire the pipeline to `prepare`/`preCall`/`recordSpend` and add the guardrails smoke (happy path + rate-limit + daily-budget branches that need the live component).
- Blocker: none. Backend was down during execution (typecheck/tests run offline via tsc + vitest/convex-test).

## Self-Check: PASSED

All 3 created files exist on disk; all 5 task commits (bedd979, b594209, 751c4cb, 3d89b2d, ed311da) present in git history.

---
*Phase: 03-guardrails*
*Completed: 2026-07-12*
