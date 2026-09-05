import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// Mock the node-only S3 SDK so the real-export branch runs without a live bucket.
// vi.hoisted lets the factory reference `s3Send` (vi.mock is hoisted above imports).
// PutObjectCommand is captured as its raw input so the test can assert the headers.
const { s3Send } = vi.hoisted(() => ({ s3Send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: s3Send })),
  PutObjectCommand: vi.fn((input: unknown) => ({ input })),
}));

// Raw source for the static-shape assertions (edge-runtime has no node:fs, so we
// inline file contents via Vite's ?raw loader instead of reading from disk).
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Runtime modules for convex-test (exclude *.test.ts so the harness does not try
// to load the test files themselves).
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

function src(name: string): string {
  const entry = Object.entries(sources).find(([p]) => p.endsWith(`/${name}`));
  if (!entry) throw new Error(`missing convex source: ${name}`);
  return entry[1];
}

describe("WORM export cron stub — shape (SC-4)", () => {
  test("worm.ts is a 'use node' action module (directive is the first statement)", () => {
    const s = src("worm.ts").trimStart();
    expect(s.startsWith('"use node"') || s.startsWith("'use node'")).toBe(true);
  });

  test("crons.ts registers a daily worm-export -> internal.worm.exportAudit", () => {
    const s = src("crons.ts");
    expect(/\.daily\(\s*["']worm-export["']/.test(s)).toBe(true);
    expect(/internal\.worm\.exportAudit/.test(s)).toBe(true);
  });
});

describe("WORM cursor mechanics + stub safety (SC-4)", () => {
  const ORIGINAL = process.env.WORM_BUCKET;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WORM_BUCKET;
    else process.env.WORM_BUCKET = ORIGINAL;
  });

  test("getCursor returns the 0 baseline for worm-audit when no cursor row exists", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(0);
  });

  test("advanceCursor upserts lastExportedTs (single row); getCursor reads it back", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.wormCursor.advanceCursor, { ts: 111 });
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(111);
    await t.mutation(internal.wormCursor.advanceCursor, { ts: 222 });
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(222);
    const rows = await t.run((ctx) => ctx.db.query("exportCursors").collect());
    expect(rows).toHaveLength(1);
  });

  test("auditSince (by_ts index) returns only rows strictly after the cursor ts, oldest-first, bounded by limit", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      // Insert out of ts order and across tenants — the export window is CROSS-tenant
      // and must come back ts-ascending from the by_ts index regardless of insert order.
      for (const [ts, tenantId] of [
        [30, "t1"],
        [10, "t2"],
        [20, "t1"],
        [40, "t2"],
        [15, "t1"],
      ] as const) {
        await ctx.db.insert("audit", {
          tenantId,
          correlationId: `c${ts}`,
          eventType: "x",
          actor: "system",
          payload: { ref: `r${ts}` },
          ts,
        });
      }
    });

    // Strictly after `since`, oldest-first, all tenants.
    const window = await t.query(internal.wormCursor.auditSince, { since: 15 });
    expect(window.map((r) => r.ts)).toEqual([20, 30, 40]);

    // Boundary is EXCLUSIVE (ts > since): a row exactly at `since` is not re-exported.
    const atBoundary = await t.query(internal.wormCursor.auditSince, { since: 20 });
    expect(atBoundary.map((r) => r.ts)).toEqual([30, 40]);

    // limit bounds the window to the oldest N rows after `since` (index take, not a scan+slice).
    const limited = await t.query(internal.wormCursor.auditSince, { since: 15, limit: 2 });
    expect(limited.map((r) => r.ts)).toEqual([20, 30]);
  });

  // THE critical correctness property (see worm.ts header): the stub path must
  // NOT advance the cursor. Advancing it would mark audit rows as exported that
  // never reached S3 — a permanent, unrecoverable hole in the compliance log
  // once Phase 7 enables the real export.
  test("exportAudit stub path does NOT advance the cursor", async () => {
    delete process.env.WORM_BUCKET;
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("audit", {
        tenantId: "t1",
        correlationId: "c1",
        eventType: "x",
        actor: "system",
        payload: { ref: "r" },
        ts: 42,
      }),
    );
    await t.action(internal.worm.exportAudit, {});
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(0);
    const cursors = await t.run((ctx) => ctx.db.query("exportCursors").collect());
    expect(cursors).toHaveLength(0);
  });

  test("exportAudit stub path returns a skipped marker and does not throw", async () => {
    delete process.env.WORM_BUCKET;
    const t = convexTest(schema, modules);
    const res = await t.action(internal.worm.exportAudit, {});
    expect(res).toMatchObject({ skipped: true });
  });
});

