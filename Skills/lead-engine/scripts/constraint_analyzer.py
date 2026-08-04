#!/usr/bin/env python3
"""Constraint analyzer — find the funnel step that leaks the most leads (BETTER).

BETTER (from $100M Leads): the constraint is the step where the most leads drop
off. You get the biggest realistic lift by fixing the worst-converting step, not
the one you enjoy. Test ONE thing per week per platform against that step.

Model:
  Each ordered step receives `incoming` leads and passes `incoming * rate` onward.
    incoming_0     = starting_leads
    passed_i       = incoming_i * rate_i
    incoming_(i+1) = passed_i
  Final output = passed of the last step.

  Constraint  = the step with the LOWEST conversion rate = the biggest drop-off
                = the most headroom (1 - rate) = the easiest step to improve.
  Fix estimate = double the constraint's rate (capped at 100%) and re-run the
                 funnel; the final-lead multiplier is new_rate / old_rate.

CLI:
  python constraint_analyzer.py --steps "optin=0.30,apply=0.05,close=0.50"
  echo '[{"name":"optin","rate":0.30},{"name":"apply","rate":0.05},{"name":"close","rate":0.50}]' \
      | python constraint_analyzer.py --stdin
Outputs JSON.

Worked example (the book's 30% / 5% / 50% funnel):
  optin 30%, apply 5%, close 50%, starting 1000 leads.
  The 5% apply step is the constraint (biggest drop-off, most headroom).
  Doubling it 5% -> 10% roughly DOUBLES final customers (multiplier ~2.0x).
    start 1000 -> optin 300 -> apply 15 -> close 7.5 customers
    fix apply to 10%: 1000 -> 300 -> 30 -> 15 customers  (2.0x)
"""
import argparse
import json
import math
import sys


def _norm_rate(r):
    r = float(r)
    if r > 1:  # accept percents like 30 meaning 0.30
        r = r / 100.0
    if not 0 < r <= 1:
        raise ValueError(f"rate must be in (0, 1] (or a percent); got {r}")
    return r


def run_funnel(steps, starting_leads):
    """Return per-step incoming/passed and the final output."""
    rows = []
    incoming = float(starting_leads)
    for s in steps:
        passed = incoming * s["rate"]
        rows.append({
            "name": s["name"],
            "rate": round(s["rate"], 4),
            "incoming": round(incoming, 2),
            "passed": round(passed, 2),
            "dropped": round(incoming - passed, 2),
            "drop_off_pct": round((1 - s["rate"]) * 100, 2),
        })
        incoming = passed
    return rows, round(incoming, 2)


def analyze(steps, starting_leads=1000):
    if not steps:
        raise ValueError("provide at least one step")
    steps = [{"name": s["name"], "rate": _norm_rate(s["rate"])} for s in steps]
    rows, final = run_funnel(steps, starting_leads)

    # Constraint = lowest rate = biggest drop-off = most headroom.
    constraint_idx = min(range(len(steps)), key=lambda i: steps[i]["rate"])
    constraint = steps[constraint_idx]

    # Fix estimate: double the constraint's rate, capped at 100%.
    improved = list(steps)
    new_rate = min(constraint["rate"] * 2, 1.0)
    improved[constraint_idx] = {"name": constraint["name"], "rate": new_rate}
    _, final_fixed = run_funnel(improved, starting_leads)
    multiplier = round(final_fixed / final, 2) if final else None

    # "vs others": doubling multiplier + headroom for every step, so you can see
    # the leverage is in feasibility (headroom), not the math.
    per_step = []
    for i, s in enumerate(steps):
        d_rate = min(s["rate"] * 2, 1.0)
        trial = list(steps)
        trial[i] = {"name": s["name"], "rate": d_rate}
        _, f = run_funnel(trial, starting_leads)
        per_step.append({
            "name": s["name"],
            "rate": round(s["rate"], 4),
            "headroom": round(1 - s["rate"], 4),
            "doubling_multiplier": round(f / final, 2) if final else None,
        })

    return {
        "starting_leads": starting_leads,
        "final_output": final,
        "funnel": rows,
        "constraint": {
            "step": constraint["name"],
            "index": constraint_idx,
            "rate": round(constraint["rate"], 4),
            "reason": "lowest conversion rate = biggest drop-off = most headroom = easiest to improve",
        },
        "fix_estimate": {
            "action": f"double {constraint['name']} rate {round(constraint['rate'],4)} -> {round(new_rate,4)}",
            "final_output_after_fix": final_fixed,
            "lead_multiplier": multiplier,
        },
        "per_step_leverage": per_step,
        "rule": "Fix the constraint first. Test ONE thing per week per platform. "
                "Can't beat the best in 4 tries / 1 month -> move to the next constraint.",
    }


def _parse_steps_arg(text):
    steps = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" not in part:
            raise ValueError(f"bad step '{part}', expected name=rate")
        name, rate = part.split("=", 1)
        steps.append({"name": name.strip(), "rate": rate.strip()})
    return steps


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--steps", help='ordered steps as "name=rate,name=rate" (rate 0-1 or percent)')
    p.add_argument("--starting-leads", type=float, default=1000)
    p.add_argument("--stdin", action="store_true", help="read a JSON list of {name,rate} steps from stdin")
    args = p.parse_args(argv)

    try:
        if args.stdin:
            steps = json.load(sys.stdin)
        elif args.steps:
            steps = _parse_steps_arg(args.steps)
        else:
            raise ValueError("provide --steps or --stdin")
        result = analyze(steps, args.starting_leads)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
