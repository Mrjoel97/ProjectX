#!/usr/bin/env python3
"""Cold outreach solver — solve the cold equation for X (how many to contact).

The cold equation (from $100M Leads): "for every X people you contact, you get Y
customers. Solve for X." Overall conversion is the product of the per-step rates
(e.g. contact -> reply -> customer). To hit a customer target, work backwards:

    contacts_needed = target_customers / overall_conversion_rate

Then spread the workload: contacts_per_day = contacts_needed / days, and split
that across senders (one email domain/account safely sends a limited volume/day).

CLI:
  # explicit per-step rates (contact->reply 30%, reply->customer 3.33%):
  python cold_outreach_solver.py --customers 100 --rates 0.30,0.0333 --days 30 --senders 3
  # or just "how many contacts per customer" (100 emails -> 1 customer = 100):
  python cold_outreach_solver.py --customers 100 --contacts-per-customer 100 --days 30 --senders 3
  echo '{"customers":100,"contacts_per_customer":100,"days":30,"senders":3}' \
      | python cold_outreach_solver.py --stdin
Outputs JSON.

Worked example (the book's email case):
  100 emails -> 1 customer (overall 1%). Want 100 customers.
    contacts_needed = 100 / 0.01 = 10,000 emails
    over 30 days     = ~333 emails/day
    across 3 senders = ~111 emails/day each
"""
import argparse
import json
import sys


def solve(customers, overall_rate=None, contacts_per_customer=None,
          days=30, senders=1, sender_capacity=None):
    if customers <= 0:
        raise ValueError("customers must be > 0")

    if overall_rate is None and contacts_per_customer is None:
        raise ValueError("provide --rates / --overall-rate OR --contacts-per-customer")
    if overall_rate is not None:
        if not 0 < overall_rate <= 1:
            raise ValueError("overall_rate must be in (0, 1]")
        contacts_per_customer = 1 / overall_rate
    else:
        if contacts_per_customer <= 0:
            raise ValueError("contacts_per_customer must be > 0")
        overall_rate = 1 / contacts_per_customer

    if days <= 0:
        raise ValueError("days must be > 0")

    contacts_needed = customers * contacts_per_customer
    per_day = round(contacts_needed / days)

    out = {
        "target_customers": customers,
        "overall_conversion_rate": round(overall_rate, 6),
        "contacts_per_customer": round(contacts_per_customer, 2),
        "contacts_needed": round(contacts_needed),
        "days": days,
        "contacts_per_day": per_day,
    }

    # Two ways to split: fixed number of senders, or derive senders from capacity.
    if sender_capacity is not None:
        if sender_capacity <= 0:
            raise ValueError("sender_capacity must be > 0")
        senders_needed = max(1, -(-per_day // sender_capacity))  # ceil
        out["sender_daily_capacity"] = sender_capacity
        out["senders_needed"] = int(senders_needed)
        out["contacts_per_sender_per_day"] = round(per_day / senders_needed)
    else:
        if senders <= 0:
            raise ValueError("senders must be > 0")
        out["senders"] = int(senders)
        out["contacts_per_sender_per_day"] = round(per_day / senders)

    out["equation"] = (
        f"{out['contacts_needed']} contacts = {customers} customers "
        f"at {round(overall_rate*100, 4)}% overall conversion"
    )
    out["rule"] = "Master rule: LTGP must be >= 3x the cost to get a customer (3:1 minimum)."
    return out


def _overall_from_rates(rates):
    prod = 1.0
    for r in rates:
        r = float(r)
        if r > 1:
            r = r / 100.0
        if not 0 < r <= 1:
            raise ValueError(f"each rate must be in (0, 1] (or a percent); got {r}")
        prod *= r
    return prod


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--customers", type=float, help="target number of customers")
    p.add_argument("--rates", help="per-step conversion rates, comma-separated (product = overall)")
    p.add_argument("--overall-rate", type=float, help="overall contact->customer conversion (0-1)")
    p.add_argument("--contacts-per-customer", type=float, help="contacts needed per customer (e.g. 100)")
    p.add_argument("--days", type=float, default=30)
    p.add_argument("--senders", type=float, default=1)
    p.add_argument("--sender-capacity", type=float, help="max contacts one sender does per day (derives sender count)")
    p.add_argument("--stdin", action="store_true", help="read a JSON object of fields from stdin")
    args = p.parse_args(argv)

    if args.stdin:
        data = json.load(sys.stdin)
        for k, v in data.items():
            setattr(args, k.replace("-", "_"), v)

    try:
        overall = args.overall_rate
        if overall is None and args.rates:
            overall = _overall_from_rates(str(args.rates).split(","))
        if args.customers is None:
            raise ValueError("provide --customers")
        result = solve(
            customers=args.customers,
            overall_rate=overall,
            contacts_per_customer=args.contacts_per_customer,
            days=args.days,
            senders=args.senders,
            sender_capacity=args.sender_capacity,
        )
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
