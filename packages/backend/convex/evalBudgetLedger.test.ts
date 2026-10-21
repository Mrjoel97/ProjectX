import { EVAL_BUDGET_LIFETIME_MS } from "@pikar/cost/evalBudget";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DAILY_BUDGET_CENTS, DEPLOYMENT_BUDGET_CENTS, rateLimiter } from "./guardrails";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const limiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const tenantId = "eval-abcdef12";
const childTenant = "eval-abcdef12-case-a1";
const harness = () => {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, limiterModules);
  return t;
};
const open = (t: ReturnType<typeof harness>, capCents = 3) =>
  t.mutation(internal.guardrails.openEvalBudget, {
    tenantIds: [tenantId, childTenant],
    capCents,
    family: "golden",
  });
const chat = (budgetId: Awaited<ReturnType<typeof open>>) => ({
  tenantId,
  budgetId,
  callId: crypto.randomUUID(),
  model: "or/openai/gpt-4o-mini",
  outputTokens: 1,
  providerCall: { kind: "chat" as const, model: "or/openai/gpt-4o-mini", maxOutputTokens: 1 },
});
const search = (budgetId: Awaited<ReturnType<typeof open>>, tenant = tenantId) => ({
  tenantId: tenant,
  budgetId,
  callId: crypto.randomUUID(),
  model: "tavily-search",
  outputTokens: 0,
  providerCall: { kind: "tavily-search" as const, depth: "basic" as const },
});

beforeEach(() => {
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.stubEnv("GOLDEN_TAVILY_BILLING", "free");
  vi.stubEnv("GOLDEN_TAVILY_CREDIT_USD", "0");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

test("only new isolated golden envelopes opt in; legacy closed status remains exact", async () => {
  const t = harness();
  const golden = await open(t);
  expect((await t.run((ctx) => ctx.db.get(golden)))?.evalEnvelope?.accountingMode).toBe(
    "ledger-nanos-v1",
  );
  const packed = await t.mutation(internal.guardrails.openEvalBudget, {
    tenantIds: ["packeval-abcdef12-case-one"],
    capCents: 3,
  });
  expect((await t.run((ctx) => ctx.db.get(packed)))?.evalEnvelope?.accountingMode).toBeUndefined();
  const owner = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  await t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: owner,
      threadId: "probe",
      recipients: [],
      subject: "",
      body: "",
      status: "collecting",
      createdAt: Date.now(),
    }),
  );
  const probe = await t.mutation(internal.guardrails.openEvalBudget, {
    tenantIds: [owner],
    capCents: 3,
    family: "golden",
    authoringProbe: { threadId: "probe", authorizationSha256: "a".repeat(64) },
  });
  expect((await t.run((ctx) => ctx.db.get(probe)))?.evalEnvelope?.accountingMode).toBeUndefined();

  // Stored pre-upgrade golden envelopes are deliberately missing the immutable mode marker.
  for (let i = 0; i < 2; i++) {
    const legacy = await t.run((ctx) =>
      ctx.db.insert("spendEvents", {
        tenantId,
        rail: "reasoning",
        phase: "estimated",
        amountCents: 3,
        correlationId: `legacy-${i}`,
        kind: "eval_envelope",
        createdAt: Date.now(),
        evalEnvelope: { tenantIds: [tenantId], expiresAt: Date.now() + EVAL_BUDGET_LIFETIME_MS },
      }),
    );
    const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, chat(legacy));
    await t.mutation(internal.guardrails.settleEvalCall, {
      tenantId,
      reservationId,
      costUsd: 0.0001,
    });
    await t.mutation(internal.guardrails.closeEvalBudget, { budgetId: legacy });
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId: legacy })).toEqual({
      budgetId: legacy,
      closed: true,
      capCents: 3,
      expired: false,
      breached: false,
      remainingCents: 2,
      actualUsd: 0.0001,
      callCount: 1,
      settledCount: 1,
      unsettledCount: 0,
      unresolvedCents: 0,
    });
  }
});

