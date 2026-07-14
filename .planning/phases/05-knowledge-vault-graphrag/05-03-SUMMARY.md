---
phase: 05-knowledge-vault-graphrag
plan: 03
subsystem: backend
tags: [vault, graphrag, graph-extraction, dedup, bfs, convex, llm]

# Dependency graph
requires:
  - phase: 05-01
    provides: "@pikar/vault (normalizeName, bfsNeighbors, GRAPH_HOP_CAP)"
  - phase: 05-02
    provides: "graphNodes/graphEdges schema + indexes; graph-extractor registry skill; the single rag instance"
provides:
  - "vaultLlm.extractGraph — V8 internalAction: redact-then-extract, registry prompt, SMOKE::graph:: offline seam, typed {nodes,edges,costUsd}"
  - "vaultGraph.upsertGraph — cross-doc dedup on (tenantId, type, normalizedName) + degree bookkeeping"
  - "vaultGraph.expand — hop-capped, tenant-scoped BFS neighbor expansion over @pikar/vault bfsNeighbors"
  - "vaultLlm.getDocText — temporary doc-text reader seam (Plan 04's internal.vault.getDoc supersedes)"
affects: [05-04, 05-05, 05-06, vaultIngest, vaultGround]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DEFAULT-runtime (V8) generateObject action (NO second 'use node' module — Pitfall 3), inference-cliff-safe via explicit Promise<...> return types"
    - "Cross-doc entity dedup via upsert-on-normalizedName + a per-call name→nodeId resolution map for edge endpoints"
    - "Convex adapter builds the adjacency; pure BFS stays in @pikar/vault (§1)"

key-files:
  created:
    - packages/backend/convex/vaultLlm.ts
    - packages/backend/convex/vaultGraph.ts
    - packages/backend/convex/vaultGraph.test.ts
  modified:
    - docs/playbooks/vault.md

key-decisions:
  - "getDocText seam lives in vaultLlm.ts (not vaultGraph.ts) to keep Task 1 atomically typecheck-able before vaultGraph.ts exists; Plan 04's internal.vault.getDoc supersedes it"
  - "expand gathers all tenant edges via the by_tenant_fromNode index prefix (tenantId-only), builds an undirected adjacency, and resolves neighbor NODES back to their edges' sourceDocIds"

requirements-completed: [VALT-02]

# Metrics
duration: 6min
completed: 2026-07-14
---

# Phase 5 Plan 03: Graph Plane (extractGraph + vaultGraph) Summary

**The genuinely-new GraphRAG code: a V8 `extractGraph` action that redacts a doc's text then turns it into typed entities+relationships from the registry skill, and a `vaultGraph` adapter that upserts them with cross-doc dedup + degree bookkeeping and answers hop-capped, tenant-scoped neighbor expansion.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-14T15:57:23Z
- **Completed:** 2026-07-14T16:03:24Z
- **Tasks:** 2 (Task 2 TDD: RED → GREEN)
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- `vaultLlm.ts` — DEFAULT-runtime (V8) `extractGraph` internalAction, **no** `"use node"` (Pitfall 3), inference-cliff-safe via explicit `Promise<...>` return annotations. Loads the `graph-extractor` prompt from the registry (fails closed unseeded, §5), reads the doc text, `scanText` **fail-closed BEFORE** the model call (redact-then-extract, §4), and either returns a deterministic `SMOKE::graph::` fixture (NO model call — Pitfall 4) or runs `generateObject(DEFAULT_MODEL, graphSchema)`. Returns `{nodes, edges, costUsd}` carrying names/rels only — never raw text.
- `vaultGraph.ts` — `upsertGraph` (internalMutation): cross-doc dedup on `(tenantId, type, normalizedName)` via `normalizeName` + a per-call name→nodeId map so edge endpoints resolve; each edge inserts once and bumps **both** endpoints' `degree`. `expand` (internalQuery): seed docs → their nodes → `@pikar/vault` `bfsNeighbors` over an undirected, tenant-scoped adjacency → neighbor `sourceDocId`s, seed docs excluded.
- `vaultGraph.test.ts` — 4 convex-test cases (no rag/workflow registration needed): cross-doc dedup → ONE node w/ degree 2, case/whitespace name-variant dedup, hop-cap exclusion (Carol@1 & Dave@2 in, Eve@3 out at hopCap=2), and tenant scope (same-named "Bob" stays two separate nodes; expand never crosses tenants).
- `docs/playbooks/vault.md` Last verified → 05-03; `check-playbooks` exits 0.

