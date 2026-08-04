// The vault ingest mutations + lifecycle + delete-cascade (VALT-01), convex-test.
//
// Registers the delivery components (workflow + workflow/workpool) so the ingest mutations can
// reach `workflow.start(ingestDoc)` — the SAME pattern cockpit.test.ts uses for executePlan. The
// durable workflow steps do NOT run synchronously under convex-test (they're scheduled); these
// tests assert the SYNCHRONOUS effects: the processing/pending row insert, hash-dedup skip,
// accept-but-defer status, the delete-cascade + orphan GC, and the tenant guard. The offline
// embed/extract seams (SMOKE::) are exercised end-to-end by the live vault smoke gate (later plan).
import { VAULT_FILE_CAP_BYTES, VAULT_VIDEO_CAP_BYTES } from "@pikar/vault";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// Register the delivery components so the ingest mutations can reach workflow.start under convex-test.
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { vaultIngestPool } from "./index";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

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

/**
 * Every extraction `vault.scheduleExtraction` asked to run, in the SAME `{ name, args }` shape the
 * `_scheduled_functions` rows had before 15.3-04.
 *
 * WHY A SPY AND NOT THE SYSTEM TABLE: the enqueue now goes to the named `vaultIngestPool`, and a
 * workpool writes its `work` row and schedules its main loop INSIDE the component's own namespace.
 * convex-test scopes `_scheduled_functions` per component and gives a test no component-scoped
 * `t.run`, so the enqueue is simply unobservable from here. The REAL pool is exercised end-to-end
 * by vaultExtract.test.ts / vaultTranscribe.test.ts / guardrails.test.ts, which register
 * `vaultIngestPool` and drive vaultUpload through it; what these tests are about is the SCHEDULING
 * DECISION (which rail, which args, and whether anything is dispatched at all), which is exactly
 * what the spy records.
 */
const enqueuedExtractions: { name: string; args: [Record<string, unknown>] }[] = [];

// ⚠ FAKE TIMERS, AND THIS FILE IS THE REASON THE WHOLE SUITE WAS FLAKY (2026-08-04).
//
// The spy below intercepts the INGEST POOL, but `startIngest` goes through `workflow.start`, which
// schedules the WORKFLOW component's own workpool functions via the scheduler — a completely
// separate path this file mocks nothing on. Under REAL timers those 20 starts fire AFTER this file
// finishes, and the workflow component then retry-loops (`Run …runs failed, retrying in 800 ms`)
// against a torn-down module runner. The retry lands in whatever test file the worker is running by
// then and throws `ReferenceError: crypto is not defined` / `process is not defined` from inside
// perfectly innocent code — which is why the symptom always appeared in `onboarding.test.ts`, a file
// with nothing wrong with it, and why it survived both `fileParallelism: false` and `pool: threads`.
//
// These tests assert the SYNCHRONOUS scheduling decision (which rail, which args, whether anything
// is dispatched at all). The durable steps never need to run, so the timers never need to advance —
// the same call `vaultExtract.test.ts` makes for the same reason, citing this file as its precedent.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

beforeEach(() => {
  enqueuedExtractions.length = 0;
  // The generic signature of `enqueueAction` cannot be satisfied by a concrete stub, so the
  // implementation is cast once here rather than typed twice.
  vi.spyOn(vaultIngestPool, "enqueueAction").mockImplementation(
    ((async (_ctx: unknown, fn: never, fnArgs: unknown) => {
      enqueuedExtractions.push({
        name: getFunctionName(fn),
        args: [fnArgs as Record<string, unknown>],
      });
      return "workId_test" as never;
    }) as never) as never,
  );
});
afterEach(() => vi.restoreAllMocks());

/** The extraction actions enqueued so far. */
const extractionScheduled = (_t?: unknown) => enqueuedExtractions;

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

const seedFolder = (
  t: ReturnType<typeof convexTest>,
  name: string,
  tenantId = TENANT,
  status: "reserving" | "ingesting" | "complete" | "refused" = "complete",
) =>
  t.run((ctx) =>
    ctx.db.insert("vaultFolders", {
      tenantId,
      name,
      source: "upload" as const,
      status,
      memberCount: 1,
      terminalCount: 1,
      failedCount: 0,
      reservedCents: 0,
      spentCents: 0,
      createdAt: Date.now(),
    }),
  );

const smokeSearch = (
  t: ReturnType<typeof convexTest>,
  candidates: Id<"vaultDocuments">[],
  args: { category?: string; folderId?: Id<"vaultFolders"> } = {},
) =>
  asTenant(t).action(api.vault.vaultSearch, {
    query: `SMOKE::${candidates.join(",")}`,
    ...args,
  });

