// The vault READ plane (VALT-03 grounding + VALT-04 browse/search/download/detail), convex-test.
//
// vaultGround fuses vector-seed docs with hop-capped graph neighbors; the offline SMOKE:: seam
// (Pitfall 4) drives the graph-expand + fuse path deterministically WITHOUT rag.search / an
// embedding network call. The seed doc(s) ride in the query as `SMOKE::<docId,docId,...>` and are
// tenant-scoped exactly as `namespace = tenantId` scopes the real search — a cross-tenant seed
// resolves to nothing, so a different tenant's corpus can never enter a grounding result.
//
// These tests seed a graph via internal.vaultGraph.upsertGraph and assert: vector-seed + ≤2-hop
// graph merge, hop-cap exclusion, cross-tenant isolation, plus the cheap metadata read plane
// (listVaultDocs / vaultStats / vaultDownloadUrl / docEntities / vaultSearch).
import { serializeBlueprint, type BusinessBlueprint } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_a";
const asTenant = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

/** Raw-insert a vault doc row for the read-plane tests. */
const seedDoc = (
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
  tenantId = TENANT,
) =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "seed",
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "text/plain",
      size: 1,
      contentHash: `c-${Math.random()}`,
      status: "ready",
      createdAt: Date.now(),
      ...overrides,
    }),
  );

/** Attribute an edge (fromName—toName) to a source doc via the real upsert (cross-doc dedup). */
const seedEdge = (
  t: ReturnType<typeof convexTest>,
  sourceDocId: string,
  from: string,
  to: string,
) =>
  t.mutation(internal.vaultGraph.upsertGraph, {
    tenantId: TENANT,
    sourceDocId: sourceDocId as never,
    nodes: [
      { type: "topic", name: from },
      { type: "topic", name: to },
    ],
    edges: [{ from, to, rel: "rel" }],
  });

/**
 * Chain of docs sharing nodes: A(a—b) B(b—c) C(c—d) D(d—e) E(e—f). Seeding from doc A
 * (nodes a,b), BFS ≤2 reaches nodes c (hop1) and d (hop2); docs B/C/D touch {c,d} and merge in,
 * while doc E (nodes e,f — nearest node e is 3 hops out) is excluded.
 */
async function seedChain(t: ReturnType<typeof convexTest>) {
  const docA = await seedDoc(t, { title: "A", text: "A body" });
  const docB = await seedDoc(t, { title: "B", text: "B body" });
  const docC = await seedDoc(t, { title: "C", text: "C body" });
  const docD = await seedDoc(t, { title: "D", text: "D body" });
  const docE = await seedDoc(t, { title: "E", text: "E body" });
  await seedEdge(t, docA, "a", "b");
  await seedEdge(t, docB, "b", "c");
  await seedEdge(t, docC, "c", "d");
  await seedEdge(t, docD, "d", "e");
  await seedEdge(t, docE, "e", "f");
  return { docA, docB, docC, docD, docE };
}

const BLUEPRINT_TEXT = serializeBlueprint({
  name: { values: ["Acme"], origin: "stated" },
  oneLineDescription: {
    values: ["A blueprint-grounded business"],
    origin: "derived",
    source: "owner-notes.md",
  },
  stage: null,
  tier: { values: ["startup"], origin: "stated" },
  offering: null,
  targetCustomer: null,
  revenueModel: null,
  bindingConstraint: null,
  primaryGoals: null,
  knownConstraints: null,
  entities: null,
} satisfies BusinessBlueprint);

async function seedConfirmedBlueprint(
  t: ReturnType<typeof convexTest>,
  tenantId = TENANT,
): Promise<string> {
  const docId = await seedDoc(
    t,
    {
      title: "Business blueprint",
      kind: "business_blueprint",
      category: "business",
      source: "blueprint",
      mimeType: "text/markdown",
      text: BLUEPRINT_TEXT,
      size: BLUEPRINT_TEXT.length,
      status: "ready",
    },
    tenantId,
  );
  await t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId,
      tier: "startup",
      tierSource: "derived",
      derivedAt: Date.now(),
      blueprintDocId: docId,
      blueprintSourceDocIds: [],
      blueprintConfirmedAt: Date.now(),
    }),
  );
  return docId;
}

