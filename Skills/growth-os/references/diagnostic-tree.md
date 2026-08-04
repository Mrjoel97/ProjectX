# Diagnostic Tree — diagnose and route

The job: find the **one** constraint costing the most money right now, and route to the single skill that fixes it. Work top-down; stop at the first gate that fails. `scripts/diagnose.py` implements this; this file is the reasoning so you can explain the prescription.

## Gate 0 — Market (from Offers: `Market > Offer > Persuasion`)
Before anything, the market must be viable. Rate the market on the 4 indicators:
1. **Massive pain** — do they desperately need it? (pain ∝ price you can charge)
2. **Purchasing power** — can they pay?
3. **Easy to target** — do they gather in findable places?
4. **Growing** — is it a tailwind, not shrinking?

If the market is **bad** (shrinking, no pain, no money): no skill fixes this — the prescription is to **change market/niche first**. A great offer to the wrong crowd falls on deaf ears. Route: offer-architect → `01-select-market`.

## Gate 1 — Offer (is there a differentiated thing to sell?)
Symptoms of a weak offer:
- No offer, or a commodity ("customers say we're all the same, they buy the cheapest").
- Perceived value <= price (people hesitate, grind on price, don't buy).
- Value-equation scores low on any driver (weak dream outcome, low believability, slow, high effort).

If yes → **offer-architect**. Nothing downstream matters without an offer worth buying. Pick the playbook by what's missing: no offer/commodity → `02-build-offer`; offer exists but weak conversion → `03-enhance-offer`; fine offer, poor response → `04-name-offer`.

## Gate 2 — Money Model (does the business get paid fast enough to grow?)
Only reached once a real offer exists. Symptoms:
- Getting customers but **broke** / cash-starved.
- 30-day payback **fails** (cost to get+service a customer not recovered in 30 days).
- `LTGP:CAC` is healthy on paper but cash arrives too slowly (trapped-cash / CFA problem).
- `LTGP:CAC < 3` because **LTGP is low** (not because CAC is high).
- Only one thing to sell (no upsell/downsell/continuity).

If yes → **money-model-designer**. Pick playbook: no monetization sequence → `01-assess-money-model` then `06-assemble`; missing a specific type → `02-attraction` / `03-upsell` / `04-downsell` / `05-continuity`.

## Gate 3 — Leads (do enough people know?)
Reached once offer + money model are sound. Symptoms:
- Good offer and money model but **too few people know about it**.
- Not enough top-of-funnel volume.
- `CAC > 3x` industry average → advertising is **inefficient** (an advertising problem, not a model problem).

If yes → **lead-engine**. Pick playbook by resource: more time than money → `03-post-content` or `02-warm-outreach`; more money than time → `05-paid-ads` or `04-cold-outreach`; no lead magnet → `06-lead-magnet`; already advertising but plateaued → `11-more-better-new` (find the funnel constraint, test one thing per week).

## The sales-vs-advertising check (from Leads)
If qualified leads arrive but don't buy, it is a **sales/offer** problem, not a lead problem — do **not** route to lead-engine. Ask: "Do the engaged leads have the problem we solve AND the money to spend?"
- No → not qualified → advertising/targeting problem → lead-engine.
- Yes, but not buying → offer/sales problem → offer-architect.

## Tie-breaker order
When multiple gates look open, fix in dependency order: **Market → Offer → Money Model → Leads.** You cannot out-advertise a bad offer, and you cannot scale ads without a money model that funds them.

## Output of a diagnosis
Always produce: (1) the constraint in one sentence, (2) the roadmap level, (3) the prescribed skill + playbook, (4) the reason, (5) the metric that will prove it worked. Record all five in the Scorecard `history[]`.
