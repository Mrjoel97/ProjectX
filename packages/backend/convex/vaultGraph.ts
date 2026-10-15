// The knowledge-vault graph plane adapter (VALT-02) — thin over @pikar/vault (§1).
//
// `upsertGraph` ingests a document's extracted entities/relationships with CROSS-DOC DEDUP: the
// same entity (by `(tenantId, type, normalizedName)`) from a second doc reuses the existing
// `graphNodes` row, so the graph actually connects documents (the GraphRAG payoff). Each edge
// bumps both endpoints' `degree` (degree drives orphan GC on delete-cascade).
//
// `expand` answers hop-capped neighbor expansion for grounding: seed docs → their nodes → the
// pure `bfsNeighbors` traversal (domain logic stays in @pikar/vault) → neighbor docs. Every read
// is filtered by `tenantId` on the index prefix, so a different tenant's nodes are never returned.

import { normalizeName } from "@pikar/vault";
import { expandBounded, type TraversalEdge } from "@pikar/vault/boundedTraversal";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery } from "./_generated/server";
import { internalMutation } from "./lib/tenantLifecycle";
import { startIngest } from "./vaultIngest";

// The extractor's typed output shape (mirrors vaultLlm.extractGraph / the graph-extractor skill).
const NODE = v.object({ type: v.string(), name: v.string() });
const EDGE = v.object({ from: v.string(), to: v.string(), rel: v.string() });

/**
 * Upsert a document's extracted graph. Entities dedupe cross-doc on `(tenantId, type,
 * normalizedName)`; edges reference their endpoints by emitted NAME and bump both endpoints'
 * degree. Idempotent per entity within a call (an entity mentioned twice yields ONE node).
 */
export const upsertGraph = internalMutation({
  args: {
    tenantId: v.string(),
    sourceDocId: v.id("vaultDocuments"),
    nodes: v.array(NODE),
    edges: v.array(EDGE),
    expectedContentHash: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { tenantId, sourceDocId, nodes, edges, expectedContentHash },
  ): Promise<void> => {
    if (expectedContentHash !== undefined) {
      const doc = await ctx.db.get(sourceDocId);
      if (!doc || doc.tenantId !== tenantId || doc.contentHash !== expectedContentHash) return;
    }
    // Resolve/insert each distinct entity ONCE, keyed by normalizedName so a SECOND doc's mention
    // reuses the existing row (cross-doc dedup). Type is disambiguated at the index scan.
    const idByNorm = new Map<string, Id<"graphNodes">>();
    for (const node of nodes) {
      const norm = normalizeName(node.name);
      if (idByNorm.has(norm)) continue; // already resolved this entity in this call
      const existing = await ctx.db
        .query("graphNodes")
        .withIndex("by_tenant_normalized", (q) =>
          q.eq("tenantId", tenantId).eq("normalizedName", norm),
        )
        .filter((q) => q.eq(q.field("type"), node.type))
        .first();
      if (existing) {
        idByNorm.set(norm, existing._id);
      } else {
        const id = await ctx.db.insert("graphNodes", {
          tenantId,
          type: node.type,
          name: node.name,
          normalizedName: norm,
          degree: 0,
        });
        idByNorm.set(norm, id);
      }
    }

    // Each edge references its endpoints by emitted name; insert it + bump BOTH endpoints' degree.
    // An endpoint not among the emitted nodes is skipped (the extractor's edges-reference-nodes
    // contract — defensive, never a dangling edge).
    for (const edge of edges) {
      const fromId = idByNorm.get(normalizeName(edge.from));
      const toId = idByNorm.get(normalizeName(edge.to));
      if (!fromId || !toId) continue;
      await ctx.db.insert("graphEdges", {
        tenantId,
        fromNodeId: fromId,
        toNodeId: toId,
        rel: edge.rel,
        sourceDocId,
      });
      const fromNode = await ctx.db.get(fromId);
      const toNode = await ctx.db.get(toId);
      if (fromNode) await ctx.db.patch(fromId, { degree: fromNode.degree + 1 });
      if (toNode) await ctx.db.patch(toId, { degree: toNode.degree + 1 });
    }
  },
});

