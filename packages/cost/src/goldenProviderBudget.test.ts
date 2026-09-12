import { describe, expect, it } from "vitest";
import { evalCallCeilingCents } from "./evalBudget";
import {
  GOLDEN_EMBEDDING_MODEL,
  type GoldenProviderCall,
  goldenChatWireOptions,
  goldenEmbeddingRequest,
  goldenOpenRouterObservedUsage,
  goldenProviderCeilingCents,
  goldenTavilyExtractRequest,
  goldenTavilyObservedUsd,
  goldenTavilySearchRequest,
} from "./goldenProviderBudget";

describe("golden provider reservation policy (offline, no ledger or transport)", () => {
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
    expect(wire).toMatchObject({
      max_tokens: 8192,
      n: 1,
      plugins: [],
      transforms: [],
      provider: {
        only: ["openai"],
        order: ["openai"],
        allow_fallbacks: false,
        require_parameters: true,
        max_price: { prompt: "0.15", completion: "0.6", request: "0", image: "0", audio: "0" },
      },
    });
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
        max_price: { prompt: "0.02", completion: "0", request: "0" },
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
