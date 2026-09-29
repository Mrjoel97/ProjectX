---
phase: 49-qualified-public-web-and-storefront-recipes
plan: 03
subsystem: registry-evaluation
tags: [web-recipes, immutable-candidates, deterministic-evaluation, browser-evidence, rollback]
requires:
  - phase: 49-02
    provides: closed canonical recipe definitions, design bundle identity and inert storefront AST
provides:
  - candidate-only publication for the three exact web-recipe registry names
  - strict zero-cost family-scoped deterministic evidence and exact-row browser evidence predicates
  - owner/evidence/provenance activation gate through the existing shared registry transition
affects: [SITE-03, LAND-03, SHOP-01, phase-49-04, phase-49-05, phase-49-06, phase-49-07]
tech-stack:
  added: []
  patterns: [exact-row evidence, immutable provenance, candidate-only publication, refs-only receipts]
key-files:
  created:
    - packages/backend/convex/webRecipeEvals.ts
    - packages/backend/convex/webRecipeEvals.test.ts
    - packages/backend/scripts/run-web-recipe-evals.mjs
  modified:
    - packages/contracts/src/skill.ts
    - packages/contracts/src/index.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
key-decisions:
  - "Web recipes remain a closed registry family outside the agent golden and workflow-pack suites; every publication, including v1, is a candidate."
  - "Each exact candidate is certified against its own complete nine-case family slice of the 27-case corpus, with zero cost and no provider/model/network authority."
  - "Recipe activation adds provenance, deterministic-suite and authenticated desktop/mobile browser conjuncts while retaining the existing owner wrapper and one archive/activate transition; prior-active rollback remains evidence-exempt."
requirements-completed: [SITE-03, LAND-03, SHOP-01]
duration: approximately 42min
completed: 2026-09-22
---

# Phase 49 Plan 03: Immutable recipe candidates and deterministic activation gates Summary

**Three canonical web recipes now publish only as dormant immutable candidates and can reach the existing registry transition only with exact provenance, complete zero-cost family evidence, exact-row browser evidence and owner authority; the correction cycle now executes real source/dial/repeat assertions and derives the suite identity from canonical case IDs.**

## Performance

- **Duration:** approximately 42 minutes
- **Started:** 2026-09-22T02:56:00Z (execution start estimate)
- **Completed:** 2026-09-22T03:39:00Z
- **Tasks:** 3/3 implemented and verified
- **Files modified:** 7 owned source/test/script files plus this summary and planning status

## Accomplishments

- Added exact `WEB_RECIPE_SKILL_NAMES`, pinned upstream provenance identities, a dedicated suite identity, and strict provenance/eval/browser predicates to the contracts package. Recipes remain absent from bootstrap seeds, `GATED_SKILLS`, and workflow-pack membership.
- Added candidate-only immutable publication and seeding for business-site, campaign-landing and storefront-catalogue definitions. Publication parses the exact canonical body, derives the registry name, validates bundle/compiler/upstream/body/version pins, allocates versions idempotently and never activates a row.
- Added a pure exact-row deterministic evaluator plus Convex issuer and offline self-check. The evaluator executes all nine cases for the exact family, proves all three source roles/bundle identity, proves bounded design-profile variation with stable document identities, and compares repeat document/profile/hash outputs. Evidence is refs/counts/hashes only, family-complete, stale/filtered/partial/nonzero-cost/raw-fixture/unknown-key evidence fails closed, and production no longer exposes a browser-evidence minting helper.
- Derived `WEB_RECIPE_EVAL_SUITE.casesHash` from the canonical 27 case IDs using the compiled contract SHA-256 implementation; the offline runner recomputes `ca0f15ec2c5f68256b9a91a4fd6b7ad7572fa0f571b6234116d6b124eaa4a7d2` and executes the exact backend test seam.
- Added the dedicated activation branch to `planGlobalActivation`; owner activation still routes through `transitionSkillActivation`, and archived/rolled-back prior-active rows retain the existing incident rollback exemption.

## Task Commits

Git is unavailable on PATH in this environment (`git --version` and `git status` fail), so no atomic task or metadata commit was created and no SHA was fabricated. The parent executor should commit the owned files when Git is available.

## Files Created/Modified

- `packages/contracts/src/skill.ts` — closed recipe names, provenance identities, suite and strict evidence predicates.
- `packages/contracts/src/index.ts` — exports the skill contract.
- `packages/backend/convex/skills.ts` — candidate publisher/seeder, refs-only inspection/evidence issuers and activation gate.
- `packages/backend/convex/skills.test.ts` — candidate lifecycle, idempotence, owner truth table and stale-evidence tests.
- `packages/backend/convex/webRecipeEvals.ts` — exact-row deterministic corpus evaluator; browser evidence is recording-only in production.
- `packages/backend/convex/webRecipeEvals.test.ts` — evaluator, raw-fixture redaction and exact-row mutation tests.
- `packages/backend/scripts/run-web-recipe-evals.mjs` — provider-free offline self-check.

