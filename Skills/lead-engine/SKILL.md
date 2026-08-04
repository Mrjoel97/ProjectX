---
name: lead-engine
description: Use when a business has no leads, not enough leads, or asks "how do I get customers / more leads / traffic" — nobody knows the product exists, the pipeline is empty or drying up, launch with no audience, or a channel stopped working. Covers warm outreach and cold outreach (DMs, cold email, cold calling), posting free content, paid ads, lead magnets and free giveaways, referrals and word-of-mouth, affiliates and partnerships, hiring or training people for lead generation, using agencies, scaling advertising spend, and diagnosing funnel drop-off or a low LTGP:CAC / high CAC advertising problem.
---

# Lead Engine — get engaged leads (Core Four + Lead Getters)

## Overview
Engaged leads — *people who show interest in the stuff you sell* — are the true output
of advertising, and advertising is just *"the process of making known."* There are only
**four ways** to make your offer known (the **Core Four**), and only **four kinds of
people** who can do them for you (the **Lead Getters**). This skill turns both into
step-by-step playbooks that each end in a concrete artifact recorded to the Business
Scorecard. Money follows: **Offer → Leads → Sales → Money.**

This skill is thin on purpose. Read the reference for the concept, run the playbook for
the procedure, use the scripts for the math.

## Mini-diagnostic — pick your channel in 20 seconds
```
1. Do you have a warm list (contacts, past customers, followers who gave permission)?
   YES -> START WARM. Run playbooks/02-warm-outreach.md. (Your first ~1,000 leads.)
   NO / exhausted -> go to 2.

2. Which is scarcer right now: TIME or MONEY?
   More time than money  -> playbooks/03-post-content.md   (compounding, unpaid)
   More money than time  -> playbooks/04-cold-outreach.md  (labor/tools to reach strangers)
                         or playbooks/05-paid-ads.md        (cash to buy reach)

3. Want cheaper, warmer leads on ANY channel? Attach a lead magnet:
   playbooks/06-lead-magnet.md

4. Already getting leads and want leverage (others advertise for you)?
   Adopt Lead Getters in order: referrals -> employees -> agencies -> affiliates
   playbooks/07 / 09 / 10 / 08

5. Channel works but you want to scale it? MORE -> BETTER -> NEW:
   playbooks/11-more-better-new.md
```
Pick **one** channel and max it before adding another (More → Better → New). Full
selector: `playbooks/01-pick-channel.md`.

## Index
### references/ (concepts)
- `core-four.md` — the 2x2 (Warm Outreach / Post Content / Cold Outreach / Paid Ads); warm vs cold; 1-to-1 vs 1-to-many; the decision rule; the Value Equation offer sentence.
- `lead-magnets.md` — definition; the 4 jobs of a good magnet; Problem–Solution Cycle; the 7 steps (3 types × 4 methods); the CTA; economics.
- `rule-of-100.md` — Rule of 100 and Open To Goal; habit stack; the one-page advertising checklist.
- `lead-getters.md` — the 4 Lead Getters + leverage + adoption order; Referrals, Employees, Agencies, Affiliates.
- `more-better-new.md` — MORE / BETTER / NEW; the constraint; the master LTGP:CAC + sales-vs-advertising rule.

### playbooks/ (procedures — each ends in an artifact + Scorecard write)
- `01-pick-channel.md` · `02-warm-outreach.md` · `03-post-content.md` · `04-cold-outreach.md` · `05-paid-ads.md`
- `06-lead-magnet.md` · `07-referrals.md` · `08-affiliates.md` · `09-employees.md` · `10-agencies.md` · `11-more-better-new.md`

### scripts/ (stdlib Python; `--help`, JSON out, `--stdin`)
- `constraint_analyzer.py` — find the funnel step that leaks the most leads; estimate the lift from fixing it.
- `cold_outreach_solver.py` — solve the cold equation for X; split contacts across senders/days.
- `rule_of_100_tracker.py` — track Rule of 100 pace (progress %, on-track/behind, days left).

### assets/ (fill-in templates)
- `advertising-checklist.template.md` — the one-page advertising checklist (5 steps).
- `lead-magnet.template.md` — spec a lead magnet end to end.

## How results are recorded
Every playbook ends by writing to the Business Scorecard (`lead_card` fields) via
`python ../growth-os/scripts/scorecard.py`, so Growth OS can re-diagnose and loop. The
financial spine (LTGP, CAC, LTGP:CAC, 30-day cash, CFA) is defined once in
`../growth-os/references/financial-spine.md` — this skill defers to it and never redefines it.

## Attribution
Frameworks derived from Alex Hormozi's $100M series ($100M Offers, $100M Money Models,
$100M Leads). Methods encoded as executable procedures; book text not reproduced.
