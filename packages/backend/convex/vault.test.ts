// The vault ingest mutations + lifecycle + delete-cascade (VALT-01), convex-test.
//
// Registers the delivery components (workflow + workflow/workpool) so the ingest mutations can
// reach `workflow.start(ingestDoc)` — the SAME pattern cockpit.test.ts uses for executePlan. The
// durable workflow steps do NOT run synchronously under convex-test (they're scheduled); these
// tests assert the SYNCHRONOUS effects: the processing/pending row insert, hash-dedup skip,
// accept-but-defer status, the delete-cascade + orphan GC, and the tenant guard. The offline
// embed/extract seams (SMOKE::) are exercised end-to-end by the live vault smoke gate (later plan).
import { VAULT_FILE_CAP_BYTES, VAULT_VIDEO_CAP_BYTES } from "@pikar/vault";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// Register the delivery components so the ingest mutations can reach workflow.start under convex-test.
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { vaultIngestPool, workflow } from "./index";
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
  vi.spyOn(vaultIngestPool, "enqueueAction").mockImplementation((async (
    _ctx: unknown,
    fn: never,
    fnArgs: unknown,
  ) => {
    enqueuedExtractions.push({
      name: getFunctionName(fn),
      args: [fnArgs as Record<string, unknown>],
    });
    return "workId_test" as never;
  }) as never as never);
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
    const foreign = await seedDoc(t, { title: "Foreign doc" }, "tenant_b");

    const found = await smokeSearch(t, [docA, docB, loose, foreign]);

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
  // 2026-09-08: THE CASCADE REMOVED EVERYTHING EXCEPT THE FILE. It deleted the RAG chunks, the
  // graph edges and nodes and the sheet grid, then `ctx.db.delete(vaultDocId)` — and never touched
  // `doc.storageId`. So deleting ONE document orphaned its bytes exactly the way deleting the
  // whole account did, on the path a user actually walks. Same rule, two callers, one fix (§8).
  //
  // ASSERTS THE BLOB, not the row: the row assertions in this describe were all green throughout
  // the defect, which is why nobody saw it.
  // MUTATION: drop the `ctx.storage.delete(doc.storageId)` line from `deleteVaultDoc` → red.
  test("deletes the stored bytes, not only the row that points at them", async () => {
    const t = withIngest();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["the user's file"])));
    const doc = await seedDoc(t, { storageId, ragEntryId: "smoke::content-hash" });

    // NON-VACUITY: the blob is really there first, so a green result cannot mean "never stored".
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();

    expect(await asTenant(t).mutation(api.vault.deleteVaultDoc, { vaultDocId: doc })).toEqual({
      ok: true,
    });
    expect(
      await t.run((ctx) => ctx.storage.getUrl(storageId)),
      "the document row is gone but its bytes are still on disk",
    ).toBeNull();
  });

  // A doc with NO stored bytes must still delete cleanly — `storageId` is optional, and handing
  // `undefined` to `ctx.storage.delete` would throw and make the row undeletable.
  test("a row with no storageId still deletes", async () => {
    const t = withIngest();
    const doc = await seedDoc(t, { ragEntryId: "smoke::content-hash" });
    expect(await asTenant(t).mutation(api.vault.deleteVaultDoc, { vaultDocId: doc })).toEqual({
      ok: true,
    });
    expect(await t.run((ctx) => ctx.db.get(doc))).toBeNull();
  });

  test("deletes an offline SMOKE-ingested row without calling RAG with a synthetic entry id", async () => {
    const t = withIngest();
    const doc = await seedDoc(t, { status: "ready", ragEntryId: "smoke::content-hash" });

    expect(await asTenant(t).mutation(api.vault.deleteVaultDoc, { vaultDocId: doc })).toEqual({
      ok: true,
    });
    expect(await t.run((ctx) => ctx.db.get(doc))).toBeNull();
  });

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

