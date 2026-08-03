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
//
// Phase 15.2 (15.2-03) added the NEVER-SILENT half: all three scheduling sites now route through
// vault.scheduleExtraction, which schedules unconditionally and arms watchdogStalled per attempt.
// The two tests that used to assert "an unrecognized mime schedules nothing" asserted the DEFECT
// as a requirement; they are inverted here, and the watchdog gets its own idempotence suite.
import { EXTRACTION_WATCHDOG_MS } from "@pikar/vault";
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import migrationsSchema from "../node_modules/@convex-dev/migrations/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { vaultIngestPool } from "./index";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
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
beforeEach(() => {
  enqueuedExtractions.length = 0;
  vi.spyOn(vaultIngestPool, "enqueueAction").mockImplementation(
    async (_ctx: unknown, fn: never, fnArgs: unknown) => {
      enqueuedExtractions.push({
        name: getFunctionName(fn),
        args: [fnArgs as Record<string, unknown>],
      });
      return "workId_test" as never;
    },
  );
});
afterEach(() => vi.restoreAllMocks());

/** The extraction actions enqueued so far. */
const extractionScheduled = (_t?: unknown) => enqueuedExtractions;

/** The per-attempt watchdogs armed so far — the other half of every scheduling decision. */
const watchdogScheduled = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) =>
      /watchdogStalled/.test(s.name),
    ),
  );

/** The owner's stuck file: an .xlsm, which no allow-list in this repo ever recognised. */
const XLSM_MIME = "application/vnd.ms-excel.sheet.macroEnabled.12";

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

  // THE OFFLINE REHEARSAL OF THE LIVE GATE (SC#7). This test previously asserted the OPPOSITE —
  // that an unrecognized mime was skipped — which is the defect stated as a requirement. The sweep
  // is the recovery mechanism for the stranded .xlsm, so it must now pick that row UP. The
  // no-storageId skip survives: that guard scopes the sweep, it does not guess at formats.
  test("sweeps the unrecognized .xlsm row and still skips ready rows and rows with no storageId", async () => {
    const t = setup();
    const xlsmId = await seedDoc(t, { title: "budget.xlsm", mimeType: XLSM_MIME });
    const readyId = await seedDoc(t, { status: "ready" });
    await seedDoc(t, { storageId: undefined });

    await runOneBatch(t);

    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(1);
    expect(sched[0]?.name).toContain("vaultExtract");
    expect(String(sched[0]?.args[0]?.vaultDocId)).toBe(String(xlsmId));
    expect((await t.run((ctx) => ctx.db.get(readyId)))?.status).toBe("ready");
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

  test("Retry no longer returns a silent {ok:false} for an unknown format", async () => {
    const t = setup();
    const docId = await seedDoc(t, {
      title: "archive.zip",
      mimeType: "application/zip",
      status: "failed",
      failureReason: "x",
    });

    const res = await asTenant(t).mutation(api.vaultSweep.retryExtraction, { vaultDocId: docId });
    expect(res).toEqual({ ok: true });

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("pending_extraction");
    expect(doc?.failureReason).toBeUndefined();

    // Observable work: the extraction rail AND a fresh per-attempt watchdog.
    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(1);
    expect(sched[0]?.name).toContain("vaultExtract");
    expect(await watchdogScheduled(t)).toHaveLength(1);
  });
});

// ── The never-silent guarantee (Phase 15.2 SC#4) ─────────────────────────────

