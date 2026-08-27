---
phase: 29-unified-knowledge-and-routines
plan: 01
subsystem: contracts
tags: [knowledge-search, citations, provenance, workflow-packs, tenant-skills, convex-schema, mutation-testing]

# Dependency graph
requires:
  - phase: 21-user-skill-authoring
    provides: "tenantSkills table + loadEffectiveSkill/publishUserCandidate/recordTenantEvalEvidence/activateTenantCandidate/rollbackTenantSkill — the tenant candidate overlay Phase 29 customizes into"
  - phase: 27-workflow-packs
    provides: "WORKFLOW_PACK_IDS, packPreflight, PACK_SOURCE_LABEL, PackProvenance — the approved templates being customized"
  - phase: 10-vault-grounding
    provides: "vaultGroundHydrated + the vaultSources content-plane row — the source-attribution format Phase 29 reuses rather than reinvents"
  - phase: 28-revenue-connectors
    provides: "NOTHING USABLE — contracts only. Recorded as not_landed; no connector was invented to compensate."
provides:
  - "packages/core/src/knowledgeSearch.ts — closed source registry, availability/evidence/claim types, caps, conflict-preserving dedupe, code-owned authority/freshness/confidence, citation validation, honest coverage aggregation, refs-only telemetry projection"
  - "packages/core/src/workflowCustomization.ts — closed customization field schemas, two-layer refusal surface, deterministic rendering + canonical lineage string, material-change classification, optimistic concurrency, version-pinned manual rerun identity"
  - "packages/backend/convex/schema.ts — knowledgeSearches content plane, tenantSkills pack-template lineage, savedPrompts pin lineage"
  - "packages/backend/convex/schema.test.ts — the recurrence-absence scan that nothing else in the repo performed"
  - "29-DEPENDENCY-EVIDENCE.md — the audited Phase 21/27/28 seam inventory later plans must build against"
  - "docs/playbooks/knowledge-search-routines.md — 16 invariants, registered in watch.json"
