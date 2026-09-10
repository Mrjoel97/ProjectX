import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const { s3Send } = vi.hoisted(() => ({ s3Send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: s3Send })),
  PutObjectCommand: vi.fn((input: unknown) => ({ input })),
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const ORIGINAL = process.env.WORM_BUCKET;
const NOW = Date.UTC(2026, 8, 10);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.WORM_BUCKET = "test-worm-bucket";
  s3Send.mockReset().mockResolvedValue({});
});
afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL === undefined) delete process.env.WORM_BUCKET;
  else process.env.WORM_BUCKET = ORIGINAL;
});

async function seedAudit(t: ReturnType<typeof convexTest>, tsList: number[], legacy = false) {
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (const ts of tsList) {
      const id = await ctx.db.insert("audit", {
        tenantId: "t1",
        correlationId: `c${ts}`,
        eventType: "x",
        actor: "system",
        payload: { ref: `r${ts}` },
        ts,
        ...(legacy ? {} : { exportVersion: 2 as const }),
      });
      ids.push(id);
      if (!legacy) await ctx.db.insert("auditExportQueue", { auditId: id });
    }
    return ids;
  });
  vi.setSystemTime(Date.now() + 100);
  return ids;
}

function exportedRows() {
  return s3Send.mock.calls.flatMap((call) =>
    String(call[0].input.Body)
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line)),
  );
}

async function checkpoint(t: ReturnType<typeof convexTest>) {
  return await t.run((ctx) => ctx.db.query("exportCursors").unique());
}

