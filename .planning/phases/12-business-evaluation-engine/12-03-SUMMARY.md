---
phase: 12-business-evaluation-engine
plan: 03
subsystem: api
tags: [convex, evaluation, growth-os, diagnose, grounding, scorecard, audit]

# Dependency graph
requires:
  - phase: 12-01
    provides: "@pikar/core/growth pure diagnose()/leverageRank()/emptyScorecard + Scorecard type"
  - phase: 12-02
    provides: "7 gated evaluation/specialist rubric skills (growth-os-diagnostic/swot/lean-canvas/bmc + specialists)"
  - phase: 10
    provides: "vaultGroundHydrated tenant-scoped grounding + SMOKE:: offline seam"
  - phase: 11
    provides: "business_profile vault doc (deserializeProfile) — sparse-start optional fields"
provides:
  - "evaluations table (by_tenant / by_tenant_thread) — the durable, tenant-isolated assessment trail"
  - "runEvaluation engine: carry-forward → ground → diagnose → persist → refs-only audit → activity step"
  - "recordScorecardAnswer (the LOCKED 'store' half — a user figure persists forward, cited user-provided)"
  - "byThread query — the latest evaluation row for the EVALUATION card (plan 04)"
  - "evaluateBusiness literal in the closed agentSteps.tool union"
