---
phase: 05-knowledge-vault-graphrag
plan: 05
subsystem: api
tags: [convex, rag, graphrag, hybrid-search, tenant-isolation, vault]

# Dependency graph
requires:
  - phase: 05-knowledge-vault-graphrag (05-01/02)
    provides: "@pikar/vault fuse + GRAPH_HOP_CAP + VectorHit; vaultRag single rag instance"
  - phase: 05-knowledge-vault-graphrag (05-03)
    provides: "vaultGraph.expand (hop-capped tenant-scoped BFS) + upsertGraph"
  - phase: 05-knowledge-vault-graphrag (05-04)
    provides: "vault.ts ingest plane + vaultDocuments/graphNodes/graphEdges schema + internal.vault.getDoc"
provides:
  - "vaultGround({query}) — standalone hybrid vector + hop-capped graph grounding action (VALT-03)"
  - "vault read plane (VALT-04): listVaultDocs, vaultStats, vaultDownloadUrl, docEntities, vaultSearch"
  - "ownedDocsMeta — the tenant-scope resolve seam shared by grounding + search"
  - "VAULT_CATEGORIES runtime tuple (fixed-6 count) in @pikar/vault"
affects: [05-06 vault route UI, 05-07 phase close, Lane A cockpit/pipeline grounding call-site]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SMOKE:: offline seam for an action that would otherwise hit the embedding network (Pitfall 4)"
    - "one search primitive, two callers (vaultGround grounding + vaultSearch box) over rag.search hybrid"
    - "bearer-capability signed URL returned ONLY from a tenant-guarded query, never logged (§4)"

key-files:
  created:
    - packages/backend/convex/vaultGround.ts
    - packages/backend/convex/vaultGround.test.ts
  modified:
    - packages/backend/convex/vault.ts
    - packages/vault/src/categories.ts
    - packages/vault/src/index.ts
    - docs/playbooks/vault.md

key-decisions:
  - "SMOKE:: seed doc ids ride in the query and resolve THROUGH the tenant-scoped ownedDocsMeta, so the offline path enforces the SAME cross-tenant isolation namespace=tenantId gives the live path"
  - "vaultGround returns @pikar/vault's FusionResult ({docIds, context}) verbatim rather than the Pattern-4 pseudocode return shape — fuse is the single ranking contract"
  - "VAULT_CATEGORIES runtime tuple added to @pikar/vault as the single source for the fixed-6 count (vaultStats.categories + later UI tabs)"

patterns-established:
  - "ownedDocsMeta: a tenant-scope resolve seam reused by grounding + search (drop cross-tenant/missing ids silently, mirroring vector namespace scoping)"

requirements-completed: [VALT-03, VALT-04]

# Metrics
duration: 9min
completed: 2026-07-14
---

# Phase 5 Plan 05: Vault Read Plane (GraphRAG grounding + browse/search) Summary

**`vaultGround` hybrid retrieval (rag.search hybrid seeds → doc-id map → hop-capped graph expand → fuse, tenant-scoped) plus the cheap browse/stats/download/detail/category-search read surfaces the vault UI consumes.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-14T16:34:50Z
- **Completed:** 2026-07-14T16:43:55Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `vaultGround({query})` (VALT-03): `rag.search` hybrid seeds → map each seed entry to its `vaultDocuments` id → `internal.vaultGraph.expand` (hop-cap 2) → `fuse` merge/dedupe/rank into one context block; `namespace=tenantId` + the tenant-scoped `expand` mean a different tenant's corpus never enters a result.
- Offline `SMOKE::<docId,…>` seam that bypasses the embedding network yet still enforces tenant isolation by resolving seeds through the new `ownedDocsMeta` internal query.
- Vault read plane (VALT-04): `listVaultDocs` (+ category filter), `vaultStats` (totalFiles / processed=ready / storageUsedBytes / categories=6), `vaultDownloadUrl` (owner-only signed URL, null cross-tenant/no-bytes, never logged §4), `docEntities` (owner-guarded per-doc nodes+edges), `vaultSearch` (the same `rag.search` hybrid primitive post-filtered to the active category tab).
- `@pikar/vault` gains the `VAULT_CATEGORIES` runtime tuple (single source for the fixed-6 count).

