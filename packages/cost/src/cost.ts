/**
 * @pikar/cost — pure-TS cost estimation + model selection (GRDL-03).
 *
 * Fail-closed by construction: every function returns Result, so an unknown model
 * or an over-budget request surfaces as Err (never NaN/undefined/throw) and the
 * convex adapter can stop the request. Domain logic per CLAUDE.md §1.
 */
import { type Result, err, ok } from "@pikar/core/result";
import type { SafeText } from "@pikar/pii";

export const DEFAULT_MODEL = "openai/gpt-4o-mini";
export const CHEAP_MODEL = "openai/gpt-4.1-nano"; // downgrade AND fallback target

// Vercel AI Gateway per-MTok pricing, verified 2026-07-12.
export const PRICING: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  [DEFAULT_MODEL]: { inPerMTok: 0.15, outPerMTok: 0.6 },
  [CHEAP_MODEL]: { inPerMTok: 0.1, outPerMTok: 0.4 },
};

// ponytail: chars/4 heuristic — feeds a budget THRESHOLD, not billing; real cost
// prices SDK usage via priceUsage. Adopt a tokenizer only if the margin ever matters.
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

// ponytail: fixed expected-output size for an email draft; tune when telemetry shows drift.
export const EXPECTED_OUTPUT_TOKENS = 1024;

export type CostError = { code: "unknown_model" | "over_budget" };

export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number,
): Result<number, CostError> {
  const p = PRICING[model];
  if (!p) return err({ code: "unknown_model" });
  return ok((tokensIn / 1_000_000) * p.inPerMTok + (tokensOut / 1_000_000) * p.outPerMTok);
}

export function priceUsage(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number },
): Result<number, CostError> {
  return estimateCostUsd(model, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
}

// gpt-4o-transcribe per-audio-minute pricing (OpenAI published rate, verified 2026-07-14).
export const TRANSCRIPTION_PRICING: { perMinuteUsd: number } = { perMinuteUsd: 0.006 };

/** INTK-03: prices audio transcription per-audio-minute (billed in whole minutes,
 *  rounded up — matches OpenAI's per-minute billing). Fail-closed: non-finite or
 *  negative seconds → Err (never NaN/throw), so recordSpend can never silently
 *  under-count and bypass the kill switch (Pitfall 5). */
export function priceTranscription(seconds: number): Result<number, CostError> {
  if (!Number.isFinite(seconds) || seconds < 0) return err({ code: "over_budget" });
  const minutes = Math.ceil(seconds / 60);
  return ok(minutes * TRANSCRIPTION_PRICING.perMinuteUsd);
}

// gpt-realtime-2.1 per-MTok pricing. ponytail: rates pinned 2026-07-20 from
// https://developers.openai.com/api/docs/pricing (post-cutoff GA) — re-fetch if the
// snapshot or tier moves. `-mini` is ~audio $10/$20 if a cheaper tier is ever adopted.
export const REALTIME_PRICING: {
  audioInPerMTok: number;
  audioOutPerMTok: number;
  textInPerMTok: number;
  textOutPerMTok: number;
} = { audioInPerMTok: 32, audioOutPerMTok: 64, textInPerMTok: 4, textOutPerMTok: 24 };

/** VOIC-02: prices realtime audio/text token counts → USD for recordSpend. Fail-closed
 *  exactly like priceTranscription: any non-finite or negative count → Err (never
 *  NaN/throw), so metering can never silently under-count against the daily budget. */
export function priceRealtime(
  inAudioTok: number,
  outAudioTok: number,
  textInTok: number,
  textOutTok: number,
): Result<number, CostError> {
  for (const n of [inAudioTok, outAudioTok, textInTok, textOutTok]) {
    if (!Number.isFinite(n) || n < 0) return err({ code: "over_budget" });
  }
  const p = REALTIME_PRICING;
  return ok(
    (inAudioTok * p.audioInPerMTok +
      outAudioTok * p.audioOutPerMTok +
      textInTok * p.textInPerMTok +
      textOutTok * p.textOutPerMTok) /
      1_000_000,
  );
}

/** GRDL-03: default model if it fits budgetUsdPerRequest; else downgrade to CHEAP_MODEL;
 *  else Err over_budget. Any unknown-model Err propagates (fail closed). Accepts SafeText
 *  ONLY — cost is always estimated from redacted text (GRDL-02/03). */
export function chooseModel(
  safeText: SafeText,
  budgetUsdPerRequest: number,
): Result<{ model: string; estCents: number }, CostError> {
  const tokensIn = estimateTokens(safeText);
  const budgetOk = Number.isFinite(budgetUsdPerRequest) && budgetUsdPerRequest > 0;
  for (const model of [DEFAULT_MODEL, CHEAP_MODEL]) {
    const est = estimateCostUsd(model, tokensIn, EXPECTED_OUTPUT_TOKENS);
    if (!est.ok) return est; // unknown_model propagates — fail closed
    if (budgetOk && est.value <= budgetUsdPerRequest) {
      // Integer cents, fail-closed bias: a sub-cent estimate still costs ≥ 1 cent of budget.
      return ok({ model, estCents: Math.max(1, Math.ceil(est.value * 100)) });
    }
  }
  return err({ code: "over_budget" });
}
