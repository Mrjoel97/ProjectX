// The 15.3-04 folder-orchestration guarantees, convex-test.
//
// What this file is FOR: a folder ingest must not starve the delivery spine, must not fabricate
// failures at queue depth, must complete exactly once, and must be cancellable without writing a
// single vaultDocuments row. Each guarantee is one describe block, and each carries the MUTATION
// that was actually run against it (`Mutation RUN:` — the guardrails.test.ts convention). A green
// suite that does not sample its own guarantee is the failure mode this phase hit twice.
import { EXTRACTION_WATCHDOG_MS } from "@pikar/vault";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { INGEST_DAILY_BUDGET_CENTS } from "./guardrails";
import { vaultIngestPool } from "./index";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

const TENANT = "tenant_folders";

/** Extraction enqueues recorded off the pool — see vault.test.ts for why this is a spy and not
 *  the `_scheduled_functions` system table. */
const enqueued: { name: string; args: [Record<string, unknown>] }[] = [];
beforeEach(() => {
  enqueued.length = 0;
  // The generic signature of `enqueueAction` cannot be satisfied by a concrete stub, so the
  // implementation is cast once here rather than typed twice.
  vi.spyOn(vaultIngestPool, "enqueueAction").mockImplementation((async (
    _ctx: unknown,
    fn: never,
    fnArgs: unknown,
  ) => {
    enqueued.push({ name: getFunctionName(fn), args: [fnArgs as Record<string, unknown>] });
    return "workId_test" as never;
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

/** Plain harness — enough for everything that never touches the budget rail. */
const setup = () => convexTest(schema, modules);

/** The REAL rate-limiter + workflow components, for reserve / settle / dispatch. */
function budgetHarness(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const asTenant = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

const remaining = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.query(internal.guardrails.ingestRemainingCents, { tenantId });

/** Cents the estimator charges for one 1 KB text file at the CURRENT `DEFAULT_MODEL` input rate —
 *  the same constant `guardrails.test.ts` pins, and it must be read together with that one. It was
 *  1 under `gpt-4o-mini` ($0.15/MTok); the 2026-08-07 Gemini repoint doubled the rate to $0.30; the
 *  2026-08-08 revert to `gpt-4o-mini` (OpenAI balance topped up) halved it BACK, so a manifest of N
 *  files reserves N cents again. Kept a literal on purpose: derived from
 *  `PRICING` it would agree with itself and stop testing the arithmetic. */
const CENTS_PER_FILE = 1;
/** A manifest of N 1 KB text files. Its reservation is `N * CENTS_PER_FILE`. */
const manifestOf = (files: number) =>
  Array.from({ length: files }, () => ({ size: 1_000, mimeType: "text/plain" }));
/** Cents a manifest of `files` files reserves — use this instead of writing the number twice. */
const costOf = (files: number) => files * CENTS_PER_FILE;

/** The per-attempt watchdogs armed so far. */
const watchdogs = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) =>
      /watchdogStalled/.test(s.name),
    ),
  );

/**
 * Enqueues recorded for ONE tenant.
 *
 * ⚠ `enqueued` IS SHARED AND IS WRITTEN TO BY OTHER TESTS. convex-test never runs a
 * `scheduler.runAfter` entry inside the test that created it (verified: it stays `{kind:"pending"}`
 * through `finishInProgressScheduledFunctions` AND `finishAllScheduledFunctions`) — it runs during
 * a LATER test, against its own instance, and pushes into this array. Filtering by document id
 * would not discriminate: convex-test ids restart at `00000000000000010000<table>` per instance, so
 * every instance's first document has the SAME id. The tenant string is chosen by the test, so it
 * is the one field that cannot collide. Anything that COUNTS enqueues uses its own tenant.
 */
const enqueuedFor = (tenantId: string) => enqueued.filter((e) => e.args[0]?.tenantId === tenantId);

const newFolder = async (
  t: ReturnType<typeof convexTest>,
  tenantId = TENANT,
): Promise<Id<"vaultFolders">> => {
  const { folderId } = await asTenant(t, tenantId).mutation(api.vaultFolders.createFolder, {
    name: "Company docs",
    source: "upload",
  });
  return folderId;
};

/** Upload a binary through the REAL public mutation, optionally into a folder. */
const upload = async (
  t: ReturnType<typeof convexTest>,
  opts: {
    folderId?: Id<"vaultFolders">;
    hash?: string;
    filename?: string;
    mimeType?: string;
    tenant?: string;
  } = {},
): Promise<{ vaultDocId: Id<"vaultDocuments">; deduped: boolean }> => {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  return await asTenant(t, opts.tenant ?? TENANT).mutation(api.vault.vaultUpload, {
    storageId,
    filename: opts.filename ?? "report.pdf",
    mimeType: opts.mimeType ?? "application/pdf",
    size: 5,
    contentHash: opts.hash ?? `h-${Math.random()}`,
    ...(opts.folderId ? { folderId: opts.folderId } : {}),
  });
};

const folderRow = (t: ReturnType<typeof convexTest>, folderId: Id<"vaultFolders">) =>
  t.run((ctx) => ctx.db.get(folderId));

/** Member walks scheduled but not yet run. convex-test leaves a `scheduler.runAfter` entry at
 *  `{kind:"pending"}` and never executes it, which is exactly why section 6 invokes the walk
 *  directly rather than trusting the scheduler to have run it. */
const scheduledWalks = (t: ReturnType<typeof convexTest>, mode: string) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (s) => /walkFolderMembers/.test(s.name) && (s.args[0] as { mode?: string })?.mode === mode,
    ),
  );

// ── 1. The watchdog must not kill QUEUED work (15.3-CONTEXT §B2) ─────────────
//
// convex-test has no clock to advance, so "a document whose extraction starts 40 minutes after it
// was scheduled" cannot be simulated by moving time. The only observable is WHAT was armed and
// WHEN — and that is enough, because the whole defect was arming from the wrong transaction. A
// document sitting in the pool's queue has had no watchdog armed at all; its 15 minutes start when
// `markExtracting` runs, i.e. when work actually starts, so queue depth cannot reach it.
//
// Mutation RUN (this is the plan's own before/after proof): with the arm still in
// `vault.scheduleExtraction`, BOTH tests below are RED — `vaultUpload` armed 1 watchdog, not 0.
// Moving the arm into `markExtracting` turned them green with no test edit.
describe("the watchdog measures WORK time, not queue time", () => {
  test("vaultUpload arms ZERO watchdogs — queueing is not an attempt", async () => {
    const t = setup();
    await upload(t);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.name).toContain("vaultExtract");
    // The whole fix: 400 documents behind VAULT_INGEST_PARALLELISM arm 400 clocks at upload time
    // under the old shape, and every one of them fires while its document is still healthy.
    expect(await watchdogs(t)).toHaveLength(0);
  });

  test("markExtracting arms exactly ONE, at +EXTRACTION_WATCHDOG_MS from work start", async () => {
    const t = setup();
    const { vaultDocId } = await upload(t);
    expect(await watchdogs(t)).toHaveLength(0);

    const before = Date.now();
    await t.mutation(internal.vault.markExtracting, { vaultDocId });

    const armed = await watchdogs(t);
    expect(armed).toHaveLength(1);
    expect(armed[0]?.args[0]).toMatchObject({ vaultDocId });
    // A window, not an equality: the arm reads Date.now() inside the mutation.
    const delta = (armed[0]?.scheduledTime ?? 0) - before;
    expect(delta).toBeGreaterThanOrEqual(EXTRACTION_WATCHDOG_MS);
    expect(delta).toBeLessThan(EXTRACTION_WATCHDOG_MS + 1000);
    expect((await t.run((ctx) => ctx.db.get(vaultDocId)))?.status).toBe("extracting");
  });
});

