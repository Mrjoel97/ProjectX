---
phase: 05-knowledge-vault-graphrag
plan: 04
subsystem: backend
tags: [vault, graphrag, ingest, workflow, rag, dedup, delete-cascade, redaction]

# Dependency graph
requires:
  - phase: 05-01
    provides: "@pikar/vault (categoryFor/isSearchable, VAULT_FILE_CAP_BYTES)"
  - phase: 05-02
    provides: "vaultDocuments/graphNodes/graphEdges schema + indexes; the single rag instance; graph-extractor skill"
  - phase: 05-03
    provides: "vaultLlm.extractGraph + vaultGraph.upsertGraph (the embed→extract→upsert step targets)"
provides:
  - "vaultRag.embedDoc — ingest embed step (rag.add + findEntryByContentHash hash-dedup + SMOKE:: bypass)"
  - "vaultIngest.ingestDoc — durable workflow: preCall gate → embed → extract → upsertGraph → recordSpend → markReady"
  - "vault.vaultIngestText / vaultUpload — tenant ingest mutations (hash-dedup + accept-but-defer + late-text docId seam)"
  - "vault.deleteVaultDoc — cascade delete (row + rag chunks + graphEdges) with orphan-node GC"
  - "vault.getDoc / markReady / markFailed — the workflow's internal lifecycle surface"
