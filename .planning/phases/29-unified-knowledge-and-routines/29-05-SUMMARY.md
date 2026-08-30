---
phase: 29-unified-knowledge-and-routines
plan: 05
subsystem: skill-registry
tags: [workflow-packs, tenant-skills, customization, governance, optimistic-concurrency, convex]

# Dependency graph
requires:
  - phase: 21-user-skill-authoring
    provides: "tenantSkills overlay + publishUserCandidate/activateTenantCandidate/rollbackTenantSkill/recordTenantEvalEvidence — the candidate-only writer and the owner-only activation gate this plan reuses unchanged"
  - phase: 27-workflow-packs
    provides: "WORKFLOW_PACKS operation matrix, resolveWorkflowPack, toolsForWorkflowPack, WORKFLOW_PACK_SKILL_NAMES — the approved templates being customized and the code-owned tool grant"
  - phase: 29-unified-knowledge-and-routines (plan 01)
    provides: "workflowCustomization.ts machinery (two-layer refusal, deterministic render, canonicalCustomization, classifyCustomizationChange, checkBaseVersion) + the tenantSkills template-lineage schema fields"
provides:
  - "packages/core/src/workflowCustomization.ts — the SIX real pack customization schemas, derived from the Phase 27 operation matrix (packReadableSources / packCustomizationFields / customizationSchemaFor / PACK_TONE_OPTIONS)"
  - "packages/backend/convex/skills.ts — publishPackCustomization (the closed-form tenant candidate channel) + insertTenantUserCandidate (the ONE tenant candidate writer both channels share)"
  - "packages/backend/convex/workflowPackBinding.ts — tenantSkillIds threaded to runSpecialistTurn, so a tenant pack candidate is runnable before it is activated"
  - "docs/playbooks/skill-registry.md — the governance record for the third authoring channel and the check a reviewer must make before widening any of the three sets"
affects: [29-06 coordinator, 29-08 pinned rerun, 29-09+ pack UI, any later plan that widens USER_AUTHORABLE_SKILLS]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A THIRD, NARROWER authoring channel instead of widening an existing allow-list: the free-text door still refuses pack names, and the schema door has no field that carries prose"
    - "The registry name is DERIVED from a closed resolver (`pack-<resolveWorkflowPack id>`), not checked against an allow-list — there is no string a caller can send that produces a name outside the six"
    - "One writer, two channels: publishUserCandidate and publishPackCustomization both insert through insertTenantUserCandidate, so a guard cannot be true on one path and absent on the other"
    - "Governed stops return as DATA with no user text in them; only bugs throw"
    - "Both lineages on one row: registry base (basedOnScope/basedOnVersion) answers 'which row does this adapt', template lineage (templateId/templateVersion) answers 'which approved product template produced it' — and they stop agreeing once the tenant has an active row"

key-files:
  created: []
  modified:
    - packages/core/src/workflowCustomization.ts
    - packages/core/src/workflowCustomization.test.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/workflowPackBinding.ts
    - packages/backend/convex/workflowPackBinding.test.ts
    - packages/contracts/src/skill.ts
    - docs/playbooks/skill-registry.md
    - docs/playbooks/workflow-packs.md

key-decisions:
  - "USER_AUTHORABLE_SKILLS was NOT widened to admit the six packs. That list gates a FREE-TEXT channel; admitting a pack name would have granted tenants arbitrary prose in a pack prompt through the existing door, beside the closed form that exists to withhold it. Both authoring allow-lists are byte-unchanged and pinned as literals by test."
  - "The pack channel's allow-list is DERIVED, not declared: the registry name is `pack-<resolved pack id>`, so a caller cannot spell a name outside WORKFLOW_PACK_SKILL_NAMES. No fourth constant was added."
  - "templateVersion means the GLOBAL ACTIVE pack skill row's version. A form rendered against any other version is refused (`stale_template_version`) rather than composed onto a body it was not designed for."
  - "Optimistic concurrency compares against the tenant's NEWEST row, not the active one: the question is 'am I editing the latest draft', and there is deliberately no merge."
  - "workflowPackBinding.ts gained `tenantSkillIds`. Without it a tenant pack candidate is un-runnable, and since activation demands evidence pinning the exact row, it could never leave `candidate` at all."
  - "evaluations.ts was NOT modified. Its tenantSkillIds rail serves gap->specialist dispatch; the pack eval rail is run-workflow-pack-evals.mjs -> runWorkflowPack, which is where the hop was actually missing."
  - "The plan's named file convex/workflowPacks.ts does not exist. The mutation went into skills.ts (V8, and where the shared candidate writer lives) and the pin passthrough into workflowPackBinding.ts (the `use node` action module)."