// ── 2. Completion fires exactly once, after the LAST member ──────────────────

describe("a folder completes exactly once, and only after its last member goes terminal", () => {
  // Mutation RUN: replace `countTerminal`'s prior-status guard with a post-state test
  // (`if (after.status !== "ready" && after.status !== "failed") return`) -> RED. The re-entrant
  // markReady at the end counts a second time, terminalCount reads 4 against a memberCount of 3,
  // and on a folder that had NOT yet completed it would sail past the equality forever.
  //
  // NOT sampled, and stated rather than implied: `tryComplete`'s `terminalCount < memberCount`
  // (i.e. complete on `>=`) versus `!==` is DEFENCE IN DEPTH behind the guard above. Counters move
  // by exactly +1, so with the transition guard in place terminalCount can never overshoot and no
  // reachable sequence distinguishes the two. `>=` is kept because it is the shape that survives
  // the guard being weakened by a later edit, which is precisely the mutation below.
  test("three members, three rails, one completion — and a replayed markReady is a no-op", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    const a = (await upload(t, { folderId, hash: "m-a" })).vaultDocId;
    const b = (await upload(t, { folderId, hash: "m-b" })).vaultDocId;
    const c = (await upload(t, { folderId, hash: "m-c" })).vaultDocId;

    const reserved = await asTenant(t).mutation(api.vaultFolders.reserveFolder, {
      folderId,
      files: manifestOf(3),
    });
    expect(reserved).toMatchObject({ ok: true, estCents: costOf(3) });
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS - costOf(3));
    expect(await folderRow(t, folderId)).toMatchObject({
      status: "ingesting",
      memberCount: 3,
      terminalCount: 0,
    });

    // (i) workflow success
    await t.mutation(internal.vault.markReady, { vaultDocId: a, ragEntryId: "entry_a" });
    expect(await folderRow(t, folderId)).toMatchObject({ status: "ingesting", terminalCount: 1 });

    // (ii) an honest per-document failure
    await t.mutation(internal.vault.markFailed, { vaultDocId: b, reason: "unsupported_format" });
    expect(await folderRow(t, folderId)).toMatchObject({
      status: "ingesting",
      terminalCount: 2,
      failedCount: 1,
    });

    // (iii) the watchdog rail — work started, then hung
    await t.mutation(internal.vault.markExtracting, { vaultDocId: c });
    await t.mutation(internal.vaultSweep.watchdogStalled, { vaultDocId: c });
    expect((await t.run((ctx) => ctx.db.get(c)))?.failureReason).toBe("extraction_stalled");

    // THE completion transition: settle (reservedCents cleared, window credited back) then unseal.
    expect(await folderRow(t, folderId)).toMatchObject({
      status: "complete",
      memberCount: 3,
      terminalCount: 3,
      failedCount: 2,
      reservedCents: 0,
    });
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS);

    // Re-entrant terminal write (a workflow mutation whose journal write failed is re-run).
    const windowAfter = await remaining(t);
    await t.mutation(internal.vault.markReady, { vaultDocId: a, ragEntryId: "entry_a" });
    expect(await folderRow(t, folderId)).toMatchObject({ status: "complete", terminalCount: 3 });
    expect(await remaining(t)).toBe(windowAfter); // no second refund
  });

  // The premature-completion race the ordering exists to prevent: while the folder is still
  // `reserving`, members are arriving one at a time, so terminalCount === memberCount is TRUE at
  // 1 === 1 and would settle + synthesise a third of a folder.
  // Mutation RUN: flip the folder to `ingesting` inside `createFolder` instead of `reserveFolder`
  // -> RED, the folder below reads `complete` with memberCount 1 while two members are missing.
  test("a member going terminal BEFORE the reservation cannot complete the folder", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    const a = (await upload(t, { folderId, hash: "e-a" })).vaultDocId;

    await t.mutation(internal.vault.markReady, { vaultDocId: a, ragEntryId: "entry_a" });

    const f = await folderRow(t, folderId);
    expect(f).toMatchObject({ status: "reserving", memberCount: 1, terminalCount: 1 });
    // and a second member can still be added, which is the point of the window
    await upload(t, { folderId, hash: "e-b" });
    expect(await folderRow(t, folderId)).toMatchObject({ memberCount: 2 });
  });

  test("a member cannot be added after the close signal", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    await upload(t, { folderId, hash: "late-a" });
    await asTenant(t).mutation(api.vaultFolders.reserveFolder, { folderId, files: manifestOf(1) });

    await expect(upload(t, { folderId, hash: "late-b" })).rejects.toThrow(
      /folder not open for members/,
    );
    expect(await folderRow(t, folderId)).toMatchObject({ memberCount: 1 });
  });
});

