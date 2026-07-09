---
phase: 01-foundation-governance-substrate
plan: 04
subsystem: infra
tags: [convex, skills-registry, prompt-versioning, skillopt, tdd, vitest, convex-test]

# Dependency graph
requires:
  - phase: 01-foundation-governance-substrate (plan 01)
    provides: monorepo + Convex backend substrate, skills table schema (by_name_status, by_name_version indexes)
provides:
  - Versioned skills/prompt registry with a fail-closed loadSkill loader
  - activateSkill (the ONE permitted status mutation) — atomic active-flip, immutable bodies, rollback via re-activation
  - Idempotent seedSkills seeding the Executive Agent classifier v1
  - LoadedSkill loader contract in @pikar/contracts
  - Seed Executive Agent classifier skill document (canonical markdown + bundler-safe derived constant)
affects: [phase-2-executive-agent, phase-8-self-improvement-skillopt, AGNT-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Skill bodies immutable per version; a change = new version row + activateSkill flip (never patch body/name/version)"
    - "Canonical human-editable .md paired with a bundler-safe derived .ts constant; a vitest sync assertion prevents drift"
    - "Loader fails closed (throws) when no active skill exists"
    - "Grep test enforces no long inline prompt literals in convex/"

key-files:
  created:
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/contracts/src/skill.ts
    - packages/contracts/skills/executive-agent.classifier.md
    - packages/contracts/src/skills/executiveAgentClassifier.ts
  modified: []

key-decisions:
  - "Seed body ships as a derived .ts constant (Convex runtime cannot fs.read repo files); the .md stays canonical, a sync test keeps them byte-identical (LF-normalized)"
  - "activateSkill archives the prior active row and activates the target in a single mutation; rollback = re-activate a prior version"
  - "Loader fails closed to avoid silently running an agent with no governed prompt"

patterns-established:
  - "Registry-bound prompts: no agent prompt hardcoded in convex/ (CLAUDE.md rule 5), enforced by a grep test"
  - "Immutable-per-version skill rows enabling Phase 8 SkillOpt versioning + evidence"

requirements-completed: [SC-6]

# Metrics
duration: 12min
completed: 2026-07-09
---

# Phase 1 Plan 4: Skills Registry & Loader Summary

**Versioned Convex skills registry with a fail-closed loadSkill loader, atomic activateSkill flip, idempotent seedSkills, and the Executive Agent classifier seeded from a canonical markdown document — no agent prompt hardcoded anywhere.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-09T12:52:00Z
- **Completed:** 2026-07-09T12:58:30Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 5 (all created)

## Accomplishments
- `loadSkill(ctx, name)` reads the single `status==="active"` row via `by_name_status` and throws (fails closed) when none exists
- `activateSkill` internalMutation: the ONE permitted status mutation — archives current active + activates target atomically, never patching body/name/version; rollback = re-activate a prior version
- `seedSkills` internalMutation: idempotent (skips if the name exists), inserts Executive Agent classifier v1 (active)
- `LoadedSkill` loader contract (`{ body, version, skillId }`) plus error/name constants in `@pikar/contracts/skill`
- Executive Agent classifier skill document authored as canonical markdown; a bundler-safe derived `.ts` constant ships the body, with a vitest sync assertion preventing drift
- 6 passing tests: loader, fail-closed, idempotent seed, atomic activation + immutability, seed-vs-markdown sync, no-hardcoded-prompt grep

## Task Commits

Each task was committed atomically:

1. **Task 1: Failing skills loader/activation + no-hardcoded-prompt tests (RED)** - `2043eb4` (test)
2. **Task 2: Loader contract + seed skill markdown + skills module (GREEN)** - `4b41819` (feat)

_TDD: RED commit precedes GREEN commit._

## Files Created/Modified
- `packages/backend/convex/skills.ts` - Thin adapter: loadSkill (fails closed), activateSkill (atomic flip), idempotent seedSkills
- `packages/backend/convex/skills.test.ts` - convex-test loader/activation/idempotency + markdown-sync + no-hardcoded-prompt grep tests
- `packages/contracts/src/skill.ts` - LoadedSkill type, SkillLoader signature, error prefixes, seed skill name constant
- `packages/contracts/skills/executive-agent.classifier.md` - Canonical Executive Agent classifier skill document (v1, ~3017 chars)
- `packages/contracts/src/skills/executiveAgentClassifier.ts` - Bundler-safe constant derived verbatim from the markdown

## Decisions Made
- Seed body ships as a derived `.ts` constant because the Convex runtime cannot `fs.read` repo files at runtime; the `.md` remains the canonical human-editable source and a vitest sync assertion (LF-normalized) guarantees the two never drift. This is registry-bound generated data, not a hardcoded prompt.
- The no-hardcoded-prompt grep test scopes its scan to `convex/` and flags any string literal over 200 chars.
- `loadSkill` fails closed (throws `NO_ACTIVE_SKILL: <name>`) so an agent can never silently run without a governed prompt.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `import.meta.glob` type gap in convex tsconfig**
- **Found during:** Task 2 (typecheck after GREEN)
- **Issue:** `import.meta.glob` (Vite/vitest runtime feature) is not typed under the Convex tsconfig lib, producing a `tsc` error in the test file. This is a shared gap also present in the parallel plans' test files (importGuard.test.ts, tenant.test.ts).
- **Fix:** Added a scoped `// @ts-expect-error` above the `import.meta.glob("./**/*.*s")` call (a plain literal call is required for Vite's static glob transform, so aliasing/casting is not viable). Restricted to my file; the broader shared tsconfig-level fix (adding vite/vitest client types) is out of this plan's files_modified scope.
- **Files modified:** packages/backend/convex/skills.test.ts
- **Verification:** `tsc --noEmit` reports no errors for skills files; all 6 tests pass.
- **Committed in:** `4b41819` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal — a type-only shim for a systemic tsconfig gap. No behavior change, no scope creep.

## Issues Encountered
- Vite statically analyzes `import.meta.glob("<literal>")`; aliasing it to a variable or wrapping it in a TS cast breaks the transform at runtime. Resolved by keeping the plain literal call and suppressing only the type error.
- Line-ending drift risk between the LF-authored `.ts` constant and a potentially CRLF-checked-out `.md` (git warns LF→CRLF on Windows). Resolved by normalizing line endings in the sync assertion.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Skills registry + loader contract in place; Phase 2 agents load their active skill via `loadSkill` and record `{ name, version }` in telemetry/audit.
- Executive Agent classifier v1 seeded — realizes AGNT-01 routing behavior for Phase 2.
- Phase 8 SkillOpt can write new candidate versions + flip via `activateSkill`; rollback = re-activate a prior version.

## Self-Check: PASSED

All 5 created files verified present on disk; both task commits (`2043eb4`, `4b41819`) verified in git history.

---
*Phase: 01-foundation-governance-substrate*
*Completed: 2026-07-09*
