# Playbook 02 — Design an Attraction Offer (Stage I)

**Goal:** choose and fully specify one of the 5 attraction offers so it covers the cost
of getting a customer.
**Inputs:** the core product + its price and gross margin; refund rate; whether cash flow
can absorb give-aways; audience size. Scorecard path.
**Artifact:** a **specified attraction offer**.
**Reference:** `references/attraction-offers.md`.

## Steps

1. **Confirm the job:** turn strangers into customers and cover acquisition cost. Recall
   the continuum — free / discount / $1 are all discounts; you can profit on "free" by
   requiring a purchase to unlock more. Obey the law on "free."

2. **Choose 1 of the 5** using the selection rules:
   - Trackable results + strong product + refund rate < 5% -> **Win Your Money Back**
   - Big audience + want virality + a value anchor -> **Giveaway**
   - Make a premium look obvious -> **Decoy**
   - Physical/consumable or long commitment + cash can absorb it -> **Buy X Get Y Free**
   - Max front-door conversion + guarantee feel -> **Pay Less Now or Pay More Later**

3. **Design it with that offer's exact sub-tactics:**
   - **Win Your Money Back:** pick mode (Results / Actions / Both); meet all 3 criteria
     (Easy to Track, Gets Results, Advertises the Business); return as **store credit via
     rollover** ($50/mo over 12, not free months); confirm refund rate < 5%.
   - **Giveaway:** run the **6 steps** (Grand Prize + $ anchor -> Promotional Offer ->
     contact/eligibility -> qualifying actions -> 3-7 day deadline w/ daily updates ->
     announce winner then sell the discount on a 2nd 7-day deadline). Core discount =
     **10-30% of gross margins**; urgency in **3 places**; two prizes for referrals.
   - **Decoy:** build the decoy (fewer components / older model / no guarantee); advertise
     benefits; state the discount in one of the **4 ways** (% / absolute / free portion /
     total package).
   - **Buy X Get Y Free:** raise price first; sell one high + give the rest free; pick
     Good/Better/Best duration (more free = better); **cap at 10%** of recurring customers.
   - **Pay Less Now / Pay More Later:** set the pay-later terms ($0 today, card on file,
     full price after period unless cancel); then the pay-now offer (**20-50% discount +
     bonuses**); promise a measurable yes/no result; have an upsell ready.

4. **Sanity-check the cash.** Estimate take-rate and confirm 30-day cash covers cost to
   get + service:
   ```
   python scripts/cfa_calculator.py --offers '[{"price":600,"take_rate":1.0}]' --cost-to-get 20
   ```

5. **Record it** in the Scorecard:
   ```
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.offer_types_present.attraction --value true
   python ../growth-os/scripts/scorecard.py log --scorecard <path> \
     --entry '{"playbook":"02-attraction","offer":"Decoy","spec":"Free DIY vs $16k DWY"}'
   ```

## Output — specified attraction offer
Offer type, exact mechanics/terms, the discount framing, the qualifying/entry conditions,
the guardrail metric (refund < 5% / cancel < 10% / cap 10%), and the expected take-rate.