// ── 3. Completion is READ-CHEAP ──────────────────────────────────────────────

describe("completion is O(1) — the probe never reads the member rows", () => {
  const BIG = "x".repeat(400_000); // VAULT_EXTRACT_CHAR_CAP: one max-size member row
  const MEMBERS = 50; // 50 x 400 KB = 20 MB, comfortably over the 16 MiB read cap

  /** Seed a folder one terminal event away from completing, with fat member rows. */
  const seedFatFolder = async (t: ReturnType<typeof convexTest>) => {
    const folderId = await t.run((ctx) =>
      ctx.db.insert("vaultFolders", {
        tenantId: TENANT,
        name: "fat",
        source: "upload" as const,
        status: "ingesting" as const,
        memberCount: MEMBERS,
        terminalCount: MEMBERS - 1,
        failedCount: 0,
        reservedCents: 0,
        spentCents: 0,
        reservedAt: Date.now(),
        createdAt: Date.now(),
      }),
    );
    // ONE ROW PER TRANSACTION on purpose: 50 x 400 KB in a single `t.run` trips the WRITE cap,
    // which is the same 16 MiB ceiling from the other side and would prove nothing about reads.
    const ids: Id<"vaultDocuments">[] = [];
    for (let i = 0; i < MEMBERS; i++) {
      ids.push(
        await t.run((ctx) =>
          ctx.db.insert("vaultDocuments", {
            tenantId: TENANT,
            title: `m${i}`,
            kind: "upload",
            category: "my-uploads",
            source: "upload",
            mimeType: "text/plain",
            size: BIG.length,
            contentHash: `fat-${i}`,
            text: BIG,
            status: i === 0 ? "processing" : "ready",
            folderId,
            createdAt: Date.now(),
          }),
        ),
      );
    }
    return { folderId, last: ids[0] as Id<"vaultDocuments"> };
  };

  test("the LAST member completes a 50-member folder inside the transaction read cap", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { folderId, last } = await seedFatFolder(t);

    await t.mutation(internal.vault.markReady, { vaultDocId: last, ragEntryId: "entry_last" });

    expect(await folderRow(t, folderId)).toMatchObject({
      status: "complete",
      terminalCount: MEMBERS,
    });
  });

  // THE MUTATION, run as an assertion rather than left as a comment: this is what completion would
  // cost if it probed `by_tenant_folder` instead of reading a counter. Convex has no projection, so
  // the probe reads every member's `text` blob and the SAME 50-member folder blows the read cap.
  test("MUTATION: the status-index probe the counter replaces blows the read cap", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { folderId } = await seedFatFolder(t);

    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("vaultDocuments")
          .withIndex("by_tenant_folder", (q) => q.eq("tenantId", TENANT).eq("folderId", folderId))
          .collect(),
      ),
    ).rejects.toThrow(/read|bytes|limit/i);
  });
});

// ── 4. Hash-dedup does not stop a folder completing, and never annexes ────────

