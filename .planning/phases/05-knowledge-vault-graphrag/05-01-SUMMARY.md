---
phase: 05-knowledge-vault-graphrag
plan: 01
subsystem: infra
tags: [vault, graphrag, pure-package, bfs, hybrid-retrieval, playbook]

# Dependency graph
requires:
  - phase: 03.3-attachment-generation
    provides: PLAN_ATTACHMENT_CAP_BYTES pattern (mirrored by VAULT_FILE_CAP_BYTES); §9 playbook+watch.json discipline
provides:
  - "@pikar/vault pure-TS domain package: normalizeName, bfsNeighbors, fuse, categoryFor/isSearchable, VAULT_FILE_CAP_BYTES/GRAPH_HOP_CAP"
  - "docs/playbooks/vault.md + watch.json registration covering every future vault path prefix (§9)"
affects: [vault ingest adapters, vaultGraph.expand, vaultGround, vault route UI, graph-extractor skill]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-TS domain package with zero Convex imports (CLAUDE.md §1) mirroring @pikar/pii shape"
    - "Playbook-first registration so §9 Stop hook never blocks later plans creating convex/vault*.ts"

key-files:
  created:
    - packages/vault/package.json
    - packages/vault/src/constants.ts
    - packages/vault/src/normalize.ts
    - packages/vault/src/categories.ts
    - packages/vault/src/traversal.ts
    - packages/vault/src/fusion.ts
    - packages/vault/src/index.ts
    - docs/playbooks/vault.md
  modified:
    - docs/playbooks/watch.json

key-decisions:
  - "categoryFor takes an object arg { source, mimeType } (per the plan's behavior examples), with image/video mimeType winning over source"
  - "fuse folds seedDocIds defensively into the seen-set so a vector seed never resurfaces as a graph-only neighbor; context is a thin identity join (ponytail ceiling) until vaultGround supplies chunk text"

patterns-established:
  - "Pure vault domain logic lives in @pikar/vault; convex/vault* adapters (later plans) stay thin"
  - "Hop-capped, cycle-safe BFS over an in-memory Map<nodeId, nodeId[]> adjacency"

requirements-completed: [VALT-02, VALT-03]

# Metrics
duration: 6min
completed: 2026-07-14
---

# Phase 5 Plan 01: Vault Foundation Summary

**The pure-TS `@pikar/vault` package (name normalization, hop-capped BFS traversal, vector+graph fusion, category mapping, file/hop-cap constants) plus the `vault.md` playbook registered in `watch.json` so every later vault file is §9-covered.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-14T15:29:59Z
- **Completed:** 2026-07-14T15:36:09Z
- **Tasks:** 3
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments
- `@pikar/vault` pure package with zero Convex imports: `normalizeName` (cross-doc dedup key), `bfsNeighbors` (hop-capped, cycle-safe BFS), `fuse` (deterministic vector-seed + graph-expand merge/dedupe/rank), `categoryFor`/`isSearchable` (6-category auto-assign + TXT/MD/CSV searchable set), `VAULT_FILE_CAP_BYTES` (8 MiB) + `GRAPH_HOP_CAP` (2).
- `docs/playbooks/vault.md` authored from TEMPLATE with real invariants (namespace=tenantId isolation, DEFAULT-runtime extractor, redact-then-extract, cross-doc dedup, hop cap = 2, pinned rag/workflow versions).
- `watch.json` gains an append-only `vault.md` key registering all vault prefixes (`packages/vault/`, `convex/vault*.ts`, the vault route, the smoke script) so subsequent plans do not trip the §9 Stop hook.
- 19 colocated tests green; `pnpm --filter @pikar/vault typecheck` clean; `check-playbooks` exits 0.

## Task Commits

Each task committed atomically (TDD tasks split test → feat):

1. **Task 1: vault playbook + watch.json registration** - `327f222` (docs)
2. **Task 2: scaffold @pikar/vault + normalize + categories + constants** - `49cfc21` (test RED) → `05b00cc` (feat GREEN)
3. **Task 3: hop-capped BFS traversal + vector/graph fusion** - `1d252a6` (test RED) → `4bc8e47` (feat GREEN)

## Files Created/Modified
- `packages/vault/package.json` - pure ESM vitest workspace package (mirrors @pikar/pii, no Convex dep)
- `packages/vault/tsconfig.json` - extends the base tsconfig
- `packages/vault/src/constants.ts` - `VAULT_FILE_CAP_BYTES` (8 MiB), `GRAPH_HOP_CAP` (2)
- `packages/vault/src/normalize.ts` - `normalizeName` lowercase/trim/collapse-whitespace dedup key
- `packages/vault/src/categories.ts` - `categoryFor`, `isSearchable`, `VaultCategory`/`VaultSource` types
- `packages/vault/src/traversal.ts` - `bfsNeighbors` hop-capped cycle-safe BFS
- `packages/vault/src/fusion.ts` - `fuse` merge/dedupe/rank + `VectorHit`/`FusionResult` types
- `packages/vault/src/index.ts` - re-exports the package surface
- `packages/vault/src/*.test.ts` - 19 colocated tests (normalize, categories, traversal, fusion)
- `docs/playbooks/vault.md` - the Knowledge Vault & GraphRAG subsystem playbook
- `docs/playbooks/watch.json` - appended `vault.md` key with every vault path prefix

## Decisions Made
- `categoryFor` accepts an object `{ source, mimeType }` (the plan's concrete behavior examples use object args) rather than positional `(source, mimeType)`; `image/*`/`video/*` mimeType wins over source per CONTEXT.
- `fuse` returns `{ docIds, context }` with `context` as a thin identity join for now (marked `ponytail:` — `vaultGround` in Plan 05 hydrates real chunk text); ranking is vector score desc with a docId tiebreak for full determinism.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `@pikar/vault` is ready to be imported by the Convex vault adapters (Plan 03 `vaultGraph.expand` builds the adjacency and calls `bfsNeighbors`; Plan 05 `vaultGround` calls `fuse`).
- The §9 hook is pre-cleared for every vault path, so later plans creating `convex/vault*.ts` and the vault route will not be blocked.

## Self-Check: PASSED

All 7 created files present, `vault.md` key present in `watch.json`, all 5 task commits found in git history.

---
*Phase: 05-knowledge-vault-graphrag*
*Completed: 2026-07-14*
