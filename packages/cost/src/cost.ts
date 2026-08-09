/**
 * @pikar/cost — pure-TS cost estimation + model selection (GRDL-03).
 *
 * Fail-closed by construction: every function returns Result, so an unknown model
 * or an over-budget request surfaces as Err (never NaN/undefined/throw) and the
 * convex adapter can stop the request. Domain logic per CLAUDE.md §1.
 */
import { err, ok, type Result } from "@pikar/core/result";
import type { SafeText } from "@pikar/pii";

// TWO VENDORS, ALTERNATING (2026-08-07, owner decision). The goal is NOT to replace OpenAI: it is
// that work continues when either vendor's credit runs out. Both stay priced and reachable.
//
// The `google/` prefix is not decoration: `resolveModel` (llm.ts) routes on it, and the id stays the
// pricing/audit key exactly as `openai/…` does. Same scheme, second vendor.
// 3.5, NOT 2.5 — corrected 2026-08-07 against a live key. `gemini-2.5-flash` still APPEARS in the
// AI Studio model listing but refuses with "no longer available to new users", so the listing is not
// proof of access; only a call is. Both ids below were verified answering on this key, and both also
// appear in `@ai-sdk/google-vertex`'s model union, so the SAME ids serve both doors — which is what
// keeps the AI-Studio/Vertex split invisible above `resolveModel`.
//
// Explicit versions, deliberately NOT `gemini-flash-latest`: an alias silently moves a PRICED model,
// and a `PRICING` row that no longer matches the model that ran is the silent under-draw this file
// exists to prevent.
export const GEMINI_MODEL = "google/gemini-3.5-flash";
export const GEMINI_CHEAP_MODEL = "google/gemini-3.5-flash-lite";
export const OPENAI_DEFAULT_MODEL = "openai/gpt-4o-mini";
export const OPENAI_CHEAP_MODEL = "openai/gpt-4.1-nano";

// Aliases, deliberately — NOT second string literals. Two literals spelling the same model is how a
// PRICING row and a pin drift apart, and `PRICING` is keyed by computed property, so duplicate
// literals would silently collapse into one entry and hide the drift.
//
// **OPENAI LEADS AGAIN (2026-08-08) — the balance was topped up and verified live** (chat 200,
// embeddings 200 against the deployment's key). The pair is symmetric on purpose, so this is the
// two-line edit the file keeps promising; point it back at `GEMINI_MODEL` if the balances flip.
//
// This is not only a billing preference. The Gemini FREE tier is capped at **20 requests per minute
// per model** (`generate_content_free_tier_requests`, named verbatim in its own 429), and a golden
// gate run is far denser than that — one research case alone can exceed it. That cap, not any
// application bug, produced most of 2026-08-07's eval failures and two destabilised backends.
export const DEFAULT_MODEL = OPENAI_DEFAULT_MODEL;

// SAME-VENDOR AS THE DEFAULT, now that OpenAI leads again (2026-08-08). `CHEAP_MODEL` is both the
// budget downgrade AND the failure-fallback target, and `runAgentLoop` runs primary → fallback on an
// eligible error.
//
// **THE ONE PRECONDITION, LEARNED THE HARD WAY ON 2026-08-07: the fallback must point at a vendor
// WITH CREDIT.** Cross-vendor failover is a genuinely good design — it turns the shipped retry into
// provider failover for free — but while OpenAI sat at $0 it inverted: every eligible Gemini failure
// fell through to a dead account, converting a RECOVERABLE hiccup into a HARD failure. Measured on
// fixture `02-happy-multi-individual`: deterministic FAIL with the dead-account fallback, PASS
// ($0.0044) with a live one, nothing else changed. It also made failures UNDIAGNOSABLE — the
// surfaced error was OpenAI's billing message, so the primary's real error never reached a log.
//
// So this is deliberately same-vendor rather than cross-vendor: both pins are now on the FUNDED
// account. Going cross-vendor again (fallback → `GEMINI_CHEAP_MODEL`) is a one-line change and is
// worth it ONLY while both vendors are funded — and note the Gemini free tier's 20 RPM cap makes it
// a poor absorber for a dense run.
//
// **IT ONLY FIRES IF THE ERROR IS ELIGIBLE**, which is the honest limit of the design either way.
// `isFallbackEligible` (packages/core/src/fallback.ts) returns `APICallError.isRetryable`, so a
// rate-limit 429 DOES roll over, while a 403 (Vertex billing not enabled) does NOT — that is a
// configuration error a human has to fix, deliberately not papered over.
//
// **PLAIN GENERATION IS NOW LIVE-PROVEN ON BOTH GEMINI IDS** (2026-08-07, superseding the earlier
// "nothing here has made a live Gemini call yet" note): `probe:gemini` returned PASS for
// `gemini-3.5-flash` (in=8 out=93) and `gemini-3.5-flash-lite` (in=8 out=1) through the AI STUDIO
// door — `GOOGLE_GENERATIVE_AI_API_KEY` is set, so `resolveModel` never reached Vertex, which is
// still refused for billing on project project-c3a75795-f866-4b37-8ec.
// GROUNDING IS A SEPARATE QUESTION AND IT IS STILL RED — see RESEARCH_MODEL below.
export const CHEAP_MODEL = OPENAI_CHEAP_MODEL;