describe("watchdogStalled — the per-attempt backstop for the non-terminal statuses", () => {
  const fire = (t: ReturnType<typeof convexTest>, vaultDocId: Id<"vaultDocuments">) =>
    t.mutation(internal.vaultSweep.watchdogStalled, { vaultDocId });

  test.each(["pending_extraction", "extracting"] as const)(
    "a row still at %s is flipped to failed(extraction_stalled)",
    async (status) => {
      const t = setup();
      const docId = await seedDoc(t, { status });

      await fire(t, docId);

      const doc = await t.run((ctx) => ctx.db.get(docId));
      expect(doc?.status).toBe("failed");
      expect(doc?.failureReason).toBe("extraction_stalled");
    },
  );

  // The onIngestComplete idempotence property: a watchdog firing one second after a success (or
  // after an honest, more specific failure) must change NOTHING.
  test.each(["ready", "processing"] as const)("a row at %s is untouched", async (status) => {
    const t = setup();
    const docId = await seedDoc(t, { status });

    await fire(t, docId);

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe(status);
    expect(doc?.failureReason).toBeUndefined();
  });

  test("a failed row keeps its ORIGINAL reason — extraction_stalled never overwrites unsupported_format", async () => {
    const t = setup();
    const docId = await seedDoc(t, { status: "failed", failureReason: "unsupported_format" });

    await fire(t, docId);

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("unsupported_format");
  });

  test("a deleted doc is a silent no-op — no throw, no write", async () => {
    const t = setup();
    const docId = await seedDoc(t);
    await t.run((ctx) => ctx.db.delete(docId));

    await expect(fire(t, docId)).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(docId))).toBeNull();
  });
});

describe("vaultUpload schedules permissively and ALWAYS arms a watchdog", () => {
  /** Upload through the REAL public mutation (the first of scheduleExtraction's three callers). */
  const upload = async (t: ReturnType<typeof convexTest>, mimeType: string, filename: string) => {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
    const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
      storageId,
      filename,
      mimeType,
      size: 803_281,
      contentHash: `h-${Math.random()}`,
    });
    return vaultDocId;
  };

  test("the owner's .xlsm — previously scheduled NOTHING — now schedules extractDoc + a +15min watchdog", async () => {
    const t = setup();
    // The reference point for the watchdog delta is WALL CLOCK, not the sibling scheduled row:
    // 15.3-04 moved the extraction enqueue onto `vaultIngestPool`, so there is no app-side
    // `_scheduled_functions` entry to measure against any more.
    const before = Date.now();
    const docId = await upload(t, XLSM_MIME, "budget.xlsm");

    expect((await t.run((ctx) => ctx.db.get(docId)))?.status).toBe("pending_extraction");

    const rail = await extractionScheduled(t);
    expect(rail).toHaveLength(1);
    expect(rail[0]?.name).toContain("vaultExtract");

    const watchdog = await watchdogScheduled(t);
    expect(watchdog).toHaveLength(1);
    expect(watchdog[0]?.args[0]).toMatchObject({ vaultDocId: docId });
    // Per-attempt, and armed well past any honest run (the 480s call ceiling / 10-min action limit).
    // A window, not an equality: the arm reads Date.now() itself, so the delta is the constant plus
    // however many milliseconds elapsed since `before`.
    const [watchdogEntry] = watchdog;
    if (!watchdogEntry) throw new Error("a watchdog must be armed");
    const delta = watchdogEntry.scheduledTime - before;
    expect(delta).toBeGreaterThanOrEqual(EXTRACTION_WATCHDOG_MS);
    expect(delta).toBeLessThan(EXTRACTION_WATCHDOG_MS + 1000);
  });

  test("an EMPTY mimeType still schedules extractDoc (the allow-list no longer decides)", async () => {
    const t = setup();
    await upload(t, "", "mystery.bin");

    const rail = await extractionScheduled(t);
    expect(rail).toHaveLength(1);
    expect(rail[0]?.name).toContain("vaultExtract");
    expect(await watchdogScheduled(t)).toHaveLength(1);
  });

  test("media still rides the transcribe rail by MIME — and is watched too", async () => {
    const t = setup();
    await upload(t, "video/mp4", "clip.mp4");

    const rail = await extractionScheduled(t);
    expect(rail).toHaveLength(1);
    expect(rail[0]?.name).toContain("vaultTranscribe");
    expect(await watchdogScheduled(t)).toHaveLength(1);
  });
});
