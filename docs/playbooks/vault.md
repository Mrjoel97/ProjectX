# Playbook: Knowledge Vault & GraphRAG

> Last verified: 05-01 against the Phase-5 Lane-C vault foundation
> Build history: `.planning/phases/05-knowledge-vault-graphrag/` · Related ADRs: [001](../decisions/001-convex-data-orchestration-plane.md), [003](../decisions/003-skill-registry-for-prompts.md)

## Purpose

A per-user **Knowledge Vault** with **GraphRAG** grounding (VALT-01..04). Briefs/documents are
stored, embedded, and entity/relationship-extracted at ingestion; requests can be grounded via
**hybrid vector + hop-capped graph retrieval** scoped to the requesting user; and the user can
browse, preview, search, and download their own vault contents through the committed brand UI
(`docs/design/brand/brand-024242.png` / `brand-024258.png`). Built on the installed
`@convex-dev/rag@0.7.5` (vector + hybrid search) + `@convex-dev/workflow` durable ingest + a
bespoke Convex graph plane (`graphNodes`/`graphEdges`), with domain logic in the pure-TS
`@pikar/vault` package.

## Key files

Pure packages:
- `packages/vault/src/normalize.ts` — `normalizeName` (case/whitespace collapse → cross-doc dedup key).
- `packages/vault/src/categories.ts` — `categoryFor(source, mimeType)` (→ one of 6 vault categories), `isSearchable(mimeType)` (Phase-5 searchable set TXT/MD/CSV).
- `packages/vault/src/traversal.ts` — `bfsNeighbors(adjacency, seeds, hopCap)` (pure hop-capped BFS, no Convex import).
- `packages/vault/src/fusion.ts` — `fuse(...)` vector-seed + graph-expand merge/dedupe/rank.
- `packages/vault/src/constants.ts` — `VAULT_FILE_CAP_BYTES`, `GRAPH_HOP_CAP` (= 2).
- `packages/vault/src/index.ts` — re-exports the package surface.

Backend adapters (thin, added by later Phase-5 plans):
- `packages/backend/convex/vault.ts` / `vaultRag.ts` / `vaultIngest.ts` / `vaultGraph.ts` / `vaultGround.ts` — thin Convex orchestration over `@pikar/vault` + rag + workflow.
- `packages/backend/convex/vaultLlm.ts` — the DEFAULT-runtime (V8) graph-extractor call (NEVER a second `"use node"` module).

Frontend (later plans):
- `apps/web/app/(app)/dashboard/vault/` — the Knowledge Vault route + components (match the brand screenshots 1:1).

## Dependencies & blast radius

Run `graphify query "vault"` for the current subgraph. Couplings graphify cannot see:
- `@convex-dev/rag@0.7.5` (pinned, §6) — `namespace = tenantId` per-user isolation (VALT-03).
- `@convex-dev/workflow@0.4.4` (pinned, §6) — durable `store → embed → extract → ready` ingest.
- `convex/lib/functions.ts` tenant wrappers (§2), `convex/lib/hash.ts` `contentHash` dedup, `convex/guardrails.ts` + `@convex-dev/rate-limiter` + `packages/cost` (governance), `packages/pii` `scanText` (redaction).
- The `graph-extractor` registry skill (§5) — versioned skill row, no hardcoded prompt.

## Data flow

1. Ingest mutation writes a `vaultDocuments` row `status:'processing'` + stores text (raw content lives ONLY here + rag chunks — the tenant-scoped content plane, NOT the §4 honeypot).
2. `@convex-dev/workflow` runs `store → embed → extract → ready`: `pii.scanText` (fail-closed) → embed `safeText` via rag → `vaultLlm` graph-extractor emits typed entities/relationships → upsert `graphNodes`/`graphEdges`.
3. Grounding: `vaultGround({query})` → rag vector search (top-K seed chunks) → map to graph nodes → `bfsNeighbors` hop-capped expansion → `fuse` merge/dedupe/rank → one grounding context block.
4. Delete cascades: remove the row + rag chunks + `graphEdges` with `sourceDocId = doc`; nodes whose `degree` hits 0 are garbage-collected.

## Invariants — what must never break

- **Domain logic in `@pikar/vault`, thin `convex/vault*` adapters (§1)** — the pure package has ZERO Convex imports; enforced by the colocated `packages/vault` tests running with no backend.
- **`namespace = tenantId` per-user isolation (VALT-03)** — every rag `add/search/delete` is namespaced by the tenant; reads/writes go through the `tenantQuery/tenantMutation/tenantAction` wrappers.
- **rag runtime split** — `rag.add/search/delete` are ACTION-only; `addAsync/deleteAsync/list/getEntry/findEntryByContentHash` are mutation/query-safe.
- **The graph-extractor lives in a DEFAULT-runtime (V8) `vaultLlm.ts`** — NEVER a second `"use node"` module.
- **Redact-then-extract (§4)** — the extractor receives `safeText`; graph/audit/deadLetter payloads carry refs + hashes + counts ONLY. Raw text lives ONLY in `vaultDocuments.text` + rag chunks.
- **Cross-doc dedup** — same entity across docs upserts to ONE node on `(tenantId, type, normalizedName)` via `normalizeName`, so the graph actually connects documents.
- **Hop cap = 2 (`GRAPH_HOP_CAP`)** — `bfsNeighbors` never expands past the cap; enforced by `traversal.test.ts`.
- **Pinned `rag`/`workflow` versions must not be bumped (§6)** — pre-1.0 API churn.

## How to change safely

- **New graph traversal / fusion behavior** → change `@pikar/vault`, add a colocated test, keep it Convex-free. The Convex `vaultGraph.expand` query builds the adjacency and calls `bfsNeighbors`; `vaultGround` calls `fuse`.
- **New category / searchable format** → edit `categories.ts` + its test; do NOT scatter category strings into adapters.
- **New ingest step** → add a durable workflow step; keep the redact-before-LLM ordering.
- **Schema change** → new tables / optional fields, no migration (prior-phase discipline).

## How to verify

- `pnpm --filter @pikar/vault test` — pure-domain tests (normalize, categories, traversal, fusion).
- `pnpm --filter @pikar/vault typecheck` — clean.
- `pnpm --filter @pikar/backend test vault` — the Convex adapter tests (later plans).
- `smoke:vault` — the live-deployment ingest→ground phase gate (later plans).
- The Playwright vault spec — the browse/search/preview/download UI (later plans).

## Operational notes

- Embedding model `text-embedding-3-small` @ 1536 dims (under Convex's 2048 cap).
- Per-file cap `VAULT_FILE_CAP_BYTES`; no per-tenant total quota this phase (single-owner beta).
- Phase-5 wires TXT/MD/CSV + Brain Dumps end-to-end; PDF/DOCX/XLSX/PPTX/Images are accept-but-defer (stored + `pending extraction`), their text arriving via the `vaultIngestText` seam when Phase 4 lands.

## Known gaps & deferred work

- The `vaultGround` cockpit/pipeline call-site is deferred (Lane A integration phase).
- Binary + OCR extraction is Lane B / Phase 4 (`vaultIngestText(docId, extractedText)` seam).
- Per-tenant storage quota, external sharing, per-item agent toggle, in-place re-embed editing — all deferred.
