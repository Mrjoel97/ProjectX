import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import { managedServiceSpend } from "./lib/managedServiceBudget";
import schema from "./schema";

// Budget behavior under a future qualified capability, not a qualification witness or runtime flag.
vi.mock("./managedServices", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  managedServiceReadiness: vi.fn(async () => ({ ready: true })),
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const limiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);

async function fixture(cap = 10) {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, limiterModules);
  const tenantId = "service-budget-fixture";
  const ids = await t.run(async (ctx) => {
    const serviceId = await ctx.db.insert("managedServices", {
      tenantId,
      serviceId: "social",
      revision: 1,
      controlRevision: 1,
      controlState: "active",
      goal: "Prepare synthetic workshop copy",
      operationIds: ["social.prepare"],
      accounts: [],
      skills: [],
      budgetLimitCents: cap,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const planId = await ctx.db.insert("plans", {
      tenantId,
      threadId: "synthetic-thread",
      status: "collecting",
      createdAt: Date.now(),
    });
    const runId = await ctx.db.insert("managedServiceRuns", {
      tenantId,
      serviceId,
      configRevision: 1,
      controlRevision: 1,
      budgetLimitCents: cap,
      requestKey: "synthetic-request",
      state: "running",
      turnId: "synthetic-turn",
      threadId: "synthetic-thread",
      planId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { serviceId, planId, runId };
  });
  let sequence = 0;
  const reserve = (ceilingCents: number) =>
    t.mutation(internal.guardrails.reservePaidCall, {
      tenantId,
      managedServiceRunId: ids.runId,
      callId: `12345678-1234-1234-1234-${String(++sequence).padStart(12, "0")}`,
      model: "or/openai/gpt-4o-mini",
      ceilingCents,
    });
  const usage = () => t.run((ctx) => managedServiceSpend(ctx, tenantId, ids.runId));
  return { t, tenantId, ...ids, reserve, usage };
}

test("native per-run cap preserves precise actual cost and never replenishes after rounding", async () => {
  const f = await fixture(2);
  for (let i = 0; i < 4; i++) {
    const reservationId = await f.reserve(1);
    await f.t.mutation(internal.guardrails.settlePaidCall, {
      tenantId: f.tenantId,
      reservationId,
      costUsd: 0.0025,
    });
  }
  expect(await f.usage()).toMatchObject({
    actualNanos: 10_000_000,
    outstandingNanos: 0,
    remainingNanos: 10_000_000,
    settledCount: 4,
  });
  const final = await f.reserve(1);
  await f.t.mutation(internal.guardrails.settlePaidCall, {
    tenantId: f.tenantId,
    reservationId: final,
    costUsd: 0.01,
  });
  expect(await f.usage()).toMatchObject({
    remainingNanos: 0,
    actualNanos: 20_000_000,
    breached: false,
  });
  await expect(f.reserve(1)).rejects.toThrow("SERVICE_BUDGET_EXHAUSTED");
});

test("unknown provider holds prevent another call; settlement survives stop and is idempotent", async () => {
  const f = await fixture();
  const reservationId = await f.reserve(4);
  await expect(f.reserve(1)).rejects.toThrow("SERVICE_BUDGET_UNRESOLVED");
  await f.t.run((ctx) =>
    ctx.db.patch(f.serviceId, { controlState: "stopped", controlRevision: 2 }),
  );
  const settlement = { tenantId: f.tenantId, reservationId, costUsd: 0.001 };
  await f.t.mutation(internal.guardrails.settlePaidCall, settlement);
  await f.t.mutation(internal.guardrails.settlePaidCall, settlement);
  expect(await f.usage()).toMatchObject({
    reservationCount: 1,
    settledCount: 1,
    outstandingNanos: 0,
    actualNanos: 1_000_000,
  });
  await expect(f.reserve(1)).rejects.toThrow("SERVICE_RUN_FENCED");
});

test("concurrent provider admissions serialize on the run ledger", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([f.reserve(3), f.reserve(3)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(await f.usage()).toMatchObject({ reservationCount: 1, outstandingNanos: 30_000_000 });
});

test("foreign, stale configuration, changed permission and wrong plan refs refuse before billing", async () => {
  for (const change of ["foreign", "configuration", "permission", "plan", "terminal"] as const) {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      if (change === "foreign") await ctx.db.patch(f.runId, { tenantId: "other-tenant" });
      if (change === "configuration") await ctx.db.patch(f.serviceId, { revision: 2 });
      if (change === "permission") await ctx.db.patch(f.serviceId, { controlRevision: 2 });
      if (change === "plan") await ctx.db.patch(f.planId, { tenantId: "other-tenant" });
      if (change === "terminal") await ctx.db.patch(f.runId, { state: "unknown" });
    });
    await expect(f.reserve(1)).rejects.toThrow(/SERVICE_RUN_(FENCED|UNAVAILABLE)/);
    expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(0);
  }
});

test("zero usage settles a hold once; a provider breach blocks any later admission", async () => {
  const f = await fixture(10);
  const zero = await f.reserve(1);
  await f.t.mutation(internal.guardrails.settlePaidCall, {
    tenantId: f.tenantId,
    reservationId: zero,
    costUsd: 0,
  });
  expect(await f.usage()).toMatchObject({ outstandingNanos: 0, actualNanos: 0, settledCount: 1 });
  const breached = await f.reserve(1);
  expect(
    await f.t.mutation(internal.guardrails.settlePaidCall, {
      tenantId: f.tenantId,
      reservationId: breached,
      costUsd: 0.02,
    }),
  ).toMatchObject({ breached: true });
  expect(await f.usage()).toMatchObject({ breached: true, actualNanos: 20_000_000 });
  await expect(f.reserve(1)).rejects.toThrow("SERVICE_BUDGET_BREACHED");
});

test("invalid ceilings and unsupported rails create no service reservation", async () => {
  for (const cap of [0, 1001]) {
    const f = await fixture(cap);
    await expect(f.reserve(1)).rejects.toThrow("SERVICE_BUDGET_INVALID");
    expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(0);
  }
  const f = await fixture();
  await expect(f.reserve(0)).rejects.toThrow("PAID_ADMISSION_INVALID");
  await expect(
    f.t.mutation(internal.guardrails.reservePaidCall, {
      tenantId: f.tenantId,
      managedServiceRunId: f.runId,
      callId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ceilingCents: 1,
      model: "or/openai/gpt-4o-mini",
      rail: "ingest",
    }),
  ).rejects.toThrow("SERVICE_PAID_RAIL_UNSUPPORTED");
  expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(0);
});

test("an expired attended run cannot issue a delayed paid call, but its held cost can settle", async () => {
  const f = await fixture();
  const reservationId = await f.reserve(1);
  await f.t.run((ctx) => ctx.db.patch(f.runId, { createdAt: Date.now() - 3_600_001 }));
  await expect(f.reserve(1)).rejects.toThrow("SERVICE_RUN_EXPIRED");
  await f.t.mutation(internal.guardrails.settlePaidCall, {
    tenantId: f.tenantId,
    reservationId,
    costUsd: 0.001,
  });
  expect(await f.usage()).toMatchObject({ outstandingNanos: 0, actualNanos: 1_000_000 });
});