patterns-established:
  - "A capability decision recorded as a TABLE of channels in the playbook, with the question a reviewer must ask before widening any of them"
  - "An idempotence rule that compares the template identity as well as the bytes, with a test that reaches the case where the registry lineage alone cannot distinguish two candidates"

requirements-completed: [ROUT-01]

# Metrics
duration: 95min
completed: 2026-08-28
---

# Phase 29 Plan 05: Schema-Driven Pack Customization Summary

**A tenant can now customize the six approved workflow packs through a closed typed form whose body is rendered server-side — and the free-text authoring door still refuses every pack name, so the form is the narrower capability rather than a second one.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 2 of 2
- **Commits:** 2
- **Files modified:** 9 (0 created) — 1,490 insertions, 72 deletions

## Task commits

1. **Task 1 — the six approved pack templates get closed customization schemas** — `15fa2d2`
2. **Task 2 — pack customization is a closed FORM, not a third prose door** — `04814fe`

## What I INHERITED vs what I WROTE

I resumed onto an uncommitted, unreviewed draft left by a killed agent.

**Inherited** (`packages/core/src/workflowCustomization.{ts,test.ts}`, +452 lines): the whole of
Task 1 — `PACK_TONE_OPTIONS`, `PACK_THRESHOLD_FIELD`, `packReadableSources`,
`packCustomizationFields`, `customizationSchemaFor`, and 18 tests over them.

**What I verified about it before committing it:**

- Read the diff in full and hand-checked the six `READABLE` literals in the test against the
  `WORKFLOW_PACKS` manifest, operation by operation (`existing` rows whose `reads` is not null,
  deduped, in manifest order). All six are correct.
- Ran five mutations against the inherited implementation and observed each RED (below). The draft's
  tests are not vacuous.
- One claim it made was UNVERIFIED prose: `customizationSchemaFor`'s docstring says "The Convex
  adapter reads the global ACTIVE pack row and refuses a mismatch." Nothing enforced that when I
  found it. Task 2 implements it (`stale_template_version`) and tests it, so the claim is now true
  rather than aspirational.
- It shipped a biome FORMAT error (a wrapped function signature). I committed it in Task 1 before
  noticing, and fixed it in the Task 2 commit — noted there.

**I wrote** everything in Task 2: the backend mutation, the shared writer refactor, the pin
passthrough, 16 backend tests, both playbook sections and the contracts cross-reference.

## The blocking premise error, and what I did instead

The plan says to publish "through Phase 21's existing gate". That gate is
`skills.publishUserCandidate`, which refuses anything outside `USER_AUTHORABLE_SKILLS` — and that set
and `WORKFLOW_PACK_SKILL_NAMES` have an **empty intersection**, so every pack name is refused today.

The orchestrator's brief anticipated this and described how to make a widening of
`USER_AUTHORABLE_SKILLS` explicit and tested. **I did not widen it**, and this is the plan's main
deviation:

`publishUserCandidate` accepts free-text `authoredBody`. Adding `pack-business-pulse` to its
allow-list would open a door where any tenant can put arbitrary prose into a pack prompt — standing
right beside the closed form that exists to withhold exactly that capability. The brief's own second
point ("the schema path must be NARROWER... prove a tenant cannot supply raw body text") is not
satisfiable while the wide door is open for the same name.

So `publishPackCustomization` is a **separate, narrower writer**, and:

- `USER_AUTHORABLE_SKILLS` and `AGENT_AUTHORABLE_SKILLS` are **byte-unchanged**.
- A test pins all three memberships as **literals** and asserts every pack name is in **neither**
  authoring list — so a future widening is a deliberate act with a red test in front of it.