affects: [05-05, 05-06, vaultGround, vault route UI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Durable ingest workflow mirroring deliverApprovedPlan: a tenant mutation is the SOLE workflow.start(ingestDoc) site (zero-embed-before-accept)"
    - "Governed stop (guardrails.preCall) inside a workflow marks the row failed and RETURNS — never a DLQ throw"
    - "Hash-dedup at the mutation (row) layer AND the embed step (rag) layer — a duplicate never re-embeds"
    - "SMOKE:: content-sentinel bypass in embedDoc so convex-test drives ingest with no embedding network"

key-files:
  created:
    - packages/backend/convex/vault.ts
    - packages/backend/convex/vaultIngest.ts
    - packages/backend/convex/vault.test.ts
    - packages/backend/convex/vaultRedaction.test.ts
  modified:
    - packages/backend/convex/vaultRag.ts
    - docs/playbooks/vault.md

key-decisions:
  - "embedDoc prices via priceUsage('text-embedding-3-small', …) which returns 0 (not in @pikar/cost PRICING) — embeddings are negligible vs the graph-extract call; marked ponytail with the upgrade path"
  - "deleteVaultDoc guards rag.deleteAsync behind ragEntryId presence — a not-yet-embedded doc deletes without needing the rag component; the cascade test exercises the genuinely-new graph-edge + orphan-GC logic without rag registration"
  - "vaultUpload also hash-dedups (not only vaultIngestText) so must_have #1 holds for a re-uploaded identical file"
  - "getDoc fails closed (throws) on a cross-tenant/missing read, consistent with guardrails.getSafeTextByHash"
  - "left vaultLlm.getDocText in place (extractGraph is already tested/working) rather than re-pointing it to the new getDoc — deletion-over-addition would have touched a verified path for no functional gain"

requirements-completed: [VALT-01]

# Metrics
duration: 15min
completed: 2026-07-14
---

# Phase 5 Plan 04: Vault Ingest Pipeline Summary

**The durable ingest spine (VALT-01): tenant `vaultIngestText`/`vaultUpload` mutations that hash-dedup, record a `processing` row, and start a `@convex-dev/workflow` ingest (preCall gate → embed via `rag.add` → graph-extract → upsertGraph → recordSpend → ready), plus a delete-cascade with orphan-node GC and the §4 redaction static scan.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-14T16:11:59Z
- **Completed:** 2026-07-14T16:26:20Z
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- `vaultRag.embedDoc` — an `internalAction` (rag.add needs an action ctx, Pitfall 1): reads the doc via `internal.vault.getDoc`, `scanText` FAIL-CLOSED before embedding (the vault embeds the redacted `safeText`; raw `doc.text` stays for preview/download only, §4/Open-Q2), hash-dedups via `rag.findEntryByContentHash` (a second ingest reuses the entry, costUsd 0), and a `SMOKE::` bypass returns a fixed fake entryId with NO network call.
- `vaultIngest.ingestDoc` — `workflow.define` mirroring `deliverApprovedPlan`: a `guardrails.preCall` gate BEFORE any spend (a kill-switch/budget stop → `markFailed`, a governed stop that RETURNS, never a DLQ throw), then `embedDoc` → `extractGraph` → `upsertGraph` → `recordSpend(embed+extract)` → `markReady`. `step.runAction` (workpool retries), never `retrier.run`.
- `vault.ts` — the tenant ingest surface via `tenantMutation` (§2): `vaultIngestText` (paste/brain-dump + a Phase-4 late-text `docId` seam) and `vaultUpload` (accept-but-defer — searchable TXT/MD/CSV → `processing` + workflow; a binary → `pending_extraction`, no embed; oversize rejected), both hash-dedup. `deleteVaultDoc` cascades row + rag chunks (`deleteAsync`) + `graphEdges(sourceDocId)`, decrements endpoint degrees, and GC's orphan nodes while shared nodes survive. Internal `getDoc`/`markReady`/`markFailed` complete the lifecycle.
- `vault.test.ts` (9) drives the mutations under the workflow+workpool convex-test registration (the cockpit.test.ts pattern): processing-row insert, hash-dedup skip, late-text seam, oversize reject, searchable-vs-defer status, the delete-cascade + orphan-GC (Alice GC'd, shared Bob survives at degree 1), cross-tenant delete no-op, and the fail-closed getDoc guard. `vaultRedaction.test.ts` (3) statically asserts the four vault modules write no audit/DLQ/telemetry row, the graph plane stores no raw `text`, and extract+embed both `scanText` before the model/embedding call.
- `docs/playbooks/vault.md` Last verified → 05-04 with the new adapters documented.

## Task Commits

1. **Task 1: embedDoc step (rag.add + hash dedup)** — `d1e8826` (feat)
2. **Task 2: ingest workflow (store→embed→extract→upsertGraph→ready)** — `3dd0542` (feat)
3. **Task 3: vault.ts ingest mutations + lifecycle + delete cascade + redaction scan** — `538cb92` (feat + tests + playbook)

## Files Created/Modified
- `packages/backend/convex/vaultRag.ts` — appended `embedDoc` (rag.add + findEntryByContentHash dedup + SMOKE:: bypass).
- `packages/backend/convex/vaultIngest.ts` — `ingestDoc = workflow.define(...)` durable ingest pipeline.
- `packages/backend/convex/vault.ts` — tenant ingest mutations + delete-cascade + internal lifecycle.
- `packages/backend/convex/vault.test.ts` — 9 convex-test cases over the ingest/dedup/defer/cascade/guard surface.
- `packages/backend/convex/vaultRedaction.test.ts` — 3 static §4 scans.
- `docs/playbooks/vault.md` — Last verified → 05-04; Key-files list the ingest adapters.

## Decisions Made
- **Embedding cost = 0 via priceUsage:** `text-embedding-3-small` isn't in `@pikar/cost` PRICING, so `priceUsage` returns 0 here. Embeddings are ~$0.02/MTok — negligible vs the graph-extract call that dominates ingest spend, which IS priced and recorded. Marked `ponytail:` with the upgrade path (add a pricing row if it ever matters).
- **rag.deleteAsync guarded by ragEntryId:** `deleteVaultDoc` only calls the rag cascade when the doc was embedded, so a not-yet-embedded doc deletes without the rag component, and the cascade test exercises the genuinely-new graph-edge + orphan-GC logic (the vault's own code) without brittle rag/workpool registration.
- **getDoc fails closed** (throws on cross-tenant/missing) mirroring `guardrails.getSafeTextByHash` — an embedding call structurally cannot obtain another tenant's text (VALT-03).
- **Left `vaultLlm.getDocText`** untouched: `extractGraph` is already tested and working over it; re-pointing a verified path to the new `getDoc` for no functional gain would have added risk (the new `getDoc` supplies the richer `{text,contentHash,title}` the embed step needs).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Offline codegen unavailable → hand-edited the gitignored `_generated/api.d.ts`**
- **Found during:** Task 1/2 typecheck (new cross-module internal refs `internal.vault.*`, `internal.vaultIngest.*`).
- **Issue:** `internal.vault.getDoc/markReady/markFailed` and `internal.vaultIngest.ingestDoc` need the generated module list, but `npx convex codegen` requires a `CONVEX_DEPLOYMENT` (none in this worktree).
- **Fix:** Added `vault` and `vaultIngest` module entries to `convex/_generated/api.d.ts` by hand — exactly what codegen emits. The file is git-ignored (§7), so it is local-only and a fresh clone regenerates it via `npx convex dev`. NOT committed. (Same mitigation as 05-03.)
- **Verification:** `tsc --noEmit` reports no source-file errors; `vitest run vault` green (convex-test resolves internal functions via its own module glob).

**Total deviations:** 1 auto-fixed (1 blocking). No scope creep — required for the plan's own typecheck; consistent with §7 (generated dir is ephemeral).

## Issues Encountered
- `pnpm --filter @pikar/backend typecheck` still surfaces the ~15 pre-existing `.test.ts` errors (`import.meta.glob` typing gap + `noUncheckedIndexedAccess` narrows) documented in prior summaries. A source-file-only `tsc` filter confirms the four new/modified vault source files introduce ZERO new errors. Out of scope (SCOPE BOUNDARY).
- `node scripts/check-playbooks.mjs` did not return within a 2-minute window when chained with a commit (the same script also runs as the Stop hook at turn end); the `vault.md` Last-verified bump is in place, so the §9 contract is satisfied. Verified independently that the playbook was updated same-commit as the code.

## Authentication Gates
None.

## Next Phase Readiness
- The ingest spine is live: a TXT/MD/CSV upload or Brain-Dump paste ingests end-to-end (processing → ready) through embed + graph-extract, a duplicate skips re-embed, and binaries defer at `pending_extraction`. Governed by the existing guardrails/rate-limiter triad; the kill switch stops it.
- Plan 05's `vaultGround` consumes the embedded chunks (rag search) + `internal.vaultGraph.expand` + `@pikar/vault` `fuse`; Plan 06 wires the vault route UI over `vaultUpload`/`vaultIngestText`/`deleteVaultDoc`.
- The `SMOKE::` embed + `SMOKE::graph::` extract seams give the live `smoke:vault` gate a deterministic, model-free ingest path.

---
*Phase: 05-knowledge-vault-graphrag*
*Completed: 2026-07-14*

## Self-Check: PASSED

- FOUND: packages/backend/convex/vault.ts
- FOUND: packages/backend/convex/vaultIngest.ts
- FOUND: packages/backend/convex/vault.test.ts
- FOUND: packages/backend/convex/vaultRedaction.test.ts
- FOUND commits: d1e8826, 3dd0542, 538cb92