describe("vaultGround (VALT-03 hybrid vector + hop-capped graph)", () => {
  test("merges the vector seed with ≤2-hop graph neighbors; excludes a 3-hop doc", async () => {
    const t = convexTest(schema, modules);
    const { docA, docC, docE } = await seedChain(t);

    const { docIds } = await asTenant(t).action(api.vaultGround.vaultGround, {
      query: `SMOKE::${docA}`,
    });

    expect(docIds).toContain(docA); // the vector-seed doc
    expect(docIds).toContain(docC); // a graph neighbor reached within 2 hops
    expect(docIds).not.toContain(docE); // 3 hops from any seed — past the cap
  });

  test("cross-tenant: tenant B grounding returns nothing from tenant A's corpus", async () => {
    const t = convexTest(schema, modules);
    const { docA } = await seedChain(t);

    const { docIds } = await asTenant(t, "tenant_b").action(api.vaultGround.vaultGround, {
      query: `SMOKE::${docA}`, // a tenant-A doc id, but the caller is tenant B
    });

    expect(docIds).toEqual([]);
  });

  // Chunk-precise hydration added `matchedByDoc` to the INTERNAL engine result. The public action
  // must not leak it: golden fixtures 25/26 and the searchVault tool both ride this exact shape.
  test("the public action still returns exactly {docIds, context} — no internal fields leak", async () => {
    const t = convexTest(schema, modules);
    const { docA } = await seedChain(t);

    const result = await asTenant(t, TENANT).action(api.vaultGround.vaultGround, {
      query: `SMOKE::${docA}`,
    });

    expect(Object.keys(result).sort()).toEqual(["context", "docIds"]);
  });
});

describe("vaultGroundHydrated (identity-less internalAction — real titles + capped chunk text)", () => {
  // Called EXACTLY as the cockpit tool harness will: internal.* + an explicit tenantId + NO identity
  // (no asTenant / no withIdentity). The explicit tenantId arg is the ONLY scope.
  const PER_DOC_CHAR_CAP = 1500; // mirrors the module const under test
  const TOTAL_CHAR_CAP = 8000;

  test("hydrates titles + per-doc-capped chunk text parallel to docIds", async () => {
    const t = convexTest(schema, modules);
    const body = "Playbook A body. ".repeat(150); // ~2550 chars > PER_DOC_CHAR_CAP
    const docA = await seedDoc(t, { title: "Playbook A", text: body });

    const { docIds, titles, chunks, spine } = await t.action(
      internal.vaultGround.vaultGroundHydrated,
      {
        tenantId: TENANT,
        query: `SMOKE::${docA}`,
      },
    );

    expect(docIds).toContain(docA);
    // three parallel arrays
    expect(titles).toHaveLength(docIds.length);
    expect(chunks).toHaveLength(docIds.length);

    const i = docIds.indexOf(docA);
    expect(titles[i]).toBe("Playbook A");
    expect(chunks[i]?.startsWith("Playbook A body")).toBe(true);
    expect(chunks[i]!.length).toBeLessThanOrEqual(PER_DOC_CHAR_CAP); // source is longer → truncated
    expect(spine).toBeNull();
  });

  test("blueprint presence does not consume any of TOTAL_CHAR_CAP", async () => {
    const t = convexTest(schema, modules);
    const big = "z".repeat(2000);
    // Six docs all sharing a "hub" node → seeding from the first, 1-hop BFS fuses in all six.
    // 6 × PER_DOC_CHAR_CAP (9000) exceeds TOTAL_CHAR_CAP (8000), so the running budget must bite.
    const docs: string[] = [];
    for (let n = 0; n < 6; n++) {
      const d = await seedDoc(t, { title: `H${n}`, text: big });
      await seedEdge(t, d, "hub", `n${n}`);
      docs.push(d);
    }

    const withoutBlueprint = await t.action(internal.vaultGround.vaultGroundHydrated, {
      tenantId: TENANT,
      query: `SMOKE::${docs[0]}`,
    });
    await seedConfirmedBlueprint(t);
    const withBlueprint = await t.action(internal.vaultGround.vaultGroundHydrated, {
      tenantId: TENANT,
      query: `SMOKE::${docs[0]}`,
    });

    const withoutTotal = withoutBlueprint.chunks.reduce((s, c) => s + c.length, 0);
    const withTotal = withBlueprint.chunks.reduce((s, c) => s + c.length, 0);
    expect(withTotal).toBeLessThanOrEqual(TOTAL_CHAR_CAP);
    expect(withTotal).toBeGreaterThan(0);
    expect(withTotal).toBe(withoutTotal);
    expect(withBlueprint.spine).toEqual(expect.any(String));
  });

  test("cross-tenant: an explicit foreign tenantId yields no arrays or foreign spine (VALT-03)", async () => {
    const t = convexTest(schema, modules);
    const docA = await seedDoc(t, { title: "Playbook A", text: "secret tenant-A body" });
    await seedConfirmedBlueprint(t, TENANT);

    const out = await t.action(internal.vaultGround.vaultGroundHydrated, {
      tenantId: "tenant_b", // a tenant-A doc id, but scoped to tenant B — no identity to fall back on
      query: `SMOKE::${docA}`,
    });

    expect(out).toEqual({ docIds: [], titles: [], chunks: [], spine: null });
  });
});