## Task Commits

1. **Test (RED): read-plane tests** - `06461c7` (test) — SMOKE fusion + hop-cap + cross-tenant + browse/stats/download/docEntities/search coverage (9 tests, failing).
2. **Task 1: vaultGround grounding action** - `26a9379` (feat) — `vaultGround.ts` + `ownedDocsMeta` seam.
3. **Task 2: vault read plane** - `b85ab77` (feat) — `listVaultDocs`/`vaultStats`/`vaultDownloadUrl`/`docEntities`/`vaultSearch` + `VAULT_CATEGORIES` + playbook §9 bump.

_TDD: RED test commit first, then the two feat (GREEN) commits._

## Files Created/Modified
- `packages/backend/convex/vaultGround.ts` - the standalone hybrid grounding action + SMOKE seam.
- `packages/backend/convex/vaultGround.test.ts` - 9 convex-test cases (grounding fusion + read plane).
- `packages/backend/convex/vault.ts` - added the read plane + `ownedDocsMeta`.
- `packages/vault/src/categories.ts` / `index.ts` - `VAULT_CATEGORIES` runtime tuple + re-export.
- `docs/playbooks/vault.md` - Last verified → 05-05; read-plane key-files + verify command.

## Decisions Made
- **SMOKE seeds resolve tenant-scoped:** rather than trusting the sentinel's doc ids, the offline path runs them through `ownedDocsMeta` so the cross-tenant test proves real isolation (not a test-only shortcut).
- **Return `fuse`'s FusionResult verbatim** (`{docIds: string[], context: string[]}`) — Pattern 4's `{context: string, docIds: Id[]}` was pseudocode; `fuse` is the one ranking/merge contract (§1 domain logic stays in `@pikar/vault`).
- **`VAULT_CATEGORIES` in `@pikar/vault`** — the fixed-6 count is a domain fact; kept out of the adapter (single source, reused by the later UI tabs).

## Deviations from Plan

None - plan executed exactly as written. (`ownedDocsMeta` and `VAULT_CATEGORIES` are the plan's own "one surface, two callers" + "CATEGORIES = 6 const" made concrete — not scope additions.)

## Issues Encountered
- Offline codegen unavailable (same as 05-03/05-04): hand-edited the git-ignored `convex/_generated/api.d.ts` to register the new `vaultGround` module (`typeof vaultGround`). NOT committed (§7). Runtime `api`/`internal` are `anyApi` proxies, so convex-test resolves the new functions regardless; only tsc needed the entry.

## Self-Check: PASSED

- Files verified on disk: `vaultGround.ts`, `vaultGround.test.ts`, `vault.ts`, `categories.ts`, `vault.md`, `05-05-SUMMARY.md` — all FOUND.
- Commits verified: `06461c7` (test), `26a9379` (feat Task 1), `b85ab77` (feat Task 2) — all FOUND.
- Tests: `pnpm --filter @pikar/backend test vault vaultGround` → 25/25 passed; `@pikar/vault` 19/19 passed.
- Typecheck: no errors in `vaultGround.ts`/`vault.ts`/`vaultGround.test.ts` (the 21 remaining are pre-existing `.test.ts` narrows, unchanged). `check-playbooks.mjs` exit 0.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Read plane ready for **05-06** (the `/dashboard/vault` route): `listVaultDocs`/`vaultStats`/`vaultDownloadUrl`/`docEntities`/`vaultSearch` are the exact queries/actions the browse UI + search box + detail panel + download link consume.
- `vaultGround` is standalone + in-lane verified; its cockpit/pipeline call-site remains DEFERRED (Lane A).
- Live `smoke:vault` (real embed/search over a seeded corpus) remains a later-plan gate — the offline SMOKE path covers the graph-expand + fuse + isolation logic without a network call.

---
*Phase: 05-knowledge-vault-graphrag*
*Completed: 2026-07-14*
