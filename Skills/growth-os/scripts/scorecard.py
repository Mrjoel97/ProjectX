#!/usr/bin/env python3
"""Business Scorecard — create / load / update / read the single source of truth.

The Scorecard is one JSON file per business. Every specialist skill reads and writes
it so the self-improvement loop has memory. Schema: assets/business-scorecard.template.json.

Commands:
  init [--out PATH] [--name NAME]           create a fresh scorecard from the template
  get  --scorecard PATH --path a.b.c        read a dotted field
  set  --scorecard PATH --path a.b.c --value JSON   set a dotted field (value parsed as JSON, falls back to string)
  log  --scorecard PATH --entry JSON        append an entry to history[]
  show --scorecard PATH                     print the whole scorecard

Examples:
  python scorecard.py init --out biz.json --name "Acme Gym"
  python scorecard.py set --scorecard biz.json --path financials.cac --value 300
  python scorecard.py set --scorecard biz.json --path identity.market --value '"local fitness"'
  python scorecard.py log --scorecard biz.json --entry '{"constraint":"weak offer","route":"offer-architect"}'
"""
import argparse
import json
import os

TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "..", "assets", "business-scorecard.template.json")


def load_template():
    with open(TEMPLATE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _dotted_get(data, dotted):
    cur = data
    for part in dotted.split("."):
        cur = cur[part]
    return cur


def _dotted_set(data, dotted, value):
    parts = dotted.split(".")
    cur = data
    for part in parts[:-1]:
        cur = cur[part]
    cur[parts[-1]] = value


def _parse_value(raw):
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw


def cmd_init(args):
    data = load_template()
    if args.name:
        data["business_name"] = args.name
    out = args.out or "business-scorecard.json"
    save(out, data)
    print(json.dumps({"created": out, "business_name": data["business_name"]}, indent=2))


def cmd_get(args):
    data = load(args.scorecard)
    print(json.dumps(_dotted_get(data, args.path), indent=2))


def cmd_set(args):
    data = load(args.scorecard)
    _dotted_set(data, args.path, _parse_value(args.value))
    save(args.scorecard, data)
    print(json.dumps({"set": args.path, "value": _dotted_get(data, args.path)}, indent=2))


def cmd_log(args):
    data = load(args.scorecard)
    entry = _parse_value(args.entry)
    data.setdefault("history", []).append(entry)
    save(args.scorecard, data)
    print(json.dumps({"logged": entry, "history_len": len(data["history"])}, indent=2))


def cmd_show(args):
    print(json.dumps(load(args.scorecard), indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("init"); s.add_argument("--out"); s.add_argument("--name"); s.set_defaults(func=cmd_init)
    s = sub.add_parser("get"); s.add_argument("--scorecard", required=True); s.add_argument("--path", required=True); s.set_defaults(func=cmd_get)
    s = sub.add_parser("set"); s.add_argument("--scorecard", required=True); s.add_argument("--path", required=True); s.add_argument("--value", required=True); s.set_defaults(func=cmd_set)
    s = sub.add_parser("log"); s.add_argument("--scorecard", required=True); s.add_argument("--entry", required=True); s.set_defaults(func=cmd_log)
    s = sub.add_parser("show"); s.add_argument("--scorecard", required=True); s.set_defaults(func=cmd_show)

    args = p.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
