/** Conservative provider-contract bounds, reviewed against OpenRouter /api/v1/models 2026-09-10.
 * Reserve the WHOLE accepted context, not chars/4. Provider max_price is also enforced on wire.
 * These are ceilings, not billing rates: reconciliation uses the provider's reported USD cost.
 */
export const EVAL_MODEL_BOUNDS: Readonly<
  Record<
    string,
    {
      contextTokens: number;
      promptPerMillion: number;
      completionPerMillion: number;
    }
  >
> = {
  "or/openai/gpt-5.6-luna": {
    contextTokens: 1_050_000,
    promptPerMillion: 0.5,
    completionPerMillion: 1.8,
  },
  "or/openai/gpt-4.1-mini": {
    contextTokens: 1_047_576,
    promptPerMillion: 0.4,
    completionPerMillion: 1.6,
  },
};
export const EVAL_MAX_OUTPUT_TOKENS = 8192;
export const EVAL_MAX_BUDGET_CENTS = 1000;
export const EVAL_BUDGET_LIFETIME_MS = 60 * 60 * 1000;

export function evalCallCeilingCents(model: string, outputTokens: number): number {
  const bound = EVAL_MODEL_BOUNDS[model];
  if (!bound) throw new Error("EVAL_MODEL_UNSUPPORTED");
  if (
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 1 ||
    outputTokens > EVAL_MAX_OUTPUT_TOKENS
  )
    throw new Error("EVAL_OUTPUT_LIMIT_REQUIRED");
  return Math.ceil(
    (bound.contextTokens * bound.promptPerMillion + outputTokens * bound.completionPerMillion) /
      10_000,
  );
}

export function evalActualCents(costUsd: number): number {
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("EVAL_COST_UNKNOWN");
  return Math.ceil(costUsd * 100);
}
