import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via import.meta.glob; exclude the tests.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// Mirrors guardrails.test.ts: a single-row kill-switch config with default-on-read.
// The optimizer ships DORMANT — a missing row reads enabled=false (the CONTEXT lock).

test("getOptimizerConfig: empty table reads the DORMANT default (enabled=false)", async () => {
  const t = convexTest(schema, modules);

  const cfg = await t.query(internal.optimizerConfig.getOptimizerConfig, {});

  expect(cfg).toEqual({
    enabled: false,
    negativeRateThreshold: 0.3,
    minSampleFloor: 20,
    cooldownMs: 604800000,
  });
});

test("setOptimizerConfig: enabling toggles enabled=true, other fields keep defaults", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(internal.optimizerConfig.setOptimizerConfig, { enabled: true });
  const cfg = await t.query(internal.optimizerConfig.getOptimizerConfig, {});

  expect(cfg.enabled).toBe(true);
  expect(cfg.negativeRateThreshold).toBe(0.3);
  expect(cfg.minSampleFloor).toBe(20);
  expect(cfg.cooldownMs).toBe(604800000);
});

test("setOptimizerConfig: a second write PATCHES the same row (never a second row)", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(internal.optimizerConfig.setOptimizerConfig, { enabled: true });
  await t.mutation(internal.optimizerConfig.setOptimizerConfig, { enabled: false });

  const rows = await t.run(async (ctx) => await ctx.db.query("optimizerConfig").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].enabled).toBe(false);
});

test("setOptimizerConfig: can set lastRunAt (the cooldown anchor)", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(internal.optimizerConfig.setOptimizerConfig, { lastRunAt: 1234 });
  const cfg = await t.query(internal.optimizerConfig.getOptimizerConfig, {});

  expect(cfg.lastRunAt).toBe(1234);
  expect(cfg.enabled).toBe(false); // still DORMANT — lastRunAt does not enable
});

// The ops-page public wrappers (Plan 06): the owner-gated read + kill-switch flip write the
// SAME single row through the SAME shared upsert as the internal CI mutation.
test("getOptimizerStatus reads DORMANT default for an authenticated owner", async () => {
  const t = convexTest(schema, modules);
  const asOwner = t.withIdentity({ subject: "owner_a" });

  const cfg = await asOwner.query(api.optimizerConfig.getOptimizerStatus, {});
  expect(cfg.enabled).toBe(false);
});

test("setOptimizerEnabled flips the SAME single row the internal read sees (no second row)", async () => {
  const t = convexTest(schema, modules);
  const asOwner = t.withIdentity({ subject: "owner_a" });

  const res = await asOwner.mutation(api.optimizerConfig.setOptimizerEnabled, { enabled: true });
  expect(res).toEqual({ ok: true, enabled: true });
  // The internal read (CI/eligibility) sees the flip — one shared row.
  const cfg = await t.query(internal.optimizerConfig.getOptimizerConfig, {});
  expect(cfg.enabled).toBe(true);
  const rows = await t.run(async (ctx) => await ctx.db.query("optimizerConfig").collect());
  expect(rows).toHaveLength(1);
});

test("setOptimizerEnabled requires an authenticated identity (owner gate)", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.optimizerConfig.setOptimizerEnabled, { enabled: true }),
  ).rejects.toThrow(/UNAUTHENTICATED/);
});
