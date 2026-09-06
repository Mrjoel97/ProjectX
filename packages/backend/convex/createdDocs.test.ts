// Phase-18 (ACTN-04) — the governed WRITE plane for agent-created artifacts, convex-test.
//
// Covers SC1 (a created artifact is a tenant-scoped vaultDocuments row with `text`), SC1b (it is
// NEVER ingested — the retrieval exclusion is structural, so the assertion is on the ABSENCE of a
// ragEntryId), SC3 (tenant isolation) and SC7 (revision REPLACES in place — same _id, both guards).
//
// The blueprint-drift exclusion test is plan 18-10's, not this file's.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// NOTE: no `@ts-expect-error` above this line, unlike its 37 siblings. tsconfig.json includes
// `vitest.config.mts`, which pulls Vite's global types in, so `import.meta.glob` typechecks and the
// directive is DEAD — tsc reports TS2578 for it. That one dead directive is 100 of the backend's
// 151 typecheck errors and 22.1-03 is sweeping them; do not add a 101st here.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const asTenant = (t: ReturnType<typeof convexTest>, tenantId: string) =>
  t.withIdentity({ subject: tenantId }); // requireTenant takes the subject before "|"

/** A real stored blob standing in for the derived PDF the TOOL (plan 18-06) renders. */
const storePdf = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })));

test("SC1: long-form creation writes ONE governed, tenant-scoped vault row", async () => {
  const t = convexTest(schema, modules);
  const storageId = await storePdf(t);

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "A's one-pager",
    form: "long",
    markdown: "# A\n\nprivate",
    contentHash: "hash_a",
    storageId,
  });

  const docs = await asTenant(t, "tenant_a").query(api.vault.listVaultDocs, {});
  expect(docs.filter((d) => d._id === docId)).toHaveLength(1);
  const row = docs.find((d) => d._id === docId)!;

  expect(row.title).toBe("A's one-pager");
  expect(row.kind).toBe("created_document");
  expect(row.category).toBe("workspace-docs");
  expect(row.source).toBe("agent");
  expect(row.origin).toBe("agent");
  expect(row.status).toBe("ready");
  // LOCKED: markdown is the artifact of record for BOTH forms. application/pdf would land the row
  // at pending_extraction and round-trip it through vaultExtract to recover text we authored.
  expect(row.mimeType).toBe("text/markdown");
  expect(row.size).toBe(new TextEncoder().encode("# A\n\nprivate").length);
  // `text` / `contentHash` left the browse projection in 15.3-02 (the grid never needed a row's
  // whole blob, and shipping it is what blew the 16 MiB read cap) — assert them off the row.
  expect(await t.run((ctx) => ctx.db.get(docId))).toMatchObject({
    text: "# A\n\nprivate",
    contentHash: "hash_a",
  });
  expect(row.createdAt).toBeGreaterThan(0);
  // storageId is written STRAIGHT THROUGH from args — the mutation renders nothing.
  expect(row.storageId).toBe(storageId);
});

test("SC1b: a created artifact is never ingested — no rag entry, so retrieval cannot reach it", async () => {
  const t = convexTest(schema, modules);

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "not groundable",
    form: "long",
    markdown: "# secret sauce",
    contentHash: "hash_ng",
  });

  const row = await t.run(async (ctx) => ctx.db.get(docId));
  expect(row?.ragEntryId).toBeUndefined(); // never ingested ⇒ never retrievable
  expect(row?.status).toBe("ready"); // ready WITHOUT ingest (blueprint.ts confirmBlueprint precedent)
  // and no graph half either — runVaultGround's second engine has nothing to expand from.
  const nodes = await t.run(async (ctx) => await ctx.db.query("graphNodes").collect());
  expect(nodes).toHaveLength(0);
});

