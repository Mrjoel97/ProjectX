import { EVAL_MAX_OUTPUT_TOKENS, EVAL_MODEL_BOUNDS } from "./evalBudget";

/** Provider-contract ceilings reviewed 2026-09-10; see 23-EXECUTION-PREPARATION.md.
 * These helpers do not reserve money. The caller must use the existing spendEvents envelope
 * BEFORE each transport attempt and retain the hold on unknown cost. No suite cap is implied.
 */
const ADDITIONAL_CHAT_BOUNDS = {
  "or/openai/gpt-4o-mini": {
    contextTokens: 128_000,
    promptPerMillion: 0.15,
    completionPerMillion: 0.6,
  },
  "or/openai/gpt-4.1-nano": {
    contextTokens: 1_047_576,
    promptPerMillion: 0.1,
    completionPerMillion: 0.4,
  },
} as const;

export const GOLDEN_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const GOLDEN_EMBEDDING_MAX_INPUTS = 2048;
const EMBEDDING_CONTEXT_TOKENS = 8192;
const EMBEDDING_PER_MILLION = 0.02;
/** Applies only to a verified standard API account whose per-credit rate is <= this ceiling.
 * This is consumed API credit value; taxes, purchase fees and BYOK invoices are outside it.
 */
export const GOLDEN_TAVILY_CREDIT_USD_CEILING = 0.008;

export type GoldenProviderCall =
  | { kind: "chat"; model: string; maxOutputTokens: number }
  | { kind: "embedding"; model: typeof GOLDEN_EMBEDDING_MODEL; inputCount: number }
  | { kind: "tavily-search"; depth: "basic" }
  | { kind: "tavily-extract"; depth: "basic"; urlCount: number };

function positiveCount(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error("GOLDEN_PROVIDER_INPUT_LIMIT");
}

function chatBound(model: string) {
  // Own-property lookup is intentional: arbitrary model identifiers must not resolve prototypes.
  const existing = EVAL_MODEL_BOUNDS[model];
  if (existing && Object.hasOwn(EVAL_MODEL_BOUNDS, model)) return existing;
  if (Object.hasOwn(ADDITIONAL_CHAT_BOUNDS, model))
    return ADDITIONAL_CHAT_BOUNDS[model as keyof typeof ADDITIONAL_CHAT_BOUNDS];
  throw new Error("GOLDEN_PROVIDER_UNSUPPORTED");
}

export function goldenProviderCeilingCents(call: GoldenProviderCall): number {
  switch (call.kind) {
    case "chat": {
      const bound = chatBound(call.model);
      positiveCount(call.maxOutputTokens, EVAL_MAX_OUTPUT_TOKENS);
      return Math.ceil(
        (bound.contextTokens * bound.promptPerMillion +
          call.maxOutputTokens * bound.completionPerMillion) /
          10_000,
      );
    }
    case "embedding":
      if (call.model !== GOLDEN_EMBEDDING_MODEL) throw new Error("GOLDEN_PROVIDER_UNSUPPORTED");
      positiveCount(call.inputCount, GOLDEN_EMBEDDING_MAX_INPUTS);
      // Deliberately do not assume a tighter provider-wide batch token limit. Full accepted
      // context for every input bounds batching without an estimated tokenizer or chars/4.
      return Math.ceil(
        (call.inputCount * EMBEDDING_CONTEXT_TOKENS * EMBEDDING_PER_MILLION) / 10_000,
      );
    case "tavily-search":
      if (call.depth !== "basic") throw new Error("GOLDEN_PROVIDER_UNSUPPORTED");
      return Math.ceil(GOLDEN_TAVILY_CREDIT_USD_CEILING * 100);
    case "tavily-extract":
      if (call.depth !== "basic") throw new Error("GOLDEN_PROVIDER_UNSUPPORTED");
      positiveCount(call.urlCount, 20);
      // Tavily may return zero credits until five successful URLs accrue. Reserve whole
      // credit batches on EVERY request, including one URL and pre-existing partial batches.
      return Math.ceil(Math.ceil(call.urlCount / 5) * GOLDEN_TAVILY_CREDIT_USD_CEILING * 100);
    default:
      throw new Error("GOLDEN_PROVIDER_UNSUPPORTED");
  }
}

