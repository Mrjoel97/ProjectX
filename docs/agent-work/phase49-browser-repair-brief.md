# Phase 49 browser qualification repair — serial implementation brief

Status: dispatched for serial implementation after evaluator root acceptance; not accepted. Date: 2026-09-23.

Parent: `49-06-PLAN.md`, with corrections in `phase49-qualification-root-review.md`.
Do not begin source edits until the evaluator/renderer worker is root-reviewed. This is an
execution mapping of the existing plan, not a replacement plan or reduced acceptance scope.

## Ownership and constraints

The next worker owns browser-only portions of `packages/contracts/src/skill.ts`, qualification
fields in backend `schema.ts`, qualification mutations in `skills.ts` and `webRecipes.ts`,
profile-aware rendering in `webProjects.ts`, their focused tests, the owner
`WebRecipeQualification.tsx` component and rendered tests, and
`apps/web/e2e/phase49-recipe-qualification.spec.ts`. Update the skill-registry/public-web-runtime
playbooks and their watch coverage. Preserve the accepted fixture-ownership cleanup controls.

The worker is not alone in the repository: preserve all unrelated edits. No recursive workers,
installs, paid/provider calls, production changes, commits or deployment. Do not alter the
evaluator suite to accommodate failing browser tests. Root owns final acceptance.

## Protocol to implement

1. Begin captures exact candidate/body/bundle/renderer identity and a fresh run ID. Use a
   monotonic transcript revision independent of recipe version. Rebegin invalidates prior runs.
2. Viewport selection opens a desktop/mobile lane; it does not assert actual browser width.
   Every preview checks owner, run, candidate identity, current revision and non-finalized state.
3. Materialization records bounded server-derived outcomes and input/document/rendered-byte
   hashes. Expected validation refusals return a typed refusal and persist the observation;
   unexpected faults do not count as refusal. Do not accept client outcome arrays or hashes.
4. Require partial, refusal, recovery, changed edit and successful preview in **each** lane.
   Recovery follows refusal; edit requires both changed normalized input and changed artifact.
   Identical resubmission, stale concurrent writes and outcomes in only one lane fail completion.
5. Finalization freezes the complete transcript and returns its canonical hash. It must not write
   browser evidence or claim Playwright execution. Revisions and both lane histories are hash-bound.
6. Only the trusted internal runner writer issues browser evidence after actual browser assertions.
   Require exact finalized run/hash/revision/identity and complete lanes, with no legacy-shape
   bypass. The runner's admin authority is the trust boundary; do not claim cryptographic proof
   of pixels. A submitted owner transcript alone never enables activation.

Keep persisted transcripts refs/hashes/counts/closed outcome tokens only. No input text, HTML,
screenshots, credentials or arbitrary error strings. Invalidate old receipts via the current
browser evidence revision; preserve historical immutable project artifacts.

## Rendered output and project integration

Use the accepted pure designed renderer, including its identity and validated profile. Do not
replace the manual/legacy renderer or rewrite stored artifacts. Profile-based new project
versions and exact-candidate previews must use the same designed rendering semantics.

Display server-produced HTML in a read-only iframe with empty sandbox permissions. Controls
must expose loading, refusal, partial, recovery, edit and awaiting-runner-review states honestly.
Restore a real owner-only private storefront creation/readback control. Replace source-string
UI tests with rendered interactions and exact mutation-argument assertions.

## Browser run and isolated-target preflight

The current E2E spec reads `.convex/local/default/config.json` and constructs its admin client
at module import. Remove that implicit target selection. Listing tests must not require reading
credentials or choosing a deployment. Actual qualification requires an explicitly selected,
fresh disposable local backend configuration. Never fall back to the existing default database.

Before fixture mutation or owner provisioning, prove loopback application/backend origins and
that the production-built application's actual backend matches the fixture client. A local app
URL alone is insufficient: its embedded Convex endpoint could target a different deployment.
Use the existing fixture guard plus explicit empty-registry precondition; keep retries at zero.
Do not print admin keys or reuse production storage state. Cleanup must use only server-stamped
run ownership and captured IDs; report retained artifacts if cleanup cannot complete.

For all three exact v1 and v2 candidates, drive real controls at 1280px and 390px. Assert authored
text visible **inside the iframe**, changed text after editing, absence of forbidden executable
content, sandbox permissions, useful layout/no overflow, and exact body/artifact readback hashes.
Exercise partial/refusal/recovery/edit independently at each width. Do not issue the internal
witness until all observations pass; failure leaves activation unavailable.

Activate via owner UI only. Create real v2 site/landing projects through normal forms and a
private storefront through its owner control. Snapshot immutable bytes and lineage. Roll back
all three through UI, prove old v2 artifacts unchanged and newly created artifacts resolve v1.
Check storefront is still absent from ordinary discovery and anonymous serving throughout.

## Required evidence for root review

- Behavioral protocol tests: non-owner/foreign run, same-version changed identity, stale CAS,
  incomplete lanes, identical edit, forged outcomes, direct finalize, missing internal witness,
  legacy receipt, replay after rebegin and writes after finalization.
- Rendered component tests and profile-aware persisted-artifact tests; existing legacy-byte
  compatibility and tenancy/public-runtime tests stay green.
- Production web build and authenticated isolated all-family desktop/mobile rollback E2E.
  Test discovery or unit mocks are not substitutes for this run.
- Exact commands, exit codes, fixture-cleanup result and refs-only artifact locations. Report
  `ready_for_review`, not accepted. Root reviews source, evidence and remaining claim boundaries.

Wave 7 external/provider/legal and Wave 8 exact-production founder acceptance remain separate.

## Pre-dispatch byte baseline

Captured read-only on 2026-09-23 while the evaluator worker was active but did not own these
paths. SHA-256 values identify the current dirty-worktree bytes, not commits or accepted code.
Recheck before dispatch; capture the contracts/renderer baseline only after that worker finishes.

```text
c8987e5b06a9e69f4708865e5f5e0429aa1aa4c35611c2078f227347bf3715d2  packages/backend/convex/skills.ts
8686ed0906b2a7dcda20c12b76b27a4defc4a6a29714f746ce11e37611bc298a  packages/backend/convex/skills.test.ts
155428b108f73cb957f95b511faf166206b861acd20ba95fc6dbd00b99d7401b  packages/backend/convex/schema.ts
58b5def073de228c93204b10c4f93aee374798837d1911a22814824a0f9e2c5d  packages/backend/convex/webRecipes.ts
d5f849cb5da2ac052cc01e63c275e547ac4d969d5d0b3e23d8ec7023dd2066ed  packages/backend/convex/webRecipes.test.ts
e1d0a4005e5673798c405acc1e60e40bf00f582f69b4a987dc9e70096994203f  packages/backend/convex/webProjects.ts
0faa296b9c2d20514080affa337617bd9bc63780cf9a79d88ece96a3f03ef123  packages/backend/convex/webProjects.test.ts
95f13ec5b46886b61fc0d4ddd474730b0911643936faa8541f61964db3502f96  apps/web/app/(app)/ops/WebRecipeQualification.tsx
26f83f175aa765d3635cc094e39da974921a3a013d1d3714dd150495202ddc95  apps/web/e2e/phase49-recipe-qualification.spec.ts
```
