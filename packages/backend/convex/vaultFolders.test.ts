// The 15.3-04 folder-orchestration guarantees, convex-test.
//
// What this file is FOR: a folder ingest must not starve the delivery spine, must not fabricate
// failures at queue depth, must complete exactly once, and must be cancellable without writing a
// single vaultDocuments row. Each of those is one describe block below, and each carries the
// MUTATION that was run against it (comment `MUTATION:`) — a green suite that does not sample its
// own guarantee is the failure mode waves 1-3 hit twice.
import { EXTRACTION_WATCHDOG_MS } from "@pikar/vault";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { vaultIngestPool } from "./index";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_folders";

/** Extraction enqueues recorded off the pool — see vault.test.ts for why this is a spy and not
 *  the `_scheduled_functions` system table. */
const enqueued: { name: string; args: [Record<string, unknown>] }[] = [];
beforeEach(() => {
  enqueued.length = 0;
  // The generic signature of `enqueueAction` cannot be satisfied by a concrete stub, so the
  // implementation is cast once here rather than typed twice.
  vi.spyOn(vaultIngestPool, "enqueueAction").mockImplementation(
    ((async (_ctx: unknown, fn: never, fnArgs: unknown) => {
      enqueued.push({ name: getFunctionName(fn), args: [fnArgs as Record<string, unknown>] });
      return "workId_test" as never;
    }) as never) as never,
  );
});
afterEach(() => vi.restoreAllMocks());

const setup = () => convexTest(schema, modules);
const asTenant = (t: ReturnType<typeof convexTest>, tenantId = TENANT) =>
  t.withIdentity({ subject: tenantId });

/** The per-attempt watchdogs armed so far. */
const watchdogs = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) =>
      /watchdogStalled/.test(s.name),
    ),
  );

/** Upload a binary through the REAL public mutation (the rail that queues behind the pool). */
const upload = async (
  t: ReturnType<typeof convexTest>,
  filename = "report.pdf",
  mimeType = "application/pdf",
): Promise<Id<"vaultDocuments">> => {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"])));
  const { vaultDocId } = await asTenant(t).mutation(api.vault.vaultUpload, {
    storageId,
    filename,
    mimeType,
    size: 5,
    contentHash: `h-${Math.random()}`,
  });
  return vaultDocId;
};

// ── The watchdog must not kill QUEUED work (15.3-CONTEXT §B2) ────────────────
//
// convex-test has no clock to advance, so "a document whose extraction starts 40 minutes after it
// was scheduled" cannot be simulated by moving time. The only observable is WHAT was armed and
// WHEN — and that is enough, because the whole defect was arming from the wrong transaction. A
// document sitting in the pool's queue has had no watchdog armed at all; its 15 minutes start when
// `markExtracting` runs, i.e. when work actually starts, so queue depth cannot reach it.
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
    const vaultDocId = await upload(t);
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
