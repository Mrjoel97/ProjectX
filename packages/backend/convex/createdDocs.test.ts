// Phase-18 (ACTN-04) — the governed WRITE plane for agent-created artifacts, convex-test.
//
// Covers SC1 (a created artifact is a tenant-scoped vaultDocuments row with `text`), SC1b (it is
// NEVER ingested — the retrieval exclusion is structural, so the assertion is on the ABSENCE of a
// ragEntryId) and SC3 (tenant isolation). SC7 (revision replaces in place) lands in Task 2.
//
// The blueprint-drift exclusion test is plan 18-10's, not this file's.
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
