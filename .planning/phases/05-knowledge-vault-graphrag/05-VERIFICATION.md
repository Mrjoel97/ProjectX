---
phase: 05-knowledge-vault-graphrag
verified: 2026-07-14T19:05:54Z
status: human_needed
score: 4/4 must-haves verified (code-complete); 2 items deferred to human/live verification
human_verification:
  - test: "Visual 1:1 check of /dashboard/vault against docs/design/brand/brand-024242.png and brand-024258.png"
    expected: "Headline, Refresh + Loading pill, 4 stat tiles (colored icon badges), 6 category tabs (My Uploads active teal pill), dropzone copy, search bar + N ITEMS + grid/list toggle, and honest-zero empty states all match the screenshots pixel-for-pixel"
    why_human: "Visual/brand fidelity cannot be verified programmatically; requires a running dev stack + human eyes. The vault Convex functions are not deployed on the shared local backend that owns 127.0.0.1:3210 (owned by the main repo's convex dev watcher), and browser auth cannot be automated in this environment — consistent with every prior phase's deferral to /gsd:verify-work."
  - test: "Live ingest -> embed -> graph-extract -> ground -> search -> download -> delete loop against a real Convex dev deployment with a real OPENAI_API_KEY"
    expected: "pnpm --filter @pikar/backend smoke:vault ingests 2-3 briefs sharing an entity via a REAL rag.add embed, polls to status:ready, asserts vaultSearch returns a non-empty ranked result, asserts vaultGround's live path merges the graph-neighbor doc reached via the shared entity (proving hybrid vector+graph retrieval live), and asserts no raw brief text appears in any audit/deadLetters row"
    why_human: "Requires a live convex dev deployment with real OpenAI credentials; not executable in this offline verification pass for the same shared-backend-ownership reason as above. The script (packages/backend/scripts/run-smoke-vault.mjs) and its Convex helpers (packages/backend/convex/vaultSmoke.ts) exist, are registered (smoke:vault script confirmed present), and were reviewed as substantive (not stubs) — only the live execution is deferred."
---

# Phase 5: Knowledge Vault & GraphRAG Verification Report

