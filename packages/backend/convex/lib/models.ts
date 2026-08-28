/**
 * THE ONE MODEL ROUTE TABLE. A pricing/audit model id in, a `LanguageModel` out.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
 *
 * It was SEVEN copies of `const resolveModel = (id) => openai(id.replace(/^openai\//, ""))` — in
 * `llm.ts`, `blueprint.ts`, `onboarding.ts`, `vaultDigest.ts`, `vaultLlm.ts`, `voiceDoc.ts` and
 * (newest) `knowledgeLlm.ts` — and only `llm.ts`'s ever grew the `or/` branch. `@pikar/cost`'s
 * `DEFAULT_MODEL` is `"or/openai/gpt-4o-mini"`, so every stale copy handed an OPENROUTER ROUTE id
 * straight to the OpenAI provider, which is a different endpoint with a different key:
 * `"or/openai/gpt-4o-mini".replace(/^openai\//,"")` is unchanged, so the request went out with a
 * model OpenAI has never heard of. The failure is silent where the caller catches (a planner
 * degrades to its fallback on EVERY production run, for ever) and a throw where it does not.
 * Nothing pinned the copies together, and every test drives the offline `SMOKE::` seam, so no test
 * could see it.
 *
 * ALL SEVEN ARE NOW CONVERTED (the last five on 2026-08-28: business-blueprint derivation,
 * onboarding extraction + the conversational turn, folder digests, the graph extractor / document
 * classifier, and the voice-doc reviewer — every one of them live, and every one of them naming a
 * model OpenAI does not know on every real call). `lib/models.test.ts` pins the END STATE: its
 * allow-list is EMPTY, so a new module that resolves a model without importing this table is red,
 * and so is a naive `openai(id.replace(...))` written anywhere under `convex/` — including inside a
 * module that also imports this one.
 *
 * ⚠ A CONSEQUENCE WORTH KNOWING BEFORE YOU TOUCH A CALLER: converting a module moves the credential
 * it actually spends from `OPENAI_API_KEY` to `OPENROUTER_API_KEY`. Any guard phrased as "this
 * deployment has no model key" must check BOTH — see `offlineSeamAvailable` BELOW IN THIS FILE
 * (`voiceDoc.ts` consumes it and defines it zero times; 96c4700 moved it here, and this line went
 * on pointing at the old home).
 *
 * ── WHY IT IS NOT SIMPLY EXPORTED FROM llm.ts ─────────────────────────────────────────────────
 *
 * `llm.ts` is `"use node"`. The knowledge plane, `blueprint.ts` and `vaultDigest.ts` run in the
 * DEFAULT (V8) runtime, and a V8 module cannot import a Node one. This module is deliberately
 * V8-SAFE: `@ai-sdk/openai` and `@openrouter/ai-sdk-provider` only.
 *
 * ── THE ONE BRANCH THAT IS NOT HERE ───────────────────────────────────────────────────────────
 *
 * `google/` stays in `llm.ts`, because `@ai-sdk/google-vertex` pulls `google-auth-library` and is
 * Node-only — importing it here would drag the Node runtime into every V8 caller. `llm.ts` handles
 * that prefix and delegates everything else to `resolveModel`, so the three prefixes the V8 plane
 * can reach have exactly one implementation. `resolveModel` FAILS CLOSED on `google/` rather than
 * silently routing it to OpenAI, which is the mistake this file exists to end.
 */
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { isOfflineFixtureConsent } from "./env";

// OpenRouter, through its OWN provider — and the second SDK is EARNED, not a convenience.
//
// This started as a baseURL swap on @ai-sdk/openai, on the reasoning that OpenRouter is
// OpenAI-wire-compatible. It is, for the request body. It is NOT for the two things ox-alpha needs:
//   1. `reasoningEffort` was SILENTLY DROPPED. @ai-sdk/openai gates that parameter on its own
//      model-capability table, which has never heard of `stealth/ox-alpha`, so it emitted a console
//      warning and sent nothing. Verified on the wire with a spying `fetch`.
//   2. `reasoning_details` is not round-tripped. OpenRouter requires the assistant message's
//      `reasoning_details` to be passed back UNMODIFIED for the model to continue a reasoning chain
//      across turns. Every step of a tool loop re-sends the transcript, so without it a
//      reasoning-MANDATORY model re-reasons from scratch on every step — which is the leading
//      explanation for both the 113-164 s pack runs and the empty replies at 180 s.
// This provider does both. That is what a new dependency has to buy to be worth it.
//
// Lazy + memoised: a module-load factory would throw on a deployment that has no OpenRouter key
// but never routes here.
let openRouterProvider: ReturnType<typeof createOpenRouter> | undefined;
const openRouter = () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  openRouterProvider ??= createOpenRouter({ apiKey });
  return openRouterProvider;
};

