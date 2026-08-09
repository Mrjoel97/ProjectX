import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const source = import.meta.glob("./spendLedger.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const TENANT = "tenant_a";
const OTHER = "tenant_b";

function movement(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    rail: "reasoning" as const,
    phase: "actual" as const,
    amountCents: 125,
    correlationId: "plan:abc123:step:1",
    createdAt: 10_000,
    ...overrides,
  };
}

describe("spend ledger append path", () => {
  test("starts coverage durably before any paid movement and never restarts it", async () => {
    const t = convexTest(schema, modules);

    const first = await t.mutation(internal.spendLedger.startCoverage, {
      tenantId: TENANT,
      nowMs: 5_000,
    });
    const second = await t.mutation(internal.spendLedger.startCoverage, {
      tenantId: TENANT,
      nowMs: 9_999,
    });

    expect(first).toBe(5_000);
    // A later call must NOT move the start, or a reported window silently loses its history.
    expect(second).toBe(5_000);

    const rows = await t.run((ctx) => ctx.db.query("spendCoverage").collect());
    expect(rows).toHaveLength(1);
    expect(await t.query(internal.spendLedger.coverage, { tenantId: TENANT })).toBe(5_000);
    // Coverage exists with zero events: history is known-empty, not unknown.
    expect(await t.query(internal.spendLedger.coverage, { tenantId: OTHER })).toBeNull();
  });

  test("a replayed correlation and phase inserts exactly once and returns the same row", async () => {
    const t = convexTest(schema, modules);

    const first = await t.mutation(internal.spendLedger.record, movement());
    const replay = await t.mutation(internal.spendLedger.record, movement());
    // A retry that reports a different amount must not be able to rewrite recorded money.
    const drifted = await t.mutation(internal.spendLedger.record, movement({ amountCents: 999 }));

    expect(replay).toBe(first);
    expect(drifted).toBe(first);

    const rows = await t.run((ctx) => ctx.db.query("spendEvents").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountCents).toBe(125);
  });

  test("distinct phases on one correlation coexist, and so do distinct tenants", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.spendLedger.record,
      movement({ phase: "reserved", amountCents: 400 }),
    );
    await t.mutation(internal.spendLedger.record, movement({ phase: "actual", amountCents: 300 }));
    await t.mutation(internal.spendLedger.record, movement({ tenantId: OTHER, amountCents: 7 }));
    // Replaying each of the three must still be a no-op.
    await t.mutation(
      internal.spendLedger.record,
      movement({ phase: "reserved", amountCents: 400 }),
    );
    await t.mutation(internal.spendLedger.record, movement({ phase: "actual", amountCents: 300 }));
    await t.mutation(internal.spendLedger.record, movement({ tenantId: OTHER, amountCents: 7 }));

    const rows = await t.run((ctx) => ctx.db.query("spendEvents").collect());
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.tenantId === TENANT)).toHaveLength(2);
  });

  test("recording opens coverage at the movement it first observed", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.spendLedger.record, movement({ createdAt: 42_000 }));

    expect(await t.query(internal.spendLedger.coverage, { tenantId: TENANT })).toBe(42_000);
  });

  test("refuses an untrusted movement instead of writing it to an append-only table", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(internal.spendLedger.record, movement({ amountCents: 0 })),
    ).rejects.toThrow(/amountCents/);
    await expect(
      t.mutation(internal.spendLedger.record, movement({ correlationId: "draft the board memo" })),
    ).rejects.toThrow(/correlationId/);
    await expect(
      t.mutation(internal.spendLedger.record, movement({ model: "whatever the user typed" })),
    ).rejects.toThrow(/model/);

    // A refused movement must leave nothing behind — not even a coverage start it did not earn.
    expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(0);
    expect(await t.query(internal.spendLedger.coverage, { tenantId: TENANT })).toBeNull();
  });
});

describe("spend ledger read path", () => {
  test("reads one tenant, one half-open window, and can narrow to one rail", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.spendLedger.record,
      movement({ correlationId: "c1", createdAt: 100 }),
    );
    await t.mutation(
      internal.spendLedger.record,
      movement({ correlationId: "c2", createdAt: 200, rail: "media" }),
    );
    await t.mutation(
      internal.spendLedger.record,
      movement({ correlationId: "c3", createdAt: 300 }),
    );
    await t.mutation(
      internal.spendLedger.record,
      movement({ tenantId: OTHER, correlationId: "c4", createdAt: 200 }),
    );

    const window = await t.query(internal.spendLedger.listEvents, {
      tenantId: TENANT,
      sinceMs: 100,
      untilMs: 300,
    });
    // Half-open: 100 is in, 300 is out, and the foreign tenant is never in.
    expect(window.map((row) => row.correlationId)).toEqual(["c1", "c2"]);

    const mediaOnly = await t.query(internal.spendLedger.listEvents, {
      tenantId: TENANT,
      sinceMs: 0,
      untilMs: 1_000,
      rail: "media",
    });
    expect(mediaOnly.map((row) => row.correlationId)).toEqual(["c2"]);
  });

  test("bounds the read so a long-lived tenant cannot return an unbounded page", async () => {
    const t = convexTest(schema, modules);
    for (let index = 0; index < 12; index += 1) {
      await t.mutation(
        internal.spendLedger.record,
        movement({ correlationId: `c${index}`, createdAt: 1_000 + index }),
      );
    }

    const capped = await t.query(internal.spendLedger.listEvents, {
      tenantId: TENANT,
      sinceMs: 0,
      untilMs: 10_000,
      limit: 5,
    });
    expect(capped).toHaveLength(5);

    const clamped = await t.query(internal.spendLedger.listEvents, {
      tenantId: TENANT,
      sinceMs: 0,
      untilMs: 10_000,
      limit: 10_000,
    });
    expect(clamped).toHaveLength(12);
  });
});

describe("spend ledger is insert-only at the source", () => {
  const code = source["./spendLedger.ts"] ?? "";

  test("the scan actually found the module", () => {
    expect(code.length).toBeGreaterThan(500);
  });

  test("exposes no mutating database call", () => {
    // Same rule as the audit log (CLAUDE.md §3): money history that can be edited is not
    // history. A correction is a new `adjustment`/`refunded` movement, never an overwrite.
    const stripped = code.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    for (const forbidden of ["db.patch", "db.replace", "db.delete"]) {
      expect(stripped).not.toContain(forbidden);
    }
  });
});
