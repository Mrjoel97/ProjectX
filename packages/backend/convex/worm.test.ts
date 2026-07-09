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

  test("auditSince returns only rows strictly after the cursor ts, oldest-first", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const ts of [30, 10, 20]) {
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
    const rows = await t.query(internal.wormCursor.auditSince, { since: 15 });
    expect(rows.map((r) => r.ts)).toEqual([20, 30]);
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