/**
 * Model-level settings for ox-alpha. **EMPTY ON PURPOSE, AND THE MEASUREMENTS ARE WHY.**
 *
 * Reasoning is MANDATORY on this model: `reasoning: {enabled: false}` returns HTTP 400 "Reasoning is
 * mandatory for this endpoint and cannot be disabled". `effort` is the only dial, and this provider
 * genuinely delivers it — verified on the wire, and the probe's output fell from ~16-20 tokens to 3.
 * On an isolated call it is dramatic: default 6556 ms / 105 output tokens, `effort: low` 2488 ms / 55.
 *
 * **IT IS STILL NOT SET, BECAUSE THE PACK EVIDENCE DOES NOT SUPPORT SETTING IT.** Single runs of
 * `customer-complaint` scored: low 1/5, medium 2/5, default 0/5 — and then a REPEAT of the default
 * config scored 1/5, with individual cases changing which way they failed (case 03 failed on wording
 * in one run and on dropped tool calls in the next; case 05 failed then passed). **Run-to-run
 * variance is at least +/-1 case, so all three settings sit inside the noise.** Reading that spread
 * as a gradient would be inventing a finding.
 *
 * WHAT WOULD SETTLE IT: repeats, not another single run. The upstream DeepSWE harness used `-k 3`
 * for exactly this reason — ox-alpha's tool-call behaviour is stochastic, so one number per config
 * measures the dice. Until a repeated experiment exists, the default is the honest setting.
 *
 * NOTE THE TRADE THE MEASUREMENTS HINT AT (unproven): less reasoning is faster and cheaper, and the
 * pilot's headline assertion — the honest-partial statement — is precisely the kind of output that a
 * shorter answer drops first. If the dial is ever adopted, re-run the `missingNamed` cases, not the
 * latency.
 *
 * ponytail: an empty object rather than a deleted parameter — the seam is the finding, and the next
 * person needs somewhere obvious to put the answer.
 */
const OX_ALPHA_SETTINGS = {} as const;

/** The prefix every caller must handle for itself, because its provider is Node-only. */
export const NODE_ONLY_MODEL_PREFIX = "google/";

/**
 * THE OFFLINE-SEAM OPERATOR SIGNAL — a POSITIVE opt-in, AND-ed with the precondition it claims.
 *
 * Every offline fixture in this repo used to be selected by an IN-BAND `SMOKE::` SENTINEL IN
 * CONTENT — and content is authored by whoever authored the document. `vaultDigest.ts` gated on the
 * assembled prompt (so any ingested Drive file or email could turn a real folder's digest into a
 * fixture), then on the folder NAME — which reads as tenant-chosen but is a CLIENT-SUPPLIED
 * argument to `vaultDrive.importDriveFolder`, populated by the browser from `listDriveFolders`,
 * which lists SHARED folders whose names a THIRD PARTY chose. Same channel, one hop further away.
 *
 * ⚠ THE FIRST REPLACEMENT WAS `!OPENAI_API_KEY && !OPENROUTER_API_KEY` ALONE, AND THAT TRADED ONE
 * DEFECT FOR A WORSE ONE. It closed the attacker-triggered fabrication and opened an UNCONDITIONAL
 * one: a production deployment that loses (or never sets, or blanks — `convex env set X ""`) both
 * model keys would have silently fabricated a digest for every completed folder and suppressed its
 * own failure, because a fixture RETURNS where the previous gate THREW at `openRouter()`. Blast
 * radius: every folder on the deployment, with no error anywhere. Absence of a credential is a
 * MISCONFIGURATION, not consent — so it can no longer, by itself, choose the fixture path.
 *
 * `PIKAR_OFFLINE_FIXTURES=1` is the consent: an operator stating that THIS deployment is running
 * offline fixtures on purpose. It is classified `tier: "fixture"` in `lib/env.ts`, so `missingEnv`
 * reports it under `fixturesActive` and the readiness screen says out loud that a fabrication seam
 * is live (the `FAL_FIXTURE` precedent — same tier, same reason).
 *
 * ⚠ THE VALUE TEST IS `lib/env.ts`'s `isOfflineFixtureConsent`, AND IT IS SHARED ON PURPOSE. This
 * predicate and the readiness screen briefly answered the same question with two different rules
 * (`=== "1"` here, "non-blank" there), so `PIKAR_OFFLINE_FIXTURES=on` reported a LIVE fabrication
 * seam on a deployment whose fixture was off. One question, one predicate; `lib/models.test.ts`
 * runs a table of literal values through both sites and fails if they ever diverge again.
 *
 * The credential half is KEPT as well, so the two failure directions are both covered: a keyed
 * deployment that sets the flag by accident still takes the real model path. BOTH keys, never just
 * `OPENAI_API_KEY`: `DEFAULT_MODEL` is `or/openai/gpt-4o-mini` and `resolveModel` routes it to
 * OpenRouter, so `OPENROUTER_API_KEY` is the credential the caller would actually spend.
 *
 * WHAT A CALLER MUST DO WHEN THIS IS FALSE AND THERE IS NO KEY: nothing special — call the model.
 * `resolveModel(DEFAULT_MODEL)` reaches `openRouter()`, which throws `OPENROUTER_API_KEY is not
 * set`. Loud, and the caller's dead-letter/retry path sees it. Do not add a keyless fallback.
 *
 * ⚠ NOT EVERY `SMOKE::` SEAM IS CLOSED. `vaultLlm.extractGraph` / `identifyDoc`, `vaultRag.embedDoc`
 * and `gmail.ts`'s tool-argument gate still select on content, and they are coupled to each other
 * and to a landed Playwright E2E that drives the sentinels against a REAL KEYED deployment — so
 * they cannot be converted one at a time. See
 * `.planning/phases/29-unified-knowledge-and-routines/29-SMOKE-SEAM-DEBT.md`.
 */
