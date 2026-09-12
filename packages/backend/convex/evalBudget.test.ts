import { EVAL_BUDGET_LIFETIME_MS, evalCallCeilingCents } from "@pikar/cost/evalBudget";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import { DAILY_BUDGET_CENTS, rateLimiter } from "./guardrails";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const tenantId = "packeval-abcdef12-case-one";
const otherTenant = "packeval-abcdef12-case-two";
const model = "or/openai/gpt-5.6-luna";
const reservationCents = evalCallCeilingCents(model, 8192);
const harness = () => {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  return t;
};
afterEach(() => vi.useRealTimers());

async function goldenEnvelope(t: ReturnType<typeof harness>) {
  return t.run((ctx) =>
    ctx.db.insert("spendEvents", {
      tenantId: "eval-abcdef12",
      rail: "reasoning",
      phase: "estimated",
      amountCents: 200,
      correlationId: "offline-golden-close",
      kind: "eval_envelope",
      createdAt: Date.now(),
      evalEnvelope: {
        tenantIds: ["eval-abcdef12"],
        expiresAt: Date.now() + EVAL_BUDGET_LIFETIME_MS,
      },
    }),
  );
}

test("golden closure refuses queued descendants before their first reservation", async () => {
  const t = harness();
  const budgetId = await goldenEnvelope(t);
  const planId = await t.run((ctx) =>
    ctx.db.insert("plans", {
      tenantId: "eval-abcdef12",
      threadId: "queued",
      kind: "memo",
      status: "collecting",
      recipients: [],
      subject: "",
      body: "",
      createdAt: Date.now(),
    }),
  );
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "GOLDEN_GRAPH_NOT_SETTLED",
  );
  await t.run((ctx) =>
    ctx.db.patch(planId, { status: "proposed", workflowId: "unknown-workflow" }),
  );
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "GOLDEN_GRAPH_NOT_SETTLED",
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(planId, { workflowId: undefined });
    // Ordinary incomplete composition and another tenant's paid work do not block this run.
    await ctx.db.insert("plans", {
      tenantId: "eval-abcdef12",
      threadId: "draft",
      status: "collecting",
      recipients: [],
      subject: "",
      body: "",
      createdAt: Date.now(),
    });
    await ctx.db.insert("plans", {
      tenantId: "eval-ffffffff",
      threadId: "other",
      kind: "memo",
      status: "collecting",
      recipients: [],
      subject: "",
      body: "",
      createdAt: Date.now(),
    });
  });
  expect(await t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).toMatchObject({
    closed: true,
  });
});

test("golden closure waits for the final ingest step even with an empty spend ledger", async () => {
  const t = harness();
  const budgetId = await goldenEnvelope(t);
  const docId = await t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: "eval-abcdef12",
      evalBudgetId: budgetId,
      title: "Research",
      kind: "web_research",
      category: "market",
      source: "seam",
      mimeType: "text/markdown",
      size: 0,
      contentHash: "offline",
      status: "processing",
      createdAt: Date.now(),
    }),
  );
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "GOLDEN_GRAPH_NOT_SETTLED",
  );
  await t.run((ctx) => ctx.db.patch(docId, { status: "ready" }));
  expect(await t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).toMatchObject({
    closed: true,
  });
});

test("golden closure cannot turn a partial graph inventory into success", async () => {
  const t = harness();
  const budgetId = await goldenEnvelope(t);
  await t.run(async (ctx) => {
    for (let i = 0; i < 257; i++)
      await ctx.db.insert("plans", {
        tenantId: "eval-abcdef12",
        threadId: `draft-${i}`,
        status: "proposed",
        recipients: [],
        subject: "",
        body: "",
        createdAt: Date.now(),
      });
  });
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "GOLDEN_GRAPH_SCAN_LIMIT",
  );
});

