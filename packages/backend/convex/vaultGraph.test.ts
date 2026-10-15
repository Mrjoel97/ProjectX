// vaultGraph adapter coverage (VALT-02): cross-doc dedup + degree bookkeeping + hop-capped,
// tenant-scoped BFS expansion. This path never embeds, so no rag/workflow registration is needed —
// plain convexTest(schema, modules).
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { clearDocumentGraphPage } from "./vaultGraph";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";
const OTHER = "tenant_b";

type Node = { type: string; name: string };
type Edge = { from: string; to: string; rel: string };

/** Insert a minimal vaultDocuments row so sourceDocId is a real Id. */
async function makeDoc(t: ReturnType<typeof convexTest>, tenantId: string, title: string) {
  return t.run(
    async (ctx): Promise<Id<"vaultDocuments">> =>
      ctx.db.insert("vaultDocuments", {
        tenantId,
        title,
        kind: "brief",
        category: "other",
        source: "paste",
        mimeType: "text/plain",
        size: 0,
        contentHash: `hash_${title}`,
        status: "ready",
        createdAt: Date.now(),
      }),
  );
}

/** One-hop helper: two `other` nodes + one edge between them. */
function pair(a: string, b: string): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: [
      { type: "other", name: a },
      { type: "other", name: b },
    ],
    edges: [{ from: a, to: b, rel: "knows" }],
  };
}