- A test proves `publishUserCandidate` still throws `NOT_USER_AUTHORABLE` for all six pack names.
- The governance reasoning and the question a reviewer must ask are recorded in
  `docs/playbooks/skill-registry.md` ("Phase 29 — pack customization"), plus a cross-reference on
  `USER_AUTHORABLE_SKILLS` itself so a reader widening that list learns the third channel exists.

**The pack channel's allow-list is derived, not declared.** `customizationSchemaFor` resolves
`templateId` through `resolveWorkflowPack` (which uses `Object.hasOwn`, so `__proto__` and
`constructor` are refused rather than resolved) and the registry name is `pack-<resolved id>`. There
is no string a caller can send that yields a name outside the six. That is a stronger property than
an `includes` check, and it is why no fourth constant was added.

## What was built

### Task 1 — the six real schemas (pure, `@pikar/core`)

Offered fields are **derived from the pack's own operation matrix**, never re-typed: terminology
(400 B), tone (one closed four-word list shared by all six), ONE pack-specific numeric threshold with
a declared range, a source preference restricted to the planes that pack's granted tools actually
read, and one bounded instruction block (1200 B). `brand-review` reads only the vault and is
therefore offered no source preference — a choice with one option is a form asking a question with
one answer. A source no pack tool can reach (`crm-facts`, `content-shelf`, …) can never be offered.

### Task 2 — the backend channel (`skills.ts`)

`publishPackCustomization` is a `tenantMutation` taking
`{templateId, templateVersion, baseCandidateVersion, values}` and nothing else. Convex's arg
validator refuses an extra key, so `authoredBody`, `body`, `tools`, `name`, `status`, `tenantId`,
`authorUserId`, `rollbackEligible` and `evidence` are all unspellable — proven by test, one spoof at
a time. `values` is `v.record(v.string(), v.union(v.string(), v.number(), v.array(v.string())))`, so
a nested object has no shape to arrive in either.

Five refusals, returned as **data** and carrying no user text:

| reason | when |
| --- | --- |
| `unknown_template` | the id is not one of the six |
| `invalid_values` | undeclared KEY refused before its value is read, then declared free text content-scanned |
| `empty_customization` | an empty form is not a customization |
| `stale_template_version` | the form was not rendered against the LIVE pack row |
| `stale_base_version` | optimistic concurrency against the tenant's newest row; no merge |

`insertTenantUserCandidate` is now **the one tenant candidate writer**; `publishUserCandidate`
delegates to it. Candidate-only status, authenticated provenance, the rollback baseline, immutable
version allocation, idempotence and the refs-only audit row are therefore shared, not duplicated. The
free-text path's audit payload is byte-identical to before (its key set is still pinned by equality
in the 21-02 test); the pack path adds `templateId`, `templateVersion`, `customizationHash` and
`customizedFieldCount` — refs, a hash and a count.

**The idempotence rule compares the template identity too**, and there is a test that reaches the
case where it is load-bearing: once a tenant has an ACTIVE row, `basedOnVersion` becomes the TENANT
version and stops tracking the global template, so identical form values against a republished
template have identical bytes AND identical registry lineage. My first attempt at that test did not
reach it (the registry lineage still distinguished the two, and dropping the template comparand
stayed GREEN) — the second one does, and dropping the comparand is now red.

### Task 2b — the hop that makes a candidate certifiable

`workflowPackBinding.packArgs` gained `tenantSkillIds` (`v.id("tenantSkills")`, `internalAction`
only), forwarded to `runSpecialistTurn`, which resolves the exact row and refuses a pin naming a
different skill. Without it a tenant pack candidate is un-runnable, and since
`activateTenantCandidate` demands evidence pinning that exact row, it could never leave `candidate`
at all — the "threaded through the pure half but not through the caller" defect this repo has
shipped before.

### What did NOT change, deliberately

- **Activation and rollback**: still `ownerMutation` + exact-row eval evidence. No status flip added,
  no second activation path. Tested: the author cannot activate their own row, and the OWNER cannot
  either (`EVAL_GATE`), and the row is still `candidate` afterwards.
- **The tool grant**: still `toolsForWorkflowPack(packId)`. A tenant candidate body that asks in
  prose for every forbidden tool executes exactly the registry's list — asserted against the real
  agent loop's `agentSteps` record, not a source scan.
