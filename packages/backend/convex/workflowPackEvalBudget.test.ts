// @vitest-environment node
// Native budget/registry/document boundaries with synthetic provider responses only. This is not
// model acceptance: the real specialist is replaced, while its budget middleware and DB are real.
import { readFileSync } from "node:fs";
import { PACK_MODEL } from "@pikar/cost";
import { goldenProviderCeilingCents } from "@pikar/cost/goldenProviderBudget";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import { evalBudgetModel } from "./lib/evalBudgetModel";
import { runSpecialistTurn } from "./llm";
import schema from "./schema";
import { createVaultEmbeddingModel } from "./vaultRag";

vi.mock("./llm", async () => ({
  ...(await vi.importActual<typeof import("./llm")>("./llm")),
  runSpecialistTurn: vi.fn(),
}));

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const RUN = "12345678-1234-1234-1234-123456789abc";
const TENANT = "packeval-12345678-c0";
const THREAD = "bounded-shop-thread";
const provider = vi.fn();
const fetchEmbedding = vi.fn();

beforeEach(() => {
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.stubEnv("OPENROUTER_API_KEY", "offline-test-key");
  vi.mocked(runSpecialistTurn).mockReset();
  provider.mockReset();
  fetchEmbedding.mockReset();
  fetchEmbedding.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: [{ embedding: Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)) }],
          usage: { cost: 0.000001, is_byok: false, prompt_tokens: 1 },
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchEmbedding);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  await t.mutation(internal.skills.seedPackCandidates, {});
  const budgetId = await t.action(internal.workflowPackBinding.openShopPreparationEval, {
    runnerRunId: RUN,
  });
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId: TENANT,
    threadId: THREAD,
  });
  const args = {
    tenantId: TENANT,
    threadId: THREAD,
    planId,
    text: "Prepare a private cotton tote listing.",
    runId: RUN,
    version: 1,
    budgetId,
  };
  return { t, budgetId, args };
}

function installPricedSpecialist(unknownEmbedding = false) {
  vi.mocked(runSpecialistTurn).mockImplementation(async (ctx, args) => {
    expect(args.skillName).toBe("pack-shop-preparation");
    expect(args.skillVersions).toEqual({ "pack-shop-preparation": 1 });
    expect(args.toolNames).toEqual(["saveAsDocument", "searchVault"]);
    if (!args.evalBudgetId) throw new Error("missing trusted budget");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        provider();
        return {
          content: [{ type: "text", text: "Prepared." }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
          providerMetadata: { openrouter: { usage: { cost: 0.002 } } },
          response: { body: { usage: { cost: 0.002, is_byok: false } } },
        };
      },
    });
    const budgetedModel = evalBudgetModel({
      ctx,
      tenantId: args.tenantId,
      budgetId: args.evalBudgetId,
      model,
      modelId: "or/openai/gpt-4o-mini",
      mode: "golden",
      onCost: () => {},
    });
    await generateText({ model: budgetedModel, prompt: "offline", maxRetries: 0 });
    const embedding = createVaultEmbeddingModel({
      ctx,
      tenantId: args.tenantId,
      budgetId: args.evalBudgetId,
    });
    if (unknownEmbedding)
      fetchEmbedding.mockRejectedValueOnce(new Error("synthetic lost response"));
    try {
      await embedding.doEmbed({ values: ["source query"] });
    } catch (error) {
      if (!unknownEmbedding) throw error;
    } // The existing search tool's no-match posture.
    if (unknownEmbedding) {
      // A swallowed source lookup cannot authorize the next loop step, even using a fresh model
      // wrapper. This exercises the actual atomic reserve boundary before its provider executes.
      await expect(
        generateText({ model: budgetedModel, prompt: "next step", maxRetries: 0 }),
      ).rejects.toThrow("EVAL_BUDGET_UNRESOLVED");
      const other = createVaultEmbeddingModel({
        ctx,
        tenantId: "packeval-12345678-c1",
        budgetId: args.evalBudgetId,
      });
      await expect(other.doEmbed({ values: ["another query"] })).rejects.toThrow(
        "EVAL_BUDGET_UNRESOLVED",
      );
    }
    return {
      reply: "Private preparation; no shop is live.",
      costUsd: 0.002,
      skillVersion: 1,
      saveRequest: { title: "Private preparation" },
      truncated: false,
      declaredUnsupported: false,
    } as never;
  });
}