export const offlineSeamAvailable = (): boolean =>
  // The LITERAL "1", not merely "set": `convex env set PIKAR_OFFLINE_FIXTURES ""` and a leftover
  // `PIKAR_OFFLINE_FIXTURES=0` are both the operator saying NO, and a `!== undefined` check reads
  // them as yes. Same class of mistake as the one this whole predicate exists to fix. The rule
  // lives in `lib/env.ts` so the readiness screen cannot answer it differently; the READ stays a
  // literal `process.env.X` here, because `env.test.ts`'s dead-entry scan only sees literal reads.
  isOfflineFixtureConsent(process.env.PIKAR_OFFLINE_FIXTURES) &&
  !process.env.OPENAI_API_KEY &&
  !process.env.OPENROUTER_API_KEY;

export const resolveModel = (id: string): LanguageModel => {
  // `.chat(...)`, NOT the bare callable — MEASURED 2026-08-25 and this is the load-bearing half.
  // The bare provider defaults to OpenAI's RESPONSES API, and two things went wrong there, both
  // silently: the request went to /responses instead of /chat/completions, and @ai-sdk/openai
  // DROPPED `reasoningEffort` on the floor with only a console warning ("not supported for
  // non-reasoning models") because it gates that parameter on its own model-capability table, which
  // has never heard of `stealth/ox-alpha`. Observed on the wire: reasoning_effort=undefined via
  // /responses, reasoning_effort="low" via /chat/completions, and the model honours it — output
  // tokens fell 235 -> 44 on the same prompt. A dial that is silently discarded is worse than no
  // dial: the first attempt at this looked applied and changed nothing.
  if (id.startsWith("stealth/")) return openRouter().chat(id, OX_ALPHA_SETTINGS);
  // OpenRouter-routed vendor models. The `or/` prefix is the ROUTE and is stripped here; the full id
  // stays the PRICING/audit key, so `or/openai/gpt-4o-mini` and `openai/gpt-4o-mini` price and audit
  // as the different billing paths they are. No per-model settings: unlike ox-alpha these are not
  // reasoning-mandatory, and the 45 s lane is the one place reasoning has actually cost us runs.
  if (id.startsWith("or/")) return openRouter().chat(id.slice(3));
  // FAIL CLOSED. Routing a `google/` id to `openai()` is precisely the silent misroute this module
  // was created to stop; a caller that can reach Vertex handles the prefix before calling here.
  if (id.startsWith(NODE_ONLY_MODEL_PREFIX))
    throw new Error(`resolveModel: ${NODE_ONLY_MODEL_PREFIX} needs the Node runtime`);
  return openai(id.replace(/^openai\//, ""));
};
