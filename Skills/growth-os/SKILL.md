---
name: growth-os
description: Use when an entrepreneur or business owner wants to grow, is stuck, unsure what to work on next, has weak sales, can't afford customer acquisition, isn't scaling, or asks "what should I do to make more money" — diagnoses the business, decides the single highest-leverage bottleneck, and routes to the offer, money-model, or lead skill that fixes it.
---

# Growth OS — the diagnostic router

## Overview
Growth OS is the brain of a self-improvement loop for a business. It never guesses what to work on. It **diagnoses** the business, finds the **one** constraint costing the most money right now, and routes to exactly one specialist skill to fix it — then re-measures and loops. Core principle (from Hormozi's $100M series): a business grows fastest when you fix the current bottleneck, not the one you enjoy working on.

Three specialist skills do the actual work; Growth OS decides **which one, when, and why**:
- **offer-architect** — build/upgrade the thing being sold (a Grand Slam Offer).
- **money-model-designer** — sequence offers so the business gets *paid* to acquire customers.
- **lead-engine** — get more engaged leads (Core Four + Lead Getters).

## When to use
- The user wants growth but hasn't said which lever ("help me make more money", "we're stuck", "what next?").
- Any time before running a specialist skill, to confirm it's the right one.
- After a specialist skill finishes, to measure the result and pick the next move.
- Skip only when the user explicitly names a single narrow task already covered by one specialist ("write me a guarantee") — then go straight there.

## The loop
```
1. DIAGNOSE     build or load the Business Scorecard (scripts/scorecard.py)
2. LOCATE       place on the 7-Level Roadmap + find the constraint
3. PRESCRIBE    bottleneck -> ONE skill -> ONE playbook (scripts/diagnose.py)
4. EXECUTE      hand off to that skill; it produces a concrete artifact
5. MEASURE      write outcomes back into the Scorecard
6. RE-DIAGNOSE  loop; the next bottleneck surfaces
```

## How to run it
1. **Load or create the Scorecard.** `python scripts/scorecard.py init` (or `load <path>`). It is the single source of truth for this business; every specialist reads and writes it. Schema + fields: `assets/business-scorecard.template.json`.
2. **Fill what you can from the conversation**, then compute the financial spine: `python scripts/ltgp_cac.py` and `python scripts/cfa.py`. Definitions and worked examples: `references/financial-spine.md`. If you lack numbers, ask the user for them — the diagnosis is only as good as `LTGP`, `CAC`, and 30-day cash.
3. **Diagnose + route.** `python scripts/diagnose.py --scorecard <path>` returns the constraint, the roadmap level, the prescribed skill, and the reason. The full decision logic (so you can explain it, not just quote it) is in `references/diagnostic-tree.md`.
4. **Hand off.** Announce the prescription and its reason, then invoke the named skill. Pass the Scorecard path so the specialist works in context.
5. **Measure + loop.** When the specialist returns an artifact, record the new numbers with `scripts/scorecard.py update` and re-diagnose.

## The routing rules (summary — full logic in references/diagnostic-tree.md)
| Symptom | Constraint | Route to |
|---|---|---|
| No offer, commodity, price-driven, low perceived value | Weak offer | **offer-architect** (gate on `Market > Offer > Persuasion` first) |
| Customers exist but business is broke / can't fund acquisition / 30-day payback fails / `LTGP:CAC < 3` because LTGP is low | Weak monetization | **money-model-designer** |
| Solid offer + money model but too few people know | Too few leads | **lead-engine** (channel by time-vs-money) |
| `CAC > 3x` industry average | Advertising is inefficient | **lead-engine** (Better / constraint testing) |
| `CAC < 3x` industry average but still not scaling | Business model is the limit | **offer-architect** / **money-model-designer** |

## The master switch (memorize)
`LTGP:CAC` is the health metric. Minimum viable is **3:1**. If `CAC` is **below** ~3x the industry average, the ceiling is the **business model** → fix LTGP (offers, money model). If `CAC` is **above** ~3x average, the ceiling is **advertising** → fix CAC (lead-engine). This one rule resolves most "which skill?" questions.

## Files
- `references/financial-spine.md` — canonical definitions: LTGP, CAC, LTGP:CAC, 30-day cash, CFA. All specialists defer to these.
- `references/diagnostic-tree.md` — the full diagnose-and-route decision tree with the reasons behind each branch.
- `references/roadmap-7-levels.md` — the 7 levels from "friends know" to "$100M machine"; sets the primary action per level.
- `scripts/scorecard.py` — create / load / update / read the Business Scorecard (JSON). Run `--help`.
- `scripts/ltgp_cac.py` — compute LTGP, CAC, ratio; compare to industry average. Run `--help`.
- `scripts/cfa.py` — 30-day cash vs cost to acquire+service; the "get paid to acquire" test. Run `--help`.
- `scripts/diagnose.py` — the router: scorecard in, prescription out. Run `--help`.
- `assets/business-scorecard.template.json` — the Scorecard schema.

## Attribution
Frameworks derived from Alex Hormozi's $100M series ($100M Offers, $100M Money Models, $100M Leads). Methods encoded as executable procedures; book text not reproduced.
