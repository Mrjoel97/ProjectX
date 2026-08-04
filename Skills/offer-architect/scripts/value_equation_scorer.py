#!/usr/bin/env python3
"""Value Equation scorer — grade an offer on the four drivers and find the weak lever.

The Value Equation (see references/value-equation.md):

              (Dream Outcome) x (Perceived Likelihood of Achievement)
    Value = ----------------------------------------------------------
              (Perceived Time Delay) x (Perceived Effort & Sacrifice)

Score each driver 1-10 as the customer PERCEIVES it:
  dream       higher is better  (bigger, more status-laden outcome)
  likelihood  higher is better  (more certainty it will work for them)
  time        LOWER is better   (faster to the result)  -> 1 = instant, 10 = forever
  effort      LOWER is better   (less work/sacrifice)    -> 1 = done-for-you, 10 = brutal

The value index mirrors the equation's division rule: numerator drivers multiply,
denominator drivers divide. Because pros "attack the bottom" (drive time & effort
toward zero so value approaches infinity), the scorer flags whichever single driver
is dragging the index down the most and names the lever to pull.

CLI:
  python value_equation_scorer.py --dream 9 --likelihood 8 --time 3 --effort 2
  echo '{"dream":9,"likelihood":8,"time":3,"effort":2}' | python value_equation_scorer.py --stdin
Outputs JSON.

Worked example (a Grand Slam weight-loss offer, "Lose 20 lbs in 6 weeks, done-for-you"):
  dream 9, likelihood 8, time 3, effort 2  ->  index = (9*8)/(3*2) = 12.0
  weakest driver: likelihood (its improvement would lift the index most).
"""
import argparse
import json
import sys

DRIVERS = ("dream", "likelihood", "time", "effort")
# Which way is "good" for each driver, and the coaching lever to pull to improve it.
LEVERS = {
    "dream": "Raise the Dream Outcome — sell a bigger destination and tie it to status.",
    "likelihood": "Raise Perceived Likelihood — add proof, track record, and a guarantee (people pay for certainty).",
    "time": "Cut Perceived Time Delay — engineer fast early wins; long outcome + short-term experience. Fast beats free.",
    "effort": "Cut Perceived Effort & Sacrifice — move from do-it-yourself toward done-for-you.",
}


def _clamp_score(name, v):
    v = float(v)
    if not 1 <= v <= 10:
        raise ValueError(f"{name} must be between 1 and 10 (got {v})")
    return v


def value_index(dream, likelihood, time, effort):
    """(dream * likelihood) / (time * effort). Denominator drivers are floored at 1."""
    denom = max(time, 1) * max(effort, 1)
    return round((dream * likelihood) / denom, 2)


def _marginal_gains(dream, likelihood, time, effort):
    """How much the index would improve if each driver moved one step the 'good' way.

    Numerator drivers (dream, likelihood) improve by +1; denominator drivers
    (time, effort) improve by -1. The driver with the biggest gain is the weakest link.
    """
    base = value_index(dream, likelihood, time, effort)
    gains = {}
    gains["dream"] = value_index(min(dream + 1, 10), likelihood, time, effort) - base
    gains["likelihood"] = value_index(dream, min(likelihood + 1, 10), time, effort) - base
    gains["time"] = value_index(dream, likelihood, max(time - 1, 1), effort) - base
    gains["effort"] = value_index(dream, likelihood, time, max(effort - 1, 1)) - base
    return {k: round(v, 2) for k, v in gains.items()}


def score(dream, likelihood, time, effort):
    dream = _clamp_score("dream", dream)
    likelihood = _clamp_score("likelihood", likelihood)
    time = _clamp_score("time", time)
    effort = _clamp_score("effort", effort)

    idx = value_index(dream, likelihood, time, effort)
    gains = _marginal_gains(dream, likelihood, time, effort)
    weakest = max(gains, key=gains.get)

    return {
        "scores": {"dream": dream, "likelihood": likelihood, "time": time, "effort": effort},
        "value_index": idx,
        "interpretation": {
            "dream": "higher is better",
            "likelihood": "higher is better",
            "time": "lower is better",
            "effort": "lower is better",
        },
        "marginal_gain_per_lever": gains,
        "weakest_driver": weakest,
        "recommended_lever": LEVERS[weakest],
        "note": "Pros attack the bottom: driving time and effort toward zero sends value toward infinity.",
    }


def _resolve(args):
    return score(args.dream, args.likelihood, args.time, args.effort)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for d in DRIVERS:
        p.add_argument(f"--{d}", type=float, help=f"1-10 perceived score for {d}")
    p.add_argument("--stdin", action="store_true", help="read a JSON object of the four scores from stdin")
    args = p.parse_args(argv)
    if args.stdin:
        data = json.load(sys.stdin)
        for k, v in data.items():
            setattr(args, k.replace("-", "_"), v)
    missing = [d for d in DRIVERS if getattr(args, d) is None]
    if missing:
        print(json.dumps({"error": f"missing scores: {', '.join(missing)}"}))
        return 1
    try:
        result = _resolve(args)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
