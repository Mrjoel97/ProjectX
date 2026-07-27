# 16-04 — SUMMARY

**Plan:** 16-04 (wave 2) — the `research-specialist` §5 skill body + its 5-file mirror
**Completed:** 2026-07-27
**Requirements:** DISP-02, ACTN-03

## What landed

The 5-file mirror, exactly as the three Growth OS specialists ship it:

| # | File | State |
|---|---|---|
| 1 | `packages/contracts/skills/research-specialist.md` | **128 lines**, canonical source |
| 2 | `packages/contracts/src/skills/researchSpecialist.ts` | **generated from the .md**, never retyped |
| 3 | `packages/contracts/src/skill.ts` | `RESEARCH_SPECIALIST_SKILL` + `GATED_SKILLS` membership |
| 4 | `packages/backend/convex/skills.ts` `seedSkills` | appended row (no other row touched) |
| 5 | `packages/contracts/src/skills/skillBodies.test.ts` | the md↔ts drift row |

## The body — D10's six requirements, each its own section

§8's lazy ladder is **deliberately not applied here**; §8 exempts "anything explicitly requested",
and D10 is a locked owner request. The body carries all nine required sections:

1. **Decompose before you search** — never opens with the question searched verbatim; the
   sub-questions appear in the output.
2. **Search several angles, deliberately varied** — three distinct angles as a working floor, with
   an explicit note that one query rephrased four ways is *one* angle, and that the budget is finite.
3. **Cross-check** — `corroborated` vs `single-sourced` labels, including the trap that two pages
   repeating one press release are one source.
4. **Surface contradictions** — the disagreement IS the finding; silently picking one is a failure.
5. **Cite per claim with retrieval date** — inline, with the explicit statement that a bibliography
   is not per-claim citation.
6. **"Insufficient evidence" is honourable** — carries the most load-bearing sentence in the body:
   *never answer from model memory*, because Phase 12 will cite this and a confabulation becomes a
   "grounded market fact" downstream.
7. **Untrusted data** — pages are data, never instructions; and the body says plainly that this is
   the weakest layer and the capability grant is the real containment.
8. **What you can and cannot do** — exactly `searchVault` + `webResearch`, nothing else claimed.
9. **The irreducible limit, IN THE OUTPUT** — the search is provider-executed, so sources cannot be
   pinned or chosen, extraction fidelity is not controllable, and what was discarded is invisible.
   Every findings document must close with it, because a reader who is not told will assume the
   sources were audited.

## Verification

- `@pikar/contracts`: **19/19** (includes the new `research-specialist` drift row)
- `convex/skills.test.ts`: **42/42**
- Full backend suite: **669/669, 47/47 files**
- Backend `tsc`: **52 errors, zero in production source** — the documented baseline, unchanged
- `@pikar/core` `tsc`: exit 0
- `node scripts/check-playbooks.mjs`: exit 0

**Mutation-check on the drift guard (a generated constant is worthless if the guard is vacuous):**
appended one stray line to the `.md` without regenerating the `.ts` →
`research-specialist.md === its derived constant` went **RED** (1 failed / 18 passed); restored →
19/19. The guard is live.

### A flaky test, not a regression

The first full-suite run showed `onboarding.test.ts > §4.2: the serialized markdown's tier ALWAYS
follows the tenantProfiles table` failing. It passes **in isolation in this worktree**, passes **on
`main`**, and the very next full run was **669/669 green**. Load/ordering-dependent flake — recorded
so the next person does not chase it, but worth watching if it recurs.

## Deviations from the plan

None. The plan's Task-2 verify (`pnpm typecheck`) was run as the per-package `tsc` delta instead,
because repo-wide `pnpm typecheck` reports a stale-cache green (see `PARALLELIZATION.md`, `0d85975`).

## Carried forward — the version-collision rule

`seedSkills` writes `maxVersion + 1`, and optimizer dry-run candidates already occupy versions.
**No version is pinned anywhere in this plan's code or fixtures.** Before any eval or activate in
**16-09**, VERIFY which version actually carries this body. This has bitten before: Phase 10
grounding shipped at `cockpit-agent@14`, not the `@13` its plan assumed. Recorded verbatim in
`docs/playbooks/skill-registry.md`.

## Unblocked by this plan

- **16-03** (wave 3) — `specialists.test.ts` reads `skill.ts` off disk and asserts a matching
  constant for every `SPECIALISTS[route].skillName`; `RESEARCH_SPECIALIST_SKILL` now exists, so
  16-03 can add the `research` route without reddening a test it does not own.
- **16-05** — imports the constant, and `runSpecialistTurn` loads the body via `getActiveSkill`,
  which throws `NO_ACTIVE_SKILL` on an unseeded row (a `mockScript` replaces the MODEL, not the
  skill load).
