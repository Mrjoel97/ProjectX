// @vitest-environment node
import { readFileSync } from "node:fs";
import { websiteDesignProposalSkillBody } from "@pikar/contracts/skills/websiteDesignProposal";
import {
  PRESENCE_COMPARISON_FIXTURE,
  PRESENCE_COMPARISON_MODELS,
} from "@pikar/core/presenceComparison";
import { DEFAULT_MODEL } from "@pikar/cost";
import { evalCallCeilingCents } from "@pikar/cost/evalBudget";
import {
  goldenChatWireOptions,
  goldenProviderCeilingCents,
} from "@pikar/cost/goldenProviderBudget";
import { generateText } from "ai";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import limiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { STITCH_MCP_ENDPOINT } from "./lib/stitchDesignClient";
import { STITCH_INCLUDED_CREDITS_DECLARATION } from "./presenceDesignProbe";
import schema from "./schema";

vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("./lib/models", () => ({ resolveModel: (modelId: string) => ({ modelId }) }));
// Native coordinator/protocol tests exercise real reserve/settle mutations; the SDK/provider is synthetic.
vi.mock("./lib/evalBudgetModel", () => ({ evalBudgetModel: (args: unknown) => args }));
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregates = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const limiters = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const prepare = makeFunctionReference<"mutation">("presenceComparisonControl:prepare");
const run = makeFunctionReference<"action">("presenceComparisonRun:run");
const claim = makeFunctionReference<"mutation">("presenceComparisonControl:claim");
type Model = {
  ctx: ActionCtx;
  tenantId: string;
  budgetId: Id<"spendEvents">;
  modelId: string;
  websiteComparison?: boolean;
};
let failure: "none" | "model_timeout" | "wrong_model" | "stitch_timeout" = "none";
let calls: string[] = [];
const photo = readFileSync(
  new URL("../../../apps/web/public/presence-examples/studio.webp", import.meta.url),
);