test("short form yields created_content and, with no storageId, no Download button", async () => {
  const t = convexTest(schema, modules);

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "LinkedIn option 1",
    form: "short",
    markdown: "hot take",
    contentHash: "hash_s",
  });

  const row = await t.run(async (ctx) => ctx.db.get(docId));
  expect(row?.kind).toBe("created_content");
  expect(row?.mimeType).toBe("text/markdown"); // same for BOTH forms
  // PreviewModal's canDownload reads storageId — absent ⇒ no Download button, for free.
  expect(row?.storageId).toBeUndefined();
});

test("SC3: a created artifact is invisible to another tenant", async () => {
  const t = convexTest(schema, modules);

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "A's one-pager",
    form: "long",
    markdown: "# A\n\nprivate",
    contentHash: "hash_iso",
  });

  const a = await asTenant(t, "tenant_a").query(api.vault.listVaultDocs, {});
  const b = await asTenant(t, "tenant_b").query(api.vault.listVaultDocs, {});

  expect(a.map((d) => d._id)).toContain(docId);
  expect(b.map((d) => d._id)).not.toContain(docId);
});

// ── SC7: revision replaces in place (Task 2) ─────────────────────────────────

const THREAD = "thread_1";

/** The Output-card row the tool writes alongside a create — how #index resolves to a docId. */
const outputCard = (
  t: ReturnType<typeof convexTest>,
  docIds: Id<"vaultDocuments">[],
  tenantId = "tenant_a",
) =>
  t.mutation(internal.vaultSources.insert, {
    tenantId,
    threadId: THREAD,
    docIds,
    titles: docIds.map((_, i) => `title ${i + 1}`),
    count: docIds.length,
    role: "created" as const,
    snippet: "first 240 chars…",
    form: "long" as const,
    createdAt: Date.now(),
  });

/** A grounding (searchVault) row: no `role`. This is what makes the role filter load-bearing. */
const groundingCard = (t: ReturnType<typeof convexTest>, docIds: Id<"vaultDocuments">[]) =>
  t.mutation(internal.vaultSources.insert, {
    tenantId: "tenant_a",
    threadId: THREAD,
    docIds,
    titles: ["an upload"],
    count: docIds.length,
    createdAt: Date.now() + 1,
  });

const createDoc = (t: ReturnType<typeof convexTest>, over: Record<string, unknown> = {}) =>
  t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "draft",
    form: "long" as const,
    markdown: "# v1",
    contentHash: "h1",
    ...over,
  });

test("vaultSources carries role, snippet and form; byThread filters on role", async () => {
  const t = convexTest(schema, modules);
  const docId = await createDoc(t);
  await outputCard(t, [docId]);
  await groundingCard(t, [docId]); // written LATER — a bare .first() would return THIS

  const created = await asTenant(t, "tenant_a").query(api.vaultSources.byThread, {
    threadId: THREAD,
    role: "created" as const,
  });
  expect(created?.role).toBe("created");
  expect(created?.snippet).toBe("first 240 chars…");
  expect(created?.form).toBe("long"); // plan 18-07's UPPERCASE type badge reads exactly this
  expect(created?.docIds).toEqual([docId]);

  // The shipped SourceCard passes no role and must still get the grounding row.
  const grounding = await asTenant(t, "tenant_a").query(api.vaultSources.byThread, {
    threadId: THREAD,
  });
  expect(grounding?.role).toBeUndefined();
  expect(grounding?.titles).toEqual(["an upload"]);
});

