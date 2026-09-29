---
phase: 49-qualified-public-web-and-storefront-recipes
researched: 2026-09-21
status: complete
confidence: high
requirements: [SITE-03, LAND-03, SHOP-01]
depends_on:
  - 48-business-website-and-landing-page-runtime
  - immutable skill registry, eval evidence, activation and rollback rails
---

# Phase 49 Research: Qualified Public-Web and Storefront Recipes

## Research Question

What do we need to know to plan Phase 49 well?

## Executive Finding

Phase 49 should add three independently qualified recipe families over two already-shipped systems:

1. Phase 48's closed `WebDocument` AST, deterministic renderer, immutable project versions,
   protected preview and exact publication lifecycle; and
2. the existing global `skills` registry's immutable candidate, refs-only evidence, owner activation
   and exact-version rollback transaction.

The recipe itself should be a canonical, closed, deterministic definition stored as the immutable
`skills.body` for a registry name such as `web-recipe-business-site`,
`web-recipe-campaign-landing`, or `web-recipe-storefront-catalogue`. It is not executable HTML and
not a generic code-generation prompt. Pure TypeScript validates structured business input and
materializes a `WebDocument`; the existing Phase 48 renderer remains the only HTML renderer and the
existing Phase 48 project/version rows remain the only public-web persistence plane.

Do **not** route the first release through an LLM. The required recipes are bounded transforms, so a
model would add cost, nondeterminism, prompt-injection exposure and a second semantic oracle without
adding a capability the closed inputs cannot express. The existing evaluation rail can still be
reused: record zero-cost deterministic fixture evidence against the exact candidate identity, then
record authenticated multi-viewport browser evidence, and require both plus immutable provenance in
the existing activation choke point.

The owner additionally selected three MIT-licensed upstream knowledge sources: UI/UX Pro Max,
Taste Skill and Nexscope eCommerce-Skills. Adapt them through the pinned, offline compilation and
provenance contract in `49-UPSTREAM-SKILL-ADAPTATION.md`. They enrich recipe selection and design
profiles; they do not become runtime prompts, package installers, tool authorities, a second
renderer or a route around Pikar's governance.

Storefront activation and storefront exposure are separate facts. The storefront recipe may be
qualified and activated in the registry, but ordinary tenant discovery and every public publication
path must stay fail-closed until Phase 50 supplies a real, code-owned merchant-commerce readiness
contract. Phase 49 must not implement a boolean that a client, database fixture or owner UI can flip.

## Established Repository Facts

### Phase 48 is the runtime, not a prototype to replace

- `packages/contracts/src/webRuntime.ts` owns a closed `ProjectKind = "site" | "landing"`, bounded
  AST, hosting/source declaration and public outcome vocabulary.
- `packages/core/src/webRuntime.ts` validates, canonicalizes, renders and hashes that AST. It rejects
  arbitrary HTML, script, event handlers, iframes and unsafe URLs.
- `packages/backend/convex/webProjects.ts` owns create/save/approve/publish/update/unpublish/rollback,
  revision CAS, immutable `webProjectVersions`, exact artifacts and the host/path resolver.
- `apps/web/app/(app)/dashboard/sites/` owns the authenticated project list, editor and immutable
  artifact preview. The present editor exposes structured JSON; Phase 49 should add recipe-specific
  field controls and retain the JSON editor only as an advanced/manual Phase 48 path.
- `webProjectVersions.sourceRefs` currently stores an empty string array and has no defined recipe
  identity semantics. It is not sufficient provenance for Phase 49.
- Phase 48 verification is repository/local only. Its artifact-set SHA-256 is
  `b8b99b398038b0d8c1b21a481e09a6dbf24e46430d2176d67f34d9af8289bc11`; custom-domain/provider/legal
  and exact-production founder claims remain open.

### The existing registry already supplies the hard governance parts

- `packages/backend/convex/schema.ts` defines global immutable `skills` rows with `(name, version,
  body)`, `status`, immutable `provenance`, patchable refs-only `evidence` and `browserEvidence`.
- `packages/backend/convex/skills.ts::transitionSkillActivation` is the one archive/activate patch
  block. `planGlobalActivation` gates a never-active candidate; prior `archived`/`rolled_back` rows
  are rollback-exempt so incident recovery does not depend on a healthy evaluator.
- `skills.activateCandidate` is owner-only and routes through that same transition. Evidence and
  owner authority are independent gates.
- `publishPackCandidate`/`seedPackCandidates` prove a first publication can be candidate-only and
  avoid `seedSkills`, whose first-ever row intentionally becomes active for ordinary bootstrap
  skills.
