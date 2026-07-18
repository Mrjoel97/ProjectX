// EXTR-G — the migrations-based backlog sweep + retryExtraction (Phase 3.8 Lane 3), convex-test.
//
// The sweep is driven DIRECTLY as the internal mutation migrations.define returns, in its
// documented one-off mode ({ cursor: null, oneBatchOnly: true }) — one batch runs synchronously
// with no component round-trip, which is exactly what an offline test wants. The migrations
// component is registered anyway (intake.test.ts's rateLimiter registration pattern, adapted)
// so the module graph loads clean and the runner path stays representable.
//
// Assertions ride the _scheduled_functions system table (vault.test.ts's inspection pattern):
// the sweep/retry must schedule the Wave-0 stub NAMES (vaultExtract.extractDoc /
// vaultTranscribe.transcribeDoc) by kind — never import Lane 1/4 modules.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import migrationsSchema from "../node_modules/@convex-dev/migrations/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const migrationsModules = import.meta.glob(
  "../node_modules/@convex-dev/migrations/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_sweep";

function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("migrations", migrationsSchema, migrationsModules);
  return t;
}

const asTenant = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

/** The extraction actions scheduled so far (vault.test.ts's system-table inspection pattern). */
const extractionScheduled = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) =>
      /vaultExtract|vaultTranscribe/.test(s.name),
    ),
  );

/** Raw-insert a vault doc row (bypasses the ingest mutation — sweep operates on existing rows). */
const seedDoc = (
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
  tenantId = TENANT,
) =>
  t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "seed.pdf",
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "application/pdf",
      size: 1,
      contentHash: `c-${Math.random()}`,
      storageId: await ctx.storage.store(new Blob(["bytes"])),
      status: "pending_extraction",
      createdAt: Date.now(),
      ...overrides,
    }),
  );

/** One synchronous sweep batch (the documented one-off mode — no component round-trip). */
const runOneBatch = (t: ReturnType<typeof convexTest>) =>
  t.mutation(internal.vaultSweep.sweepPendingExtraction, {
    cursor: null,
    batchSize: 100,
    dryRun: false,
    oneBatchOnly: true,
  });

describe("sweepPendingExtraction (EXTR-G backlog sweep)", () => {
  test("schedules extractDoc for a pending pdf and transcribeDoc for a pending mp4, with {vaultDocId, tenantId}", async () => {
    const t = setup();
    const pdfId = await seedDoc(t);
    const mp4Id = await seedDoc(t, { title: "clip.mp4", mimeType: "video/mp4" });

    await runOneBatch(t);

    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(2);
    const byDoc = new Map(sched.map((s) => [String(s.args[0]?.vaultDocId), s]));
    expect(byDoc.get(String(pdfId))?.name).toContain("vaultExtract");
    expect(byDoc.get(String(mp4Id))?.name).toContain("vaultTranscribe");
    for (const s of sched) expect(s.args[0]).toMatchObject({ tenantId: TENANT });
  });

  test("leaves ready/processing/failed rows untouched and schedules nothing for them", async () => {
    const t = setup();
    const readyId = await seedDoc(t, { status: "ready" });
    const processingId = await seedDoc(t, { status: "processing" });
    const failedId = await seedDoc(t, { status: "failed", failureReason: "kill_switch" });

    await runOneBatch(t);

    expect(await extractionScheduled(t)).toHaveLength(0);
    for (const [id, status] of [
      [readyId, "ready"],
      [processingId, "processing"],
      [failedId, "failed"],
    ] as const) {
      const doc = await t.run((ctx) => ctx.db.get(id));
      expect(doc?.status).toBe(status);
    }
  });

  test("skips unrecognized mime (application/zip) and rows with no storageId", async () => {
    const t = setup();
    await seedDoc(t, { title: "archive.zip", mimeType: "application/zip" });
    await seedDoc(t, { storageId: undefined });

    await runOneBatch(t);

    expect(await extractionScheduled(t)).toHaveLength(0);
  });

  test("a swept row's status stays pending_extraction (the action flips it, not the sweep)", async () => {
    const t = setup();
    const pdfId = await seedDoc(t);

    await runOneBatch(t);

    const doc = await t.run((ctx) => ctx.db.get(pdfId));
    expect(doc?.status).toBe("pending_extraction");
  });
});

describe("retryExtraction (EXTR-G retry mutation)", () => {
  test("a failed pdf resets to pending_extraction, clears failureReason + extractionTruncated, schedules extractDoc", async () => {
    const t = setup();
    const docId = await seedDoc(t, {
      status: "failed",
      failureReason: "not_implemented",
      extractionTruncated: true,
    });

    const res = await asTenant(t).mutation(api.vaultSweep.retryExtraction, { vaultDocId: docId });
    expect(res).toEqual({ ok: true });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("pending_extraction");
    expect(doc?.failureReason).toBeUndefined();
    expect(doc?.extractionTruncated).toBeUndefined();

    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(1);
    expect(sched[0]?.name).toContain("vaultExtract");
    expect(sched[0]?.args[0]).toMatchObject({ vaultDocId: docId, tenantId: TENANT });
  });

  test("a failed mp4 retries down the transcribe rail", async () => {
    const t = setup();
    const docId = await seedDoc(t, {
      title: "clip.mp4",
      mimeType: "video/mp4",
      status: "failed",
      failureReason: "unsupported_video_container",
    });

    const res = await asTenant(t).mutation(api.vaultSweep.retryExtraction, { vaultDocId: docId });
    expect(res).toEqual({ ok: true });

    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(1);
    expect(sched[0]?.name).toContain("vaultTranscribe");
  });

  test("a stuck pending_extraction doc can be retried (manual kick)", async () => {
    const t = setup();
    const docId = await seedDoc(t); // pending_extraction

    const res = await asTenant(t).mutation(api.vaultSweep.retryExtraction, { vaultDocId: docId });
    expect(res).toEqual({ ok: true });
    expect(await extractionScheduled(t)).toHaveLength(1);
  });

  test("retry on a ready doc is a no-op", async () => {
    const t = setup();
    const docId = await seedDoc(t, { status: "ready" });

    const res = await asTenant(t).mutation(api.vaultSweep.retryExtraction, { vaultDocId: docId });
    expect(res).toEqual({ ok: false });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("ready");
    expect(await extractionScheduled(t)).toHaveLength(0);
  });

  test("cross-tenant retry is a fail-closed no-op", async () => {
    const t = setup();
    const docId = await seedDoc(t, { status: "failed", failureReason: "x" }, "tenant_other");

    const res = await asTenant(t).mutation(api.vaultSweep.retryExtraction, { vaultDocId: docId });
    expect(res).toEqual({ ok: false });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("x");
    expect(await extractionScheduled(t)).toHaveLength(0);
  });

  test("retry on an unrecognized mime is a no-op (no rail to schedule)", async () => {
    const t = setup();
    const docId = await seedDoc(t, {
      title: "archive.zip",
      mimeType: "application/zip",
      status: "failed",
      failureReason: "x",
    });

    const res = await asTenant(t).mutation(api.vaultSweep.retryExtraction, { vaultDocId: docId });
    expect(res).toEqual({ ok: false });
    expect(await extractionScheduled(t)).toHaveLength(0);
  });
});
