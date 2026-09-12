import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import { workflow } from "./index";
import schema from "./schema";
import { startIngest } from "./vaultIngest";
import { createVaultEmbeddingModel, type VaultEmbeddingEvaluation } from "./vaultRag";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const tenantId = "packeval-abcdef12-embedding";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup(capCents = 5) {
  vi.stubEnv("OPENROUTER_API_KEY", "offline-test-key");
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
    tenantIds: [tenantId],
    capCents,
  });
  // Only the native mutation bridge is replaced; reservations and limiter accounting are real.
  const ctx = {
    runMutation: t.mutation.bind(t),
  } as unknown as VaultEmbeddingEvaluation["ctx"];
  return { t, budgetId, ctx, adapter: createVaultEmbeddingModel({ ctx, tenantId, budgetId }) };
}

test("actual embedding fetch follows reservation, carries ceiling policy and settles exact cost", async () => {
  const { t, budgetId, adapter } = await setup();
  const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      unsettledCount: 1,
      callCount: 1,
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "openai/text-embedding-3-small",
      input: ["source"],
      dimensions: 1536,
      provider: {
        only: ["openai"],
        order: ["openai"],
        allow_fallbacks: false,
        max_price: { prompt: "0.02", completion: "0", request: "0" },
      },
    });
    return Response.json({
      data: [{ embedding: [1, 0] }],
      usage: { cost: 0.00001, is_byok: false, prompt_tokens: 2 },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(await adapter.doEmbed({ values: ["source"] })).toEqual({
    embeddings: [[1, 0]],
    usage: { tokens: 2 },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    actualUsd: 0.00001,
    settledCount: 1,
    unsettledCount: 0,
  });
  expect(await t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).toMatchObject({
    closed: true,
  });
});

test("closed and expired envelopes refuse embedding before any provider request", async () => {
  const { t, ctx, budgetId } = await setup();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await t.mutation(internal.guardrails.closeEvalBudget, { budgetId });
  await expect(
    createVaultEmbeddingModel({ ctx, tenantId, budgetId }).doEmbed({ values: ["source"] }),
  ).rejects.toThrow("BUDGET_CLOSED");
  const next = await setup();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
  await expect(next.adapter.doEmbed({ values: ["source"] })).rejects.toThrow("BUDGET_EXPIRED");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("ingest recovery retains the original envelope and refuses replacement", async () => {
  const { t, budgetId } = await setup();
  const starter = vi.spyOn(workflow, "start").mockResolvedValue("workflow-test" as never);
  const vaultDocId = await t.run(async (ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId,
      title: "Budget recovery",
      kind: "web_research",
      category: "knowledge",
      text: "source",
      contentHash: "recovery",
      status: "processing",
      createdAt: Date.now(),
      source: "upload",
      mimeType: "text/plain",
      size: 6,
    }),
  );
  await t.run(async (ctx) =>
    startIngest(ctx, {
      vaultDocId,
      tenantId,
      correlationId: "initial",
      evalBudgetId: budgetId,
    }),
  );
  expect(await t.run(async (ctx) => (await ctx.db.get(vaultDocId))?.evalBudgetId)).toBe(budgetId);
  await t.run(async (ctx) => startIngest(ctx, { vaultDocId, tenantId, correlationId: "recovery" }));
  expect(starter.mock.calls[1]?.[2]).toMatchObject({ evalBudgetId: budgetId });
  const replacement = await t.mutation(internal.guardrails.openEvalBudget, {
    tenantIds: [tenantId],
    capCents: 5,
  });
  await expect(
    t.run(async (ctx) =>
      startIngest(ctx, {
        vaultDocId,
        tenantId,
        correlationId: "replacement",
        evalBudgetId: replacement,
      }),
    ),
  ).rejects.toThrow("SCOPE_MISMATCH");
  expect(starter).toHaveBeenCalledTimes(2);
});

test("unknown HTTP accounting retains its hold, performs no retry and poisons the adapter", async () => {
  const { t, budgetId, adapter } = await setup();
  const fetchMock = vi.fn(async () => new Response("provider private error", { status: 429 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(adapter.doEmbed({ values: ["source"] })).rejects.toThrow(
    "EVAL_EMBEDDING_RESPONSE_UNRESOLVED",
  );
  await expect(adapter.doEmbed({ values: ["source"] })).rejects.toThrow("PREVIOUS_FAILURE");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    settledCount: 0,
    unsettledCount: 1,
  });
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow();
});

test("aggregate cap rejects a second low-level call before fetch even through a new adapter", async () => {
  const { t, ctx, budgetId, adapter } = await setup(1);
  const fetchMock = vi.fn(async () => Response.json({ data: [{ embedding: [1, 0] }] }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(adapter.doEmbed({ values: ["source"] })).rejects.toThrow("EVAL_COST_UNKNOWN");
  const next = createVaultEmbeddingModel({ ctx, tenantId, budgetId });
  await expect(next.doEmbed({ values: ["source"] })).rejects.toThrow("BUDGET_EXHAUSTED");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    unsettledCount: 1,
  });
});

test("known provider breach persists truthful cost and prevents another paid request", async () => {
  const { t, ctx, budgetId, adapter } = await setup();
  const fetchMock = vi.fn(async () =>
    Response.json({ data: [{ embedding: [1, 0] }], usage: { cost: 0.02, is_byok: false } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(adapter.doEmbed({ values: ["source"] })).rejects.toThrow("EXCEEDED_RESERVATION");
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    actualUsd: 0.02,
    breached: true,
  });
  await expect(
    createVaultEmbeddingModel({ ctx, tenantId, budgetId }).doEmbed({ values: ["source"] }),
  ).rejects.toThrow("BUDGET_BREACHED");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("unverified BYOK retains the full hold and prevents passing closure", async () => {
  const { t, budgetId, adapter } = await setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ data: [{ embedding: [1, 0] }], usage: { cost: 0.00001, is_byok: true } }),
    ),
  );
  await expect(adapter.doEmbed({ values: ["source"] })).rejects.toThrow("BILLING_MODE_UNVERIFIED");
  expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
    actualUsd: 0,
    settledCount: 0,
    unsettledCount: 1,
  });
  await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow();
});

test("descriptor mismatch and foreign tenant fail before authorizing any embedding spend", async () => {
  const { t, ctx, budgetId } = await setup();
  await expect(
    t.mutation(internal.guardrails.reserveEvalCall, {
      tenantId,
      budgetId,
      callId: crypto.randomUUID(),
      model: "or/openai/gpt-5.6-luna",
      outputTokens: 8192,
      providerCall: { kind: "embedding", model: "openai/text-embedding-3-small", inputCount: 1 },
    }),
  ).rejects.toThrow("DESCRIPTOR_MISMATCH");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    createVaultEmbeddingModel({ ctx, tenantId: "packeval-abcdef12-foreign", budgetId }).doEmbed({
      values: ["source"],
    }),
  ).rejects.toThrow("BUDGET_NOT_FOUND");
  expect(fetchMock).not.toHaveBeenCalled();
});
