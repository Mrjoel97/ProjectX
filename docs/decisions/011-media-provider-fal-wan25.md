# ADR-011: Media generation goes to fal.ai on Wan 2.5 — a per-second USD price is the binding criterion, not model prestige

- **Status**: Accepted (2026-08-01 — Phase 20, MEDIA-01; owner decision)
- **Recorded**: 2026-08-01 (named before any adapter code exists, so the budget rail is designed against a known price rather than retrofitted)

## Context

Phase 20's original scope named "the connected Pikar-Ai MCP service" and "video (≤3 min)".
The mandated spike (`.planning/phases/20-media-canvas/20-SPIKE.md`) refuted both:

- The Pikar-Ai MCP is an **account-level OAuth connector on the claude.ai client**. It is absent
  from `.mcp.json` and a Convex action cannot reach it. There is no backend token-exchange to build.
- It is **white-labelled Higgsfield**, and its consumer pricing is **credit-denominated** with no
  published per-model cost.
- **No model generates 3 minutes.** Across 28 video models from eight independent labs the ceiling
  is **15 seconds**. This is a model limit, not a reseller limit.

A follow-up correction matters as much (`20-PROVIDER-EVAL.md` §1): the spike claimed the missing
price field *blocked* the capped-budget criterion. It does not. The shipped LLM rail never asks a
provider for a price either — `packages/cost/src/cost.ts` encodes a price **table** and
`chooseModel` does the pre-flight check, failing closed on `unknown_model`. What a media provider
must supply is therefore a **stable published per-generation USD price list**, so that same table
pattern is buildable and maintainable — not runtime pricing.

## Decision

**Provider: fal.ai. Default model: Wan 2.5 at ~$0.05 per second of video.** Replicate is the
recorded fallback, on price rather than fit.

Auth is a single Convex deployment secret (`FAL_KEY`). Jobs are submitted to fal's queue with a
`webhook_url`; the callback lands on `convex/http.ts`, which already hosts the Gmail OAuth callback.

## Why Wan 2.5 rather than a flagship

Cost per 15-second clip, against a `DAILY_BUDGET_CENTS` of **500 ($5/day for all LLM work)**:

| Model | Rate | 15 s clip | % of the whole daily text budget |
|---|---|---|---|
| **Wan 2.5 (chosen)** | ~$0.05/s | **~$0.75** | ~15% |
| Veo 3 | ~$0.40/s | ~$6.00 | **120% — one clip exceeds it** |
| Seedance 2.0 1080p+audio | ~$0.682/s | ~$10.23 | **205%** |

A single flagship clip costs more than an entire day of text. Wan 2.5 keeps one clip to roughly a
sixth of that, which is what makes a per-request cap a meaningful guard rather than a formality.
Choosing the cheap default first also mirrors `chooseModel`, which already tries `DEFAULT_MODEL`
then `CHEAP_MODEL` and returns `over_budget` if neither fits.

Wan is open-weight and stylised rather than photoreal-cinematic. For the cockpit's actual job —
social and marketing assets — that is an acceptable trade, and it is reversible: the price table is
per-model, so adding a premium model later is a table entry plus a deliberately raised cap, not a
re-architecture.

## Consequences

- **A media price table must exist in code**, modelled on `packages/cost`, and must fail closed on
  an unknown model. A media generation whose model is not in the table is refused, never guessed.
- **A separate named rate-limiter window** sits beside `dailySpendCents` (`guardrails.ts:23-28`),
  with its own kill-switch flag. Media spend is never folded into the token budget.
- **`budgetUsdPerRequest` (currently `0.05`) does not apply to media** — $0.05 would refuse every
  clip. Media needs its own per-request cap, deliberately chosen against the table above.
- **The table is hand-maintained and CAN drift** from real billing. This is the accepted ceiling.
  A reconciliation step (recorded spend vs the provider's actual invoice) ships with the phase, and
  the ceiling carries a `ponytail:` comment naming the upgrade path. Silent drift in a budget rail
  is the failure mode this consequence exists to prevent.
- **No OAuth machinery.** `gmailAuth.ts`'s refresh-token store, rotation and crown-jewel handling
  are NOT copied; an API key in a deployment secret is the whole auth story.
- **The webhook must be authenticated** (signature or secret path segment) or it is an
  unauthenticated write endpoint. Match whatever `http.ts` already does for the Gmail callback.
- **Video is ≤15 s.** Any longer artifact is assembly or re-cutting, which are different features
  and out of Phase 20's scope.
- Exact rates must be re-read from fal's live pricing page when the adapter is written; the figures
  here are indicative and sourced from third-party comparisons, not from the vendor API.

## Alternatives rejected

- **Higgsfield Cloud REST API** — a real server-to-server path, but credit-denominated with no
  published per-model cost and gated behind higher tiers. The price table would be sourced from
  marketing pages. Rejected on the binding criterion.
- **The Pikar-Ai MCP** — structurally unreachable from a Convex action. Not a choice.
- **Replicate** — clears every criterion but is 30–50% dearer. Recorded as the fallback.
- **A premium default (Veo 3 / Seedance)** — one clip exceeds the entire daily text budget. If a
  flagship is ever wanted it is a table entry behind a raised cap and an explicit owner decision,
  not a default.