describe("hash-dedup inside a folder", () => {
  // Mutation RUN: patch `folderId` onto the dedup hit in `vaultUpload` (the annexation the plan
  // forbids) -> RED on the last assertion; the pre-existing folder-less document is swallowed into
  // the folder and, once plan 05's seal lands, becomes ungroundable although the user could ground
  // on it yesterday.
  //
  // Mutation RUN: bump `memberCount` before the dedup early-return instead of after the insert ->
  // RED. memberCount reads 3 against 1 inserted row, no third terminal event ever arrives, and the
  // folder never completes — the reservation is stranded with no folder-level watchdog to notice.
  test("two identical files plus one that already exists: the folder still completes", async () => {
    const t = budgetHarness();

    // a pre-existing, folder-less document
    const existing = await upload(t, { hash: "shared-bytes", filename: "old.pdf" });
    expect(existing.deduped).toBe(false);

    const folderId = await newFolder(t);
    const a = await upload(t, { folderId, hash: "twin" });
    const b = await upload(t, { folderId, hash: "twin" }); // byte-identical to a
    const c = await upload(t, { folderId, hash: "shared-bytes" }); // already in the vault

    expect(a.deduped).toBe(false);
    expect(b).toEqual({ vaultDocId: a.vaultDocId, deduped: true });
    expect(c).toEqual({ vaultDocId: existing.vaultDocId, deduped: true });

    // THREE files were submitted; ONE row was inserted, and that is what memberCount counts.
    expect(await folderRow(t, folderId)).toMatchObject({ memberCount: 1 });

    await asTenant(t).mutation(api.vaultFolders.reserveFolder, { folderId, files: manifestOf(3) });
    await t.mutation(internal.vault.markReady, {
      vaultDocId: a.vaultDocId,
      ragEntryId: "entry_a",
    });

    expect(await folderRow(t, folderId)).toMatchObject({
      status: "complete",
      memberCount: 1,
      terminalCount: 1,
    });
    // NEVER ANNEXED, and therefore never retroactively sealed.
    expect((await t.run((ctx) => ctx.db.get(existing.vaultDocId)))?.folderId).toBeUndefined();
  });

  // The degenerate case counters alone cannot reach: every picked file is a duplicate, so ZERO
  // rows are inserted and nothing will ever call bumpFolder.
  // Mutation RUN: delete the `if (await tryComplete(...)) return result;` line from reserveFolder
  // -> RED, the folder sits at `ingesting` forever holding its reservation.
  test("an ALL-duplicate folder completes at the close signal, not never", async () => {
    const t = budgetHarness();
    await upload(t, { hash: "only-bytes" });
    const folderId = await newFolder(t);
    expect((await upload(t, { folderId, hash: "only-bytes" })).deduped).toBe(true);

    await asTenant(t).mutation(api.vaultFolders.reserveFolder, { folderId, files: manifestOf(1) });

    expect(await folderRow(t, folderId)).toMatchObject({
      status: "complete",
      memberCount: 0,
      terminalCount: 0,
      reservedCents: 0,
    });
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS);
  });
});

// ── 5. Cancel: keep the documents, discard the folder ────────────────────────

