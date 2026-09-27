---
phase: 49-qualified-public-web-and-storefront-recipes
plan: 06
status: complete
subsystem: web-recipe-qualification
tags: [web-recipes, zero-cost-eval, browser-evidence, activation, rollback, storefront-darkness]
requires:
  - phase: 49-05
    provides: rendered tenant recipe/editor and owner qualification controls
provides:
  - complete deterministic 60-case three-family corpus and exact-row zero-cost runner
  - strict rendered authenticated desktop/mobile browser evidence contract
  - all-family v1-to-v2-to-v1 owner rollback and immutable project lineage proof
affects: [SITE-03, LAND-03, SHOP-01, phase-49-07]
tech-stack:
  added: []
  patterns: [core-owned fixture corpus, refs-only rendered evidence, active-gated version allocator]
key-files:
  created:
    - packages/core/src/webRecipeFixtures.ts
    - packages/core/src/webRecipeFixtures.test.ts
    - apps/web/e2e/phase49-recipe-qualification.spec.ts
  modified:
    - packages/core/src/index.ts
    - packages/contracts/src/skill.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/webRecipeEvals.ts
    - packages/backend/convex/webRecipeEvals.test.ts
    - packages/backend/convex/webRecipes.test.ts
    - packages/backend/convex/webRecipes.ts
    - packages/backend/scripts/run-web-recipe-evals.mjs
    - apps/web/app/(app)/ops/WebRecipeQualification.tsx
    - apps/web/app/(app)/ops/webRecipeQualification.test.tsx
decisions:
  - "The exact suite is 60 cases: 20 equal cases per family, including valid partial/max/consent/attribution, required/unknown/non-canonical/one-over, injection, cross-family, identity mutation, deterministic repeat, design dials, source coverage/influence/removal and commerce attempts." 
  - "A same-byte recipe only allocates v2 after the prior exact row is active; an unchanged pending candidate remains idempotent."
  - "Browser evidence requires authenticated owner actor, rendered /ops route, exact id/name/version/body hash, desktop/mobile viewports, positive revision and a closed refs-only outcome set."
  - "Rendered evidence is issued only after a server-owned candidate run/challenge transcript is advanced by the owner UI; candidate preview materializes documents without publishing projects or tenant authority."
metrics:
  duration: approximately 70min
  reviewed: 2026-09-23
  tasks: 3/3 locally qualified
  files: 11 owned files plus planning summary
---

# Phase 49 Plan 06: Exact zero-cost corpus, rendered owner evidence, and rollback proof Summary

**Repository/local Plan 06 accepted on 2026-09-23.** Root corrected the evaluator,
rendered preview, trusted browser evidence, rollback assertions and disposable stack
cleanup. The earlier verification entries below are historical; the authoritative final
run and remaining environment limits are in
`docs/agent-work/phase49-runner-review-corrections.md`.

## Accomplishments

- Added one core-owned canonical corpus with 20 cases per family. It covers positive and allowed partial inputs, required and unknown/non-canonical rejection, maximum and one-over bounds, HTML/script/event/javascript/data URL injection, cross-family inputs, changed identity probes, deterministic repeat, design dials, all three upstream source roles and removal probes, landing consent/attribution, and storefront attempts for inventory, quantity, cart, buy, checkout, payment, merchant URL, tax, shipping, refund, order and fulfilment.
- Rewired the backend evaluator to consume the exact fixture corpus, evaluate the exact stored candidate body, assert source influence/removal and identity-mutation refusals, and emit only hashes, counts, case identities and other refs. The suite identity is now 60 cases (20 per family), with derived cases hash `326abb8bee078b84df0f3957f3b7f39120c060fed9b762f0f59383c026bee7fb`.
- Tightened browser evidence to require the owner actor, rendered `/ops` route, exact candidate identity, both required viewports, positive revision and the closed refs-only outcome set. Added server-owned begin/advance/finalize transcript mutations and a candidate-bound owner preview/readback flow for all three families. The owner flow records no raw input/HTML, never creates a project, and keeps storefront commerce and tenant discovery unavailable.
- Reworked the Playwright protocol so each exact v1 and v2 row is selected, hash-checked, previewed/edited/read back, refusal/recovery-tested, rendered at desktop and mobile, finalized through the owner UI, then activated. Cleanup runs in `finally` through the isolated registry cleanup mutation.
- Added backend proof for all three families: v1 evidence and activation, active-gated same-byte v2 publication/evidence/activation, v2 project creation (including private storefront qualification), exact v1 rollback, unchanged v2 project bytes/lineage, site/landing-only discovery and storefront darkness.