describe("aggregate evaluation reservation in existing spend plane", () => {
  test("known provider breach persists exact actual, closes budget, and rejects foreign settlement", async () => {
    const t = harness();
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [tenantId, otherTenant],
      capCents: 200,
    });
    const args = { tenantId, budgetId, model, outputTokens: 8192, callId: crypto.randomUUID() };
    const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, args);
    await expect(
      t.mutation(internal.guardrails.settleEvalCall, {
        tenantId: otherTenant,
        reservationId,
        costUsd: 0,
      }),
    ).rejects.toThrow("RESERVATION_NOT_FOUND");
    const costUsd = (reservationCents + 1) / 100;
    expect(
      await t.mutation(internal.guardrails.settleEvalCall, { tenantId, reservationId, costUsd }),
    ).toMatchObject({ breached: true });
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      breached: true,
      actualUsd: costUsd,
      settledCount: 1,
    });
    await expect(
      t.mutation(internal.guardrails.reserveEvalCall, { ...args, callId: crypto.randomUUID() }),
    ).rejects.toThrow("BUDGET_BREACHED");
    expect(
      await t.mutation(internal.guardrails.settleEvalCall, { tenantId, reservationId, costUsd }),
    ).toMatchObject({ breached: true });
  });

  test("500 reserved calls bound all later settlement rows, including outstanding calls", async () => {
    const t = harness();
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [tenantId],
      capCents: 200,
    });
    // Seed the boundary directly: real provider execution is unnecessary to test bounded inventory.
    const ids = await t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 500; i++)
        ids.push(
          await ctx.db.insert("spendEvents", {
            tenantId,
            rail: "reasoning",
            phase: "reserved",
            amountCents: 1,
            correlationId: `evalcall:${crypto.randomUUID()}`,
            kind: "eval_model",
            model,
            createdAt: Date.now(),
            evalBudgetId: budgetId,
          }),
        );
      return ids;
    });
    await expect(
      t.mutation(internal.guardrails.reserveEvalCall, {
        tenantId,
        budgetId,
        model,
        outputTokens: 8192,
        callId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("CALL_LIMIT");
    // Settling the last outstanding calls remains allowed once the call cap is reached.
    for (const reservationId of ids.slice(-2))
      await t.mutation(internal.guardrails.settleEvalCall, {
        tenantId,
        reservationId,
        costUsd: 0.001,
      });
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      callCount: 500,
      settledCount: 2,
      unsettledCount: 498,
    });
  });

  test("whole-context ceiling is positive; aggregate cap includes other fixture tenants and failed holds", async () => {
    const t = harness();
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [tenantId, otherTenant],
      capCents: reservationCents,
    });
    const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, {
      tenantId,
      budgetId,
      callId: crypto.randomUUID(),
      model,
      outputTokens: 8192,
    });
    expect(reservationId).toBeTruthy();
    await expect(
      t.mutation(internal.guardrails.reserveEvalCall, {
        tenantId: otherTenant,
        budgetId,
        callId: crypto.randomUUID(),
        model,
        outputTokens: 8192,
      }),
    ).rejects.toThrow("EVAL_BUDGET_EXHAUSTED");
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      remainingCents: 0,
      actualUsd: 0,
      unsettledCount: 1,
      unresolvedCents: reservationCents,
    });
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId })).toBe(
      DAILY_BUDGET_CENTS - reservationCents,
    );
  });

  test("exact settlement refunds only unused hold, is idempotent, and allows the next bounded call", async () => {
    const t = harness();
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [tenantId],
      capCents: reservationCents + 1,
    });
    const callId = crypto.randomUUID();
    const args = { tenantId, budgetId, callId, model, outputTokens: 8192 };
    const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, args);
    await expect(t.mutation(internal.guardrails.reserveEvalCall, args)).rejects.toThrow(
      "EVAL_CALL_ALREADY_RESERVED",
    );
    await t.mutation(internal.guardrails.settleEvalCall, {
      tenantId,
      reservationId,
      costUsd: 0.000123,
    });
    await t.mutation(internal.guardrails.settleEvalCall, {
      tenantId,
      reservationId,
      costUsd: 0.000123,
    });
    await expect(
      t.mutation(internal.guardrails.settleEvalCall, { tenantId, reservationId, costUsd: 0 }),
    ).rejects.toThrow("EVAL_SETTLEMENT_MISMATCH");
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      actualUsd: 0.000123,
      settledCount: 1,
      unsettledCount: 0,
      remainingCents: reservationCents,
    });
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId })).toBe(
      DAILY_BUDGET_CENTS - 1,
    );
    const next = await t.mutation(internal.guardrails.reserveEvalCall, {
      ...args,
      callId: crypto.randomUUID(),
    });
    await t.mutation(internal.guardrails.settleEvalCall, {
      tenantId,
      reservationId: next,
      costUsd: 0,
    });
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      actualUsd: 0.000123,
      settledCount: 2,
      unsettledCount: 0,
    });
  });

  test("foreign tenants, missing usage, unsupported models/output, kill switch and ordinary daily spend fail closed", async () => {
    const t = harness();
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [tenantId],
      capCents: 100,
    });
    const args = { tenantId, budgetId, callId: crypto.randomUUID(), model, outputTokens: 8192 };
    await expect(
      t.mutation(internal.guardrails.reserveEvalCall, { ...args, tenantId: otherTenant }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      t.mutation(internal.guardrails.reserveEvalCall, { ...args, model: "free-unknown" }),
    ).rejects.toThrow("MODEL_UNSUPPORTED");
    await expect(
      t.mutation(internal.guardrails.reserveEvalCall, { ...args, outputTokens: 8193 }),
    ).rejects.toThrow("OUTPUT_LIMIT");
    await t.run((ctx) =>
      ctx.db.insert("guardrailConfig", {
        killSwitch: true,
        budgetUsdPerRequest: 1,
        updatedAt: Date.now(),
      }),
    );
    await expect(t.mutation(internal.guardrails.reserveEvalCall, args)).rejects.toThrow(
      "KILL_SWITCH",
    );
    await t.run(async (ctx) => {
      const row = await ctx.db.query("guardrailConfig").first();
      if (row) await ctx.db.patch(row._id, { killSwitch: false });
    });
    await t.mutation(internal.guardrails.recordSpend, {
      tenantId,
      costUsd: DAILY_BUDGET_CENTS / 100,
    });
    await expect(t.mutation(internal.guardrails.reserveEvalCall, args)).rejects.toThrow(
      "DAILY_BUDGET_EXHAUSTED",
    );
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      callCount: 0,
    });
  });

  test("expiry never replenishes total cap and late settlement cannot credit a new daily window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 8, 10));
    const t = harness();
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [tenantId],
      capCents: 100,
    });
    const args = { tenantId, budgetId, callId: crypto.randomUUID(), model, outputTokens: 8192 };
    const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, args);
    vi.setSystemTime(Date.now() + EVAL_BUDGET_LIFETIME_MS);
    await expect(
      t.mutation(internal.guardrails.reserveEvalCall, { ...args, callId: crypto.randomUUID() }),
    ).rejects.toThrow("EXPIRED");
    vi.setSystemTime(Date.now() + 48 * 60 * 60 * 1000);
    await t.run((ctx) => rateLimiter.limit(ctx, "dailySpendCents", { key: tenantId, count: 100 }));
    const before = await t.query(internal.guardrails.remainingDailyCents, { tenantId });
    await t.mutation(internal.guardrails.settleEvalCall, { tenantId, reservationId, costUsd: 0 });
    expect(await t.query(internal.guardrails.remainingDailyCents, { tenantId })).toBe(before);
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      expired: true,
      remainingCents: 0,
      unsettledCount: 0,
    });
  });
});