describe("cancelFolder", () => {
  // Mutation RUN: swap the two statements in cancelFolder (delete before settle) -> RED.
  // `settleFolder` returns `no_folder` against the row it can no longer read, the window is never
  // credited, and the reservation is stranded permanently — there is no folder-level watchdog.
  //
  // Mutation RUN: patch `folderId: undefined` onto each member inside cancelFolder (the "clean it
  // up properly" instinct) -> RED on the zero-writes assertion, and at 400 real members it is also
  // ~9.5x the 16 MiB written-per-transaction cap.
  test("settles the reservation, deletes the row, and writes ZERO vaultDocuments rows", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    const a = (await upload(t, { folderId, hash: "c-a" })).vaultDocId;
    await upload(t, { folderId, hash: "c-b" });
    await asTenant(t).mutation(api.vaultFolders.reserveFolder, { folderId, files: manifestOf(2) });
    await t.mutation(internal.vault.markReady, { vaultDocId: a, ragEntryId: "entry_a" });
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS - costOf(2));

    const docsBefore = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());

    expect(await asTenant(t).mutation(api.vaultFolders.cancelFolder, { folderId })).toEqual({
      ok: true,
    });

    // ZERO document writes IN THIS MUTATION. Every row is byte-identical, `folderId` included —
    // the dangling id IS the mechanism, not an oversight. What terminalises the members nothing
    // will ever dispatch is the BATCHED walk this schedules (section 6), which is what keeps the
    // guarantee a per-transaction write-cap guarantee rather than silent parking.
    const docsAfter = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(docsAfter).toEqual(docsBefore);
    expect(await scheduledWalks(t, "cancel")).toHaveLength(1);

    // The folder is GONE, not marked: a `cancelled` status would keep its members sealed forever.
    expect(await folderRow(t, folderId)).toBeNull();
    expect(await asTenant(t).query(api.vaultFolders.getFolder, { folderId })).toBeNull();

    // The reservation is released. NOTE the shipped arithmetic: `settleFolder` credits back the
    // FULL `reservedCents`, not "reservation minus spend" — `reserveFolderInner` debited the
    // estimate and `recordSpend` debits the actual cents separately, so a full credit leaves net =
    // actual spend. Subtracting spend here would charge the tenant twice.
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS);

    // The already-ready member keeps its embedding and is an ordinary folder-less document —
    // groundable the moment the folder row disappears (the locked, derived consequence).
    expect(await t.run((ctx) => ctx.db.get(a))).toMatchObject({
      status: "ready",
      ragEntryId: "entry_a",
    });
  });

  // THE REPLACEMENT FOR `pool.cancelAll`, which is unusable here — it takes {before, limit} and
  // cancels every pending item in the pool for every folder and every tenant. The stop lives at
  // work-start instead, where it is exactly folder-scoped.
  // Mutation RUN: drop the dangling-folder branch from `vault.markExtracting` -> RED, the member
  // flips to `extracting` and the extraction spends against a reservation that has been released.
  test("a queued member of a cancelled folder refuses to start work and fails honestly", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    const a = (await upload(t, { folderId, hash: "k-a" })).vaultDocId;
    await asTenant(t).mutation(api.vaultFolders.reserveFolder, { folderId, files: manifestOf(1) });
    await asTenant(t).mutation(api.vaultFolders.cancelFolder, { folderId });

    // its enqueued extraction eventually runs and asks to start
    const started = await t.mutation(internal.vault.markExtracting, { vaultDocId: a });

    expect(started).toEqual({ ok: false });
    expect(await t.run((ctx) => ctx.db.get(a))).toMatchObject({
      status: "failed",
      failureReason: "folder_cancelled",
    });
    expect(await watchdogs(t)).toHaveLength(0); // no clock armed for work that never started
  });

  // The other half of "cancel writes zero rows in the mutation": the members it did NOT write are
  // terminalised by the batched walk. Cancelling while the folder is still `reserving` — the
  // pre-flight card's "no, don't start this", the likeliest cancel of all — parks 100% of the
  // members, because reserveFolder is what dispatches them and it never ran.
  // Mutation RUN: drop the `mode: "cancel"` schedule from cancelFolder -> RED, but on the
  // zero-writes test ABOVE (`scheduledWalks(t, "cancel")` is empty), not here — this test invokes
  // the walk directly, so the two together are what pin "scheduled AND correct". Without the
  // schedule the member sits at `pending_extraction` for ever: dangling folderId, no dispatcher
  // (the dispatch walk stops at a missing parent) and, since the watchdog moved to work-start,
  // no clock either.
  test("cancel terminalises the members nothing will ever dispatch, and Retry then WORKS", async () => {
    const T = "tenant_cancel_retry";
    const t = budgetHarness();
    const folderId = await newFolder(t, T);
    const a = (await upload(t, { folderId, hash: "cx-a", tenant: T })).vaultDocId;

    await asTenant(t, T).mutation(api.vaultFolders.cancelFolder, { folderId });
    await t.mutation(internal.vaultFolders.walkFolderMembers, {
      tenantId: T,
      folderId,
      mode: "cancel",
      cursor: null,
    });

    expect(await t.run((ctx) => ctx.db.get(a))).toMatchObject({
      status: "failed",
      failureReason: "folder_cancelled",
    });

    // And it is a REAL retry, not a loop: `markExtracting` refuses work whose folder has vanished,
    // so the dangling id has to die on the row being re-queued or the document can never be
    // extracted, embedded or grounded on again — the inverse of "cancelled documents become
    // ordinary documents".
    // Mutation RUN: drop the `folderId: undefined` from retryExtraction's patch -> RED on the
    // markExtracting assertion (folder_cancelled again, for ever).
    expect(
      await asTenant(t, T).mutation(api.vaultSweep.retryExtraction, { vaultDocId: a }),
    ).toEqual({ ok: true });
    expect((await t.run((ctx) => ctx.db.get(a)))?.folderId).toBeUndefined();
    expect(enqueuedFor(T)).toHaveLength(1);
    expect(enqueuedFor(T)[0]?.args[0]?.spendRail).toBeUndefined(); // no reservation left to spend
    expect(await t.mutation(internal.vault.markExtracting, { vaultDocId: a })).toEqual({
      ok: true,
    });
  });

  test("a foreign tenant cannot settle or delete another tenant's folder", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    await upload(t, { folderId, hash: "x-a" }); // or the folder completes at the close signal
    await asTenant(t).mutation(api.vaultFolders.reserveFolder, { folderId, files: manifestOf(1) });

    expect(
      await asTenant(t, "tenant_intruder").mutation(api.vaultFolders.cancelFolder, { folderId }),
    ).toEqual({ ok: false });
    // `settleFolder` takes a bare folderId and has no tenant guard of its own, so this assertion is
    // the whole protection: the reservation is untouched and the row is still there.
    expect(await folderRow(t, folderId)).toMatchObject({
      status: "ingesting",
      reservedCents: costOf(1),
    });
  });
});

// ── 6. The member walk, and the three mutations that reach a member from OUTSIDE the walk ────
//
// Why this section is invoked DIRECTLY rather than through the scheduler: `reserveFolder` and
// `cancelFolder` schedule the walk with `ctx.scheduler.runAfter(0, …)`, and convex-test leaves that
// entry at `{kind:"pending"}` for ever — `finishInProgressScheduledFunctions()` does not help,
// because the walk is pending, not in-progress. Everything the walk does was therefore UNSAMPLED:
// "reserve dispatches every member" is the mechanism that makes a folder ingest at all, and a wrong
// mode literal, status filter or index in it would have left the suite green.