## Task Commits

1. **Task 1: extractGraph V8 action** — `fbf203e` (feat)
2. **Task 2: vaultGraph upsert/expand** — `530a239` (test RED) → `e23a7e9` (feat GREEN + playbook)

## Files Created/Modified
- `packages/backend/convex/vaultLlm.ts` — V8 `extractGraph` + `getDocText` seam.
- `packages/backend/convex/vaultGraph.ts` — `upsertGraph` (dedup + degree) + `expand` (BFS).
- `packages/backend/convex/vaultGraph.test.ts` — dedup/degree/hop-cap/tenant-scope coverage.
- `docs/playbooks/vault.md` — Last verified → 05-03; Key-files now list the real graph-plane adapters.

## Decisions Made
- **`getDocText` home:** placed in `vaultLlm.ts` (referenced as `internal.vaultLlm.getDocText`) rather than `vaultGraph.ts`, so Task 1 typecheck-passes atomically before Task 2's file exists. The plan gave explicit latitude ("define a minimal local query"); Plan 04's `internal.vault.getDoc` is the canonical superseding seam.
- **`expand` adjacency:** all tenant edges are gathered via the `by_tenant_fromNode` index using a **tenantId-only** prefix (a Convex compound index supports a prefix scan), then an undirected `Map<nodeId, nodeId[]>` is built and handed to the pure `bfsNeighbors`. Neighbor nodes resolve back to docs through the same edge set.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Offline codegen unavailable → hand-edited the gitignored `_generated/api.d.ts`**
- **Found during:** Task 1 (typecheck)
- **Issue:** New cross-module internal refs (`internal.vaultLlm.*`, later `internal.vaultGraph.*`) need the generated `api.d.ts` module list, but `npx convex codegen` requires a `CONVEX_DEPLOYMENT` (no deployment in this worktree), so the types could not be regenerated.
- **Fix:** Added `vaultLlm`, `vaultGraph`, and the previously-missed `vaultRag` (05-02) to `convex/_generated/api.d.ts` by hand — exactly what codegen would emit. The file is **git-ignored** (CLAUDE.md §7), so the edit is local-only and a fresh clone regenerates it via `npx convex dev`. Not committed.
- **Files modified:** `packages/backend/convex/_generated/api.d.ts` (gitignored, uncommitted)
- **Verification:** `tsc --noEmit` reports no source-file errors; `vitest run vaultGraph` green (convex-test resolves internal functions via its own module glob, independent of `api.d.ts`).

**Total deviations:** 1 auto-fixed (1 blocking). No scope creep — required for the plan's own typecheck to resolve; consistent with §7 (generated dir is ephemeral).

## Issues Encountered
- `pnpm --filter @pikar/backend typecheck` still surfaces the ~15 pre-existing `.test.ts` errors (`import.meta.glob` typing gap + `noUncheckedIndexedAccess` narrows) documented in prior summaries. Verified via a source-file-only filter that no new source errors were introduced and `vaultGraph.test.ts` adds none. Out of scope (SCOPE BOUNDARY).

## Authentication Gates
None.

## Next Phase Readiness
- The graph plane is ready for the ingest wiring: Plan 04's durable workflow calls `internal.vaultLlm.extractGraph` then `internal.vaultGraph.upsertGraph`, and swaps `getDocText` for the canonical `internal.vault.getDoc`. Plan 05's `vaultGround` calls `internal.vaultGraph.expand` for hop-capped grounding + `@pikar/vault` `fuse`.
- The `SMOKE::graph::` seam gives the live `smoke:vault` gate (later plan) a deterministic, model-free extraction path.

---
*Phase: 05-knowledge-vault-graphrag*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: packages/backend/convex/vaultLlm.ts
- FOUND: packages/backend/convex/vaultGraph.ts
- FOUND: packages/backend/convex/vaultGraph.test.ts
- FOUND: .planning/phases/05-knowledge-vault-graphrag/05-03-SUMMARY.md
- FOUND commits: fbf203e, 530a239, e23a7e9
