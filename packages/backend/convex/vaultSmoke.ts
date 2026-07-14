// Live-deployment vault gate helpers (VALT-01/03). convex-test cannot run the rag/workflow
// components (see smoke.ts / run-smoke-fanout.mjs), so `run-smoke-vault.mjs` drives these against a
// real `convex dev` deployment (tenant "smoke", which the deployment's OPENAI_API_KEY covers) to
// prove the REAL embed + hybrid search + graph-expand retrieval end to end.
//
// `npx convex run` carries no auth identity, so every function here is INTERNAL and takes the
// tenantId explicitly (the tenant* wrappers derive it from identity — unavailable to the CLI). The
// embed is REAL (`rag.add`, no SMOKE:: bypass); the per-doc graph is seeded DETERMINISTICALLY via
// `upsertGraph` so the shared-entity neighbor link is reliable (the gate proves the RETRIEVAL is
// live vector+graph, not the nondeterministic LLM extraction — that has its own offline seam).
//
// §4: the vault plane writes NO audit/deadLetters row, so `assertNoRawText` confirms no seeded
// brief text leaked into either honeypot surface (mirrors the fan-out redaction needle scan).

import type { EntryId } from "@convex-dev/rag";
import { fuse, GRAPH_HOP_CAP, type VectorHit } from "@pikar/vault";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { contentHash } from "./lib/hash";
import { rag } from "./vaultRag";

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/** Insert a `processing` brain-dump row (an action can't touch ctx.db; the seed action calls this). */
export const insertBrief = internalMutation({
  args: { tenantId: v.string(), title: v.string(), text: v.string(), hash: v.string() },
  handler: async (ctx, { tenantId, title, text, hash }): Promise<Id<"vaultDocuments">> =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title,
      kind: "brain_dump",
      category: "brain-dumps",
      source: "paste",
      mimeType: "text/plain",
      size: byteLen(text),
      contentHash: hash,
      text,
      status: "processing",
      createdAt: Date.now(),
    }),
});

/**
 * Seed two briefs that share an entity: brief A is the vector match for `query`; brief B is the
 * graph neighbor reachable from A via the shared node. Each is REALLY embedded (rag.add) and marked
 * ready; the shared-entity graph is upserted deterministically. The `needle` makes each run's text
 * (and hash) unique so a re-run never hash-dedups against a prior run's rag entry.
 */
export const seedCorpus = internalAction({
  args: { tenantId: v.string(), needle: v.string() },
  handler: async (
    ctx,
    { tenantId, needle },
  ): Promise<{
    docIds: Id<"vaultDocuments">[];
    seedDocId: Id<"vaultDocuments">;
    neighborDocId: Id<"vaultDocuments">;
    query: string;
    shared: string;
  }> => {
    const shared = `Northwind-${needle}`;
    const briefs = [
      {
        title: `Northwind launch ${needle}`,
        text: `Project ${shared} kickoff notes. The ${shared} logistics platform launches to customers in Q3. Ref ${needle}.`,
        other: `${shared} logistics platform`,
        rel: "launches",
      },
      {
        title: `Northwind staffing ${needle}`,
        text: `${shared} staffing plan: hire three engineers to operate ${shared}. Ref ${needle}.`,
        other: `${shared} engineers`,
        rel: "staffs",
      },
    ];

    const docIds: Id<"vaultDocuments">[] = [];
    for (const b of briefs) {
      const hash = await contentHash(b.text);
      const vaultDocId = await ctx.runMutation(internal.vaultSmoke.insertBrief, {
        tenantId,
        title: b.title,
        text: b.text,
        hash,
      });
      // REAL embed — namespace = tenantId (VALT-03 isolation), keyed by the content hash like ingest.
      const { entryId } = await rag.add(ctx, {
        namespace: tenantId,
        text: b.text,
        key: hash,
        contentHash: hash,
        title: b.title,
        metadata: { vaultDocId },
      });
      await ctx.runMutation(internal.vault.markReady, { vaultDocId, ragEntryId: entryId });
      // Deterministic graph: both briefs touch the shared `Northwind` node → cross-doc dedup links
      // them, so an expand from brief A reaches brief B within the hop cap.
      await ctx.runMutation(internal.vaultGraph.upsertGraph, {
        tenantId,
        sourceDocId: vaultDocId,
        nodes: [
          { type: "project", name: shared },
          { type: "topic", name: b.other },
        ],
        edges: [{ from: shared, to: b.other, rel: b.rel }],
      });
      docIds.push(vaultDocId);
    }

    const seedDocId = docIds[0];
    const neighborDocId = docIds[1];
    if (!seedDocId || !neighborDocId) throw new Error("vault-smoke: seedCorpus produced too few docs");
    return {
      docIds,
      seedDocId,
      neighborDocId,
      query: `When does the ${shared} logistics platform launch to customers?`,
      shared,
    };
  },
});

/** All seeded docs reached `ready` (embedded + graph-extracted). */
export const assertReady = internalQuery({
  args: { tenantId: v.string(), docIds: v.array(v.id("vaultDocuments")) },
  handler: async (ctx, { tenantId, docIds }): Promise<{ ok: true }> => {
    for (const id of docIds) {
      const doc = await ctx.db.get(id);
      if (!doc || doc.tenantId !== tenantId) throw new Error(`vault-smoke: doc ${id} missing`);
      if (doc.status !== "ready") throw new Error(`vault-smoke: doc ${id} at "${doc.status}", expected ready`);
    }
    return { ok: true };
  },
});