## Decisions Made

- The suite identity is corpus-wide (27 cases) but each candidate's evidence records the complete nine-case slice for its own exact family; this avoids certifying a campaign or storefront body with another family’s code-side definition.
- Existing `skills.evidence` and `skills.browserEvidence` columns remain the only evidence storage; no second registry, status writer or evidence table was introduced.
- Storefront registry activation remains distinct from storefront exposure; this plan adds no public/merchant readiness path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected evaluator family cross-contamination**
- **Found during:** Task 2
- **Issue:** The first evaluator attempt applied campaign and storefront fixtures to a business-site body, correctly failing as an unknown-field input rather than proving the candidate.
- **Fix:** Scoped each exact candidate to its complete nine-case family slice while retaining the shared 27-case suite identity and family coverage assertion.
- **Files modified:** `packages/contracts/src/skill.ts`, `packages/backend/convex/webRecipeEvals.ts`, related tests/script.
- **Verification:** 197 focused backend assertions and self-check pass.

**2. [Rule 1 - Bug] Replaced dishonest offline self-check and closed evidence shapes**
- **Found during:** correction cycle
- **Issue:** The runner returned hard-coded passing counts/all-family coverage, and evidence predicates accepted undeclared payload keys.
- **Fix:** Delegate self-check execution to the exact Convex/Vitest evaluator seam, derive and verify case identity, scope evidence to one family, reject unknown/raw/fixture/content keys, and move browser fixtures into tests.
- **Files modified:** `packages/contracts/src/skill.ts`, `packages/backend/convex/webRecipeEvals.ts`, `packages/backend/convex/webRecipeEvals.test.ts`, `packages/backend/convex/skills.test.ts`, `packages/backend/scripts/run-web-recipe-evals.mjs`.
- **Verification:** 197 focused backend assertions, three package typechecks, syntax/self-check and planning gates pass.

**Total deviations:** 2 auto-fixed (Rule 1)
**Impact on plan:** Required for exact-row integrity; no scope expansion.

## Issues Encountered

- Git is unavailable, so commits and commit verification are not possible without fabricating metadata.
- Direct Biome 2.5.3 check/write completed across all seven owned files (exit 0; existing non-blocking lint warnings remain in the large legacy test file).
- `graphify update .` reproduced the known Windows post-processing hang and was interrupted once; `node scripts/extract-convex-edges.mjs` completed successfully afterward.
- Convex codegen did not complete in the bounded wait; generated API compatibility was preserved by exposing the exact-row issuer on `skills.ts`, while the dedicated evaluator remains in `webRecipeEvals.ts`.

## User Setup Required

None - no external service, provider, merchant or credential configuration is required.

## Next Phase Readiness

Plans 49-04 onward can consume the three dormant candidate identities and strict evidence contract. No recipe is activated, no storefront is exposed, and Wave 7 external enablement/Wave 8 exact-production founder acceptance remain open.

## Verification

- `pnpm --filter @pikar/backend test -- convex/webRecipeEvals.test.ts convex/skills.test.ts` — PASS (197 tests).
- `pnpm --filter @pikar/backend typecheck` — PASS.
- `pnpm --filter @pikar/contracts typecheck` — PASS.
- `pnpm --filter @pikar/core typecheck` — PASS.
- `node --check packages/backend/scripts/run-web-recipe-evals.mjs` — PASS.
- `node packages/backend/scripts/run-web-recipe-evals.mjs --self-check` — PASS (27 corpus cases, 9 per exact family, derived casesHash `ca0f15ec2c5f68256b9a91a4fd6b7ad7572fa0f571b6234116d6b124eaa4a7d2`, costUsd 0).
- `node node_modules/.pnpm/@biomejs+biome@2.5.3/node_modules/@biomejs/biome/bin/biome check --write packages/contracts/src/skill.ts packages/contracts/src/index.ts packages/backend/convex/skills.ts packages/backend/convex/skills.test.ts packages/backend/convex/webRecipeEvals.ts packages/backend/convex/webRecipeEvals.test.ts packages/backend/scripts/run-web-recipe-evals.mjs` — PASS (exit 0).
- `node --check packages/backend/scripts/run-web-recipe-evals.mjs` — PASS.
- `node scripts/check-playbooks.mjs; node scripts/check-planning.mjs` — PASS.
- `node scripts/extract-convex-edges.mjs` — PASS.

## Self-Check: PASSED (file and gate checks; commit checks unavailable)

- Summary and all seven owned source/test/script files exist.
- Focused backend tests, three package typechecks, Node syntax and offline evaluator self-check pass.
- Commit existence cannot be checked because Git is unavailable; this is recorded above.

---
*Phase: 49-qualified-public-web-and-storefront-recipes*
*Completed: 2026-09-22*