test("SC7: a revision patches the SAME _id — one row before, one row after, new text", async () => {
  const t = convexTest(schema, modules);
  const oldStorage = await storePdf(t);
  const docId = await createDoc(t, { storageId: oldStorage });
  await outputCard(t, [docId]);
  await groundingCard(t, [docId]); // the load-bearing case: a searchVault turn in between

  const before = await asTenant(t, "tenant_a").query(api.vault.listVaultDocs, {});
  const newStorage = await storePdf(t);

  const res = await t.mutation(internal.vault.patchCreatedDoc, {
    tenantId: "tenant_a",
    threadId: THREAD,
    index: 1,
    title: "draft v2",
    form: "long" as const,
    markdown: "# v2 shorter",
    contentHash: "h2",
    storageId: newStorage,
  });

  expect(res).toEqual({ ok: true, oldStorageId: oldStorage });

  const after = await asTenant(t, "tenant_a").query(api.vault.listVaultDocs, {});
  expect(after).toHaveLength(before.length); // NO second row, NO version history
  const row = after.find((d) => d._id === docId)!;
  expect(row._id).toBe(docId); // the SAME _id
  expect(row.title).toBe("draft v2");
  expect(row.size).toBe(new TextEncoder().encode("# v2 shorter").length);
  // `text` and `contentHash` are no longer on the browse projection (15.3-02) — the replaced body
  // is asserted through the one-doc read the preview pane uses, and the dedup key off the row.
  expect(
    await asTenant(t, "tenant_a").query(api.vault.vaultDocText, { vaultDocId: docId }),
  ).toMatchObject({ text: "# v2 shorter" });
  expect(await t.run((ctx) => ctx.db.get(docId))).toMatchObject({ contentHash: "h2" });
  expect(row.storageId).toBe(newStorage);
  expect(row.origin).toBe("agent"); // a revise never promotes
});

test("SC7: long → short REMOVES storageId and hands back the superseded one", async () => {
  const t = convexTest(schema, modules);
  const oldStorage = await storePdf(t);
  const docId = await createDoc(t, { storageId: oldStorage });
  await outputCard(t, [docId]);

  const res = await t.mutation(internal.vault.patchCreatedDoc, {
    tenantId: "tenant_a",
    threadId: THREAD,
    index: 1,
    title: "now a post",
    form: "short" as const,
    markdown: "hot take",
    contentHash: "h3",
  });

  expect(res).toEqual({ ok: true, oldStorageId: oldStorage });
  const row = await t.run(async (ctx) => ctx.db.get(docId));
  expect(row?.kind).toBe("created_content");
  expect(row?.storageId).toBeUndefined(); // ⇒ the Download button goes away
});

test("SC7: a bad #index returns ok:false and changes nothing", async () => {
  const t = convexTest(schema, modules);
  const docId = await createDoc(t);
  await outputCard(t, [docId]);

  const res = await t.mutation(internal.vault.patchCreatedDoc, {
    tenantId: "tenant_a",
    threadId: THREAD,
    index: 2, // the card holds exactly one doc
    title: "nope",
    form: "long" as const,
    markdown: "# should not land",
    contentHash: "hx",
  });

  expect(res).toEqual({ ok: false }); // returns a refusal, never throws
  const row = await t.run(async (ctx) => ctx.db.get(docId));
  expect(row?.text).toBe("# v1");
});

test("SC7: a revision cannot cross a tenant boundary", async () => {
  const t = convexTest(schema, modules);
  const docId = await createDoc(t); // tenant_a's artifact
  await outputCard(t, [docId], "tenant_b"); // tenant_b's card pointing at it

  const res = await t.mutation(internal.vault.patchCreatedDoc, {
    tenantId: "tenant_b",
    threadId: THREAD,
    index: 1,
    title: "stolen",
    form: "long" as const,
    markdown: "# overwritten",
    contentHash: "hy",
  });

  expect(res).toEqual({ ok: false });
  const row = await t.run(async (ctx) => ctx.db.get(docId));
  expect(row?.text).toBe("# v1");
});