test("native golden accounting does not debit/refund its component window; daily rails remain", async () => {
  const t = harness();
  const budgetId = await open(t);
  const envelope = await t.run((ctx) => ctx.db.get(budgetId));
  if (!envelope) throw Error("missing envelope");
  const config = {
    kind: "fixed window" as const,
    rate: 3,
    capacity: 3,
    period: EVAL_BUDGET_LIFETIME_MS,
    start: envelope.createdAt,
  };
  // Deliberately drain the unused component bucket; new-mode family admission ignores it.
  await t.run((ctx) =>
    rateLimiter.limit(ctx, "evalBudgetCents", { key: String(budgetId), config, count: 3 }),
  );
  const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, chat(budgetId));
  await t.mutation(internal.guardrails.settleEvalCall, {
    tenantId,
    reservationId,
    costUsd: 0.0001,
  });
  expect(
    (
      await t.run((ctx) =>
        rateLimiter.getValue(ctx, "evalBudgetCents", { key: String(budgetId), config }),
      )
    ).value,
  ).toBe(0);
  expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId })).toBe(
    DAILY_BUDGET_CENTS - 1,
  );
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    remainingCents: 2,
    actualUsd: 0.0001,
    settledCount: 1,
  });
});

test("settled sub-cent calls use actual nanos rather than accumulating whole-cent family debits", async () => {
  const t = harness();
  const budgetId = await open(t);
  for (let i = 0; i < 6; i++) {
    const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, chat(budgetId));
    await t.mutation(internal.guardrails.settleEvalCall, {
      tenantId,
      reservationId,
      costUsd: 0.0001,
    });
  }
  const status = await t.query(internal.guardrails.evalBudgetStatus, { budgetId });
  expect(status).toMatchObject({
    remainingCents: 2,
    callCount: 6,
    settledCount: 6,
    unsettledCount: 0,
  });
  expect(status.actualUsd).toBeCloseTo(0.0006, 12);
  await expect(
    t.mutation(internal.guardrails.closeEvalBudget, { budgetId }),
  ).resolves.toMatchObject({
    closed: true,
  });
  await expect(t.mutation(internal.guardrails.reserveEvalCall, chat(budgetId))).rejects.toThrow(
    "EVAL_BUDGET_CLOSED",
  );
});

test("concurrent same-family reservations cannot both spend the same nano balance", async () => {
  const t = harness();
  const budgetId = await open(t, 1);
  const results = await Promise.allSettled([
    t.mutation(internal.guardrails.reserveEvalCall, search(budgetId)),
    t.mutation(internal.guardrails.reserveEvalCall, search(budgetId, childTenant)),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    remainingCents: 0,
    callCount: 1,
    unsettledCount: 1,
    unresolvedCents: 1,
  });
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "NOT_SETTLED",
  );
  // Positive control: separate funded native envelopes admit both calls.
  const other = await open(t, 1);
  await expect(
    t.mutation(internal.guardrails.reserveEvalCall, search(other)),
  ).resolves.toBeTruthy();
});

test("closure and a concurrent reservation serialize to one valid native boundary", async () => {
  const t = harness();
  const budgetId = await open(t, 1);
  const [closed, reserved] = await Promise.allSettled([
    t.mutation(internal.guardrails.closeEvalBudget, { budgetId }),
    t.mutation(internal.guardrails.reserveEvalCall, search(budgetId)),
  ]);
  expect([closed, reserved].filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject(
    closed.status === "fulfilled"
      ? { closed: true, callCount: 0, unsettledCount: 0 }
      : { closed: false, callCount: 1, unsettledCount: 1, unresolvedCents: 1 },
  );
});

test("a one-nano known charge cannot be rounded away to admit another full ceiling", async () => {
  const t = harness();
  const budgetId = await open(t, 2);
  const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, chat(budgetId));
  const settlement = { tenantId, reservationId, costUsd: 0.000000001 };
  await t.mutation(internal.guardrails.settleEvalCall, settlement);
  await t.mutation(internal.guardrails.settleEvalCall, settlement);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    remainingCents: 1,
    actualUsd: 0.000000001,
    callCount: 1,
    settledCount: 1,
  });
  await expect(t.mutation(internal.guardrails.reserveEvalCall, chat(budgetId))).rejects.toThrow(
    "BUDGET_EXHAUSTED",
  );
  const zeroBudget = await open(t, 2);
  const zero = await t.mutation(internal.guardrails.reserveEvalCall, chat(zeroBudget));
  await t.mutation(internal.guardrails.settleEvalCall, {
    tenantId,
    reservationId: zero,
    costUsd: 0,
  });
  await expect(
    t.mutation(internal.guardrails.reserveEvalCall, chat(zeroBudget)),
  ).resolves.toBeTruthy();
});

