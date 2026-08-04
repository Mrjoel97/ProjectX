# Playbook 07 — Customer Referrals

Lead Getter #1. Turn happy customers into a lead source. Reference:
`../references/lead-getters.md` (#1). Adopt this first among the Lead Getters.

## Inputs
- Current referral rate and churn rate (even rough).
- Your delivery/results process (referrals are earned by results).

## Step 1 — Check the Referral Growth Equation
**Referrals in − Churned out.**
- referrals **>** churn → you grow for **free** (compounds 1 → 2 → 4 → 8).
- referrals **=** churn → you still need ads to grow.
- referrals **<** churn → you're advertising just to break even. Fix delivery first.

## Step 2 — Raise Goodwill (Goodwill = Value − Price) via the 6 ways to give value
Each maps to a part of a great ad:
1. **Call Outs → Sell Better Customers** (better-fit customers refer more).
2. **Dream Outcome → Set Better Expectations.**
3. **Likelihood → Get More People Better Results** (run the 6-step results process).
4. **Time Delay → Faster Wins** — BAMFAM (Book-A-Meeting-From-A-Meeting), get a win in
   **48 hrs**, and **add ~50% to your quoted timelines** so you beat them.
5. **Effort & Sacrifice → Keep Improving the Product** (monthly 6-step improvement loop).
6. **CTA → Tell Them What To Buy Next.**

## Step 3 — Ask, using the 7 ways to ask
1. **One-Sided Benefit** (reward the referrer).
2. **Two-Sided** (both win — Dropbox, PayPal).
3. **Ask at purchase** — *"Who else could you do this with?"*
4. **Negotiation Chip** (a discount in exchange for **3** intros).
5. **Referral Events.**
6. **Ongoing Programs.**
7. **Unlockable Bonuses.**
> Dropbox's two-sided referral **39x'd the company in 15 months.**

## Artifact
A **referral program:** which give-value moves you'll add, the specific ask(s) chosen
(with the exact wording), the reward structure, and where in the customer journey the
ask fires.

## Record it
```
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.lead_getters_active.customers --value true
python ../growth-os/scripts/scorecard.py log --scorecard <biz.json> \
  --entry '{"skill":"lead-engine","playbook":"07-referrals","artifact":"referral_program","ask_type":"two_sided"}'
```

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
