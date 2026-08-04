# More, Better, New — the Core Four on steroids

Once a channel works, you scale it in a strict order: **MORE → BETTER → NEW.** Don't
add anything new until More and Better stop paying off. Doing one channel to
exhaustion beats spreading thin.

## MORE — do more of what works (Rule of 100)
Volume first. Commit to the **Rule of 100**: 100 primary actions/day for 100 days on
the one channel (see `rule-of-100.md`). Most "it didn't work" problems are just "I
didn't do enough." Track with `../scripts/rule_of_100_tracker.py`.

## BETTER — improve the weakest step (the constraint)
- The **constraint** is the step in your funnel where the **most leads drop off**.
  Fixing the worst-converting step yields the biggest realistic lift — improving the
  5% step in a 30% / 5% / 50% funnel roughly **doubles** total leads.
  Find it with `../scripts/constraint_analyzer.py`.
- **Test ONE thing per week per platform.** One variable, one platform, one week.
- **Monday ritual:** pick the winners from last week, log them, and design the next
  test against the same constraint.
- **Give up rule:** if you can't beat your current best in **4 tries / ~1 month**,
  the constraint has moved — go find the **next** biggest drop-off and attack that.

## NEW — expand, only after More + Better plateau
When more volume and better conversion both stop returning, add scope **in this order**:
1. **New Placements** (new spots on the same platform — e.g. Stories as well as feed).
2. **New Platforms** (a second platform running the same channel).
3. **New Core Four activity** (add a whole new channel — e.g. add Paid Ads to Content).

## The master LTGP:CAC decision rule
- Minimum viable unit economics: **LTGP : CAC ≥ 3 : 1.** Below that, a business
  struggles to scale no matter how much you advertise.
- **Sales-vs-advertising check** (when CAC is too high — compare CAC to ~3x the
  industry-average CAC):
  - CAC **above ~3x** industry average → the ceiling is **advertising** → lower CAC
    (More / Better / New; a lead magnet; a tighter funnel). Stay in lead-engine.
  - CAC **below ~3x** industry average but still not scaling → the ceiling is the
    **business model** → raise LTGP (better offer / money model), not more ads.
- If leads are engaging but not buying, and they *have the problem and the money*,
  it's a **sales** problem, not a lead problem.
> Canonical definitions of LTGP, CAC, LTGP:CAC, 30-day cash, and CFA live in
> `../../growth-os/references/financial-spine.md` — this skill defers to them.

## Where to go next
- Run the constraint + test loop: `../playbooks/11-more-better-new.md`

---
Frameworks derived from Alex Hormozi's $100M Leads. Methods encoded as executable procedures; book text not reproduced.
