---
phase: 49-qualified-public-web-and-storefront-recipes
plan: 04
subsystem: web-runtime
tags: [web-recipes, tenant-isolation, immutable-lineage, storefront-darkness, export-erasure]
requires:
  - phase: 49-03
    provides: exact active recipe registry rows, provenance and deterministic/browser evidence predicates
  - phase: 48
    provides: tenant-owned project/version append lifecycle and exact stored-artifact runtime
provides:
  - active-only tenant site/landing recipe discovery and server-resolved recipe project creation
  - immutable recipe origin lineage copied across later manual version edits
  - owner-only private storefront qualification with independent publication/runtime/HTTP refusals
affects: [SITE-03, LAND-03, SHOP-01, phase-49-05, phase-49-06, phase-49-07, phase-50]
tech-stack:
  added: []
  patterns: [shared project append seam, exact-row evidence recheck, code-owned commerce darkness]
key-files:
  created:
    - packages/backend/convex/webRecipes.ts
    - packages/backend/convex/webRecipes.test.ts
  modified:
    - packages/backend/convex/schema.ts
    - packages/backend/convex/webProjects.ts
    - packages/backend/convex/webRuntime.ts
    - packages/backend/convex/http.ts
    - packages/backend/convex/isolation.test.ts
    - packages/backend/convex/tenantExport.test.ts
    - packages/backend/convex/tenantDelete.test.ts
key-decisions:
  - "recipeRef is server-owned, immutable structured identity on each version row; later saves copy it while contentHash follows edited bytes."
  - "Storefront activation and private owner qualification remain separate from exposure; commerceContractReady is a code-owned false seam until Phase 50's typed merchant-lifecycle contract."
  - "No recipe or commerce table was added; existing tenant-owned project/version export and erasure walks remain the lifecycle boundary."
requirements-completed: [SITE-03, LAND-03, SHOP-01]
duration: approximately 60min
completed: 2026-09-22
---

# Phase 49 Plan 04: Immutable recipe lineage and dark storefront runtime Summary

**Active exact site/landing recipes now create editable tenant projects with immutable origin identity, while storefront qualification remains private and every public exposure seam fails closed.**

## Performance

- **Duration:** approximately 60 minutes
- **Started:** 2026-09-22T03:45:00Z (execution start estimate)
- **Completed:** 2026-09-22T04:38:00Z
- **Tasks:** 3/3 implemented and verified
- **Files modified:** 11 owned source/test files plus this summary

## Accomplishments

- Widened the existing web project/version validators additively for `storefront` and structured `recipeRef` identity, without adding a registry or commerce table. The shared Phase 48 append seam stamps the exact recipe name/version/skill/body/definition/input hashes and design profile identity, then preserves that ref on every later manual save.
- Added active-only, exact-canonical, still-evidenced tenant discovery and `createProjectFromRecipe`. Caller authority is limited to a closed recipe id, bounded recipe values, title/slug and an availability posture; tenant, skill row, version, provenance and lineage are resolved server-side. Added owner-only private storefront qualification/readback.
- Added independent storefront darkness at list/get/version discovery, publication/update/unpublish/rollback, runtime readiness, published resolution, runtime resolution and anonymous HTTP CTA/form boundaries. Malformed seeded published storefront pointers resolve to a closed refusal.
- Kept export/erasure on existing tenant-owned `webProjectVersions` rows, so lineage travels with the exported row and is deleted with it; export and erasure tests now carry/assert a recipe ref on the version row.
- Hardened active-row qualification to require the stored body to match the current canonical code-owned definition byte-for-byte, including registry-name pinning, before evidence checks or materialization. Added behavioral coverage for tampered/stale/mispinned rows, invalid-input atomicity, two-tenant IDOR, authority/lineage injection, site/landing-only discovery, storefront publication/runtime/HTTP darkness, and manual edit lineage retention.
- Closed `recipeRef.name` in the Convex schema to the core/contracts web recipe skill-name tuple; no new table was introduced.

## Task Commits

Git is unavailable on PATH in this environment, so no atomic task or metadata commit was created and no SHA was fabricated. The parent executor should commit the owned files when Git is available.

## Files Created/Modified

- `packages/backend/convex/schema.ts` — storefront kind and additive structured immutable recipe lineage validator.
- `packages/backend/convex/webProjects.ts` — shared server append helper, lineage copying, storefront publication/discovery/runtime refusals.
- `packages/backend/convex/webRecipes.ts` — exact active discovery, recipe materialization, owner qualification and code-owned commerce seam.
- `packages/backend/convex/webRecipes.test.ts` — source guards plus owner storefront darkness and site lineage/edit-copy integration tests.
- `packages/backend/convex/webRuntime.ts` — defense-in-depth storefront anonymous resolver refusal.
- `packages/backend/convex/http.ts` — anonymous CTA/form storefront refusal checks.
- `packages/backend/convex/isolation.test.ts` — documented public-routing index exceptions, webRecipes owner fixtures and module inventory.
- `packages/backend/convex/tenantExport.test.ts` — export round-trip assertion for version recipe lineage.
- `packages/backend/convex/tenantDelete.test.ts` — erasure assertion for recipe-bearing version rows.

## Decisions Made

