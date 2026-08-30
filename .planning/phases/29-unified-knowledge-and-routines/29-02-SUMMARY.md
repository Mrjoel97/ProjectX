---
phase: 29-unified-knowledge-and-routines
plan: 02
subsystem: knowledge-adapters
tags: [knowledge-search, vault-grounding, google-drive, citations, freshness, tenant-isolation, source-scan, mutation-testing]

# Dependency graph
requires:
  - phase: 29-01
    provides: "@pikar/core/knowledgeSearch — Evidence, KnowledgeSourceState, authorityFor, clampEvidence, validateSourceRef. Every honesty rule this plan obeys is decided there, not here."
  - phase: 10-vault-grounding
    provides: "vaultGroundHydrated — hybrid limit 8 / threshold 0.2, folder sealing before graph expansion, GRAPH_HOP_CAP, the 1500-per-doc / 8000-total hydration budget"
  - phase: 15.3-09
    provides: "vaultDrive.findInDrive — the read-only Drive search seam, scope-before-refresh, both shared-drive parameters, Drive query-language escaping"
provides:
  - "packages/backend/convex/knowledgeVaultDrive.ts — searchVaultKnowledge + searchDriveKnowledge, the two native knowledge-source adapters"
  - "packages/backend/convex/vaultGround.ts — vaultGroundHydrated now returns kinds / sourceUpdatedAt / truncated beside docIds"
  - "packages/backend/convex/vaultDrive.ts — runDriveSearch (the one shared token gate) + findInDriveForTenant (identity-less)"
  - "packages/backend/convex/vault.ts — ownedDocsMeta carries kind / createdAt / retrievedAt for citations"
