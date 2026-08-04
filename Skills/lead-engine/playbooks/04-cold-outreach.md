# Playbook 04 — Cold Outreach

Contact strangers privately (DM, email, phone). Cold + 1-to-1. Best when you have more
money/labor than time. Three problems to solve: **how to contact them, what to say, and
contacting until they're ready.**

## Inputs
- A target customer definition (who to build a list of).
- A big-fast-value asset you can give away in <30 seconds.
- Sending capacity (accounts/dialers/people) and a daily volume target.

## Problem 1 — Build the list
Get contacts in this order of preference:
1. **Softwares** — scrapers/tools that pull contact data.
2. **Brokers** — buy a list from a data broker.
3. **Elbow Grease** — join the groups/communities where they gather and collect manually.

## Problem 2 — Personalize + Big Fast Value
- Find **1–3 real facts** about each person.
- **"Blow their minds in under 30 seconds"** — lead with value, not a pitch.
- **Give away stuff people actually pay for** (that's what earns a reply).

## Problem 3 — Volume (contact until ready)
- **Automate Delivery** (sending), **Automate Distribution** (list building),
  and **Follow up** — more times, more ways.
- Restart at the top of the list; **wait 3–6 months, then repeat** the whole sequence.

## Benchmarks (per 100 contacted/day)
- **Phone:** 100 → 20% pick up → 25% of those take it → **4 leads.**
- **Email:** 100 → 30% open → 10% reply = **3%.**
- **DM:** ~**20% reply.**

## The cold equation — solve for X
*"For every X people you contact, you get Y customers. Solve for X."*
- Example: **100 emails → 1 customer.** Want **100 customers → 10,000 emails.**
- Compute it and split the workload across senders/days:
```
python ../scripts/cold_outreach_solver.py --customers 100 --contacts-per-customer 100 --days 30 --senders 3
# -> 10,000 contacts -> 333/day -> 3 senders x 111/day
```
- **Master rule: LTGP ≥ 3x the cost to get a customer (3:1 minimum).** If the math
  doesn't clear 3:1, fix the offer/model before scaling volume.

## Artifact
A **cold-outreach plan:** list source, personalization + big-fast-value script, channel,
the solved-for-X volume (contacts/day, senders), follow-up cadence.

## Record it
```
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.core_four_active.cold_outreach --value true
python ../growth-os/scripts/scorecard.py log --scorecard <biz.json> \
  --entry '{"skill":"lead-engine","playbook":"04-cold-outreach","artifact":"cold_outreach_plan","contacts_needed":10000,"per_day":333}'
```

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
