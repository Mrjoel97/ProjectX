---
phase: 49-qualified-public-web-and-storefront-recipes
plan: 05
subsystem: ui
tags: [nextjs, react, convex, accessibility, web-recipes, provenance, owner-qualification]
requires:
  - phase: 49-04
    provides: active recipe discovery/creation, immutable recipeRef lineage, private qualification seam
provides:
  - accessible tenant site/landing recipe selection and bounded structured form
  - editable origin/current content identity panels and exact preview provenance
  - owner-only refs/evidence/activation/rollback and private qualification preview surface
affects: [SITE-03, LAND-03, SHOP-01, phase-49-06, phase-49-07]
tech-stack:
  added: []
  patterns: [server-owned recipe discovery, aria-linked bounded fields, owner-gated sensitive hooks, qualification-only storefront posture]
key-files:
  created:
    - apps/web/app/(app)/dashboard/sites/WebRecipeForm.tsx
    - apps/web/app/(app)/dashboard/sites/webRecipeForm.test.tsx
    - apps/web/app/(app)/ops/WebRecipeQualification.tsx
    - apps/web/app/(app)/ops/webRecipeQualification.test.tsx
  modified:
    - apps/web/app/(app)/dashboard/sites/page.tsx
    - apps/web/app/(app)/dashboard/sites/SiteEditor.tsx
    - apps/web/app/(app)/dashboard/sites/siteEditor.test.tsx
    - apps/web/app/(app)/dashboard/sites/preview/PreviewCanvas.tsx
    - apps/web/app/(app)/dashboard/sites/preview/previewCanvas.test.tsx
    - apps/web/app/(app)/ops/page.tsx
key-decisions:
  - "The tenant form consumes only server-returned active site/landing recipes and passes a closed tenant_discoverable posture; no storefront control is mounted there."
  - "Origin recipe identity is displayed separately from current version/content hash, and manual projects explicitly show missing lineage."
  - "Sensitive owner hooks remain inside the existing isOwner branch; qualification uses refs/status and exact server-returned candidate rows only."
requirements-completed: [SITE-03, LAND-03, SHOP-01]
duration: 19min
completed: 2026-09-22
---

# Phase 49 Plan 05: Structured recipe UI and owner qualification Summary

**Tenants can create editable site/landing projects from active qualified recipes with honest accessible recovery states, while owners receive a separate refs-only qualification surface for private storefront review.**

## Performance

- **Duration:** 19 min
- **Started:** 2026-09-22T04:40:00Z
- **Completed:** 2026-09-22T04:59:00Z
- **Tasks:** 3/3 implemented and verified
- **Files modified:** 10 owned UI/test files plus this summary

## Accomplishments

- Added active-only recipe cards with exact version labels, bounded labelled fields, design dials, inline `aria-describedby` errors, loading/empty/partial/refusal/error/submitting/success states, value preservation, retry, focus management, and the unchanged advanced manual creation path.
- Kept the Phase 48 editor lifecycle intact while exposing immutable recipe origin name/version/body/bundle identity next to current version/content hash; preview now shows exact lineage and a qualification-only, commerce-unavailable posture.
- Added owner-only candidate evidence/status controls, exact server-row activation/rollback calls, and private storefront qualification preview/edit controls. Ordinary tenant recipe UI has no storefront offer, import, readiness toggle, or owner mutation.

## Task Commits

Git is unavailable on PATH in this environment, so no atomic task or metadata commit was created and no SHA was fabricated. The parent executor should commit the owned files when Git is available.

## Files Created/Modified

- `apps/web/app/(app)/dashboard/sites/WebRecipeForm.tsx` — active recipe selection and accessible bounded form/recovery workflow.
- `apps/web/app/(app)/dashboard/sites/page.tsx` — mounts guided workflow while retaining manual path.
- `apps/web/app/(app)/dashboard/sites/SiteEditor.tsx` — origin/current identity panel.
- `apps/web/app/(app)/dashboard/sites/preview/PreviewCanvas.tsx` — exact provenance and qualification-only preview banner.
- `apps/web/app/(app)/ops/WebRecipeQualification.tsx` — owner-gated evidence, activation/rollback, and private qualification controls.
- `apps/web/app/(app)/ops/page.tsx` — mounts qualification component only after owner truth resolves.
- Four focused source-guard test files — form, editor, preview, and owner qualification boundaries.
- `packages/backend/convex/skills.ts` / `skills.test.ts` — refs-only web-recipe review model and exact-id global activation/rollback through the shared transition.
- `packages/backend/convex/isolation.test.ts` — non-owner coverage for the added exact-id owner mutations.

## Decisions Made