affects: [29-02 vault/drive adapter, 29-03 gmail adapter, 29-04 toolless llm, 29-05 customization substrate, 29-06 coordinator, 29-08 pinned rerun, 29-11 recurrence gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Discriminated-union source state: the unavailable arm has no `returned` field, in BOTH the pure type and the Convex validator, so 'unreachable therefore empty' is unspellable rather than discouraged"
    - "Two-layer customization refusal: undeclared KEY rejected before its value is read, then declared free-text values content-scanned"
    - "Canonical string in the pure package, hashing in the adapter — no second hash implementation"
    - "material vs requiresEval as separate booleans"
    - "Recurrence absence proven by scanning the PARSED schema, with the three pre-existing one-shot exceptions named rather than dropped"

key-files:
  created:
    - packages/core/src/knowledgeSearch.ts
    - packages/core/src/knowledgeSearch.test.ts
    - packages/core/src/workflowCustomization.ts
    - packages/core/src/workflowCustomization.test.ts
    - packages/backend/convex/schema.test.ts
    - docs/playbooks/knowledge-search-routines.md
    - .planning/phases/29-unified-knowledge-and-routines/29-DEPENDENCY-EVIDENCE.md
  modified:
    - packages/core/src/index.ts
    - packages/backend/convex/schema.ts
    - docs/playbooks/watch.json
    - packages/core/src/tenantData.ts
    - packages/core/src/tenantData.test.ts
    - docs/playbooks/audit-dead-letter.md

key-decisions:
  - "Phase 29 PROCEEDS: the Phase 21 tenant seam is landed and callable, so the plan's dependency blocker does not fire."
  - "Phase 28 CRM/support recorded as genuinely `not_landed` per the owner ruling of 2026-08-27. No connector was invented, stubbed, mocked or scaffolded."
  - "`crm`/`support` stay IN the source enum permanently unavailable, rather than being deleted from it — deleting them would let the product answer a business question from mail and files while never saying the CRM was not consulted."
  - "The manual pin EXTENDS `savedPrompts` rather than adding a `pinnedWorkflows` table (ponytail rung 2). Reasoning and the one thing that inheritance breaks are both recorded."
  - "`agent_authored` added as a FIFTH, weakest authority class so an agent-promoted vault doc can never cite back as the owner's own word."
  - "`knowledgeSearches` classified `tenant_owned`, the opposite call from `workflowPackEvents`, because it holds the user's question, the answer and their document titles."
  - "No new dependency, no hash implementation in @pikar/core, no import of @pikar/revenue from @pikar/core."
  - "The next free ADR number is 027. 013 is taken by the render worker; any plan text naming 013 for routine governance is wrong."

patterns-established:
  - "Absence tests name their exceptions: three pre-existing one-shot scheduler fields are listed in the recurrence scan rather than quietly dropped from the ban."
  - "A source-attribution row is refs + parallel labels on the content plane, counts only in the log plane — the vaultSources shape, one plane over."

requirements-completed: [KNOW-01, ROUT-01, ROUT-02]

# Metrics
duration: 82min
completed: 2026-08-27
---

# Phase 29 Plan 01: Dependency Audit, Contract Freeze and Schema Boundary Summary

**Phase 29's honesty rules are now code, not prose: an unreachable source structurally cannot carry a result count, a model-invented citation is removed and counted, conflicting evidence survives deduplication, and recurrence storage is provably absent for the first time.**

## Performance

- **Duration:** ~82 min
- **Started:** 2026-08-27T17:55Z
- **Completed:** 2026-08-27T19:20Z
- **Tasks:** 3 of 3
- **Files modified:** 13 (7 created, 6 modified) — 3,936 insertions, 13 deletions

## Accomplishments

- **Proved the plan's dependency blocker does not fire.** Phase 21's `tenantSkills` overlay is landed, indexed and callable; every activation and rollback verb is an `ownerMutation`, so ROUT-01's eval-gate requirement is already satisfied by the existing seam and Phase 29 adds no second activation path.
- **Recorded Phase 28 as genuinely absent** — zero connector `defineTable`, zero `createCipheriv|aes-256` anywhere under `packages/`, zero connector Convex modules — and turned that into a permanent, visible `unavailable/not_landed` product state instead of a stub.
- **Froze 156 tests of pure contracts** covering source availability, per-source/query/evidence caps, conflict-preserving dedupe, code-owned authority/freshness/confidence, citation and excerpt validation, closed customization schemas, deterministic rendering and lineage, material-change classification and version-pinned rerun identity.
- **Landed the single schema widening** — `knowledgeSearches`, `tenantSkills` template lineage, `savedPrompts` pin lineage — in the repo's highest-collision file, once.
- **Wrote the recurrence-absence test the repo had been promising itself in a comment since Phase 21.**
- **52 mutations applied, observed RED, and reverted** — including one vacuous test this process found and fixed.

## Task Commits

1. **Task 1: Prove the Phase 21 and Phase 28 dependency seams** — `fb5edda` (docs)
2. **Task 2: Freeze pure search, customization and pin contracts** — `e84ab78` (feat, TDD)
3. **Task 3: Land additive schema and playbook ownership** — `1e914f9` (feat)

## Verification — real commands, real output

The plan's two gate commands are no-ops on this machine and were NOT run as written.
`pnpm --filter <pkg> test -- <filters>` swallows the `--`, so the filter never reaches vitest;
`node scripts/check-playbooks.mjs` run bare hangs forever on stdin and signals failure by PRINTING,
never by exit code. Corrected forms below.

| Command | Output | Baseline |
|---|---|---|
| `cd packages/core && pnpm vitest run` | **45 files / 1388 tests passed** | 43 / 1232 (+2 files, +156 = exactly this plan) |
| `cd packages/core && pnpm typecheck` | clean | — |
| `cd packages/core && pnpm vitest run knowledgeSearch workflowCustomization` | **2 files / 156 tests passed** | new |
| `cd packages/backend && pnpm vitest run` | **101 files / 2561 tests passed**, 1 unhandled `ReferenceError: process is not defined` in `ForksBaseWorker.executeTests` | 100 / 2540 (+1 file, +21 = exactly this plan). The teardown error is the documented benign baseline noise, byte-identical to it. |
| `cd packages/backend && pnpm typecheck` | clean | — |
| `cd packages/backend && pnpm vitest run schema skills` | **3 files / 165 tests passed** | Task 1 + Task 3 gate |
| `cd packages/backend && pnpm vitest run convex/schema.test.ts` | **21 tests passed** | new |
| `cd packages/contracts && pnpm vitest run` | **6 files / 93 tests passed** | 6 / 93 — unchanged |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | **empty stdout — PASSED** (no `"decision":"block"`) | — |
| `npx biome check` on all 7 new/changed TS files | `No fixes applied`, 0 warnings | — |

## Mutations observed RED

Every mutation below was applied to the implementation, the relevant suite was run, the failure was
observed, and the file was restored. Harness output is reproducible; `git diff --stat` after each
batch confirmed a clean tree.

### `knowledgeSearch.ts` — 20/20 RED

| ID | Mutation |
|---|---|
| KS-01 | `complete` no longer requires a non-empty request — asking nothing reads as complete |
| KS-02 | a `partial` source stops being recorded as a gap |
| KS-03 | `not_landed` becomes `{status:"available", returned:0}` — the exact lie the phase exists to prevent |
| KS-04 | an invented evidence id is accepted onto the claim |
| KS-05 | excerpt substring verification removed |
| KS-06 | excerpt verified against ALL evidence instead of the rows THAT CLAIM cited |
| KS-07 | conflicting evidence dropped from the validated claim |
| KS-08 | claim authority hardcoded to the strongest class instead of the weakest cited |
| KS-09 | a future `sourceUpdatedAt` reads as maximally fresh |
| KS-10 | dedupe keys on normalized TEXT, so a $40 record and a $60 record collapse |
| KS-11 | a conflict no longer caps confidence |
| KS-12 | a coverage gap no longer caps confidence |
| KS-13 | weak authority no longer caps confidence |
| KS-14 | a single citation no longer caps confidence at `low` |
| KS-15 | the remote-URL guard removed from the planner boundary |
| KS-16 | the query cap silently truncates instead of refusing |
| KS-17 | the log-plane projection gains source LABELS |
| KS-18 | a content-shaped `sourceRef` is accepted |
| KS-19 | an `agent_promoted` vault doc keeps `tenant_owned` authority |
| KS-20 | a duplicate source in the plan is allowed twice |

### `workflowCustomization.ts` — 17/17 RED

| ID | Mutation |
|---|---|
| WC-01 | an undeclared key is accepted (layer 1 removed) |
| WC-02 | the forbidden-content scan removed (28 tests red) |
| WC-03 | the value cap counts characters instead of bytes |
| WC-04 | an out-of-range threshold is clamped instead of refused |
| WC-05 | a tone outside its closed option list is accepted |
| WC-06 | an undeclared source preference is accepted |
| WC-07 | rendering iterates the values object, so key order and undeclared keys leak into the body |
| WC-08 | a tone change is treated as material |
| WC-09 | a threshold change stops being material |
| WC-10 | a stale base version is accepted |
| WC-11 | the pin identity forgets the tenant candidate version |
| WC-12 | a rerun reuses one correlation for every run |
| WC-13 | the canonical lineage string admits undeclared keys |
| WC-14 | the canonical lineage string forgets the template version |
| WC-15 | source preferences render in submission order, so a reorder reads as a change |
| WC-16 | a template-version bump stops being material |
| WC-17 | a tone-only change no longer requires eval |

### `schema.ts` — 15/15 RED

| ID | Mutation |
|---|---|
| SC-01 | a `routines` table lands in the schema |
| SC-02b | `savedPrompts` gains a `nextRunAt` |
| SC-03 | the source state becomes one object with an optional count |
| SC-04 | an `available` source may omit its count |
| SC-05c | `knowledgeSearches.by_thread` stops being tenant-first |
| SC-06 | the no-recurrence promise comment is deleted |
| SC-07 | `confidence` becomes a free value (a probability could be stored) |
| SC-08 | `authority` becomes a free string |
| SC-09 | the `savedPrompts` pin lineage is removed |
| SC-11 | the source enum admits anything |
| SC-12 | the unavailable reason set admits anything |
| SC-13b | `conflictEvidence` becomes optional |
| SC-14 | the `tenantSkills` customization lineage is removed |
| SC-15 | `knowledgeSearches` loses `by_tenant_createdAt` |
| SC-16 | `savedPrompts` loses `by_tenant_template` |

**One mutation was NOT counted:** `SC-10b` (removing the `savedPrompts` template index by comment
surgery) went red via a syntax error rather than an assertion, so it proves nothing. It was replaced
by `SC-16`, which removes the index cleanly and turns the assertion red.

## The vacuous test this found

`SC-13` relaxed `knowledgeSearches.claims[].conflictEvidence` from a required array to
`v.optional(v.any())` — and the suite **stayed green (20/20)**. The test I had written inserted a
claim with conflicting evidence and read it back, which proves *storage* and says nothing about
*shape*: a claim that may simply omit its disagreement is a claim a synthesizer can quietly flatten.
Fixed by adding a test that inserts a claim with the field **missing** and requires the validator to
throw. Re-run as `SC-13b`: **RED**.

That is one vacuous assertion caught out of 52 mutations. It is recorded rather than smoothed over
because the failure mode — "mechanism coverage is not behaviour coverage" — is the exact one this
repo has paid for before.

## Deviations from plan

### Auto-fixed

**1. [Rule 3 — blocking] Two pre-existing tripwires caught `knowledgeSearches` as unclassified**

- **Found during:** Task 3, on the full backend suite.
- **Issue:** `convex/isolation.test.ts` ("the registry plus the auth spread accounts for EVERY runtime
  table") and `packages/core/src/tenantData.test.ts` (a hardcoded table count) both failed. These are
  drift tripwires doing exactly their job: a new table cannot reach the export/deletion walks without
  someone deliberately classifying it.
- **Fix:** classified `knowledgeSearches: "tenant_owned"` in `packages/core/src/tenantData.ts` and
  bumped the count literal 46 → 47 with a comment naming the table and why.
- **Why `tenant_owned` and not `audit_immutable`:** this is the OPPOSITE call from `workflowPackEvents`
  directly above it in the same file, and the difference is content, not convention. A pack event is
  refs/enums/counts with nowhere to put prose; a `knowledgeSearches` row holds the user's own question,
  the answer they were shown and the titles of their own documents. The denominator argument that
  reclassified `workflowPackEvents` does not apply, because the search measurement plane is a separate
  object (`redactedSearchEvent`, a pure refs/counts projection).
- **Consequence, and it is a good one:** classification IS the wiring. `tenantDelete.ts`/`tenantExport.ts`
  walk `deletableTables()`, so export and erasure need no later plan to remember. That walk calls
  `.withIndex("by_tenant")` on every name it returns, which is why the table carries a bare `by_tenant`.
- **Files:** `packages/core/src/tenantData.ts`, `packages/core/src/tenantData.test.ts`
- **Commit:** `1e914f9`

**2. [CLAUDE.md §9] `docs/playbooks/audit-dead-letter.md` bumped in the same commit**

`packages/core/src/tenantData.ts` is a watched path of `audit-dead-letter.md`. Its "Last verified"
block now records the new classification and the reasoning above. Not optional — the §9 Stop hook
would have blocked the turn.

### Judgement calls beyond the plan text

**3. The manual pin EXTENDS `savedPrompts` instead of adding a table.** The plan said "manual pins";
the task guidance said to check `savedPrompts` first and record the reasoning either way. Extending
inherits `save`/`list`/`remove`, the twenty-entry menu, the code-derived title and — the part that
matters — the "Run is an ordinary fresh cockpit turn through the existing governed send path"
execution semantics, which is ROUT-02's "never replays a plan" requirement already satisfied. A
`pinnedWorkflows` table would duplicate all of that and put a second pin menu in the workspace.

**The one thing that inheritance breaks, recorded in three places** (the schema comment, the playbook,
and here): `savedPrompts.textHash` is computed from the TEXT ALONE, so two pins of the same words
against different customizations would collide on `by_tenant_textHash` and the second `save` would
silently return the first row. It is unreachable today because nothing writes the lineage fields —
**plan 29-08 must fold `templateId`/`templateVersion`/`tenantSkillId`/`customizationHash` into that
hash before it writes the first lineage-bearing pin.**

**4. A fifth authority class, `agent_authored`.** The research names four. `vaultGroundHydrated`
returns an `origins` array where `"agent_promoted"` means the agent wrote it and the owner promoted
it (26-11, ADR-025). Without a fifth class, a citation of the model's own earlier output ranks as
`tenant_owned` and reads back as the owner's own word — the provenance-laundering defect class this
repo has already paid for three times. `authorityFor` downgrades it to the weakest class, and
mutation KS-19 proves the downgrade is load-bearing.

**5. Named `KnowledgeSourceState`, not `SourceState`.** `packages/core/src/workflowPacks.ts` L599
already exports `SourceState`, and `packages/core/src/index.ts` re-exports with `export *`. A silent
collision would have been found by a confusing type error three plans later.

**6. Four inherited line numbers were wrong and were corrected in 29-DEPENDENCY-EVIDENCE.md** with the
command that caught each: `vaultGroundHydrated` has five production callers not three, `gmail.ts` has
four GET verbs not five, and `blueprint.ts`'s toolless template opens at L271/L287/L312 not
L261/L286/L310. None changes a design decision; all are recorded rather than silently absorbed.

### Not done, and why

**STATE.md and ROADMAP.md were NOT updated.** This plan ran in an isolated worktree
(`C:/Users/expert/AppData/Local/Temp/pikar29`, branch `feat/29-unified-knowledge`) while another lane
is actively committing Phase 28 to the main tree; `.planning/STATE.md` reads `current_phase: 28` and
is that lane's live surface. Editing it here would manufacture a merge conflict on a file whose whole
value is being a single accurate record. **The orchestrator or a follow-up should advance
`current_plan` for phase 29 and mark KNOW-01/ROUT-01/ROUT-02 progress once this branch merges.**

## What is NOT built

Being explicit, because a green summary over absent capability is the failure mode this repo names by
hand:

- **Nothing writes `knowledgeSearches`.** The table, the contracts and the tests exist. There is no
  coordinator, no adapter, no toolless LLM call and no UI. Plans 29-02 … 29-06 own those.
- **No adapter was written or modified.** `vaultGround.ts`, `vaultDrive.ts` and `gmail.ts` are
  untouched; they were read, not changed.
- **`crm` and `support` cannot return anything** and will not until Phase 28 ships a connector rail.
- **No customization form, no candidate write, no eval integration.** `publishUserCandidate` is
  unchanged, and `USER_AUTHORABLE_SKILLS` is still the closed three-name allowlist — it does **not**
  include the six workflow packs. Widening it is a plan-29-05 decision with eval consequences, flagged
  in the evidence doc so it is not discovered late.
- **No pin is writable.** `savedPrompts.ts` was not modified; the row can hold lineage, nothing puts
  it there.
- **Recurrence is entirely absent, by decision.** Plan 29-11's gate has not run.
- **Nothing was verified against a live deployment.** No `convex dev`, no `convex run`, no OpenAI call,
  no money spent. Every number in this summary came from an offline suite.

## Requirements

`KNOW-01`, `ROUT-01`, `ROUT-02` — **contract and schema layer only.** None is user-visible yet; each
stays open until its later plan lands the behaviour.

## Self-Check: PASSED

All 7 created files verified present on disk; all 3 task commits verified in `git log`;
`git diff --stat HEAD -- "*.ts"` after the final commit is **empty** (no partial `git add` — the HEAD
tree is the tree every gate above ran against).
