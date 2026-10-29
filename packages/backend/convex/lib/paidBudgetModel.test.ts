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
