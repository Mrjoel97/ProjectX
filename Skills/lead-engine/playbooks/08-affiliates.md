# Playbook 08 — Affiliates

Lead Getter #4. Get other businesses to promote you to their audiences for a cut.
Reference: `../references/lead-getters.md` (#4). Adopt after referrals, employees, agencies.

## Inputs
- Your max CAC (the most you can pay to acquire a customer).
- Your lead magnet and core offer.
- A launch date to build the cadence around.

## The 6 steps
1. **Find ideal affiliates** — ask *"Who already has my leads?"* Look at softwares,
   products, equipment, services, groups, and events serving the same customer.
2. **Make them an offer** (Call Out + Value + CTA): "Make more money from your current
   customers **and** get more leads… without building, delivering, or supporting it…
   starting tomorrow."
3. **Qualify them** (get them invested): **Make Them a Customer** and/or **Make Them an
   Expert.** Charge **10–20%** of what the average active affiliate makes in their first
   12 months (skin in the game).
4. **What to pay — a 3-tier payout** (example, $40 max CAC):
   - **Tier 1 — 25% ($10)** on **sign-up.**
   - **Tier 2 — 50% ($20)** on **activation.**
   - **Tier 3 — 100% ($40)** on **sustain.**
   - The **blended** payout stays **below your max CAC.**
5. **Get them advertising — Whisper → Tease → Shout cadence:**
   - **Whisper** (call outs / curiosity): every **4–6 weeks**, from ~**60 days out.**
   - **Tease** (elements of value): **weekly** from ~14 days out, then **2x/week** to 3 days out.
   - **Shout** (the CTA): **2x/day** from 3 days out, then **every 30 minutes** near launch.
6. **Keep them advertising — Integrate**, three ways:
   1. affiliates **give away** your lead magnet;
   2. affiliates **sell** your lead magnet;
   3. affiliates **sell** your core offer.

## Returns
Cost to get an affiliate vs the GP of customers they send. If ratio < 3: **lower CAC** /
**raise LTGP + lower CAC** / **raise LTGP.**

## Artifact
An **affiliate program:** target affiliate list, the offer, qualification (customer/expert
+ buy-in price), the 3-tier payout mapped to your CAC, and the Whisper-Tease-Shout
launch calendar.

## Record it
```
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.lead_getters_active.affiliates --value true
python ../growth-os/scripts/scorecard.py log --scorecard <biz.json> \
  --entry '{"skill":"lead-engine","playbook":"08-affiliates","artifact":"affiliate_program","payout":"3-tier"}'
```

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
