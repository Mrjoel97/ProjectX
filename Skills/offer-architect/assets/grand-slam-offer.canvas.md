# Grand Slam Offer Canvas

A single fill-in canvas for one complete offer. Work top to bottom; each section maps to a playbook. Copy this file and replace every `<...>`.

---

## 0. Market & Niche  — playbook 01
- **Eternal market** (Health / Wealth / Relationships): `<...>`
- **Market growth** (growing / normal — never shrinking): `<...>`
- **Four indicators** (great/normal/bad + one line of evidence each):
  - Massive Pain: `<...>`
  - Purchasing Power: `<...>`
  - Easy to Target: `<...>`
  - Growing: `<...>`
- **Committed niche:** `<...>`
- **Positioning statement:** "I solve `<problem>` for `<specific person>` in this unique, counter-intuitive way that reverses `<their deepest fear>`."

## 1. Dream Outcome  — playbook 02, step 1
> `<the destination, one vivid sentence — e.g. "Lose 20 lbs in 6 weeks">`

## 2. Problems → Solutions → Named Bundles  — playbook 02, steps 2–5
One row per surviving element. Driver = which of the 4 value drivers the problem attacks (Dream / Likelihood / Effort / Time).

| Problem (driver) | Solution ("How to…") | Named Bundle | Delivery vehicle(s) | Dollar value |
|---|---|---|---|---|
| `<problem>` (`<driver>`) | `<How to …>` | `<sexy name>` | `<1:1 / DFY / Zoom / recorded …>` | `$<...>` |
| `<problem>` (`<driver>`) | `<How to …>` | `<sexy name>` | `<...>` | `$<...>` |
| `<problem>` (`<driver>`) | `<How to …>` | `<sexy name>` | `<...>` | `$<...>` |

## 3. Delivery Vehicles used (6 Cheat Codes)  — playbook 02, step 4
- Personal attention: `<1:1 / small group / one-to-many>`
- Effort expected: `<DIY / DWY / DFY>`
- Live channel: `<in-person / phone / Zoom / …>`
- Recorded format: `<audio / video / written>`
- Speed of response: `<within 5 min / 1 hr / 24 hr…>`
- 10x / 1-10th insight: `<...>`

## 4. Enhancers  — playbook 03
- **Scarcity** (type + cap + honest-scarcity wording): `<...>`
- **Urgency** (which of the 4 methods + deadline wording): `<...>`
- **Bonuses** (each: benefit-driven name + $ value; total must eclipse core):
  - `<Bonus 1>` — `$<...>`
  - `<Bonus 2>` — `$<...>`

## 5. Guarantee  — playbook 03, step 4
- **Type(s):** `<Unconditional / Conditional / Anti / Implied (or a stack)>`
- **Named guarantee:** `<vivid name>`
- **With teeth:** "If you don't get `<X result>` in `<Y time>`, we will `<Z>`."
- **Refund math check** (guarantee_refund_calc.py multiplier): `<e.g. 1.23x>`

## 6. Name  — playbook 04
- **MAGIC components used (3–5):** `<M/A/G/I/C>`
- **Offer name:** `<...>`
- **Variation backlog (fatigue order):** creative → body copy → headline → seasonal → duration → enhancer → price

## 7. Value vs Price  — the discrepancy
- **Total stacked value:** `$<sum of all dollar values>`
- **Price:** `$<premium price>`
- **Value-to-price ratio:** `<total / price>x`  (from offer_stack_builder.py)

---

### Record to the Business Scorecard
Fill `identity.*` (market, niche, avatar, headline_price), `offer_card.value_equation.*`, `offer_card.enhancers.*`, `offer_card.guarantee`, and `offer_card.offer_name` via `python ../growth-os/scripts/scorecard.py set …` as each playbook directs.

### Attribution
Frameworks derived from Alex Hormozi's *$100M Offers*. Methods encoded as executable procedures; book text not reproduced.
