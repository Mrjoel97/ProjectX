// @vitest-environment node
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { GenericActionCtx } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import type { DataModel, Id } from "./_generated/dataModel";
import { evalBudgetModel } from "./lib/evalBudgetModel";

const tenantId = "packeval-abcdef12-case";
const budgetId = "budget" as Id<"spendEvents">;
const modelId = "or/openai/gpt-5.6-luna";
const usage = {
  inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const result = {
  content: [{ type: "text" as const, text: "Draft" }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage,
  warnings: [],
};
const context = (events: string[]) =>
  ({
    runMutation: vi.fn(async (_fn, args) => {
      events.push(args.callId ? "reserve" : "settle");
      return args.callId ? "reservation" : { settled: true };
    }),
  }) as unknown as GenericActionCtx<DataModel>;

describe("low-level model budget middleware", () => {
  test("a committed breach stops the loop and preserves known cost", async () => {
    const events: string[] = [];
    const ctx = {
      runMutation: async (_fn: unknown, args: { callId?: string }) => {
        events.push(args.callId ? "reserve" : "settle");
        return args.callId ? "reservation" : { settled: true, breached: true };
      },
    } as unknown as GenericActionCtx<DataModel>;
    const onCost = vi.fn();
    const model = evalBudgetModel({
      ctx,
      tenantId,
      budgetId,
      modelId,
      onCost,
      model: new MockLanguageModelV4({
        doGenerate: async () => ({
          ...result,
          providerMetadata: { openrouter: { usage: { cost: 1 } } },
        }),
      }),
    });
    await expect(
      generateText({ model, prompt: "x", maxOutputTokens: 8192, maxRetries: 0 }),
    ).rejects.toThrow("EXCEEDED_RESERVATION");
    expect(events).toEqual(["reserve", "settle"]);
    expect(onCost).toHaveBeenCalledExactlyOnceWith(1);
  });

  test("source governing failure blocks the next call before reservation", async () => {
    const events: string[] = [];
    const model = evalBudgetModel({
      ctx: context(events),
      tenantId,
      budgetId,
      modelId,
      model: new MockLanguageModelV4({ doGenerate: async () => result }),
      onCost: () => {},
      beforeCall: () => {
        throw new Error("EVAL_SOURCE_READ_FAILED");
      },
    });
    await expect(
      generateText({ model, prompt: "x", maxOutputTokens: 8192, maxRetries: 0 }),
    ).rejects.toThrow("SOURCE_READ_FAILED");
    expect(events).toEqual([]);
  });

  test("provider wire receives hard rate/output bounds and no provider fallback; exact cost settles once", async () => {
    const events: string[] = [];
    const wire: Record<string, unknown>[] = [];
    const provider = createOpenRouter({
      apiKey: "offline-test-key",
      fetch: async (_url, init) => {
        events.push("provider");
        wire.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: "response-test",
            model: "openai/gpt-5.6-luna",
            provider: "OpenAI",
            object: "chat.completion",
            created: 1,
            choices: [
              { index: 0, finish_reason: "stop", message: { role: "assistant", content: "Draft" } },
            ],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3, cost: 0.000123 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const onCost = vi.fn();
    const model = evalBudgetModel({
      ctx: context(events),
      tenantId,
      budgetId,
      modelId,
      model: provider.chat("openai/gpt-5.6-luna"),
      onCost,
    });
    const pixels = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Read this source" },
            { type: "file", data: pixels, mediaType: "image/png" },
          ],
        },
      ],
      maxOutputTokens: 8192,
      maxRetries: 0,
    });
    expect(events).toEqual(["reserve", "provider", "settle"]);
    expect(wire[0]).toMatchObject({
      max_tokens: 8192,
      n: 1,
      plugins: [],
      transforms: [],
      provider: {
        only: ["openai"],
        allow_fallbacks: false,
        require_parameters: true,
        max_price: { prompt: 0.5, completion: 1.8, request: 0, image: 0 },
      },
    });
    expect(onCost).toHaveBeenCalledExactlyOnceWith(0.000123);
    expect(wire[0]?.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Read this source" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      },
    ]);
  });

  test("missing cost and thrown provider attempts leave their reservations unresolved", async () => {
    for (const doGenerate of [
      async () => result,
      async () => {
        throw new Error("provider failed");
      },
    ]) {
      const events: string[] = [];
      const onCost = vi.fn();
      const model = evalBudgetModel({
        ctx: context(events),
        tenantId,
        budgetId,
        modelId,
        model: new MockLanguageModelV4({ doGenerate }),
        onCost,
      });
      await expect(
        generateText({ model, prompt: "x", maxOutputTokens: 8192, maxRetries: 0 }),
      ).rejects.toThrow();
      expect(events).toEqual(["reserve"]);
      expect(onCost).not.toHaveBeenCalled();
    }
  });

  test("refused reservation cannot invoke provider; every new low-level call reserves separately", async () => {
    const events: string[] = [];
    let calls = 0;
    const ctx = {
      runMutation: async (_fn: unknown, args: { callId?: string }) => {
        if (args.callId && calls > 0) throw new Error("EVAL_BUDGET_EXHAUSTED");
        events.push(args.callId ? "reserve" : "settle");
        return args.callId ? "reservation" : { settled: true, breached: false };
      },
    } as unknown as GenericActionCtx<DataModel>;
    const model = evalBudgetModel({
      ctx,
      tenantId,
      budgetId,
      modelId,
      onCost: () => {},
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          calls++;
          return { ...result, providerMetadata: { openrouter: { usage: { cost: 0 } } } };
        },
      }),
    });
    await generateText({ model, prompt: "x", maxOutputTokens: 8192, maxRetries: 0 });
    await expect(
      generateText({ model, prompt: "x", maxOutputTokens: 8192, maxRetries: 0 }),
    ).rejects.toThrow("BUDGET_EXHAUSTED");
    expect(calls).toBe(1);
    expect(events).toEqual(["reserve", "settle"]);
  });

  test("unbounded output and URL-backed media fail before reservation or model", async () => {
    const events: string[] = [];
    const underlying = new MockLanguageModelV4({ doGenerate: async () => result });
    const model = evalBudgetModel({
      ctx: context(events),
      tenantId,
      budgetId,
      modelId,
      model: underlying,
      onCost: () => {},
    });
    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "x" }] }],
        maxOutputTokens: 9000,
      }),
    ).rejects.toThrow("OUTPUT_LIMIT");
    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "file",
                data: { type: "url", url: new URL("https://example.test/x.png") },
                mediaType: "image/png",
              },
            ],
          },
        ],
        maxOutputTokens: 8192,
      }),
    ).rejects.toThrow("MEDIA_UNSUPPORTED");
    expect(events).toEqual([]);
    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "x",
                providerOptions: { openrouter: { cache_control: { type: "ephemeral" } } },
              },
            ],
          },
        ],
        maxOutputTokens: 8192,
      }),
    ).rejects.toThrow("CACHE_WRITE_UNSUPPORTED");
  });
});
