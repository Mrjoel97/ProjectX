---
phase: 11-persona-onboarding-business-profile
plan: 01
subsystem: onboarding
tags: [business-profile, persona, skill-registry, vault-doc, pure-core, convex]

# Dependency graph
requires:
  - phase: 06-live-voice
    provides: voice-brief — the UNGATED "output is a vault doc, not tool-state" skill precedent this mirrors
  - phase: 01-foundation-governance-substrate
    provides: skill registry (seedSkills / GATED_SKILLS / md↔ts drift test) and the pure packages/core convention
provides:
  - "@pikar/core businessProfile module: Persona union (solopreneur|startup|sme), BusinessProfile type, decideConfirm (SC#1 always-confirm), serializeProfile, validateProfile"
  - "UNGATED business-profile extraction skill seeded v1/active (BUSINESS_PROFILE_SKILL + businessProfileSkillBody)"
  - "onboarding.md playbook + four registered watched-path prefixes for Waves 2-4"
affects: [onboarding-adapter, profile-page, phase-12-evaluation-engine, vault-grounding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Persona confirm-not-assume encoded as a pure decision fn (decideConfirm) whose return type is literally { needsConfirm: true } — auto-commit is impossible at the type level, backstopped by an exhaustive runtime test"
    - "Lean-core field names are a downstream contract read by the Phase 12 eval engine — deterministic serializeProfile so re-embed-on-edit replaces cleanly"

key-files:
  created:
    - packages/core/src/businessProfile.ts
    - packages/core/src/businessProfile.test.ts
    - packages/contracts/skills/business-profile.md
    - packages/contracts/src/skills/businessProfile.ts
    - docs/playbooks/onboarding.md
  modified:
    - packages/core/src/index.ts
    - packages/contracts/src/skill.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - docs/playbooks/watch.json
    - docs/playbooks/skill-registry.md

key-decisions:
  - "Business-profile is UNGATED (mirrors voice-brief): its output is a vault-doc profile a human confirms (SC#1), not autonomous tool-state, so the eval gate cannot meaningfully assert it — not added to GATED_SKILLS"
  - "Persona always resolves to a best-fit of the three allowed values (never enterprise, never a fabricated 4th) — the user confirms/corrects afterward, so a best-fit guess is correct behavior"
  - "Plain TS + a small validator over Zod (ponytail rung 5) — no downstream reuse of a schema OBJECT yet; upgrade path is exporting a Zod schema if the backend extraction action needs the same object"
  - "Followed the skill-registry playbook's standard 5-file mirror (added the canonical .md + drift test.each row) rather than the plan's shorter 3-file list — required to hold the no-drift invariant"

patterns-established:
  - "5-file skill mirror is the mandated add-a-skill path (canonical .md + derived byte-identical .ts + name const + seedSkills entry + drift test.each row)"
  - "Derived skill .ts generated programmatically via JSON.stringify of the LF-normalized .md to guarantee byte-identity, not hand-transcribed"

requirements-completed: [ONBD-01, ONBD-02]

# Metrics
duration: 10min
completed: 2026-07-24
---

# Phase 11 Plan 01: Onboarding + Business Profile Foundation Summary

**Pure @pikar/core business-profile module encoding SC#1 (persona always confirmed, enterprise never emittable) plus an UNGATED extraction skill seeded v1/active and an onboarding subsystem playbook.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-24T15:23:05Z
- **Completed:** 2026-07-24T15:32:49Z
- **Tasks:** 3
- **Files modified:** 11 (5 created, 6 modified)

## Accomplishments
- SC#1 landed as pure, unit-tested logic: `decideConfirm` always returns `{ needsConfirm: true }` — no code path auto-commits a persona; the return type is literally `true`, so auto-commit is impossible at the type level, and an exhaustive runtime test backstops it (11 core tests green).
- Persona union locked to `solopreneur | startup | sme`; `isPersona` and `validateProfile` reject `enterprise`.
- `serializeProfile` renders deterministic vault-doc markdown covering every Lean-core field; empty lists render an explicit `_None specified_` placeholder rather than fabricated content.
- UNGATED `business-profile` extraction skill seeded v1/active via the standard 5-file mirror; drift/no-hardcoded tests green (42 backend skills tests).
- `onboarding.md` playbook created and registered in `watch.json` with the four new path prefixes so the Stop hook protects Waves 2-4 without blocking them.

## Task Commits

Each task was committed atomically:

1. **Task 1: Onboarding playbook + register watched paths** - `e669f21` (docs)
2. **Task 2: Pure business-profile domain module (TDD, SC#1)** - `7b9aa59` (feat)
3. **Task 3: Seed UNGATED business-profile extraction skill (5-file mirror)** - `25c8b24` (feat)

_Note: Task 2 was TDD — RED (test fails, module missing) was verified in-flight before GREEN; committed as one feat commit since the failing-first step was confirmed live._

## Files Created/Modified
- `packages/core/src/businessProfile.ts` - Pure domain module: Persona union, BusinessProfile type, decideConfirm (SC#1), serializeProfile, validateProfile, isPersona
- `packages/core/src/businessProfile.test.ts` - 11 tests: always-confirm, enterprise-not-emittable, serializer equality, validator
- `packages/core/src/index.ts` - Re-export businessProfile
- `packages/contracts/skills/business-profile.md` - Canonical extraction prompt (intake→Lean-core profile, persona ∈ 3 values, empty-for-unknown)
- `packages/contracts/src/skills/businessProfile.ts` - Derived byte-identical `businessProfileSkillBody`
- `packages/contracts/src/skill.ts` - `BUSINESS_PROFILE_SKILL` const (absent from GATED_SKILLS)
- `packages/backend/convex/skills.ts` - Import + seedSkills[] row (ungated, boots v1/active)
- `packages/backend/convex/skills.test.ts` - Drift test.each row for business-profile.md
- `docs/playbooks/onboarding.md` - New onboarding subsystem playbook
- `docs/playbooks/watch.json` - onboarding.md entry with four watched prefixes
- `docs/playbooks/skill-registry.md` - Bumped Last verified (this plan mints the skill)

## Decisions Made
- **Ungated skill** — mirrors the voice-brief precedent; output is a human-confirmed vault doc, not tool-state, so the eval gate would be decorative. Not added to GATED_SKILLS.
- **Best-fit persona, never enterprise** — the prompt instructs a best-fit of the three allowed values (usually `sme`) if the intake reads enterprise; the user confirms afterward, so a best-fit guess is correct, an invented 4th value is not.
- **Plain TS over Zod** (ponytail rung 5) — no downstream reuse of a schema object yet; upgrade path recorded in the module if the backend extraction action later needs the same object.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Followed the full 5-file skill mirror instead of the plan's 3-file list**
- **Found during:** Task 3 (seed the extraction skill)
- **Issue:** The plan's `files_modified` listed only `skill.ts`, `businessProfile.ts` (contracts), and `skills.ts`. But the skill-registry playbook (line 68) and every prior skill precedent mandate the standard 5-file mirror: a canonical `.md`, a byte-identical derived `.ts`, the name const, the seedSkills entry, AND a drift `test.each` row. Shipping only the derived `.ts` without a canonical `.md` and its no-drift test row would violate the CLAUDE.md §5 "no hardcoded prompts" convention and leave the new skill's body unprotected against drift.
- **Fix:** Created `packages/contracts/skills/business-profile.md` (canonical) and added the `business-profile.md` row to the drift `test.each` in `skills.test.ts`. Derived `.ts` generated programmatically from the `.md` (JSON.stringify of LF-normalized content) to guarantee byte-identity.
- **Files modified:** packages/contracts/skills/business-profile.md, packages/backend/convex/skills.test.ts
- **Verification:** `pnpm --filter @pikar/backend vitest run skills` — 42 tests green including the new drift row.
- **Committed in:** 25c8b24 (Task 3 commit)

**2. [Rule 1 - Bug] Fixed a tsc never-overlap error in the SC#1 test**
- **Found during:** Task 2 (core typecheck after GREEN)
- **Issue:** `decideConfirm`'s return type is literally `{ needsConfirm: true }`, so the test's `n === false` comparison tripped `TS2367` (types 'true' and 'false' have no overlap) — tests passed at runtime but `tsc --noEmit` failed.
- **Fix:** Typed the results array as `boolean[]` so the runtime backstop assertion compiles while the (stronger) type-level guarantee stands.
- **Files modified:** packages/core/src/businessProfile.test.ts
- **Verification:** `pnpm --filter @pikar/core exec tsc --noEmit` exit 0; 11 tests green.
- **Committed in:** 7b9aa59 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both necessary for correctness/convention-conformance. No scope creep — deliverables match the plan's artifacts and must_haves.

## Issues Encountered
- Backend `tsc --noEmit` (the plan's Task 3 verify) reports 52 pre-existing errors — ALL in unrelated `*.test.ts` files (the known Convex-test tsconfig gaps: `withIndex` on custom indexes and `import.meta.glob` typing). Confirmed pre-existing by stashing this plan's changes and re-counting (still 52); zero errors in any source file or in the changed lines. Backend source typechecks clean; the vitest skills suite (the real gate) is 42/42 green. These test-file gaps are out of scope per the scope boundary.

## User Setup Required
None - no external service configuration required. (A fresh deployment must run `seedSkills` to boot the new skill — standard, already covered by the skill-registry playbook's fresh-deploy checklist.)

## Next Phase Readiness
- Wave 2+ has its substrate: the pure profile module (contracts + SC#1), a seeded extraction skill, and playbook coverage on all four future onboarding paths.
- Deferred/known ceiling carried into S1/S4: names-in-prose PII (packages/pii scrubs structured PII only) — grounded profile prose must stay out of exportable/WORM tables until the NER spike resolves (recorded in onboarding.md Known gaps and STATE blockers).

---
*Phase: 11-persona-onboarding-business-profile*
*Completed: 2026-07-24*

## Self-Check: PASSED

- All 5 created files verified present on disk.
- All 3 task commits verified in git history (e669f21, 7b9aa59, 25c8b24).
