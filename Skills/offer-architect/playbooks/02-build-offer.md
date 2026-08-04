# Playbook 02 — Build the Offer (the 5-Step Core Process)

**Goal:** turn a committed niche into a stacked, value-dense offer that cannot be compared to anything else. This is the heart of the Grand Slam Offer.

**Inputs:**
- A committed niche + positioning statement (from `01-select-market.md`; Scorecard `identity`).
- References: `../references/value-equation.md`, `../references/pricing-virtuous-cycle.md`.
- Template: `../assets/offer-stack.template.md`.

**Artifact produced:** a filled **offer stack** (named bundles with dollar values → total value vs a premium price), recorded to the Scorecard `offer_card` and `identity.headline_price`.

---

## Step 1 — Identify the Dream Outcome
Sell the **destination, not the vehicle**. Name the concrete, status-laden result the buyer actually wants — e.g. "Lose 20 lbs in 6 weeks." Write it as one vivid sentence. This is the numerator's top term in the Value Equation.

## Step 2 — List every Problem (exhaustively)
Walk the customer's journey in **insane detail**: think about what happens **immediately before and after** they use the product, every core action they must take, and every reason they can't or won't succeed. List them all.

Then **map each problem to one of the four value drivers**:
1. **Dream Outcome** — "it's not financially worth it" (the payoff feels too small).
2. **Likelihood** — "it won't work for me / external factors will stop me."
3. **Effort & Sacrifice** — "it's too hard / confusing; I'll suck at it."
4. **Time** — "it takes too long / it's not convenient."

Every problem you find is future value you can create.

## Step 3 — Solutions List ("How to" reversal)
Reverse **each** problem into a solution. Copywriting shortcut: prepend **"How to"** and state the reversed problem (problem "I don't have time to cook" → solution "How to eat healthy in under 10 minutes a day"). **Solve every problem** — no gaps.

## Step 4 — Create Delivery Vehicles ("The How")
For each solution, brainstorm **every possible way to deliver it**, then vary attributes using the **6 Product Delivery Cheat Codes**:
1. **Personal attention** — 1:1 / small group / one-to-many.
2. **Effort expected** — DIY / Done-With-You / Done-For-You.
3. **If live** — in-person / phone / email / text / Zoom / chat.
4. **If recorded** — audio / video / written.
5. **Speed of response** — days vs hours; 24/7, within 5 min / 1 hr / 24 hr.
6. **The 10x-to-1/10th test** — if they paid **10x**, what would you provide? If they paid **1/10th** but it had to be **more** valuable, how would you deliver it?

## Step 5a — Trim
Score each delivery vehicle on two axes: **cost-to-you** vs **value-to-client** (use the four Value Equation questions to judge value).

| | Low value | High value |
|---|---|---|
| **Low cost** | drop last | **KEEP** |
| **High cost** | **DROP FIRST** | keep |

Remove **high-cost/low-value first**, then **low-cost/low-value**. Keep low-cost/high-value and high-cost/high-value. **Bias toward high-value one-to-many** deliverables — they have the biggest cost-to-value gap.

## Step 5b — Stack
Bundle the survivors. For **each** surviving element, present it as a row:

**Problem → Solution wording → sexier Named Bundle → list delivery vehicles → ascribe a dollar value.**

Then **sum the values to a large total and reveal a much lower price.** Use the builder:
```
python ../scripts/offer_stack_builder.py --price 599 \
    --item "Named Bundle A:1000" --item "Named Bundle B:351" --item "Named Bundle C:3000"
```
(Book example: items summing to **$4,351** offered for **$599** → 7.26x value.)

The finished bundle must: (1) **solve ALL the problems**, (2) give **you** conviction it's genuinely one-of-a-kind, (3) be **impossible to compare** to any competitor.

**Sales-to-fulfillment check:** more inclusions = easier to sell but harder to deliver. Aim for the sweet spot that **sells well AND is easy to fulfill.** Mantra: *"Create flow. Monetize flow. Then add friction."*

---

## Record to the Scorecard
```
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path offer_card.value_equation.dream_outcome --value '"Lose 20 lbs in 6 weeks"'
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path identity.headline_price --value 599
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path identity.current_offers --value '["<stack name>"]'
python ../growth-os/scripts/scorecard.py log --scorecard <path> --entry '{"skill":"offer-architect","playbook":"02-build-offer","total_value":4351,"price":599,"value_ratio":7.26}'
```
Optionally score the offer's Value Equation to find the weak driver before enhancing:
```
python ../scripts/value_equation_scorer.py --dream 9 --likelihood 8 --time 3 --effort 2
```

**Exit check:** a filled offer stack (use `../assets/offer-stack.template.md`) with total value ≫ price. Proceed to `03-enhance-offer.md`.

## Attribution
Frameworks derived from Alex Hormozi's *$100M Offers*. Methods encoded as executable procedures; book text not reproduced.
