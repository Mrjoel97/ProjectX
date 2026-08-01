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

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
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
  expect(row.text).toBe("# A\n\nprivate");
  expect(row.contentHash).toBe("hash_a");
  expect(row.size).toBe(new TextEncoder().encode("# A\n\nprivate").length);
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
  expect(row.text).toBe("# v2 shorter");
  expect(row.title).toBe("draft v2");
  expect(row.contentHash).toBe("h2");
  expect(row.size).toBe(new TextEncoder().encode("# v2 shorter").length);
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
