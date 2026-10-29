import { MANAGED_SERVICE_RUN_LIFETIME_MS } from "@pikar/core/managedServices";
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import { managedServiceSpend } from "./lib/managedServiceBudget";
import schema from "./schema";

// A canceled component workflow can still have an action returning its last response.
// Only this external liveness observation is controlled; all local fences and receipts are native.
const workflow = vi.hoisted(() => ({ live: false as boolean | null }));
vi.mock("./dispatchRun", async (original) => ({
  ...(await original<typeof import("./dispatchRun")>()),
  dispatchWorkflowLive: async () => workflow.live,
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
beforeEach(() => {
  workflow.live = false;
});

async function fixture() {
  const t = convexTest(schema, modules);
  t.registerComponent(
    "auditCounts",
    aggregateSchema,
    import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts"),
  );
  t.registerComponent(
    "rateLimiter",
    rateLimiterSchema,
    import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts"),
  );
  const ids = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("users", {});
    const otherId = await ctx.db.insert("users", {});
    const serviceId = await ctx.db.insert("managedServices", {
      tenantId,
      serviceId: "social-marketing",
      revision: 1,
      controlRevision: 1,
      controlState: "active",
      goal: "PRIVATE_SYNTHETIC_GOAL",
      operationIds: ["social.prepare"],
      accounts: [],
      skills: [],
      budgetLimitCents: 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const planId = await ctx.db.insert("plans", {
      tenantId,
      threadId: "synthetic-recovery-thread",
      status: "collecting",
      createdAt: Date.now(),
    });
    const runId = await ctx.db.insert("managedServiceRuns", {
      tenantId,
      serviceId,
      configRevision: 1,
      controlRevision: 1,
      budgetLimitCents: 10,
      requestKey: "recovery-fixture",
      state: "running",
      workflowId: "synthetic-workflow",
      threadId: "synthetic-recovery-thread",
      planId,
      turnId: "synthetic-turn",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { tenantId, otherId, serviceId, planId, runId };
  });
  const owned = t.withIdentity({ subject: `${ids.tenantId}|recovery` });
  const foreign = t.withIdentity({ subject: `${ids.otherId}|other` });
  const recover = (expectedControlRevision = 1) =>
    owned.mutation(api.managedServiceRuns.reconcile, {
      runId: ids.runId,
      expectedRevision: 1,
      expectedControlRevision,
    });
  // Represents an already accepted pre-interruption provider call, without relaxing admission
  // or contacting a provider. Its subsequent settlement uses the actual accounting mutation.
  const heldReceipt = () =>
    t.run((ctx) =>
      ctx.db.insert("spendEvents", {
        tenantId: ids.tenantId,
        managedServiceRunId: ids.runId,
        rail: "reasoning",
        phase: "reserved",
        amountCents: 4,
        correlationId: "paid:12345678-1234-1234-1234-123456789012",
        kind: "paid_call",
        model: "or/openai/gpt-4o-mini",
        createdAt: Date.now(),
      }),
    );
  return { t, owned, foreign, ...ids, recover, heldReceipt };
}

test("cancellation preserves an accepted cost hold; settlement after owner stop permits one recovery", async () => {
  const f = await fixture();
  const reservationId = await f.heldReceipt();
  await f.owned.mutation(api.managedServices.setControl, {
    serviceId: "social-marketing",
    expectedRevision: 1,
    expectedControlRevision: 1,
    action: "stop",
  });
  expect(await f.recover(2)).toMatchObject({ resolved: false, reason: "unsettled_cost" });
  expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({ state: "running" });
  const receipt = { tenantId: f.tenantId, reservationId, costUsd: 0.001 };
  await f.t.mutation(internal.guardrails.settlePaidCall, receipt);
  await f.t.mutation(internal.guardrails.settlePaidCall, receipt);
  expect(await f.t.run((ctx) => managedServiceSpend(ctx, f.tenantId, f.runId))).toMatchObject({
    reservationCount: 1,
    settledCount: 1,
    outstandingNanos: 0,
    actualNanos: 1_000_000,
  });
  expect(await f.recover(2)).toMatchObject({
    resolved: true,
    state: "stopped",
    reason: "interruption_closed",
  });
  expect(await f.recover(2)).toMatchObject({ resolved: true, reason: "already_terminal" });
  const audits = await f.t.run((ctx) => ctx.db.query("audit").collect());
  expect(audits.filter((row) => row.eventType === "managed_service.run_reconciled")).toHaveLength(
    1,
  );
  expect(JSON.stringify(audits)).not.toContain("PRIVATE_SYNTHETIC_GOAL");
});

test("an in-flight canceled worker cannot revive a recovered run, stage a draft or reserve another call", async () => {
  const f = await fixture();
  const reservationId = await f.heldReceipt();
  await f.t.mutation(internal.guardrails.settlePaidCall, {
    tenantId: f.tenantId,
    reservationId,
    costUsd: 0.001,
  });
  expect(await f.recover()).toMatchObject({ resolved: true, state: "stopped" });
  const before = await f.t.run((ctx) => ctx.db.get(f.runId));
  await f.t.mutation(internal.managedServiceRuns.finish, {
    tenantId: f.tenantId,
    runId: f.runId,
    outcome: "completed",
    reply: "PRIVATE_LATE_REPLY",
  });
  await expect(
    f.t.mutation(internal.buffer.stageAgentPost, {
      tenantId: f.tenantId,
      managedServiceRunId: f.runId,
      campaign: "Late campaign",
      channelId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      text: "Late draft",
      mode: "addToQueue",
    }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
  await expect(
    f.t.mutation(internal.guardrails.reservePaidCall, {
      tenantId: f.tenantId,
      managedServiceRunId: f.runId,
      callId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      model: "or/openai/gpt-4o-mini",
      ceilingCents: 1,
    }),
  ).rejects.toThrow("SERVICE_RUN_UNAVAILABLE");
  expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toEqual(before);
  expect(await f.t.run((ctx) => ctx.db.query("bufferPosts").collect())).toHaveLength(0);
  const ledger = await f.t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(ledger.filter((row) => row.phase === "reserved")).toHaveLength(1);
  expect(JSON.stringify(await f.t.run((ctx) => ctx.db.query("audit").collect()))).not.toContain(
    "PRIVATE_LATE_REPLY",
  );
});

test.each([
  true,
  null,
] as const)("liveness %s keeps the attempt blocked without changing its state", async (live) => {
  const f = await fixture();
  workflow.live = live;
  const before = await f.t.run((ctx) => ctx.db.get(f.runId));
  expect(await f.recover()).toMatchObject({
    resolved: false,
    reason: live ? "still_running" : "status_unavailable",
  });
  expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toEqual(before);
  expect(await f.t.run((ctx) => ctx.db.query("audit").collect())).toHaveLength(0);
});

test("only an expired completely unbound claim can recover without a workflow observation", async () => {
  const f = await fixture();
  workflow.live = null;
  await f.t.run((ctx) =>
    ctx.db.patch(f.runId, {
      state: "claimed",
      workflowId: undefined,
      threadId: undefined,
      planId: undefined,
      turnId: undefined,
    }),
  );
  expect(await f.recover()).toMatchObject({ resolved: false, reason: "status_unavailable" });
  await f.t.run((ctx) =>
    ctx.db.patch(f.runId, {
      createdAt: Date.now() - MANAGED_SERVICE_RUN_LIFETIME_MS - 1,
    }),
  );
  expect(await f.recover()).toMatchObject({ resolved: true, state: "stopped" });
});

test("foreign tenants and stale owner controls cannot close an uncertain attempt", async () => {
  const f = await fixture();
  await expect(
    f.foreign.mutation(api.managedServiceRuns.reconcile, {
      runId: f.runId,
      expectedRevision: 1,
      expectedControlRevision: 1,
    }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
  await expect(f.recover(2)).rejects.toThrow("SERVICE_STALE_REVISION");
  expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({ state: "running" });
});

test("a fully billed overrun closes only after definitive workflow termination and preserves its bill", async () => {
  const f = await fixture();
  const reservationId = await f.heldReceipt();
  await f.t.mutation(internal.guardrails.settlePaidCall, {
    tenantId: f.tenantId,
    reservationId,
    costUsd: 0.2,
  });
  await f.t.run((ctx) => ctx.db.patch(f.runId, { state: "unknown" }));
  const bill = await f.t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(await f.t.run((ctx) => managedServiceSpend(ctx, f.tenantId, f.runId))).toMatchObject({
    breached: true,
    outstandingNanos: 0,
    reservationCount: 1,
    settledCount: 1,
    actualNanos: 200_000_000,
  });
  for (const live of [true, null]) {
    workflow.live = live;
    expect(await f.recover()).toMatchObject({ resolved: false });
    expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({ state: "unknown" });
  }
  workflow.live = false;
  expect(await f.recover()).toMatchObject({
    resolved: true,
    state: "stopped",
    reason: "interruption_closed",
  });
  expect(await f.recover()).toMatchObject({ resolved: true, reason: "already_terminal" });
  expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual(bill);
  expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({
    state: "stopped",
    terminalCode: "reconciled_interruption",
  });
  await expect(
    f.t.mutation(internal.guardrails.reservePaidCall, {
      tenantId: f.tenantId,
      managedServiceRunId: f.runId,
      callId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      model: "or/openai/gpt-4o-mini",
      ceilingCents: 1,
    }),
  ).rejects.toThrow("SERVICE_RUN_UNAVAILABLE");
  // Closing old work supplies no readiness for a fresh request and never restarts it.
  await expect(
    f.t.mutation(internal.managedServiceRuns.claim, {
      tenantId: f.tenantId,
      serviceId: "social-marketing",
      expectedRevision: 1,
      expectedControlRevision: 1,
      requestKey: "fresh-after-known-breach",
    }),
  ).rejects.toThrow("SERVICE_EXECUTION_UNAVAILABLE");
});
