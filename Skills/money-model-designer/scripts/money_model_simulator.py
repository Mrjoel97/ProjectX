#!/usr/bin/env python3
"""Project a full money model: 30-day cash and 12-month LTGP per 100 leads.

Feed the four offer types you've designed (attraction, upsell, downsell,
continuity) and this simulates the whole sequence over a batch of leads:
how much cash arrives in the first 30 days (the number that funds the next
batch of ads) versus the full 12-month gross profit those same customers throw
off. See the offer-type references for what each stage does.

Each offer is {price, margin, take_rate}:
  attraction.take_rate = fraction of LEADS who become customers
  upsell/downsell/continuity.take_rate = fraction of CUSTOMERS who take it
  continuity also takes "months" = number of monthly payments (capped at 12
  for the LTGP window). Its first month counts toward 30-day cash.

Input JSON (all offers optional):
  {
    "leads": 100,
    "attraction":  {"price":600, "margin":1.0, "take_rate":0.25},
    "upsell":      {"price":80,  "margin":1.0, "take_rate":1.0},
    "downsell":    {"price":300, "margin":1.0, "take_rate":0.1},
    "continuity":  {"price":199, "margin":0.9, "take_rate":0.5, "months":10}
  }

CLI:
  echo '{"leads":100,"attraction":{"price":600,"take_rate":0.25},"upsell":{"price":80}}' | python money_model_simulator.py --stdin
  python money_model_simulator.py --file model.json

Worked example (gym-style, per 100 leads):
  attraction $600 @25% of leads -> 25 customers -> $15,000 in 30 days
  + $80 supplements to all 25 -> +$2,000 -> $17,000 30-day cash per 100 leads.
"""
import argparse
import json
import sys

LTGP_MONTHS_CAP = 12


def _offer(d):
    if not d:
        return None
    return {
        "price": float(d["price"]),
        "margin": float(d.get("margin", 1.0)),
        "take_rate": float(d.get("take_rate", 1.0)),
        "months": int(d.get("months", 1)),
    }


def simulate(model):
    leads = float(model.get("leads", 100))
    attraction = _offer(model.get("attraction"))
    upsell = _offer(model.get("upsell"))
    downsell = _offer(model.get("downsell"))
    continuity = _offer(model.get("continuity"))

    # customers = leads who take the attraction offer
    if attraction:
        customers = leads * attraction["take_rate"]
        attraction_cash = customers * attraction["price"] * attraction["margin"]
    else:
        customers = leads
        attraction_cash = 0.0

    def one_time(o):
        if not o:
            return 0.0
        return customers * o["price"] * o["margin"] * o["take_rate"]

    upsell_cash = one_time(upsell)
    downsell_cash = one_time(downsell)

    if continuity:
        cont_customers = customers * continuity["take_rate"]
        monthly_gp = continuity["price"] * continuity["margin"]
        cont_first_month = cont_customers * monthly_gp
        cont_months = min(continuity["months"], LTGP_MONTHS_CAP)
        cont_ltgp = cont_customers * monthly_gp * cont_months
    else:
        cont_customers = 0.0
        cont_first_month = 0.0
        cont_ltgp = 0.0

    thirty_day_cash = attraction_cash + upsell_cash + downsell_cash + cont_first_month
    twelve_month_ltgp = attraction_cash + upsell_cash + downsell_cash + cont_ltgp

    per_customer_30 = thirty_day_cash / customers if customers else 0.0

    return {
        "leads": round(leads, 2),
        "customers": round(customers, 2),
        "continuity_customers": round(cont_customers, 2),
        "cash_by_stage": {
            "attraction": round(attraction_cash, 2),
            "upsell": round(upsell_cash, 2),
            "downsell": round(downsell_cash, 2),
            "continuity_first_month": round(cont_first_month, 2),
        },
        "thirty_day_cash_total": round(thirty_day_cash, 2),
        "thirty_day_cash_per_customer": round(per_customer_30, 2),
        "twelve_month_ltgp_total": round(twelve_month_ltgp, 2),
        "twelve_month_ltgp_per_customer": round(twelve_month_ltgp / customers, 2) if customers else 0.0,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--file", help="path to a JSON model file")
    p.add_argument("--stdin", action="store_true", help="read the JSON model from stdin")
    args = p.parse_args(argv)

    if args.stdin:
        model = json.load(sys.stdin)
    elif args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            model = json.load(f)
    else:
        print(json.dumps({"error": "provide --stdin or --file"}))
        return 1

    try:
        result = simulate(model)
    except (ValueError, KeyError) as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
