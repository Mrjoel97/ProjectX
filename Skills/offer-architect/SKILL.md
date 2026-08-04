---
name: offer-architect
description: Use when an offer isn't selling, feels like a commodity or "the same as everyone else", competes only on price, draws constant price objections or "it's too expensive", converts poorly, has weak or no perceived value, or when the user is building, launching, pricing, repricing, naming, or renaming an offer, adding a guarantee, bonuses, scarcity or urgency, bundling a package, or wants to raise prices without losing sales — build a Grand Slam Offer.
---

# Offer Architect — build a Grand Slam Offer

## Overview
Turns a plain product into a **Grand Slam Offer**: an offer that "cannot be compared to any other product or service available" — it sells in a **category of one**. The mechanical payoff is three things at once: higher **response rates**, higher **conversion**, and **premium prices**. This skill is the offer specialist that `growth-os` routes to when the constraint is a **weak offer** (commodity, price-driven, low perceived value).

Component checklist of a Grand Slam Offer: attractive promotion + unmatchable value proposition + premium price + unbeatable guarantee + a money model (payment terms). This skill builds the first four; the money model is `money-model-designer`'s job.

## When to use
- The offer isn't selling, feels like a commodity, or competes only on price.
- Constant price objections, low conversion, or "my perceived value is too low."
- Building, pricing, bundling, naming, or renaming an offer; adding a guarantee/bonuses/scarcity/urgency.
- `growth-os` diagnosed the constraint as a **weak offer** — but first pass the `Market > Offer > Persuasion` gate (playbook 01). If the **market** is bad, no offer work will pay off; fix that first.

## The build sequence
```
01 SELECT MARKET   4 indicators + Market>Offer>Persuasion gate + niche  -> committed niche
02 BUILD OFFER     Dream -> Problems(4 drivers) -> Solutions -> Delivery -> Trim -> Stack
03 ENHANCE         Scarcity -> Urgency -> Bonuses -> Guarantee (with teeth)
04 NAME            M-A-G-I-C (3-5) + fatigue-variation backlog
```
Everything runs through the **Value Equation**: `(Dream Outcome x Likelihood) / (Time Delay x Effort & Sacrifice)`. Increase the top, drive the bottom toward zero.

## Which playbook do I need? (mini-diagnostic)
| Symptom / request | Start at |
|---|---|
| Commodity, race-to-bottom, unsure who to sell to, "who's my market?" | **01-select-market** |
| Have a market but no compelling offer; price feels arbitrary; "what do I actually sell?" | **02-build-offer** |
| Offer exists but converts weakly; no guarantee; no reason to buy *now* | **03-enhance-offer** |
| Offer is solid but the name is flat / clicks are low / offer has gone stale | **04-name-offer** |
| "Should I raise prices?" | `references/pricing-virtuous-cycle.md`, then **02/03** to add the value that justifies it |

If you don't know where the offer is weakest, run `scripts/value_equation_scorer.py` on it first — the weakest driver tells you which lever (and playbook) to pull.

## How to run it
1. **Confirm the gate.** Skim `references/market-selection.md`. If the market may be bad or undefined, run **playbook 01** before anything else.
2. **Work the playbooks in order** (01→04), unless the mini-diagnostic sends you straight to one. Each states its inputs, reproduces the exact steps, and ends by producing a concrete artifact.
3. **Fill the canvas** as you go: `assets/grand-slam-offer.canvas.md` (and `assets/offer-stack.template.md` for step 5b).
4. **Use the scripts** to make it quantitative: value-equation scoring, guarantee refund math, stack totals.
5. **Record everything to the Business Scorecard** via `python ../growth-os/scripts/scorecard.py set/log` (fields: `identity.*`, `offer_card.*`). Each playbook lists the exact commands. This is how `growth-os` re-diagnoses the next constraint.

## Files
- `references/value-equation.md` — the core engine: 4 drivers, the division rule, the diagnostic questions, the comparison rule.
- `references/market-selection.md` — 4 indicators, 3 eternal markets, `Market > Offer > Persuasion`, niche price multiplier, positioning statement.
- `references/pricing-virtuous-cycle.md` — price-to-value discrepancy, the virtuous cycle, charge ≫ cost, the broke-pricing anti-pattern.
- `references/enhancement-layers.md` — Scarcity (3 types/3 caps/honest), Urgency (4 methods), Bonuses (11-point), Guarantees (4 types, teeth, refund math, menu), Dance of Desire + Hormozi's Law.
- `references/magic-naming.md` — M-A-G-I-C (use 3–5), examples, the 7-step fatigue-variation order.
- `playbooks/01-select-market.md` … `04-name-offer.md` — the numbered build process; each ends in a Scorecard write.
- `scripts/value_equation_scorer.py` — score the 4 drivers 1-10, compute the value index, flag the weakest lever. `--help`.
- `scripts/guarantee_refund_calc.py` — net-sales refund math; the 95→117 = 1.23x example. `--help`.
- `scripts/offer_stack_builder.py` — sum named bundles vs price; the $4,351/$599 example. `--stdin`, `--help`.
- `assets/grand-slam-offer.canvas.md` — the full fill-in canvas for one offer.
- `assets/offer-stack.template.md` — the stack table template.

## Financial link (do not redefine here)
Premium pricing and stacking raise **LTGP**, which lifts the `LTGP:CAC` health ratio. LTGP, CAC, and 30-day cash are defined once in `../growth-os/references/financial-spine.md` — defer to that file; this skill never redefines them.

## Attribution
Frameworks derived from Alex Hormozi's *$100M Offers*. Methods encoded as executable procedures; book text not reproduced.