affects: [29-06 coordinator (its only caller), 29-04 toolless synthesis, 29-03 (shares the adapter contract shape)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "An adapter with ONE way in: the module is source-scanned for every alternative read path, so a second unbounded read cannot be added without the build going red"
    - "Truncation reported as a parallel boolean, because a string shorter than the cap cannot tell a complete read from a partial one"
    - "A metadata-only citation states in its own text that the contents were not opened, so a file NAME can never be read as a finding"
    - "One security gate, two thin wrappers, and the static guard follows the gate rather than the wrapper it used to live in"

key-files:
  created:
    - packages/backend/convex/knowledgeVaultDrive.ts
    - packages/backend/convex/knowledgeVaultDrive.test.ts
  modified:
    - packages/backend/convex/vaultGround.ts
    - packages/backend/convex/vaultGround.test.ts
    - packages/backend/convex/vaultDrive.ts
    - packages/backend/convex/vault.ts
    - packages/backend/convex/dispatchGuard.test.ts
    - packages/backend/convex/onboarding.test.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/playbooks/vault.md
    - docs/playbooks/watch.json

key-decisions:
  - "The adapters RETRIEVE NOTHING. Every bound stays behind vaultGroundHydrated / runDriveSearch, and a source scan fails the build if the module ever names rag.search, ownedSearchDocsMeta, vaultGraph.expand, vault.getDoc, ctx.db, fetch( or googleapis.com."
  - "The Blueprint spine is discarded from the evidence AND from the count, with a positive control that it really was present."
  - "vaultGroundHydrated was EXTENDED, not wrapped: three additive parallel arrays, the four production callers destructure by name and are untouched."
  - "Per-doc truncation is now reported. It was invisible, and the adapter was calling a one-page read of a long document `available`."
  - "findInDrive's token gate moved into runDriveSearch so both entry points share ONE copy; dispatchGuard.test.ts follows the gate, because scanning the old wrapper would now pass vacuously."
  - "A Drive citation is metadata only, and says so in its own text. No content snippet, because a snippet needs a download — the import rail's paid path."
  - "An unparseable or absent Drive modifiedTime is ABSENT, never 0."

patterns-established:
  - "Every static source scan carries a POSITIVE CONTROL asserting it can see real code, so it cannot pass on an empty string."
  - "A drift tripwire (an exhaustive toEqual on a returned shape) is EXTENDED by hand rather than loosened to a subset match — the hand cost is the point."

requirements-completed: []

# Metrics
duration: ~145min
completed: 2026-08-28
---

# Phase 29 Plan 02: Vault and Drive Knowledge Adapters Summary

**The vault and Drive now answer a knowledge search under the closed source contract — and both
report what they could NOT read: a document read one page deep is `partial`, an unreachable Drive
is `unavailable` with a named reason and structurally no count, and a Drive citation says in its
own words that the file's contents were never opened.**

## Performance

- **Duration:** ~145 min
- **Tasks:** 2 of 2
- **Commits:** `a706bc2` (task 1), `ec26089` (task 2)
- **Files:** 2 created, 9 modified — 1,190 insertions, 60 deletions

## What was built

### Task 1 — `searchVaultKnowledge` (`a706bc2`)

An identity-less `internalAction({tenantId, query})` returning `{state, evidence}`.

- **One way in.** Retrieval is `internal.vaultGround.vaultGroundHydrated` and nothing else, because
  every bound worth having lives behind it. A source scan over the module (comments stripped) fails
  on `rag.search`, `ownedSearchDocsMeta`, `vaultGraph.expand`, `vault.getDoc` and `ctx.db`.
- **The Blueprint spine is discarded** from the evidence and from the count. The test carries a
  positive control asserting the spine really was a non-null string on the same fixture.
- **Authority comes from the row**: `vaultDocuments.kind === "web_research"` maps to
  `third_party_research`, `origin === "agent_promoted"` to the weakest class `agent_authored`.
- **Freshness comes from a timestamp**: `retrievedAt ?? createdAt`, the only source-time the vault
  holds. Absent stays absent, which downstream reads as `unknown`, never as fresh.
- **Evidence ids are server-minted and namespaced** (`vault-1`, `drive-1`), so the coordinator can
  merge two adapters' rows without a collision.

### Task 2 — `searchDriveKnowledge` (`ec26089`)

- **The gate moved to `runDriveSearch`**, one module-private function that both `findInDrive`
  (identity-bearing, the cockpit tool) and the new `findInDriveForTenant` (identity-less) route
  through. `findInDrive`'s **public shape is byte-identical** — it projects the runner's rows back
  down to `{id, name, kind, readable}` — so the picker, the cockpit tool and their 18 landed tests
  are untouched.
- **A Drive citation is a pointer, not a quote.** The evidence text is
  `Google Drive file "<name>" (<mime>) matched this search. Pikar read its file listing only — the
  contents were not opened.` A bare file name as evidence text is a name a synthesizer reads as a
  finding about the business. A folder never becomes evidence at all.
- **Honest availability.** `not_connected` / `reauth` / `refresh_failed` keep their own names and
  `drive_error` becomes `provider_error`; all four use the `unavailable` arm, which structurally
  carries no count. A `nextPageToken` and the per-source cap of 8 both return `partial/cap`. An
  unparseable or absent `modifiedTime` is absent, never 0 (epoch 0 reads as "very stale").

## The defect this found, and it was in the landed code

**Per-doc truncation was invisible to every caller of `vaultGroundHydrated`.** The cap is applied
inside that action, so a caller receiving 1,500 characters cannot distinguish a whole short
document from the first page of a long one — both arrive as a string shorter than the cap. The
adapter was reporting `{status: "available"}` for a document it had read one page of. The test
`"a long document is truncated to the per-doc cap"` was written expecting `partial` and went red;
the fix is a parallel `truncated: boolean[]`, computed at the slice site. A hit whose text the
whole-run budget squeezed to the empty string is now **dropped rather than shipped**: a row with no
text can be cited and never verified, because `validateSynthesis` checks excerpts against the cited
text and there would be none.

## Verification — the CORRECTED commands, with real output

The plan's two gate commands are no-ops on this machine and were **not run as written**.
`pnpm --filter @pikar/backend test -- <filters>` swallows the `--`; `node scripts/check-playbooks.mjs`
run bare hangs on stdin and signals failure by PRINTING, never by exit code.

| Command | Output |
|---|---|
| `cd packages/backend && pnpm vitest run knowledgeVaultDrive vaultGround vaultDrive dispatchGuard` (**baseline, before any change**) | 3 files / **55 passed** — dispatchGuard 21, vaultDrive 18, vaultGround 16 (knowledgeVaultDrive did not exist) |
| `cd packages/backend && pnpm vitest run knowledgeVaultDrive vaultGround vaultDrive dispatchGuard` (after) | 4 files / **84 passed** — knowledgeVaultDrive **27** (new), vaultDrive **18** (unchanged), dispatchGuard **22** (+1), vaultGround **17** (+1) |
| `cd packages/backend && pnpm vitest run knowledgeVaultDrive vaultDrive vaultGround dispatchGuard onboarding vault` | 17 files / **302 passed** |
| `cd packages/backend && pnpm vitest run vaultGround knowledgeVaultDrive blueprint evaluations voiceDoc cockpitTools vault` (the four `vaultGroundHydrated` callers) | 21 files / **495 passed** |
| `cd packages/backend && pnpm vitest run` | **109 files / 2905 tests, 1 failed** — `convex/env.test.ts` only, the documented imported red (`QUICKBOOKS_*` unclassified in `ENV_MANIFEST`). |
| `cd packages/backend && pnpm typecheck` | **0 errors** |
| `cd packages/core && pnpm vitest run` | 45 files / **1422 passed** |
| `cd packages/contracts && pnpm vitest run` | 6 files / **93 passed** |
| `npx biome check` on all 8 changed/created TS files | `No fixes applied`, clean |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | prints a block naming **only** `knowledge-search-routines.md` for 29-03's `knowledgeExternalSources.*` / `knowledgeSearch.*`. **`vault.md` is not in the stale list** — this plan's §9 obligation is discharged. |
| `git diff --stat HEAD -- <my files>` after each commit | **empty** — the HEAD tree is the tree the gates ran against |

**An earlier full-suite run showed 3 failing files** (`env.test.ts`, `skills.test.ts`,
`knowledgeExternalSources.test.ts`). Both extra failures were 29-03's, and both are recorded rather
than smoothed over: `knowledgeExternalSources.test.ts` was their in-flight file, and
`skills.test.ts`'s "no long inline prompt string literals" named three literals of 1,714 / 642 / 362
chars in **`gmail.ts`** — verified by re-running the test's own scan against
`git show HEAD:packages/backend/convex/gmail.ts`, and by confirming my three source files contribute
**zero** offenders. 29-03 committed over both between runs; the final run above is green apart from
`env.test.ts`.

## Mutations observed RED — 22, each applied, run, observed, reverted

Every one was reverted and the baseline re-confirmed green; `diff` against a pre-mutation copy
proved a clean restore after each batch.

### Task 1 — 10

| ID | Mutation | Red |
|---|---|---|
| M1 | `authorityFor("vault", {})` — kind and origin ignored | 2 |
| M2 | an empty-text hit is shipped as evidence anyway | 1 |
| M3 | the spine is appended as an evidence row | 2 |
| M4 | `sourceUpdatedAt` dropped from the evidence row | 2 |
| M5 | `settle` always reports `available` | 3 |
| M6 | per-doc truncation no longer sets `cap` | 1 |
| M7 | `evidenceId` becomes a constant, so two rows collide | 1 |
| M8 | (`vaultGround`) the web-research fetch stamp is ignored | 2 |
| M9 | (`vaultGround`) `truncated.push(false)` | 2 |
| M10 | (`vault.ts`) `ownedDocsMeta` drops `doc.tenantId === tenantId` | 4 |

### Task 2 — 12

| ID | Mutation | Red |
|---|---|---|
| D1 | an unreachable Drive reported as `available/0` — the exact lie the phase exists to prevent | 4 |
| D2 | `reauth` flattened into `not_connected` | 1 |
| D3 | folders admitted as evidence | 1 |
| D4 | `nextPageToken` truncation not reported | 1 |
| D5 | the evidence text drops the "contents were not opened" statement | 1 |
| D6 | (`vaultDrive`) an absent `modifiedTime` becomes epoch 0 | 1 |
| D7 | (`vaultDrive`) the scope check moves BELOW the token refresh | 3 |
| D8 | (`vaultDrive`) the Drive query-language escape is dropped | 3 |
| D9 | (`vaultDrive`) `includeItemsFromAllDrives` dropped from the search call | 2 |
| D10 | the adapter references `internal.vaultDrive.landFile` — **proves the paid-path scan is not vacuous** | 1 |
| D11 | `findInDriveForTenant` re-implements the gate instead of sharing it | 8 |
| D12 | a `method:` appears in the Drive search request | 1 |

## Deviations from the plan text

### 1. [Rule 3 — blocking] Files outside `files_modified` had to change

| File | Why | Could it have been avoided? |
|---|---|---|
| `packages/backend/convex/vault.ts` | `authorityFor` needs `vaultDocuments.kind` and freshness needs a timestamp; `ownedDocsMeta` returned neither. Extended its projection with `kind` / `createdAt` / `retrievedAt` under the same rule `origin` already rode along on. | The alternative was a second tenant-scoped doc read in my own module — a duplicated ownership check, which is the ponytail-rung-2 mistake. Mutation M10 proves the one check is load-bearing. |
| `packages/backend/convex/dispatchGuard.test.ts` | Its scan sliced `export const findInDrive` and looked for `hasScope` inside. After the gate moved it would find **no gate at all and pass vacuously**. | No. Leaving it would have shipped a green gate over an unscanned security ordering. A new assertion was added pinning that neither wrapper re-implements the gate (D11 → 8 red). |
| `packages/backend/convex/onboarding.test.ts` | A second exhaustive `toEqual` on `vaultGroundHydrated`'s cross-tenant shape — a drift tripwire doing exactly its job on task 1's additive fields. Extended by hand, deliberately **not** loosened to a subset match. | No. |
| `packages/backend/convex/_generated/api.d.ts` | Codegen output is tracked here and cannot be regenerated without a live deployment. Two lines added, following the Phase 28 lane's own precedent (`ccb0281` did exactly this for `hubspot`). **Staged as HEAD-plus-my-two-lines only**, via `git hash-object` + `git update-index`, so a concurrent lane's lines in the same file were not swept into this commit. | No. |
| `docs/playbooks/watch.json` | CLAUDE.md §9: a new code file under `packages/` must be covered. Registered `packages/backend/convex/knowledgeVaultDrive` under `vault.md`, the playbook this plan owns and bumps. | No. |
| `docs/playbooks/vault.md` | Task 1 changes watched paths, and §9 requires the bump in the **same commit** — so the vault entry landed in task 1's commit rather than task 2's as the plan's file list implies. | No. |

### 2. `vaultGroundHydrated` was extended rather than wrapped

The task guidance said to prefer a wrapper. Three **additive** parallel arrays (`kinds`,
`sourceUpdatedAt`, `truncated`) were added to the return type instead, because a wrapper would have
needed a second `ownedDocsMeta` round-trip to recover metadata the action already fetched and threw
away. The four production callers (`blueprint.ts:540`, `evaluations.ts:295`, `llm.ts:3873`,
`voiceDoc.ts:75`) destructure by name; all four were run and pass (495 tests across the callers'
suites). The two exhaustive `toEqual`s that DID see the change are the tripwires above, and both
were extended rather than relaxed.

### 3. Task 1 committed a knowingly-incomplete module header

The file is named `knowledgeVaultDrive.ts` and lands in two commits. Its header was trimmed to the
vault-only truth for task 1 and restored in task 2, rather than committing a header that named a
`findInDriveForTenant` which did not yet exist.

## What is NOT built

- **Nothing calls either adapter.** There is no coordinator, no `knowledgeSearches` write, no
  toolless LLM call and no UI. Plans 29-04 and 29-06 own those.
- **A Drive citation carries no content.** This is a decision, not an omission — a snippet needs a
  download, which is the import rail's paid path. The upgrade path (a separately-costed export of
  one user-chosen file) is recorded in a `ponytail:` comment and in the playbook.
