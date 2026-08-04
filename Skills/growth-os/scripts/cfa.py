#!/usr/bin/env python3
"""Client Financed Acquisition (CFA) — the "get paid to acquire" test.

Question answered: does a customer produce more gross profit in the first 30 days
than it costs to get AND service them? If yes, acquisition is self-funding and the
business can scale on interest-free 30-day float.

Inputs:
  thirty_day_cash  gross profit a single customer produces in first 30 days
  cac              cost to acquire that customer
  service_cost     cost to service that customer in the first 30 days (default 0)

Verdicts:
  ratio = thirty_day_cash / (cac + service_cost)
  ratio >= 1  -> customer pays for themselves in 30 days (CFA achieved)
  ratio >= 2  -> pays for themselves AND >=1 more customer ($100M territory)
  ratio <  1  -> cash is trapped; pull cash forward (money-model-designer)

CLI:
  python cfa.py --thirty-day-cash 30 --cac 30
  python cfa.py --thirty-day-cash 10 --cac 30 --target-multiple 2
  echo '{"thirty_day_cash":30,"cac":30}' | python cfa.py --stdin
"""
import argparse
import json
import sys


def analyze(thirty_day_cash, cac, service_cost=0.0, target_multiple=2.0):
    total_cost = cac + service_cost
    if total_cost <= 0:
        raise ValueError("cac + service_cost must be > 0")
    ratio = round(thirty_day_cash / total_cost, 2)
    out = {
        "thirty_day_cash": round(thirty_day_cash, 2),
        "cac": round(cac, 2),
        "service_cost": round(service_cost, 2),
        "total_30day_cost": round(total_cost, 2),
        "cfa_ratio": ratio,
        "cfa_achieved": ratio >= 1.0,
        "additional_customers_funded": int(ratio) - 1 if ratio >= 1 else 0,
        "hits_target_multiple": ratio >= target_multiple,
        "target_multiple": target_multiple,
    }
    if ratio >= target_multiple:
        out["verdict"] = (
            f"Strong CFA ({ratio}). One customer funds {int(ratio)-1} more in 30 days — scale aggressively."
        )
        out["route"] = None
    elif ratio >= 1.0:
        out["verdict"] = f"CFA achieved ({ratio}). Customers pay for themselves in 30 days."
        out["route"] = None
    else:
        shortfall = round(total_cost - thirty_day_cash, 2)
        out["verdict"] = (
            f"CFA NOT achieved ({ratio}). ${shortfall} of acquisition cost is unrecovered in 30 days — cash is trapped."
        )
        out["route"] = "money-model-designer"
        out["reason"] = (
            "Pull cash forward: add an upsell/downsell or restructure payment terms so 30-day cash "
            "covers acquisition. (See the $100 upsell example in financial-spine.md.)"
        )
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--thirty-day-cash", type=float)
    p.add_argument("--cac", type=float)
    p.add_argument("--service-cost", type=float, default=0.0)
    p.add_argument("--target-multiple", type=float, default=2.0)
    p.add_argument("--stdin", action="store_true")
    args = p.parse_args(argv)
    if args.stdin:
        data = json.load(sys.stdin)
        for k, v in data.items():
            setattr(args, k.replace("-", "_"), v)
    if args.thirty_day_cash is None or args.cac is None:
        print(json.dumps({"error": "provide --thirty-day-cash and --cac"}))
        return 1
    try:
        result = analyze(args.thirty_day_cash, args.cac, args.service_cost, args.target_multiple)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
