# Phase 49 deterministic evaluator — bounded slice root-accepted

Reviewed locally: 2026-09-23. Scope: Plan 06 deterministic qualification only. No recipe was
activated, no browser witness was minted, and no local or production deployment was used.

## Changed behavior

- Every grouped case input now runs independently. A rejection only counts when the materializer
  reports bounded input/document validation; an accepted later input or assertion failure fails the
  candidate. Behavioral mutation tests cover both prior false-positive paths.
- The corpus retains twenty case categories per family and all twelve commerce attempts. Its hash
  binds the full ordered JSON content, including grouped inputs and expected outcomes. Tests change
  an input and an expectation without changing an ID and observe a different hash.
- Changed-bundle parses a mutated candidate definition and raw generated-bundle label/data after
  positive controls. Source removal deletes each role's raw generated records and requires the
  production bundle parser to reject it. Dial cases independently vary variance, motion and density
  and compare actual CSS values while checking canonical document identity. Mutation tests prove
  ignored pattern, palette, form and each dial fail qualification.
- The runner binds normalized source bytes from the evaluator, fixture builder, evidence predicate,
  runner, materializer, design selector and generated bundle, and both renderers. The contract's
  digest field is replaced by a fixed placeholder while hashing to avoid a self-hash cycle. Its
  self-check verifies those bytes and tamper controls, then executes the
  backend test using the production evaluator against all three seeded exact candidate bodies.
  Fixture and implementation changes retire prior evidence through a new suite hash/revision.
- A pure `webDesignRenderer` emits deterministic, code-owned CSS from a validated closed profile.
  It preserves the existing Phase 48 document renderer's nodes and checks source roles before
  output. Disabled motion and reduced-motion preferences suppress hover translation; long content
  wraps on narrow screens. No external resources, arbitrary CSS, JavaScript or provider call are used.
- Every required field is separately removed in refusal fixtures. Campaign CTA paths now enforce
  their existing declared 256-character bound, with valid 256 and rejected 257 character controls.

## Verification

- `pnpm --filter @pikar/core test -- webRecipeFixtures webDesignRenderer webRecipes designKnowledge`: 19/19 pass.
- `pnpm --filter @pikar/backend test -- webRecipeEvals`: 10/10 pass.
- `node packages/backend/scripts/run-web-recipe-evals.mjs --self-check`: pass, exact three-family
  candidate evaluation at zero provider cost.
- Core, contracts and backend typechecks: pass.
- `graphify update .`: repeated bounded attempts produced no output and were interrupted.
  `node scripts/extract-convex-edges.mjs`: pass after the final attempt. The graph
  refresh is not claimed complete.

## Root correction review addendum

The second pass exercises the raw generated bundle through `parseDesignKnowledgeBundle`: a good
bundle succeeds, edited labels/data fail, and removal of each complete source role fails. The
renderer/evaluator checks actual pattern alignment, palette, typography, form control sizing and
each Taste dial's distinct CSS value. Behavioral mocks that ignore a role or dial fail the exact
candidate evaluator. CTA path boundaries match the published 256-character definition, and every
required field has an independent omitted-field refusal. The implementation manifest includes the
full evidence predicate contract, fixture builder and runner, with only the implementation digest
literal replaced by a self-hash placeholder. Synthetic predicate and fixture-builder edits change
the digest. Suite revision is v3; older receipts are retired.

## Integration boundary

Root accepted this bounded correction on 2026-09-23 after inspecting the raw-bundle mutation,
per-input refusal control flow, source/dial CSS assertions, renderer and source-binding runner.
A fresh root `node packages/backend/scripts/run-web-recipe-evals.mjs --self-check` exited 0:
implementation `7e1d50f096a670318e5f4d09a9ae5a5b003303b111f190083afb700c6c07f9e0`,
fixture `fc9ff50300ef7de36d4b2e7f28ea32518e10d7f2ad4e18d258ec6e80caa2b379`, cost USD 0.
This does not accept Plan 06, browser qualification, activation or any external wave gate.

The designed renderer is not yet called by `webProjects.ts` or the owner preview. The next serial
slice should use `renderDesignedWebDocumentBytes(document, recipeRef.designProfile, route)` for
persisted/previewed recipe output and `designedWebDocumentHashMaterial` or
`designedWebDocumentHash` for version identity, preserving legacy/manual Phase 48 rendering. It
must bind the same exact profile and renderer identity to persisted version provenance. Browser
evidence and activation still require the separate trusted owner protocol and real E2E proof.
