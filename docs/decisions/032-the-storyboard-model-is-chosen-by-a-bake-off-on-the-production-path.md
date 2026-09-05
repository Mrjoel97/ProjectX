# ADR-032: The storyboard model is chosen by a bake-off on the production path

- **Status**: **Accepted** — 2026-09-05.
- **Supersedes**: nothing. The media-director turn had no recorded model decision: it fell
  through `runSpecialistTurn`'s skill-name lookup to `DEFAULT_MODEL`, which cost.ts itself calls
  the VOLUME pin. This ADR is the first decision about which model writes the storyboard.
- **Does NOT supersede**: [ADR-012](012-media-route-and-the-reel.md), [ADR-019](019-the-scene-timeline.md),
  [ADR-029](029-captions-move-to-openrouter-too-the-models-catalogue-is-not-the-api-surface.md).
- **Evidence**: `.planning/phases/33.2-*/33.2-BAKEOFF.md` (the rounds, the arithmetic), `33.2-PRD.md`
  L1-L9 (the rule, fixed before the run, and Amendment 1).

## Context

The storyboard turn is the most constraint-loaded single turn in the product — two whole
variations, exact second sums, per-cell narration windows, cited figures — and it was written by
the cheapest general model in the lane because nobody had chosen otherwise. The 2026-09-04 audit
measured 55 storyboards → 28 clean / 10 salvaged / 17 refused, but 17 of the 27 failures were one
parser bug, so the honest post-fix baseline was unknown. Moving the pin on a hunch was the thing
to avoid: a model pin is a bill and a behaviour, and both have been moved on noise before
(cost.ts's own `OX_ALPHA_SETTINGS` paragraph records a ±1-case spread swallowing three settings).

Three things the measurement itself surfaced, each a defect in its own right:

1. **The runner's first version asserted the PIN, not the model that answered.** An eligible
   primary failure rolls over to the fallback and the run succeeds; 37 passes across two
   candidates were written by `gpt-4.1-mini` and scored under other names. Only the spend rows
   (`spendEvents.correlationId`, `agentloop:<turnId>:`) said so.
2. **The rollover was silent in every plane.** Production storyboards had been falling back
   whenever the primary ran long, with no audit row, no ops signal, nothing on the plan.
3. **The clock was the binding constraint, not the models.** The media turn inherited the 45 s
   cockpit chat-turn clock; a two-variation deck is 3-4k output tokens after a vault search.

## Decision

**1. The storyboard model is a measured pin, and the measurement runs through production.**
`scripts/run-storyboard-bakeoff.mjs` drives `dispatch:runMedia` on seeded eval tenants — real
prompt assembly, real grants, real budget, real clock — and the production parser is the judge
(`smoke:storyboardFactsForPlan`, counts and codes only). No LLM judge, no offline replay, no
hand-scored transcripts. A model that scores well anywhere else and poorly here is poor here.

**2. The rule is fixed before the run, and it decides.** PRD L4: clean two-deck passes of 24;
tie-breaks salvages, refusals, cost; **any pass the clock cuts off disqualifies the candidate**;
**the pin moves only when the winner beats the baseline by ≥ 3 of 24.** The rule is written so
that a result inside the run-to-run spread (≈ ±2 on this corpus) cannot move a bill.

**3. The pin moves to `or/openai/gpt-4.1-mini`, the fallback to `or/openai/gpt-4o-mini`.**
18 vs 14 on the 90 s clock, every pass proven answered by the candidate. The fallback is the
measured baseline and not the primary's own id: a rollover must change the model, and
gpt-4o-mini finished inside 45 s on 24/24 — the fallback's job is to be fast. `cost.test.ts`
holds `MEDIA_MODEL ≠ DEFAULT_MODEL`, `MEDIA_MODEL ≠ MEDIA_FALLBACK_MODEL`, both priced.

**4. `claude-sonnet-5` and `gpt-5.6-sol` are disqualified, not rejected.** Both timed out on the
production path at 90 s (`llm.fallback` audit rows, `TimeoutError`). sonnet-5 reasons by default
on OpenRouter and the lane sets no reasoning effort; sol is slower than the clock at this output
size and 11× the winner's price. A fair measurement of either is a **lane change first** — a
per-model reasoning-effort setting (the `OX_ALPHA_SETTINGS` seam), and/or the deck turn
scheduled as its own action so the clock can grow past the one-action arithmetic — and then a
re-run under the same rule. Neither is done here; a candidate is measured on the lane as
shipped, or the number means nothing.

**5. The executed model is asserted, and the rollover is audited.** The runner aborts a round
whose spend rows name a model other than the candidate (exit 2). `runAgentLoop` writes
`llm.fallback` (`fromModel`, `toModel`, `errorName`, `stage`) before it retries — ids and an
error NAME, never the provider's message (§4). The media turn has its own clock,
`MEDIA_CALL_TIMEOUT_MS = 90 s`, sized by the 600 s-action arithmetic and not by wish.

## Consequences

- A storyboard costs ≈ $0.008 instead of $0.003 — under a cent, 2.6× the old bill. The expected
  clean rate rises from 14/24 to 18/24 on this corpus; salvages and refusals fall.
- Re-measuring is cheap and scripted: repoint `OR_MEDIA_MODEL`, let `convex dev` push, run the
  runner. Under $0.25 for a cheap candidate, ≈ $2 for a premium one. The rule does not change
  between runs; a new rule is a new ADR.
- The 12-second generated cap in the skill body is NOT parser-enforced and the corpus carries one
  deliberate-refusal brief (`45-illegal-duration`, ceiling 22 not 24). Both are recorded in the
  bake-off file for the next corpus; neither changes this ranking.
- Production: the pin reaches production with the next `[deploy]` promotion, and the production
  deployment's OpenRouter key belongs to the owner's OLD account; the local dev deployment moved
  to the new account's key on 2026-09-05. Both are owner actions.
