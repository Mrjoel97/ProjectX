import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";
import { createVaultEmbeddingModel } from "./vaultRag";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateModules);
  return t;
}
const admission = (tenantId = "a", ceilingCents = 300) => ({
  tenantId,
  ceilingCents,
  callId: crypto.randomUUID(),
  model: "or/openai/gpt-4o-mini",
});

describe("paid admission", () => {
  test("deployment rail stops otherwise solvent tenants and kill switch precedes admission", async () => {
    const t = harness();
    for (let i = 0; i < 10; i++)
      await t.mutation(internal.guardrails.reservePaidCall, admission(`t${i}`, 500));
    await expect(
      t.mutation(internal.guardrails.reservePaidCall, admission("new", 1)),
    ).rejects.toThrow("DEPLOYMENT_BUDGET");
    await t.run((ctx) =>
      ctx.db.insert("guardrailConfig", {
        killSwitch: true,
        budgetUsdPerRequest: 1,
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(internal.guardrails.reservePaidCall, admission("new", 1)),
    ).rejects.toThrow("KILL_SWITCH");
  });
  test("ordinary embeddings settle before later vector decoding fails", async () => {
    const t = harness();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              usage: { cost: 0.001, is_byok: false },
              data: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const model = createVaultEmbeddingModel({
      ctx: { runMutation: t.mutation.bind(t) } as never,
      tenantId: "a",
    });
    await expect(model.doEmbed({ values: ["business context"] })).rejects.toThrow("vectors");
    const rows = await t.run((ctx) => ctx.db.query("spendEvents").collect());
    expect(rows.find((row) => row.phase === "actual")?.amountCents).toBe(1);
  });
  test("concurrent calls cannot both consume the same remaining budget", async () => {
    const t = harness();
    const results = await Promise.allSettled([
      t.mutation(internal.guardrails.reservePaidCall, admission()),
      t.mutation(internal.guardrails.reservePaidCall, admission()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await t.run((ctx) => ctx.db.query("spendEvents").collect());
    expect(rows.filter((r) => r.phase === "reserved")).toHaveLength(1);
  });
  test("settlement replays do not refund twice; mismatches and cross-tenant usage refuse", async () => {
    const t = harness();
    const reservationId = await t.mutation(internal.guardrails.reservePaidCall, admission());
    const settle = { tenantId: "a", reservationId, costUsd: 1 };
    await t.mutation(internal.guardrails.settlePaidCall, settle);
    await t.mutation(internal.guardrails.settlePaidCall, settle);
    await expect(
      t.mutation(internal.guardrails.settlePaidCall, { ...settle, costUsd: 0 }),
    ).rejects.toThrow("MISMATCH");
    await expect(
      t.mutation(internal.guardrails.settlePaidCall, { ...settle, tenantId: "b" }),
    ).rejects.toThrow("INVALID");
    const rows = await t.run((ctx) => ctx.db.query("spendEvents").collect());
    expect(rows.filter((r) => r.phase === "actual").map((r) => r.amountCents)).toEqual([100]);
    expect(rows.filter((r) => r.phase === "refunded").map((r) => r.amountCents)).toEqual([200]);
    await t.mutation(internal.guardrails.reservePaidCall, admission("a", 400));
    await expect(
      t.mutation(internal.guardrails.reservePaidCall, admission("a", 1)),
    ).rejects.toThrow("BUDGET_EXHAUSTED");
  });
  test("unknown outcomes retain hold and an execution identity cannot be reused", async () => {
    const t = harness();
    const args = admission("a", 500);
    await t.mutation(internal.guardrails.reservePaidCall, args);
    await expect(t.mutation(internal.guardrails.reservePaidCall, args)).rejects.toThrow(
      "ALREADY_RESERVED",
    );
    await expect(
      t.mutation(internal.guardrails.reservePaidCall, admission("a", 1)),
    ).rejects.toThrow("BUDGET_EXHAUSTED");
  });
  test("zero settlement releases once and legacy replay cannot double debit", async () => {
    const t = harness();
    const reservationId = await t.mutation(
      internal.guardrails.reservePaidCall,
      admission("a", 500),
    );
    const settle = { tenantId: "a", reservationId, costUsd: 0 };
    await t.mutation(internal.guardrails.settlePaidCall, settle);
    await t.mutation(internal.guardrails.settlePaidCall, settle);
    const spend = { tenantId: "a", costUsd: 1, correlationId: "replay" };
    await t.mutation(internal.guardrails.recordSpend, spend);
    await t.mutation(internal.guardrails.recordSpend, spend);
    await t.mutation(internal.guardrails.reservePaidCall, admission("a", 400));
    await expect(
      t.mutation(internal.guardrails.reservePaidCall, admission("a", 1)),
    ).rejects.toThrow("BUDGET_EXHAUSTED");
  });
});
