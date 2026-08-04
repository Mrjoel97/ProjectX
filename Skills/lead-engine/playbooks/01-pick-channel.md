# Playbook 01 — Pick Your Core Four Channel

Choose the ONE channel to run first. Reference: `../references/core-four.md`.

## Inputs
- Do you have a warm list yet? (past customers, contacts, followers — anyone who gave permission)
- Which is scarcer for you right now: **time** or **money**?
- Your Value Equation offer sentence (from `../references/core-four.md`).

## Steps
1. **Write the offer sentence first.** "I help (ideal customer) get (dream outcome)
   in (time period) without (effort and sacrifice) and (increase perceived likelihood)."
   No channel works without it.
2. **Start Warm.** If you have *any* warm contacts (you almost always do — your first
   ~1,000 leads usually live in your phone, email, and socials), your first channel is
   **Warm Outreach** → go to `02-warm-outreach.md`. It's free, fast, and highest-converting.
3. **When warm is exhausted (or you have none), split by scarcity:**
   - **More time than money → Post Free Content** → `03-post-content.md`.
   - **More money than time → Cold Outreach** (`04-cold-outreach.md`) **or Paid Ads**
     (`05-paid-ads.md`). Cold outreach if you have labor/tools; paid ads if you have cash.
4. **Pick exactly one.** Commit to it under the Rule of 100 (`../references/rule-of-100.md`)
   before adding a second. One channel maxed beats four dabbled.
5. **Set the daily action.** Warm/Cold = 100 reach-outs/day. Content = 100 min/day + ≥1
   post/platform. Paid = 100 min/day making ads + run 100 days.

## Artifact
A one-line decision: **chosen channel + daily action + the offer sentence.**

## Record it
```
# mark the chosen channel active (example: warm outreach)
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.core_four_active.warm_outreach --value true
python ../growth-os/scripts/scorecard.py log --scorecard <biz.json> \
  --entry '{"skill":"lead-engine","playbook":"01-pick-channel","chosen_channel":"warm_outreach","daily_action":"100 reach-outs/day"}'
```
Then run the matching channel playbook.

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
