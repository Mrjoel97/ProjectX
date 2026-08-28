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
): Promise<{ docIds: string[]; context: string[]; matchedByDoc: Record<string, string> }> {
  let hits: VectorHit[];
  let seedDocIds: Id<"vaultDocuments">[];
  // The ACTUAL matched passage per doc, keyed by docId. Without this a long document is hydrated
  // from its first characters (its title page), so the passage that matched is never read — a
  // 100-page PDF answered from page 1. Populated for vector seeds only; graph neighbours have no
  // matched chunk and still fall back to the doc-text slice.
  const matchedByDoc: Record<string, string> = {};

  if (query.startsWith(SMOKE_PREFIX)) {
    // Offline: the seed doc ids ride in the sentinel; resolve them tenant-scoped (a cross-tenant
    // seed drops out exactly as namespace scoping would exclude it — no embedding call).
    //
    // A seed may carry its MATCHED PASSAGE — `SMOKE::<docId>|<passage>` — and without that the
    // chunk-precise branch below was undrivable offline: every existing test took the doc-text
    // fallback, so nothing could tell a passage from a document and the `truncated` flag that rides
    // on the difference had a green suite over a wrong answer. The `|` half is optional and every
    // `SMOKE::<id>,<id>` sentinel keeps its exact meaning.
    const seeds = query
      .slice(SMOKE_PREFIX.length)
      .split(",")
      .filter(Boolean)
      .map((segment) => {
        const [id = "", passage] = segment.split("|");
        return { id: id as Id<"vaultDocuments">, passage };
      });
    const owned = await ctx.runQuery(internal.vault.ownedDocsMeta, {
      tenantId,
      docIds: seeds.map((seed) => seed.id),
    });
    seedDocIds = owned.map((d) => d._id);
    // Tenant-scoped by construction: a passage is attached only to a doc `ownedDocsMeta` returned.
    const ownedIds = new Set<string>(seedDocIds);
    for (const seed of seeds)
      if (seed.passage !== undefined && ownedIds.has(seed.id)) matchedByDoc[seed.id] = seed.passage;
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
      // Keep the matched passage(s). Several results can share one doc — concatenate in score
      // order so a long document contributes MULTIPLE relevant passages, not just its opening.
      const text = r.content
        .map((c) => c.text)
        .join("\n\n")
        .trim();
      if (!text) continue;
      matchedByDoc[docId] = matchedByDoc[docId] ? `${matchedByDoc[docId]}\n\n${text}` : text;
    }
  }

  // ── SEALING, half 1 of 2 (VALT-07) ─────────────────────────────────────────
  // A folder's members are excluded from retrieval until the folder is `complete`. The predicate
  // lives once in `vaultFolders.sealedIn`; here it is applied to the SEEDS, and deliberately BEFORE
  // `expand` — filtering after would still let a sealed document's entities pull unsealed
  // neighbours into the answer, which is the sealed folder steering the result without appearing
  // in it. `hits` is filtered too, not just `seedDocIds`: `fuse` builds its output from the hit
  // list, so dropping the seed alone would remove nothing.
  //
  // NOT filtered at `rag.search`: `vaultRag.ts` declares no `filterNames`, and a filter baked in at
  // embed time could not change when the folder unseals without re-embedding every member.
  //
  // ACCEPTED LIMITATION, and it is structural, not content: ingest step 4 (`upsertGraph`) writes a
  // sealed member's entities into the SHARED tenant graph, so a sealed folder still raises
  // `graphNodes.degree` (which feeds `blueprint.topEntities`) and can create an edge joining two
  // UNSEALED documents. No sealed text and no sealed doc id ever reaches a reader — the locked
  // decision says "excluded from retrieval", which this satisfies literally. Closing the metadata
  // half means deferring `upsertGraph` to folder completion, which breaks the per-document ingest
  // workflow; that is the upgrade path, not a bug fix.
  const sealedSeeds = new Set(
    await ctx.runQuery(internal.vaultFolders.sealedDocIds, { tenantId, docIds: seedDocIds }),
  );
  if (sealedSeeds.size > 0) {
    hits = hits.filter((h) => !sealedSeeds.has(h.docId as Id<"vaultDocuments">));
    seedDocIds = seedDocIds.filter((id) => !sealedSeeds.has(id));
  }

  // Hop-capped, tenant-scoped graph expansion → neighbor docs (pure BFS in @pikar/vault, §1).
  const neighborDocIds = await ctx.runQuery(internal.vaultGraph.expand, {
    tenantId,
    seedDocIds,
    hopCap: GRAPH_HOP_CAP,
  });

  // ── SEALING, half 2 of 2 ───────────────────────────────────────────────────
  // `vaultGraph.expand` resolves neighbours straight out of `graphEdges` with no status, origin or
  // folder filter of its own, so it is an INDEPENDENT leak path — a seeds-only filter cannot catch
  // it, and the sealing test that proves this is the one that goes red on a seeds-only fix.
  const sealedNeighbors = new Set(
    await ctx.runQuery(internal.vaultFolders.sealedDocIds, {
      tenantId,
      docIds: neighborDocIds as Id<"vaultDocuments">[],
    }),
  );

  // Merge vector seeds with graph neighbors → one deduped, ranked context block (@pikar/vault).
  return {
    ...fuse(
      hits,
      seedDocIds,
      neighborDocIds.filter((id) => !sealedNeighbors.has(id as Id<"vaultDocuments">)),
    ),
    matchedByDoc,
  };
}