- **ADR-003**: the global `skills` table is never written by this path.

## Verification — real commands, real output

The plan's two gate commands are no-ops on this machine and were NOT run as written.

| Command | Output |
| --- | --- |
| `cd packages/core && pnpm vitest run workflowCustomization` | **1 file / 105 tests passed** (was 87) |
| `cd packages/core && pnpm vitest run` | **45 files / 1455 passed** (baseline 45 / 1437, +18 = exactly this plan) |
| `cd packages/core && pnpm typecheck` | clean |
| `cd packages/backend && pnpm vitest run skills.test workflowPackBinding` | **2 files / 196 passed** (skills 158, was 143; binding 38, was 35) |
| `cd packages/backend && pnpm vitest run` | **111 files / 3070 passed, 1 failed** — the failure is `convex/env.test.ts`, the documented Phase-28 QuickBooks `ENV_MANIFEST` gap. `git log -2` on `lib/env.ts`/`env.test.ts` names 29-cleanup and 28-05; my diff touches neither file. |
| `cd packages/backend && pnpm typecheck` | clean |
| `cd packages/contracts && pnpm vitest run` + `pnpm typecheck` | **6 files / 99 passed**, clean (unchanged from baseline) |
| `cd packages/revenue && pnpm vitest run` | **6 files / 226 passed** (unchanged) |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | run on the DIRTY tree before committing: **empty stdout** after both playbook bumps. Before them it printed `"decision":"block"` naming `docs/playbooks/workflow-packs.md`, so the gate was genuinely examining my files. |
| `npx biome check` on all 8 changed TS/MD-adjacent files | 0 errors, 58 warnings — all `noNonNullAssertion`, the same style warning the pre-existing lines of `skills.test.ts` already carry |
| `git diff --stat HEAD -- "*.ts"` after committing | empty — no partial stage |

## Mutations observed RED

Every mutation was applied to the implementation, the suite was run, the failure observed, and the
file restored (`git diff --stat` clean after each batch).

### `workflowCustomization.ts` — the inherited half, 5/5 RED

| ID | Mutation | Result |
| --- | --- | --- |
| P-01 | `packReadableSources` admits `missing` operations | 4 failed |
| P-02 | a source preference is offered whenever there is ≥1 source | 1 failed |
| P-03 | every pack shares `business-pulse`'s threshold field | 1 failed |
| P-04 | `customizationSchemaFor` bypasses `resolveWorkflowPack` | 1 failed |
| P-05 | the body renders in reverse schema order | 2 failed |

### `skills.ts` — 7/7 RED

| ID | Mutation | Result |
| --- | --- | --- |
| S-01 | the candidate is inserted `status: "active"` | 20 failed |
| S-02 | template lineage is never written to the row | 3 failed |
| S-03 | a stale base version is accepted | 1 failed |
| S-04 | a stale template version is accepted | 1 failed |
| S-05 | validation is bypassed and `values` accepted as submitted | 2 failed |
| S-06 | the audit payload carries the submitted values | 1 failed |
| S-07 | the duplicate rule ignores the template version | 1 failed *(GREEN on the first attempt — see below)* |
| S-08 | the duplicate rule ignores the template entirely | 1 failed |

### `workflowPackBinding.ts` — 2/2 RED

| ID | Mutation | Result |
| --- | --- | --- |
| B-01 | `tenantSkillIds` never reaches `runSpecialistTurn` | 2 failed |
| B-02 | the pin argument is dropped from `packArgs` | 3 failed |

**S-07 found a vacuous test and I fixed it.** My first republish test could not distinguish the
template comparand from the registry-lineage comparand, so deleting the former stayed fully green. I
added the ACTIVE-row case, where `basedOnVersion` no longer tracks the global template, and the
mutation now goes red. This is the one place in this plan where the mutation pass caught a real hole
rather than confirming one.

## Deviations from the plan text

1. **`USER_AUTHORABLE_SKILLS` was not widened.** Full reasoning above. This is the largest deviation
   and it changes the shape of the plan's "Phase 21's existing gate" instruction.