- `recipeRef.name` stores the exact registry name; `skillId`, version, body/definition/input hashes and the full design-profile bundle/compiler/dials identity make origin auditable without copying raw values into control-plane payloads.
- Private storefront qualification intentionally bypasses only the exposure gate; it still requires the active exact row and all three evidence planes. No caller-controlled readiness flag exists.
- Manual Phase 48 creation remains site/landing-only and accepts no lineage field; only the server recipe path may mint `recipeRef`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the missing Plan 04 backend recipe adapter**
- **Found during:** Task 1
- **Issue:** The Phase 49-03 registry/core work was present, but the planned `webRecipes.ts` adapter and tests did not yet exist in the shared tree.
- **Fix:** Added the thin adapter over existing registry evidence, core materializers and Phase 48 append helper.
- **Files modified:** `packages/backend/convex/webRecipes.ts`, `packages/backend/convex/webRecipes.test.ts`, `packages/backend/convex/webProjects.ts`, `packages/backend/convex/schema.ts`
- **Verification:** Focused backend tests and backend typecheck pass.

**2. [Rule 1 - Bug] Prevented private storefront rows from reaching anonymous runtime**
- **Found during:** Task 2
- **Issue:** Widening the schema to accept `storefront` would otherwise let a malformed seeded published pointer pass through future resolver paths.
- **Fix:** Added independent kind checks to project discovery/publication, `resolvePublished`, `resolvePage`, and HTTP CTA/form handlers, with owner-only private readback.
- **Files modified:** `packages/backend/convex/webProjects.ts`, `packages/backend/convex/webRuntime.ts`, `packages/backend/convex/http.ts`
- **Verification:** Owner storefront qualification creates a private row while resolver returns `{ state: "invalid_host" }`; focused runtime/HTTP tests pass.

**Total deviations:** 2 auto-fixed (Rule 1, Rule 3)
**Impact on plan:** Both changes were required to complete the planned server boundary and fail-closed security posture; no new table, dependency or external capability was introduced.

**3. [Rule 1 - Security/correctness] Rejected stale or tampered active bodies**
- **Found during:** Correction cycle
- **Issue:** Canonicalizing a stored active body verified only its self-consistency; a stale or tampered row could still supply lineage while materialization used the compiled definition.
- **Fix:** `activeRecipe` now compares stored name/body against the current canonical `definitionFor(id)` before evidence or materialization.
- **Files modified:** `packages/backend/convex/webRecipes.ts`, `packages/backend/convex/webRecipes.test.ts`
- **Verification:** Tampered and mispinned active-row behavioral tests pass.

**4. [Rule 3 - Blocking] Repaired isolation governance fixtures for new owner/public surfaces**
- **Found during:** Correction cycle
- **Issue:** The full Plan 04 backend command exposed two documented anonymous-routing indexes and two new owner endpoints missing from the isolation inventory/fixtures.
- **Fix:** Added written index exceptions, valid required-argument fixtures including a real `webProjects` id, and the `webRecipes` owner module.
- **Files modified:** `packages/backend/convex/isolation.test.ts`
- **Verification:** Full targeted backend command passes 113 tests.

**5. [Rule 1 - Type safety] Aligned lineage and qualification-result types after closing the schema**
- **Found during:** Root acceptance rerun
- **Issue:** `RecipeRef.name` remained `string` after the schema was narrowed to the three recipe names, and the storefront test declared only `projectId` while reading version/hash/revision.
- **Fix:** Reused `WebRecipeSkillName` in the shared append type and declared the complete qualification result shape in the test.
- **Files modified:** `packages/backend/convex/webProjects.ts`, `packages/backend/convex/webRecipes.test.ts`
- **Verification:** Backend/core/contracts typechecks and the complete 113-test backend acceptance command pass after the fix.

## Issues Encountered

- Git is unavailable, so commits and commit verification are not possible without fabricating metadata.
- Direct Biome 2.5.3 `check --write` completed on the owned backend files (exit 0; ten pre-existing non-blocking non-null-assertion warnings remain in `http.ts`/legacy resolver code).
- `graphify update .` was attempted twice with a bounded wait and reproduced the known Windows hang; it was interrupted. `node scripts/extract-convex-edges.mjs` completed successfully afterward.
- The bounded `graphify update .` attempt reproduced the known Windows process hang and was interrupted; edge extraction completed successfully afterward.

## User Setup Required

None - no external service, provider, merchant or credential configuration is required.

## Next Phase Readiness

Plan 49-05 can consume `listAvailable`, `createProjectFromRecipe`, exact version `recipeRef` readback and owner-only storefront qualification. Storefront remains tenant-undiscoverable, unpublished, resolver-dark and HTTP-dark. Wave 7 external enablement, Wave 8 exact-production founder acceptance and Phase 50's merchant-lifecycle contract remain open.

## Verification

- `pnpm --filter @pikar/backend test -- webRecipes webProjects webRuntime webRuntimeHttp tenantExport tenantDelete isolation` — PASS (113 tests).
- `pnpm --filter @pikar/core test -- tenantData` — PASS (15 tests).
- `pnpm --filter @pikar/core typecheck` — PASS.
- `pnpm --filter @pikar/contracts typecheck` — PASS.
- `pnpm --filter @pikar/backend typecheck` — PASS.
- `node scripts/check-audit-payloads.mjs --self-test` — PASS.
- `node scripts/check-planning.mjs` — PASS.
- `node scripts/check-playbooks.mjs` — PASS.
- Direct Biome 2.5.3 `check --write` on owned files — PASS (exit 0, warnings only).
- `node scripts/extract-convex-edges.mjs` — PASS.
- `graphify update .` — attempted with bounded wait; known Windows process hang, interrupted.

## Self-Check: PASSED

- Summary and owned created/modified files exist.
- Full targeted backend tests (113), core tenantData tests, backend/core/contracts typechecks, audit self-test, formatter, planning/playbook checks and edge extraction pass.
- Commit existence cannot be checked because Git is unavailable; this is recorded above.

---
*Phase: 49-qualified-public-web-and-storefront-recipes*
*Completed: 2026-09-22*