describe("walkFolderMembers — the mechanism the scheduler hides", () => {
  test("dispatch: one pool enqueue per member, on the PRE-PAID rail", async () => {
    const T = "tenant_walk_dispatch";
    const t = budgetHarness();
    const folderId = await newFolder(t, T);
    await upload(t, { folderId, hash: "w-a", tenant: T });
    await upload(t, { folderId, hash: "w-b", tenant: T });
    await upload(t, { folderId, hash: "w-c", tenant: T });

    await asTenant(t, T).mutation(api.vaultFolders.reserveFolder, {
      folderId,
      files: manifestOf(3),
    });
    expect(enqueuedFor(T)).toHaveLength(0); // uploading a member dispatches NOTHING — no cent before the money
    expect(await scheduledWalks(t, "dispatch")).toHaveLength(1);

    await t.mutation(internal.vaultFolders.walkFolderMembers, {
      tenantId: T,
      folderId,
      mode: "dispatch",
      cursor: null,
    });

    const mine = enqueuedFor(T);
    expect(mine).toHaveLength(3);
    expect(mine.every((e) => e.name.includes("vaultExtract"))).toBe(true);
    // `reserved: true` + the ingest rail on BOTH halves is what keeps a folder off the cockpit's
    // $5 window and unrefusable by a drained one — the money is already taken.
    for (const e of mine) {
      expect(e.args[0]).toMatchObject({ spendRail: "ingest", reserved: true });
    }
  });

  test("refuse: every member is failed folder_refused, and NOTHING is ingested", async () => {
    const T = "tenant_walk_refuse";
    const t = budgetHarness();
    const folderId = await newFolder(t, T);
    const a = (await upload(t, { folderId, hash: "rf-a", tenant: T })).vaultDocId;

    const refusal = await asTenant(t, T).mutation(api.vaultFolders.reserveFolder, {
      folderId,
      files: manifestOf(INGEST_DAILY_BUDGET_CENTS + 1),
    });
    expect(refusal).toMatchObject({ ok: false, reason: "over_folder_cap" });
    expect(await folderRow(t, folderId)).toMatchObject({ status: "refused" });

    await t.mutation(internal.vaultFolders.walkFolderMembers, {
      tenantId: T,
      folderId,
      mode: "refuse",
      cursor: null,
    });

    // Terminal and honest rather than parked at pending_extraction — and Retry-able one at a time
    // if the user wants a single file after all.
    expect(await t.run((ctx) => ctx.db.get(a))).toMatchObject({
      status: "failed",
      failureReason: "folder_refused",
    });
    expect(enqueuedFor(T)).toHaveLength(0); // refuse-intact is proven by absence
  });
});