**Phase Goal:** The system remembers — briefs and documents become groundable, searchable memory scoped to each user via hybrid vector + graph retrieval.
**Verified:** 2026-07-14T19:05:54Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Briefs/documents are stored and embedded (`text-embedding-3-small`@1536) for vector retrieval (VALT-01) | VERIFIED | `packages/backend/convex/vaultRag.ts` constructs the single `RAG` instance at `embeddingDimension: 1536` with `openai.embedding("text-embedding-3-small")`; `embedDoc` internalAction does redact-then-embed with contentHash dedup precheck via `rag.findEntryByContentHash`; `vaultIngest.ts` workflow calls it as step 2. `vault.ts` `vaultIngestText`/`vaultUpload` insert `status:"processing"` rows and start the workflow; a duplicate `(tenantId, contentHash)` short-circuits with no workflow start. Backend `test vault` (9/9) and `test vaultRedaction` (3/3) pass. |
| 2 | Graphify extracts entities/relationships from vault content at ingestion; nodes/edges stored in Convex `graphNodes`/`graphEdges` (VALT-02) | VERIFIED | `packages/backend/convex/vaultLlm.ts` `extractGraph` (V8 `internalAction`, no `"use node"`) loads the `graph-extractor` skill from the registry (`internal.skills.getActiveSkill`), runs `scanText` (fail-closed) BEFORE `generateObject`, and returns typed `{nodes, edges}` — never raw text. `vaultGraph.ts` `upsertGraph` dedupes cross-doc on `(tenantId, type, normalizedName)` via `normalizeName` and bumps both edge endpoints' `degree`. `graphNodes`/`graphEdges` tables exist in `schema.ts` with all 6 required indexes. Backend `test vaultGraph` (4/4) passes — cross-doc dedup, degree bookkeeping, hop-cap exclusion, tenant isolation all asserted. |
| 3 | A request is grounded using hybrid retrieval — vector similarity + hop-capped graph traversal — scoped to only the requesting user (VALT-03) | VERIFIED | `packages/backend/convex/vaultGround.ts` `vaultGround({query})`: `rag.search(ctx, {namespace: ctx.tenantId, searchType:"hybrid", ...})` → maps entries to seed doc ids → `internal.vaultGraph.expand({tenantId, seedDocIds, hopCap: GRAPH_HOP_CAP})` (pure `bfsNeighbors` from `@pikar/vault`, hop cap 2) → `fuse(...)` merges/dedupes/ranks. `expand`'s Convex query filters every read by the `tenantId` index prefix (no cross-tenant leak). Backend `test vaultGround` (9/9) passes, including "merges vector seed with <=2-hop graph neighbors; excludes 3-hop doc" and cross-tenant-returns-nothing cases. |
| 4 | User can browse and search their own vault contents (VALT-04) | VERIFIED | `vault.ts` read plane: `listVaultDocs` (tenant-scoped, category filter), `vaultStats` (4 stats derived from the cheap query), `vaultDownloadUrl` (owner-guarded signed URL, cross-tenant → null), `docEntities` (this-doc graph), `vaultSearch` (same `rag.search` hybrid primitive, category post-filter). The `/dashboard/vault` route (`page.tsx`, `VaultStats.tsx`, `CategoryTabs.tsx`, `Dropzone.tsx`, `DocGrid.tsx`, `PreviewModal.tsx`, 1342 lines total) wires all of these via `useQuery`/`useMutation`; nav entry `{href:"/dashboard/vault", label:"Knowledge Vault"}` present in `(app)/layout.tsx`. `pnpm --filter @pikar/web typecheck` and `pnpm --filter @pikar/web build` both succeed and `/dashboard/vault` appears in the build's route list. Playwright `vault.spec.ts` is discovered (`playwright test vault --list`) and exercises the full browse/search/preview/delete loop over the offline `SMOKE::` ingest. |
| 5 | Pure `@pikar/vault` domain logic (normalize/BFS/fusion/categories/constants) is correct and Convex-free (§1 foundation) | VERIFIED | `packages/vault/src/{normalize,categories,traversal,fusion,constants}.ts` — zero Convex imports, exported cleanly from `index.ts`. `pnpm --filter @pikar/vault test` → 19/19 green (normalize 3, categories 6, traversal 5, fusion 5). |
| 6 | Delete cascades fully (row + rag chunks + graph edges) with orphan GC, and no raw content leaves the content plane (§4) | VERIFIED | `vault.ts` `deleteVaultDoc`: `rag.deleteAsync` for embedded docs, deletes all `graphEdges` where `sourceDocId` matches, decrements/GCs `graphNodes` whose degree hits 0, tenant-guarded (cross-tenant → no-op). `vaultRedaction.test.ts` (3/3) statically asserts vault modules write no `audit`/`deadLetters`/`telemetry` row, no graph insert carries a `text:` field, and `scanText` precedes both `generateObject` and `rag.add`. |
| 7 | The live 1:1 UI matches the brand screenshots; the live embed+hybrid-retrieval loop works on a real deployment | UNCERTAIN (deferred) | Not executable in this pass — see Human Verification section. Code artifacts for both checks (the UI route, the `smoke:vault` script + `vaultSmoke.ts` helpers) exist and were reviewed as substantive; only live execution is deferred, consistent with STATE.md's documented carry-forward and every prior phase's precedent. |

