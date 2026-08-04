# Playbook 01 — Assess the Money Model

**Goal:** inventory which of the 4 offer types exist, run the 30-day payback test, and
name the ONE missing type to build next.
**Inputs:** current offers and prices; cost to get a customer; cost to service in 30
days; per-offer price/margin/take-rate if known. Scorecard path.
**Artifact:** a **money-model gap report** written to `model_card`.

> Run commands from the skill root (`money-model-designer/`). The Scorecard lives in
> growth-os; metric definitions are in `../growth-os/references/financial-spine.md`.

## Steps

1. **List the current offers** in the order a customer meets them (advertise ->
   attraction -> upsell -> downsell -> continuity). Record price, margin, take-rate.

2. **Tag each offer to one of the 4 types** using `references/four-offer-types.md`:
   Attraction / Upsell / Downsell / Continuity.

3. **Mark presence.** For each of the 4 types, is there at least one real offer? Note
   `attraction / upsell / downsell / continuity = true|false`.

4. **Run the 30-day payback test** across the whole sequence. Use the money-model
   calculator (it mirrors growth-os's CFA test — see `../growth-os/scripts/cfa.py`):
   ```
   python scripts/cfa_calculator.py \
     --offers '[{"name":"core","price":600},{"name":"supplements","price":80}]' \
     --cost-to-get 20
   ```
   Read `thirty_day_cash_per_customer`, `cash_multiple`, and `tier`. Payback **passes**
   when the multiple is >= 1 (customer covers their own get + service in 30 days);
   the **$100M target** is >= 2.

5. **Find the missing type** with the mini-diagnostic (four-offer-types.md):
   - can't afford ads / nothing covers acquisition -> missing **Attraction**
   - one-time sale only, nothing after the yes -> missing **Upsell**
   - people say no and there's nothing else -> missing **Downsell**
   - no recurring revenue -> missing **Continuity**
   Pick the single highest-leverage gap (usually the earliest missing stage, or the one
   that flips the payback test to passing).

6. **Write the gap report** into the Scorecard `model_card`:
   ```
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.offer_types_present \
     --value '{"attraction":true,"upsell":true,"downsell":false,"continuity":false}'
   python ../growth-os/scripts/scorecard.py set --scorecard <path> \
     --path model_card.thirty_day_payback --value '"pass"'
   python ../growth-os/scripts/scorecard.py log --scorecard <path> \
     --entry '{"playbook":"01-assess","thirty_day_cash":680,"multiple":34,"missing_type":"downsell","next_playbook":"04-downsell"}'
   ```

## Output — money-model gap report
- Offers, tagged to the 4 types (present/absent).
- 30-day cash per customer + cash multiple + tier.
- The single missing/weakest type and which playbook builds it next
  (02 attraction / 03 upsell / 04 downsell / 05 continuity).
