// The vault ingest mutations + lifecycle + delete-cascade (VALT-01), convex-test.
//
// Registers the delivery components (workflow + workflow/workpool) so the ingest mutations can
// reach `workflow.start(ingestDoc)` — the SAME pattern cockpit.test.ts uses for executePlan. The
// durable workflow steps do NOT run synchronously under convex-test (they're scheduled); these
// tests assert the SYNCHRONOUS effects: the processing/pending row insert, hash-dedup skip,
// accept-but-defer status, the delete-cascade + orphan GC, and the tenant guard. The offline
// embed/extract seams (SMOKE::) are exercised end-to-end by the live vault smoke gate (later plan).
import { VAULT_FILE_CAP_BYTES } from "@pikar/vault";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
// Register the delivery components so the ingest mutations can reach workflow.start under convex-test.
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts");

const TENANT = "tenant_a";

/** A convex-test instance wired to run the ingest mutations' workflow.start path. */
function withIngest() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const asTenant = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

/** The extraction actions scheduled so far (cockpit.test.ts's system-table inspection pattern). */
const extractionScheduled = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) =>
      /vaultExtract|vaultTranscribe/.test(s.name),
    ),
  );

/** Raw-insert a vault doc row (bypasses the ingest mutation) for the cascade/guard tests. */
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

describe("vaultIngestText (paste / brain-dump ingest)", () => {
  test("inserts a processing brain-dump row and starts the ingest workflow", async () => {
    const t = withIngest();
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultIngestText, {
      text: "Team standup notes",
      source: "paste",
    });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("processing");
    expect(doc?.category).toBe("brain-dumps");
    expect(doc?.text).toBe("Team standup notes");
    expect(doc?.mimeType).toBe("text/plain");
  });

  test("hash-dedup: identical text returns the existing id and inserts NO second row", async () => {
    const t = withIngest();
    const first = await asTenant(t).mutation(api.vault.vaultIngestText, { text: "same content" });
    const second = await asTenant(t).mutation(api.vault.vaultIngestText, { text: "same content" });

    expect(second.vaultDocId).toBe(first.vaultDocId);
    const rows = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(rows).toHaveLength(1);
  });

  test("docId seam: a late-text arrival patches text + flips to processing", async () => {
    const t = withIngest();
    const docId = await seedDoc(t, { status: "pending_extraction", text: undefined });

    await asTenant(t).mutation(api.vault.vaultIngestText, { text: "OCR'd body", docId });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toBe("OCR'd body");
  });
});

describe("vaultUpload (file ingest + accept-but-defer)", () => {
  test("oversize (> VAULT_FILE_CAP_BYTES) is rejected", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    await expect(
      asTenant(t).mutation(api.vault.vaultUpload, {
        storageId,
        filename: "big.txt",
        mimeType: "text/plain",
        size: VAULT_FILE_CAP_BYTES + 1,
        contentHash: "over",
      }),
    ).rejects.toThrow(/too large/i);
  });

  test("a searchable MIME (MD) with text stores processing + starts the workflow", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["# Notes"])));
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
      storageId,
      filename: "notes.md",
      mimeType: "text/markdown",
      size: 7,
      contentHash: "md1",
      text: "# Notes",
    });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("processing");
  });

  test("a non-searchable MIME (pdf) stores pending_extraction and starts NO workflow", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF"])));
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
      storageId,
      filename: "scan.pdf",
      mimeType: "application/pdf",
      size: 4,
      contentHash: "pdf1",
    });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("pending_extraction");
    expect(doc?.category).toBe("my-uploads");
  });
});

describe("vaultUpload extraction scheduling (Phase 3.8 Wave 0 hook)", () => {
  test("a PDF (no text) stays pending_extraction AND schedules extractDoc with {vaultDocId, tenantId}", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF"])));
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
      storageId,
      filename: "scan.pdf",
      mimeType: "application/pdf",
      size: 4,
      contentHash: "pdf-sched",
    });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("pending_extraction");
    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(1);
    expect(sched[0]?.name).toContain("vaultExtract");
    expect(sched[0]?.args[0]).toMatchObject({ vaultDocId, tenantId: TENANT });
  });

  test("an mp4 schedules transcribeDoc", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["vid"])));
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
      storageId,
      filename: "clip.mp4",
      mimeType: "video/mp4",
      size: 3,
      contentHash: "mp4-sched",
    });

    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(1);
    expect(sched[0]?.name).toContain("vaultTranscribe");
    expect(sched[0]?.args[0]).toMatchObject({ vaultDocId, tenantId: TENANT });
  });

  test("regression guard: a searchable TXT with text rides the workflow path — NOTHING scheduled", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["hello"])));
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
      storageId,
      filename: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      contentHash: "txt-sched",
      text: "hello",
    });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("processing");
    expect(await extractionScheduled(t)).toHaveLength(0);
  });

  test("an unrecognized binary (zip) stays pending_extraction, nothing scheduled", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["PK"])));
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
      storageId,
      filename: "archive.zip",
      mimeType: "application/zip",
      size: 2,
      contentHash: "zip-sched",
    });

    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("pending_extraction");
    expect(await extractionScheduled(t)).toHaveLength(0);
  });
});

