---
phase: 12-business-evaluation-engine
plan: 01
subsystem: core
tags: [growth-os, diagnostic, ltgp-cac, cfa, pure-ts, scorecard, port]

# Dependency graph
requires:
  - phase: 11-persona-onboarding-business-profile
    provides: "grounded business-profile vault doc the engine parses into a Scorecard"
provides:
  - "Scorecard type (all-nullable) + emptyScorecard default (packages/core/src/growth/scorecard.ts)"
  - "ltgpCac() + cfa() pure financial-spine math with guarded divisors (financialSpine.ts)"
  - "diagnose() top-down gate router + leverageRank() (diagnose.ts)"
  - "growth-diagnostic playbook + watch registration for packages/core/src/growth/"
affects: [12-business-evaluation-engine plan 03 (Convex engine), plan 04/05 (gap list/UI), 13-proactive-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Python→TS verbatim-behaviour port kept Convex-free in packages/core (CLAUDE.md §1)"
    - "Nullable-is-load-bearing: unknown financial input → ask, never a fabricated metric/route"

key-files:
  created:
    - packages/core/src/growth/scorecard.ts
    - packages/core/src/growth/financialSpine.ts
    - packages/core/src/growth/financialSpine.test.ts
    - packages/core/src/growth/diagnose.ts
    - packages/core/src/growth/diagnose.test.ts
    - packages/core/src/growth/index.ts
    - docs/playbooks/growth-diagnostic.md
  modified:
    - docs/playbooks/watch.json

key-decisions:
  - "Scorecard is camelCase TS + adds identity.marketViable/commodity (read by diagnose.py but absent from the template.json leaf set) — all nullable"
  - "The conservative unknown→ask lives at the money-model gate: all-null {payback,tdc,cac,ltgp} → ask with empty route/proofMetric, so an empty scorecard never falsely reaches 'scale'"
  - "scale branch stays faithful to diagnose.py (route lead-engine/11-more-better-new) with the 'compound working channels' intent in constraint/reason"
  - "growth NOT re-exported from packages/core/src/index.ts (ponytail) — consumers import @pikar/core/growth/index; add root export only when needed"

patterns-established:
  - "Pure growth-math module under packages/core/src/growth/ with per-module vitest checks (no fixtures)"
  - "diagnose gate numbering 0|1|2|3|'scale' with leverageRank ordering the gap list"

requirements-completed: [BEVL-01]

# Metrics
duration: 8min
completed: 2026-07-24
---

# Phase 12 Plan 01: Growth Diagnostic Math Port Summary

**Convex-free port of the Growth OS diagnostic spine — Scorecard type + ltgpCac/cfa + a top-down gate router that routes to the single highest-leverage constraint and ASKS rather than fabricating a metric on null financials.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-24T20:39:09Z
- **Completed:** 2026-07-24T20:47:19Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Ported `ltgp_cac.py` + `cfa.py` to pure-TS `ltgpCac()`/`cfa()` with the worked example pinned (LTGP 4500 / CAC 150 / ratio 30) and every divisor guarded (null/false, never NaN).
- Ported `diagnose.py` to `diagnose()`: top-down Market→Offer→Money→Leads gates, stop at first failure, one leverage-ranked prescription; healthy → `scale`.
- Encoded the "no fabricated metrics" guarantee (BEVL-01) in the type system: an all-nullable `Scorecard` + a money-model gate that emits `ask` (no route, no metric) when financials are unknown.
- Added `leverageRank()` for the ≤5 gap list, the `growth-diagnostic` playbook, and its watch.json registration.

## Task Commits

Each task committed atomically (TDD: test → feat):

1. **Task 1: Scorecard type + financial-spine math** — `efb7c8a` (test) → `99d7953` (feat)
2. **Task 2: diagnose() gate router + leverage rank** — `7049845` (test) → `313dc26` (feat)
3. **Task 3: Growth-diagnostic playbook + watch registration** — `e369891` (docs)

## Files Created/Modified
- `packages/core/src/growth/scorecard.ts` - `Scorecard` all-nullable type + `emptyScorecard`
- `packages/core/src/growth/financialSpine.ts` - `ltgpCac()` + `cfa()` + `FLOOR_RATIO`/`INDUSTRY_MULTIPLE`
- `packages/core/src/growth/financialSpine.test.ts` - worked example + CFA boundaries + divisor guards
- `packages/core/src/growth/diagnose.ts` - `diagnose()` gate router + `leverageRank()`
- `packages/core/src/growth/diagnose.test.ts` - one case per gate regime + null→ask + healthy→scale
- `packages/core/src/growth/index.ts` - re-exports the three modules
- `docs/playbooks/growth-diagnostic.md` - subsystem playbook (invariants / change safely / verify)
- `docs/playbooks/watch.json` - registered `packages/core/src/growth/` under the new playbook

## Decisions Made
- **Scorecard shape:** camelCase TS mirror of `business-scorecard.template.json`, every leaf `T | null`, plus `identity.marketViable`/`identity.commodity` which `diagnose.py` reads but the template's leaf set omitted. Presence-checklist booleans default `false` (known-absent), matching the template.
- **Where "ask" lives:** the conservative unknown→ask is placed at the money-model gate entry — when `{payback, tdc, cac, ltgp}` are all null the prescription carries `ask` with empty `route`/`proofMetric`, guaranteeing an empty scorecard never falls through to a false `scale` verdict. Gates 0/1 stay faithful to `diagnose.py` (route or continue on booleans; null → continue).
- **scale branch:** kept faithful to `diagnose.py` (`route: lead-engine`, `playbook: 11-more-better-new`); the plan's "compound working channels" phrasing lives in the constraint/reason.
- **No package-root export (ponytail):** `packages/core/src/index.ts` left untouched (not in plan scope); consumers use `@pikar/core/growth/index` via the existing `./*` wildcard export.

## Deviations from Plan

None - plan executed exactly as written. (One in-plan test bug was fixed during Task 2: the Gate 3 CAC-over-industry case left `tdc < cac`, which correctly tripped the earlier Gate 2 `tdc<cac` check; raised `thirtyDayCashPerCustomer` above `cac` so the intended Gate 3 path is exercised — impl unchanged, verifying the top-down stop-at-first-gate invariant held.)

## Issues Encountered
- Vitest `-- <name>` positional does not filter to a single file in this workspace (runs the whole suite); harmless — the full `@pikar/core` suite is fast (~6s, 191 tests) and stayed green.

## User Setup Required
None - pure math module, no external service configuration.

## Next Phase Readiness
- Plan 03 (the Convex engine) can import `diagnose`, `ltgpCac`, `cfa`, `Scorecard`, `leverageRank` from `@pikar/core/growth/index` and get a single leverage-ranked prescription that is fabricated-metric-impossible on null input.
- No blockers. Market-fact grounding remains scoped out until Phase 16 (web research); `marketViable` is a supplied signal for now.

---
*Phase: 12-business-evaluation-engine*
*Completed: 2026-07-24*

## Self-Check: PASSED
- All 7 created files present on disk.
- All 5 task commits (efb7c8a, 99d7953, 7049845, 313dc26, e369891) present in git history.
- `pnpm --filter @pikar/core test` green (191 tests) · `typecheck` clean · `check-playbooks.mjs` exit 0.
