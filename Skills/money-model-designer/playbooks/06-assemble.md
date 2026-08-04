# Playbook 06 — Assemble the Money Model

**Goal:** sequence the chosen offers into Stages I-III, project the cash, and set a
raise-price roadmap — producing a filled money-model canvas.
**Inputs:** the specified attraction/upsell/downsell/continuity offers from playbooks
02-05 (price, margin, take-rate, continuity months). Scorecard path.
**Artifact:** a **filled money-model canvas** (`assets/money-model-canvas.md`).
**References:** `references/money-model-definition.md`, `references/four-offer-types.md`.

## Steps

1. **Lay out the sequence** a customer experiences:
   `advertise -> attraction -> upsell -> downsell -> continuity`, mapped to the 3 stages
   (I Get Cash / II Get More Cash / III Get The Most Cash).

2. **Project the whole model** per 100 leads:
   ```
   echo '{"leads":100,
          "attraction":{"price":600,"take_rate":0.25},
          "upsell":{"price":80},
          "downsell":{"price":300,"take_rate":0.1},
          "continuity":{"price":199,"margin":0.9,"take_rate":0.5,"months":10}}' \
     | python scripts/money_model_simulator.py --stdin
   ```
   Read `thirty_day_cash_total` (funds the next ad batch) and `twelve_month_ltgp_total`.
   Confirm 30-day cash clears the cost to get + service — ideally the **$100M target**
   (one customer funds 2+ more): re-check with `scripts/cfa_calculator.py`.

3. **Compare against a reference money model** as a blueprint:
   - **Gym Launch:** Decoy (Free DIY vs $16k DWY) -> Classic Upsell ($42k/yr) -> Payment
     Plan (Seesaw) -> Continuity Menu + Feature Downsell ($800/wk -> $100/wk min).
   - **Micro Gyms:** Win Your Money Back -> Payment Plan -> Menu Upsell (supplements) ->
     Feature Downsell -> Rollover + Lifetime Discount.
   - **Newsletter:** Free Trial ($0 then $399/mo) -> Pay Less Now + Lifetime Discount
     ($297 for life) — the "six-headed money monster."
   - **Dog Food:** Buy 4 Get 2 Free -> Classic Upsell (toys/vitamins) -> Feature Downsell
     -> Auto Renewal.

4. **Set the raise-price roadmap.** Raise price in stages "**until you cannot make up for
   the nos with the extra cash from the yeses**." Note the current price, the next test
   price, and the stop condition.

5. **Apply the discipline rules:**
   - Perfect **ONE offer at a time**.
   - Measure results **in quarters**, not days.
   - **"Simple Scales, Fancy Fails"** — 100 offers, not 100 products.
   - Affiliate products fill gaps; mix and match freely (any offer, any order).

6. **Fill the canvas** (`assets/money-model-canvas.md`) with the 4 chosen offers, their
   sequence across Stages I-III, the 30-day cash target, and the raise-price roadmap.

7. **Record the assembled model:**
   ```
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.offer_types_present \
     --value '{"attraction":true,"upsell":true,"downsell":true,"continuity":true}'
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.thirty_day_payback --value '"pass"'
   python ../growth-os/scripts/scorecard.py log --scorecard <path> \
     --entry '{"playbook":"06-assemble","thirty_day_cash_total":19238,"ltgp_12mo":39387,"canvas":"filled"}'
   ```

## Output — filled money-model canvas
All 4 offer types placed in sequence across Stages I-III, projected 30-day cash and
12-month LTGP per 100 leads, and a staged raise-price roadmap with its stop condition.