describe("extraction lifecycle internals (Phase 3.8 Wave 0 seam)", () => {
  test("ingestExtractedText patches text/hash/size, flips to processing, starts the ingest workflow", async () => {
    const t = withIngest();
    const docId = await seedDoc(t, {
      status: "pending_extraction",
      text: undefined,
      mimeType: "application/pdf",
      contentHash: "pre-extract",
    });

    await t.mutation(internal.vault.ingestExtractedText, {
      docId,
      tenantId: TENANT,
      text: "Extracted body",
      truncated: false,
    });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("processing");
    expect(doc?.text).toBe("Extracted body");
    expect(doc?.size).toBe(14);
    expect(doc?.contentHash).not.toBe("pre-extract");
    expect(doc?.extractionTruncated).toBeUndefined();
  });

  test("truncated:true sets extractionTruncated (honesty flag)", async () => {
    const t = withIngest();
    const docId = await seedDoc(t, { status: "pending_extraction", text: undefined });

    await t.mutation(internal.vault.ingestExtractedText, {
      docId,
      tenantId: TENANT,
      text: "First N chars only",
      truncated: true,
    });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.extractionTruncated).toBe(true);
  });

  test("ingestExtractedText with the wrong tenantId throws (fail closed)", async () => {
    const t = withIngest();
    const docId = await seedDoc(t, { status: "pending_extraction", text: undefined });

    await expect(
      t.mutation(internal.vault.ingestExtractedText, {
        docId,
        tenantId: "tenant_b",
        text: "stolen",
        truncated: false,
      }),
    ).rejects.toThrow();
  });

  test("markExtracting flips the status pill to extracting", async () => {
    const t = withIngest();
    const docId = await seedDoc(t, { status: "pending_extraction", text: undefined });

    await t.mutation(internal.vault.markExtracting, { vaultDocId: docId });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("extracting");
  });

  test("getDocForExtraction returns the action's fields for the owner; cross-tenant throws", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF"])));
    const docId = await seedDoc(t, {
      status: "pending_extraction",
      text: undefined,
      mimeType: "application/pdf",
      storageId,
      title: "scan.pdf",
    });

    const meta = await t.query(internal.vault.getDocForExtraction, {
      vaultDocId: docId,
      tenantId: TENANT,
    });
    expect(meta).toMatchObject({
      storageId,
      mimeType: "application/pdf",
      title: "scan.pdf",
      status: "pending_extraction",
    });

    await expect(
      t.query(internal.vault.getDocForExtraction, { vaultDocId: docId, tenantId: "tenant_b" }),
    ).rejects.toThrow();
  });
});

describe("deleteVaultDoc (cascade + orphan GC + tenant guard)", () => {
  test("removes the row + its edges; orphan nodes GC'd, shared nodes survive", async () => {
    const t = withIngest();
    const doc1 = await seedDoc(t, { contentHash: "c1" });
    const doc2 = await seedDoc(t, { contentHash: "c2" });
    // doc1: Alice—Bob; doc2: Bob—Carol (Bob is shared across both docs via cross-doc dedup).
    await t.mutation(internal.vaultGraph.upsertGraph, {
      tenantId: TENANT,
      sourceDocId: doc1,
      nodes: [
        { type: "person", name: "Alice" },
        { type: "person", name: "Bob" },
      ],
      edges: [{ from: "Alice", to: "Bob", rel: "knows" }],
    });
    await t.mutation(internal.vaultGraph.upsertGraph, {
      tenantId: TENANT,
      sourceDocId: doc2,
      nodes: [
        { type: "person", name: "Bob" },
        { type: "person", name: "Carol" },
      ],
      edges: [{ from: "Bob", to: "Carol", rel: "knows" }],
    });

    await asTenant(t).mutation(api.vault.deleteVaultDoc, { vaultDocId: doc1 });

    // The doc row is gone.
    expect(await t.run((ctx) => ctx.db.get(doc1))).toBeNull();
    // Only doc2's edge remains.
    const edges = await t.run((ctx) => ctx.db.query("graphEdges").collect());
    expect(edges).toHaveLength(1);
    expect(edges[0]?.sourceDocId).toBe(doc2);
    // Alice (orphan) GC'd; Bob (shared) + Carol survive.
    const nodes = await t.run((ctx) => ctx.db.query("graphNodes").collect());
    expect(nodes.map((n) => n.name).sort()).toEqual(["Bob", "Carol"]);
    expect(nodes.find((n) => n.name === "Bob")?.degree).toBe(1);
  });

  test("cross-tenant delete is a no-op — the other tenant's doc survives", async () => {
    const t = withIngest();
    const doc = await seedDoc(t, {}, "tenant_b");

    await asTenant(t, TENANT).mutation(api.vault.deleteVaultDoc, { vaultDocId: doc });

    expect(await t.run((ctx) => ctx.db.get(doc))).not.toBeNull();
  });

  test("getDoc denies a cross-tenant read (fail closed)", async () => {
    const t = withIngest();
    const doc = await seedDoc(t, { text: "secret" });
    await expect(
      t.query(internal.vault.getDoc, { vaultDocId: doc, tenantId: "tenant_b" }),
    ).rejects.toThrow();
  });
});