- The Phase 27 pack gate already demonstrates the required three-plane shape: immutable provenance,
  exact-suite eval evidence and authenticated multi-viewport browser evidence.
- `nativePackExposureReady` demonstrates the important distinction between a row being `active`
  and a product surface being allowed to expose it.
- Existing pack predicates are tied to workflow-pack names and `PACK_EVAL_SUITE`. Reusing their
  concepts is correct; pretending a web recipe is a workflow pack or adding it to the current pack
  suite is not.

### Requirement and audit boundaries

- SITE-03 and LAND-03 require structured, editable, provenance-tracked, refusal-tested,
  eval/acceptance-gated, activatable and rollbackable recipes.
- SHOP-01 requires editable catalogue presentation over structured input, but not catalogue or
  inventory source of truth, cart, merchant checkout, orders, taxes, shipping, refunds,
  notifications or fulfilment. Those belong to Phase 50.
- The merged audit requires positive, partial, refusal, edit/reject, injection, privacy and browser
  protocol evidence. Candidate creation, review packets and dormant controls are preparation, not
  release evidence.
- The universal workflow definition of done still applies: actionable prerequisite refusal, durable
  failure, bounded retry/idempotence, recovery, server-boundary isolation, cost truth, honest UI
  states and exact-revision qualification.

## Standard Stack

Use the stack already present; add no dependency.

| Concern | Required seam |
|---|---|
| Recipe definitions and closed input schemas | New pure TypeScript `packages/core/src/webRecipes.ts`, exported through the existing core package |
| Public document/output contract | Extend `packages/contracts/src/webRuntime.ts`; keep `WebDocument` the only renderable document |
| Deterministic materialization | Pure `validateWebRecipeInput` and `materializeWebRecipe` in core; no Convex/browser/model dependency |
| HTML | Existing `renderWebDocument*` only |
| Immutable recipe identity | Existing global `skills` table; closed web-recipe registry names and canonical body bytes |
| Candidate publication | New web-recipe candidate publisher in `skills.ts`, always `status: "candidate"`; share immutable version allocation and transition code |
| Eval evidence | Existing `skills.evidence` column and `recordEvalEvidence`; new web-recipe suite identity/predicate and zero-cost deterministic runner |
| Browser evidence | Existing `skills.browserEvidence` column; web-recipe-specific exact name/version predicate |
| Activation and rollback | Existing `transitionSkillActivation`/`activateCandidate`; dedicated owner read/control surface may call the same transition, never patch status itself |
| Project persistence | Existing `webProjects` and `webProjectVersions`; add structured recipe lineage to the immutable version row |
| Auth/isolation | Existing `tenantMutation`, `tenantQuery`, `ownerMutation` wrappers |
| UI | Existing `/dashboard/sites` and exact-version preview, brand tokens and native controls |
| Browser qualification | Playwright with isolated local Convex and production-built web, following Phase 48's serial matrix |
| Governance | Existing audit writer, playbook watcher, planning/free-gate checks and a Phase 49 claim guard |

## Architecture Patterns

### 1. Three closed recipe identities, one renderer

Define exactly one initial recipe per required family:

| Recipe id / registry name | Output kind | Minimum structured inputs | Explicit exclusions |
|---|---|---|---|
| `business-site` / `web-recipe-business-site` | `site` | brand name, headline, summary, bounded services, about/contact copy, consent wording | HTML/CSS/JS, provider/domain claims, arbitrary URLs |
| `campaign-landing` / `web-recipe-campaign-landing` | `landing` | campaign headline, offer, proof points, CTA/form fields, consent, bounded attribution | scripts, pixels, arbitrary embeds, invented conversion claims |
| `storefront-catalogue` / `web-recipe-storefront-catalogue` | `storefront` | brand/intro and bounded catalogue presentation items | inventory truth, stock reservation, cart, buy/checkout targets, merchant/payment/tax/shipping/refund claims |

`RecipeDefinition` should contain a closed id, registry name, family/output kind, schema version,
bounded field definitions and a deterministic template descriptor. Serialize it canonically into
`skills.body`; parsing must reject unknown fields, non-canonical bodies, wrong recipe id/name pairs,
unsupported schema versions and fields that can express executable content.

The materializer returns only a validated `WebDocument`. It never returns HTML. The renderer version
must bump if a new catalogue node changes rendered bytes. Existing immutable Phase 48 artifacts are
served as stored and must never be rebuilt under the new renderer.

### 2. A static catalogue node, not commerce

SHOP-01 needs an honest catalogue presentation. Add a closed presentation-only AST node rather than
encoding product cards as arbitrary nested prose. A bounded item may carry an id, name, description,
optional image storage ref, optional display-price text and an availability label explicitly typed
as publisher-authored presentation. It must have no quantity, inventory row id, cart action,
checkout/payment URL, merchant id, SKU mutation, tax/shipping/refund state or purchase CTA.

