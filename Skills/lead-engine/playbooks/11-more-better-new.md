# Playbook 11 — More, Better, New (scale the channel)

Scale a working channel in strict order: **MORE → BETTER → NEW.** Reference:
`../references/more-better-new.md`.

## Inputs
- Your funnel steps with conversion rates (ordered, e.g. optin → apply → close).
- Current daily volume on the channel.
- A running list of test ideas.

## Step 1 — MORE (are you doing the reps?)
Commit to the **Rule of 100** and check your pace:
```
python ../scripts/rule_of_100_tracker.py --channel <x> --daily-target 100 --days-done <d> --actions-logged <a>
```
If you're **behind**, the fix is volume — not a new channel. Catch up first.

## Step 2 — BETTER (find and fix the constraint)
- Find the step where the most leads drop off:
```
python ../scripts/constraint_analyzer.py --steps "optin=0.30,apply=0.05,close=0.50"
# -> constraint = apply (5%); doubling it ~2x's total leads
```
- **Test ONE thing per week per platform** against that constraint.
- **Monday ritual:** pick last week's winners, log them, design the next test.
- **Give-up rule:** can't beat your best in **4 tries / ~1 month** → the constraint has
  moved; re-run the analyzer and attack the **next** biggest drop-off.

## Step 3 — NEW (only after More + Better plateau)
Expand in order: **New Placements → New Platforms → New Core Four activity.**

## Step 4 — Master decision check
Confirm **LTGP:CAC ≥ 3:1.** If CAC is **above ~3x** industry average → keep fixing
**advertising** (stay here). If **below ~3x** but still not scaling → the ceiling is the
**business model** (route to offer/money-model). If leads engage but don't buy and they
*have the problem and money* → it's a **sales** problem, not a lead problem.

## Artifact
A **test backlog + constraint call:** the named constraint step (from the analyzer), the
prioritized one-test-per-week backlog, and the Monday review cadence.

## Record it
```
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.primary_constraint_step --value '"apply"'
python ../growth-os/scripts/scorecard.py set --scorecard <biz.json> \
  --path lead_card.rule_of_100_active --value true
python ../growth-os/scripts/scorecard.py log --scorecard <biz.json> \
  --entry '{"skill":"lead-engine","playbook":"11-more-better-new","artifact":"test_backlog","constraint_step":"apply","lead_multiplier_if_fixed":2.0}'
```

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
