import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { confirmServiceKnowledgeFixture } from "../__fixtures__/serviceKnowledge";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { rateLimiter } from "./guardrails";
import { contentHash } from "./lib/hash";
import {
  managedServiceSpend,
  reconcileStandingServiceAccounting,
} from "./lib/managedServiceBudget";
import { claimStandingOccurrence } from "./managedServiceRecurrence";
import schema from "./schema";
import { serviceKnowledgeFor } from "./serviceConversations";
import { listEventsFor } from "./spendLedger";

// Only capability readiness is simulated. Native ownership, claims, both limiters, provider
// receipts, terminal accounting and Finance projection remain the real transaction paths.
vi.mock("./managedServices", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  managedServiceReadiness: vi.fn(async (_ctx: QueryCtx, service: Doc<"managedServices">) => ({
    ready: true,
    skills: service.skills.map((pin: Record<string, unknown>) => ({ ...pin, qualified: true })),
    accounts: service.accounts.map((pin: Record<string, unknown>) => ({ ...pin, connected: true })),
  })),
}));
// Accounting fixtures pin candidate admission; this is not evidence of a qualified release.
// Settlement needs no admission, so accepted late costs remain recordable after stop.
vi.mock("./managedServiceRecurrence", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  MANAGED_SERVICE_RECURRENCE_ENABLED: true,
}));
vi.mock("./dispatchRun", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  dispatchWorkflowLive: async () => false,
}));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const now = Date.parse("2026-11-01T05:30:00Z");
beforeEach(() => {
  vi.stubEnv("FOUNDATION_ONBOARDING_ENABLED", "1");
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture(cap = 40) {
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
  const base = await t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("users", {});
    const goal = "Prepare synthetic draft only";
    const skills = [
      {
        skillId: "synthetic-global-cockpit",
        name: "cockpit-agent",
        version: 1,
        bodyHash: await contentHash("synthetic instructions"),
        tenantId: null,
      },
    ];
    const serviceId = await ctx.db.insert("managedServices", {
      tenantId,
      serviceId: "social-marketing",
      revision: 1,
      controlRevision: 1,
      controlState: "active",
      goal,
      skills,
      accounts: [],
      operationIds: ["social.prepare"],
      budgetLimitCents: cap,
      createdAt: now,
      updatedAt: now,
    });
    return { tenantId, serviceId, goal, skills };
  });
  await confirmServiceKnowledgeFixture(t, base.tenantId);
  const refs = await t.run(async (ctx) => {
    const { tenantId, serviceId, goal, skills } = base;
    const service = await ctx.db.get(serviceId);
    if (!service) throw new Error("MISSING_SERVICE_FIXTURE");
    const knowledge = await serviceKnowledgeFor(ctx, service);
    if (!knowledge.assessment.ready) throw new Error("UNREADY_KNOWLEDGE_FIXTURE");
    const approvalId = await ctx.db.insert("managedServiceStandingApprovals", {
      tenantId,
      serviceId,
      revision: 1,
      configRevision: 1,
      enabled: true,
      controlRevision: 1,
      expiresAtMs: now + 86400_000,
      createdAt: now,
      terms: {
        goalHash: await contentHash(goal),
        operationIds: ["social.prepare"],
        skillPins: skills,
        accountPins: [],
        recipientRefs: [],
        budgetLimitCents: cap,
        schedule: {
          cadence: "daily",
          weekday: null,
          hour: 1,
          minute: 30,
          timeZone: "America/New_York",
        },
      },
    });
    const claimed = await claimStandingOccurrence(
      ctx,
      {
        tenantId,
        approvalId,
        expectedControlRevision: 1,
        localDate: "2026-11-01",
        requestedLocalTime: "01:30",
        timeZone: "America/New_York",
        dueAtMs: now,
      },
      { admitted: true },
    );
    if (!claimed.occurrenceId || claimed.decision !== "claimable")
      throw new Error("FIXTURE_CLAIM_FAILED");
    const planId = await ctx.db.insert("plans", {
      tenantId,
      threadId: "synthetic-thread",
      status: "collecting",
      createdAt: now,
    });
    const runId = await ctx.db.insert("managedServiceRuns", {
      tenantId,
      serviceId,
      standingApprovalId: approvalId,
      standingOccurrenceId: claimed.occurrenceId,
      knowledgeHash: knowledge.sourceHash,
      configRevision: 1,
      controlRevision: 1,
      budgetLimitCents: cap,
      requestKey: "synthetic-standing-request",
      state: "running",
      workflowId: "synthetic-standing-workflow",
      turnId: "synthetic-turn",
      threadId: "synthetic-thread",
      planId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(claimed.occurrenceId, { runId });
    return { tenantId, serviceId, approvalId, runId, occurrenceId: claimed.occurrenceId };
  });
  let calls = 0;
  const reserve = (ceilingCents: number) =>
    t.mutation(internal.guardrails.reservePaidCall, {
      tenantId: refs.tenantId,
      managedServiceRunId: refs.runId,
      ceilingCents,
      model: "or/openai/gpt-4o-mini",
      callId: `12345678-1234-1234-1234-${String(++calls).padStart(12, "0")}`,
    });
  const remaining = () =>
    t.run(async (ctx) => ({
      tenant: (await rateLimiter.getValue(ctx, "dailySpendCents", { key: refs.tenantId })).value,
      deployment: (await rateLimiter.getValue(ctx, "deploymentSpendCents")).value,
    }));
  const settle = (reservationId: Id<"spendEvents">, costUsd: number) =>
    t.mutation(internal.guardrails.settlePaidCall, {
      tenantId: refs.tenantId,
      reservationId,
      costUsd,
    });
  const terminal = (state: "completed" | "unknown" | "stopped", effectsKnown: boolean) =>
    t.run(async (ctx) => {
      await ctx.db.patch(refs.runId, { state });
      await reconcileStandingServiceAccounting(ctx, refs.tenantId, refs.runId, effectsKnown);
    });
  const occurrence = () => t.run((ctx) => ctx.db.get(refs.occurrenceId));
  return { t, ...refs, reserve, settle, remaining, terminal, occurrence };
}

test("a prepaid full-window run executes without a second debit and rounds cumulative usage once", async () => {
  const f = await fixture(500);
  const prepaid = await f.remaining();
  expect(prepaid.tenant).toBe(0);
  expect(
    await f.t.mutation(internal.guardrails.preCall, {
      tenantId: f.tenantId,
      managedServiceRunId: f.runId,
    }),
  ).toEqual({ ok: true });
  for (let index = 0; index < 4; index++) {
    const receipt = await f.reserve(1);
    await f.settle(receipt, 0.0025);
    expect(await f.remaining()).toEqual(prepaid);
  }
  await f.terminal("completed", true);
  expect((await f.remaining()).tenant).toBe(499);
  expect(await f.occurrence()).toMatchObject({
    state: "terminal",
    terminalOutcome: "completed",
    unknownHoldCents: 0,
  });
  const ledger = await f.t.run((ctx) =>
    listEventsFor(ctx, { tenantId: f.tenantId, sinceMs: now - 1, untilMs: now + 1 }),
  );
  expect(
    ledger
      .filter((row) => row.kind !== "paid_call_standing")
      .map((row) => [row.kind, row.phase, row.amountCents]),
  ).toEqual([
    ["standing_service", "reserved", 500],
    ["standing_service", "refunded", 499],
    ["standing_service", "actual", 1],
  ]);
  const finance = await f.t
    .withIdentity({ subject: `${f.tenantId}|synthetic` })
    .query(api.finance.summary, {
      sinceMs: now,
      untilMs: now + 1,
      browserTimeZone: "UTC",
    });
  expect(finance.tracked).toMatchObject({
    coverage: "covered",
    totals: {
      actual: { amountCents: 1 },
      reserved: { amountCents: 500 },
      refunded: { amountCents: 499 },
    },
  });
  expect((await f.t.run((ctx) => managedServiceSpend(ctx, f.tenantId, f.runId))).actualNanos).toBe(
    10_000_000,
  );
});

test("unknown provider usage retains its hold; late trusted settlement survives stop without reviving work", async () => {
  const f = await fixture();
  const held = await f.reserve(4);
  await expect(f.reserve(1)).rejects.toThrow("SERVICE_BUDGET_UNRESOLVED");
  await f.terminal("unknown", false);
  expect((await f.remaining()).tenant).toBe(496);
  expect(await f.occurrence()).toMatchObject({ state: "unknown", unknownHoldCents: 4 });
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.serviceId, { controlState: "stopped", controlRevision: 2 });
    await ctx.db.patch(f.approvalId, { enabled: false });
  });
  await f.settle(held, 0.01);
  expect((await f.remaining()).tenant).toBe(499);
  expect(await f.occurrence()).toMatchObject({ state: "unknown", unknownHoldCents: 0 });
  await f.settle(held, 0.01);
  expect((await f.remaining()).tenant).toBe(499);
  await expect(f.reserve(1)).rejects.toThrow("SERVICE_RUN_UNAVAILABLE");
  await f.terminal("stopped", true);
  expect(await f.occurrence()).toMatchObject({
    state: "terminal",
    terminalOutcome: "execution_uncertain",
  });
});

