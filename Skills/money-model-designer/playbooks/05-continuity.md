# Playbook 05 — Design a Continuity Offer (Stage III)

**Goal:** choose and specify one continuity offer, priced with the continuity-vs-standalone
table, to maximize long-term value without crashing 30-day cash.
**Inputs:** the recurring deliverable + its monthly rate and margin; a natural
setup/onboarding cost (if any); target % who should choose continuity. Scorecard path.
**Artifact:** a **specified continuity offer**.
**Reference:** `references/continuity-offers.md`.

## Steps

1. **Guardrail first:** never run continuity as the standalone front-door offer — it
   crashes 30-day cash. Confirm Attraction + Upsell + Downsell already exist; continuity
   comes AFTER them, then optionally a bulk-prepaid block that auto-rolls to month-to-month.

2. **Choose 1 of the 3:**
   - Great deliverable to give away -> **Bonus** (advertise the bonus, not the membership)
   - Want long commitments, can trade time -> **Discount**
   - Natural setup/onboarding cost -> **Waived Fee**

3. **Design it with exact tactics:**
   - **Bonus:** bonus worth **more than the first payment**. Set the standalone price from
     the table — pick your target % choosing continuity and compute:
     ```
     python scripts/continuity_pricing.py --monthly 199 --target-pct 70
     # -> standalone = 199 * 2.00 = $398 (70% choose continuity)
     ```
     Table: 1.33x->50%, 1.66x->60%, 2.0x->70%, 2.33x->80%, 2.66x->90%. Add a bulk-prepaid
     "buy 5 get 1 free" (even 1 in 8 takers -> +50% 30-day profit).
   - **Discount:** trade free time for a longer term. Apply it one of **4 ways** (up
     front / at the end / spread over time, e.g. 3 mo free on 12 = $50/mo off / after the
     first 1-2 payments). Add the highest-value tactics: **bill in 4-week cycles** (13/yr
     = +8.3% revenue, +41% profit @20% margin); **+3% processing fee** (+30% profit @10%
     margin; use it to capture a 2nd payment method/ACH); lifetime discount at your churn
     point; **extend the term, don't eat into it**. Cancellation fee = discount received;
     exit interview waives fee for feedback ("save a third").
   - **Waived Fee:** waive a startup fee (**3-5x monthly**; 1.5-3x for more up-front cash)
     if they commit **>= 1 year**; they pay it only if they cancel early. If **>5%** cancel
     early, fix the product.

4. **Record it,** including the take %:
   ```
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.offer_types_present.continuity --value true
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.continuity_take_pct --value 70
   python ../growth-os/scripts/scorecard.py log --scorecard <path> \
     --entry '{"playbook":"05-continuity","offer":"Bonus","monthly":199,"standalone":398,"continuity_pct":70}'
   ```

## Output — specified continuity offer
Offer type, the monthly rate, the standalone price (and target continuity %), the billing
cadence and fees, the commitment length, and the cancellation/churn guardrail.