The rendered storefront preview must visibly say that ordering is unavailable until commerce setup
is complete. This is product truth, not a disclaimer that permits a hidden checkout link.

### 3. Candidate-only publication into the existing registry

Do not add recipe tables or another status machine. Add a closed `WEB_RECIPE_SKILL_NAMES` predicate
and a web-recipe publisher beside the pack publisher. It must:

- derive/validate the name from the canonical definition;
- allocate the next immutable version through the existing allocator;
- make an unchanged `(body, provenance)` publication idempotent;
- verify the provenance pins exact name/version/body hash before insert;
- always insert `candidate`, including v1; and
- remain absent from `SEEDS` so a fresh boot cannot activate it.

Add a distinct web-recipe activation branch to `planGlobalActivation`. Do not put recipe names into
`GATED_SKILLS` (the golden agent runner cannot execute them) or `WORKFLOW_PACK_SKILL_NAMES` (their
runtime and suite are different). The branch should require:

1. valid immutable in-repository provenance and exact body hash;
2. passing web-recipe fixture evidence for this exact name/version and current suite hash/count; and
3. passing authenticated, multi-viewport browser evidence for this exact name/version.

Then let the existing transition archive the current row and activate the target atomically.
Rollback to a genuinely prior active global row stays evidence-exempt by the existing status rule.

### 4. Server-resolved active recipe to immutable project lineage

Add a single tenant mutation such as `webRecipes.createProjectFromRecipe`. The client supplies a
closed recipe id, structured values, slug/title and expected availability posture. The server:

1. resolves the active exact registry row by closed name;
2. rechecks web-recipe exposure readiness;
3. parses and validates the row's canonical definition;
4. validates the tenant values;
5. deterministically materializes and validates a `WebDocument`;
6. writes through the shared Phase 48 project/version helper; and
7. stamps a server-owned immutable lineage object on the first version.

Recommended lineage fields on `webProjectVersions`:

```ts
recipeRef?: {
  name: string;
  version: number;
  skillId: Id<"skills">;
  bodyHash: string;
  inputHash: string;
}
```

Subsequent manual saves copy the originating `recipeRef` unchanged while `contentHash` records the
edited output. This supports the truthful claim “started from recipe X vN, now edited” without
claiming the current bytes equal the original materialization. Raw business inputs remain on the
content plane and never enter audit/evidence.

Do not allow `createDraft` or `saveDraft` callers to supply or replace `recipeRef`.

### 5. Activation is not exposure

Add a read-only `webRecipeExposureReady` predicate. Ordinary discovery returns only an active row
whose three evidence planes still validate. It never lists candidates.

For site and landing recipes, an active, still-evidenced row may be offered on `/dashboard/sites`.
For the storefront recipe, registry activation is allowed for qualification but ordinary discovery
must omit it while `commerceContractReady` is false. In Phase 49, that predicate must be a code-owned
constant/function returning false with a `ponytail:` comment naming Phase 50's declared commerce
contract as the only upgrade path. It must not read a request argument, feature flag, tenant value,
environment variable or writable database field.

Owner-only candidate/active preview can exercise the storefront recipe for evidence. This is not a
tenant launch surface and must not share the ordinary discovery query.

### 6. Storefront public paths fail closed independently

Extending `ProjectKind` to `storefront` is necessary for honest provenance, but it widens several
Phase 48 unions. Add defense in depth at all of these seams:

- contract/schema validators accept `storefront` only as a private structured document kind;
- `webProjects.publishVersion`, `updateVersion` and publication-style `rollback` return a closed
  `COMMERCE_UNAVAILABLE`/`storefront_unavailable` refusal before pointer changes;
- `runtimeReady` returns false for storefront projects in Phase 49;
- `resolvePublished` explicitly refuses storefront even if a malformed/seeded row has a published
  pointer;
- `webRuntime` and HTTP handlers never serve storefront artifacts;
- tenant recipe discovery omits storefront;
- the standard project list/editor cannot offer storefront publish/update/rollback-to-public
  controls; and
- the Phase 49 claim guard scans for cart/checkout/payment/merchant/inventory/public-storefront
  enablement claims and requires a positive-control self-test.

Do not depend on only the UI button being absent. Seeded malformed rows and direct mutations must be
covered at the server and HTTP boundaries.

### 7. Genuine rollback has two exact identities

Keep the two rollback concepts distinct:

- **Recipe rollback:** owner reactivates the exact prior global recipe version through the existing
  registry transition. No new eval is required for that proven-active row. New projects resolve the
  restored recipe; existing projects remain unchanged and keep their original `recipeRef`.
- **Project rollback:** Phase 48 restores exact stored artifact bytes/hash. Site and landing retain
  this behavior. Storefront cannot use the current publication rollback because that function
  publishes; owner preview can select an older immutable version without changing any public
  pointer until Phase 50 supplies commerce publication.

A convincing recipe rollback test needs two passing candidate versions. Activate v1, activate v2,
create/preview output under both, reactivate archived v1, and prove the next creation resolves the
exact v1 `skillId`/body hash while v2-created project lineage and bytes remain unchanged.

## Don't Hand-Roll

- Do not create a recipe registry table, activation status enum or rollback log.
- Do not create a second HTML renderer, preview route, project table or public runtime.
- Do not let a recipe body contain HTML, CSS, JS, JSX, React components or executable templates.
- Do not add an LLM call merely to map structured fields into a deterministic AST.
- Do not add recipe names to the agent golden suite or workflow-pack suite to make an existing gate
  appear reusable; define the correct deterministic suite identity.
- Do not store raw fixture values, business inputs, generated copy or rendered HTML in audit,
  evidence, telemetry or error payloads.
- Do not treat `sourceRefs: string[]` as enough exact recipe provenance.
- Do not use an environment variable, client argument or mutable DB flag to unlock storefront.
- Do not reuse Pikar subscription billing or tenant finance connector state as merchant readiness.
- Do not infer Wave 7 custom-domain/provider/legal evidence or Wave 8 production acceptance from a
  local browser run.

## Common Pitfalls and Required Countermeasures

1. **First-row auto-activation.** `seedSkills` intentionally activates a first ordinary skill.
   Recipe definitions must use their own candidate-only publisher and remain out of `SEEDS`.
2. **Wrong eval rail.** `GATED_SKILLS` is driven by agent fixtures and `PACK_EVAL_SUITE` is driven by
   workflow-pack fixtures. A web recipe added to either can deadlock or obtain meaningless evidence.
3. **Evidence for a body that did not run.** The fixture runner must load the exact candidate row,
   parse its body and materialize from it; a code constant beside the row is not proof of the row.
4. **Activation mistaken for exposure.** Tests must independently assert registry status and
   ordinary discovery. This is load-bearing for storefront.
5. **UI-only darkness.** Direct mutation and seeded-row HTTP tests must prove storefront cannot
   publish or resolve publicly.
6. **Editable output loses origin.** Manual saves must preserve immutable recipe origin while using
   a new content hash; they must not silently rewrite `recipeRef` to the active recipe of the day.
7. **Rollback regenerates.** Recipe rollback changes active definition for future creation; project
   rollback/preview reads stored bytes. Neither path may re-render an older artifact.
8. **Catalogue language implies commerce.** “Available”, “Buy”, “Checkout” and live inventory
   claims can overstate Phase 49. Use explicit presentation-only copy and a visible commerce-unavailable
   state.
9. **Partial input fabricated into completeness.** Partial fixtures should preserve omitted optional
   sections or render explicit absence; the materializer must not invent claims, prices or proof.
10. **Refusal after persistence.** Invalid schema, forbidden URL/content and unavailable storefront
    exposure must refuse before project/version rows, artifacts, audit success events or spend.
11. **Stale evidence.** Exposure and activation must pin suite revision, case hash/count and exact
    recipe version. A changed fixture corpus invalidates old evidence.
12. **Representative-only acceptance.** Run all three families. A green site recipe does not qualify
    landing or storefront.
13. **Raw JSON as the only “structured” UX.** Phase 48's advanced JSON editor is not sufficient
    evidence for recipe selection and structured business inputs. Provide bounded labelled controls.
14. **Phase 50 leakage.** Adding product ids is acceptable only for display identity. Adding stock
    mutation, cart, checkout, merchant credentials or order states is Phase 50 work.

## Exact Code Seams

### Contracts and pure core

- `packages/contracts/src/webRuntime.ts`
  - add `storefront` to the private document/project vocabulary;
  - add a bounded presentation-only catalogue node and limits;
  - add closed storefront-unavailable refusal/failure vocabulary;
  - bump renderer identity if output bytes change.
- `packages/core/src/webRuntime.ts`
  - validate/canonicalize/render the new catalogue node;
  - preserve all executable-content/URL rejection rules.
- `packages/core/src/webRuntime.test.ts`
  - exact bytes/hash, caps, escaping, mutation tests and no-commerce-field rejection.
