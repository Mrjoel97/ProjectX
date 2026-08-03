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
// vault.scheduleExtraction, which schedules unconditionally. The two tests that used to assert
// "an unrecognized mime schedules nothing" asserted the DEFECT as a requirement; they are inverted
// here, and the watchdog gets its own idempotence suite.
//
// Phase 15.3 (15.3-04) moved the WATCHDOG ARM out of scheduleExtraction and into
// vault.markExtracting: the clock now starts when work starts, so a document queued behind 400
// folder members is not marked stalled while healthy. Every assertion below that used to read
// "scheduling also armed a watchdog" therefore reads ZERO — the arm has its own coverage in
// vaultFolders.test.ts, driven from markExtracting.
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Fake timers — the `vault.test.ts` / `vaultExtract.test.ts` guard, applied here for the same
// reason (2026-08-04). Anything that reaches `startIngest` schedules the WORKFLOW component's
// workpool functions; under real timers they fire after this file finishes and retry-loop against a
// torn-down module runner, throwing `crypto is not defined` / `process is not defined` inside
// whichever file the worker runs next. These tests assert synchronous effects, so the timers never
// need to advance.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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

/** The per-attempt watchdogs armed so far. Since 15.3-04 these are armed by vault.markExtracting
 *  (work-start), NEVER by a scheduling mutation — which is what the zeroes below assert. */
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

    // Observable work: the extraction rail. The watchdog is NOT armed here any more — a Retry
    // that queues behind a folder must not carry a clock that expires while it waits.
    const sched = await extractionScheduled(t);
    expect(sched).toHaveLength(1);
    expect(sched[0]?.name).toContain("vaultExtract");
    expect(await watchdogScheduled(t)).toHaveLength(0);
  });
});

// ── The never-silent guarantee (Phase 15.2 SC#4) ─────────────────────────────

describe("watchdogStalled — the per-attempt backstop for work that STARTED and hung", () => {
  const fire = (t: ReturnType<typeof convexTest>, vaultDocId: Id<"vaultDocuments">) =>
    t.mutation(internal.vaultSweep.watchdogStalled, { vaultDocId });

  test("a row still at extracting is flipped to failed(extraction_stalled)", async () => {
    const t = setup();
    const docId = await seedDoc(t, { status: "extracting" });

    await fire(t, docId);

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("failed");
    expect(doc?.failureReason).toBe("extraction_stalled");
  });

  // THE 15.3-04 NARROWING, and the reason it is not a regression. The arm now fires from
  // markExtracting, which sets `extracting` in the SAME transaction — so a fire that finds
  // `pending_extraction` can only mean the row was RE-QUEUED after this clock started (a Retry, or
  // the sweep). Killing that is the fabricated failure the phase exists to delete: a healthy retry
  // sitting behind 400 folder members, executed by the previous attempt's stale clock.
  test("a row re-queued to pending_extraction is NOT killed by the previous attempt's clock", async () => {
    const t = setup();
    const docId = await seedDoc(t, { status: "pending_extraction" });

    await fire(t, docId);

    const doc = await t.run((ctx) => ctx.db.get(docId));
    expect(doc?.status).toBe("pending_extraction");
    expect(doc?.failureReason).toBeUndefined();
  });

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

describe("vaultUpload schedules permissively and arms NO watchdog (15.3-04)", () => {
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

  test("the owner's .xlsm — previously scheduled NOTHING — now schedules extractDoc and arms NO watchdog at queue time", async () => {
    const t = setup();
    const docId = await upload(t, XLSM_MIME, "budget.xlsm");

    expect((await t.run((ctx) => ctx.db.get(docId)))?.status).toBe("pending_extraction");

    const rail = await extractionScheduled(t);
    expect(rail).toHaveLength(1);
    expect(rail[0]?.name).toContain("vaultExtract");

    // NO watchdog at queue time. The clock starts at markExtracting, and THAT arm (+15 min from
    // work start, per attempt) is asserted in vaultFolders.test.ts — there is deliberately no
    // timing assertion here, because there is nothing armed to time.
    expect(await watchdogScheduled(t)).toHaveLength(0);
  });

  test("an EMPTY mimeType still schedules extractDoc (the allow-list no longer decides)", async () => {
    const t = setup();
    await upload(t, "", "mystery.bin");

    const rail = await extractionScheduled(t);
    expect(rail).toHaveLength(1);
    expect(rail[0]?.name).toContain("vaultExtract");
    expect(await watchdogScheduled(t)).toHaveLength(0);
  });

  test("media still rides the transcribe rail by MIME — and is queued, not watched", async () => {
    const t = setup();
    await upload(t, "video/mp4", "clip.mp4");

    const rail = await extractionScheduled(t);
    expect(rail).toHaveLength(1);
    expect(rail[0]?.name).toContain("vaultTranscribe");
    expect(await watchdogScheduled(t)).toHaveLength(0);
  });
});