**Score:** 6/7 truths VERIFIED programmatically; 1 truth requires human/live-deployment verification (not a code gap).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/vault/src/traversal.ts` | hop-capped BFS, pure, no Convex import | VERIFIED | 37 lines, visited-set guarded, hop-capped, zero Convex imports |
| `packages/vault/src/fusion.ts` | vector-seed + graph-expand merge/dedupe/rank | VERIFIED | 56 lines, deterministic (score desc, docId asc tiebreak) |
| `packages/vault/src/constants.ts` | `VAULT_FILE_CAP_BYTES`, `GRAPH_HOP_CAP` | VERIFIED | `GRAPH_HOP_CAP = 2`, `VAULT_FILE_CAP_BYTES = 8 * 1024 * 1024` |
| `docs/playbooks/vault.md` | vault subsystem playbook | VERIFIED | Exists, `Last verified: 05-07` |
| `docs/playbooks/watch.json` | vault.md watched-path registration | VERIFIED | `"vault.md"` key registers all 11 vault path prefixes incl. `packages/vault/`, all `convex/vault*.ts`, the route dir, the E2E spec, the smoke script |
| `packages/backend/convex/schema.ts` | `vaultDocuments`+`graphNodes`+`graphEdges` tables | VERIFIED | All 3 tables present with all 6 required indexes (`by_tenant`, `by_tenant_contentHash`, `by_tenant_normalized`, `by_tenant_fromNode`, `by_tenant_toNode`, `by_tenant_source`) |
| `packages/backend/convex/vaultRag.ts` | single `RAG(...)` construction site | VERIFIED | `text-embedding-3-small`@1536, single construction site, `embedDoc` step appended |
| `packages/contracts/skills/graph-extractor.md` + 4 mirror files | registry skill, no hardcoded prompt | VERIFIED | 5-file mirror confirmed byte-consistent; drift test (`skills.test.ts`, 13/13 green) asserts `.md` ≡ `.ts` |
| `packages/backend/convex/vaultLlm.ts` | V8 `extractGraph` internalAction | VERIFIED | No `"use node"`; SMOKE seam confirmed offline; scanText fail-closed before `generateObject` |
| `packages/backend/convex/vaultGraph.ts` | `upsertGraph` + `expand` | VERIFIED | Cross-doc dedup, degree bookkeeping, tenant-scoped BFS via `@pikar/vault bfsNeighbors` |
| `packages/backend/convex/vaultIngest.ts` | `workflow.define` ingest pipeline | VERIFIED | Single workflow, store→embed→extract→upsertGraph→recordSpend→ready, governed preCall gate |
| `packages/backend/convex/vault.ts` | ingest mutations + read plane + delete cascade | VERIFIED | `vaultIngestText`, `vaultUpload`, `deleteVaultDoc`, `listVaultDocs`, `vaultStats`, `vaultDownloadUrl`, `docEntities`, `vaultSearch`, `getDoc`, `markReady`/`markFailed` all present, 395 lines |
| `packages/backend/convex/vaultGround.ts` | hybrid vector+graph grounding action | VERIFIED | `rag.search(...searchType:"hybrid"...)` → `vaultGraph.expand` → `fuse`; SMOKE offline seam |
| `apps/web/app/(app)/dashboard/vault/page.tsx` + components | the vault route | VERIFIED | 1342 total lines across 7 files (page, VaultStats, CategoryTabs, Dropzone, DocGrid, PreviewModal, icons); nav entry present; `pnpm --filter @pikar/web build` succeeds with `/dashboard/vault` in the route list |
| `apps/web/e2e/vault.spec.ts` | Playwright E2E over offline SMOKE:: ingest | VERIFIED | 99 lines; discovered via `playwright test vault --list`; covers honest-zero → paste → processing→ready → search → preview(entities) → delete → empty |
| `packages/backend/scripts/run-smoke-vault.mjs` + `packages/backend/convex/vaultSmoke.ts` | live embed/search/ground gate | VERIFIED (structure) | `smoke:vault` npm script registered and confirmed present; script (40 lines) mirrors `run-smoke-fanout.mjs`; helper module (254 lines) has real seed/assert/purge logic, not a stub. Live execution deferred (see human_verification). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `docs/playbooks/watch.json` | `docs/playbooks/vault.md` | `vault.md` key registers vault path prefixes | WIRED | Confirmed; `node scripts/check-playbooks.mjs` exits 0 |
| `packages/backend/convex/skills.ts` | `graphExtractorSkillBody` | `seedSkills` appends `GRAPH_EXTRACTOR_SKILL` row | WIRED | Confirmed at `skills.ts:105`; drift test green |
| `packages/backend/convex/vaultRag.ts` | `components.rag` | `new RAG(components.rag, {...})` | WIRED | Confirmed, single construction site |
| `packages/backend/convex/vaultLlm.ts` | `skills.getActiveSkill` | `runQuery(internal.skills.getActiveSkill, {name: GRAPH_EXTRACTOR_SKILL})` | WIRED | Confirmed `vaultLlm.ts:114-117`, fails closed unseeded |
| `packages/backend/convex/vaultGraph.ts` | `@pikar/vault bfsNeighbors` | `expand` builds adjacency and calls `bfsNeighbors` | WIRED | Confirmed `vaultGraph.ts:125` |
| `packages/backend/convex/vault.ts` | `internal.vaultIngest.ingestDoc` | `workflow.start` after inserting the processing row | WIRED | Confirmed in both `vaultIngestText` and `vaultUpload` |
| `packages/backend/convex/vaultIngest.ts` | `guardrails.preCall`/`recordSpend` | `step.runMutation` gate before spend, `recordSpend` after | WIRED | Confirmed steps (1) and (5) in `vaultIngest.ts` |
| `packages/backend/convex/vault.ts` | `rag.deleteAsync` | `deleteVaultDoc` cascade | WIRED | Confirmed `vault.ts:174` |
| `packages/backend/convex/vaultGround.ts` | `internal.vaultGraph.expand` | seed docIds → `expand(hopCap=GRAPH_HOP_CAP)` → `fuse` | WIRED | Confirmed `vaultGround.ts:70-77` |
| `packages/backend/convex/vault.ts` | `ctx.storage.getUrl` | `vaultDownloadUrl` tenant-guarded signed URL | WIRED | Confirmed `vault.ts:246-253`, owner-guarded, returns `null` cross-tenant |
| `apps/web/.../page.tsx` | `api.vault.listVaultDocs`/`vaultStats` | `useQuery` reactive browse+stats | WIRED | Confirmed `page.tsx:56-57` |
| `apps/web/.../Dropzone.tsx` | `api.vault.vaultUpload` | `generateUploadUrl` POST then `vaultUpload` mutation | WIRED | Confirmed `Dropzone.tsx:44-70` |
| `apps/web/.../layout.tsx` | `/dashboard/vault` | NAV entry "Knowledge Vault" | WIRED | Confirmed `layout.tsx:15` |
| `packages/backend/package.json` | `run-smoke-vault.mjs` | `smoke:vault` npm script | WIRED | Confirmed present |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| VALT-01 | 05-02, 05-04, 05-07 | Briefs/documents stored and embedded for vector retrieval | SATISFIED | `vaultRag.ts` (RAG instance + embedDoc), `vaultIngest.ts` (workflow), `vault.ts` (ingest mutations); `test vault` 9/9 green |
| VALT-02 | 05-01, 05-02, 05-03 | Graphify extracts entities/relationships at ingestion; stored in Convex | SATISFIED | `vaultLlm.ts` (extractGraph), `vaultGraph.ts` (upsertGraph); `test vaultGraph` 4/4 green |
| VALT-03 | 05-01, 05-05, 05-07 | Hybrid vector+graph retrieval scoped to requesting user | SATISFIED | `vaultGround.ts`; `test vaultGround` 9/9 green (incl. tenant isolation + hop-cap exclusion) |
| VALT-04 | 05-05, 05-06, 05-07 | User can browse and search their vault contents | SATISFIED | `vault.ts` read plane + `/dashboard/vault` route; web build succeeds; Playwright spec discovered |

All 4 VALT-01..04 requirement IDs declared across the 7 plans cross-reference cleanly against `.planning/REQUIREMENTS.md` (lines 58-61, 156-159 — all marked `Complete`/`Phase 5`). No orphaned requirements found.

### Anti-Patterns Found

None. Scanned `packages/vault/src/*.ts`, `packages/backend/convex/vault*.ts`, and the vault route `.tsx` files for TODO/FIXME/XXX/HACK/PLACEHOLDER, empty handlers, and stub returns — the only "placeholder" hits are legitimate HTML `placeholder=` attributes on `<input>`/`<textarea>` elements, not stub markers. All `ponytail:` comments found are intentional-simplification markers with documented upgrade paths (per §8), not anti-patterns.

### Test Results

- `pnpm --filter @pikar/vault test` — 19/19 green (normalize, categories, traversal, fusion).
- `pnpm --filter @pikar/backend test skills` — 13/13 green (incl. graph-extractor drift row).
- `pnpm --filter @pikar/backend test vaultGraph` — 4/4 green (run standalone).
- `pnpm --filter @pikar/backend test vaultGround` — 9/9 green (run standalone).
- `pnpm --filter @pikar/backend test vault.test` — 9/9 green (run standalone).
- `pnpm --filter @pikar/backend test vaultRedaction` — 3/3 green (run standalone).
- Combined `pnpm --filter @pikar/backend test vault` (all 4 files in one vitest invocation) — 19/25 pass, 6 fail with `ReferenceError: process is not defined` inside vitest's forked-worker teardown. This is the documented Windows parallel-fork teardown flake (`docs/playbooks/vault.md`: "Windows note: convex-test files crash on parallel-fork teardown ... false red; each file passes run alone") — confirmed a false-red by the per-file runs above, all 25/25 green. Not a regression.
- `pnpm --filter @pikar/backend typecheck` — clean for all vault modules; the ~20 remaining errors are all in pre-existing `.test.ts` files (`audit.test.ts`, `deadLetters.test.ts`, `guardrails.test.ts`, `importGuard.test.ts`, `llmRedaction.test.ts`, `plans.test.ts`, `tenant.test.ts`, `worm.test.ts`) predating this phase (confirmed via `git log` — `audit.test.ts` traces to `fb947fc` / Phase 1). None touch vault files.
- `pnpm --filter @pikar/web typecheck` — clean.
- `pnpm --filter @pikar/web build` — succeeds; `/dashboard/vault` appears in the compiled route list.
- `pnpm --filter @pikar/web exec playwright test vault --list` — `vault.spec.ts` discovered (1 test in the file, 10 total across the suite).
- `node scripts/check-playbooks.mjs` — exits 0.
- `node -e "... smoke:vault ..."` — confirms the `smoke:vault` script is registered.

### Human Verification Required

### 1. Visual 1:1 brand check

**Test:** Start the lane's stack (`npx convex dev` + `pnpm dev`), open `/dashboard/vault`, and compare against `docs/design/brand/brand-024242.png` and `brand-024258.png`.
**Expected:** Headline, Refresh + Loading pill, 4 stat tiles with colored icon badges, 6 tabs (My Uploads active teal pill), dropzone copy, search bar + N ITEMS + grid/list toggle, honest-zero empty states all match 1:1.
**Why human:** Visual/brand fidelity is not programmatically verifiable; requires a live browser session. The vault Convex functions are not deployed on the shared local backend (main repo's `convex dev` watcher owns `127.0.0.1:3210`), and auth cannot be automated in this environment.

### 2. Live embed + hybrid vector+graph retrieval

**Test:** Run `pnpm --filter @pikar/backend smoke:vault` against a live Convex dev deployment with a real `OPENAI_API_KEY`.
**Expected:** Two briefs sharing an entity ingest via a real `rag.add` embed, reach `status:ready`, `vaultSearch` returns a non-empty ranked result, and `vaultGround` merges the graph-neighbor doc reached via the shared entity (proving live hybrid vector+graph retrieval), with no raw brief text landing in any audit/deadLetters row.
**Why human:** Requires a live deployment + real API credentials not available in this offline verification pass. The script and its Convex helpers exist and were reviewed as substantive (not stubs); only live execution is deferred.

### Gaps Summary

No code gaps found. All 4 VALT requirements (VALT-01..04) have complete, substantive, wired implementations verified against the actual codebase — not just SUMMARY claims. Every artifact from every plan's frontmatter was located, read, and confirmed non-stub; every key link was traced and confirmed wired; all offline/unit tests pass (44 total vault-scoped tests across `@pikar/vault` + `@pikar/backend`, all green when run per-file); the web app builds cleanly with the vault route present; the Playwright spec is discovered and exercises the full VALT-04 UI loop offline; `check-playbooks` passes; backend/web typechecks are clean of any vault-caused errors (the ~20 remaining backend tsc errors are confirmed pre-existing in `.test.ts` files from prior phases, unrelated to this phase's changes).

The two items flagged for human verification (the live 1:1 UI brand check and the live `smoke:vault` gate) are explicitly deferred by design — consistent with every prior phase's precedent in this project — because the vault functions are not deployed on the shared local Convex backend and browser auth cannot be automated in this environment. This is a known, documented carry-forward (recorded in `.planning/STATE.md` and `docs/playbooks/vault.md`), not a phase failure. Status is `human_needed` rather than `passed` to make this explicit and ensure the two live checks are executed before the phase is considered fully closed.

---

*Verified: 2026-07-14T19:05:54Z*
*Verifier: Claude (gsd-verifier)*
