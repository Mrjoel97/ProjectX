import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { paidBudgetModel } from "./paidBudgetModel";

function model() {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 2, reasoning: 0 },
      },
      warnings: [],
      providerMetadata: { openrouter: { usage: { cost: 0.002 } } },
      response: { body: { usage: { cost: 0.002, is_byok: false } } },
    }),
  });
}
describe("paid model middleware", () => {
  test.each([
    undefined,
    "vision-review",
  ] as const)("scoped Kimi %s uses matching actual output cap and reservation", async (purpose) => {
    const wire: Record<string, unknown>[] = [];
    const events: string[] = [];
    const provider = createOpenRouter({
      apiKey: "offline-test",
      fetch: async (_url, init) => {
        events.push("provider");
        wire.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: "reply",
            model: "moonshotai/kimi-k3.1-pro",
            object: "chat.completion",
            created: 1,
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: "design" },
              },
            ],
            usage: {
              prompt_tokens: 2,
              completion_tokens: 1,
              total_tokens: 3,
              cost: 0.04,
              is_byok: false,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const runMutation = vi.fn(async (_fn, args) => {
      events.push(args.reservationId ? "settle" : "reserve");
      return args.reservationId ? { breached: false } : "reservation";
    });
    const websiteDesign = {
      planId: "plan" as never,
      revision: 2,
      runRef: "abc12345abc12345",
      ...(purpose ? { purpose } : {}),
    };
    const wrapped = paidBudgetModel({
      ctx: { runMutation } as never,
      tenantId: "real-customer",
      model: provider.chat("moonshotai/kimi-k3.1-pro"),
      modelId: "or/moonshotai/kimi-k3.1-pro",
      websiteDesign,
      beforeCall: async () => {
        events.push("current-context");
      },
    });
    await generateText({
      model: wrapped,
      prompt: "Design",
      maxOutputTokens: 32768,
      maxRetries: 0,
      providerOptions: {
        openrouter: { reasoning: { effort: "max" }, provider: { allow_fallbacks: true } },
      },
    });
    expect(events).toEqual(["current-context", "reserve", "provider", "settle"]);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      tenantId: "real-customer",
      ceilingCents: purpose ? 424 : 428,
      websiteDesign,
    });
    expect(wire[0]).toMatchObject({
      reasoning: { effort: "low" },
      max_tokens: purpose ? 4096 : 8192,
      provider: {
        only: ["moonshotai"],
        allow_fallbacks: false,
        max_price: { prompt: "2", completion: "10" },
      },
    });
  });
  test("ordinary Kimi remains available without website-specific authority", async () => {
    const inner = model();
    const generate = vi.spyOn(inner, "doGenerate");
    const runMutation = vi.fn(async (_ref: unknown, _args: unknown) => ({ breached: false }));
    await generateText({
      model: paidBudgetModel({
        ctx: { runMutation } as never,
        tenantId: "customer",
        model: inner,
        modelId: "or/moonshotai/kimi-k3.1-pro",
      }),
      prompt: "Ordinary complex reasoning",
      maxRetries: 0,
    });
    expect(runMutation.mock.calls[0]?.[1]).not.toHaveProperty("websiteDesign");
    expect(generate.mock.calls[0]?.[0].providerOptions?.openrouter).not.toHaveProperty("reasoning");
  });
  test("website and managed-service authority cannot be combined", () => {
    expect(() =>
      paidBudgetModel({
        ctx: {} as never,
        tenantId: "customer",
        model: model(),
        modelId: "or/moonshotai/kimi-k3.1-pro",
        websiteDesign: { planId: "plan" as never, revision: 1, runRef: "abc12345abc12345" },
        managedServiceRunId: "service" as never,
      }),
    ).toThrow("MODEL_SCOPE_INVALID");
  });
  test("scoped Kimi retains its hold when standard-credit billing cannot be verified", async () => {
    for (const body of [
      { usage: { cost: 0.002, is_byok: true } },
      { usage: { cost: 0.003, is_byok: false } },
    ]) {
      const inner = model();
      const generate = inner.doGenerate.bind(inner);
      inner.doGenerate = async (args) => ({ ...(await generate(args)), response: { body } });
      const runMutation = vi.fn(async () => "reservation");
      const wrapped = paidBudgetModel({
        ctx: { runMutation } as never,
        tenantId: "customer",
        model: inner,
        modelId: "or/moonshotai/kimi-k3.1-pro",
        websiteDesign: { planId: "plan" as never, revision: 1, runRef: "abc12345abc12345" },
      });
      await expect(
        generateText({ model: wrapped, prompt: "design", maxRetries: 0 }),
      ).rejects.toThrow("BILLING_MODE_UNVERIFIED");
      expect(runMutation).toHaveBeenCalledTimes(1);
    }
  });
  test("changed website context stops before reservation or provider transport", async () => {
    const runMutation = vi.fn();
    const wrapped = paidBudgetModel({
      ctx: { runMutation } as never,
      tenantId: "customer",
      model: model(),
      modelId: "or/moonshotai/kimi-k3.1-pro",
      websiteDesign: { planId: "plan" as never, revision: 1, runRef: "abc12345abc12345" },
      beforeCall: async () => {
        throw Error("CONTEXT_CHANGED");
      },
    });
    await expect(generateText({ model: wrapped, prompt: "design", maxRetries: 0 })).rejects.toThrow(
      "CONTEXT_CHANGED",
    );
    expect(runMutation).not.toHaveBeenCalled();
  });
  test("trusted service identity reaches native admission; refused admission never calls the provider", async () => {
    const inner = model();
    const provider = vi.spyOn(inner, "doGenerate");
    const runMutation = vi.fn(async (_ref: unknown, _args: Record<string, unknown>) => {
      throw new Error("SERVICE_RUN_FENCED");
    });
    const runId = "service-fixture" as Id<"managedServiceRuns">;
    const wrapped = paidBudgetModel({
      ctx: { runMutation } as never,
      tenantId: "t",
      model: inner,
      modelId: "or/openai/gpt-4o-mini",
      managedServiceRunId: runId,
    });
    await expect(generateText({ model: wrapped, prompt: "test", maxRetries: 0 })).rejects.toThrow(
      "SERVICE_RUN_FENCED",
    );
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({ managedServiceRunId: runId });
    expect(provider).not.toHaveBeenCalled();
  });
  test("admission precedes provider and settlement precedes returning output", async () => {
    const events: string[] = [];
    const inner = model();
    const generate = inner.doGenerate.bind(inner);
    inner.doGenerate = async (args) => {
      events.push("provider");
      return generate(args);
    };
    const runMutation = vi.fn(async (_fn, args) => {
      events.push(args.reservationId ? "settle" : "reserve");
      return args.reservationId ? { settled: true, breached: false } : "reservation";
    });
    const wrapped = paidBudgetModel({
      ctx: { runMutation } as never,
      tenantId: "t",
      model: inner,
      modelId: "or/openai/gpt-4o-mini",
    });
    expect((await generateText({ model: wrapped, prompt: "test", maxRetries: 0 })).text).toBe("ok");
    expect(events).toEqual(["reserve", "provider", "settle"]);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({ costUsd: 0.002 });
  });
  test("missing usage holds admission and does not become zero cost", async () => {
    const inner = model();
    const generate = inner.doGenerate.bind(inner);
    inner.doGenerate = async (args) => ({ ...(await generate(args)), providerMetadata: {} });
    const runMutation = vi.fn(async () => "reservation");
    const wrapped = paidBudgetModel({
      ctx: { runMutation } as never,
      tenantId: "t",
      model: inner,
      modelId: "or/openai/gpt-4o-mini",
    });
    await expect(generateText({ model: wrapped, prompt: "test", maxRetries: 0 })).rejects.toThrow(
      "PAID_COST_UNKNOWN",
    );
    expect(runMutation).toHaveBeenCalledTimes(1);
  });
  test("uncertain provider failure cannot trigger SDK retries or settle", async () => {
    const inner = model();
    inner.doGenerate = vi.fn(async () => {
      throw new Error("lost response");
    });
    const runMutation = vi.fn(async () => "reservation");
    const wrapped = paidBudgetModel({
      ctx: { runMutation } as never,
      tenantId: "t",
      model: inner,
      modelId: "or/openai/gpt-4o-mini",
    });
    await expect(generateText({ model: wrapped, prompt: "test", maxRetries: 2 })).rejects.toThrow(
      "PAID_MODEL_RESPONSE_UNRESOLVED",
    );
    expect(inner.doGenerate).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledTimes(1);
  });
});
