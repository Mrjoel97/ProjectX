# Playbook 05 — Paid Ads

Pay a platform to show your message to strangers at scale. Cold + 1-to-many. Best when
you have more money than time. Four problems: **where to advertise, who sees it, the
best ad, and permission to contact.**

## Inputs
- A budget you can afford to *lose* while testing (see 3 Phases below).
- A customer list to upload (for lookalikes) or targeting factors.
- A landing page that will match the ad.

## Step 1 — Pick the platform (4 requirements)
Choose a platform where you: (1) **have used it and gotten value** from it;
(2) **can target** your customer; (3) **know how to format** for it; (4) **have the
minimum money** to run it.

## Step 2 — Target
- **Lookalike:** upload a source list, best first — **customers > warm leads > cold leads.**
- **Factors:** age, income, gender, interests, time, location.

## Step 3 — Make the ad = Call Out + Value + CTA
- **Call Out** (most important — the cocktail-party effect; make the right person feel
  it's for them):
  - **Verbal:** Labels, Yes-Questions, If-Then, Ridiculous Results.
  - **Nonverbal:** Contrast, Likeness, The Scene.
- **Value = What / Who / When:**
  - **WHAT — 8 elements** (the 4 drivers + their opposites): Dream ↔ Nightmare,
    Likelihood ↔ Risk, Time Delay ↔ Speed, Effort ↔ Ease.
  - **WHO — status:** who *gains* (the customer) + who *gives* status (spouse, kids,
    parents, colleagues, rivals).
  - **WHEN — Past / Present / Future.**
- **CTA — "S-P-E-L-L it out"** (click / call / reply). Add urgency, scarcity, bonuses.

## Step 4 — Permission
The **landing page must match the ad** — same promise, same look, "click-to-close"
continuity so the visitor feels they're in the right place.

## Money — the 3 Phases of Scaling
1. **Track Money** — set up tracking *before* you spend a dollar.
2. **Lose Money** — budget **2x the cash you collect in 30 days** to test; **shut it off
   before you hit 1x** if it's producing no leads.
3. **Print Money** — scale on the math: customers × CAC **+ 20% pad.**

- Watch **LTGP:CAC** — below **3:1** you'll struggle. If CAC is **below 3x** industry
  average → fix the **business model (LTGP)**; **above 3x** → fix the **advertising (CAC)**.
  (Definitions: `../../growth-os/references/financial-spine.md`.)

## Artifact
An **ad brief:** platform + why (4 reqs), targeting (lookalike source / factors), the
ad (Call Out + What-Who-When Value + spelled-out CTA), the matching landing page, and
the phase-2 test budget.

## Record it
```
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.core_four_active.paid_ads --value true
python ../growth-os/scripts/scorecard.py log --scorecard <biz.json> \
  --entry '{"skill":"lead-engine","playbook":"05-paid-ads","artifact":"ad_brief","platform":"<x>","phase":"lose_money_test"}'
```

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