beforeEach(() => {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://third-gecko-977.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://third-gecko-977.convex.site");
  vi.stubEnv("GOLDEN_OPENROUTER_BILLING", "standard");
  vi.stubEnv("STITCH_API_KEY", "synthetic-key");
  calls = [];
  failure = "none";
  vi.mocked(generateText).mockReset();
  vi.mocked(generateText).mockImplementation(async (options) => {
    const model = options.model as unknown as Model;
    calls.push(`model:${model.modelId}`);
    expect(model.websiteComparison).toBe(true);
    expect(options.maxRetries).toBe(0);
    expect(options.maxOutputTokens).toBe(8192);
    expect(options.system).toBe(websiteDesignProposalSkillBody);
    expect(options.providerOptions).toEqual(
      model.modelId === PRESENCE_COMPARISON_MODELS.kimi
        ? { openrouter: { reasoning: { effort: "low" } } }
        : undefined,
    );
    const reservationId = await model.ctx.runMutation(internal.guardrails.reserveEvalCall, {
      tenantId: model.tenantId,
      budgetId: model.budgetId,
      callId: crypto.randomUUID(),
      model: model.modelId,
      outputTokens: 8192,
      providerCall: { kind: "chat", model: model.modelId, maxOutputTokens: 8192 },
      websiteComparison: true,
    });
    if (failure === "model_timeout" && model.modelId === PRESENCE_COMPARISON_MODELS.kimi)
      throw Error("EVAL_MODEL_RESPONSE_UNRESOLVED");
    await model.ctx.runMutation(internal.guardrails.settleEvalCall, {
      tenantId: model.tenantId,
      reservationId,
      costUsd: 0.001,
    });
    const observed =
      failure === "wrong_model" && model.modelId === PRESENCE_COMPARISON_MODELS.kimi
        ? "openai/gpt-4.1"
        : model.modelId.slice(3);
    return {
      text: `<!doctype html><html><style>@media(prefers-reduced-motion:reduce){*{animation:none}}</style><body><h1>Fieldwork Design Studio</h1><img src="${PRESENCE_COMPARISON_FIXTURE.assets[0]?.publicUrl}"></body></html>`,
      response: { modelId: observed },
      finishReason: "stop",
    } as never;
  });
  let title = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === PRESENCE_COMPARISON_FIXTURE.assets[0]?.publicUrl)
        return new Response(new Uint8Array(photo).buffer, {
          headers: { "content-type": "image/webp" },
        });
      if (url !== STITCH_MCP_ENDPOINT) {
        calls.push(url);
        return url.endsWith("screen.webp")
          ? new Response(new Uint8Array(photo).buffer, {
              headers: { "content-type": "image/webp" },
            })
          : new Response(
              "<!doctype html><html><body><h1>Untrusted reference</h1><script>neverExecute()</script></body></html>",
              { headers: { "content-type": "text/html" } },
            );
      }
      const wire = JSON.parse(String(init?.body)) as {
        id?: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      const operation =
        wire.method === "tools/call"
          ? String(wire.params?.name)
          : wire.method === "tools/list"
            ? "tools_list"
            : wire.method === "notifications/initialized"
              ? "initialized"
              : "initialize";
      calls.push(operation);
      if (operation === "initialized") return new Response(null, { status: 202 });
      if (operation === "generate_screen_from_text" && failure === "stitch_timeout")
        throw Error("synthetic ambiguous timeout");
      let result: Record<string, unknown>;
      if (operation === "initialize")
        result = {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "native-test", version: "1" },
        };
      else if (operation === "tools_list")
        result = {
          tools: [
            {
              name: "create_project",
              inputSchema: {
                type: "object",
                properties: { title: { type: "string" } },
                required: [],
              },
            },
            {
              name: "generate_screen_from_text",
              inputSchema: {
                type: "object",
                properties: {
                  projectId: { type: "string" },
                  prompt: { type: "string" },
                  deviceType: { type: "string" },
                },
                required: ["projectId", "prompt"],
              },
            },
            {
              name: "get_screen",
              inputSchema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                },
                required: ["name"],
              },
            },
          ],
        };
      else if (operation === "create_project") {
        title = String(wire.params?.arguments?.title);
        result = {
          structuredContent: { name: "projects/project_owned", title, visibility: "PRIVATE" },
        };
      } else if (operation === "generate_screen_from_text")
        result = {
          structuredContent: {
            projectId: "project_owned",
            outputComponents: [
              {
                design: {
                  screens: [
                    { name: "projects/project_owned/screens/screen_owned", id: "screen_owned" },
                  ],
                },
              },
            ],
          },
        };
      else
        result = {
          structuredContent: {
            name: "projects/project_owned/screens/screen_owned",
            deviceType: "DESKTOP",
            htmlCode: { downloadUrl: "https://contribution.usercontent.google.com/design.html" },
            screenshot: { downloadUrl: "https://lh3.googleusercontent.com/screen.webp" },
          },
        };
      return Response.json(
        { jsonrpc: "2.0", id: wire.id, result },
        {
          headers: operation === "initialize" ? { "Mcp-Session-Id": "fixture_session" } : undefined,
        },
      );
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregates);
  t.registerComponent("rateLimiter", limiterSchema, limiters);
  const candidate = await t.mutation(prepare, {});
  return {
    t,
    args: {
      runRef: "abc12345",
      skillVersion: candidate.skillVersion,
      billingBasis: STITCH_INCLUDED_CREDITS_DECLARATION,
    },
  };
}