describe("WORM real export — advance only after a durable PutObject (OPSG-03)", () => {
  const ORIGINAL = process.env.WORM_BUCKET;

  beforeEach(() => {
    process.env.WORM_BUCKET = "test-worm-bucket";
    s3Send.mockReset();
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WORM_BUCKET;
    else process.env.WORM_BUCKET = ORIGINAL;
  });

  async function seedAudit(t: ReturnType<typeof convexTest>, tsList: number[]) {
    await t.run(async (ctx) => {
      for (const ts of tsList) {
        await ctx.db.insert("audit", {
          tenantId: "t1",
          correlationId: `c${ts}`,
          eventType: "x",
          actor: "system",
          payload: { ref: `r${ts}` },
          ts,
        });
      }
    });
  }

  test("serializes the window → PutObject(COMPLIANCE, SHA256, retain-until) → advances the cursor to maxTs", async () => {
    s3Send.mockResolvedValue({});
    const t = convexTest(schema, modules);
    await seedAudit(t, [10, 20, 30]);

    const res = await t.action(internal.worm.exportAudit, {});

    // Cursor advanced to the newest exported ts.
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(30);
    expect(res).toMatchObject({ exported: 3, maxTs: 30 });

    // Exactly one PutObject with the Object-Lock headers.
    expect(s3Send).toHaveBeenCalledTimes(1);
    const put = s3Send.mock.calls[0]?.[0].input;
    expect(put).toMatchObject({
      Bucket: "test-worm-bucket",
      ChecksumAlgorithm: "SHA256",
      ObjectLockMode: "COMPLIANCE",
    });
    expect(put.ObjectLockRetainUntilDate).toBeInstanceOf(Date);
    // NDJSON body: one line per row, ts-ascending.
    expect(String(put.Body).trimEnd().split("\n")).toHaveLength(3);
  });

  test("25.3: a backlog drains in ONE run — pageSize 2 over 3 rows is two objects and the cursor at the newest ts", async () => {
    s3Send.mockResolvedValue({});
    const t = convexTest(schema, modules);
    await seedAudit(t, [10, 20, 30]);
    const res = await t.action(internal.worm.exportAudit, { pageSize: 2 });
    expect(res).toMatchObject({ exported: 3, maxTs: 30, pages: 2 });
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(30);
    expect(s3Send).toHaveBeenCalledTimes(2);
    const keys = s3Send.mock.calls.map((c) => c[0].input.Key);
    expect(new Set(keys).size).toBe(2); // two distinct objects, never one overwritten
    const bodies = s3Send.mock.calls.map(
      (c) => String(c[0].input.Body).trimEnd().split("\n").length,
    );
    expect(bodies).toEqual([2, 1]);
  });

  test("PutObject throw → cursor is NOT advanced (next cron retries the same window)", async () => {
    s3Send.mockRejectedValue(new Error("s3 down"));
    const t = convexTest(schema, modules);
    await seedAudit(t, [42]);

    await expect(t.action(internal.worm.exportAudit, {})).rejects.toThrow("s3 down");

    // The advance is unreachable when PutObject rejects.
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(0);
    const cursors = await t.run((ctx) => ctx.db.query("exportCursors").collect());
    expect(cursors).toHaveLength(0);
  });

  test("empty window → returns { exported: 0 }, no PutObject, no advance", async () => {
    s3Send.mockResolvedValue({});
    const t = convexTest(schema, modules);
    // No audit rows past the 0 cursor.
    const res = await t.action(internal.worm.exportAudit, {});
    expect(res).toEqual({ exported: 0 });
    expect(s3Send).not.toHaveBeenCalled();
    expect(await t.query(internal.wormCursor.getCursor, {})).toBe(0);
  });
});