/** One bounded page of graph replacement, preserving degrees on shared nodes. */
export async function clearDocumentGraphPage(
  ctx: MutationCtx,
  tenantId: string,
  vaultDocId: Id<"vaultDocuments">,
): Promise<boolean> {
  const edges = await ctx.db
    .query("graphEdges")
    .withIndex("by_tenant_source", (q) => q.eq("tenantId", tenantId).eq("sourceDocId", vaultDocId))
    .take(128);
  const decrements = new Map<Id<"graphNodes">, number>();
  for (const edge of edges) {
    await ctx.db.delete(edge._id);
    for (const id of [edge.fromNodeId, edge.toNodeId])
      decrements.set(id, (decrements.get(id) ?? 0) + 1);
  }
  for (const [id, decrement] of decrements) {
    const node = await ctx.db.get(id);
    if (!node || node.tenantId !== tenantId) continue;
    if (node.degree <= decrement) await ctx.db.delete(id);
    else await ctx.db.patch(id, { degree: node.degree - decrement });
  }
  return edges.length < 128;
}

/** Revision-bound cleanup chain: only its final page may start the replacement ingestion. */
export const clearAndReingest = internalMutation({
  args: {
    vaultDocId: v.id("vaultDocuments"),
    tenantId: v.string(),
    expectedContentHash: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const doc = await ctx.db.get(args.vaultDocId);
    if (
      !doc ||
      doc.tenantId !== args.tenantId ||
      doc.contentHash !== args.expectedContentHash ||
      doc.graphCleanupHash !== args.expectedContentHash
    )
      return;
    if (!(await clearDocumentGraphPage(ctx, args.tenantId, args.vaultDocId))) {
      await ctx.scheduler.runAfter(0, internal.vaultGraph.clearAndReingest, args);
      return;
    }
    await ctx.db.patch(args.vaultDocId, { graphCleanupHash: undefined });
    await startIngest(ctx, {
      vaultDocId: args.vaultDocId,
      tenantId: args.tenantId,
      correlationId: crypto.randomUUID(),
    });
  },
});

/** Reads only indexed adjacency pages; all domain budgets live in @pikar/vault. */
async function boundedExpansion(
  ctx: QueryCtx,
  tenantId: string,
  seedDocIds: Id<"vaultDocuments">[],
  hopCap: number,
) {
  const edge = (row: Doc<"graphEdges">): TraversalEdge => ({
    from: row.fromNodeId,
    to: row.toNodeId,
    document: row.sourceDocId,
  });
  return expandBounded(
    {
      source: async (document, limit) =>
        (
          await ctx.db
            .query("graphEdges")
            .withIndex("by_tenant_source", (q) =>
              q.eq("tenantId", tenantId).eq("sourceDocId", document as Id<"vaultDocuments">),
            )
            .take(limit)
        ).map(edge),
      adjacent: async (node, direction, limit) =>
        direction === "from"
          ? (
              await ctx.db
                .query("graphEdges")
                .withIndex("by_tenant_fromNode", (q) =>
                  q.eq("tenantId", tenantId).eq("fromNodeId", node as Id<"graphNodes">),
                )
                .take(limit)
            ).map(edge)
          : (
              await ctx.db
                .query("graphEdges")
                .withIndex("by_tenant_toNode", (q) =>
                  q.eq("tenantId", tenantId).eq("toNodeId", node as Id<"graphNodes">),
                )
                .take(limit)
            ).map(edge),
    },
    seedDocIds,
    hopCap,
  );
}

const expansionArgs = {
  tenantId: v.string(),
  seedDocIds: v.array(v.id("vaultDocuments")),
  hopCap: v.number(),
};

/** Compatibility entry point: grounding still applies status, ownership and sealing filters. */
export const expand = internalQuery({
  args: expansionArgs,
  handler: async (ctx, { tenantId, seedDocIds, hopCap }): Promise<Id<"vaultDocuments">[]> =>
    (await boundedExpansion(ctx, tenantId, seedDocIds, hopCap)).docIds as Id<"vaultDocuments">[],
});

/** Internal diagnostic entry point; no document content or graph labels are returned. */
export const expansionStats = internalQuery({
  args: expansionArgs,
  handler: async (ctx, { tenantId, seedDocIds, hopCap }) => {
    const { docIds, ...stats } = await boundedExpansion(ctx, tenantId, seedDocIds, hopCap);
    return { ...stats, documentCount: docIds.length };
  },
});