// Phase-16 (ACTN-03/D8). The research specialist gets its OWN model pin, NOT DEFAULT_MODEL /
// CHEAP_MODEL: global model constants have repo-wide blast radius, and only these two were PROVEN
// to accept `openai.tools.webSearch` — probe recorded verbatim in docs/playbooks/agent-runtime.md,
// run 2026-07-27 against @ai-sdk/openai@4.0.11 + ai@7.0.20.
//
// An unpriced model makes priceUsage return Err({unknown_model}) → recordModelSpend returns 0 →
// the run draws down NOTHING against the daily rail or the Phase-15 shared envelope. A research
// specialist that appears FREE is worse than one that errors. **The constant and its PRICING row
// land together, always** — cost.test.ts asserts exactly that for both pins.
//
// RESEARCH_MODEL currently EQUALS DEFAULT_MODEL. That is a coincidence of today's lineup, not a
// synonym: keep it a separate constant so a later change to DEFAULT_MODEL cannot silently move
// research onto a model nobody probed.
//
// The research-specific ids. Declared BEFORE the pins that alias them (biome's
// noInvalidUseBeforeDeclaration): these are the values, the pins below are the policy.
export const OPENAI_RESEARCH_MODEL = "openai/gpt-4o-mini";
export const OPENAI_RESEARCH_FALLBACK_MODEL = "openai/gpt-4.1-mini";

// **BACK ON OPENAI (2026-08-08), and the reason the pin exists at all has CHANGED.** The original
// rationale above — that only these two ids were PROVEN to accept `openai.tools.webSearch` — is now
// historical: `webResearch` is a LOCAL Tavily tool, so no model needs to 'accept' a hosted search
// and ANY priced model can research. The separate constant survives for the OTHER reason in this
// block, which still holds: a later change to DEFAULT_MODEL must not silently move research.
//
// The 2026-08-07 Gemini excursion is recorded in docs/playbooks/agent-runtime.md rather than here,
// because none of it constrains this line any more. The two facts worth carrying forward:
//   • Google Search grounding has ZERO entitlement on the Gemini free tier — a bare 429 with no
//     quota bucket and no retry delay, while a plain call to the same model returns 200 in the same
//     second. It is an entitlement, not a spent allowance; waiting does nothing.
//   • The Gemini free tier caps `generate_content` at **20 requests per minute per model**, which a
//     golden-gate run exceeds easily. That cap — not an application bug — produced most of that
//     day's eval failures.
// Neither applies to Tavily, which is why research no longer depends on either.
export const RESEARCH_MODEL = OPENAI_RESEARCH_MODEL;
// **THE VENDOR-MATCHING CONSTRAINT IS RETIRED (2026-08-07).** This block used to say research was
// the one pair that could not cross vendors, because `buildWebResearchTool` picked OpenAI's
// `webSearch` or Vertex's `googleSearch` from RESEARCH_MODEL's prefix and `runAgentLoop` reused that
// ONE record for both the primary and the fallback attempt — so a cross-vendor fallback handed one
// vendor a tool only the other could execute, a guaranteed 400.
//
// `webResearch` is now a LOCAL Tavily-backed tool, so it is not a vendor's tool at all and any model
// can call it. These two pins may cross vendors freely whenever that becomes useful; they stay on
// one today only because OpenAI is the funded door, not because the tool requires it.
export const RESEARCH_FALLBACK_MODEL = OPENAI_RESEARCH_FALLBACK_MODEL;

// **A GROWTH-SPECIALIST PIN WAS TRIED AND REVERTED 2026-08-08 — do not re-derive it.** Fixtures
// 29/30/31 assert `citesVaultDoc` (the seeded vault needle must reach the specialist's memo), and
// they looked model-dependent: a fully-Gemini run passed 3/3 while OpenAI failed 0/3. Pinning ONLY
// the growth trio to Gemini scored **1/3, and the one pass needed a retry** — noise, not a fix.
// Measured across four configurations, holding the embedding provider constant in both directions:
//   Gemini models  + Gemini embeddings → 3/3      OpenAI models + Gemini embeddings → 0/3
//   OpenAI models  + OpenAI embeddings → 0/3      OpenAI exec + Gemini growth       → 1/3
// The likeliest cause is not the model at all: one failing memo read "The user's vault does not
// contain information on lead channels", i.e. `searchVault` found nothing for that specialist's
// SELF-AUTHORED query, which varies per run. Treat this as retrieval variance in the fixture until
// a repeated-run measurement says otherwise.


