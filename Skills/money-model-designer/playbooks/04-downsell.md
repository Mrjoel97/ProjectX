# Playbook 04 — Design a Downsell Offer (Stage II)

**Goal:** choose and specify one downsell so people who were about to say no say yes —
without discounting the same thing.
**Inputs:** the offer being declined; the customer's intent level (1-10); their reason for
the no (money vs fit); whether the business is recurring. Scorecard path.
**Artifact:** a **specified downsell offer**.
**Reference:** `references/downsell-offers.md`.

## Steps

1. **Anchor on the 6 rules:** they said no to THIS; downsells are trades; personalize
   don't pressure; same things in new ways; **don't drop price for the same thing** (that's
   discounting); test prices in advance.

2. **Read intent, then choose 1 of the 3:**
   - Wants it, can't pay at once, intent high (8+) -> **Payment Plan**
   - Recurring business, hesitant to commit -> **Trial With Penalty**
   - Intent dropped (7-) or budget is the wall -> **Feature Downsell**

3. **Design it with exact steps:**
   - **Payment Plan (7 steps, stop when they buy):** 1) reward paying in full (price with
     interest $15, prepay $10) 2) 3rd-party financing/layaway 3) half now half later
     4) "still want it?" 1-10 (**8+** keep offering plans; **7-** switch to feature
     downsell) 5) split into three 6) evenly spread across term 7) free trial. Use the
     **Seesaw** ("giant or tiny payments?"), align charges to **paycheck dates**, re-run
     declined cards **same day** (~1/3 recovered). Pick cadence knowing churn:
     Monthly 10.7% / Quarterly 5% / Annual 2%.
   - **Trial With Penalty (5 steps, recurring):** 1) offer trial last 2) always get a card
     3) sell staying & paying 4) explain fees **after** the card 5) require check-ins.
     Fee = per-miss ($50) or lump ($500). Post-trial: likes it -> auto-bill; hates it ->
     take blame + better fit ("half buy"); didn't use -> waive fee + restart.
   - **Feature Downsell (4 levers):** remove features **highest-to-lowest value** so they
     re-upsell themselves. Levers: 1) Quantity 2) Quality 3) Service-Quality features
     (time/location, cancellations, response speed, 1:1 vs 1-to-many, live vs recorded,
     in-person vs remote, DIY/DWY/DFY, personalization, guarantee) 4) remove whole
     features. Name tiers ("**The Whale**" ... "**The Minimum**"). After 2 downsells,
     temperature check (8+ -> payment plan; 7- -> "what would a 10 look like?"). Close
     with "Deal?" / "Fair enough?" — never negotiate price.

4. **Record it:**
   ```
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.offer_types_present.downsell --value true
   python ../growth-os/scripts/scorecard.py log --scorecard <path> \
     --entry '{"playbook":"04-downsell","offer":"Payment Plan","seesaw":true,"cadence":"monthly"}'
   ```

## Output — specified downsell offer
Offer type, the exact step sequence and scripts, the trade being made (not a price drop),
the intent threshold that triggered it, and the guardrail (churn cadence / trial fee).
