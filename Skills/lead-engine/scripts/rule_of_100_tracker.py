#!/usr/bin/env python3
"""Rule of 100 tracker — are you actually doing the reps? (MORE)

The Rule of 100 (from $100M Leads): do 100 primary actions per day for 100 days
on ONE channel before you judge it. This tracks whether you are on pace.
  Warm/Cold outreach : 100 reach-outs/day
  Content            : 100 minutes/day + >= 1 post per platform
  Paid ads           : 100 minutes/day making ads + run for 100 days

Given a channel, the daily target (100), how many days you've done, and total
actions logged, it reports progress %, on-track vs behind, and days left to 100.

CLI:
  python rule_of_100_tracker.py --channel warm_outreach --daily-target 100 --days-done 12 --actions-logged 900
  echo '{"channel":"content","daily_target":100,"days_done":12,"actions_logged":900}' \
      | python rule_of_100_tracker.py --stdin
Outputs JSON.

Worked example:
  Warm outreach, target 100/day, 12 days in, 900 reach-outs logged.
    expected by now = 100 * 12 = 1,200   -> BEHIND by 300 (avg 75/day, need 100)
    goal total      = 100 * 100 = 10,000 -> 9.0% complete
    days remaining  = 100 - 12 = 88
"""
import argparse
import json
import sys


def track(channel, daily_target=100, days_done=0, actions_logged=0, total_days=100):
    if daily_target <= 0:
        raise ValueError("daily_target must be > 0")
    if total_days <= 0:
        raise ValueError("total_days must be > 0")
    if days_done < 0 or actions_logged < 0:
        raise ValueError("days_done and actions_logged must be >= 0")

    goal_total = daily_target * total_days
    expected_to_date = daily_target * min(days_done, total_days)
    avg_per_day = round(actions_logged / days_done, 2) if days_done else 0.0
    deficit = round(actions_logged - expected_to_date, 2)  # negative = behind
    on_track = actions_logged >= expected_to_date
    progress_pct = round(actions_logged / goal_total * 100, 2)
    days_remaining = max(total_days - days_done, 0)
    projected_total = round(avg_per_day * total_days, 2)

    return {
        "channel": channel,
        "daily_target": daily_target,
        "total_days": total_days,
        "days_done": days_done,
        "actions_logged": actions_logged,
        "goal_total": goal_total,
        "expected_to_date": expected_to_date,
        "avg_per_day": avg_per_day,
        "on_track": on_track,
        "status": "on-track" if on_track else "behind",
        "deficit_vs_pace": deficit,
        "progress_pct": progress_pct,
        "days_remaining": days_remaining,
        "projected_total_at_current_pace": projected_total,
        "will_hit_goal_at_pace": projected_total >= goal_total,
        "rule": "One channel, 100 actions/day, 100 days, before you judge it. MORE before BETTER before NEW.",
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--channel", help="warm_outreach | content | cold_outreach | paid_ads")
    p.add_argument("--daily-target", type=float, default=100)
    p.add_argument("--days-done", type=float, default=0)
    p.add_argument("--actions-logged", type=float, default=0)
    p.add_argument("--total-days", type=float, default=100)
    p.add_argument("--stdin", action="store_true", help="read a JSON object of fields from stdin")
    args = p.parse_args(argv)

    if args.stdin:
        data = json.load(sys.stdin)
        for k, v in data.items():
            setattr(args, k.replace("-", "_"), v)

    if not args.channel:
        print(json.dumps({"error": "provide --channel"}))
        return 1
    try:
        result = track(
            channel=args.channel,
            daily_target=args.daily_target,
            days_done=args.days_done,
            actions_logged=args.actions_logged,
            total_days=args.total_days,
        )
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