export const vaultGround = tenantAction({
  args: { query: v.string() },
  // Public shape is UNCHANGED — matchedByDoc is an internal hydration detail; destructure so the
  // documented {docIds, context} contract (and its tests) stay byte-for-byte identical.
  handler: async (ctx, { query }): Promise<{ docIds: string[]; context: string[] }> => {
    const { docIds, context } = await runVaultGround(ctx, ctx.tenantId, query);
    return { docIds, context };
  },
});

// The HYDRATED grounding surface for the identity-less cockpit tool loop (Plan 02 calls this as
// `internal.vaultGround.vaultGroundHydrated`). tenantId is an EXPLICIT arg — the gmail.search /
// llm.digestInbox convention — because the tool loop and eval harnesses carry no live identity.
// Returns PARALLEL retrieval arrays — docIds, titles / origins / kinds / sourceUpdatedAt (all off
// one tenant-scoped ownedDocsMeta read) and capped chunk text (via getDoc) — plus a separate
// `spine` field for standing blueprint context.
// The spine is deliberately NOT entry 0: it is not a search result and must not alter no-match,
// result-count, source-card, or retrieval-budget behavior. Text is returned into the LOOP only —
// never into any audit/DLQ payload (§4; Plan 02's tool owns the refs-only `vault.searched` audit).
// CHUNK-PRECISE (2026-07-25): vector seeds hydrate from the `rag.search` result `content` — the
// passage that actually matched — and `getDoc` is reserved for graph neighbours + the SMOKE:: seam.
// This was the `ponytail:` upgrade path noted here; it is now taken. Before, every doc hydrated
// from its first PER_DOC_CHAR_CAP characters, so a long PDF was answered from its title page no
// matter where the match was (observed: a 300-page book grounded as its copyright notice).
export const vaultGroundHydrated = internalAction({
  args: { tenantId: v.string(), query: v.string() },
  handler: async (
    ctx,
    { tenantId, query },
  ): Promise<{
    docIds: string[];
    titles: string[];
    /** 26-11: parallel to docIds. "agent_promoted" ⇒ the AGENT wrote it and the owner promoted it,
     *  so a citation must not read as the owner's own word. LABELLING ONLY — no caller may use
     *  this to filter what is retrieved (the origin predicate is banned in retrieval). */
    origins: string[];
    /** 29-02: parallel to docIds. `vaultDocuments.kind`, so a `web_research` document cites as
     *  third-party research rather than as the tenant's own word (`authorityFor`, @pikar/core).
     *  LABELLING ONLY, exactly like `origins` — no caller may filter retrieval on it. */
    kinds: string[];
    /** 29-02: parallel to docIds. The only source-time the vault holds: the web-research fetch
     *  stamp when there is one, otherwise the row's creation time (a vault document has no
     *  provider modification time — it is the tenant's own copy, dated from when it arrived).
     *  Absent/0 is never treated as fresh downstream; `freshnessFor` reads a missing stamp as
     *  `unknown`. ADDITIVE — the four production callers destructure by name and are unaffected. */
    sourceUpdatedAt: (number | null)[];
    /** 29-02: parallel to docIds. TRUE when this doc's text was cut by PER_DOC_CHAR_CAP or by the
     *  remaining whole-run budget — i.e. the loop is reading part of a document, not all of it.
     *  Without it a caller cannot tell a complete read from a truncated one, because both arrive
     *  as a string that is simply shorter than the cap. The knowledge adapter turns this into
     *  `{status: "partial", reason: "cap"}` rather than reporting a full read of a partial one. */
    truncated: boolean[];
    chunks: string[];
    spine: string | null;
  }> => {
    const { docIds, matchedByDoc } = await runVaultGround(ctx, tenantId, query);

    // Titles: one tenant-scoped batch read; map _id → title so titles stay parallel to docIds.
    const meta = await ctx.runQuery(internal.vault.ownedDocsMeta, {
      tenantId,
      docIds: docIds as Id<"vaultDocuments">[],
    });
    const titleById = new Map(meta.map((m) => [m._id as string, m.title]));
    // Same batch read, one more field off it — the origin was already fetched and thrown away.
    const originById = new Map(meta.map((m) => [m._id as string, m.origin ?? ""]));
    // Same batch read again (29-02). The `retrievedAt ?? createdAt` choice is made HERE, once, so
    // no caller has to know that only `kind: "web_research"` rows carry a fetch stamp.
    const kindById = new Map(meta.map((m) => [m._id as string, m.kind]));
    const updatedById = new Map(
      meta.map((m) => [m._id as string, m.retrievedAt ?? m.createdAt ?? null]),
    );
    // The DOCUMENT's full length, which is what `truncated` has to be measured against — see the
    // loop below. Same batch read again; no extra query and no extra text crosses the boundary.
    const charsById = new Map(meta.map((m) => [m._id as string, m.textChars]));

    // Chunks: per-doc + running-total char budget so a large corpus never blows the loop context.
    const titles: string[] = [];
    const origins: string[] = [];
    const kinds: string[] = [];
    const sourceUpdatedAt: (number | null)[] = [];
    const truncated: boolean[] = [];
    const chunks: string[] = [];
    let used = 0;
    for (const docId of docIds) {
      titles.push(titleById.get(docId) ?? "");
      origins.push(originById.get(docId) ?? "");
      kinds.push(kindById.get(docId) ?? "");
      sourceUpdatedAt.push(updatedById.get(docId) ?? null);
      const remaining = TOTAL_CHAR_CAP - used;
      if (remaining <= 0) {
        chunks.push("");
        truncated.push(true); // the budget ran out before this doc — nothing of it was read
        continue;
      }
      // Chunk-precise when we have it: the passage that actually matched, not the doc's opening.
      // Falls back to the doc-text slice for graph NEIGHBOURS (no matched chunk by definition) and
      // for the SMOKE:: seam. getDoc is still the tenant-scoped, fail-closed read.
      const matched = matchedByDoc[docId];
      const text =
        matched ??
        (
          await ctx.runQuery(internal.vault.getDoc, {
            vaultDocId: docId as Id<"vaultDocuments">,
            tenantId,
          })
        ).text;
      const slice = text.slice(0, Math.min(PER_DOC_CHAR_CAP, remaining));
      chunks.push(slice);
      // MEASURED AGAINST THE DOCUMENT, NOT AGAINST WHAT WE HAPPEN TO BE HOLDING. On the
      // chunk-precise path `text` is the matched PASSAGE, so `slice.length < text.length` compared
      // a passage against itself and reported `truncated: false` for a 300-character extract from a
      // 40,000-character file — the knowledge adapter then called that an `available`, i.e.
      // complete, read of a document it had read one paragraph of. That is verbatim the defect the
      // flag was added to close. `textChars` is the row's own full length; `text.length` still
      // covers the graph-neighbour and SMOKE:: paths, where the two are the same number.
      const full = Math.max(text.length, charsById.get(docId) ?? 0);
      truncated.push(slice.length < full);
      used += slice.length;
    }

    // BLPR-02 SEAM 2 of 2. The spine is a SEPARATE field, never an entry in the parallel arrays.
    // Putting it in the arrays would make `llm.ts:1364`'s `docIds.length === 0` no-match branch
    // unreachable for every blueprint-bearing tenant (the agent loses its honest "nothing in your
    // vault" answer), inflate every `vault.searched` resultCount, and put a "Business blueprint"
    // chip on every search. It is not a search result, so it is not in the search results.
    // Budgeted OUTSIDE TOTAL_CHAR_CAP: retrieval keeps the whole 8000.
    // FAIL OPEN — no blueprint (or any read failure) ⇒ `spine: null` and the other three fields
    // are byte-identical to pre-17.1.
    let spine: string | null = null;
    try {
      spine = await ctx.runQuery(internal.blueprint.spineForTenant, { tenantId });
    } catch {
      spine = null;
    }
    return { docIds, titles, origins, kinds, sourceUpdatedAt, truncated, chunks, spine };
  },
});
