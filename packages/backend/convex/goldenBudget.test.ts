// @vitest-environment node

import { MockLanguageModelV4 } from "ai/test";
import type { GenericActionCtx } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { evalBudgetModel } from "./lib/evalBudgetModel";
import { buildWebResearchTool } from "./llm";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const limiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const tenantId = "eval-abcdef12";
type Search = (
  input: { query: string },
  options: { toolCallId: string; messages: [] },
) => Promise<unknown>;
function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, limiterModules);
  return t;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("chat billing uses raw SDK response and unverified billing retains its hold", async () => {
  for (const isByok of [false, true, undefined]) {
    const t = harness();
    vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
    vi.stubEnv("GOLDEN_TAVILY_CREDIT_USD", "0.008");
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [tenantId],
      capCents: 200,
      family: "golden",
    });
    const ctx = { runMutation: t.mutation } as unknown as GenericActionCtx<DataModel>;
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
        providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
        response: { body: { usage: { cost: 0.001, is_byok: isByok } } },
      }),
    });
    const wrapped = evalBudgetModel({
      ctx,
      tenantId,
      budgetId,
      model,
      modelId: "or/openai/gpt-4o-mini",
      mode: "golden",
      onCost: () => {},
    });
    const call = wrapped.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "public fixture" }] }],
    });
    if (isByok === false)
      await expect(call).resolves.toMatchObject({ content: [{ type: "text", text: "ok" }] });
    else await expect(call).rejects.toThrow("BILLING_MODE_UNVERIFIED");
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      unsettledCount: isByok === false ? 0 : 1,
    });
  }
});

test("golden envelope requires verified billing and one bounded tenant family", async () => {
  const t = harness();
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "");
  const args = { tenantIds: [tenantId], capCents: 200, family: "golden" as const };
  await expect(t.mutation(internal.guardrails.openEvalBudget, args)).rejects.toThrow(
    "BILLING_UNVERIFIED",
  );
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.stubEnv("GOLDEN_TAVILY_CREDIT_USD", "0.008");
  for (const other of ["real-user", "eval-aaaaaaaa", "eval-abcdef12-case-a3"])
    await expect(
      t.mutation(internal.guardrails.openEvalBudget, { ...args, tenantIds: [tenantId, other] }),
    ).rejects.toThrow("TENANT_REQUIRED");
  expect(
    await t.mutation(internal.guardrails.openEvalBudget, {
      ...args,
      tenantIds: [tenantId, "eval-abcdef12-42-authoring-a1"],
    }),
  ).toBeTruthy();
});

test("Free envelopes refuse absent, blank or positive rate attestations", async () => {
  const t = harness();
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.stubEnv("GOLDEN_TAVILY_BILLING", "free");
  for (const rate of [undefined, "", " ", "0.008"]) {
    vi.stubEnv("GOLDEN_TAVILY_CREDIT_USD", rate);
    await expect(
      t.mutation(internal.guardrails.openEvalBudget, {
        tenantIds: [tenantId],
        capCents: 200,
        family: "golden",
      }),
    ).rejects.toThrow("BILLING_UNVERIFIED");
  }
});

test.each([
  "standard",
  "free",
])("Tavily %s reserves before egress; unknown usage cannot retry or close the ledger", async (mode) => {
  const t = harness();
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.stubEnv("GOLDEN_TAVILY_BILLING", mode);
  vi.stubEnv("GOLDEN_TAVILY_CREDIT_USD", mode === "free" ? "0" : "0.008");
  vi.stubEnv("TAVILY_API_KEY", "test-key");
  const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
    tenantIds: [tenantId],
    capCents: 200,
    family: "golden",
  });
  const ctx = { runMutation: t.mutation } as unknown as GenericActionCtx<DataModel>;
  const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      unsettledCount: 1,
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      include_usage: true,
      auto_parameters: false,
      search_depth: "basic",
    });
    return new Response(JSON.stringify({ results: [] }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const tools = buildWebResearchTool({ ctx, tenantId, budgetId });
  const search = tools.webResearch?.execute as unknown as Search;
  const call = () => search({ query: "public research" }, { toolCallId: "test", messages: [] });
  await expect(call()).rejects.toThrow("COST_UNKNOWN");
  await expect(call()).rejects.toThrow("RESPONSE_UNRESOLVED");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
    "NOT_SETTLED",
  );
});

test.each([
  "standard",
  "free",
])("known Tavily %s cost settles dollars and credits with exact replay agreement", async (mode) => {
  const t = harness();
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.stubEnv("GOLDEN_TAVILY_BILLING", mode);
  vi.stubEnv("GOLDEN_TAVILY_CREDIT_USD", mode === "free" ? "0" : "0.008");
  vi.stubEnv("TAVILY_API_KEY", "test-key");
  const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
    tenantIds: [tenantId],
    capCents: 2,
    family: "golden",
  });
  const ctx = { runMutation: t.mutation } as unknown as GenericActionCtx<DataModel>;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ usage: { credits: 1 }, results: [] }))),
  );
  const tools = buildWebResearchTool({ ctx, tenantId, budgetId });
  const search = tools.webResearch?.execute as unknown as Search;
  await search({ query: "public research" }, { toolCallId: "test", messages: [] });
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    actualUsd: mode === "free" ? 0 : 0.008,
    unsettledCount: 0,
    callCount: 1,
  });
  const rows = await t.run((ctx) =>
    ctx.db
      .query("spendEvents")
      .withIndex("by_eval_budget", (q) => q.eq("evalBudgetId", budgetId))
      .collect(),
  );
  const reserved = rows.find((row) => row.phase === "reserved");
  expect(reserved?.amountCents).toBe(1);
  expect(rows.find((row) => row.evalActualUsd !== undefined)).toMatchObject({
    evalTavilyCredits: 1,
    evalActualUsd: mode === "free" ? 0 : 0.008,
  });
  if (!reserved) throw new Error("missing reservation");
  const settlement = {
    tenantId,
    reservationId: reserved._id,
    costUsd: mode === "free" ? 0 : 0.008,
    tavilyCredits: 1,
  };
  await expect(t.mutation(internal.guardrails.settleEvalCall, settlement)).resolves.toMatchObject({
    settled: true,
  });
  await expect(
    t.mutation(internal.guardrails.settleEvalCall, { ...settlement, tavilyCredits: 2 }),
  ).rejects.toThrow("SETTLEMENT_MISMATCH");
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).resolves.toBeTruthy();
});