affects: [12-04 evaluation card, 12-05 gap-to-plan memo, 12-06 cockpit teaching + eval gate, 13 BEVL-03 recurring review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "§1 thin adapter: Convex engine orchestrates the pure @pikar/core diagnose() over grounded + carried data"
    - "Carry-forward store loop: lastForThread seeds each run so a user-provided figure is never re-asked"
    - "Deterministic honest extraction: profile-parse + direct labeled-number scan only — no grounding → null (not fabricated)"
    - "Refs-only audit split: findings/citations are content-plane (the row); only counts/enums reach evaluation.ran"
    - "convex-test over the SMOKE:: seam (zero network) + registerComponent('auditCounts', …) for the real audit path"

key-files:
  created:
    - packages/backend/convex/evaluations.ts
    - packages/backend/convex/evaluations.test.ts
    - docs/playbooks/business-evaluation.md
  modified:
    - packages/backend/convex/schema.ts
    - docs/playbooks/watch.json

key-decisions:
  - "Storage = a dedicated append-only evaluations TABLE (research Option B), not a vaultDocuments doc-kind — clean latest-per-thread query + first-class SC #5 isolation index without parse-on-read"
  - "v1 findings are DETERMINISTIC (profile-parse + labeled-number scan); the rich per-quadrant LLM narrative is deferred to the cockpit-agent eval-gate teaching (plan 06)"
  - "Zero grounded findings → suppress gaps (no basis for a prescription = SC #1) and return 'insufficient' — thin-data honesty over a fabricated diagnosis"
  - "recordScorecardAnswer upserts (seed a minimal carrier row when no prior evaluation) so an answer given before the first run still carries forward"
  - "The grounding query is an EXPLICIT arg (the vaultGroundHydrated convention) — tests ride SMOKE::<docId>, prod hits rag.search via DEFAULT_QUERY"

patterns-established:
  - "Business-evaluation engine: the one place turning grounded data + carried answers + method into a cited, tenant-isolated row"
  - "First codebase test to ride the vaultGround SMOKE:: seam under convex-test (zero network grounding)"

requirements-completed: [BEVL-01]

# Metrics
duration: 17min
completed: 2026-07-25
---

# Phase 12 Plan 03: Business Evaluation Engine Summary

**A §1 thin-adapter evaluation engine that carries the prior Scorecard forward, grounds over the vault via the existing vaultGroundHydrated, runs the pure diagnose(), and persists ONE tenant-isolated evaluations row with source-tagged cited findings + honest not-enough-data sections — auditing counts/enums only.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-07-24T21:00:44Z
- **Completed:** 2026-07-24T21:17:49Z
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- Durable append-only `evaluations` table with `by_tenant` (SC #5 isolation) + `by_tenant_thread` (latest-per-thread) indexes, plus the `evaluateBusiness` literal in the closed `agentSteps.tool` union.
- `runEvaluation` engine: carry-forward merge (prior scorecard + userProvided[]) → ground (reuse `vaultGroundHydrated`, fail-open) → load rubric method → deterministic scorecard fill → pure `diagnose()`/`leverageRank()` → persist ONE cited row → ONE refs-only `evaluation.ran` audit → `evaluateBusiness` activity step.
- `recordScorecardAnswer` (the LOCKED "store" half) — a user's in-conversation figure persists forward and is cited "user-provided", never re-asked; `byThread` reads the latest row for the card.
- Six convex-test cases over the SMOKE:: seam (zero network): grounded cited row, refs-only audit structural assert (§4), carry-forward/anti-re-ask, two-tenant isolation (SC #5), thin-data honesty, plus the `business-evaluation.md` playbook registered in `watch.json`.

## Task Commits

Each task was committed atomically:

1. **Task 1: evaluations table + agentSteps literal** - `a1cd600` (feat)
2. **Task 2: runEvaluation + recordScorecardAnswer + byThread** - `44b99b6` (feat, TDD impl+core test)
3. **Task 3: full test suite (carry-forward/audit/isolation/thin-data) + playbook** - `2daa7ed` (test)

_Task 2 folded the TDD RED/GREEN into one feat commit (impl + the runnable core test); Task 3 expanded coverage and includes the thin-data verdict refinement._

## Files Created/Modified
- `packages/backend/convex/evaluations.ts` - The evaluation engine (runEvaluation, recordScorecardAnswer, insertEvaluation, lastForThread, byThread) — §1 thin adapter, §2 wrappers, fail-open.
- `packages/backend/convex/evaluations.test.ts` - convex-test over the SMOKE:: seam: 6 cases covering BEVL-01 + SC #5 + §4.
- `docs/playbooks/business-evaluation.md` - The subsystem playbook (invariants, data flow, how to change/verify).
- `packages/backend/convex/schema.ts` - Added the `evaluations` table + both indexes + the `evaluateBusiness` agentSteps literal.
- `docs/playbooks/watch.json` - Registered `evaluations.ts`/`.test.ts` under `business-evaluation.md`.

## Decisions Made
- **Storage = dedicated `evaluations` table** (research Option B): clean latest-per-thread query + first-class isolation index, and the structured `history` trail BEVL-03 consumes, without parse-on-read. Append-only line = no migration.
- **Deterministic v1 findings**: profile-parse (`deserializeProfile`) + direct labeled-number scan; a field with no direct grounding stays null → not-enough-data. The rich LLM-narrated per-quadrant findings ride the live model, taught via a `cockpit-agent` body change through the eval gate (plan 06).
- **Zero grounded findings → `insufficient` + suppress gaps**: a gap without a grounded finding would be a fabricated diagnosis (SC #1), so thin/idea-stage runs return an honest nudge, never a prescription.
- **`recordScorecardAnswer` upserts**: seeds a minimal carrier row if no evaluation exists yet, so an answer given before the first run still survives forward.

## Deviations from Plan

None - plan executed exactly as written. (The Task-2 verdict logic was refined during Task 3 to make a zero-grounding run honestly "insufficient" with no fabricated gap — this is within the plan's stated thin-data honesty behavior and Claude's-discretion confidence/verdict heuristics, not a scope change.)

## Issues Encountered
- **auditCounts component not registered under convex-test** — the engine's real `evaluation.ran` audit hits the `auditCounts` aggregate, which convex-test does not auto-register. Resolved by `t.registerComponent("auditCounts", aggregateSchema, aggregateModules)` (the established cockpitTools.test.ts idiom). This is the first evaluation test to also be the first to ride the vaultGround SMOKE:: seam under convex-test.
- **Biome import-sort** on the test file (the relative `../node_modules/...` aggregate import) — reordered to satisfy `organizeImports`. The remaining Biome `format` flag is environmental CRLF (it flags unmodified files like `plans.ts` too; CI runs on LF).
- **Pre-existing out-of-scope failures** left untouched: `audit.test.ts` ("component not registered") and backend test-file typecheck errors — both already logged in the phase `deferred-items.md` (STATE.md 12-02).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **Plan 04 (EVALUATION card)** can subscribe to `api.evaluations.byThread` (mirrors `api.plans.byThread`) — the row carries findings (with H/M/L confidence + source tag), gaps (leverage-ranked, route/playbook), and notEnoughData sections ready to render.
- **Plan 06 (cockpit teaching + eval gate)** registers the `evaluateBusiness` tool in `buildCockpitTools` (mirror `searchVault`) + adds `"evaluateBusiness"` to `SMOKE_OP_TOOL`, teaches the cockpit-agent WHEN to call it + `recordScorecardAnswer` after asking, and adds the golden fixtures (grounded-assessment + healthy-no-gaps). The engine, schema literal, and audit event it needs are all in place.
- **Blocker/concern:** the "names-in-prose PII ceiling" (STATE.md) still applies — grounded finding prose lives only on the content-plane `evaluations` row and must stay out of any exportable/WORM table until the redaction-boundary spike lands.

---
*Phase: 12-business-evaluation-engine*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 6 created/modified files present on disk; all 3 task commits present in history (a1cd600, 44b99b6, 2daa7ed). evaluations.test.ts 6/6 green; check-playbooks exit 0; §2 import-guard 47/47; no evaluations.ts source typecheck errors.
