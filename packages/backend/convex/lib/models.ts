import { createOpenAI, openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * THE ONE place a pricing/audit model id becomes a callable model. 33.2-04.
 *
 * Why it exists: `845f4b1` moved the pins to OpenRouter (`or/openai/gpt-4o-mini`) and llm.ts learned
 * the `or/` route — but FIVE other modules (vaultLlm, vaultDigest, blueprint, onboarding, voiceDoc)
 * each carried their own one-line copy of the OLD resolver, `openai(id.replace(/^openai\//, ""))`,
 * which sent the literal string `or/openai/gpt-4o-mini` to api.openai.com. Every vault ingest that
 * reached `extractGraph` has failed `ingest_failed` since 2026-08-27 (69 rows, the four rendered
 * reels among them), and the digest, blueprint, onboarding and voice extractors were on the same
 * dead route. One copy per file was defended as "not worth a module"; the fifth silent break is.
 *
 * Runtime: NO "use node" — this is imported by V8 actions (vaultDigest, blueprint, onboarding,
 * voiceDoc) and by the node lane (llm.ts, vaultLlm.ts) alike; the OpenRouter provider is fetch-only.
 * Lazy + memoised so a deployment with no OpenRouter key that never routes here does not throw at
 * module load. The stealth/ and google/ branches stay in llm.ts: the first carries per-model
 * settings, the second needs `Buffer` for a Vertex credential — neither is V8-safe or V8-needed.
 *
 * The `or/` prefix is the ROUTE and is stripped here; the full id stays the PRICING/audit key, so
 * `or/openai/gpt-4o-mini` and `openai/gpt-4o-mini` price and audit as the different bills they are.
 */
let openRouterProvider: ReturnType<typeof createOpenRouter> | undefined;
export const openRouter = () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  openRouterProvider ??= createOpenRouter({ apiKey });
  return openRouterProvider;
};

export const resolveModel = (id: string): LanguageModel =>
  id.startsWith("or/") ? openRouter().chat(id.slice(3)) : openai(id.replace(/^openai\//, ""));

/**
 * 33.2-05: TRANSCRIPTION through OpenRouter. `@openrouter/ai-sdk-provider@3.0.0` has no
 * transcription model, but OpenRouter's `/audio/transcriptions` is OpenAI-wire-compatible, so the
 * OpenAI provider with OpenRouter's base URL carries it with zero new deps. Probed 2026-09-05:
 * whisper-1 200 on mp3 and mp4 (no mediaType needed), gpt-4o-transcribe 200.
 */
let compatProvider: ReturnType<typeof createOpenAI> | undefined;
const openRouterOpenAiCompat = () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  compatProvider ??= createOpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey });
  return compatProvider;
};

export const transcriptionModel = (id: string) =>
  id.startsWith("or/")
    ? openRouterOpenAiCompat().transcription(id.slice(3))
    : openai.transcription(id.replace(/^openai\//, ""));

/**
 * The bill, from the provider's own body. OpenRouter answers `{ text, usage: { seconds, cost } }`
 * (whisper) or `{ usage: { ..., cost } }` (gpt-4o-transcribe) whatever the response format. The
 * SDK only surfaces `durationInSeconds` from verbose_json, which it requests for the bare
 * "whisper-1" id alone — so on the routed id a caller pricing from `durationInSeconds ?? 0`
 * would record $0 and walk past the kill switch (cost.ts Pitfall 5). Read the body first.
 */
// `responses[0].body` is on the wire object but not on `TranscriptionModelResponseMetadata`'s
// type (timestamp/modelId/headers only), hence the structural read.
export const transcriptionUsage = (result: {
  responses?: ReadonlyArray<object>;
}): { seconds?: number; costUsd?: number } => {
  const usage = (
    result.responses?.[0] as
      | { body?: { usage?: { seconds?: unknown; cost?: unknown } } }
      | undefined
  )?.body?.usage;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  return { seconds: num(usage?.seconds), costUsd: num(usage?.cost) };
};