describe("WORM bounded lossless export", () => {
  test("OFF gate makes no S3 call and creates no checkpoint", async () => {
    delete process.env.WORM_BUCKET;
    const t = convexTest(schema, modules);
    await seedAudit(t, [42]);
    expect(await t.action(internal.worm.exportAudit, {})).toMatchObject({ skipped: true });
    expect(s3Send).not.toHaveBeenCalled();
    expect(await checkpoint(t)).toBeNull();
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(0);
  });

  test("exports every equal-ts row across page boundaries with distinct keys", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedAudit(t, [42, 42, 42, 42, 42]);
    expect(await t.action(internal.worm.exportAudit, { pageSize: 2 })).toMatchObject({
      exported: 5,
      pages: 3,
      maxTs: 42,
    });
    expect(
      exportedRows()
        .map((row) => row._id)
        .sort(),
    ).toEqual(ids.sort());
    expect(new Set(s3Send.mock.calls.map((call) => call[0].input.Key)).size).toBe(3);
    expect(await checkpoint(t)).toMatchObject({ lastExportedTs: 42 });
    expect((await checkpoint(t))?.pendingAuditIds).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("auditExportQueue").collect())).toHaveLength(0);
    const put = s3Send.mock.calls[0]?.[0].input;
    expect(put).toMatchObject({
      Bucket: "test-worm-bucket",
      ChecksumAlgorithm: "SHA256",
      ObjectLockMode: "COMPLIANCE",
    });
    expect(put.ObjectLockRetainUntilDate).toBeInstanceOf(Date);
  });

  test("after completion, a new window exports new/backdated rows exactly once", async () => {
    const t = convexTest(schema, modules);
    const old = await seedAudit(t, [100, 200]);
    await t.action(internal.worm.exportAudit, { pageSize: 2 });
    const added = await seedAudit(t, [10, 200, 300]);
    expect(await t.action(internal.worm.exportAudit, { pageSize: 2 })).toMatchObject({
      exported: 3,
    });
    expect(
      exportedRows()
        .map((row) => row._id)
        .sort(),
    ).toEqual([...old, ...added].sort());
    vi.setSystemTime(Date.now() + 100);
    expect(await t.action(internal.worm.exportAudit, {})).toEqual({ exported: 0 });
    expect(exportedRows()).toHaveLength(5);
  });

  test("rows inserted while uploading enter the durable queue and are drained", async () => {
    const t = convexTest(schema, modules);
    const old = await seedAudit(t, [42, 42, 42]);
    let late: string[] = [];
    s3Send.mockImplementationOnce(async () => {
      late = await seedAudit(t, [1]);
      return {};
    });
    expect(await t.action(internal.worm.exportAudit, { pageSize: 2 })).toMatchObject({
      exported: 4,
    });
    expect(await t.action(internal.worm.exportAudit, {})).toEqual({ exported: 0 });
    expect(
      exportedRows()
        .map((row) => row._id)
        .sort(),
    ).toEqual([...old, ...late].sort());
  });

  test("failed page resumes byte-identically despite new rows and a changed requested page size", async () => {
    const t = convexTest(schema, modules);
    await seedAudit(t, [42, 42, 42, 42, 42]);
    s3Send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("s3 down"));
    await expect(t.action(internal.worm.exportAudit, { pageSize: 2 })).rejects.toThrow("s3 down");
    const failedPut = s3Send.mock.calls[1]?.[0].input;
    expect(await checkpoint(t)).toMatchObject({ revision: 2, lastExportedTs: 42 });
    await seedAudit(t, [1]);
    expect(await t.action(internal.worm.exportAudit, { pageSize: 5 })).toMatchObject({
      exported: 4,
    });
    expect(s3Send.mock.calls[2]?.[0].input).toMatchObject({
      Key: failedPut.Key,
      Body: failedPut.Body,
    });
    expect(await t.action(internal.worm.exportAudit, {})).toEqual({ exported: 0 });
  });

  test("first PutObject failure persists retry bounds but never marks rows exported", async () => {
    const t = convexTest(schema, modules);
    await seedAudit(t, [42]);
    s3Send.mockRejectedValueOnce(new Error("s3 down"));
    await expect(t.action(internal.worm.exportAudit, {})).rejects.toThrow("s3 down");
    expect(await checkpoint(t)).toMatchObject({ revision: 1, lastExportedTs: 0 });
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("auditExportQueue").collect())).toHaveLength(1);
  });

  test("legacy timestamp checkpoint replays history to recover already-skipped ties", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedAudit(t, [1, 42, 42, 43], true);
    await t.run((ctx) =>
      ctx.db.insert("exportCursors", { name: "worm-audit", lastExportedTs: 42 }),
    );
    expect(await t.action(internal.worm.exportAudit, { pageSize: 2 })).toMatchObject({
      exported: 4,
    });
    expect(
      exportedRows()
        .map((row) => row._id)
        .sort(),
    ).toEqual(ids.sort());
    expect(await checkpoint(t)).toMatchObject({ lastExportedTs: 43 });
  });

  test("legacy ties drain across native cursor boundaries without timestamp skips", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedAudit(t, [42, 42, 42, 42, 42], true);
    expect(await t.action(internal.worm.exportAudit, { pageSize: 2 })).toMatchObject({
      exported: 5,
      pages: 3,
    });
    expect(
      exportedRows()
        .map((row) => row._id)
        .sort(),
    ).toEqual(ids.sort());
    expect(await checkpoint(t)).toMatchObject({ legacyDone: true });
  });

  test("run budget expires between batches and the next run drains the remainder", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedAudit(t, [42, 42, 42]);
    s3Send.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 8 * 60 * 1000);
      return {};
    });
    expect(await t.action(internal.worm.exportAudit, { pageSize: 2 })).toMatchObject({
      exported: 2,
    });
    expect(await t.action(internal.worm.exportAudit, { pageSize: 2 })).toMatchObject({
      exported: 1,
    });
    expect(
      exportedRows()
        .map((row) => row._id)
        .sort(),
    ).toEqual(ids.sort());
  });

  test("overlapping exporter cannot roll back or reuse an already-advanced checkpoint", async () => {
    const t = convexTest(schema, modules);
    await seedAudit(t, [42, 42, 42]);
    const state = await t.mutation(internal.wormCursor.beginExport, { pageSize: 2 });
    expect(state).not.toBeNull();
    if (!state) throw new Error("missing scan");
    const args = { revision: state.revision, ts: 42 };
    expect(await t.mutation(internal.wormCursor.advanceCursor, args)).toBe(true);
    expect(await t.mutation(internal.wormCursor.advanceCursor, args)).toBe(false);
    expect((await checkpoint(t))?.revision).toBe(1);
  });

  test("empty scans upload nothing and reset terminal pagination state", async () => {
    const t = convexTest(schema, modules);
    expect(await t.action(internal.worm.exportAudit, {})).toEqual({ exported: 0 });
    expect(s3Send).not.toHaveBeenCalled();
    expect((await checkpoint(t))?.pendingAuditIds).toBeUndefined();
    await seedAudit(t, [0, -100]);
    expect(await t.action(internal.worm.exportAudit, {})).toMatchObject({ exported: 2 });
  });

  test.each([
    0, -1, 1.5, 10001,
  ])("rejects unsafe page size %s before scanning", async (pageSize) => {
    const t = convexTest(schema, modules);
    await expect(t.action(internal.worm.exportAudit, { pageSize })).rejects.toThrow("pageSize");
    expect(s3Send).not.toHaveBeenCalled();
    expect(await checkpoint(t)).toBeNull();
  });
});
