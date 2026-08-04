#!/usr/bin/env python3
"""Offer stack builder — sum named bundle values, set a price, show the discrepancy.

Step 5b of the Grand Slam build (see playbooks/02-build-offer.md): after trimming,
you STACK the survivors. Each item gets a dollar value; you sum them to a large total,
then reveal a much lower price. The price-to-value discrepancy is what makes the offer
feel like "money at a discount."

Input: a list of items, each {"name": str, "value": number}, plus a price.
Output: the stack presentation, total value, price, savings, and value-to-price ratio.

CLI (inline items):
  python offer_stack_builder.py --price 599 \
      --item "Core Program:1000" --item "Bonus Toolkit:351" --item "Group Coaching:3000"

CLI (JSON via stdin):
  echo '{"price":599,"items":[{"name":"Core","value":1000},{"name":"Toolkit","value":351}]}' \
      | python offer_stack_builder.py --stdin
Outputs JSON.

Worked example (from $100M Offers): items summing to $4,351 offered for $599
  -> total_value 4351, price 599, ratio 7.26x, you save $3,752.
"""
import argparse
import json
import sys


def build_stack(items, price):
    """items: list of {'name', 'value'}; price: number. Returns the stack presentation."""
    clean = []
    total = 0.0
    for it in items:
        name = it.get("name", "").strip()
        if not name:
            raise ValueError("every item needs a name")
        value = float(it.get("value", 0))
        if value < 0:
            raise ValueError(f"item '{name}' has a negative value")
        clean.append({"name": name, "value": round(value, 2)})
        total += value
    price = float(price)
    if price < 0:
        raise ValueError("price cannot be negative")
    total = round(total, 2)
    ratio = round(total / price, 2) if price > 0 else None
    return {
        "items": clean,
        "item_count": len(clean),
        "total_value": total,
        "price": round(price, 2),
        "savings": round(total - price, 2),
        "value_to_price_ratio": ratio,
        "presentation": _render(clean, total, price, ratio),
    }


def _render(items, total, price, ratio):
    lines = [f"  {it['name']}: ${it['value']:,.0f}" for it in items]
    body = "\n".join(lines)
    ratio_str = f"{ratio}x value" if ratio is not None else "n/a"
    return (
        f"{body}\n"
        f"  {'-' * 28}\n"
        f"  Total value: ${total:,.0f}\n"
        f"  Today's price: ${price:,.0f}  ({ratio_str}, you save ${total - price:,.0f})"
    )


def _parse_inline_item(raw):
    """'Name:1234' -> {'name': 'Name', 'value': 1234}. Name may contain colons; last wins."""
    if ":" not in raw:
        raise ValueError(f"item '{raw}' must be in NAME:VALUE form")
    name, _, value = raw.rpartition(":")
    return {"name": name.strip(), "value": float(value)}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--item", action="append", default=[], help="NAME:VALUE (repeatable)")
    p.add_argument("--price", type=float, help="the price to offer the stack for")
    p.add_argument("--stdin", action="store_true", help="read {items:[...], price:n} JSON from stdin")
    args = p.parse_args(argv)

    if args.stdin:
        data = json.load(sys.stdin)
        items = data.get("items", [])
        price = data.get("price")
    else:
        try:
            items = [_parse_inline_item(r) for r in args.item]
        except ValueError as e:
            print(json.dumps({"error": str(e)}))
            return 1
        price = args.price

    if not items:
        print(json.dumps({"error": "no items provided"}))
        return 1
    if price is None:
        print(json.dumps({"error": "no price provided"}))
        return 1

    try:
        result = build_stack(items, price)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