- The stale generated Convex API declaration is not edited; the new UI uses local typed casts around `anyApi` references so generated files remain untouched.
- The owner surface does not render candidate bodies, raw evidence, fixture prose, tenant ids, or arbitrary caller-selected lineage; it renders server-row names, versions, statuses, and bounded refs only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted to stale generated API types**
- **Found during:** Task 1 and Task 3 typecheck
- **Issue:** `@pikar/backend/api` generated declarations predate `webRecipes`, so direct typed mutation calls resolved to `never`.
- **Fix:** Kept generated files untouched and added local typed casts around the existing runtime `anyApi` references.
- **Files modified:** `WebRecipeForm.tsx`, `WebRecipeQualification.tsx`
- **Verification:** Web typecheck passes.

**2. [Rule 2 - Missing Critical] Corrected list semantics and field error linkage**
- **Found during:** Task 1 formatting/accessibility check
- **Issue:** Biome rejected ARIA list roles on interactive elements; field states also needed explicit assistive error linkage.
- **Fix:** Used native `ul`/`li` semantics and linked invalid controls to stable hint/error ids with `aria-describedby` and `aria-invalid`.
- **Files modified:** `WebRecipeForm.tsx`
- **Verification:** Direct Biome check passes; focused tests pass.

**3. [Rule 1 - Functional wiring] Replaced the unrelated generic and tenant-skill governance seams**
- **Found during:** Root acceptance review
- **Issue:** The first owner panel read `candidatesForReview`, which never includes web recipes, and sent global recipe ids to `rollbackTenantSkill`, which accepts only `tenantSkills` ids.
- **Fix:** Added a dedicated refs-only owner review query plus exact `skills`-id activation/rollback mutations. Both mutations delegate to the existing single global activation transition and its three-plane/prior-active rules.
- **Files modified:** `packages/backend/convex/skills.ts`, `packages/backend/convex/skills.test.ts`, `packages/backend/convex/isolation.test.ts`, `WebRecipeQualification.tsx`, its tests and ops presentation tests.
- **Verification:** Skills/isolation tests pass, including non-owner refusal, missing-evidence activation refusal, refs-only projection, exact rollback, and cross-class refusal.

**4. [Rule 1 - Functional wiring] Made the qualification-only storefront preview readable only through the owner door**
- **Found during:** Root acceptance review
- **Issue:** The preview linked to tenant `getProject`/`getVersion`, which correctly hide storefront rows, so the owner preview could never load.
- **Fix:** Qualification mode now selects `getStorefrontQualification`; the URL flag supplies no authority and the owner wrapper remains the data gate. Normal previews retain tenant queries.
- **Files modified:** `PreviewCanvas.tsx`, `previewCanvas.test.tsx`.
- **Verification:** Web typecheck and focused preview tests pass; tenant storefront reads remain unchanged and dark.

**5. [Rule 1 - Privacy] Suppressed refs parsed from malformed evidence**
- **Found during:** Root backend review
- **Issue:** A malformed seeded evidence blob could have supplied arbitrary strings in nominal ref fields even though its strict predicate failed.
- **Fix:** Eval/browser refs are projected only after the corresponding closed evidence predicate passes; invalid blobs yield booleans plus `null` refs.
- **Verification:** High-entropy malformed evidence needles are absent from the owner review response.

**Total deviations:** 2 auto-fixed (Rule 2, Rule 3)
**Impact on plan:** Both changes preserve the requested runtime boundary and improve correctness/accessibility without adding dependencies or backend schema.

## Issues Encountered

- Git is unavailable, so no commits or commit verification are possible without fabricating metadata.
- `graphify update .` was run with a bounded 20-second job and reproduced the known Windows hang; it was interrupted. `node scripts/extract-convex-edges.mjs` completed successfully.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for Phase 49-06 browser qualification. Tenant creation/edit/preview surfaces are wired to the Phase 49-04 server seams; owner qualification remains local/private, and Wave 7 external enablement plus Wave 8 founder acceptance remain open.

## Verification

- `pnpm --filter @pikar/backend test -- skills isolation` — PASS (249 tests, including the malformed-evidence non-reflection regression).
- `pnpm --filter @pikar/backend typecheck` — PASS.
- `pnpm --filter @pikar/web test -- webRecipeForm webRecipeQualification siteEditor previewCanvas opsPresentation` — PASS (5 files, 16 tests).
- `pnpm --filter @pikar/web typecheck` — PASS.
- Direct Biome 2.5.3 `check --write` on all 10 owned files — PASS.
- `node scripts/check-planning.mjs` — PASS.
- `node scripts/check-playbooks.mjs` — PASS.
- `node scripts/check-audit-payloads.mjs --self-test` — PASS.
- `node scripts/extract-convex-edges.mjs` — PASS.
- `graphify update .` — bounded 20s attempt; known Windows timeout, interrupted.

## Self-Check: PASSED

- All ten owned UI/test files and this summary exist.
- Focused tests, existing owner presentation tests, typecheck, formatter, planning/playbook/audit checks, and edge extraction pass.
- Commit existence cannot be checked because Git is unavailable; this is recorded above.

---
*Phase: 49-qualified-public-web-and-storefront-recipes*
*Completed: 2026-09-22*
