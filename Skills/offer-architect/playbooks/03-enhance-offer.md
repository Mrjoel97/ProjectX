# Playbook 03 — Enhance the Offer

**Goal:** multiply the pull of the built offer with the four enhancement levers, applied in sequence. This is where a good offer becomes irresistible.

**Inputs:**
- A filled offer stack (from `02-build-offer.md`; Scorecard `offer_card`).
- Reference: `../references/enhancement-layers.md`.
- Script: `../scripts/guarantee_refund_calc.py`.

**Artifact produced:** the enhanced offer with a **named guarantee** (plus scarcity, urgency, and bonuses), recorded to the Scorecard `offer_card.enhancers` and `offer_card.guarantee`.

**Two governing principles throughout:**
- **Delicate Dance of Desire** — keep supply UNDER demand; always sell out and announce it.
- **Hormozi's Law** — the longer you delay the ask, the bigger the ask you can make.

---

## Step 1 — Scarcity (limit quantity)
Choose a scarcity mechanism and write the exact wording:
- Pick a **type**: limited seats/slots · limited bonuses · never available again.
- If a service, pick a **cap**: Total Business Cap ("only X clients total"; waitlist; raise 10–20% then re-cap) · Growth Rate Cap ("X new/week") · Cohort Cap ("X per class").
- Use **Honest Scarcity** — advertise real progress to capacity ("81% to capacity"). Never fake it.

Record: `offer_card.enhancers.scarcity = true`.

## Step 2 — Urgency (limit time)
Add a real deadline. Pick one of the **4 methods** and write the wording:
1. Cohort-Based Rolling Urgency (doors close on a cadence).
2. Rolling Seasonal Urgency (re-dated seasonal promo — #1 for local).
3. Pricing/Bonus-Based Urgency (the **promo/bonus** expires, not the service).
4. Exploding Opportunity (a real external window is closing).

Record: `offer_card.enhancers.urgency = true`.

## Step 3 — Bonuses (stack, don't discount)
Add bonuses **instead of** cutting the core price. For each bonus, run the **11-point checklist** (see reference): always offer · benefit-driven name · explain relation/what/how-discovered/how-it-helps · proof · vivid image · price tag + justify · tools & checklists over trainings · address a specific obstacle · solve the NEXT logical problem · total bonus value **eclipses the core** · add scarcity/urgency to the bonuses.

In a 1:1 sale: **ask for the sale first**; on a "no," present the bonus that answers their specific objection, then ask again ("Fair enough?"). Consider Other People's Products as bonuses.

Record: `offer_card.enhancers.bonuses = true`.

## Step 4 — Guarantee (reverse the risk)
Risk is the #1 objection; this is the fastest lift. Write a guarantee with **teeth**:

> **"If you don't get [X result] in [Y time], we will [Z]."**

1. Pick type(s): **Unconditional** (strongest/riskiest, best low-ticket B2C) · **Conditional** (tied to success actions; "better than money back") · **Anti-Guarantee** (all sales final + a reason why) · **Implied** (performance/revshare/profit-share). Consider **stacking** (e.g. unconditional 30-day + conditional triple-money-back 90-day).
2. **Name it vividly.**
3. **Validate the refund math** before committing:
```
python ../scripts/guarantee_refund_calc.py --base-sales 100 --base-refund 5 --guar-sales 130 --guar-refund 10
```
(Book example → 95 net vs 117 net = **1.23x**. A guarantee is only *not* worth it if added refunds fully offset added sales.)

Record: `offer_card.enhancers.guarantee = true` and the guarantee text.

---

## Record to the Scorecard
```
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path offer_card.enhancers.scarcity --value true
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path offer_card.enhancers.urgency --value true
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path offer_card.enhancers.bonuses --value true
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path offer_card.enhancers.guarantee --value true
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path offer_card.guarantee --value '"<named guarantee, e.g. The 6-Week No-Sweat Promise>"'
python ../growth-os/scripts/scorecard.py log --scorecard <path> --entry '{"skill":"offer-architect","playbook":"03-enhance-offer","guarantee":"...","refund_multiplier":1.23}'
```

**Exit check:** all four `enhancers` set true and a named guarantee stored. Proceed to `04-name-offer.md`.

## Attribution
Frameworks derived from Alex Hormozi's *$100M Offers*. Methods encoded as executable procedures; book text not reproduced.
