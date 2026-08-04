---
name: money-model-designer
description: Use when a business can't afford ads or paid acquisition, is cash-strapped or broke despite having customers, makes only a one-time sale with no upsell/downsell/continuity, has low or trapped 30-day cash, fails the 30-day payback, or when someone asks "how do I make more per customer", wants to get paid to acquire customers, or is designing pricing, payment plans/terms, subscriptions, memberships, continuity, giveaways, free trials, bonuses, or an offer sequence.
---

# Money Model Designer

## Overview
A **Money Model is a deliberate sequence of offers** — what you offer, when, and how, to
make as much money as fast as possible. This skill sequences four offer types so a
customer produces more 30-day profit than it costs to **get and service** them — so the
business gets **paid to get customers** and can scale on interest-free 30-day float.

Terminology note: this material says "cost to get and service," "30-day cash/profit," and
"getting paid to get customers." The canonical metric definitions (30-day cash, the
payback/CFA test) live in `../growth-os/references/financial-spine.md` — this skill uses
those and does not redefine them.

## The four offer types (the whole system)
| Type | Job | Stage |
|---|---|---|
| **Attraction** | strangers into customers | I — Get Cash |
| **Upsell** | spend more | II — Get More Cash |
| **Downsell** | say yes when they'd say no | II — Get More Cash |
| **Continuity** | keep buying | III — Get The Most Cash |

Sequence: `advertise -> attraction -> upsell -> downsell -> continuity`.

## Mini-diagnostic — which type is missing?
- Can't afford ads / nothing covers acquisition cost -> build **Attraction** (playbook 02)
- One-time sale only, nothing offered after the yes -> build **Upsell** (playbook 03)
- People say no and you have nothing else for them -> build **Downsell** (playbook 04)
- No recurring revenue, customers buy once and vanish -> build **Continuity** (playbook 05)
- Types exist but unsure they pay back / how to sequence -> **Assess** (01) then **Assemble** (06)

Start at playbook **01** if you don't know the gap; it runs the 30-day payback test and
names the missing type.

## Playbooks
1. `playbooks/01-assess-money-model.md` — inventory the 4 types, run the 30-day payback
   test, find the missing type. -> money-model gap report.
2. `playbooks/02-attraction.md` — choose + design 1 of the 5 attraction offers. -> specified attraction offer.
3. `playbooks/03-upsell.md` — choose + design 1 of the 4 upsells. -> specified upsell offer.
4. `playbooks/04-downsell.md` — choose + design a downsell (payment plan / trial / feature). -> specified downsell offer.
5. `playbooks/05-continuity.md` — choose + design a continuity offer (bonus / discount / waived-fee) using the pricing table. -> specified continuity offer.
6. `playbooks/06-assemble.md` — sequence offers into Stages I-III + raise-price roadmap. -> filled money-model canvas.

## References (load on demand)
- `references/money-model-definition.md` — definition, 3 success tiers, 30-day payback rule, 3 stages, evolution order, 7 governing rules, compounding lever (2x->8x, 3x->27x).
- `references/four-offer-types.md` — the taxonomy, jobs, stacking logic, sequencing.
- `references/attraction-offers.md` — the 5 attraction offers + sub-tactics + decision rules.
- `references/upsell-offers.md` — Classic / Menu (+Economist) / Anchor / Rollover + universal tactics.
- `references/downsell-offers.md` — 6 rules; Payment Plan / Trial With Penalty / Feature Downsell.
- `references/continuity-offers.md` — Bonus / Discount / Waived Fee + the pricing tables.

## Scripts (Python 3, stdlib only; `--help`, JSON out, `--stdin`)
- `scripts/cfa_calculator.py` — 30-day cash of a full offer sequence vs cost to get + service; the cash multiple / success tier.
- `scripts/continuity_pricing.py` — the continuity-vs-standalone table (1.33x->2.66x monthly); solve standalone price for a target continuity %, or estimate % from a price.
- `scripts/money_model_simulator.py` — project 30-day cash and 12-month LTGP per 100 leads across all four offers.

## Assets
- `assets/money-model-canvas.md` — fill-in template: the 4 chosen offers, their sequence across Stages I-III, the 30-day cash target, and the raise-price roadmap.

## How this fits the loop
Every playbook ends by writing its artifact into the Business Scorecard `model_card`
(`offer_types_present`, `thirty_day_payback`, `continuity_take_pct`) via
`python ../growth-os/scripts/scorecard.py`, so growth-os can re-diagnose and pick the next move.

## Attribution
Frameworks derived from Alex Hormozi's *$100M Money Models* (part of the $100M series).
Methods encoded as executable procedures; book text not reproduced.
