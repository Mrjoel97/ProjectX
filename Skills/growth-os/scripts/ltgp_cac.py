#!/usr/bin/env python3
"""LTGP, CAC, and the LTGP:CAC health ratio — the growth spine metric.

Definitions (see references/financial-spine.md):
  LTGP = gross_profit_per_purchase * purchases_over_lifetime   (gross profit, not revenue)
  CAC  = total_acquisition_spend / customers_acquired
  ratio = LTGP / CAC   (floor 3:1; higher is better)

Master switch: compare CAC to industry-average CAC.
  CAC below ~3x industry avg -> ceiling is the business model -> raise LTGP.
  CAC above ~3x industry avg -> ceiling is advertising      -> lower CAC.

CLI:
  python ltgp_cac.py --gp-per-purchase 900 --purchases 5 --acq-spend 30000 --customers 30
  python ltgp_cac.py --ltgp 4500 --cac 1000 --industry-avg-cac 400
  echo '{"ltgp":4500,"cac":1000,"industry_avg_cac":400}' | python ltgp_cac.py --stdin
Outputs JSON.
"""
import argparse
import json
import sys

FLOOR_RATIO = 3.0
INDUSTRY_MULTIPLE = 3.0


def ltgp(gp_per_purchase: float, purchases: float) -> float:
    return round(gp_per_purchase * purchases, 2)


def cac(acq_spend: float, customers: float) -> float:
    if customers <= 0:
        raise ValueError("customers must be > 0")
    return round(acq_spend / customers, 2)


def analyze(ltgp_val, cac_val, industry_avg_cac=None):
    if cac_val is None or cac_val <= 0:
        raise ValueError("cac must be > 0")
    ratio = round(ltgp_val / cac_val, 2)
    out = {
        "ltgp": round(ltgp_val, 2),
        "cac": round(cac_val, 2),
        "ltgp_cac_ratio": ratio,
        "scalable": ratio >= FLOOR_RATIO,
        "floor_ratio": FLOOR_RATIO,
    }
    if ratio < FLOOR_RATIO:
        out["verdict"] = f"BELOW FLOOR ({ratio}:1 < {FLOOR_RATIO}:1) — struggles to scale."
    else:
        out["verdict"] = f"Scalable ({ratio}:1 >= {FLOOR_RATIO}:1)."
    if industry_avg_cac and industry_avg_cac > 0:
        threshold = industry_avg_cac * INDUSTRY_MULTIPLE
        out["industry_avg_cac"] = round(industry_avg_cac, 2)
        out["cac_vs_industry_threshold"] = round(threshold, 2)
        if cac_val > threshold:
            out["bottleneck"] = "advertising"
            out["route"] = "lead-engine"
            out["reason"] = (
                f"CAC {cac_val} is above 3x industry average ({threshold}). "
                "Advertising is inefficient — lower CAC."
            )
        else:
            out["bottleneck"] = "business_model"
            out["route"] = "offer-architect / money-model-designer"
            out["reason"] = (
                f"CAC {cac_val} is below 3x industry average ({threshold}). "
                "The ceiling is the business model — raise LTGP."
            )
    return out


def _resolve(args):
    ltgp_val = args.ltgp
    if ltgp_val is None:
        if args.gp_per_purchase is None or args.purchases is None:
            raise ValueError("provide --ltgp OR both --gp-per-purchase and --purchases")
        ltgp_val = ltgp(args.gp_per_purchase, args.purchases)
    cac_val = args.cac
    if cac_val is None:
        if args.acq_spend is None or args.customers is None:
            raise ValueError("provide --cac OR both --acq-spend and --customers")
        cac_val = cac(args.acq_spend, args.customers)
    return analyze(ltgp_val, cac_val, args.industry_avg_cac)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ltgp", type=float)
    p.add_argument("--gp-per-purchase", type=float)
    p.add_argument("--purchases", type=float)
    p.add_argument("--cac", type=float)
    p.add_argument("--acq-spend", type=float)
    p.add_argument("--customers", type=float)
    p.add_argument("--industry-avg-cac", type=float)
    p.add_argument("--stdin", action="store_true", help="read a JSON object of fields from stdin")
    args = p.parse_args(argv)
    if args.stdin:
        data = json.load(sys.stdin)
        for k, v in data.items():
            setattr(args, k.replace("-", "_"), v)
    try:
        result = _resolve(args)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