- new `packages/core/src/webRecipes.ts` and `webRecipes.test.ts`
  - closed recipe ids/names, canonical definition parser, input validation, deterministic
    materialization, body/input hashes and positive/partial/refusal/adversarial fixtures.
- `packages/core/src/index.ts`
  - export the recipe contract; no new package.
- `packages/contracts/src/skill.ts`
  - add `WEB_RECIPE_EVAL_RUNNER`, exact suite identity and strict evidence predicate, or a sibling
    contract file if keeping non-agent evidence separate is clearer; the server predicate must be
    filesystem-independent.

### Registry, schema and backend

- `packages/backend/convex/schema.ts`
  - widen `webProjects.kind` to storefront;
  - add optional immutable structured `recipeRef` to `webProjectVersions`;
  - do not add recipe/commerce tables in Phase 49.
- `packages/backend/convex/skills.ts`
  - closed recipe predicate and candidate-only publisher/seeder;
  - exact provenance/body-hash verification;
  - distinct recipe evidence branch in `planGlobalActivation`;
  - owner candidate/prior-version read models if the generic ops panel cannot represent the three
    evidence planes;
  - reuse `transitionSkillActivation`; no direct status patch on activation/rollback.
- `packages/backend/convex/skills.test.ts`
  - candidate-only v1, idempotent publish, body/provenance mispin refusal, three-plane gate,
    owner/evidence conjunction, two-version exact rollback, never-active rollback refusal and exact
    patch-field/privacy guards.
- new `packages/backend/convex/webRecipes.ts` and `webRecipes.test.ts`
  - active-only discovery, exact candidate resolution, deterministic create-from-recipe, lineage,
    stale evidence, two-tenant isolation, no caller tenant/skill id, and storefront omitted.
- new `packages/backend/convex/webRecipeEvals.test.ts` plus a zero-cost runner script
  - exact candidate actually loaded, complete suite only, positive/partial/refusal/injection/bounds,
    zero cases/filtered/failing/stale-suite evidence refusal and cost `0`.
- `packages/backend/convex/webProjects.ts` and `webProjects.test.ts`
  - extract/reuse a project append helper if required;
  - preserve recipe lineage on edits;
  - reject all storefront publication mutations before state changes;
  - retain Phase 48 site/landing behavior unchanged.
- `packages/backend/convex/webRuntime.ts`, `webRuntime.test.ts`, `webRuntimeHttp.test.ts`
  - refuse storefront at resolver and HTTP boundaries even for malformed seeded published pointers.
- `packages/core/src/tenantData.ts` and its drift tests
  - no new table mapping should be needed; assert the new structured lineage exports with the
    existing tenant-owned version row and erasure remains complete.

### Web and browser acceptance

- `apps/web/app/(app)/dashboard/sites/page.tsx`
  - active site/landing recipe cards, loading/empty/refusal/error states; no storefront tenant card.
- new recipe-form component under the sites route, with focused component tests
  - labelled bounded fields, partial/error linkage, keyboard/focus and exact recipe version shown.
- `SiteEditor.tsx` / `siteEditor.test.tsx`
  - visible immutable recipe origin, continued field-level editability, no loss of manual path.
- `PreviewCanvas.tsx` / `previewCanvas.test.tsx`
  - exact recipe/version/content hash and visible preview-only storefront posture.
- an owner-only recipe qualification/control surface
  - candidate preview, evidence state, activate, deactivate if required and prior-version rollback;
    no raw fixture content.
- new `apps/web/e2e/phase49-web-recipes.spec.ts`
  - all three families, desktop/mobile, owner/non-owner, exact evidence/activation/rollback,
    site/landing create-edit-preview-publish hand-off, and storefront owner preview plus public
    refusal.

### Governance

- update `docs/playbooks/public-web-runtime.md` for recipe lineage, renderer change and storefront
  refusal, and either extend `docs/playbooks/skill-registry.md` or add a focused web-recipes
  playbook; register every new path in `docs/playbooks/watch.json`.
- new `docs/releases/phase-49-wave7-wave8-reentry.md` naming exact remaining external/production
  evidence and re-entry commands.
- new `scripts/check-phase49-acceptance.mjs` with positive and negative fixtures. It must reject
  merchant/domain/provider/production/founder-complete claims from Phase 49 artifacts and reject
  code shapes that expose storefront before the Phase 50 seam exists.

## Validation Architecture

### Proof layers

Phase 49 should be proven at six layers. No single layer substitutes for another.

1. **Pure contract and transform tests** — closed recipe/schema identities, exact canonical bytes,
   input bounds, partial behavior, adversarial rejection, catalogue non-commerce shape.
2. **Registry tests** — candidate-only publication, three evidence planes, owner gate, activation,
   deactivation/rollback and immutable provenance.
