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
  expect(rows[0]!.enabled).toBe(false);
});

test("setOptimizerConfig: can set lastRunAt (the cooldown anchor)", async () => {
  const t = convexTest(schema, modules);

  await t.mutation(internal.optimizerConfig.setOptimizerConfig, { lastRunAt: 1234 });
  const cfg = await t.query(internal.optimizerConfig.getOptimizerConfig, {});

  expect(cfg.lastRunAt).toBe(1234);
  expect(cfg.enabled).toBe(false); // still DORMANT — lastRunAt does not enable
});

// The ops-page public wrappers (Plan 06, owner-gated in 22-02): the read + kill-switch flip
// write the SAME single row through the SAME shared upsert as the internal CI mutation.
//
// These fixtures insert REAL `users` rows rather than naming a fabricated subject, because
// GOVN-01 authority is the `users.owner` boolean — a subject string is no longer evidence of
// anything. `owner:true` / `owner:false` / absent are three DIFFERENT identities here.
async function withUsers(t: ReturnType<typeof convexTest>) {
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  const plainId = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    asOwner: t.withIdentity({ subject: `${ownerId}|session_a` }),
    asNonOwner: t.withIdentity({ subject: `${plainId}|session_a` }),
  };
}

test("getOptimizerStatus reads DORMANT default for the owner", async () => {
  const t = convexTest(schema, modules);
  const { asOwner } = await withUsers(t);

  const cfg = await asOwner.query(api.optimizerConfig.getOptimizerStatus, {});
  expect(cfg.enabled).toBe(false);
});

test("setOptimizerEnabled flips the SAME single row the internal read sees (no second row)", async () => {
  const t = convexTest(schema, modules);
  const { asOwner } = await withUsers(t);

  const res = await asOwner.mutation(api.optimizerConfig.setOptimizerEnabled, { enabled: true });
  expect(res).toEqual({ ok: true, enabled: true });
  // The internal read (CI/eligibility) sees the flip — one shared row.
  const cfg = await t.query(internal.optimizerConfig.getOptimizerConfig, {});
  expect(cfg.enabled).toBe(true);
  const rows = await t.run(async (ctx) => await ctx.db.query("optimizerConfig").collect());
  expect(rows).toHaveLength(1);
});

test("setOptimizerEnabled requires an authenticated identity", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.mutation(api.optimizerConfig.setOptimizerEnabled, { enabled: true }),
  ).rejects.toThrow(/UNAUTHENTICATED/);
});

// GOVN-01 — the boundary this plan exists to build. Authentication is NOT authorization.

test("a non-owner cannot READ global optimizer state", async () => {
  const t = convexTest(schema, modules);
  const { asNonOwner } = await withUsers(t);

  await expect(asNonOwner.query(api.optimizerConfig.getOptimizerStatus, {})).rejects.toThrow(
    /OWNER_REQUIRED/,
  );
});

test("a refused write leaves the table ABSENT — the refusal precedes writeConfig", async () => {
  const t = convexTest(schema, modules);
  const { asNonOwner } = await withUsers(t);

  await expect(
    asNonOwner.mutation(api.optimizerConfig.setOptimizerEnabled, { enabled: true }),
  ).rejects.toThrow(/OWNER_REQUIRED/);

  // Zero rows, not "a row that happens to say false": if the guard ran AFTER the upsert,
  // the throw would still surface but a row would exist. This is what pins the ORDER.
  expect(await t.run((ctx) => ctx.db.query("optimizerConfig").collect())).toHaveLength(0);
});

test("a refused write against an EXISTING row changes nothing", async () => {
  const t = convexTest(schema, modules);
  const { asOwner, asNonOwner } = await withUsers(t);

  await asOwner.mutation(api.optimizerConfig.setOptimizerEnabled, { enabled: true });
  const before = await t.run((ctx) => ctx.db.query("optimizerConfig").collect());

  await expect(
    asNonOwner.mutation(api.optimizerConfig.setOptimizerEnabled, { enabled: false }),
  ).rejects.toThrow(/OWNER_REQUIRED/);

  // Anti-vacuity: the row really existed and really said `true` before the refusal.
  expect(before).toHaveLength(1);
  expect(before[0]?.enabled).toBe(true);
  expect(await t.run((ctx) => ctx.db.query("optimizerConfig").collect())).toEqual(before);
});

test("the INTERNAL CI/eligibility seams still work with no identity at all", async () => {
  const t = convexTest(schema, modules);
  // Owner-gating the public wrappers must not gate the trusted internal path — the CI job
  // and the eligibility check run from the scheduler with no browser identity.
  await t.mutation(internal.optimizerConfig.setOptimizerConfig, { enabled: true });
  expect((await t.query(internal.optimizerConfig.getOptimizerConfig, {})).enabled).toBe(true);
});