describe("bounded shop operator entry", () => {
  test("opens exactly the fixed non-authoring five-tenant100c envelope", async () => {
    const { t, budgetId } = await setup();
    const envelope = await t.run((ctx) => ctx.db.get(budgetId));
    expect(envelope).toMatchObject({
      kind: "eval_envelope",
      phase: "estimated",
      amountCents: 100,
      evalEnvelope: {
        purpose: "shop-preparation",
        tenantIds: Array.from({ length: 5 }, (_, i) => `packeval-12345678-c${i}`),
      },
    });
    expect(envelope?.evalAuthoringProbe).toBeUndefined();
    expect(envelope?.evalEnvelope?.accountingMode).toBeUndefined();
  });
  test("missing standard-billing declaration refuses before opening or model execution", async () => {
    vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "");
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.workflowPackBinding.openShopPreparationEval, { runnerRunId: RUN }),
    ).rejects.toThrow("SHOP_EVAL_STANDARD_BILLING_REQUIRED");
    expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
    expect(runSpecialistTurn).not.toHaveBeenCalled();
    expect(fetchEmbedding).not.toHaveBeenCalled();
  });
  test("ordinary product RPC rejects budget arguments before any turn write", async () => {
    const { t, args } = await setup();
    const { version: _version, budgetId, ...ordinary } = args;
    for (const extra of [{ budgetId }, { evalBudgetId: budgetId }]) {
      await expect(
        t.action(internal.workflowPackBinding.runWorkflowPack, {
          ...ordinary,
          packId: "shop-preparation",
          ...extra,
        } as never),
      ).rejects.toThrow();
    }
    expect(await t.run((ctx) => ctx.db.query("workflowPackEvents").collect())).toEqual([]);
    expect(runSpecialistTurn).not.toHaveBeenCalled();
  });
  test("the dedicated opener and purpose cannot grant alternate caps, families or tenants", async () => {
    const { t } = await setup();
    const valid = {
      tenantIds: Array.from({ length: 5 }, (_, i) => `packeval-12345678-c${i}`),
      capCents: 100,
      purpose: "shop-preparation" as const,
    };
    for (const overrides of [
      { capCents: 200 },
      { family: "golden" as const },
      { authoringProbe: { threadId: THREAD, authorizationSha256: "a".repeat(64) } },
      { tenantIds: [TENANT] },
      { tenantIds: [...valid.tenantIds].reverse() },
      { tenantIds: [...valid.tenantIds.slice(0, 4), "owner-real-user"] },
    ])
      await expect(
        t.mutation(internal.guardrails.openEvalBudget, { ...valid, ...overrides }),
      ).rejects.toThrow("SHOP_EVAL_ENVELOPE_INVALID");
    await expect(
      t.action(internal.workflowPackBinding.openShopPreparationEval, {
        runnerRunId: RUN,
        capCents: 200,
      } as never),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toHaveLength(1);
  });
  test("owned collecting plan and exact thread are required before provider execution", async () => {
    const { t, args } = await setup();
    const foreign = await t.mutation(internal.plans.insertPlan, {
      tenantId: "packeval-12345678-c1",
      threadId: THREAD,
    });
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, { ...args, planId: foreign }),
    ).rejects.toThrow("SHOP_EVAL_PLAN_INVALID");
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, {
        ...args,
        threadId: "foreign-thread",
      }),
    ).rejects.toThrow("SHOP_EVAL_PLAN_INVALID");
    await t.run((ctx) => ctx.db.patch(args.planId, { status: "approved" }));
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, args),
    ).rejects.toThrow("SHOP_EVAL_PLAN_INVALID");
    expect(runSpecialistTurn).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
  test("actual registry provenance and candidate version are checked before provider execution", async () => {
    const { t, args } = await setup();
    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .filter((q) => q.eq(q.field("name"), "pack-shop-preparation"))
        .first(),
    );
    if (!row) throw new Error("missing candidate");
    await t.run((ctx) => ctx.db.patch(row._id, { body: "# substituted candidate" }));
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, args),
    ).rejects.toThrow("SHOP_EVAL_CANDIDATE_INVALID");
    expect(runSpecialistTurn).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
  test("foreign tenant, wrong purpose, wrong cap and closed envelopes refuse before model execution", async () => {
    const { t, args, budgetId } = await setup();
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, {
        ...args,
        tenantId: "owner-real-user",
      }),
    ).rejects.toThrow("SHOP_EVAL_CONTEXT_INVALID");
    const envelope = await t.run((ctx) => ctx.db.get(budgetId));
    if (!envelope?.evalEnvelope) throw new Error("missing envelope");
    await t.run((ctx) =>
      ctx.db.patch(budgetId, { evalEnvelope: { ...envelope.evalEnvelope!, purpose: undefined } }),
    );
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, args),
    ).rejects.toThrow("SHOP_EVAL_ENVELOPE_INVALID");
    await t.run((ctx) => ctx.db.patch(budgetId, { evalEnvelope: envelope.evalEnvelope }));
    await t.run((ctx) =>
      ctx.db.patch(budgetId, {
        evalAuthoringProbe: { threadId: THREAD, authorizationSha256: "a".repeat(64) },
      }),
    );
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, args),
    ).rejects.toThrow("SHOP_EVAL_ENVELOPE_INVALID");
    await t.run((ctx) =>
      ctx.db.patch(budgetId, { evalAuthoringProbe: undefined, amountCents: 200 }),
    );
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, args),
    ).rejects.toThrow("SHOP_EVAL_ENVELOPE_INVALID");
    await t.run((ctx) => ctx.db.patch(budgetId, { amountCents: 100 }));
    await t.mutation(internal.guardrails.closeEvalBudget, { budgetId });
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, args),
    ).rejects.toThrow("SHOP_EVAL_BUDGET_UNSAFE");
    expect(runSpecialistTurn).not.toHaveBeenCalled();
  });
  test("seed, chat and source-query embeddings share the actual native ledger, then close", async () => {
    const { t, args, budgetId } = await setup();
    await t.run(async (ctx) => {
      await createVaultEmbeddingModel({ ctx, tenantId: "packeval-12345678-c1", budgetId }).doEmbed({
        values: ["seed input"],
      });
    });
    installPricedSpecialist();
    const result = await t.action(internal.workflowPackBinding.runShopPreparationEval, args);
    expect(result).toMatchObject({ ok: true, skillVersion: 1 });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(fetchEmbedding).toHaveBeenCalledTimes(2);
    const status = await t.query(internal.guardrails.evalBudgetStatus, { budgetId });
    expect(status).toMatchObject({
      capCents: 100,
      callCount: 3,
      settledCount: 3,
      unsettledCount: 0,
      unresolvedCents: 0,
      breached: false,
    });
    expect(status.actualUsd).toBeCloseTo(0.002002);
    expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(1);
    await t.mutation(internal.guardrails.closeEvalBudget, { budgetId });
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      closed: true,
      unsettledCount: 0,
    });
  });
  test("an unknown source response cannot be washed into qualification by a useful saved reply", async () => {
    const { t, args, budgetId } = await setup();
    installPricedSpecialist(true);
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, args),
    ).rejects.toThrow("SHOP_EVAL_BUDGET_UNSAFE");
    expect(fetchEmbedding).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      unsettledCount: 1,
      unresolvedCents: 1,
      closed: false,
    });
    await expect(t.mutation(internal.guardrails.closeEvalBudget, { budgetId })).rejects.toThrow(
      "EVAL_BUDGET_NOT_SETTLED",
    );
    const row = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .filter((q) => q.eq(q.field("name"), "pack-shop-preparation"))
        .first(),
    );
    expect(row?.evidence).toBeUndefined();
    expect(row?.status).toBe("candidate");
  });
  test("legacy unmarked envelopes retain concurrent reservations", async () => {
    const { t } = await setup();
    const budgetId = await t.mutation(internal.guardrails.openEvalBudget, {
      tenantIds: [TENANT],
      capCents: 100,
    });
    const call = { kind: "chat", model: "or/openai/gpt-4o-mini", maxOutputTokens: 8192 } as const;
    const reserve = () =>
      t.mutation(internal.guardrails.reserveEvalCall, {
        tenantId: TENANT,
        budgetId,
        callId: crypto.randomUUID(),
        model: call.model,
        outputTokens: 8192,
        providerCall: call,
      });
    expect(await reserve()).toBeTruthy();
    expect(await reserve()).toBeTruthy();
    expect(await t.query(internal.guardrails.evalBudgetStatus, { budgetId })).toMatchObject({
      unsettledCount: 2,
      closed: false,
    });
  });
  test("the final insufficient native allowance blocks before the next provider call", async () => {
    const { t, args, budgetId } = await setup();
    const call = { kind: "chat", model: "or/openai/gpt-4o-mini", maxOutputTokens: 8192 } as const;
    const ceiling = goldenProviderCeilingCents(call);
    for (let n = 0; n < Math.floor(100 / ceiling); n++) {
      const reservationId = await t.mutation(internal.guardrails.reserveEvalCall, {
        tenantId: TENANT,
        budgetId,
        callId: crypto.randomUUID(),
        model: call.model,
        outputTokens: 8192,
        providerCall: call,
      });
      await t.mutation(internal.guardrails.settleEvalCall, {
        tenantId: TENANT,
        reservationId,
        costUsd: ceiling / 100,
      });
    }
    installPricedSpecialist();
    await expect(
      t.action(internal.workflowPackBinding.runShopPreparationEval, args),
    ).rejects.toThrow("EVAL_BUDGET_EXHAUSTED");
    expect(provider).not.toHaveBeenCalled();
    expect(fetchEmbedding).not.toHaveBeenCalled();
  });
});