- **`parentName` on `DriveSearchHit` is still never populated.** Pre-existing; not touched.
- **Nothing ran against a live deployment.** No `convex dev`, no `convex run`, no OpenAI call, no
  money spent. Every number above came from an offline suite.
- **STATE.md and ROADMAP.md were NOT updated**, following 29-01's precedent and for a sharper
  reason: three plans (29-02, 29-03, 29-04) are executing **concurrently in this one worktree**.
  A `.planning/STATE.md` edit from here would collide with theirs. The orchestrator should advance
  the plan counter once the wave closes.

## Changes another plan owns, left undone

- **`packages/core/src/knowledgeSearch.ts` and `workflowPacks.ts` were not touched.** 29-03 owns
  them and the `crm-facts` landedness question. Nothing in this plan needed a change there — the
  vault and drive sources are landed on both planes.
- **`llmRedaction.test.ts` was not edited** (29-04's). It was not run in isolation either; it passed
  inside the full backend suite.
- **`skills.test.ts`'s "no long inline prompt string literals" red is 29-03's**, from three literals
  in `gmail.ts` (`783cf13`). Not fixed here: `gmail.ts` is theirs. **My three source files
  contribute zero offenders**, verified by running the test's own scan against each of them.
- **`env.test.ts` is the documented imported red** from Phase 28's mid-plan `quickbooksAuth`. Left
  alone as instructed.
- **`docs/playbooks/production-beta.md` was NOT bumped.** It is not mine, and bumping a
  `Last verified` line certifies a diff I did not read. It did not appear in the final playbook-gate
  block at all.

## Self-Check: PASSED

Both created files verified present on disk. Both task commits verified in `git log`
(`a706bc2`, `ec26089`). `git diff --stat HEAD` restricted to this plan's files is **empty** after
each commit — no partial `git add`, and the HEAD tree is the tree every gate above ran against.
`git add -A` was never used; every path was staged explicitly, and `_generated/api.d.ts` was staged
as a hand-built blob so a concurrent lane's edits to the same file were not absorbed.
