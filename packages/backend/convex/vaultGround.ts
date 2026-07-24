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
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { tenantAction } from "./lib/functions";
import { rag } from "./vaultRag";

const SMOKE_PREFIX = "SMOKE::";

// Hydration budget (Claude's-discretion from 10-CONTEXT): cap each doc's chunk so one large doc
// can't swamp the loop, and cap the total so a big fused corpus never blows the agent context.
const PER_DOC_CHAR_CAP = 1500;
const TOTAL_CHAR_CAP = 8000;

// The retrieval engine, tenant read from an EXPLICIT `tenantId` param (not ctx.auth). Both the
// public tenantAction (ctx.tenantId) and the identity-less internalAction (its tenantId arg) call
// this — retrieval/ranking/SMOKE:: seam are shared verbatim, zero duplication (ponytail rung 2).
async function runVaultGround(
  ctx: GenericActionCtx<DataModel>,
  tenantId: string,
  query: string,
): Promise<{ docIds: string[]; context: string[] }> {
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
      tenantId,
      docIds: candidateIds,
    });
    seedDocIds = owned.map((d) => d._id);
    hits = seedDocIds.map((docId, i) => ({ docId, score: 1 - i * 0.01 }));
  } else {
    const { results, entries } = await rag.search(ctx, {
      namespace: tenantId, // per-user scope (VALT-03)
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
    tenantId,
    seedDocIds,
    hopCap: GRAPH_HOP_CAP,
  });

  // Merge vector seeds with graph neighbors → one deduped, ranked context block (@pikar/vault).
  return fuse(hits, seedDocIds, neighborDocIds);
}

export const vaultGround = tenantAction({
  args: { query: v.string() },
  handler: (ctx, { query }): Promise<{ docIds: string[]; context: string[] }> =>
    runVaultGround(ctx, ctx.tenantId, query),
});

// The HYDRATED grounding surface for the identity-less cockpit tool loop (Plan 02 calls this as
// `internal.vaultGround.vaultGroundHydrated`). tenantId is an EXPLICIT arg — the gmail.search /
// llm.digestInbox convention — because the tool loop and eval harnesses carry no live identity.
// Returns three PARALLEL arrays: docIds, titles (via tenant-scoped ownedDocsMeta), and capped
// chunk text (via getDoc). Text is returned into the LOOP only — never into any audit/DLQ payload
// (§4; Plan 02's tool owns the refs-only `vault.searched` audit).
// ponytail: doc-level text, not chunk-precise — upgrade path is threading `rag.search` result
// `content` for the vector seeds and reserving `getDoc` for the graph neighbors only.
export const vaultGroundHydrated = internalAction({
  args: { tenantId: v.string(), query: v.string() },
  handler: async (
    ctx,
    { tenantId, query },
  ): Promise<{ docIds: string[]; titles: string[]; chunks: string[] }> => {
    const { docIds } = await runVaultGround(ctx, tenantId, query);

    // Titles: one tenant-scoped batch read; map _id → title so titles stay parallel to docIds.
    const meta = await ctx.runQuery(internal.vault.ownedDocsMeta, {
      tenantId,
      docIds: docIds as Id<"vaultDocuments">[],
    });
    const titleById = new Map(meta.map((m) => [m._id as string, m.title]));

    // Chunks: per-doc + running-total char budget so a large corpus never blows the loop context.
    const titles: string[] = [];
    const chunks: string[] = [];
    let used = 0;
    for (const docId of docIds) {
      titles.push(titleById.get(docId) ?? "");
      const remaining = TOTAL_CHAR_CAP - used;
      if (remaining <= 0) {
        chunks.push("");
        continue;
      }
      const { text } = await ctx.runQuery(internal.vault.getDoc, {
        vaultDocId: docId as Id<"vaultDocuments">,
        tenantId,
      });
      const slice = text.slice(0, Math.min(PER_DOC_CHAR_CAP, remaining));
      chunks.push(slice);
      used += slice.length;
    }

    return { docIds, titles, chunks };
  },
});
