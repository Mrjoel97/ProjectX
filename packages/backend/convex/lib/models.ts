import { openai } from "@ai-sdk/openai";
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
