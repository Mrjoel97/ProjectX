# Playbook 10 — Agencies (learn, don't depend)

Lead Getter #3. Rent expertise to **learn** a channel fast — not to outsource it
forever. Reference: `../references/lead-getters.md` (#3).

## Inputs
- The channel you want to learn (e.g. paid ads).
- Budget for the engagement + the "teach us why" premium.
- A team member who will absorb the skill.

## Step 1 — Structure the "Right Way" agreement (learn-not-depend)
1. Work with the agency for **~6 months** with the explicit goal of **learning**.
2. **Pay extra** to have them **break down their decisions** (the *why*, not just the *what*).
3. **Train your own team** on what you learned.
4. Then **move to low-cost consulting** (keep them on call; bring the doing in-house).

## Step 2 — Pick the agency (10-point checklist)
Only hire one that has:
1. Known **good results.**
2. **Prominent clients.**
3. A **waiting list** (demand).
4. A **clear process** with **realistic expectations.**
5. Plays **long-term** (no hacks / loopholes).
6. Tells **you what THEY need** from you to succeed.
7. A **regular schedule** of communication.
8. **Simple updates** you can actually understand.
9. A **good offer** (their own offer is built on the Value Equation).
10. **Expensive** (cheap agencies cost more in the end).

## Artifact
An **agency engagement plan:** the channel to learn, the shortlisted agency scored on
the 10-point checklist, the 6-month learn-and-transfer terms (incl. the "explain your
decisions" premium), and who on your team will absorb the skill.

## Record it
```
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.lead_getters_active.agencies --value true
python ../growth-os/scripts/scorecard.py log --scorecard <biz.json> \
  --entry '{"skill":"lead-engine","playbook":"10-agencies","artifact":"agency_engagement_plan","term_months":6,"intent":"learn_not_depend"}'
```

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