// The hosted search fee is per CALL and is charged ON TOP of tokens (published $10 / 1k calls).
// Omitting it under-reports every research run against the envelope. Separate from PRICING because
// PRICING is per-MTok and this is not a token cost at all.
// ponytail: one flat rate. `searchContextSize` is pinned to "medium" at the call site, so a single
// constant is honest today. Upgrade path if the tier is ever varied per-call: key it by size.
export const WEB_SEARCH_CALL_USD = 0.01;

// Google Search grounding is billed per GROUNDED PROMPT, not per hosted call, and at a materially
// higher published rate than OpenAI's $10/1k. **UNVERIFIED — pinned high on purpose.** The rail
// treats it as a per-call fee like OpenAI's, which OVER-counts when one prompt issues several
// searches; that direction is deliberate. `searchFeeUsd` is the one place either rate is chosen, so
// a research run cannot silently draw the OpenAI fee while calling Google.
// **This is a 3.5x cost difference on a $5/day rail — verify it before trusting a research budget.**
// STILL NEVER DRAWN, as of 2026-08-07: grounding is quota-refused (see RESEARCH_MODEL), so no
// grounded call has completed and this rate has never priced a real one. The first grounded PASS is
// also the first chance to check the published rate against an actual bill.
export const GOOGLE_SEARCH_CALL_USD = 0.035;

// **A QUOTA PROXY, NOT A PRICE — and the distinction is the whole point of this constant.**
// Tavily's free tier bills no money, so the honest per-call PRICE is $0. But $0 would mean the daily
// rail cannot bound research at all, and the real scarcity did not disappear when the invoice did:
// it moved to a MONTHLY credit quota that nothing in this codebase tracks. A run that exhausts the
// month's credits in one afternoon fails just as hard as one that overspends dollars.
//
// So the rail keeps charging a nominal amount per search, sized so `DAILY_BUDGET_CENTS` ($5) bounds
// a tenant to a few hundred searches a day — comfortably inside a 1k/month free tier while still
// stopping a runaway loop. It over-counts real money on purpose; that is the same fail-safe
// direction as GOOGLE_SEARCH_CALL_USD above.
//
// **When you move to a PAID Tavily plan, replace this with the published per-call rate** — at that
// point it becomes a real price and the proxy reasoning no longer applies.
export const WEB_SEARCH_CALL_USD_TAVILY = 0.01;

/** Per-call web-search fee. `webResearch` is now a LOCAL Tavily tool (llm.ts) rather than a hosted
 *  per-vendor one, so the fee no longer varies by model — the model id is retained in the signature
 *  because every call site already passes it and a same-shaped function keeps the diff honest.
 *  The hosted rates above are kept for the revert path. */
export const searchFeeUsd = (_model: string): number => WEB_SEARCH_CALL_USD_TAVILY;

// Vercel AI Gateway per-MTok pricing, verified 2026-07-12.
// gpt-4.1-mini row added 2026-07-27 (16-02) — published OpenAI rate at the time of the probe.
//
// GEMINI ROWS PINNED 2026-08-07 — **UNVERIFIED AGAINST A LIVE PRICE PAGE.** They are pinned from
// published-rate knowledge, not a fetch, and they are deliberately rounded UP where uncertain.
// The direction matters and is not symmetric: an OVER-priced row draws the daily rail down faster
// than reality (fail-safe, the tenant is throttled early), while an UNDER-priced row silently
// under-draws — which is the exact failure the RESEARCH_MODEL comment above exists to prevent.
// **Verify against https://cloud.google.com/vertex-ai/generative-ai/pricing before any real spend
// and correct these two rows**; until then they are a safe over-estimate, not a source of truth.
// KEYED ON THE VENDOR CONSTANTS, NOT ON DEFAULT_MODEL/CHEAP_MODEL/RESEARCH_*. Those are now
// ALIASES of the Gemini ids, so keying the table on them would collapse five computed properties
// into two and SILENTLY DROP EVERY OPENAI ROW — leaving the fallback ids unpriced and billing $0,
// the precise failure this file's other comments exist to prevent. One row per real model id.
export const PRICING: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  // OpenAI — no longer the default, still priced so a revert or a fallback cannot bill $0.
  [OPENAI_DEFAULT_MODEL]: { inPerMTok: 0.15, outPerMTok: 0.6 },
  [OPENAI_CHEAP_MODEL]: { inPerMTok: 0.1, outPerMTok: 0.4 },
  [OPENAI_RESEARCH_FALLBACK_MODEL]: { inPerMTok: 0.4, outPerMTok: 1.6 },
  // Gemini via Vertex — the current pins.
  [GEMINI_MODEL]: { inPerMTok: 0.3, outPerMTok: 2.5 },
  [GEMINI_CHEAP_MODEL]: { inPerMTok: 0.1, outPerMTok: 0.4 },
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