test("a known provider overrun charges the envelope once and refuses future work", async () => {
  const f = await fixture(10);
  const held = await f.reserve(2);
  // The user replaced the old terms while an accepted provider call was still in flight.
  // A newly observed violation must suspend this CURRENT cadence too, not only the old grant.
  const renewed = await f.t
    .withIdentity({ subject: `${f.tenantId}|synthetic` })
    .mutation(api.managedServiceRecurrence.configure, {
      serviceId: "social-marketing",
      expectedRevision: 1,
      expectedControlRevision: 1,
      expectedApprovalRevision: 1,
      schedule: {
        cadence: "daily",
        weekday: null,
        hour: 2,
        minute: 30,
        timeZone: "America/New_York",
      },
      expiresAtMs: now + 86400_000,
    });
  const future = await f.t.run((ctx) => ctx.db.get(renewed.approvalId));
  const futureDueAtMs = future?.nextDueAtMs;
  const futureTimerId = future?.scheduledFunctionId;
  if (!futureDueAtMs || !futureTimerId) throw new Error("FIXTURE_FUTURE_CADENCE_MISSING");
  expect(await f.settle(held, 0.2)).toMatchObject({ breached: true });
  expect(await f.t.run((ctx) => ctx.db.get(renewed.approvalId))).toMatchObject({
    enabled: false,
    suspensionReason: "budget_required",
  });
  expect(await f.t.run((ctx) => ctx.db.system.get(futureTimerId))).toMatchObject({
    state: { kind: "canceled" },
  });
  expect((await f.remaining()).tenant).toBe(480);
  expect(await f.t.run((ctx) => ctx.db.get(f.runId))).toMatchObject({ state: "unknown" });
  await expect(f.reserve(1)).rejects.toThrow("SERVICE_RUN_UNAVAILABLE");
  await f.terminal("unknown", false);
  expect((await f.remaining()).tenant).toBe(480);
  await f.settle(held, 0.2);
  expect((await f.remaining()).tenant).toBe(480);
  expect(await f.occurrence()).toMatchObject({ unknownHoldCents: 0, state: "unknown" });
  const bill = await f.t.run((ctx) => ctx.db.query("spendEvents").collect());
  const recover = () =>
    f.t
      .withIdentity({ subject: `${f.tenantId}|synthetic` })
      .mutation(api.managedServiceRuns.reconcile, {
        runId: f.runId,
        expectedRevision: 1,
        expectedControlRevision: 1,
      });
  expect(await recover()).toMatchObject({
    resolved: true,
    state: "stopped",
    reason: "interruption_closed",
  });
  expect(await recover()).toMatchObject({ resolved: true, reason: "already_terminal" });
  expect(await f.occurrence()).toMatchObject({
    state: "terminal",
    terminalOutcome: "execution_uncertain",
  });
  expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual(bill);
  expect((await f.remaining()).tenant).toBe(480);
  expect(
    await f.t.mutation(internal.managedServiceRecurrence.tick, {
      tenantId: f.tenantId,
      approvalId: renewed.approvalId,
      expectedApprovalRevision: renewed.revision,
      expectedControlRevision: 1,
      expectedDueAtMs: futureDueAtMs,
    }),
  ).toMatchObject({ decision: "stale_callback", runId: null });
  expect(
    (
      await f.t
        .withIdentity({ subject: `${f.tenantId}|synthetic` })
        .query(api.managedServiceRecurrence.status, { serviceId: "social-marketing" })
    ).approval,
  ).toMatchObject({ enabled: false, suspensionReason: "budget_required", nextDueAtMs: null });
  expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual(bill);
});

