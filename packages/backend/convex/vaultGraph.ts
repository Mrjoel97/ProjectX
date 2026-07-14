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

import { bfsNeighbors, normalizeName } from "@pikar/vault";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

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
  },
  handler: async (ctx, { tenantId, sourceDocId, nodes, edges }): Promise<void> => {
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

/**
 * Hop-capped, tenant-scoped neighbor expansion. Maps `seedDocIds` → the nodes their edges touch,
 * runs `bfsNeighbors` over an undirected adjacency built from this tenant's edges, and resolves
 * the neighbor nodes back to the docs that mention them (excluding the seed docs). A doc beyond
 * `hopCap` hops is excluded; a different tenant's rows never enter (index prefix filters tenantId).
 */
export const expand = internalQuery({
  args: {
    tenantId: v.string(),
    seedDocIds: v.array(v.id("vaultDocuments")),
    hopCap: v.number(),
  },
  handler: async (ctx, { tenantId, seedDocIds, hopCap }): Promise<Id<"vaultDocuments">[]> => {
    // All edges for THIS tenant (the by_tenant_fromNode index prefix filters on tenantId alone) —
    // never another tenant's rows (VALT-03 isolation).
    const edges = await ctx.db
      .query("graphEdges")
      .withIndex("by_tenant_fromNode", (q) => q.eq("tenantId", tenantId))
      .collect();

    // Seed nodes = every node touched by an edge attributed to a seed doc.
    const seedDocSet = new Set<string>(seedDocIds);
    const seedNodeIds = new Set<string>();
    for (const e of edges) {
      if (seedDocSet.has(e.sourceDocId)) {
        seedNodeIds.add(e.fromNodeId);
        seedNodeIds.add(e.toNodeId);
      }
    }

    // Undirected adjacency for the pure hop-capped BFS (domain logic in @pikar/vault, §1).
    const adjacency = new Map<string, string[]>();
    const link = (a: string, b: string) => {
      const list = adjacency.get(a);
      if (list) list.push(b);
      else adjacency.set(a, [b]);
    };
    for (const e of edges) {
      link(e.fromNodeId, e.toNodeId);
      link(e.toNodeId, e.fromNodeId);
    }

    const neighborNodeIds = new Set(bfsNeighbors(adjacency, [...seedNodeIds], hopCap));

    // Resolve neighbor nodes back to the docs whose edges touch them, excluding the seed docs.
    const resultDocs = new Set<Id<"vaultDocuments">>();
    for (const e of edges) {
      if (seedDocSet.has(e.sourceDocId)) continue;
      if (neighborNodeIds.has(e.fromNodeId) || neighborNodeIds.has(e.toNodeId)) {
        resultDocs.add(e.sourceDocId);
      }
    }
    return [...resultDocs];
  },
});