test("SC7: a revision cannot overwrite a user-uploaded document", async () => {
  const t = convexTest(schema, modules);
  // origin ABSENT ⇒ user-supplied, exactly like every row that exists today.
  const uploadId = await t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: "tenant_a",
      title: "their contract.md",
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "text/markdown",
      size: 9,
      contentHash: "hu",
      text: "their own",
      status: "ready" as const,
      createdAt: Date.now(),
    }),
  );
  await outputCard(t, [uploadId]);

  const res = await t.mutation(internal.vault.patchCreatedDoc, {
    tenantId: "tenant_a",
    threadId: THREAD,
    index: 1,
    title: "clobbered",
    form: "long" as const,
    markdown: "# agent prose over their contract",
    contentHash: "hz",
  });

  expect(res).toEqual({ ok: false });
  const row = await t.run(async (ctx) => ctx.db.get(uploadId));
  expect(row?.text).toBe("their own");
  expect(row?.title).toBe("their contract.md");
});

// The in-place viewing half: the workspace holds a doc ID and nothing else, so `vault.vaultDoc` is
// what lets the created artifact be READ where it was made instead of via /dashboard/vault. Its two
// failure modes are the only interesting logic — a foreign id and a malformed one must both come
// back `null`, never a throw and never another tenant's row.
test("vaultDoc: own row projects, foreign and malformed ids fail closed to null", async () => {
  const t = convexTest(schema, modules);
  const storageId = await storePdf(t);
  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "A's one-pager",
    form: "long",
    markdown: "# A",
    contentHash: "hash_view",
    storageId,
  });

  const mine = await asTenant(t, "tenant_a").query(api.vault.vaultDoc, { vaultDocId: docId });
  expect(mine?.title).toBe("A's one-pager");
  expect(await asTenant(t, "tenant_b").query(api.vault.vaultDoc, { vaultDocId: docId })).toBeNull();
  expect(
    await asTenant(t, "tenant_a").query(api.vault.vaultDoc, { vaultDocId: "not-an-id" }),
  ).toBeNull();
});

// ── The stored bytes announce themselves (PDF end-to-end, Seam B) ─────────────────────────────
//
// `createDocument` has ALWAYS rendered a real PDF for `form: "long"` and stored it — but the row
// advertised `text/markdown`, so the preview could never show the document in its true form. One
// field was answering two different questions. `storedMimeType` answers the second one.
//
// These assert BOTH halves on purpose: the new field appearing is worthless if it arrived by
// loosening the LOCKED `mimeType`, which is what keeps a created document extractable and
// groundable. A change that flips `mimeType` to "application/pdf" makes the first assertion pass
// and the second fail.

test("a long document's row says its bytes are a PDF — while mimeType stays the locked markdown", async () => {
  const t = convexTest(schema, modules);
  const storageId = await storePdf(t);

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "Quarterly one-pager",
    form: "long",
    markdown: "# Q3\n\nnumbers",
    contentHash: "hash_pdf",
    storageId,
  });

  const row = await t.run(async (ctx) => ctx.db.get(docId));
  expect(row?.storedMimeType).toBe("application/pdf"); // what the BYTES are → the viewer
  expect(row?.mimeType).toBe("text/markdown"); // LOCKED: the artifact of record, unchanged
  expect(row?.text).toBe("# Q3\n\nnumbers"); // still groundable, still searchable
});

test("no stored bytes ⇒ no storedMimeType — absence means 'the bytes are what mimeType says'", async () => {
  // `short` renders no PDF, and every upload's bytes already match its mimeType. Writing a value
  // here would claim a PDF exists where none does, and the preview would frame an empty rectangle.
  const t = convexTest(schema, modules);

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "A short post",
    form: "short",
    markdown: "just a paragraph",
    contentHash: "hash_short",
  });

  const row = await t.run(async (ctx) => ctx.db.get(docId));
  expect(row?.storedMimeType).toBeUndefined();
  expect(row?.mimeType).toBe("text/markdown");
});