test("foreign or broken native standing links refuse before creating a provider receipt", async () => {
  for (const change of ["owner", "run", "approval", "expired", "disabled"] as const) {
    const f = await fixture();
    const prepaid = await f.remaining();
    await f.t.run(async (ctx) => {
      if (change === "owner") await ctx.db.patch(f.occurrenceId, { tenantId: "foreign" });
      if (change === "run") await ctx.db.patch(f.occurrenceId, { runId: undefined });
      if (change === "approval") await ctx.db.patch(f.approvalId, { revision: 2 });
      if (change === "expired") await ctx.db.patch(f.approvalId, { expiresAtMs: now });
      if (change === "disabled") await ctx.db.patch(f.approvalId, { enabled: false });
    });
    await expect(f.reserve(1)).rejects.toThrow(
      /SERVICE_STANDING_(BINDING_INVALID|AUTHORIZATION_REQUIRED)/,
    );
    expect(await f.remaining()).toEqual(prepaid);
    expect(await f.t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(1);
  }
});

test("native setup failure releases the unused envelope and cannot release it twice", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.runId, {
      state: "claimed",
      threadId: undefined,
      planId: undefined,
      turnId: undefined,
      workflowId: undefined,
    }),
  );
  await f.t.mutation(internal.managedServiceRuns.setupFailed, {
    tenantId: f.tenantId,
    runId: f.runId,
  });
  expect((await f.remaining()).tenant).toBe(500);
  expect(await f.occurrence()).toMatchObject({ state: "terminal", unknownHoldCents: 0 });
  await f.t.mutation(internal.managedServiceRuns.setupFailed, {
    tenantId: f.tenantId,
    runId: f.runId,
  });
  expect((await f.remaining()).tenant).toBe(500);
});
