import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

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
