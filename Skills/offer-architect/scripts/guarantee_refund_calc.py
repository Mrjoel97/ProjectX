#!/usr/bin/env python3
"""Guarantee refund math — does reversing risk with a guarantee net more sales?

A guarantee removes the #1 objection (risk), so it lifts gross sales, but it also
raises the refund rate. This computes NET units both ways so you can see whether the
extra sales more than pay for the extra refunds (see references/enhancement-layers.md).

    net_sales = gross_sales * (1 - refund_pct)

Rule of thumb from the book: a guarantee is only NOT worth it if the refunds it
triggers fully offset the additional sales it drives. In almost every real case the
lift wins.

CLI:
  python guarantee_refund_calc.py --base-sales 100 --base-refund 5 \
                                  --guar-sales 130 --guar-refund 10
  echo '{"base_sales":100,"base_refund":5,"guar_sales":130,"guar_refund":10}' \
      | python guarantee_refund_calc.py --stdin
Outputs JSON.

Refund percentages accept either 5 or 0.05 (both read as 5%).

Worked example (from $100M Offers):
  baseline:  100 sales at 5% refund  -> 95 net
  guarantee: 130 sales at 10% refund -> 117 net
  multiplier = 117 / 95 = 1.23x  (a 23% lift in net sales)
"""
import argparse
import json
import sys


def _as_fraction(pct):
    """Accept 5 (percent) or 0.05 (fraction); return a 0-1 fraction."""
    pct = float(pct)
    if pct < 0:
        raise ValueError("refund percentage cannot be negative")
    frac = pct / 100.0 if pct > 1 else pct
    if frac > 1:
        raise ValueError("refund percentage cannot exceed 100%")
    return frac


def net_sales(gross_sales, refund_pct):
    gross_sales = float(gross_sales)
    if gross_sales < 0:
        raise ValueError("sales cannot be negative")
    return round(gross_sales * (1 - _as_fraction(refund_pct)), 2)


def compare(base_sales, base_refund, guar_sales, guar_refund):
    base_net = net_sales(base_sales, base_refund)
    guar_net = net_sales(guar_sales, guar_refund)
    if base_net <= 0:
        raise ValueError("baseline net sales must be > 0 to compute a multiplier")
    multiplier = round(guar_net / base_net, 4)
    return {
        "baseline": {
            "gross_sales": float(base_sales),
            "refund_pct": round(_as_fraction(base_refund) * 100, 4),
            "net_sales": base_net,
        },
        "with_guarantee": {
            "gross_sales": float(guar_sales),
            "refund_pct": round(_as_fraction(guar_refund) * 100, 4),
            "net_sales": guar_net,
        },
        "net_gain_units": round(guar_net - base_net, 2),
        "multiplier": multiplier,
        "lift_pct": round((multiplier - 1) * 100, 2),
        "worth_it": guar_net > base_net,
        "verdict": (
            f"Add the guarantee: net sales go {base_net} -> {guar_net} "
            f"({multiplier}x, +{round((multiplier - 1) * 100, 2)}%)."
            if guar_net > base_net
            else f"Skip it: refunds offset the lift ({base_net} -> {guar_net})."
        ),
    }


def _resolve(args):
    return compare(args.base_sales, args.base_refund, args.guar_sales, args.guar_refund)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--base-sales", type=float, help="baseline gross sales (no guarantee)")
    p.add_argument("--base-refund", type=float, help="baseline refund %% (e.g. 5 or 0.05)")
    p.add_argument("--guar-sales", type=float, help="gross sales with the guarantee")
    p.add_argument("--guar-refund", type=float, help="refund %% with the guarantee")
    p.add_argument("--stdin", action="store_true", help="read a JSON object of the four fields from stdin")
    args = p.parse_args(argv)
    if args.stdin:
        data = json.load(sys.stdin)
        for k, v in data.items():
            setattr(args, k.replace("-", "_"), v)
    required = ["base_sales", "base_refund", "guar_sales", "guar_refund"]
    missing = [r for r in required if getattr(args, r) is None]
    if missing:
        print(json.dumps({"error": f"missing fields: {', '.join(missing)}"}))
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
