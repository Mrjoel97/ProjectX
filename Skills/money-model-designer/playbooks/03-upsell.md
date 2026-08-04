# Playbook 03 — Design an Upsell Offer (Stage II)

**Goal:** choose and specify one of the 4 upsells so 30-day profit rises above the cost
to get + service a customer.
**Inputs:** the attraction/core purchase and the next problem it reveals; add-on products;
margins; price of the main offer. Scorecard path.
**Artifact:** a **specified upsell offer**.
**Reference:** `references/upsell-offers.md`.

## Steps

1. **Name the next problem** the purchase reveals — the upsell must solve it (More /
   Better / New). Avoid the 3 failure modes: wrong thing, wrong time, wrong way.

2. **Choose 1 of the 4:**
   - Purchase creates an obvious dependent need -> **Classic** ("can't have X without Y")
   - Several add-ons + want trust and choice -> **Menu**
   - Want a big-ticket option to reset the price frame -> **Anchor**
   - Re-activate past buyers / steal upset competitors -> **Rollover**

3. **Design it with exact tactics:**
   - **Classic:** state the dependency plainly; attach the highest-margin add-on.
   - **Menu:** run the **4 tactics in order** — Unsell (what they don't need) ->
     Prescription (what they do need, "as if they already have it") -> A/B (A or B, not
     whether to buy) -> Card On File. Add the **"Economist" Play**: 3 options where the
     bundle C is priced = the more expensive single B (Digital $59 / Print $125 / Both
     $125 -> take C).
   - **Anchor:** run the **5 steps** — present anchor at **5-10x** -> get "The Gasp" ->
     come to the rescue -> present the main offer -> ask how they pay. Main + premium
     share the same primary features; actually sell the anchor.
   - **Rollover:** pick **WHO** (win-back 6+ mo / your upset / competitors' upset /
     regulars), **WHAT** (More/Better/New), **HOW** (all or part; up front or over time);
     make the upsell **>= 4x the credit** (full credit = <= 25% discount). Optional
     "Famous" gift card (sell $200 cards for $20, usable only on your offers).

4. **Apply the universal tactics:** offer the more profitable thing first; "say no to say
   yes"; Surprise & Delight; Hyper Buying Cycle; **BAMFAM** (book the next meeting now);
   charge 5-50% for guarantees; use the **price-nudge** table (Small $5 / Medium $8 /
   Large $9) to push the Large.

5. **Check the 30-day cash lift** with a realistic take-rate:
   ```
   python scripts/cfa_calculator.py \
     --offers '[{"name":"core","price":15,"margin":0.667},{"name":"upsell","price":100,"take_rate":0.2}]' \
     --cost-to-get 30
   ```
   (The book's example: $15 membership + $100 upsell taken by 1 in 5 -> $30 in 30 days.)

6. **Record it:**
   ```
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.offer_types_present.upsell --value true
   python ../growth-os/scripts/scorecard.py log --scorecard <path> \
     --entry '{"playbook":"03-upsell","offer":"Menu","economist_play":true,"take_rate":0.2}'
   ```

## Output — specified upsell offer
Offer type, the exact script/steps, price and margin, expected take-rate, and the 30-day
cash it adds per customer.
