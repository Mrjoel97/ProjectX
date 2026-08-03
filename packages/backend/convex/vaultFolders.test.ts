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
  vi.spyOn(vaultIngestPool, "enqueueAction").mockImplementation(
    (async (_ctx: unknown, fn: never, fnArgs: unknown) => {
      enqueued.push({ name: getFunctionName(fn), args: [fnArgs as Record<string, unknown>] });
      return "workId_test" as never;
    }) as never,
  );
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

/** The estimator prices a 1 KB text file at exactly 1 cent (guardrails.test.ts pins this), so a
 *  manifest of N files reserves N cents and the arithmetic below stays readable. */
const manifestOf = (files: number) =>
  Array.from({ length: files }, () => ({ size: 1_000, mimeType: "text/plain" }));

/** The per-attempt watchdogs armed so far. */
const watchdogs = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) =>
      /watchdogStalled/.test(s.name),
    ),
  );

const newFolder = async (t: ReturnType<typeof convexTest>): Promise<Id<"vaultFolders">> => {
  const { folderId } = await asTenant(t).mutation(api.vaultFolders.createFolder, {
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
  } = {},
): Promise<{ vaultDocId: Id<"vaultDocuments">; deduped: boolean }> => {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  return await asTenant(t).mutation(api.vault.vaultUpload, {
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
    expect(reserved).toMatchObject({ ok: true, estCents: 3 });
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS - 3);
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
          .withIndex("by_tenant_folder", (q) =>
            q.eq("tenantId", TENANT).eq("folderId", folderId),
          )
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
    expect(await remaining(t)).toBe(INGEST_DAILY_BUDGET_CENTS - 2);

    const docsBefore = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());

    expect(await asTenant(t).mutation(api.vaultFolders.cancelFolder, { folderId })).toEqual({
      ok: true,
    });

    // ZERO document writes. Every row is byte-identical, `folderId` included — the dangling id IS
    // the mechanism, not an oversight.
    const docsAfter = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
    expect(docsAfter).toEqual(docsBefore);

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
    expect(await folderRow(t, folderId)).toMatchObject({ status: "ingesting", reservedCents: 1 });
  });
});