test("known breach remains observable and blocks both reservation and closure", async () => {
  const t = harness();
  const budgetId = await open(t, 2);
  const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, chat(budgetId));
  await expect(
    t.mutation(internal.guardrails.settleEvalCall, {
      tenantId,
      reservationId,
      costUsd: 0.020000001,
    }),
  ).resolves.toMatchObject({ breached: true });
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    actualUsd: 0.020000001,
    remainingCents: 0,
    breached: true,
    unsettledCount: 0,
  });
  await expect(t.mutation(internal.guardrails.reserveEvalCall, search(budgetId))).rejects.toThrow(
    "BUDGET_BREACHED",
  );
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "NOT_SETTLED",
  );
});

test("new mode retains daily/deployment admission and leaves no rejected reservation", async () => {
  for (const rail of ["dailySpendCents", "deploymentSpendCents"] as const) {
    const t = harness();
    const budgetId = await open(t);
    await t.run((ctx) =>
      rail === "dailySpendCents"
        ? rateLimiter.limit(ctx, rail, { key: tenantId, count: DAILY_BUDGET_CENTS })
        : rateLimiter.limit(ctx, rail, { count: DEPLOYMENT_BUDGET_CENTS }),
    );
    await expect(t.mutation(internal.guardrails.reserveEvalCall, chat(budgetId))).rejects.toThrow(
      rail === "dailySpendCents"
        ? "EVAL_DAILY_BUDGET_EXHAUSTED"
        : "EVAL_DEPLOYMENT_BUDGET_EXHAUSTED",
    );
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      callCount: 0,
      remainingCents: 3,
    });
  }
});

test("new mode retains kill switch and the 500-call ceiling even after zero-cost settlement", async () => {
  const t = harness();
  const budgetId = await open(t, 500);
  const configId = await t.run((ctx) =>
    ctx.db.insert("guardrailConfig", {
      killSwitch: true,
      budgetUsdPerRequest: 1,
      updatedAt: Date.now(),
    }),
  );
  await expect(t.mutation(internal.guardrails.reserveEvalCall, search(budgetId))).rejects.toThrow(
    "KILL_SWITCH",
  );
  const reservationId = await t.run(async (ctx) => {
    await ctx.db.patch(configId, { killSwitch: false });
    let first: Id<"spendEvents"> | undefined;
    for (let i = 0; i < 500; i++) {
      const id = await ctx.db.insert("spendEvents", {
        tenantId,
        rail: "reasoning",
        phase: "reserved",
        amountCents: 1,
        correlationId: `evalcall:${crypto.randomUUID()}`,
        kind: "eval_provider",
        model: "tavily-search",
        createdAt: Date.now(),
        evalBudgetId: budgetId,
      });
      first ??= id;
    }
    if (!first) throw Error("missing reservation");
    return first;
  });
  await t.mutation(internal.guardrails.settleEvalCall, {
    tenantId,
    reservationId,
    costUsd: 0,
    tavilyCredits: 0,
  });
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    callCount: 500,
    settledCount: 1,
    remainingCents: 1,
  });
  await expect(t.mutation(internal.guardrails.reserveEvalCall, search(budgetId))).rejects.toThrow(
    "CALL_LIMIT",
  );
});

test("expiry never reopens native family capacity and late settlement retains ordinary rails", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 21));
  const t = harness();
  const budgetId = await open(t, 2);
  const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, chat(budgetId));
  vi.setSystemTime(Date.now() + 48 * 60 * 60 * 1000);
  await t.run((ctx) => rateLimiter.limit(ctx, "dailySpendCents", { key: tenantId, count: 100 }));
  const before = await t.query(internal.guardrails.remainingDailyCents, { tenantId });
  await t.mutation(internal.guardrails.settleEvalCall, { tenantId, reservationId, costUsd: 0 });
  expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId })).toBe(before);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    expired: true,
    remainingCents: 0,
    settledCount: 1,
  });
  await expect(t.mutation(internal.guardrails.reserveEvalCall, search(budgetId))).rejects.toThrow(
    "BUDGET_EXPIRED",
  );
});