/** VALT-01/03: the REAL hybrid search returns a non-empty ranked result that includes the seed doc. */
export const assertSearchReturns = internalAction({
  args: { tenantId: v.string(), query: v.string(), expectDocId: v.id("vaultDocuments") },
  handler: async (ctx, { tenantId, query, expectDocId }): Promise<{ ok: true; count: number }> => {
    const { entries } = await rag.search(ctx, {
      namespace: tenantId,
      query,
      limit: 8,
      searchType: "hybrid",
      vectorScoreThreshold: 0.2,
    });
    const ids = entries
      .map((e) => e.metadata?.vaultDocId as Id<"vaultDocuments"> | undefined)
      .filter((id): id is Id<"vaultDocuments"> => Boolean(id));
    if (ids.length === 0) throw new Error("vault-smoke: hybrid search returned nothing");
    if (!ids.includes(expectDocId)) throw new Error("vault-smoke: hybrid search missed the seed doc");
    return { ok: true, count: ids.length };
  },
});

/**
 * VALT-03: `vaultGround`'s live path (real rag.search → map to seed docs → hop-capped `expand` →
 * `fuse`) merges a graph neighbor reached via the shared entity into the grounding context. Mirrors
 * vaultGround.ts but runs internal with an explicit tenantId (the CLI has no identity).
 */
export const assertGroundNeighbor = internalAction({
  args: { tenantId: v.string(), query: v.string(), neighborDocId: v.id("vaultDocuments") },
  handler: async (
    ctx,
    { tenantId, query, neighborDocId },
  ): Promise<{ ok: true; docIds: string[] }> => {
    const { results, entries } = await rag.search(ctx, {
      namespace: tenantId,
      query,
      limit: 8,
      searchType: "hybrid",
      vectorScoreThreshold: 0.2,
    });
    const docByEntry = new Map<string, Id<"vaultDocuments">>();
    for (const e of entries) {
      const docId = e.metadata?.vaultDocId as Id<"vaultDocuments"> | undefined;
      if (docId) docByEntry.set(e.entryId, docId);
    }
    const hits: VectorHit[] = [];
    const seedDocIds: Id<"vaultDocuments">[] = [];
    for (const r of results) {
      const docId = docByEntry.get(r.entryId);
      if (!docId) continue;
      hits.push({ docId, score: r.score });
      if (!seedDocIds.includes(docId)) seedDocIds.push(docId);
    }
    if (seedDocIds.length === 0) throw new Error("vault-smoke: ground search seeded nothing");

    const neighborDocIds = await ctx.runQuery(internal.vaultGraph.expand, {
      tenantId,
      seedDocIds,
      hopCap: GRAPH_HOP_CAP,
    });
    const { docIds } = fuse(hits, seedDocIds, neighborDocIds);
    if (!docIds.includes(neighborDocId)) {
      throw new Error("vault-smoke: grounding did not reach the graph neighbor via the shared entity");
    }
    return { ok: true, docIds };
  },
});

/** §4: no seeded brief text leaked into either honeypot plane (audit / deadLetters) for the tenant.
 *  Needle values are never echoed (index only) so this assertion cannot itself leak. */
export const assertNoRawText = internalQuery({
  args: { tenantId: v.string(), needles: v.array(v.string()) },
  handler: async (ctx, { tenantId, needles }): Promise<{ ok: true; scanned: number }> => {
    const audits = await ctx.db
      .query("audit")
      .withIndex("by_tenant_ts", (q) => q.eq("tenantId", tenantId))
      .collect();
    const dls = await ctx.db
      .query("deadLetters")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect();
    const blobs = [...audits.map((a) => JSON.stringify(a)), ...dls.map((r) => JSON.stringify(r))];
    for (let n = 0; n < needles.length; n++) {
      const needle = needles[n];
      if (needle && blobs.some((b) => b.includes(needle))) {
        throw new Error(`vault-smoke: RAW text leak — needle #${n} found in a log plane`);
      }
    }
    return { ok: true, scanned: blobs.length };
  },
});

/** Failure-proof cleanup: drop each seeded doc's rag entry + graph edges/nodes + row. */
export const purge = internalMutation({
  args: { tenantId: v.string(), docIds: v.array(v.id("vaultDocuments")) },
  handler: async (ctx, { tenantId, docIds }): Promise<{ ok: true }> => {
    for (const id of docIds) {
      const doc = await ctx.db.get(id);
      if (!doc || doc.tenantId !== tenantId) continue;
      if (doc.ragEntryId) await rag.deleteAsync(ctx, { entryId: doc.ragEntryId as EntryId });
      const edges = await ctx.db
        .query("graphEdges")
        .withIndex("by_tenant_source", (q) => q.eq("tenantId", tenantId).eq("sourceDocId", id))
        .collect();
      const nodeIds = new Set<Id<"graphNodes">>();
      for (const e of edges) {
        nodeIds.add(e.fromNodeId);
        nodeIds.add(e.toNodeId);
        await ctx.db.delete(e._id);
      }
      for (const nid of nodeIds) {
        const node = await ctx.db.get(nid);
        if (node) await ctx.db.delete(nid); // throwaway tenant — GC the shared node outright
      }
      await ctx.db.delete(id);
    }
    return { ok: true };
  },
});
