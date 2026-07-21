import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
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
