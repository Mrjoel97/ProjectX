import { convexTest } from "convex-test";
import { expect, test } from "vitest";
// `audit.log` maintains the auditCounts aggregate (audit.ts:40), so the component must be
// registered or the REAL insert path throws `Component "auditCounts" is not registered`. Relative
// import — the package blocks the deep specifier. Same idiom as evaluations/gapAction/gmail tests.
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex function modules via import.meta.glob. Exclude
// *.test.ts so the harness does not try to load the test files themselves.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

// OPSG-02 insert path: internal.audit.log inserts exactly one redaction-safe
// row whose fields round-trip and whose ts is a number.
test("audit.log inserts exactly one row that round-trips", async () => {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);

  const args = {
    tenantId: "tenant_a",
    correlationId: "corr_1",
    eventType: "request.received",
    actor: "user_1",
    // Redaction-safe payload — refs/hashes/counts only, never raw content.
    payload: { ref: "doc_123", hash: "sha256:abc", count: 2 },
  };

  await t.mutation(internal.audit.log, args);

  const rows = await t.run(async (ctx) => await ctx.db.query("audit").collect());

  expect(rows).toHaveLength(1);
  // `!` is earned by the assertion directly above, not assumed: under
  // `noUncheckedIndexedAccess` an index read is `T | undefined`, and TS cannot see that
  // `toHaveLength(1)` already failed the test if the row were missing.
  const row = rows[0]!;
  expect(row.tenantId).toBe(args.tenantId);
  expect(row.correlationId).toBe(args.correlationId);
  expect(row.eventType).toBe(args.eventType);
  expect(row.actor).toBe(args.actor);
  expect(row.payload).toEqual(args.payload);
  expect(typeof row.ts).toBe("number");
  expect(row.exportVersion).toBe(2);
  const queued = await t.run((ctx) => ctx.db.query("auditExportQueue").collect());
  expect(queued).toHaveLength(1);
  expect(queued[0]?.auditId).toBe(row._id);
});

test("audit and export outbox roll back together when the writer transaction fails", async () => {
  const t = convexTest(schema, modules);
  // Deliberately omit the aggregate component: failure happens AFTER both inserts.
  await expect(
    t.mutation(internal.audit.log, {
      tenantId: "t1",
      correlationId: "c1",
      eventType: "x",
      actor: "system",
      payload: {},
    }),
  ).rejects.toThrow();
  expect(await t.run((ctx) => ctx.db.query("audit").collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query("auditExportQueue").collect())).toHaveLength(0);
});

// The READ side of a refusal diagnosis. The claim under test is the one the query exists for:
// hand it an eventType and the five `deckTokenCounts` numbers come back, newest first, WITHOUT
// knowing a tenantId — because the alternative was a browser session against the deployment.
//
// Rows are inserted through `ctx.db` rather than `internal.audit.log` on purpose: `log` stamps
// `ts: Date.now()`, and every assertion here is about ORDER and the `sinceMs` window, which needs
// the timestamps chosen. The aggregate is untouched for the same reason — this query never reads it.
test("recentByType returns one eventType's payloads, newest first, bounded by the window", async () => {
  const t = convexTest(schema, modules);

  const row = (ts: number, eventType: string, tenantId: string, payload: unknown) => ({
    tenantId,
    correlationId: `corr_${ts}`,
    eventType,
    actor: "system",
    payload,
    ts,
  });
  // Two tenants and a decoy eventType, so "returns everything in the window" cannot pass this.
  const counts = (targetDurationTokens: number) => ({
    reason: "bad_target_duration",
    bodyChars: 900,
    sceneDeckTokens: 1,
    blockDeckTokens: 0,
    variationTokens: 0,
    targetDurationTokens,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("audit", row(100, "media.deck_refused", "tenant_a", counts(0)));
    await ctx.db.insert("audit", row(200, "plan.approved", "tenant_a", { planId: "p1" }));
    await ctx.db.insert("audit", row(300, "media.deck_refused", "tenant_b", counts(1)));
    await ctx.db.insert("audit", row(50, "media.deck_refused", "tenant_a", counts(9)));
  });

  const all = await t.query(internal.audit.recentByType, {
    eventType: "media.deck_refused",
    sinceMs: 0,
  });

  // Newest first, decoy eventType absent, and BOTH tenants present — no tenantId was supplied.
  expect(all.map((r) => r.ts)).toEqual([300, 100, 50]);
  expect(all.map((r) => r.tenantId)).toEqual(["tenant_b", "tenant_a", "tenant_a"]);

  // The whole point: the counts survive the trip, so the two causes of one reason code are
  // distinguishable from the CLI. `targetDurationTokens: 0` = no target was ever declared;
  // non-zero = the line was written and its value is what failed.
  expect(all[0]!.payload).toEqual(counts(1));
  expect(all[2]!.payload.targetDurationTokens).toBe(9);
  expect(all[0]!.correlationId).toBe("corr_300"); // the lineage handle to join the rest of the run

  // `sinceMs` is STRICTLY greater-than, and it is the scan bound — not `limit`.
  const windowed = await t.query(internal.audit.recentByType, {
    eventType: "media.deck_refused",
    sinceMs: 100,
  });
  expect(windowed.map((r) => r.ts)).toEqual([300]);

  const limited = await t.query(internal.audit.recentByType, {
    eventType: "media.deck_refused",
    sinceMs: 0,
    limit: 2,
  });
  expect(limited.map((r) => r.ts)).toEqual([300, 100]);
});
