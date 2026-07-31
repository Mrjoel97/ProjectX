import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
// The 22.1-02 budget tests drive the REAL rate-limiter component (relative import — the package
// block deep specifiers). The dispatch.test.ts / runCockpitAgent.test.ts idiom, verbatim.
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import { DAILY_BUDGET_CENTS, DEPLOYMENT_BUDGET_CENTS } from "./guardrails";
import schema from "./schema";

// convex-test discovers Convex modules via import.meta.glob; exclude the tests.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

/** A harness with the rate-limiter component registered, for the budget-rail tests only. */
function budgetHarness() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
}

// The tests BELOW this line (up to the 22.1-02 block) all RETURN before guardrails.prepare
// touches the rateLimiter component (kill switch at step 2, over_budget at step 5), so they
// use the plain `convexTest` harness and need no component.
//
// 22.1-02 corrects the old caveat here: the rate-limiter component CAN be registered under
// convex-test (dispatch.test.ts:116 already did), so the spend rails are now unit-proven by
// `budgetHarness` above rather than left entirely to smoke:guardrails. smoke:guardrails still
// owns the end-to-end prepare/preCall-through-the-pipeline path.

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

  const res = await t.mutation(internal.guardrails.preCall, { tenantId: "tenant_a" });

  expect(res).toEqual({ ok: false, reason: "kill_switch" });
});

// ── 22.1-02: the two spend rails ───────────────────────────────────────────────────
// Until 22.1-02 `dailySpendCents` was KEYLESS — it capped the deployment, so one tenant's
// loop refused every other tenant. These drive the REAL limiter component, so they fail if
// the `{ key: tenantId }` is ever dropped again.
describe("spend rails: per-tenant window + keyless deployment ceiling", () => {
  const A = "tenant_a";
  const B = "tenant_b";
  /** Spend `cents` for one tenant through the real recordSpend path. */
  const spend = (t: ReturnType<typeof budgetHarness>, tenantId: string, cents: number) =>
    t.mutation(internal.guardrails.recordSpend, { tenantId, costUsd: cents / 100 });

  test("THE POINT: tenant A exhausting its day does not refuse tenant B", async () => {
    const t = budgetHarness();
    await seedConfig(t, { killSwitch: false, budgetUsdPerRequest: 0.05 });

    // A burns its entire personal allowance — but stays well under the deployment ceiling,
    // so anything B sees must come from the KEY, not from the shared rail.
    await spend(t, A, DAILY_BUDGET_CENTS);
    expect(DAILY_BUDGET_CENTS).toBeLessThan(DEPLOYMENT_BUDGET_CENTS); // the test is not vacuous

    expect(await t.mutation(internal.guardrails.preCall, { tenantId: A })).toEqual({
      ok: false,
      reason: "daily_budget_exhausted",
    });
    // Mutation check: drop `key: tenantId` from dailySpendCents and this line goes RED.
    expect(await t.mutation(internal.guardrails.preCall, { tenantId: B })).toEqual({ ok: true });
  });

  test("the deployment ceiling still binds, with its own distinct reason", async () => {
    const t = budgetHarness();
    await seedConfig(t, { killSwitch: false, budgetUsdPerRequest: 0.05 });

    // Many tenants, each individually modest, together exceeding the ceiling. No single
    // tenant is over its own allowance, so only the global rail can refuse here.
    const perTenant = DAILY_BUDGET_CENTS - 1;
    const needed = Math.ceil(DEPLOYMENT_BUDGET_CENTS / perTenant);
    for (let i = 0; i < needed; i++) await spend(t, `crowd_${i}`, perTenant);

    // A fresh tenant has its FULL personal budget and is still refused — and is told the
    // truth about why, rather than being blamed for spending a day it never touched.
    expect(await t.mutation(internal.guardrails.preCall, { tenantId: "newcomer" })).toEqual({
      ok: false,
      reason: "deployment_budget_exhausted",
    });
  });

  test("recordSpend moves BOTH rails, and remainingDailyCents reports the tighter one", async () => {
    const t = budgetHarness();
    const before = await t.query(internal.guardrails.remainingDailyCents, { tenantId: A });
    expect(before).toBe(DAILY_BUDGET_CENTS); // tenant rail is tighter than the ceiling

    await spend(t, A, 100);
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId: A })).toBe(
      DAILY_BUDGET_CENTS - 100,
    );
    // B never spent, so its own rail is untouched — proof the tenant window is keyed...
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId: B })).toBe(
      DAILY_BUDGET_CENTS,
    );
    // ...while the deployment rail DID absorb A's spend (keyless, shared by construction).
    const drained = DEPLOYMENT_BUDGET_CENTS - 100;
    await spend(t, B, drained - DAILY_BUDGET_CENTS + 1); // push the ceiling below B's own rail
    const remaining = await t.query(internal.guardrails.remainingDailyCents, { tenantId: "fresh" });
    expect(remaining).toBeLessThan(DAILY_BUDGET_CENTS); // the min() picked the ceiling
  });

  test("a rail driven negative by reserve:true clamps to 0, never a negative envelope", async () => {
    const t = budgetHarness();
    // recordSpend uses reserve:true so real spend is never under-counted — it overshoots.
    await spend(t, A, DAILY_BUDGET_CENTS * 3);
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId: A })).toBe(0);
  });
});