describe("vaultGroundHydrated spine (BLPR-02)", () => {
  test("returns a live spine without changing any retrieval array", async () => {
    const t = convexTest(schema, modules);
    const { docA } = await seedChain(t);
    const withoutBlueprint = await t.action(internal.vaultGround.vaultGroundHydrated, {
      tenantId: TENANT,
      query: `SMOKE::${docA}`,
    });

    const blueprintDocId = await seedConfirmedBlueprint(t);
    const withBlueprint = await t.action(internal.vaultGround.vaultGroundHydrated, {
      tenantId: TENANT,
      query: `SMOKE::${docA}`,
    });

    expect(withBlueprint.docIds).toEqual(withoutBlueprint.docIds);
    expect(withBlueprint.titles).toEqual(withoutBlueprint.titles);
    expect(withBlueprint.chunks).toEqual(withoutBlueprint.chunks);
    expect(withBlueprint.docIds).not.toContain(blueprintDocId);
    expect(withoutBlueprint.spine).toBeNull();
    expect(withBlueprint.spine).toContain("A blueprint-grounded business");
    expect(withBlueprint.spine).not.toContain("- **Persona:**");
  });
});

describe("vault read plane (VALT-04 browse / stats / download / detail / search)", () => {
  test("listVaultDocs returns the tenant's docs; category filters; other tenants never appear", async () => {
    const t = convexTest(schema, modules);
    await seedDoc(t, { category: "brain-dumps" });
    await seedDoc(t, { category: "my-uploads" });
    const otherTenantDoc = await seedDoc(t, { category: "my-uploads" }, "tenant_b");

    const all = await asTenant(t).query(api.vault.listVaultDocs, {});
    expect(all).toHaveLength(2);
    // The projection carries no `tenantId` (15.3-02), so isolation is asserted the way a caller
    // actually feels it: the other tenant's row is simply not in the result.
    expect(all.map((d) => d._id)).not.toContain(otherTenantDoc);

    const brainDumps = await asTenant(t).query(api.vault.listVaultDocs, {
      category: "brain-dumps",
    });
    expect(brainDumps).toHaveLength(1);
    expect(brainDumps[0]?.category).toBe("brain-dumps");
  });

  // ── 15.3-02: the read-cap guarantee, asserted on SHAPE and on the BOUND ────────────────────
  //
  // The defect this pins: both browse reads used to `.collect()` the whole tenant partition, and a
  // vaultDocuments row carries up to VAULT_EXTRACT_CHAR_CAP (400k) chars of `text`. ~40 max-size
  // rows exhaust the 16 MiB per-transaction read cap, so the vault page hard-failed on the first
  // folder-sized vault. A SHAPE assertion is the cheap check that actually prevents the blow-up —
  // a size assertion would only measure this fixture.
  test("listVaultDocs never returns `text`, and the read is bounded by BYTES not just rows", async () => {
    const t = convexTest(schema, modules);
    // 50 × 200k chars = 10M chars, comfortably past VAULT_GRID_READ_BUDGET_BYTES (8 MiB) but well
    // under VAULT_GRID_PAGE (200) rows — so this proves the BYTE bound is what bites. A row-count
    // bound alone would have returned all 50 rows and ~20 MB, i.e. the original defect.
    const big = "x".repeat(200_000);
    for (let i = 0; i < 50; i++) await seedDoc(t, { title: `big-${i}`, text: big });

    const docs = await asTenant(t).query(api.vault.listVaultDocs, {});
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.length).toBeLessThan(50); // the stream stopped early — bounded, not collected
    for (const d of docs) expect(d).not.toHaveProperty("text");
    expect(JSON.stringify(docs)).not.toContain("xxxxx"); // no blob rode along under another key

    // The stats tiles read the SAME window and say so rather than reporting a wrong exact number.
    const stats = await asTenant(t).query(api.vault.vaultStats, {});
    expect(stats.capped).toBe(true);
    expect(stats.totalFiles).toBe(docs.length);
  });

  test("vaultDocText returns ONE doc's text to its owner and null cross-tenant", async () => {
    const t = convexTest(schema, modules);
    const mine = await seedDoc(t, { text: "my private words" });
    const theirs = await seedDoc(t, { text: "their private words" }, "tenant_b");

    expect(await asTenant(t).query(api.vault.vaultDocText, { vaultDocId: mine })).toEqual({
      text: "my private words",
      status: "ready",
    });
    // Fail-closed as null, never a throw — a throw would distinguish "not yours" from "no such
    // document" (an ownership oracle), the `docContext` rule.
    expect(await asTenant(t).query(api.vault.vaultDocText, { vaultDocId: theirs })).toBeNull();
  });

  test("vaultStats derives totalFiles / processed / storageUsedBytes / categories=6 from the cheap query", async () => {
    const t = convexTest(schema, modules);
    await seedDoc(t, { status: "ready", size: 100 });
    await seedDoc(t, { status: "processing", size: 200 });
    await seedDoc(t, { status: "ready", size: 300 });
    await seedDoc(t, { size: 999 }, "tenant_b"); // never counted

    const stats = await asTenant(t).query(api.vault.vaultStats, {});
    expect(stats.totalFiles).toBe(3);
    expect(stats.processed).toBe(2); // status === "ready"
    expect(stats.storageUsedBytes).toBe(600);
    expect(stats.categories).toBe(6);
    expect(stats.capped).toBe(false); // 3 small rows fit the window — the numbers are exact
  });

  test("vaultDownloadUrl returns a signed URL to the owner and null cross-tenant", async () => {
    const t = convexTest(schema, modules);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    const doc = await seedDoc(t, { storageId });

    const url = await asTenant(t).query(api.vault.vaultDownloadUrl, { vaultDocId: doc });
    expect(url).toBeTruthy();

    const cross = await asTenant(t, "tenant_b").query(api.vault.vaultDownloadUrl, {
      vaultDocId: doc,
    });
    expect(cross).toBeNull();
  });

  test("vaultDownloadUrl returns null when the doc has no stored bytes", async () => {
    const t = convexTest(schema, modules);
    const doc = await seedDoc(t); // no storageId
    const url = await asTenant(t).query(api.vault.vaultDownloadUrl, { vaultDocId: doc });
    expect(url).toBeNull();
  });

  test("docEntities returns THIS doc's nodes + edges, owner-guarded", async () => {
    const t = convexTest(schema, modules);
    const doc = await seedDoc(t);
    await seedEdge(t, doc, "Alice", "Acme");

    const { nodes, edges } = await asTenant(t).query(api.vault.docEntities, { vaultDocId: doc });
    expect(nodes.map((n) => n.name).sort()).toEqual(["Acme", "Alice"]);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.rel).toBe("rel");

    const cross = await asTenant(t, "tenant_b").query(api.vault.docEntities, { vaultDocId: doc });
    expect(cross).toEqual({ nodes: [], edges: [] });
  });

  test("vaultSearch (SMOKE) returns the hybrid seeds post-filtered to the active category", async () => {
    const t = convexTest(schema, modules);
    const brief = await seedDoc(t, { title: "brief", category: "workspace-docs" });
    const note = await seedDoc(t, { title: "note", category: "brain-dumps" });

    const all = await asTenant(t).action(api.vault.vaultSearch, {
      query: `SMOKE::${brief},${note}`,
    });
    expect(all.map((d) => d._id).sort()).toEqual([brief, note].sort());

    const scoped = await asTenant(t).action(api.vault.vaultSearch, {
      query: `SMOKE::${brief},${note}`,
      category: "brain-dumps",
    });
    expect(scoped.map((d) => d._id)).toEqual([note]);
  });

  test("vaultSearch never returns another tenant's doc even if its id is supplied", async () => {
    const t = convexTest(schema, modules);
    const mine = await seedDoc(t, { category: "brain-dumps" });
    const theirs = await seedDoc(t, { category: "brain-dumps" }, "tenant_b");

    const out = await asTenant(t).action(api.vault.vaultSearch, {
      query: `SMOKE::${mine},${theirs}`,
    });
    expect(out.map((d) => d._id)).toEqual([mine]);
  });
});