describe("a member reached from outside the walk", () => {
  // THE RETRY RACE. Retry un-terminalises a `failed` row; `countTerminal` counts the NON-TERMINAL →
  // TERMINAL transition, so without the matching decrement that row is counted TWICE and the folder
  // completes while a member that never ran is still outstanding — settling the reservation that
  // member has yet to spend, lifting the seal, and handing plan 06 a partial folder to synthesise.
  // Mutation RUN: delete the `unbumpFolder` call from retryExtraction -> RED, the folder below
  // reads `complete` with terminalCount 3 while member c is still pending_extraction.
  test("retrying a failed member un-counts it, so the folder cannot complete early", async () => {
    const T = "tenant_retry_race";
    const t = budgetHarness();
    const folderId = await newFolder(t, T);
    const a = (await upload(t, { folderId, hash: "rt-a", tenant: T })).vaultDocId;
    const b = (await upload(t, { folderId, hash: "rt-b", tenant: T })).vaultDocId;
    const c = (await upload(t, { folderId, hash: "rt-c", tenant: T })).vaultDocId;
    await asTenant(t, T).mutation(api.vaultFolders.reserveFolder, {
      folderId,
      files: manifestOf(3),
    });

    await t.mutation(internal.vault.markFailed, { vaultDocId: a, reason: "unsupported_format" });
    expect(await folderRow(t, folderId)).toMatchObject({ terminalCount: 1, failedCount: 1 });

    expect(
      await asTenant(t, T).mutation(api.vaultSweep.retryExtraction, { vaultDocId: a }),
    ).toEqual({ ok: true });
    expect(await folderRow(t, folderId)).toMatchObject({ terminalCount: 0, failedCount: 0 });
    // and the retry rides the reservation the folder is already holding
    expect(enqueuedFor(T)).toHaveLength(1);
    expect(enqueuedFor(T)[0]?.args[0]).toMatchObject({ spendRail: "ingest", reserved: true });

    await t.mutation(internal.vault.markReady, { vaultDocId: a, ragEntryId: "entry_a" });
    await t.mutation(internal.vault.markReady, { vaultDocId: b, ragEntryId: "entry_b" });

    expect(await folderRow(t, folderId)).toMatchObject({
      status: "ingesting",
      memberCount: 3,
      terminalCount: 2,
      failedCount: 0,
    });
    expect((await t.run((ctx) => ctx.db.get(c)))?.status).toBe("pending_extraction");
  });

  // A member of a `reserving` folder has not been paid for and `reserveFolder` is what dispatches
  // it; extracting it here would spend BEFORE the reservation, the one ordering the whole rail is
  // built around. Fail-closed, like the cross-tenant and wrong-status refusals beside it.
  test("retry is refused while the folder has not reserved", async () => {
    const T = "tenant_retry_early";
    const t = budgetHarness();
    const folderId = await newFolder(t, T);
    const a = (await upload(t, { folderId, hash: "pre-a", tenant: T })).vaultDocId;

    expect(
      await asTenant(t, T).mutation(api.vaultSweep.retryExtraction, { vaultDocId: a }),
    ).toEqual({ ok: false });
    expect(enqueuedFor(T)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(a)))?.status).toBe("pending_extraction");
  });

  // Deleting a member deletes the only thing that could ever produce its terminal event, so an
  // un-counted delete strands the folder at `ingesting` for ever — reservation held, members sealed
  // (plan 05), no folder-level watchdog to notice.
  // Mutation RUN: drop the bumpFolder call from deleteVaultDoc -> RED, the folder stays `ingesting`
  // at terminalCount 1 of 2 and `remaining` never returns to the full window.
  test("deleting the last outstanding member completes the folder and settles it", async () => {
    const T = "tenant_delete_member";
    const t = budgetHarness();
    const folderId = await newFolder(t, T);
    const a = (await upload(t, { folderId, hash: "dl-a", tenant: T })).vaultDocId;
    const b = (await upload(t, { folderId, hash: "dl-b", tenant: T })).vaultDocId;
    await asTenant(t, T).mutation(api.vaultFolders.reserveFolder, {
      folderId,
      files: manifestOf(2),
    });
    // `a` goes terminal the ordinary way. It is failed rather than ready ONLY so the delete below
    // does not need the `rag` component registered — a ready row carries a ragEntryId and
    // `deleteVaultDoc` cascades into rag.
    await t.mutation(internal.vault.markFailed, { vaultDocId: a, reason: "unsupported_format" });
    expect(await remaining(t, T)).toBe(INGEST_DAILY_BUDGET_CENTS - costOf(2));

    expect(await asTenant(t, T).mutation(api.vault.deleteVaultDoc, { vaultDocId: b })).toEqual({
      ok: true,
    });

    expect(await folderRow(t, folderId)).toMatchObject({
      status: "complete",
      memberCount: 2,
      terminalCount: 2,
      failedCount: 2, // memberCount = read + unread: a document that is not there was not read
      reservedCents: 0,
    });
    expect(await remaining(t, T)).toBe(INGEST_DAILY_BUDGET_CENTS);

    // ...and deleting an ALREADY-terminal member counts nothing twice.
    await asTenant(t, T).mutation(api.vault.deleteVaultDoc, { vaultDocId: a });
    expect(await folderRow(t, folderId)).toMatchObject({ terminalCount: 2 });
  });

  // The manifest is the CLIENT's, and it is what the reservation is priced off. Without a
  // cross-check the caller chooses where the budget wall is.
  // Mutation RUN: delete the `files.length < folder.memberCount` guard -> RED, `{ files: [] }`
  // returns ok with estCents 0, the folder flips to `ingesting` holding a 0-cent reservation, and
  // every member is then dispatched with `reserved: true` (preCall waves those through on the kill
  // switch alone).
  test("a manifest shorter than the folder is refused before pricing", async () => {
    const T = "tenant_manifest_short";
    const t = budgetHarness();
    const folderId = await newFolder(t, T);
    await upload(t, { folderId, hash: "ms-a", tenant: T });
    await upload(t, { folderId, hash: "ms-b", tenant: T });

    expect(
      await asTenant(t, T).mutation(api.vaultFolders.reserveFolder, { folderId, files: [] }),
    ).toEqual({ ok: false, reason: "manifest_short" });

    expect(await folderRow(t, folderId)).toMatchObject({
      status: "reserving", // still open — nothing was taken and nothing was dispatched
      reservedCents: 0,
    });
    expect(await remaining(t, T)).toBe(INGEST_DAILY_BUDGET_CENTS);
    expect(enqueuedFor(T)).toHaveLength(0);
  });
});