3. **Backend integration tests** — exact active recipe resolution, project lineage, tenant isolation,
   edit persistence and storefront refusal at mutation/resolver/HTTP boundaries.
4. **Deterministic eval runner** — the exact candidate body is run over the complete current suite;
   evidence is refs/hashes/ids/counts only and records `costUsd: 0`.
5. **Authenticated browser qualification** — owner preview and controls plus ordinary tenant
   site/landing selection/edit/preview/publish hand-off at desktop/mobile; storefront remains absent
   and publicly unreachable.
6. **Repository/claim gates** — targeted suites, three typechecks, production build, playbook and
   planning checks, free gates, Phase 49 claim guard and exact artifact-set hash.

### Requirement-to-proof map

| Requirement / risk | Fast proof | Backend/integration proof | Browser/release proof |
|---|---|---|---|
| SITE-03 structured/editable | site recipe schema/materializer fixtures | creates ordinary immutable site project with exact lineage; edits preserve origin | choose recipe, complete labelled inputs, edit output, exact preview and publish hand-off |
| LAND-03 positive/partial/refusal | landing fixtures including consent/attribution/injection | invalid input leaves zero rows; valid output reuses Phase 48 form/runtime | desktop/mobile selection, form/CTA preview, publish, refusal/recovery |
| SHOP-01 catalogue presentation | catalogue node and recipe fixtures; commerce fields rejected | private preview document created only through owner qualification; publish/HTTP fail closed | owner can edit/preview catalogue; tenant discovery and anonymous public route remain dark |
| Exact provenance | canonical body/provenance hash predicates | server stamps recipe name/version/id/body/input hashes | UI displays exact version without fixture/raw input leakage |
| Eval gate | strict suite predicate mutation tests | wrong version/hash/count/revision/pass cannot activate | candidate controls show refusal until exact complete evidence exists |
| Owner gate | wrapper/source guard | non-owner with fully passing evidence still cannot activate | controls absent/refused for non-owner |
| Genuine rollback | pure exact-version identity | v1 -> v2 -> v1 restores exact registry row; never-active row refused | owner observes version/body-hash restoration; new creation uses v1, old projects unchanged |
| Storefront darkness | code-owned readiness always false | direct mutation, malformed pointer, resolver and HTTP all refuse | no tenant card/control/public response; owner preview is clearly qualification-only |
| Privacy | exact evidence/audit key sets | high-entropy input/fixture needles absent from audit/DLQ/evidence/errors | owner sees counts/hashes/status only |
| Claim boundary | claim-guard fixtures | no external/merchant state written | UI says platform/local/preview truth and names future prerequisite |

### Activation truth table

Exercise all cells against a real web-recipe candidate:

| Exact provenance | Complete eval | Exact browser evidence | Owner act | Expected |
|---|---|---|---|---|
| no | yes | yes | yes | refuse, candidate unchanged |
| yes | no | yes | yes | refuse, candidate unchanged |
| yes | yes | no | yes | refuse, candidate unchanged |
| yes | yes | yes | no/non-owner | refuse, candidate unchanged |
| yes | yes | yes | yes | exact candidate active, prior active archived atomically |

For storefront add a sixth assertion: the final row may be active while ordinary discovery and
public resolution still return no storefront. This proves activation and exposure are not aliases.

### Required fixture matrix

Each family needs at least:

- one complete positive input;
- one allowed partial input whose omissions remain honest;
- missing required input;
- unknown field/non-canonical body;
- boundary length/count cases and one-over refusals;
- HTML/script/event/javascript/data-URL injection attempts;
- cross-family mismatches (site definition with landing name, etc.);
- changed candidate version/suite hash evidence mismatch; and
- deterministic repeated output/hash.

Additional landing fixtures must cover explicit consent and attribution bounds. Additional
storefront fixtures must attempt cart, checkout, payment/merchant URLs, inventory counts and purchase
CTAs and prove every one is structurally rejected.

### Anti-vacuity and mutation checks

The test suite should turn red when each defect is introduced:

1. First recipe publication inserts `active` instead of `candidate`.
2. A recipe name is added to `SEEDS`.
3. Activation checks `hasPassingEvidence` only and ignores recipe suite identity.
4. The runner evaluates a code constant rather than the exact row body.
5. Owner authorization is removed while evidence remains valid.
6. Browser evidence for recipe A/version N certifies another row.
7. Storefront readiness reads a client arg, env var or mutable row.
8. `publish`, `update`, public rollback or `resolvePublished` loses its storefront guard.
9. Discovery returns active storefront while Phase 50 readiness is false.
10. Manual save replaces/clears recipe lineage.
11. Rollback regenerates an older project artifact instead of reading stored bytes.
12. Audit/evidence contains a high-entropy fixture or business-input needle.
13. A direct test-only endpoint call can satisfy browser acceptance without selecting and editing
    the rendered recipe workflow.