## Verification

- `node packages/backend/scripts/run-web-recipe-evals.mjs --self-check` — PASS: 60 corpus cases, 20 per exact family, `costUsd=0`.
- `pnpm --filter @pikar/core test -- webRecipeFixtures webRecipes designKnowledge` — PASS (14 tests).
- `pnpm --filter @pikar/backend test -- skills webRecipeEvals webRecipes` — PASS (208 tests).
- `pnpm --filter @pikar/core typecheck`, `@pikar/contracts typecheck`, `@pikar/backend typecheck`, `@pikar/web typecheck` — PASS.
- `PIKAR_E2E_STORAGE_STATE=e2e/.auth/user.json pnpm --filter @pikar/web test:e2e -- e2e/phase49-recipe-qualification.spec.ts --project=chromium` — ATTEMPTED actual Chromium run (not `--list`); blocked before staging because isolated local Convex was not running (`ECONNREFUSED 127.0.0.1:3210`). No browser evidence was claimed or written. The exact spec remains available for rerun once the local backend is started.
- Direct Biome check on all owned files — PASS (exit 0; pre-existing non-null assertion warnings remain in legacy files).
- `node scripts/check-playbooks.mjs`, `node scripts/check-planning.mjs`, `node scripts/check-audit-payloads.mjs --self-test`, and `node scripts/extract-convex-edges.mjs` — PASS.
- `graphify update .` — bounded 20-second attempt timed out on the known Windows process hang; stopped without changing the source tree. Edge extraction completed afterward.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced the incomplete hand-written evaluator inputs with a canonical corpus**

- **Found during:** Task 1
- **Issue:** The existing evaluator had only 27 hand-written cases and omitted several required bounds, identity, consent/attribution and commerce attempts; fixture source files were absent.
- **Fix:** Added the core corpus, synchronized the contract suite identity, and made the exact-row evaluator consume it without writing raw inputs to evidence.
- **Files modified:** core fixture/index/test, contracts, evaluator/test, runner.

**2. [Rule 2 - Missing critical evidence integrity] Closed the browser evidence shape**

- **Found during:** Task 2
- **Issue:** Browser evidence previously pinned only identity and viewport names, so it did not record rendered route, actor class, revision or bounded outcome refs.
- **Fix:** Added strict owner/rendered-route/revision/outcome checks and regression cases for wrong actor, route, revision and raw content.
- **Files modified:** contracts, backend evaluator tests, web recipes test, skills test, E2E spec.

**3. [Rule 1 - Bug] Enabled a genuine active-gated v2 allocation**

- **Found during:** Task 3
- **Issue:** Re-seeding an unchanged candidate after v1 activation returned v1 again, preventing a real v2 rollback drill; initial pending candidates still needed idempotence.
- **Fix:** The recipe seeder increments only when the newest same-byte row is active; a pending same-byte row remains idempotent.
- **Files modified:** `packages/backend/convex/skills.ts`, `packages/backend/convex/skills.test.ts`, E2E protocol.

## Issues Encountered

- Git is unavailable on PATH in this Windows environment. No task or metadata commits were created and no SHA was fabricated; the parent executor must commit the owned files when Git is available.
- `graphify update .` remains unavailable within the bounded Windows execution window; `node scripts/extract-convex-edges.mjs` passed after the timeout.
- The authenticated browser run is an environment gate, not a product failure: Next started on `:3111`, but the pre-existing local Convex backend binary/service was unavailable and starting `convex dev` attempted a blocked external authorization. No external/provider/model/production call was made.

## Self-Check: PASSED — repository/local scope only

- All three new Plan 06 files and all listed modified files exist.
- Final isolated production-build/authenticated-browser runner passed exit 0 with all six
  fixture rows cleaned and its owned root removed. Exact evaluator self-check passed at
  implementation `9d153dd4…`, fixture `fc9ff503…`, costUsd 0. See the dated root review
  for full digests, refs and final runner evidence.
- Historical 14 empty run-created directories still cannot be removed; live Git-dependent
  playbook qualification/commit and graph refresh are unavailable in this environment.
  These are recorded environment work, not passed gates. External provider/legal and
  exact-production founder acceptance remain open under the governing closure programme.

---
*Phase: 49-qualified-public-web-and-storefront-recipes*
*Reopened for root corrections: 2026-09-23*