describe("bounded operator harness without live calls", () => {
  const modulePath = "../scripts/run-workflow-pack-evals.mjs";
  const fixtures = JSON.parse(
    readFileSync(
      new URL("../scripts/workflow-pack-fixtures/shop-preparation.json", import.meta.url),
      "utf8",
    ),
  );
  function controls(unknownAt = -1, badClose = false) {
    const calls: { fn: string; args: any; options: any }[] = [];
    let actualUsd = 0,
      count = 0,
      unsettled = 0,
      closed = false;
    const invoke = (fn: string, args: any, options?: any) => {
      calls.push({ fn, args, options });
      if (fn.endsWith(":openShopPreparationEval")) return JSON.stringify("budget-offline");
      if (fn.endsWith(":evalBudgetStatus"))
        return JSON.stringify({
          budgetId: "budget-offline",
          capCents: 100,
          closed,
          expired: false,
          breached: false,
          actualUsd,
          remainingCents: 90,
          callCount: count,
          settledCount: count - unsettled,
          unsettledCount: unsettled,
          unresolvedCents: unsettled,
        });
      if (fn.endsWith(":closeEvalBudget")) {
        if (!badClose) closed = true;
        return JSON.stringify({ budgetId: args.budgetId, closed: true });
      }
      if (fn.endsWith(":recordEvalEvidence")) return "null";
      throw new Error("unexpected test RPC");
    };
    const executeCase = (_fx: any, index: number, options: any) => {
      expect(options.evaluation.budgetId).toBe("budget-offline");
      actualUsd += 0.003;
      count += 3;
      if (index === unknownAt) unsettled = 1;
      return {
        tenant: `packeval-12345678-c${index}`,
        version: 1,
        pass: true,
        failures: [],
        cost: 999,
        ranModels: [PACK_MODEL],
        spendRows: 1,
        durationMs: 1,
      };
    };
    return { calls, invoke, executeCase };
  }
  const input = {
    cases: fixtures,
    pack: {},
    version: 1,
    runnerRunId: RUN,
    thresholds: {},
    declared: { revision: "suite-test" },
    mine: { caseCount: 5, casesHash: "a".repeat(64) },
  };
  test("evidence follows authoritative closure/readback and uses embedding-inclusive ledger cost", async () => {
    const { runBoundedShopCandidate } = await import(modulePath);
    const c = controls();
    expect(runBoundedShopCandidate(input, { ...c, log: () => {} })).toBe(0);
    const write = c.calls.findIndex((x) => x.fn.endsWith(":recordEvalEvidence"));
    const close = c.calls.findIndex((x) => x.fn.endsWith(":closeEvalBudget"));
    expect(close).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(close + 1);
    expect(c.calls[close + 1]?.fn).toBe("guardrails:evalBudgetStatus");
    expect(JSON.parse(c.calls[write]!.args.evidence).costUsd).toBeCloseTo(0.015);
    expect(c.calls.filter((x) => x.fn.endsWith(":openShopPreparationEval"))).toHaveLength(1);
  });
  test("unknown holds stop subsequent cases, never close, reopen or write evidence", async () => {
    const { runBoundedShopCandidate } = await import(modulePath);
    const c = controls(1);
    expect(() => runBoundedShopCandidate(input, { ...c, log: () => {} })).toThrow(
      "SHOP_EVAL_BUDGET_UNSAFE",
    );
    expect(c.calls.filter((x) => /closeEvalBudget|recordEvalEvidence/.test(x.fn))).toEqual([]);
    expect(c.calls.filter((x) => /openShopPreparationEval/.test(x.fn))).toHaveLength(1);
  });
  test("a claimed close without a closed native readback cannot issue evidence or retry close", async () => {
    const { runBoundedShopCandidate } = await import(modulePath);
    const c = controls(-1, true);
    expect(() => runBoundedShopCandidate(input, { ...c, log: () => {} })).toThrow(
      "SHOP_EVAL_BUDGET_UNSAFE",
    );
    expect(c.calls.filter((x) => /closeEvalBudget/.test(x.fn))).toHaveLength(1);
    expect(c.calls.some((x) => /recordEvalEvidence/.test(x.fn))).toBe(false);
  });
  test("new paid seed and turn paths pass the budget and never replay an uncertain result", async () => {
    const { seedCase, paidTurn } = await import(modulePath);
    const invoke = vi.fn((fn: string, _args: unknown) => {
      if (fn === "smoke:seedPackEvalTenant") return "null";
      throw new Error("unknown result");
    });
    const evaluation = { budgetId: "budget-offline", invoke };
    const pack = { opTools: new Map([["ground-in-vault", ["searchVault"]]]) };
    expect(() => seedCase(TENANT, fixtures[0], pack, evaluation)).toThrow("unknown result");
    expect(invoke.mock.calls.filter(([fn]) => fn === "vaultSmoke:seedCorpus")).toHaveLength(1);
    expect(invoke.mock.calls.at(-1)?.[1]).toMatchObject({ evalBudgetId: "budget-offline" });
    invoke.mockClear();
    expect(() =>
      paidTurn({ tenantId: TENANT, skillVersions: { "pack-shop-preparation": 1 } }, evaluation),
    ).toThrow("unknown result");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toBe("workflowPackBinding:runShopPreparationEval");
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ budgetId: "budget-offline", version: 1 });
  });
});