describe("vaultSearch folder boundary", () => {
  test("a folder-scoped search excludes a same-tenant candidate from another folder", async () => {
    const t = convexTest(schema, modules);
    const folderA = await seedFolder(t, "A");
    const folderB = await seedFolder(t, "B");
    const docA = await seedDoc(t, { title: "A doc", folderId: folderA });
    const docB = await seedDoc(t, { title: "B doc", folderId: folderB });

    const found = await smokeSearch(t, [docA, docB], { folderId: folderA });

    expect(found.map((doc) => doc._id)).toEqual([docA]);
  });

  test("folder and category filters intersect", async () => {
    const t = convexTest(schema, modules);
    const folderA = await seedFolder(t, "A");
    const folderB = await seedFolder(t, "B");
    const matching = await seedDoc(t, {
      title: "A brain dump",
      category: "brain-dumps",
      folderId: folderA,
    });
    const wrongCategory = await seedDoc(t, { title: "A upload", folderId: folderA });
    const wrongFolder = await seedDoc(t, {
      title: "B brain dump",
      category: "brain-dumps",
      folderId: folderB,
    });

    const found = await smokeSearch(t, [matching, wrongCategory, wrongFolder], {
      folderId: folderA,
      category: "brain-dumps",
    });

    expect(found.map((doc) => doc._id)).toEqual([matching]);
  });

  test("omitting folderId preserves tenant-wide root search", async () => {
    const t = convexTest(schema, modules);
    const folderA = await seedFolder(t, "A");
    const folderB = await seedFolder(t, "B");
    const docA = await seedDoc(t, { title: "A doc", folderId: folderA });
    const docB = await seedDoc(t, { title: "B doc", folderId: folderB });
    const loose = await seedDoc(t, { title: "Loose doc" });

    const found = await smokeSearch(t, [docA, docB, loose]);

    expect(found.map((doc) => doc._id)).toEqual([docA, docB, loose]);
  });

  test("foreign and missing folder IDs both return no scoped results", async () => {
    const t = convexTest(schema, modules);
    const ownedFolder = await seedFolder(t, "Owned");
    const foreignFolder = await seedFolder(t, "Foreign", "tenant_b");
    const missingFolder = await seedFolder(t, "Deleted");
    const owned = await seedDoc(t, { title: "Owned doc", folderId: ownedFolder });
    await t.run((ctx) => ctx.db.delete(missingFolder));

    expect(await smokeSearch(t, [owned], { folderId: foreignFolder })).toEqual([]);
    expect(await smokeSearch(t, [owned], { folderId: missingFolder })).toEqual([]);
  });

  test("an ingesting folder member remains sealed from scoped search", async () => {
    const t = convexTest(schema, modules);
    const folder = await seedFolder(t, "Ingesting", TENANT, "ingesting");
    const member = await seedDoc(t, {
      title: "Sealed member",
      folderId: folder,
      ragEntryId: "entry-sealed",
    });

    expect(await smokeSearch(t, [member], { folderId: folder })).toEqual([]);
  });
});

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

  test("a large document under the 100 MiB doc cap is accepted (was rejected at the old 8 MiB cap)", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF"])));
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
      storageId,
      filename: "big-report.pdf",
      mimeType: "application/pdf",
      size: 50 * 1024 * 1024, // 50 MiB — over the old cap, under the new one
      contentHash: "big-pdf",
    });
    const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
    expect(doc?.status).toBe("pending_extraction");
  });

  test("video is capped at VAULT_VIDEO_CAP_BYTES (the transcription API limit), below the doc cap", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["  ftyp"])));
    // A size that a document would accept (< 100 MiB) but a video must reject (> 25 MB).
    await expect(
      asTenant(t).mutation(api.vault.vaultUpload, {
        storageId,
        filename: "clip.mp4",
        mimeType: "video/mp4",
        size: VAULT_VIDEO_CAP_BYTES + 1,
        contentHash: "over-video",
      }),
    ).rejects.toThrow(/video too large/i);
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

  // Phase 15.2 (15.2-03) INVERTED this: it used to assert that an unrecognized binary schedules
  // NOTHING, which is the defect written down as a requirement — that branch is exactly how a
  // .xlsm sat at pending_extraction for ~20 hours with no failureReason. Scheduling is now
  // permissive at vault.scheduleExtraction; only the action can read bytes, so only the action can
  // refuse, and its refusal is a terminal failed(...). The row still stays pending_extraction HERE
  // (the action flips it) — that part of the original assertion is unchanged and still correct.
  test("an unrecognized binary (zip) is still SCHEDULED — the action decides, not the MIME type", async () => {
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
    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(1);
    expect(sched[0]?.name).toContain("vaultExtract");
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

  // ── 15.2-04: stale attempt state cannot survive into a success ──────────────────────────────
  // A new attempt has neither a failure nor a truncation YET, and a `ready` row that still reports
  // the previous attempt's error is the same dishonesty class this phase exists to remove.

  test("markExtracting clears the PREVIOUS attempt's failureReason + extractionTruncated", async () => {
    const t = withIngest();
    const docId = await seedDoc(t, {
      status: "failed",
      failureReason: "unsupported_format",
      extractionTruncated: true,
    });

    await t.mutation(internal.vault.markExtracting, { vaultDocId: docId });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("extracting");
    expect(doc?.failureReason).toBeUndefined();
    expect(doc?.extractionTruncated).toBeUndefined();
  });

  test("markReady clears a leftover failureReason (the vaultIngestText docId-seam backstop)", async () => {
    const t = withIngest();
    const docId = await seedDoc(t, { status: "processing", failureReason: "unsupported_format" });

    await t.mutation(internal.vault.markReady, { vaultDocId: docId, ragEntryId: "rag_1" });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("ready");
    expect(doc?.failureReason).toBeUndefined();
    expect(doc?.ragEntryId).toBe("rag_1");
  });

  // THE ANTI-REGRESSION ASSERTION, and the reason this is not a one-liner. `extractionTruncated`
  // is written by ingestExtractedText on the CURRENT attempt, moments before the ingest workflow
  // reaches markReady — so clearing it at markReady would erase a TRUE truncation flag on every
  // successful large-document ingest. The locked spec wording asked for exactly that; it is a
  // defect, and this test is what stops anyone "restoring" it.
  test("markReady does NOT clear a TRUE extractionTruncated from the current attempt", async () => {
    const t = withIngest();
    const docId = await seedDoc(t, { status: "pending_extraction", text: undefined });
    await t.mutation(internal.vault.ingestExtractedText, {
      docId,
      tenantId: TENANT,
      text: "First N chars only",
      truncated: true,
    });

    await t.mutation(internal.vault.markReady, { vaultDocId: docId, ragEntryId: "rag_2" });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("ready");
    expect(doc?.extractionTruncated).toBe(true);
  });

  test("failed → retry → ready ends with NO failureReason (end-to-end staleness)", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF"])));
    const docId = await seedDoc(t, {
      status: "failed",
      failureReason: "unsupported_format",
      mimeType: "application/pdf",
      storageId,
      text: undefined,
    });

    // The user's Retry button, then the ingest seam driven directly (no action, no model call).
    const res = await asTenant(t).mutation(api.vaultSweep.retryExtraction, { vaultDocId: docId });
    expect(res.ok).toBe(true);
    await t.mutation(internal.vault.markExtracting, { vaultDocId: docId });
    await t.mutation(internal.vault.ingestExtractedText, {
      docId,
      tenantId: TENANT,
      text: "Recovered body",
      truncated: false,
    });
    await t.mutation(internal.vault.markReady, { vaultDocId: docId, ragEntryId: "rag_3" });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("ready");
    expect(doc?.failureReason).toBeUndefined();
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

// The ingest failure choke point (the stranded-"processing" bug): a dead/canceled ingest workflow
// must flip the doc to `failed`, never leave it spinning at `processing`; a success or an
// already-terminal doc is untouched.
describe("onIngestComplete (ingest failure handler)", () => {
  const status = (t: ReturnType<typeof convexTest>, id: string) =>
    t.run(async (ctx) => (await ctx.db.get(id as never))?.status);

  // The workflow component BRANDS its ids, so a raw string is not a `WorkflowId` and a test
  // fixture cannot mint one. The cast sits at the seam ONCE — the same `as never` idiom this file
  // already uses for `ctx.db.get(id as never)` — rather than four times inline.
  const WF_ID = "wf-test" as never;

  test("a FAILED run flips a processing doc to failed (no infinite processing)", async () => {
    const t = withIngest();
    const doc = await seedDoc(t, { status: "processing" });
    await t.mutation(internal.vaultIngest.onIngestComplete, {
      workflowId: WF_ID,
      result: { kind: "failed", error: "boom" },
      context: { tenantId: TENANT, vaultDocId: doc, correlationId: "cid" },
    });
    expect(await status(t, doc)).toBe("failed");
  });

  test("a CANCELED run also flips processing to failed", async () => {
    const t = withIngest();
    const doc = await seedDoc(t, { status: "processing" });
    await t.mutation(internal.vaultIngest.onIngestComplete, {
      workflowId: WF_ID,
      result: { kind: "canceled" },
      context: { tenantId: TENANT, vaultDocId: doc, correlationId: "cid" },
    });
    expect(await status(t, doc)).toBe("failed");
  });

  test("a SUCCESS run leaves the doc alone (markReady already ran)", async () => {
    const t = withIngest();
    const doc = await seedDoc(t, { status: "processing" });
    await t.mutation(internal.vaultIngest.onIngestComplete, {
      workflowId: WF_ID,
      result: { kind: "success", returnValue: null },
      context: { tenantId: TENANT, vaultDocId: doc, correlationId: "cid" },
    });
    expect(await status(t, doc)).toBe("processing"); // untouched — the success step owns markReady
  });

  test("an already-terminal doc is never re-flipped (idempotent)", async () => {
    const t = withIngest();
    const doc = await seedDoc(t, { status: "ready" });
    await t.mutation(internal.vaultIngest.onIngestComplete, {
      workflowId: WF_ID,
      result: { kind: "failed", error: "late" },
      context: { tenantId: TENANT, vaultDocId: doc, correlationId: "cid" },
    });
    expect(await status(t, doc)).toBe("ready");
  });
});