2. **`packages/backend/convex/workflowPacks.ts` does not exist.** The plan names it in
   `files_modified` and in both `must_haves.artifacts`. The mutation went into **`skills.ts`** —
   `workflowPackBinding.ts` is `"use node"` and may hold only actions, so a `tenantMutation` cannot
   live there, and `skills.ts` is where the shared tenant candidate writer, the version allocator,
   the rollback baseline and the audit write already are (ponytail rung 2). Its tests went into
   **`skills.test.ts`**; the pin-passthrough tests into **`workflowPackBinding.test.ts`**.
3. **`packages/backend/convex/evaluations.ts` was NOT modified**, though the plan names it. Its
   `tenantSkillIds` rail carries the harness's pins from `actOnGapInternal` into `dispatch
   .runSpecialist` — the gap→specialist path, which no pack uses. The pack eval rail is
   `run-workflow-pack-evals.mjs` → `workflowPackBinding.runWorkflowPack` → `runSpecialistTurn`, and
   that is where the hop was genuinely missing. I state this plainly rather than touching the file
   for coverage's sake: **this is a named file my diff does not contain, on purpose.**
4. **Two playbooks were bumped, not one.** `docs/playbooks/workflow-packs.md` watches
   `packages/backend/convex/workflowPack*`, so CLAUDE.md §9 required it alongside
   `skill-registry.md`.
5. **A comment was added to `packages/contracts/src/skill.ts`** (not in `files_modified`, but in my
   ownership list): a cross-reference on `USER_AUTHORABLE_SKILLS` naming the third channel, so a
   future widener finds it. No constant, type or behaviour in that file changed.

## Left undone / owned by another plan

- **`convex/llm.ts:5006` now carries a false comment.** It says the tenant-overlay branch matters
  because "only the three USER_AUTHORABLE_SKILLS can have an overlay row at all". After this plan a
  pack name can too — and that is the desired behaviour (`getEffectiveSkill` is used for every
  skill name, so an ACTIVATED tenant pack candidate is served automatically with no llm.ts change).
  **llm.ts is owned by 29-06**, so I did not edit it. The fix is one clause: name the pack channel
  beside the three.
- **`scripts/run-workflow-pack-evals.mjs` has no `--tenant-skill` mode.** It pins the GLOBAL version
  (`skillVersions`) and writes evidence with `skills:recordEvalEvidence` on the `skills` row. The
  backend hop now exists and is proven offline, but **until the runner learns to pass
  `tenantSkillIds` and call `skills.recordTenantEvalEvidence`, a tenant pack customization cannot be
  certified in practice and stays dark forever.** It is a live, paid path I could not run here. This
  is recorded as a KNOWN GAP in `docs/playbooks/skill-registry.md` rather than papered over by
  relaxing the activation gate. **A follow-up plan should own it.**
- **No UI.** There is no surface that renders `packCustomizationFields` or calls
  `publishPackCustomization`. `myUserSkills` returns pack rows (verified by test) but labels them
  with the raw registry name, because `USER_AUTHORABLE_SKILL_METADATA` has no pack entries. A UI
  plan will want pack labels there.
- **`docs/playbooks/knowledge-search-routines.md` also watches
  `packages/core/src/workflowCustomization`.** 29-06 owns that file and had it dirty during my run,
  so the §9 gate was satisfied by their edit rather than mine. If 29-06's change is reverted, my
  Task 1 commit would retroactively fail that gate.
- **STATE.md / ROADMAP.md / REQUIREMENTS.md were not touched.** Two plans are executing concurrently
  in this worktree; running `state advance-plan` from both would double-advance the counter. The
  orchestrator should record ROUT-01 and advance the position once, after both plans land.

## Self-Check: PASSED

- `packages/core/src/workflowCustomization.ts` · `.test.ts` — FOUND
- `packages/backend/convex/skills.ts` · `skills.test.ts` — FOUND
- `packages/backend/convex/workflowPackBinding.ts` · `.test.ts` — FOUND
- `packages/contracts/src/skill.ts` — FOUND
- `docs/playbooks/skill-registry.md` · `workflow-packs.md` — FOUND
- commit `15fa2d2` — FOUND · commit `04814fe` — FOUND
- `git diff --stat HEAD -- "*.ts"` after the final commit — empty
