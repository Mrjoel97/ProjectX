---
phase: 49
slug: qualified-public-web-and-storefront-recipes
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-21
---

# Phase 49 — Validation Strategy

> Phase 49 proves repository/local recipe qualification only. Wave 7 external enablement and Wave 8
> exact-production founder acceptance remain separate, and storefront public exposure remains
> fail-closed until Phase 50 supplies the code-owned commerce contract.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + convex-test + Playwright + repository static/self-check scripts |
| **Config files** | `packages/core/vitest.config.ts`, `packages/backend/vitest.config.ts`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts` |
| **Quick run command** | Plan-local targeted Vitest files plus the relevant zero-cost self-check |
| **Full suite command** | Phase 48/49 targeted suites, browser matrix, production build, claim/playbook/planning checks and `node scripts/check-free-gates.mjs` |
| **Estimated runtime** | Targeted feedback ≤ 60 seconds; browser/build/full gates may take several minutes |

## Sampling Rate

- After every task: run the task's focused automated command.
- After every plan wave: rerun all Phase 49 tests introduced through that wave and affected package
  typechecks.
- Before phase verification: run all three recipe families through the deterministic eval and
  authenticated browser matrices, then the production build and repository gates.
- Never use watch mode, a provider/model call, public DNS, merchant rail or production traffic as a
  routine verifier.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 49-01-T1 | 49-01 | 1 | SITE-03, LAND-03, SHOP-01 | immutable source/license snapshot | `node scripts/verify-design-knowledge-provenance.mjs --manifest-only` | ❌ plan creates | ⬜ pending |
| 49-01-T2 | 49-01 | 1 | SITE-03, LAND-03, SHOP-01 | deterministic offline compiler | `node scripts/compile-design-knowledge.mjs --check` | ❌ plan creates | ⬜ pending |
| 49-01-T3 | 49-01 | 1 | SITE-03, LAND-03, SHOP-01 | provenance/exclusion positive controls | `node scripts/verify-design-knowledge-provenance.mjs --self-test && node scripts/verify-design-knowledge-provenance.mjs` | ❌ plan creates | ⬜ pending |
| 49-02-T1 | 49-02 | 2 | SITE-03, LAND-03, SHOP-01 | design contract/catalogue AST | `pnpm --filter @pikar/core test -- designKnowledge webRuntime && pnpm --filter @pikar/contracts typecheck` | ❌ plan creates | ⬜ pending |
| 49-02-T2 | 49-02 | 2 | SITE-03, LAND-03, SHOP-01 | deterministic recipe materialization | `pnpm --filter @pikar/core test -- designKnowledge webRecipes webRuntime && pnpm --filter @pikar/core typecheck` | ❌ plan creates | ⬜ pending |
| 49-03-T1 | 49-03 | 3 | SITE-03, LAND-03, SHOP-01 | candidate-only registry | `pnpm --filter @pikar/backend test -- skills webRecipeEvals` | ❌ plan creates | ⬜ pending |
| 49-03-T2 | 49-03 | 3 | SITE-03, LAND-03, SHOP-01 | exact zero-cost suite | `node packages/backend/scripts/run-web-recipe-evals.mjs --self-check` | ❌ plan creates | ⬜ pending |
| 49-03-T3 | 49-03 | 3 | SITE-03, LAND-03, SHOP-01 | activation truth table | `pnpm --filter @pikar/backend test -- skills webRecipeEvals && pnpm --filter @pikar/backend typecheck` | ❌ plan creates | ⬜ pending |
| 49-04-T1 | 49-04 | 4 | SITE-03, LAND-03 | project lineage/isolation | `pnpm --filter @pikar/backend test -- webRecipes webProjects isolation` | ❌ plan creates | ⬜ pending |
| 49-04-T2 | 49-04 | 4 | SHOP-01 | storefront fail-closed backend | `pnpm --filter @pikar/backend test -- webProjects webRuntime webRuntimeHttp` | ❌ plan creates | ⬜ pending |
| 49-04-T3 | 49-04 | 4 | SITE-03, LAND-03, SHOP-01 | export/erasure/privacy | `pnpm --filter @pikar/backend test -- webRecipes tenantExport tenantDelete && node scripts/check-audit-payloads.mjs --self-test` | ❌ plan creates | ⬜ pending |
| 49-05-T1 | 49-05 | 5 | SITE-03, LAND-03 | structured recipe UX | `pnpm --filter @pikar/web test -- webRecipe` | ❌ plan creates | ⬜ pending |
| 49-05-T2 | 49-05 | 5 | SITE-03, LAND-03, SHOP-01 | provenance/owner preview | `pnpm --filter @pikar/web test -- webRecipe siteEditor previewCanvas` | ❌ plan creates | ⬜ pending |
| 49-05-T3 | 49-05 | 5 | SHOP-01 | tenant darkness/UI states | `pnpm --filter @pikar/web test -- webRecipe && pnpm --filter @pikar/web typecheck` | ❌ plan creates | ⬜ pending |
| 49-06-T1 | 49-06 | 6 | SITE-03, LAND-03, SHOP-01 | full deterministic corpus | `node packages/backend/scripts/run-web-recipe-evals.mjs --self-check` | ❌ plan creates | ⬜ pending |
| 49-06-T2 | 49-06 | 6 | SITE-03, LAND-03, SHOP-01 | exact browser evidence | `pnpm --filter @pikar/web test:e2e -- e2e/phase49-recipe-qualification.spec.ts` | ❌ plan creates | ⬜ pending |
| 49-06-T3 | 49-06 | 6 | SITE-03, LAND-03, SHOP-01 | exact v1→v2→v1 fully requalified rollback | `pnpm --filter @pikar/web test:e2e -- e2e/phase49-recipe-qualification.spec.ts && pnpm --filter @pikar/backend test -- skills webRecipeEvals webRecipes` | ❌ plan creates | ⬜ pending |
| 49-07-T1 | 49-07 | 7 | SITE-03, LAND-03, SHOP-01 | integrated browser/storefront-dark matrix | `pnpm --filter @pikar/web test:e2e -- e2e/phase49-web-recipes.spec.ts` | ❌ plan creates | ⬜ pending |
| 49-07-T2 | 49-07 | 7 | SITE-03, LAND-03, SHOP-01 | playbook/planning/typecheck governance | `node scripts/check-playbooks.mjs && node scripts/check-planning.mjs` | ❌ plan creates | ⬜ pending |
| 49-07-T3 | 49-07 | 7 | SITE-03, LAND-03, SHOP-01 | one-tree aggregate qualification | `node scripts/check-phase49-qualification.mjs --self-test && node scripts/check-phase49-qualification.mjs` | ❌ plan creates | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

## Wave 0 Requirements

Existing Vitest, convex-test, Playwright, isolated local Convex and repository self-check
infrastructure cover the phase. Each plan creates its named focused files before invoking them.

## Manual-Only Verifications

None. Exact local founder/browser behavior is automated; Wave 7 external facts and Wave 8
production acceptance are intentionally not simulated or marked complete.

## Validation Sign-Off

- [x] Every planned task has a focused automated gate.
- [x] No three consecutive implementation tasks lack automated verification.
- [x] Missing test references are created by their owning plan.
- [x] No watch-mode, provider, paid, merchant or production verifier is required.
- [x] Feedback latency is bounded; browser/build gates are end-of-phase exceptions.
- [x] `nyquist_compliant: true` is set.

**Approval:** ready 2026-09-21
