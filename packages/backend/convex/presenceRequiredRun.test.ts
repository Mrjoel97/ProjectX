// @vitest-environment node
import { generateText } from "ai";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import limiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { generateStitchDesignEvidence } from "./lib/stitchDesignClient";
import schema from "./schema";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("./lib/models", () => ({ resolveModel: (modelId: string) => ({ modelId }) }));
vi.mock("./lib/evalBudgetModel", () => ({ evalBudgetModel: (args: unknown) => args }));
vi.mock("./lib/stitchDesignClient", () => ({ generateStitchDesignEvidence: vi.fn() }));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregates = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const limiters = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const run = makeFunctionReference<"action">("presenceRequiredRun:run");
beforeEach(() => {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://third-gecko-977.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://third-gecko-977.convex.site");
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.mocked(generateText).mockReset();
  vi.mocked(generateStitchDesignEvidence).mockReset();
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregates);
  t.registerComponent("rateLimiter", limiterSchema, limiters);
  const tenantId = "packeval-abc12345-presence";
  const planId = await t.mutation(internal.plans.insertPlan, {
    tenantId,
    threadId: "required-run",
  });
  const session = await t.mutation(internal.onlinePresence.ensureSession, {
    tenantId,
    planId,
    threadId: "required-run",
    text: "Fieldwork designs websites for independent businesses.",
  });
  const saved = await t.mutation(internal.onlinePresence.saveBrief, {
    tenantId,
    planId,
    expectedRevision: session.revision,
    brief: {
      kind: "website",
      businessName: "Fieldwork",
      headline: "Websites with purpose",
      summary: "Website design",
      audience: "Independent businesses",
      sourceRefs: [session.sourceRef],
    },
  });
  expect(saved.ok).toBe(true);
  return {
    t,
    args: {
      tenantId,
      planId,
      expectedRevision: saved.revision,
      runRef: "abc12345",
      billingBasis: "operator_confirmed_included_free_credits_no_paid_overage",
    },
  };
}
test("Stitch failure closes zero-call envelope and never falls back", async () => {
  const { t, args } = await setup();
  vi.mocked(generateStitchDesignEvidence).mockRejectedValue(Error("provider unavailable"));
  const result = await t.action(run, args);
  expect(result.status).toBe("stopped");
  expect(generateStitchDesignEvidence).toHaveBeenCalledTimes(1);
  expect(generateText).not.toHaveBeenCalled();
  const rows = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(rows.some((row) => row.kind === "eval_budget_closed")).toBe(true);
  expect(rows.filter((row) => row.phase === "reserved")).toHaveLength(0);
});
test("model failure preserves unresolved reservation; no fallback or repeat provider calls", async () => {
  const { t, args } = await setup();
  vi.mocked(generateStitchDesignEvidence).mockResolvedValue({
    status: "complete",
    html: { text: "reference" },
  } as never);
  vi.mocked(generateText).mockImplementation(async (options) => {
    const model = options.model as unknown as {
      ctx: ActionCtx;
      tenantId: string;
      budgetId: Id<"spendEvents">;
      modelId: string;
    };
    expect(model.modelId).toBe("or/moonshotai/kimi-k3.1-pro");
    expect(options.maxRetries).toBe(0);
    await model.ctx.runMutation(internal.guardrails.reserveEvalCall, {
      tenantId: model.tenantId,
      budgetId: model.budgetId,
      callId: crypto.randomUUID(),
      model: model.modelId,
      outputTokens: 8192,
      websiteComparison: true,
      providerCall: { kind: "chat", model: model.modelId, maxOutputTokens: 8192 },
    });
    throw Error("synthetic timeout");
  });
  expect((await t.action(run, args)).status).toBe("stopped");
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(generateStitchDesignEvidence).toHaveBeenCalledTimes(1);
  const rows = await t.run((ctx) => ctx.db.query("spendEvents").collect());
  expect(rows.some((row) => row.kind === "eval_budget_closed")).toBe(false);
  expect(rows.filter((row) => row.phase === "reserved")).toHaveLength(1);
});
test("wrong staging host refuses before ownership queries or providers", async () => {
  const { t, args } = await setup();
  vi.stubEnv("CONVEX_CLOUD_URL", "https://production.convex.cloud");
  await expect(t.action(run, args)).rejects.toThrow();
  expect(generateText).not.toHaveBeenCalled();
  expect(generateStitchDesignEvidence).not.toHaveBeenCalled();
});
