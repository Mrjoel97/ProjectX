#!/usr/bin/env python3
"""30-day cash of a full offer sequence vs the cost to get + service a customer.

Answers the money-model question: across ALL the offers a customer can take in
the first 30 days (attraction + upsell + downsell + first continuity payment),
does one customer produce more 30-day profit than it costs to get AND service
them? If yes, acquisition is self-funding and you can "get paid to get customers."

(Terminology: this book says "cost to get and service", "30-day cash/profit",
"getting paid to get customers." The canonical metric definitions live in
../../growth-os/references/financial-spine.md — this tool does not redefine them.)

Inputs:
  offers        list of offers, each {price, margin, take_rate}
                  price      full price of the offer
                  margin     gross margin fraction 0..1 (default 1.0)
                  take_rate  fraction of customers who buy it 0..1 (default 1.0)
                30-day cash per customer = sum(price * margin * take_rate)
  cost_to_get     cost to acquire one customer (optional)
  cost_to_service cost to service one customer in first 30 days (default 0)
  target_multiple the "$100M" target (default 2.0 = fund 2+ more customers)

Output: 30-day cash per customer, the cash multiple over get+service cost,
and the success tier (baseline money model vs $100M target).

CLI:
  python cfa_calculator.py --offers '[{"price":600},{"price":80}]' --cost-to-get 20
  echo '{"offers":[{"price":15,"margin":0.667},{"price":100,"take_rate":0.2}],"cost_to_get":30}' | python cfa_calculator.py --stdin

Worked examples from the book:
  Gym:  $600 core + $80 supplements = $680 per customer; ~$20 to get one
        -> 34x -> "$1 in, $34 out."
  Micro: $15/mo membership ($10 GP) + $100 upsell taken by 1 in 5 (+$20)
        = $30 in 30 days; $30 to get one -> breaks even in month 1 ("free customers").
"""
import argparse
import json
import sys


def offer_cash(offer):
    price = float(offer["price"])
    margin = float(offer.get("margin", 1.0))
    take_rate = float(offer.get("take_rate", 1.0))
    return round(price * margin * take_rate, 2)


def analyze(offers, cost_to_get=None, cost_to_service=0.0, target_multiple=2.0):
    breakdown = []
    total = 0.0
    for o in offers:
        c = offer_cash(o)
        total += c
        breakdown.append({
            "name": o.get("name"),
            "price": float(o["price"]),
            "margin": float(o.get("margin", 1.0)),
            "take_rate": float(o.get("take_rate", 1.0)),
            "cash_per_customer": c,
        })
    total = round(total, 2)
    out = {
        "offers": breakdown,
        "thirty_day_cash_per_customer": total,
    }
    if cost_to_get is None:
        out["verdict"] = f"30-day cash per customer = ${total}. Provide --cost-to-get to test payback."
        return out

    get_and_service = round(cost_to_get + cost_to_service, 2)
    if get_and_service <= 0:
        raise ValueError("cost_to_get + cost_to_service must be > 0")
    multiple = round(total / get_and_service, 2)
    additional = int(multiple) - 1 if multiple >= 1 else 0
    out.update({
        "cost_to_get": round(cost_to_get, 2),
        "cost_to_service": round(cost_to_service, 2),
        "cost_to_get_and_service": get_and_service,
        "cash_multiple": multiple,
        "additional_customers_funded": additional,
        "target_multiple": target_multiple,
    })
    if multiple >= target_multiple:
        out["tier"] = "$100M target"
        out["verdict"] = (
            f"${total} in 30 days on ${get_and_service} to get + service = {multiple}x. "
            f"One customer funds {additional} more within 30 days. You get paid to get customers."
        )
    elif multiple >= 1.0:
        out["tier"] = "money model (baseline)"
        out["verdict"] = (
            f"${total} in 30 days on ${get_and_service} = {multiple}x. "
            "Customers cover their own get + service cost in 30 days."
        )
    else:
        shortfall = round(get_and_service - total, 2)
        out["tier"] = "not yet a money model"
        out["verdict"] = (
            f"${total} in 30 days on ${get_and_service} = {multiple}x. "
            f"${shortfall} of get + service cost is unrecovered in 30 days — cash is trapped. "
            "Add an upsell/downsell/continuity or restructure payment terms to pull cash forward."
        )
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--offers", help="JSON list of offers, each {price, margin, take_rate}")
    p.add_argument("--cost-to-get", type=float, default=None)
    p.add_argument("--cost-to-service", type=float, default=0.0)
    p.add_argument("--target-multiple", type=float, default=2.0)
    p.add_argument("--stdin", action="store_true", help="read a full JSON object from stdin")
    args = p.parse_args(argv)

    if args.stdin:
        data = json.load(sys.stdin)
        offers = data.get("offers", [])
        cost_to_get = data.get("cost_to_get", args.cost_to_get)
        cost_to_service = data.get("cost_to_service", args.cost_to_service)
        target_multiple = data.get("target_multiple", args.target_multiple)
    else:
        if not args.offers:
            print(json.dumps({"error": "provide --offers JSON or --stdin"}))
            return 1
        offers = json.loads(args.offers)
        cost_to_get = args.cost_to_get
        cost_to_service = args.cost_to_service
        target_multiple = args.target_multiple

    try:
        result = analyze(offers, cost_to_get, cost_to_service, target_multiple)
    except (ValueError, KeyError) as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