// ── 26-11 (CONT-01): promoteToReference, the explicit trust transition ────────────────────────────
//
// Phase 18 left agent-created artifacts structurally unreachable by retrieval: `insertCreatedDoc`
// deliberately does not call `startIngest`, so there is no rag entry and no graph node to exclude.
// Promotion is the ONE door through which model-authored text enters the corpus, and a human opens
// it one row at a time.
//
// THE COUNTING RULE: ingest-once evidence is the `workflow.start` spy count and NOTHING else.
// `origin === "agent_promoted"` is inert (the schema pre-registers the literal and no retrieval
// path reads it), `ragEntryId` is never set in this file (fake timers — the workflow never runs),
// and spendLedger writes nothing at $0. Each of those would pass while promotion was broken.
describe("26-11 promoteToReference", () => {
  /** Every ingest workflow start, in call order. THE ingest-once evidence. */
  const started: { vaultDocId: string }[] = [];
  /** Local: the sibling describe's WF_ID is block-scoped to it. */
  const WF_ID = "wf-test" as never;

  beforeEach(() => {
    started.length = 0;
    vi.spyOn(workflow, "start").mockImplementation((async (
      _ctx: unknown,
      _fn: unknown,
      fnArgs: { vaultDocId?: unknown },
    ) => {
      started.push({ vaultDocId: String(fnArgs?.vaultDocId) });
      return "wf_test" as never;
    }) as never);
    // The file-level afterEach(vi.restoreAllMocks) already restores this.
  });

  /** An agent-created artifact as `insertCreatedDoc` writes it: origin "agent", ready, NO ingest. */
  const seedAgentDoc = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
    seedDoc(
      t,
      {
        title: "Q3 pricing one-pager",
        kind: "created_document",
        source: "agent",
        category: "workspace-docs",
        mimeType: "text/markdown",
        text: "Raise the retainer to $4,200.",
        origin: "agent",
        status: "ready",
        sourceThreadId: "thread_prov",
      },
      tenantId,
    );

  const rowOf = (t: ReturnType<typeof convexTest>, id: Id<"vaultDocuments">) =>
    t.run(async (ctx) => ctx.db.get(id));

  test("promoting a created document flips origin, moves it to processing and starts ingest exactly once", async () => {
    const t = withIngest();
    const docId = await seedAgentDoc(t);

    const res = await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: docId });

    expect(res).toEqual({ ok: true, state: "processing" });
    const row = await rowOf(t, docId);
    expect(row?.origin).toBe("agent_promoted");
    // NOT cosmetic: onIngestComplete early-returns on any row not in "processing", so without this
    // a failed ingest would be completely silent (see the failure test below).
    expect(row?.status).toBe("processing");
    expect(started).toEqual([{ vaultDocId: docId }]);
  });

  test("a replayed promote starts no second ingest and returns already_promoted", async () => {
    const t = withIngest();
    const docId = await seedAgentDoc(t);

    const first = await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: docId });
    // SEQUENTIAL, not concurrent: convex-test serializes mutations and this suite has no
    // concurrency primitive. A Convex mutation IS a serializable transaction, so the second call
    // re-reads "agent_promoted" and no-ops — that is the whole compare-and-swap.
    const second = await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: docId });

    expect(first).toEqual({ ok: true, state: "processing" });
    expect(second).toEqual({ ok: true, state: "already_promoted" });
    expect(started).toHaveLength(1);
  });

  test("another tenant's created document is ineligible and is left untouched", async () => {
    const t = withIngest();
    const foreign = await seedAgentDoc(t, "tenant_b");

    // A RETURN VALUE, never a throw — the deleteVaultDoc precedent. A throw would also leak that
    // the id exists; every foreign/missing outcome collapses to the same result.
    const res = await asTenant(t, TENANT).mutation(api.vault.promoteToReference, {
      vaultDocId: foreign,
    });

    expect(res).toEqual({ ok: false, reason: "ineligible" });
    const row = await rowOf(t, foreign);
    expect(row?.origin).toBe("agent");
    expect(row?.status).toBe("ready");
    expect(started).toHaveLength(0);
  });

  test("a user upload is ineligible", async () => {
    const t = withIngest();
    // `origin` ABSENT is exactly what a user upload is — seedDoc's default.
    const docId = await seedDoc(t);

    expect(await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: docId })).toEqual(
      {
        ok: false,
        reason: "ineligible",
      },
    );
    expect(started).toHaveLength(0);
  });

  test("a folder digest is ineligible", async () => {
    const t = withIngest();
    // THE case a negation-shaped guard (`origin !== undefined`) would wrongly accept. A digest is
    // already ingested; promoting it would start a second ingest for the same row.
    const docId = await seedDoc(t, { origin: "folder_digest", status: "ready" });

    expect(await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: docId })).toEqual(
      {
        ok: false,
        reason: "ineligible",
      },
    );
    expect(started).toHaveLength(0);
  });

  test("an unpromoted created document starts no ingest", async () => {
    const t = withIngest();
    await seedAgentDoc(t);
    // The structural exclusion itself: nobody promoted it, so nothing was ever ingested and there
    // is no rag entry for retrieval to reach. No origin predicate is involved anywhere.
    expect(started).toHaveLength(0);
  });

  test("a failed promotion ingest is visible and re-promotable", async () => {
    const t = withIngest();
    const docId = await seedAgentDoc(t);
    await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: docId });
    expect((await rowOf(t, docId))?.status).toBe("processing");

    await t.mutation(internal.vaultIngest.onIngestComplete, {
      workflowId: WF_ID,
      result: { kind: "failed", error: "embed step died" },
      context: { tenantId: TENANT, vaultDocId: docId, correlationId: "cid" },
    });

    const failed = await rowOf(t, docId);
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toBeTruthy();

    // Without this clause the artifact is lost for good: retryStuckIngests skips non-"processing"
    // rows, the origin guard refuses an already-promoted row, and patchCreatedDoc refuses it too.
    const retry = await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: docId });
    expect(retry).toEqual({ ok: true, state: "processing" });
    expect(started).toHaveLength(2);
    expect((await rowOf(t, docId))?.status).toBe("processing");
  });

  test("a promoted document can no longer be revised in-thread", async () => {
    const t = withIngest();
    const docId = await seedAgentDoc(t);
    await asTenant(t).mutation(api.vault.promoteToReference, { vaultDocId: docId });

    // patchCreatedDoc refuses any row whose origin !== "agent". Promotion is therefore a ONE-WAY
    // door, and the only reversal is deleting the artifact. This is an accepted ceiling, recorded
    // in vault.md — widening the guard would leave a stale rag entry on the old content hash.
    const res = await t.mutation(internal.vault.patchCreatedDoc, {
      tenantId: TENANT,
      threadId: "thread_prov",
      index: 1,
      title: "revised",
      form: "short" as const,
      markdown: "# revised",
      contentHash: "hash_revised",
    });
    expect(res).toMatchObject({ ok: false });
    expect(docId).toBeTruthy();
  });

  // NO "the promotion audit row carries refs only" TEST, because there is no audit row.
  // `promoteToReference` deliberately writes none: vaultRedaction.test.ts scans the vault content
  // plane for log-plane calls and inserts, and keeping that module log-free BY CONSTRUCTION is a
  // stronger §4 guarantee than any payload assertion could be -- vault.ts is the one module holding
  // raw document text, so the absence of the call site is the property worth protecting. The CALLER
  // audits (the shipped `vault.searched` precedent lives in llm.ts); 26-13 owns that when it builds
  // the promotion control. The invariant is enforced in vaultRedaction.test.ts, not here.
});

