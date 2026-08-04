#!/usr/bin/env python3
"""Continuity vs standalone pricing — the "pay to avoid continuity" table.

From the book's Continuity Bonus rule: to control what fraction of buyers pick
the recurring membership instead of the one-time standalone, price the standalone
as a multiple of the MONTHLY rate. "People pay ~33% more to avoid continuity."

  standalone = monthly * multiplier
    50% choose continuity  -> 1.33x
    60% choose continuity  -> 1.66x
    70% choose continuity  -> 2.00x
    80% choose continuity  -> 2.33x
    90% choose continuity  -> 2.66x

Two modes:
  forward  given monthly rate + target continuity % -> the standalone price to set
  inverse  given monthly rate + a standalone price  -> the % who will choose continuity

CLI:
  python continuity_pricing.py --monthly 199 --target-pct 70
  python continuity_pricing.py --monthly 199 --standalone 398
  python continuity_pricing.py --table --monthly 199
  echo '{"monthly":199,"target_pct":70}' | python continuity_pricing.py --stdin

Worked example from the book:
  $199/mo membership, want 70% to choose continuity -> standalone = 199 * 2.00 = $398.
"""
import argparse
import json
import sys

# target continuity % -> multiple of MONTHLY rate to set as the standalone price
TABLE = {50: 1.33, 60: 1.66, 70: 2.00, 80: 2.33, 90: 2.66}


def forward(monthly, target_pct):
    if target_pct not in TABLE:
        raise ValueError(f"target_pct must be one of {sorted(TABLE)}")
    multiplier = TABLE[target_pct]
    return {
        "mode": "forward",
        "monthly": round(monthly, 2),
        "target_continuity_pct": target_pct,
        "multiplier": multiplier,
        "standalone_price": round(monthly * multiplier, 2),
        "note": f"Price the one-time standalone at {multiplier}x the monthly rate so ~{target_pct}% choose continuity.",
    }


def inverse(monthly, standalone):
    if monthly <= 0:
        raise ValueError("monthly must be > 0")
    ratio = standalone / monthly
    # nearest multiplier in the table
    best_pct = min(TABLE, key=lambda pct: abs(TABLE[pct] - ratio))
    return {
        "mode": "inverse",
        "monthly": round(monthly, 2),
        "standalone_price": round(standalone, 2),
        "standalone_to_monthly_ratio": round(ratio, 2),
        "nearest_multiplier": TABLE[best_pct],
        "estimated_continuity_pct": best_pct,
        "note": f"A standalone at {round(ratio, 2)}x the monthly rate is nearest {TABLE[best_pct]}x -> ~{best_pct}% choose continuity.",
    }


def full_table(monthly):
    return {
        "mode": "table",
        "monthly": round(monthly, 2),
        "rows": [
            {"continuity_pct": pct, "multiplier": mult, "standalone_price": round(monthly * mult, 2)}
            for pct, mult in sorted(TABLE.items())
        ],
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--monthly", type=float)
    p.add_argument("--target-pct", type=int, help="one of 50,60,70,80,90 (forward mode)")
    p.add_argument("--standalone", type=float, help="standalone price (inverse mode)")
    p.add_argument("--table", action="store_true", help="print the full table for --monthly")
    p.add_argument("--stdin", action="store_true")
    args = p.parse_args(argv)

    if args.stdin:
        data = json.load(sys.stdin)
        for k, v in data.items():
            setattr(args, k.replace("-", "_"), v)

    if args.monthly is None:
        print(json.dumps({"error": "provide --monthly"}))
        return 1
    try:
        if args.table:
            result = full_table(args.monthly)
        elif args.target_pct is not None:
            result = forward(args.monthly, int(args.target_pct))
        elif args.standalone is not None:
            result = inverse(args.monthly, args.standalone)
        else:
            print(json.dumps({"error": "provide --target-pct (forward), --standalone (inverse), or --table"}))
            return 1
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