test("a revise REWRITES what the bytes are — long→short drops it, long→sheet makes it a workbook", async () => {
  // `patchCreatedDoc` never revised `storedMimeType`, so a long→short rewrite left a stored type
  // with no bytes beneath it and a long→sheet rewrite would have framed a workbook in the PDF
  // viewer. MUTATION that turns this RED: drop storedMimeFor from the patch.
  const t = convexTest(schema, modules);
  const storageId = await storePdf(t);
  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "One-pager",
    form: "long",
    markdown: "# body",
    contentHash: "hash_rev",
    storageId,
    sourceThreadId: "thread_rev",
  });
  await t.mutation(internal.vaultSources.insert, {
    tenantId: "tenant_a",
    threadId: "thread_rev",
    docIds: [docId],
    titles: ["One-pager"],
    count: 1,
    role: "created",
    form: "long",
    createdAt: Date.now(),
  });

  await t.mutation(internal.vault.patchCreatedDoc, {
    tenantId: "tenant_a",
    threadId: "thread_rev",
    index: 1,
    title: "A post",
    form: "short",
    markdown: "just a paragraph",
    contentHash: "hash_rev2",
  });
  expect((await t.run((ctx) => ctx.db.get(docId)))?.storedMimeType).toBeUndefined();

  const sheetBytes = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
  await t.mutation(internal.vault.patchCreatedDoc, {
    tenantId: "tenant_a",
    threadId: "thread_rev",
    index: 1,
    title: "A tracker",
    form: "sheet",
    markdown: "| A |\n| --- |\n| 1 |",
    contentHash: "hash_rev3",
    storageId: sheetBytes,
  });
  const row = await t.run((ctx) => ctx.db.get(docId));
  expect(row?.storedMimeType).toBe(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  expect(row?.kind).toBe("created_document");
});

test("the projection carries storedMimeType to the browser — the preview cannot read the raw row", async () => {
  // listVaultDocs projects a fixed field list; a field missing from it is invisible to the UI no
  // matter what the row holds. That projection is exactly where this feature would silently die.
  const t = convexTest(schema, modules);
  const storageId = await storePdf(t);

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "Projected one-pager",
    form: "long",
    markdown: "# body",
    contentHash: "hash_proj",
    storageId,
  });

  const docs = await asTenant(t, "tenant_a").query(api.vault.listVaultDocs, {});
  const row = docs.find((d) => d._id === docId);
  expect(row?.storedMimeType).toBe("application/pdf");

  // Phase 40: the cockpit's inline-PDF branch reads `storedMimeType` off vaultDocText, NOT off the
  // list -- the Output card never queries the list. Without this assertion the whole inline-PDF
  // feature is pinned only by regexes over cards.tsx, which a change on the data side sails through.
  const text = await asTenant(t, "tenant_a").query(api.vault.vaultDocText, { vaultDocId: docId });
  expect(text?.storedMimeType).toBe("application/pdf");
});

// 26-11 (CONT-01): the artifact shelf must be able to say WHICH conversation produced a document.
// The provenance is taken from the plan row the tool already read (llm.ts `readPlan()`), NEVER from
// a model-supplied tool argument -- otherwise the model could stamp its output with another
// thread's provenance. Both fields are v.optional: the nine call sites above pass neither, and a
// legacy row carrying neither still validates (dashboardSchema.test.ts).
test("a created document stores the thread and plan it was written in", async () => {
  const t = convexTest(schema, modules);
  const planId: Id<"plans"> = await t.run(async (ctx) =>
    ctx.db.insert("plans", {
      tenantId: "tenant_a",
      threadId: "thread_prov",
      status: "proposed",
      createdAt: Date.now(),
    } as never),
  );

  const docId = await t.mutation(internal.vault.insertCreatedDoc, {
    tenantId: "tenant_a",
    title: "A's provenanced one-pager",
    form: "short",
    markdown: "# A written in a thread",
    contentHash: "hash_prov",
    sourceThreadId: "thread_prov",
    sourcePlanId: planId,
  });

  const doc = await t.run(async (ctx) => ctx.db.get(docId));
  expect(doc).toMatchObject({ sourceThreadId: "thread_prov", sourcePlanId: planId });
});