/** Replace routing options; never merge caller-controlled options after these constraints. */
function openRouterProvider(prompt: number, completion: number) {
  return {
    only: ["openai"],
    order: ["openai"],
    allow_fallbacks: false,
    require_parameters: true,
    max_price: {
      prompt: String(prompt),
      completion: String(completion),
      request: "0",
      image: "0",
      audio: "0",
    },
  };
}

export function goldenChatWireOptions(call: Extract<GoldenProviderCall, { kind: "chat" }>) {
  goldenProviderCeilingCents(call);
  const bound = chatBound(call.model);
  return {
    max_tokens: call.maxOutputTokens,
    n: 1,
    plugins: [],
    transforms: [],
    provider: openRouterProvider(bound.promptPerMillion, bound.completionPerMillion),
  };
}

/** Input must already have passed the existing redaction/authority boundary. No credential path. */
export function goldenEmbeddingRequest(values: readonly string[]) {
  const call = {
    kind: "embedding",
    model: GOLDEN_EMBEDDING_MODEL,
    inputCount: values.length,
  } as const;
  const ceilingCents = goldenProviderCeilingCents(call);
  if (values.some((value) => typeof value !== "string" || value.length === 0))
    throw new Error("GOLDEN_PROVIDER_INPUT_LIMIT");
  return {
    call,
    ceilingCents,
    body: {
      model: GOLDEN_EMBEDDING_MODEL,
      input: [...values],
      dimensions: 1536,
      encoding_format: "float",
      provider: openRouterProvider(EMBEDDING_PER_MILLION, 0),
    },
  };
}

export function goldenTavilySearchRequest(safeQuery: string, maxResults: number) {
  positiveCount(maxResults, 20);
  if (!safeQuery.trim()) throw new Error("GOLDEN_PROVIDER_INPUT_LIMIT");
  const call = { kind: "tavily-search", depth: "basic" } as const;
  return {
    call,
    ceilingCents: goldenProviderCeilingCents(call),
    body: {
      query: safeQuery,
      max_results: maxResults,
      search_depth: "basic",
      auto_parameters: false,
      include_usage: true,
    },
  };
}

/** URLs must still pass the existing search-returned-URL allowlist before calling this helper. */
export function goldenTavilyExtractRequest(allowedUrls: readonly string[], safeFocus: string) {
  const call = { kind: "tavily-extract", depth: "basic", urlCount: allowedUrls.length } as const;
  const ceilingCents = goldenProviderCeilingCents(call);
  if (allowedUrls.some((url) => typeof url !== "string" || !url.trim()))
    throw new Error("GOLDEN_PROVIDER_INPUT_LIMIT");
  return {
    call,
    ceilingCents,
    body: {
      urls: [...allowedUrls],
      extract_depth: "basic",
      format: "markdown",
      query: safeFocus,
      chunks_per_source: 3,
      include_usage: true,
    },
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Null means retain the entire hold, not zero spend. BYOK is separately surfaced so callers
 * can persist known OpenRouter cost and refuse further work with unsupported external billing.
 */
export function goldenOpenRouterObservedUsage(response: unknown) {
  const usage = object(object(response)?.usage);
  const cost = usage?.cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return null;
  return {
    costUsd: cost,
    isByok: typeof usage?.is_byok === "boolean" ? usage.is_byok : null,
  };
}

/** The rate is trusted account metadata, never model/tool input. Standard PAYG is the ceiling;
 * an unverified/custom account cannot use this monetary conversion. A reported overrun is NOT
 * clamped: settle the truthful cost and let the existing ledger persist its breach marker.
 */
export function goldenTavilyObservedUsd(
  response: unknown,
  verifiedCreditUsd: number,
): number | null {
  if (
    !Number.isFinite(verifiedCreditUsd) ||
    verifiedCreditUsd <= 0 ||
    verifiedCreditUsd > GOLDEN_TAVILY_CREDIT_USD_CEILING
  )
    throw new Error("GOLDEN_TAVILY_ACCOUNT_UNSUPPORTED");
  const credits = object(object(response)?.usage)?.credits;
  if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0) return null;
  return credits * verifiedCreditUsd;
}
