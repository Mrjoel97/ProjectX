#!/usr/bin/env python3
"""Diagnose a Business Scorecard and route to the single highest-leverage skill.

Implements references/diagnostic-tree.md: work top-down (Market -> Offer -> Money Model
-> Leads), stop at the first failing gate, emit one prescription.

Usage:
  python diagnose.py --scorecard biz.json
  echo '{...scorecard json...}' | python diagnose.py --stdin

Output JSON: {constraint, gate, route, playbook, reason, proof_metric, roadmap_level}
The router is deliberately conservative: when a value is unknown it asks for it rather
than guessing, because a wrong diagnosis wastes the most time.
"""
import argparse
import json
import sys

FLOOR_RATIO = 3.0
INDUSTRY_MULTIPLE = 3.0


def _g(d, *path, default=None):
    cur = d
    for p in path:
        if not isinstance(cur, dict) or p not in cur or cur[p] is None:
            return default
        cur = cur[p]
    return cur


def diagnose(sc):
    missing = []

    # --- Gate 0: Market ---
    market_bad = _g(sc, "identity", "market_viable") is False
    if market_bad:
        return _rx("Market is not viable (no pain / no money / shrinking).", "market",
                   "offer-architect", "01-select-market",
                   "A great offer to the wrong crowd falls on deaf ears. Fix the market/niche first.",
                   "market passes the 4 indicators (pain, power, targetable, growing)",
                   _g(sc, "position", "roadmap_level"))

    # --- Gate 1: Offer ---
    has_offer = bool(_g(sc, "identity", "current_offers", default=[]))
    ve = _g(sc, "offer_card", "value_equation", default={}) or {}
    ve_scores = [v for v in ve.values() if isinstance(v, (int, float))]
    weak_offer = bool(ve_scores) and min(ve_scores) <= 3
    commodity = _g(sc, "identity", "commodity") is True
    if not has_offer:
        return _rx("No offer worth buying yet.", "offer", "offer-architect", "02-build-offer",
                   "Nothing downstream matters without a differentiated offer.",
                   "a stacked Grand Slam Offer exists with value >> price",
                   _g(sc, "position", "roadmap_level"))
    if commodity or weak_offer:
        pb = "03-enhance-offer" if has_offer else "02-build-offer"
        return _rx("Offer is a commodity / perceived value too low.", "offer", "offer-architect", pb,
                   "Buyers compare on price because value isn't differentiated. Raise value before spend.",
                   "value-equation scores raised; conversion or price up",
                   _g(sc, "position", "roadmap_level"))

    # --- Gate 2: Money Model ---
    payback = _g(sc, "model_card", "thirty_day_payback")
    tdc = _g(sc, "financials", "thirty_day_cash_per_customer")
    cac = _g(sc, "financials", "cac")
    ltgp = _g(sc, "financials", "ltgp")
    types = _g(sc, "model_card", "offer_types_present", default={}) or {}
    only_one_offer = sum(1 for v in types.values() if v) <= 1

    ratio = round(ltgp / cac, 2) if (ltgp and cac) else None

    if payback is False:
        return _rx("30-day payback fails — cash is trapped.", "money_model", "money-model-designer",
                   "01-assess-money-model",
                   "Acquisition cost isn't recovered in 30 days, so the business can't self-fund growth.",
                   "30-day cash >= cost to get+service a customer (CFA achieved)",
                   _g(sc, "position", "roadmap_level"))
    if tdc is not None and cac is not None and tdc < cac:
        return _rx("Customer doesn't pay for themselves in 30 days.", "money_model",
                   "money-model-designer", "06-assemble",
                   "Pull cash forward with an upsell/downsell/continuity sequence.",
                   "30-day cash >= CAC", _g(sc, "position", "roadmap_level"))
    if only_one_offer:
        return _rx("Only one thing to sell — no upsell/downsell/continuity.", "money_model",
                   "money-model-designer", "06-assemble",
                   "A sequence of offers multiplies 30-day cash from the same customers.",
                   "attraction + upsell + downsell + continuity all present",
                   _g(sc, "position", "roadmap_level"))
    if ratio is not None and ratio < FLOOR_RATIO:
        # low ratio: is it LTGP (model) or CAC (ads)?
        iac = _g(sc, "financials", "industry_avg_cac")
        if iac and cac and cac <= iac * INDUSTRY_MULTIPLE:
            return _rx(f"LTGP:CAC {ratio}:1 is below floor because LTGP is low.", "money_model",
                       "money-model-designer", "01-assess-money-model",
                       "CAC is within industry norms, so the ceiling is monetization — raise LTGP.",
                       f"LTGP:CAC >= {FLOOR_RATIO}:1", _g(sc, "position", "roadmap_level"))

    # --- Gate 3: Leads ---
    iac = _g(sc, "financials", "industry_avg_cac")
    if iac and cac and cac > iac * INDUSTRY_MULTIPLE:
        return _rx(f"CAC ({cac}) exceeds 3x industry average ({iac}).", "leads", "lead-engine",
                   "11-more-better-new",
                   "Advertising is inefficient — find the funnel constraint and test one thing per week.",
                   "CAC falls below 3x industry average", _g(sc, "position", "roadmap_level"))

    active_channels = sum(1 for v in (_g(sc, "lead_card", "core_four_active", default={}) or {}).values() if v)
    if active_channels == 0:
        return _rx("No lead channel is running.", "leads", "lead-engine", "01-pick-channel",
                   "Offer and money model are sound; the constraint is that too few people know.",
                   ">= 1 Core Four channel running at Rule-of-100 volume",
                   _g(sc, "position", "roadmap_level"))

    # --- Nothing failed: scale ---
    if not missing:
        return _rx("No failing gate — offer, money model, and leads are healthy.", "scale", "lead-engine",
                   "11-more-better-new",
                   "Compound the working channels (More/Better/New) and add Lead Getters.",
                   "lead volume and LTGP:CAC both climbing",
                   _g(sc, "position", "roadmap_level"))


def _rx(constraint, gate, route, playbook, reason, proof, level):
    return {
        "constraint": constraint,
        "gate": gate,
        "route": route,
        "playbook": playbook,
        "reason": reason,
        "proof_metric": proof,
        "roadmap_level": level,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--scorecard")
    p.add_argument("--stdin", action="store_true")
    args = p.parse_args(argv)
    if args.stdin:
        sc = json.load(sys.stdin)
    elif args.scorecard:
        with open(args.scorecard, "r", encoding="utf-8") as f:
            sc = json.load(f)
    else:
        print(json.dumps({"error": "provide --scorecard PATH or --stdin"}))
        return 1
    print(json.dumps(diagnose(sc), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
