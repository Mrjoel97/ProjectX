---
phase: 20
name: media-canvas
type: provider-evaluation
status: DECIDED — fal.ai + Wan 2.5, owner decision 2026-08-01, pinned in ADR-011
requirements: [MEDIA-01]
researched: 2026-08-01
supersedes_claim: "20-SPIKE.md said SC #3 was BLOCKED. That was overstated — see §1."
---

# Phase 20 — provider evaluation

Follow-up to `20-SPIKE.md`. The spike refuted the original scope; this picks the replacement.

---

## 1. Correction to the spike: SC #3 was never blocked

`20-SPIKE.md` concluded that because the Higgsfield/Pikar-Ai MCP exposes no cost field, a
pre-flight budget cap was impossible and SC #3 would have to degrade to post-hoc reconciliation.
**That was wrong, and the repo itself is the counter-example.**

The shipped LLM budget rail does not ask any provider for a price. OpenAI does not return one.
`packages/cost/src/cost.ts` encodes a **price table in code**, and `chooseModel` does the
pre-flight work:

```ts
export function chooseModel(safeText, budgetUsdPerRequest): Result<{model, estCents}, CostError> {
  const tokensIn = estimateTokens(safeText);
  for (const model of [DEFAULT_MODEL, CHEAP_MODEL]) {
    const est = estimateCostUsd(model, tokensIn, EXPECTED_OUTPUT_TOKENS);
    if (!est.ok) return est;                       // unknown_model -> FAIL CLOSED
    if (budgetOk && est.value <= budgetUsdPerRequest) return ok({ model, estCents: … });
  }
  return err({ code: "over_budget" });
}
```

So the requirement on a media provider is **not** "returns a price at call time". It is
**"publishes a stable per-generation USD price list"**, so the same table pattern can be built and
maintained. That reframing is what §3 scores providers on.

The narrower, real objection to Higgsfield stands: its prices are denominated in **credits** whose
USD value depends on plan and pack, and the MCP publishes no per-model credit cost at all — so the
table would be hand-sourced from marketing pages and could drift silently inside a budget rail.

## 2. What the media rail actually has to do

Mapped onto machinery that already exists, so this is assembly rather than invention:

| Need | Existing pattern to reuse |
|---|---|
| Pre-flight per-request cap | `chooseModel` + `budgetUsdPerRequest` (`guardrails.ts` `DEFAULT_CONFIG`) |
| Price table, fail-closed on unknown model | `packages/cost` `estimateCostUsd` / `unknown_model` |
| Separate daily cap | a second **named** rate-limiter window beside `dailySpendCents` (`guardrails.ts:23-28`) — the component already supports named windows, so this is a config line |
| Own kill switch | the `guardrailConfig` single-row upsert pattern (`setKillSwitch`) |
| Record actual spend | `recordSpend`'s `reserve: true` semantics (drives the window negative rather than under-counting) |
| Async job + callback | `convex/http.ts` already hosts the Gmail OAuth callback route |
| Plan-gated side effect | the `externalAction` arm behind the Approve gate |

**No new subsystem.** A price table, a named window, a kill-switch flag, an adapter action, and a
webhook route.

## 3. Provider comparison

| | Pikar-Ai MCP | Higgsfield Cloud API | **fal.ai** | Replicate | Runware |
|---|---|---|---|---|---|
| Reachable from a Convex action | ❌ client-side OAuth only | ✅ | ✅ | ✅ | ✅ |
| Auth | account OAuth connector | API key (header) | API key (`FAL_KEY`) | API token | API key |
| **Published per-generation USD** | ❌ credits, per-model cost unpublished | ❌ credits | ✅ per-second | ✅ per-second | ✅ per-second |
| Async queue + webhook callback | n/a | unverified | ✅ documented webhooks | ✅ | ✅ |
| Model coverage | Kling, Veo, Seedance, Wan, MiniMax, Grok | same | same + ~600 | ~200 | large |
| Commercial gate | free tier = 0 credits | higher tiers only | pay-as-you-go | pay-as-you-go | pay-as-you-go |

**Recommendation: fal.ai, with Replicate as the fallback.** It is the only candidate that clears
every criterion, and three properties matter beyond price:

1. **`FAL_KEY` is a plain env var** → one Convex deployment secret. The `gmailAuth.ts`
   refresh-token store, its rotation and its crown-jewel handling are **not** needed. Materially
   less code than the OAuth path the roadmap originally implied.
2. **Documented webhooks** — `webhook_url` on submit, fal POSTs the result. `convex/http.ts`
   already hosts a callback route for Gmail OAuth, so SC #2's async requirement lands on an
   established seam instead of a polling loop.
3. Its own docs say to keep the key server-side behind a proxy, which is exactly a Convex action.

Replicate is the fallback purely on price (30-50% dearer) — not on fit.

## 4. The finding that should change the budget design

Indicative fal.ai rates, and what a **single 15-second clip** costs:

| Model | Rate | 15 s clip |
|---|---|---|
| Wan 2.5 | $0.05/s | **$0.75** |
| Veo 3 | $0.40/s | **$6.00** |
| Seedance 2.0, 1080p + audio | $0.682/s | **$10.23** |

`DAILY_BUDGET_CENTS = 500` — the entire LLM budget is **$5/day**.

> **One 15-second Veo 3 clip costs more than the whole daily LLM budget. A single Seedance 1080p
> clip costs twice that.** This is the concrete reason SC #3 insists the media line be separate,
> and it means the **per-request** cap matters far more here than it does for text: an LLM
> overshoot is cents, a media overshoot is dollars. `budgetUsdPerRequest` is currently `0.05` —
> media needs its own, deliberately chosen, and a default model at the cheap end of that table.

## 5. Open questions for implementation (not blockers)

1. **Moderation verdict ref** (SC #4) — confirm fal returns a moderation/safety signal, or decide
   what the audited "verdict ref" is when the provider gives none. Do not invent a verdict.
2. **Webhook authenticity** — the callback must be verified (signature or a secret path segment),
   or it is an unauthenticated write endpoint. Check how `http.ts` guards the Gmail callback and
   match it.
3. **Price-table drift** (roadmap SC #5) — decide the reconciliation cadence and where the
   `ponytail:` ceiling comment lives.
4. Exact per-model rates must be re-read from fal's live pricing page at implementation time; the
   figures in §4 are indicative and sourced from comparison write-ups, not from the vendor API.

## Sources

- [AI image & video API pricing comparison, 2026](https://www.teamday.ai/blog/ai-api-pricing-comparison-2026)
- [Best AI inference platforms 2026 — Replicate vs fal.ai vs Runware](https://apidog.com/blog/best-ai-inference-platform-guide-2026/)
- [FAL vs Replicate vs OpenAI — image & video APIs](https://www.teamday.ai/blog/ai-image-video-api-providers-comparison-2026)
- [fal.ai alternatives by per-second cost](https://ofox.ai/blog/fal-ai-alternatives-video-generation-api-2026/)
- [fal webhooks documentation](https://docs.fal.ai/model-apis/model-endpoints/webhooks)
- [Higgsfield client SDK](https://github.com/higgsfield-ai/higgsfield-client)