// ── Phase 40 (DOC-01): the sheet grid is tenant-guarded, and it dies with its document ───────────
//
// `vaultSheets` is the one table holding CELL TEXT, so it gets the same two guarantees as
// `vaultDocText`: a stranger's grid is null (never a throw — a throw would distinguish "not yours"
// from "no grid"), and the row cannot outlive the document it describes.
describe("vaultDocSheets + the delete cascade (Phase 40)", () => {
  const seedGrid = async (t: ReturnType<typeof convexTest>, tenantId: string) => {
    const docId = await t.run((ctx) =>
      ctx.db.insert("vaultDocuments", {
        tenantId,
        title: "prices.xlsx",
        kind: "upload",
        category: "workspace-docs",
        source: "upload",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size: 10,
        contentHash: `h-${tenantId}`,
        text: "Sheet 1\nItem\tCost",
        status: "ready",
        createdAt: Date.now(),
      }),
    );
    await t.mutation(internal.vault.upsertSheets, {
      tenantId,
      docId,
      sheets: [
        {
          name: "Prices",
          rows: [
            ["Item", "Cost"],
            ["Rent", "1200"],
          ],
          totalRows: 2,
        },
      ],
      sheetCount: 1,
    });
    return docId;
  };

  test("the owner reads the grid; another tenant reads null, not an error", async () => {
    const t = convexTest(schema, modules);
    const docId = await seedGrid(t, "tenant_a");

    const mine = await asTenant(t, "tenant_a").query(api.vault.vaultDocSheets, {
      vaultDocId: docId,
    });
    expect(mine?.sheetCount).toBe(1);
    expect(mine?.sheets[0]?.name).toBe("Prices"); // the name the text projection cannot carry
    expect(mine?.sheets[0]?.rows[0]).toEqual(["Item", "Cost"]);

    expect(
      await asTenant(t, "tenant_b").query(api.vault.vaultDocSheets, { vaultDocId: docId }),
    ).toBeNull();
  });

  test("re-writing a grid replaces it, and an empty read is null rather than an empty grid", async () => {
    const t = convexTest(schema, modules);
    const docId = await seedGrid(t, "tenant_a");

    await t.mutation(internal.vault.upsertSheets, {
      tenantId: "tenant_a",
      docId,
      sheets: [{ name: "Costs", rows: [["A"]], totalRows: 1 }],
      sheetCount: 1,
    });
    const rows = await t.run((ctx) => ctx.db.query("vaultSheets").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sheets[0]?.name).toBe("Costs");

    // Zero sheets means "no grid", which is the state the preview already handles — so the row goes
    // rather than becoming a second, emptier empty state.
    await t.mutation(internal.vault.upsertSheets, {
      tenantId: "tenant_a",
      docId,
      sheets: [],
      sheetCount: 0,
    });
    expect(await t.run((ctx) => ctx.db.query("vaultSheets").collect())).toEqual([]);
    expect(
      await asTenant(t, "tenant_a").query(api.vault.vaultDocSheets, { vaultDocId: docId }),
    ).toBeNull();
  });

  test("a grid written after its document was deleted is dropped, not orphaned", async () => {
    // The real window: the grid is written seconds after the text, following a full SheetJS parse,
    // and Delete is armed on the card that whole time. Without the existence guard the insert
    // succeeds against a dead id and nothing can ever reach or clean it.
    // MUTATION that turns this RED: drop the ctx.db.get guard in upsertSheets.
    const t = convexTest(schema, modules);
    const docId = await seedGrid(t, "tenant_a");
    await asTenant(t, "tenant_a").mutation(api.vault.deleteVaultDoc, { vaultDocId: docId });

    await t.mutation(internal.vault.upsertSheets, {
      tenantId: "tenant_a",
      docId,
      sheets: [{ name: "Late", rows: [["x"]], totalRows: 1 }],
      sheetCount: 1,
    });

    expect(await t.run((ctx) => ctx.db.query("vaultSheets").collect())).toEqual([]);
  });

  test("deleting the document deletes its grid — no cell text survives its document", async () => {
    // MUTATION that turns this RED: drop the vaultSheets delete from deleteVaultDoc.
    const t = convexTest(schema, modules);
    const docId = await seedGrid(t, "tenant_a");

    await asTenant(t, "tenant_a").mutation(api.vault.deleteVaultDoc, { vaultDocId: docId });

    expect(await t.run((ctx) => ctx.db.get(docId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("vaultSheets").collect())).toEqual([]);
  });
});