### Suggested verification commands

Exact filenames may be adjusted by the planner, but every plan should leave a focused command:

```text
pnpm --filter @pikar/core test -- webRuntime webRecipes
pnpm --filter @pikar/core typecheck
pnpm --filter @pikar/backend test -- skills webRecipes webRecipeEvals webProjects webRuntime webRuntimeHttp isolation tenantExport tenantDelete
pnpm --filter @pikar/backend typecheck
node packages/backend/scripts/run-web-recipe-evals.mjs --self-check
pnpm --filter @pikar/web test -- webRecipe siteEditor previewCanvas
pnpm --filter @pikar/web typecheck
pnpm --filter @pikar/web build
pnpm --filter @pikar/web test:e2e -- e2e/phase49-web-recipes.spec.ts
node scripts/check-audit-payloads.mjs --self-test
node scripts/check-phase49-acceptance.mjs --self-test
node scripts/check-playbooks.mjs
node scripts/check-planning.mjs
node scripts/check-free-gates.mjs
```

The deterministic recipe evaluator should need no model/provider key and make no network call.

## Dependencies and Sequencing

### Hard dependencies already satisfied

- Phase 48 contracts, persistence, preview, public runtime and local qualification.
- Global registry immutable version/status indexes.
- Shared activation transition and owner wrapper.
- Refs-only eval/browser evidence columns and audit rules.
- Phase 48 production-build/local browser harness and claim guard pattern.

### Dependencies Phase 49 must create before UI work

1. Closed recipe names, definitions, input schemas and output contract.
2. `storefront` private document kind and presentation-only catalogue node.
3. Candidate-only registry publication and exact evidence predicates.
4. Storefront-dark readiness predicate and server publication/resolver guards.
5. Immutable recipe lineage on project versions.

UI and browser plans should consume those seams, not invent them in React.

### Shared hotspots and serialization

`packages/backend/convex/skills.ts`, `schema.ts`, `webProjects.ts`, `webRuntime.ts` and
`packages/contracts/src/webRuntime.ts` each need one integration owner. Do not parallelize plans that
edit these files. Pure recipe definitions/fixtures can run in parallel with owner UI work only after
the contracts stabilize.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Widening `ProjectKind` accidentally publishes storefront | Premature commerce/public claim | server mutation + runtimeReady + resolver + HTTP + discovery guards, each independently tested |
| Treating canonical recipe JSON as an agent prompt | Wrong eval/runtime and possible model use | parse/materialize in pure core; no LLM route or tool grant |
| Reusing generic evidence predicate | Stale/partial corpus can activate | exact recipe runner, suite revision, cases hash/count, exact version pins |
| Candidate v1 boots active | Unevaluated public recipe | absent from `SEEDS`; candidate-only seeder tests |
| Manual edits sever provenance | SITE/LAND provenance claim becomes false | immutable origin `recipeRef` copied forward; output hash separate |
| Storefront darkness becomes a mutable flag | Hidden premature enablement | code-owned false seam, Phase 50 contract is the named upgrade |
| “Catalogue” silently grows into Phase 50 | scope/PCI/merchant boundary breach | display-only node and structural rejection of commerce fields |
| Two rollback notions are conflated | storefront public pointer may change or recipe history is regenerated | separate recipe activation rollback from stored project artifact/version behavior |
| UI evidence is representative only | one family hides another's defect | all-three matrix at both desktop and mobile widths |
| Phase 48 regressions | existing sites/landings change bytes or lifecycle | preserve stored artifacts, renderer bump, rerun full Phase 48 targeted suites and e2e |

## Proposed Plan Decomposition

### 49-01 — Closed recipe and catalogue contracts

Pin and compile the reviewed subsets of UI/UX Pro Max, Taste Skill and Nexscope eCommerce-Skills
into a closed, provenance-complete `DesignKnowledgeBundle`, then own the three recipe identities,
canonical definitions, design dials/profiles, structured input validators, deterministic
materializers, storefront project kind, presentation-only catalogue AST, renderer-version change and
pure fixture/mutation tests. No schema, registry or UI changes.

### 49-02 — Immutable registry candidates and evidence gate

Publish all three definitions as candidate-only global skill rows with exact provenance; add the
web-recipe suite identity, zero-cost deterministic runner, browser evidence predicate and distinct
activation branch. Test three-plane refusal, owner conjunction and absence from bootstrap seeds. Do
not activate a candidate yet.

