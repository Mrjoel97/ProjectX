import { describe, expect, it } from "vitest";
import { evalCallCeilingCents } from "./evalBudget";
import {
  GOLDEN_EMBEDDING_MODEL,
  type GoldenProviderCall,
  goldenChatWireOptions,
  goldenEmbeddingRequest,
  goldenOpenRouterObservedUsage,
  goldenProviderCeilingCents,
  goldenTavilyBilling,
  goldenTavilyExtractRequest,
  goldenTavilyObservedCredits,
  goldenTavilyObservedUsd,
  goldenTavilySearchRequest,
} from "./goldenProviderBudget";

describe("golden provider reservation policy (offline, no ledger or transport)", () => {
  it("Free billing requires explicit metadata and still requires bounded observed credits", () => {
    expect(goldenTavilyBilling("free", "0")).toEqual({ billingMode: "free", creditUsd: 0 });
    expect(goldenTavilyBilling(undefined, "0.008")).toEqual({
      billingMode: "standard",
      creditUsd: 0.008,
    });
    for (const [mode, rate] of [
      [undefined, "0"],
      ["free", undefined],
      ["free", ""],
      ["free", " "],
      ["free", "0.008"],
      ["unknown", "0"],
    ])
      expect(() => goldenTavilyBilling(mode, rate)).toThrow("ACCOUNT_UNSUPPORTED");
    for (const response of [
      {},
      { usage: { credits: "1" } },
      { usage: { credits: -1 } },
      { usage: { credits: Infinity } },
      { usage: { credits: Number.MAX_SAFE_INTEGER + 1 } },
    ]) {
      expect(goldenTavilyObservedUsd(response, 0, "free")).toBeNull();
      expect(goldenTavilyObservedCredits(response)).toBeNull();
    }
    expect(goldenTavilyObservedUsd({ usage: { credits: 1 } }, 0, "free")).toBe(0);
    expect(goldenTavilyObservedCredits({ usage: { credits: 1 } })).toBe(1);
    expect(goldenProviderCeilingCents({ kind: "tavily-search", depth: "basic" })).toBe(1);
  });
  it("covers whole model contexts and preserves existing native model bounds", () => {
    const chat = (model: string) =>
      goldenProviderCeilingCents({ kind: "chat", model, maxOutputTokens: 8192 });
    expect(chat("or/openai/gpt-4o-mini")).toBe(3);
    expect(chat("or/openai/gpt-4.1-nano")).toBe(11);
    for (const model of ["or/openai/gpt-5.6-luna", "or/openai/gpt-4.1-mini"])
      expect(chat(model)).toBe(evalCallCeilingCents(model, 8192));
    for (const model of ["toString", "__proto__", "openai/gpt-4o-mini", "unknown"])
      expect(() => chat(model)).toThrow("UNSUPPORTED");
    for (const maxOutputTokens of [0, -1, 8193, Infinity, NaN, 1.5])
      expect(() =>
        goldenProviderCeilingCents({
          kind: "chat",
          model: "or/openai/gpt-4o-mini",
          maxOutputTokens,
        }),
      ).toThrow("INPUT_LIMIT");
  });

  it("pins chat output and disallows provider fallback, extra request fees and plugins", () => {
    const wire = goldenChatWireOptions({
      kind: "chat",
      model: "or/openai/gpt-4o-mini",
      maxOutputTokens: 8192,
    });
    expect(wire).toEqual({
      max_tokens: 8192,
      provider: {
        only: ["openai"],
        order: ["openai"],
        allow_fallbacks: false,
        max_price: { prompt: 0.15, completion: 0.6, request: 0, image: 0 },
      },
    });
    // The @openrouter ai-sdk provider SPREADS providerOptions.openrouter into the
    // top-level request body, so every key here must be in OpenRouter's documented
    // chat-completions body schema, and NO `require_parameters` filter may appear:
    // it excluded the one pinned OpenAI endpoint over meta-parameters and OpenRouter
    // answered HTTP 400 "no allowed providers" (runs 294a80bc / 72a43b32 / e902a0a3).
    // max_price values are documented NUMBERS in dollars per million tokens.
    const documentedChatBodyKeys = [
      "cache_control",
      "debug",
      "frequency_penalty",
      "image_config",
      "logit_bias",
      "logprobs",
      "max_completion_tokens",
      "max_tokens",
      "messages",
      "metadata",
      "min_p",
      "modalities",
      "model",
      "models",
      "parallel_tool_calls",
      "plugins",
      "prediction",
      "presence_penalty",
      "prompt_cache_key",
      "prompt_cache_options",
      "provider",
      "reasoning",
      "reasoning_effort",
      "repetition_penalty",
      "response_format",
      "route",
      "seed",
      "service_tier",
      "session_id",
      "stop",
      "stop_server_tools_when",
      "stream",
      "stream_options",
      "temperature",
      "tool_choice",
      "tools",
      "top_a",
      "top_k",
      "top_logprobs",
      "top_p",
      "trace",
      "user",
    ] as const;
    for (const key of Object.keys(wire)) expect(documentedChatBodyKeys).toContain(key);
    expect(wire).not.toHaveProperty("n");
    expect(wire).not.toHaveProperty("transforms");
    expect(wire).not.toHaveProperty("plugins");
    expect(wire.provider).not.toHaveProperty("require_parameters");
    for (const value of Object.values(wire.provider.max_price)) expect(typeof value).toBe("number");
  });

  it("bounds embedding batches using every full input context and copies the priced inputs", () => {
    const values = ["fixture source"];
    const request = goldenEmbeddingRequest(values);
    values.push("late mutation");
    expect(request.body.input).toEqual(["fixture source"]);
    expect(request.call.inputCount).toBe(1);
    expect(request.ceilingCents).toBe(1);
    expect(request.body).toMatchObject({
      model: GOLDEN_EMBEDDING_MODEL,
      dimensions: 1536,
      encoding_format: "float",
      provider: {
        max_price: { prompt: 0.02, completion: 0, request: 0 },
        allow_fallbacks: false,
      },
    });
    expect(goldenEmbeddingRequest(Array.from({ length: 2048 }, () => "x")).ceilingCents).toBe(34);
    for (const values of [[], [""], Array.from({ length: 2049 }, () => "x")])
      expect(() => goldenEmbeddingRequest(values)).toThrow("INPUT_LIMIT");
  });

  it("reserves whole extract credit batches even when a previous account batch is partial", () => {
    const cents = (urlCount: number) =>
      goldenProviderCeilingCents({ kind: "tavily-extract", depth: "basic", urlCount });
    expect([1, 5, 6, 10, 11, 20].map(cents)).toEqual([1, 1, 2, 2, 3, 4]);
    // For every possible starting remainder, charged whole batches fit within the hold.
    for (let prior = 0; prior < 5; prior++)
      for (let count = 1; count <= 20; count++)
        expect(Math.floor((prior + count) / 5) * 0.008 * 100).toBeLessThanOrEqual(cents(count));
    expect(goldenTavilyExtractRequest(["https://example.com"], "focus").body).toMatchObject({
      extract_depth: "basic",
      include_usage: true,
    });
    expect(goldenTavilySearchRequest("safe query", 5).body).toMatchObject({
      search_depth: "basic",
      auto_parameters: false,
      include_usage: true,
    });
    expect(() =>
      goldenProviderCeilingCents({
        kind: "tavily-search",
        depth: "advanced",
      } as unknown as GoldenProviderCall),
    ).toThrow("UNSUPPORTED");
    expect(() => cents(21)).toThrow("INPUT_LIMIT");
  });

  it("never mistakes missing or malformed usage for a free request", () => {
    for (const response of [
      null,
      {},
      { usage: {} },
      { usage: { cost: "0", credits: "0" } },
      { usage: { cost: -1, credits: -1 } },
      { usage: { cost: NaN, credits: Infinity } },
    ]) {
      expect(goldenOpenRouterObservedUsage(response)).toBeNull();
      expect(goldenTavilyObservedUsd(response, 0.008)).toBeNull();
    }
    expect(goldenOpenRouterObservedUsage({ usage: { cost: 0, is_byok: false } })).toEqual({
      costUsd: 0,
      isByok: false,
    });
    expect(goldenOpenRouterObservedUsage({ usage: { cost: 2, is_byok: true } })).toEqual({
      costUsd: 2,
      isByok: true,
    });
    expect(goldenOpenRouterObservedUsage({ usage: { cost: 2 } })).toEqual({
      costUsd: 2,
      isByok: null,
    });
    expect(goldenTavilyObservedUsd({ usage: { credits: 0 } }, 0.008)).toBe(0);
    expect(goldenTavilyObservedUsd({ usage: { credits: 5 } }, 0.008)).toBe(0.04);
    for (const rate of [0, -1, 0.009, NaN, Infinity])
      expect(() => goldenTavilyObservedUsd({ usage: { credits: 1 } }, rate)).toThrow(
        "ACCOUNT_UNSUPPORTED",
      );
  });
});
