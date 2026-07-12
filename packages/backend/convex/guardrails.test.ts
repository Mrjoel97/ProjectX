import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules via import.meta.glob; exclude the tests.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

// These branches all RETURN before guardrails.prepare touches the rateLimiter
// component (kill switch at step 2, over_budget at step 5) — convex-test does not
// load components in this repo (03-RESEARCH caveat), so the happy path + the
// daily_budget_exhausted branch are covered by smoke:guardrails in plan 03-05.

const REQ = {
  tenantId: "tenant_a",
  correlationId: "corr_1",
  goal: "email jane about the Q3 report",
  recipient: "jane@example.com",
  status: "scanning" as const,
  attachmentRefs: [],
  createdAt: Date.now(),
};

async function seedConfig(
  t: ReturnType<typeof convexTest>,
  cfg: { killSwitch: boolean; budgetUsdPerRequest: number },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("guardrailConfig", { ...cfg, updatedAt: Date.now() });
  });
}

test("prepare: kill switch ON returns governed stop before any scan/persist", async () => {
  const t = convexTest(schema, modules);
  await seedConfig(t, { killSwitch: true, budgetUsdPerRequest: 0.05 });
  const requestId = await t.run(async (ctx) => await ctx.db.insert("requests", REQ));

  const res = await t.mutation(internal.guardrails.prepare, { requestId });

  expect(res).toEqual({ ok: false, reason: "kill_switch" });
  const row = await t.run(async (ctx) => await ctx.db.get(requestId));
  expect(row?.safeText).toBeUndefined(); // returned BEFORE scan — nothing persisted
});

test("prepare: budget ~0 fails closed with over_budget (before the spend component)", async () => {
  const t = convexTest(schema, modules);
  await seedConfig(t, { killSwitch: false, budgetUsdPerRequest: 0 });
  const requestId = await t.run(async (ctx) => await ctx.db.insert("requests", REQ));

  const res = await t.mutation(internal.guardrails.prepare, { requestId });

  expect(res).toEqual({ ok: false, reason: "over_budget" });
  const row = await t.run(async (ctx) => await ctx.db.get(requestId));
  expect(row?.safeText).toBeUndefined();
});

test("prepare: missing request id throws (a bug, not a governed stop)", async () => {
  const t = convexTest(schema, modules);
  const requestId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("requests", REQ);
    await ctx.db.delete(id); // dangling but well-typed id
    return id;
  });

  await expect(t.mutation(internal.guardrails.prepare, { requestId })).rejects.toThrow();
});

test("getSafeTextByHash: no matching row throws (fail-closed reader, GRDL-01)", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.query(internal.guardrails.getSafeTextByHash, {
      tenantId: "tenant_a",
      safeTextHash: "deadbeef",
    }),
  ).rejects.toThrow(/safeText missing/);
});

test("preCall: kill switch ON returns governed stop (component-free branch)", async () => {
  const t = convexTest(schema, modules);
  await seedConfig(t, { killSwitch: true, budgetUsdPerRequest: 0.05 });

  const res = await t.mutation(internal.guardrails.preCall, {});

  expect(res).toEqual({ ok: false, reason: "kill_switch" });
});