test("Kimi bounds include full-context cache creation, standard wire caps and original default stays unchanged", () => {
  expect(DEFAULT_MODEL).toBe(PRESENCE_COMPARISON_MODELS.current);
  const call = {
    kind: "chat" as const,
    model: PRESENCE_COMPARISON_MODELS.kimi,
    maxOutputTokens: 8192,
  };
  expect(goldenProviderCeilingCents(call)).toBe(428);
  expect(evalCallCeilingCents(call.model, 8192)).toBe(428);
  expect(goldenChatWireOptions(call)).toMatchObject({
    max_tokens: 8192,
    plugins: [],
    transforms: [],
    provider: {
      only: ["moonshotai"],
      allow_fallbacks: false,
      max_price: { prompt: "2", completion: "10", request: "0", image: "0" },
    },
  });
  expect(() =>
    goldenProviderCeilingCents({ ...call, model: "or/moonshotai/kimi-k3.1-pro-highspeed" }),
  ).toThrow();
});
test("native three-arm run uses real Stitch hooks, single generation, quarantined actual artifacts and closed ledger", async () => {
  const { t, args } = await setup();
  const result = await t.action(run, args);
  expect(result.status).toBe("complete");
  expect(result.outputs).toHaveLength(3);
  expect(result.outputs).toMatchObject([
    { reasoningEffort: "provider_default" },
    { reasoningEffort: "low" },
    { reasoningEffort: "low" },
  ]);
  expect(vi.mocked(generateText)).toHaveBeenCalledTimes(3);
  expect(calls.filter((c) => c === "create_project")).toHaveLength(1);
  expect(calls.filter((c) => c === "generate_screen_from_text")).toHaveLength(1);
  const outputs = result.outputs as {
    proposal: { storageId: Id<"_storage">; url: string };
    stitch?: {
      billing: { providerActualUsd: null; providerCostStatus: string };
      artifacts: { html: { storageId: Id<"_storage"> } };
    };
  }[];
  for (const output of outputs) {
    expect(output.proposal.url).toMatch(/^https?:/);
    const stored = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(output.proposal.storageId);
      if (!blob) throw Error("Missing actual proposal artifact");
      return { type: blob.type, text: await blob.text() };
    });
    expect(stored.type).toContain("text/plain");
    expect(stored.text).toContain("<!doctype html>");
  }
  expect(outputs[2]?.stitch?.billing).toMatchObject({
    providerActualUsd: null,
    providerCostStatus: "not_reported",
  });
  expect(result.ledger).toMatchObject({ closed: true, unsettledCount: 0 });
  const firstPaidModel = calls.findIndex((call) => call.startsWith("model:"));
  expect(firstPaidModel).toBeGreaterThan(0);
  expect(calls.slice(0, firstPaidModel)).toContain("tools_list");
  expect(calls.slice(0, firstPaidModel)).not.toContain("create_project");
  expect(calls.slice(0, firstPaidModel)).not.toContain("generate_screen_from_text");
  await expect(t.mutation(claim, { runRef: args.runRef })).rejects.toThrow(
    "PRESENCE_COMPARISON_ALREADY_CLAIMED",
  );
}, 180000);
test("unknown model cost retains native hold, earlier output and blocks a new claim and subsequent ordinary reserve", async () => {
  failure = "model_timeout";
  const { t, args } = await setup();
  const result = await t.action(run, args);
  expect(result).toMatchObject({
    status: "stopped",
    reconciliationRequired: true,
    ledger: { closed: false, unsettledCount: 1 },
  });
  expect(result.outputs).toHaveLength(1);
  expect(calls).not.toContain("create_project");
  await expect(t.mutation(claim, { runRef: "bbc12345" })).rejects.toThrow(
    "PRESENCE_COMPARISON_PRIOR_RUN_OPEN",
  );
  await expect(
    t.mutation(internal.guardrails.reserveEvalCall, {
      tenantId: `packeval-${args.runRef}-presence`,
      budgetId: result.budgetId,
      callId: crypto.randomUUID(),
      model: PRESENCE_COMPARISON_MODELS.current,
      outputTokens: 8192,
      providerCall: {
        kind: "chat",
        model: PRESENCE_COMPARISON_MODELS.current,
        maxOutputTokens: 8192,
      },
    }),
  ).rejects.toThrow("EVAL_BUDGET_UNRESOLVED");
});
test("unknown Stitch generation keeps a blocking claim despite declared-free financial closure", async () => {
  failure = "stitch_timeout";
  const { t, args } = await setup();
  const result = await t.action(run, args);
  expect(result).toMatchObject({
    status: "stopped",
    reconciliationRequired: true,
    ledger: { closed: true, unsettledCount: 0 },
  });
  expect(result.outputs).toHaveLength(2);
  expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);
  await expect(t.mutation(claim, { runRef: "bbc12345" })).rejects.toThrow(
    "PRESENCE_COMPARISON_PRIOR_RUN_OPEN",
  );
  expect(calls.filter((c) => c === "generate_screen_from_text")).toHaveLength(1);
});
test("observed model substitution stops with preserved artifacts rather than qualifying a Kimi arm", async () => {
  failure = "wrong_model";
  const { t, args } = await setup();
  const result = await t.action(run, args);
  expect(result).toMatchObject({
    status: "stopped",
    reason: "PRESENCE_COMPARISON_MODEL_IDENTITY_MISMATCH",
  });
  expect(result.outputs).toHaveLength(2);
  expect(calls).not.toContain("create_project");
  expect(result.nativeWorkflowQualified).toBe(false);
});
test("supplied photo hash failure and wrong deployment refuse before model egress", async () => {
  const { t, args } = await setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("changed")),
  );
  await expect(t.action(run, args)).rejects.toThrow("PRESENCE_COMPARISON_ASSET_CHANGED");
  expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  vi.stubEnv("CONVEX_SITE_URL", "https://different.convex.site");
  await expect(t.action(run, args)).rejects.toThrow("PRESENCE_DESIGN_DEDICATED_STAGE_REQUIRED");
});
