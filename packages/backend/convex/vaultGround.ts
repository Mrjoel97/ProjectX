// The knowledge-vault GROUNDING action (VALT-03) — a thin adapter (§1) over `rag.search` (hybrid
// vector + full-text) + the pure `@pikar/vault` `fuse` and the tenant-scoped graph `expand`.
//
// vaultGround({query}) is the STANDALONE grounding surface (its cockpit/pipeline call-site is
// DEFERRED — Lane A). One turn: hybrid search seeds the top-K chunks → map each seed entry to its
// `vaultDocuments` id → hop-capped (≤ GRAPH_HOP_CAP) graph expand → merge/dedupe/rank into one
// ordered context block. `rag.search` is action-only (Pitfall 1) — `tenantAction` is correct.
//
// TENANT ISOLATION (VALT-03): `namespace = ctx.tenantId` scopes the vector search AND `expand`
// filters every graph read by tenantId, so a different tenant's data never enters a result.
//
// OFFLINE SMOKE SEAM (Pitfall 4): a `SMOKE::<docId,docId,...>` query bypasses `rag.search` (no
// embedding network) and instead resolves the given seed doc ids THROUGH the tenant-scoped
// `ownedDocsMeta` — a cross-tenant seed resolves to nothing, mirroring how `namespace = tenantId`
// would never surface it. The graph-expand + fuse path is then exercised deterministically.
import { fuse, GRAPH_HOP_CAP, type VectorHit } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { tenantAction } from "./lib/functions";
import { rag } from "./vaultRag";

const SMOKE_PREFIX = "SMOKE::";

export const vaultGround = tenantAction({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<{ docIds: string[]; context: string[] }> => {
    let hits: VectorHit[];
    let seedDocIds: Id<"vaultDocuments">[];

    if (query.startsWith(SMOKE_PREFIX)) {
      // Offline: the seed doc ids ride in the sentinel; resolve them tenant-scoped (a cross-tenant
      // seed drops out exactly as namespace scoping would exclude it — no embedding call).
      const candidateIds = query
        .slice(SMOKE_PREFIX.length)
        .split(",")
        .filter(Boolean) as Id<"vaultDocuments">[];
      const owned = await ctx.runQuery(internal.vault.ownedDocsMeta, {
        tenantId: ctx.tenantId,
        docIds: candidateIds,
      });
      seedDocIds = owned.map((d) => d._id);
      hits = seedDocIds.map((docId, i) => ({ docId, score: 1 - i * 0.01 }));
    } else {
      const { results, entries } = await rag.search(ctx, {
        namespace: ctx.tenantId, // per-user scope (VALT-03)
        query,
        limit: 8,
        searchType: "hybrid", // RRF vector + full-text (rag 0.7.5)
        vectorScoreThreshold: 0.2, // drop weak matches
      });
      // Join each scored result back to its source doc via the entry metadata (doc-level mapping,
      // Open-Q3): entries carry `metadata.vaultDocId`, results carry the score, both keyed by entryId.
      const docByEntry = new Map<string, Id<"vaultDocuments">>();
      for (const e of entries) {
        const docId = e.metadata?.vaultDocId as Id<"vaultDocuments"> | undefined;
        if (docId) docByEntry.set(e.entryId, docId);
      }
      hits = [];
      seedDocIds = [];
      for (const r of results) {
        const docId = docByEntry.get(r.entryId);
        if (!docId) continue;
        hits.push({ docId, score: r.score });
        if (!seedDocIds.includes(docId)) seedDocIds.push(docId);
      }
    }

    // Hop-capped, tenant-scoped graph expansion → neighbor docs (pure BFS in @pikar/vault, §1).
    const neighborDocIds = await ctx.runQuery(internal.vaultGraph.expand, {
      tenantId: ctx.tenantId,
      seedDocIds,
      hopCap: GRAPH_HOP_CAP,
    });

    // Merge vector seeds with graph neighbors → one deduped, ranked context block (@pikar/vault).
    return fuse(hits, seedDocIds, neighborDocIds);
  },
});