// ── ESTIMATE / RESERVE PARITY (15.3-07) ──────────────────────────────────────
//
// THE PLAN'S OWN <verification> LINE, and it shipped asserted by nothing: "the pre-flight
// `totalCents` equals what `reserve` consumes for the same input (the media.test.ts guarantee)".
// `media.test.ts:2618` has exactly this describe for `jobEstimate`; the folder clone was never
// written, so the parity was held only by two hand-maintained copies of the same checks in
// `vaultFolders.folderEstimate` and `guardrails.reserveFolderInner`, plus a comment asserting they
// match.
//
// WHY THAT ROTS SILENTLY: add a sixth refusal check to `reserveFolderInner`, or reorder the
// ceilings, or move a constant, and NOTHING goes red — `vaultSurface.test.ts` only greps source
// text and nothing else calls the query. The card then shows a clean figure with Start enabled, the
// user sends 1.5 GB, and the reserve refuses. That is precisely the failure the phase's key_link
// exists to prevent.
describe("folderEstimate is the number the reserve actually takes", () => {
  // Mutation RUN: change `estimateFolderCents` to `estCents + 1` inside `folderEstimate` -> RED.
  test("the estimate equals the cents the reserve consumes, for the same manifest", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    // THE MEMBERS MUST REALLY BE UPLOADED. A folder whose `memberCount` is still 0 reserves and
    // then immediately completes (`terminalCount === memberCount` at 0 === 0), which SETTLES the
    // reservation and refunds it inside the same call — the window ends up untouched and a parity
    // assertion against it passes for the wrong reason.
    for (const hash of ["p-a", "p-b", "p-c"]) await upload(t, { folderId, hash });
    const files = manifestOf(3);

    const est = await asTenant(t).query(api.vaultFolders.folderEstimate, { files });
    expect(est.refusal).toBeNull();
    expect(est.totalCents).toBeGreaterThan(0); // non-vacuity: 0 === 0 would pass for free

    const before = await remaining(t);
    const reserved = await asTenant(t).mutation(api.vaultFolders.reserveFolder, {
      folderId,
      files,
    });

    expect(reserved).toMatchObject({ ok: true, estCents: est.totalCents });
    // The WINDOW moved by exactly the figure the card showed — the money, not just the return value.
    expect(await remaining(t)).toBe(before - est.totalCents);
  });

  // A query on a rate-limited rail that consumed a token would bill a user for LOOKING at a price.
  // Mutation RUN: swap `rateLimiter.check` for `rateLimiter.limit` in `folderEstimate` -> RED.
  test("the estimate CONSUMES NOTHING — it is a query and cannot", async () => {
    const t = budgetHarness();
    const before = await remaining(t);
    for (let i = 0; i < 5; i++) {
      await asTenant(t).query(api.vaultFolders.folderEstimate, { files: manifestOf(4) });
    }
    expect(await remaining(t)).toBe(before);
  });

  // The refusal the CARD shows must be the refusal the RESERVE would give, or Start is enabled on a
  // folder that cannot start (and vice versa: a card refusing work the reserve would have accepted).
  // Mutation RUN: drop the `over_folder_cap` check from `folderEstimate` -> RED.
  test("an over-cap folder is refused by BOTH, with the same reason", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    await upload(t, { folderId, hash: "r-a" });
    const files = manifestOf(3);

    // Drain the tenant's ingest window, which is the arm a real user actually hits. `recordSpend`
    // uses `reserve: true`, so this is the same mechanism real spend uses, not a test-only door.
    await t.mutation(internal.guardrails.recordSpend, {
      tenantId: TENANT,
      costUsd: 999,
      rail: "ingest",
    });
    const drained = await remaining(t);

    const est = await asTenant(t).query(api.vaultFolders.folderEstimate, { files });
    const reserved = await asTenant(t).mutation(api.vaultFolders.reserveFolder, {
      folderId,
      files,
    });

    expect(est.refusal).not.toBeNull();
    expect(reserved).toMatchObject({ ok: false, reason: est.refusal?.reason });
    // And it cost nothing more: a refusal never moves the window.
    expect(await remaining(t)).toBe(drained);
  });
});

// ── 26-07: the ingest rail's ledger parity, through the REAL public path ────────────────────
//
// `guardrails.test.ts` proves the movements against `reserveFolder`/`settleFolder` directly. This
// block proves the WIRING: that the public `vaultFolders.reserveFolder` actually hands its
// `folderId` down, and that the stamp it writes to the row is the stamp the ledger correlated on.
// Those are two different values in two different files, and nothing else notices if they drift —
// the money would still be right, and every refund would silently become an orphan row.
describe("ledger parity: the folder rail names its folder and refunds it exactly once", () => {
  const events = (t: ReturnType<typeof convexTest>) =>
    t.run((ctx) => ctx.db.query("spendEvents").collect());

  // Mutation RUN: delete `folderId` from the `reserveFolderInner` call in `vaultFolders.ts` -> RED,
  // the reserved row disappears entirely. Mutation RUN: stamp `reservedAt: Date.now()` in the
  // `ctx.db.patch` instead of `result.reservedAt` -> RED, the refund's correlation stops matching.
  test("reserve names the folder, and cancelling writes exactly one matching refund", async () => {
    const t = budgetHarness();
    const folderId = await newFolder(t);
    // Real members, or `tryComplete` fires at 0 === 0 and settles inside the reserve itself.
    for (const hash of ["l-a", "l-b", "l-c"]) await upload(t, { folderId, hash });

    const reserved = await asTenant(t).mutation(api.vaultFolders.reserveFolder, {
      folderId,
      files: manifestOf(3),
    });
    expect(reserved).toMatchObject({ ok: true, estCents: costOf(3) });

    const stamp = await t.run(async (ctx) => (await ctx.db.get(folderId))?.reservedAt);
    const correlationId = `f:${folderId}:${stamp}`;

    const afterReserve = await events(t);
    expect(afterReserve).toHaveLength(1);
    expect(afterReserve[0]).toMatchObject({
      tenantId: TENANT,
      rail: "ingest",
      phase: "reserved",
      amountCents: costOf(3),
      folderId,
      correlationId,
    });

    // Cancel settles BEFORE deleting the row — the one terminal that can prove the refund lands
    // while its folder still exists.
    expect(await asTenant(t).mutation(api.vaultFolders.cancelFolder, { folderId })).toEqual({
      ok: true,
    });

    const refunds = (await events(t)).filter((r) => r.phase === "refunded");
    expect(refunds).toHaveLength(1);
    // THE JOIN: the refund carries the reservation's own correlation, so the two movements are one
    // reconcilable pair rather than two unrelated rows that happen to share a folder.
    expect(refunds[0]).toMatchObject({ correlationId, folderId, amountCents: costOf(3) });
  });
});