describe("upsertGraph — cross-doc dedup + degree", () => {
  test("the same entity across two docs dedupes to ONE node whose degree reflects both", async () => {
    const t = convexTest(schema, modules);
    const doc1 = await makeDoc(t, TENANT, "doc1");
    const doc2 = await makeDoc(t, TENANT, "doc2");

    // doc1: Acme—Zeta ; doc2: Acme—Beta (Acme recurs across docs).
    await t.mutation(internal.vaultGraph.upsertGraph, {
      tenantId: TENANT,
      sourceDocId: doc1,
      ...pair("Acme", "Zeta"),
    });
    await t.mutation(internal.vaultGraph.upsertGraph, {
      tenantId: TENANT,
      sourceDocId: doc2,
      ...pair("Acme", "Beta"),
    });

    const acmeRows = await t.run(async (ctx) =>
      ctx.db
        .query("graphNodes")
        .withIndex("by_tenant_normalized", (q) =>
          q.eq("tenantId", TENANT).eq("normalizedName", "acme"),
        )
        .collect(),
    );

    // Exactly ONE Acme node (the GraphRAG connectivity payoff)...
    expect(acmeRows).toHaveLength(1);
    // ...and its degree counts an edge from BOTH docs.
    expect(acmeRows[0]?.degree).toBe(2);
  });

  test("case/whitespace variants of a name dedupe to the same node", async () => {
    const t = convexTest(schema, modules);
    const doc1 = await makeDoc(t, TENANT, "doc1");
    const doc2 = await makeDoc(t, TENANT, "doc2");

    await t.mutation(internal.vaultGraph.upsertGraph, {
      tenantId: TENANT,
      sourceDocId: doc1,
      ...pair("Acme Corp", "Zeta"),
    });
    await t.mutation(internal.vaultGraph.upsertGraph, {
      tenantId: TENANT,
      sourceDocId: doc2,
      ...pair("  acme   corp ", "Beta"),
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("graphNodes")
        .withIndex("by_tenant_normalized", (q) =>
          q.eq("tenantId", TENANT).eq("normalizedName", "acme corp"),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.degree).toBe(2);
  });
});

describe("expand — hop-capped, tenant-scoped BFS", () => {
  test("returns neighbor docs within the cap and excludes a doc beyond it", async () => {
    const t = convexTest(schema, modules);
    // Chain: Alice-Bob-Carol-Dave-Eve-Frank across five docs.
    const docA = await makeDoc(t, TENANT, "A"); // Alice-Bob (seed)
    const docB = await makeDoc(t, TENANT, "B"); // Bob-Carol   (Carol @ hop1)
    const docC = await makeDoc(t, TENANT, "C"); // Carol-Dave  (Dave @ hop2)
    const docD = await makeDoc(t, TENANT, "D"); // Dave-Eve    (Eve @ hop3)
    const docE = await makeDoc(t, TENANT, "E"); // Eve-Frank   (both beyond cap)

    const chain: Array<[Id<"vaultDocuments">, string, string]> = [
      [docA, "Alice", "Bob"],
      [docB, "Bob", "Carol"],
      [docC, "Carol", "Dave"],
      [docD, "Dave", "Eve"],
      [docE, "Eve", "Frank"],
    ];
    for (const [doc, a, b] of chain) {
      await t.mutation(internal.vaultGraph.upsertGraph, {
        tenantId: TENANT,
        sourceDocId: doc,
        ...pair(a, b),
      });
    }

    const result: Id<"vaultDocuments">[] = await t.query(internal.vaultGraph.expand, {
      tenantId: TENANT,
      seedDocIds: [docA],
      hopCap: 2,
    });

    // docB (Carol @1) and docC (Dave @2) are within the cap; docE (Eve @3) is not.
    expect(result).toContain(docB);
    expect(result).toContain(docC);
    expect(result).not.toContain(docE);
    // The seed doc is never returned as its own neighbor.
    expect(result).not.toContain(docA);
  });

  test("a different tenant's nodes/docs are never returned (tenant scope)", async () => {
    const t = convexTest(schema, modules);
    const aDoc = await makeDoc(t, TENANT, "A"); // Alice-Bob
    const bDoc = await makeDoc(t, OTHER, "B"); // Bob-Carol under a DIFFERENT tenant

    await t.mutation(internal.vaultGraph.upsertGraph, {
      tenantId: TENANT,
      sourceDocId: aDoc,
      ...pair("Alice", "Bob"),
    });
    await t.mutation(internal.vaultGraph.upsertGraph, {
      tenantId: OTHER,
      sourceDocId: bDoc,
      ...pair("Bob", "Carol"),
    });

    const result: Id<"vaultDocuments">[] = await t.query(internal.vaultGraph.expand, {
      tenantId: TENANT,
      seedDocIds: [aDoc],
      hopCap: 2,
    });

    // "Bob" exists under both tenants as SEPARATE nodes; expand for TENANT never crosses over.
    expect(result).not.toContain(bDoc);
    expect(result).toHaveLength(0);

    // And the same-named entity dedupes PER tenant, not across.
    const bobRowsA = await t.run(async (ctx) =>
      ctx.db
        .query("graphNodes")
        .withIndex("by_tenant_normalized", (q) =>
          q.eq("tenantId", TENANT).eq("normalizedName", "bob"),
        )
        .collect(),
    );
    expect(bobRowsA).toHaveLength(1);
  });
});

test("replacement removes only the document's graph contribution and preserves shared nodes", async () => {
  const t = convexTest(schema, modules);
  const old = await makeDoc(t, TENANT, "old");
  const kept = await makeDoc(t, TENANT, "kept");
  await t.mutation(internal.vaultGraph.upsertGraph, {
    tenantId: TENANT,
    sourceDocId: old,
    ...pair("Shared", "Old"),
  });
  await t.mutation(internal.vaultGraph.upsertGraph, {
    tenantId: TENANT,
    sourceDocId: kept,
    ...pair("Shared", "Current"),
  });
  expect(await t.run((ctx) => clearDocumentGraphPage(ctx, TENANT, old))).toBe(true);
  const nodes = await t.run((ctx) => ctx.db.query("graphNodes").collect());
  expect(nodes.map((n) => n.name).sort()).toEqual(["Current", "Shared"]);
  expect(nodes.every((n) => n.degree === 1)).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("graphEdges").collect())).toHaveLength(1);
});

test("stale ingestion cannot publish graph, classification or terminal status over a new revision", async () => {
  const t = convexTest(schema, modules);
  const doc = await makeDoc(t, TENANT, "new");
  await t.run((ctx) => ctx.db.patch(doc, { status: "processing" }));
  await t.mutation(internal.vaultGraph.upsertGraph, {
    tenantId: TENANT,
    sourceDocId: doc,
    ...pair("Old", "Stale"),
    expectedContentHash: "old-hash",
  });
  await t.mutation(internal.vault.markReady, {
    vaultDocId: doc,
    ragEntryId: "old-entry",
    expectedContentHash: "old-hash",
  });
  await t.mutation(internal.vault.markFailed, {
    vaultDocId: doc,
    reason: "old-failure",
    expectedContentHash: "old-hash",
  });
  await t.mutation(internal.vault.applyClassification, {
    vaultDocId: doc,
    tenantId: TENANT,
    identityLine: "Old classification",
    expectedContentHash: "old-hash",
  });
  const current = await t.run((ctx) => ctx.db.get(doc));
  expect(current?.status).toBe("processing");
  expect(current?.ragEntryId).toBeUndefined();
  expect(current?.identityLine).toBeUndefined();
  expect(await t.run((ctx) => ctx.db.query("graphEdges").collect())).toHaveLength(0);
});