### 49-03 — Project lineage and storefront fail-closed backend

Widen additive schema, stamp immutable recipe lineage, implement active-recipe resolution and
create-from-recipe for site/landing, preserve lineage through edits, and add every storefront
publication/resolver/HTTP guard. Add export/erasure/isolation coverage. Storefront remains unavailable
to the tenant path.

### 49-04 — Structured recipe UX and immutable preview provenance

Add active-only site/landing recipe selection, bounded field controls, exact version/provenance,
editable output and honest states to `/dashboard/sites`. Add owner-only storefront qualification
preview and owner candidate/activation/rollback controls. Tenant UI contains no storefront offer.

### 49-05 — Complete fixtures, activation and genuine rollback

Run the full deterministic fixture corpus for each exact candidate, record refs-only evidence,
record authenticated multi-viewport browser evidence, activate with an owner path, publish a second
passing version per family where needed, and prove exact v1 -> v2 -> v1 rollback. This plan can be
fully zero-cost and local; no provider/model call is justified.

### 49-06 — Integrated browser qualification and claim/re-entry packet

Run an isolated serial browser matrix for all three families. Site and landing exercise
select/input/create/edit/preview/approve/publish/update/unpublish/project rollback. Storefront exercises
owner qualification preview/edit and every darkness assertion. Finish playbooks, claim guard,
artifact-set hash, three typechecks, production build and all free gates. Record Phase 49 as
repository/local qualified only.

This six-plan shape mirrors Phase 48, keeps shared hotspots serialized and leaves every plan with a
focused runnable gate.

## Wave 7 and Wave 8 Claim Boundaries

### What Phase 49 may claim after local qualification

- Exact recipe candidate identities and canonical body/provenance hashes exist.
- Complete deterministic positive/partial/refusal/adversarial suites pass at zero provider cost.
- Authenticated local desktop/mobile browser evidence pins exact candidate versions.
- Owner activation and exact prior-version rollback work through the existing registry transaction.
- Active site and landing recipes create editable Phase 48 projects with immutable lineage and use
  the already-qualified platform-path runtime in the isolated/local acceptance environment.
- The storefront recipe renders a private, editable catalogue presentation and remains unavailable
  to ordinary tenant discovery and anonymous public resolution.

### Wave 7 remains open

Phase 49 must not claim registered-entity completion, custom-domain DNS/TLS, external hosting or
provider approval, merchant account approval, production payment credentials, tax/shipping setup,
provider-policy acceptance or a publicly enabled merchant channel. The re-entry packet must name the
owner, prerequisite, durable evidence shape, exact re-entry command and stop condition for each.

No recipe copy may imply that choosing it grants a domain, hosting provider account, merchant
account, payment acceptance or inventory/order capability.

### Wave 8 remains open

Local Playwright and an owner qualification surface are not exact-production founder acceptance.
Wave 8 still needs one clean production revision, verified registry versions, durable production URL,
authenticated desktop/mobile founder journeys, anonymous production reads where applicable,
two-user isolation, exact enabled-provider facts, rollback and final claim-versus-code review.

For storefront, Wave 8 cannot begin until Phase 50's merchant lifecycle is technically available and
its own Wave 7 merchant/provider prerequisites are satisfied or explicitly removed from beta scope.

## Planning Decisions to Lock Before Execution

These are prescriptive defaults; change them only with a recorded reason:

1. Initial scope is exactly one recipe per family, not a marketplace.
2. Recipes are canonical structured definitions and pure transforms, not LLM prompts.
3. Registry identity is global and immutable; output/project data remains tenant-owned.
4. Storefront activation is allowed for qualification, but ordinary discovery/public serving is
   code-blocked until Phase 50's contract.
5. Storefront catalogue is presentation-only; no buy action or commerce state enters Phase 49.
6. Recipe provenance is a structured immutable version field, not a free-form source ref.
7. Existing project bytes are never regenerated after renderer changes.
8. All qualification in Phase 49 is zero-cost and provider-free.

## Definition of Done

Phase 49 is repository/local qualified only when all three recipe families have immutable exact
identities, structured schemas, deterministic editable outputs, provenance pinned onto project
versions, complete positive/partial/refusal/adversarial evaluation, authenticated multi-viewport
evidence, controlled owner activation and genuine exact-version rollback. Site and landing must hand
off through the real Phase 48 lifecycle. Storefront must render for owner qualification while every
ordinary discovery, publication, resolver and anonymous HTTP path remains dark. Audit/evidence stays
refs-only, tenant isolation holds, no provider/model call is needed, and the re-entry artifact keeps
Wave 7 external facts and Wave 8 exact-production acceptance explicitly open.
