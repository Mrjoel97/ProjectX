# Growth OS — Hormozi Skill Suite Design Spec

**Date:** 2026-07-24
**Status:** Approved (design), building
**Format:** Anthropic Agent Skills (SKILL.md folders)
**Audience the agent serves:** entrepreneurs / business owners
**Source material:** frameworks derived from Alex Hormozi's $100M series — *$100M Offers*, *$100M Money Models*, *$100M Leads*. Skills encode the **methods** in original wording as executable procedures; book text is not reproduced.

---

## 1. Purpose

Turn three books into a **self-improvement system for a business**: an agent that diagnoses where a business is bleeding, routes to the right framework, runs an executable playbook that produces a concrete artifact, measures the result, and loops. Not three static reference docs — one closed improvement loop with a shared financial spine.

## 2. The suite (4 skills)

| Skill | Source | Job |
|---|---|---|
| `growth-os` | the spine | Diagnose business, route to the right skill, run the loop, own shared financial math + the Business Scorecard |
| `offer-architect` | $100M Offers | Build/upgrade a Grand Slam Offer |
| `money-model-designer` | $100M Money Models | Sequence offers so the business gets *paid* to acquire customers |
| `lead-engine` | $100M Leads | Get engaged leads via the Core Four + Lead Getters |

Each is a self-contained Agent Skill folder. `growth-os` can drive the others, or the app can invoke any skill directly.

## 3. The self-improvement loop (owned by `growth-os`)

```
1. DIAGNOSE    build/load the Business Scorecard
2. LOCATE      place on the 7-Level Roadmap + run the constraint test
3. PRESCRIBE   bottleneck -> ONE skill -> ONE playbook
4. EXECUTE     run playbook -> produces a concrete artifact
5. MEASURE     write results back into the Scorecard
6. RE-DIAGNOSE next bottleneck surfaces -> loop
```

### Routing rules (from the books — not invented)
- **No offer / commodity / value too low** -> `offer-architect`. Gate on `Market > Offer > Persuasion` + the 4 market indicators first.
- **Customers exist but broke / can't afford to acquire / `LTGP:CAC < 3` due to low LTGP / fails 30-day payback** -> `money-model-designer`.
- **Good offer + money model, too few people know** -> `lead-engine`; pick Core Four channel by *time vs money*.
- **Master switch (from *Leads*):** `CAC > 3x industry average` -> advertising problem (`lead-engine`, Better/constraint). `CAC < 3x average` but not scaling -> business-model problem (`offer-architect` / `money-model-designer`).

## 4. Business Scorecard (persistent state)

One artifact per business (JSON canonical + human-readable mirror). Fields:

```
identity:   market (Health/Wealth/Relationships + niche), avatar, current offer(s), price
financials: LTGP, CAC, LTGP:CAC, 30-day cash/customer, gross margin, refund %, churn-by-cadence
position:   roadmap_level (1-7), current_constraint (funnel step that bleeds most)
offer_card: value-equation scores (dream up / likelihood up / time down / effort down), enhancers done, guarantee, name
model_card: which of 4 offer-types exist, 30-day-payback pass/fail, continuity take %
lead_card:  active Core Four channels, Rule-of-100 status, active Lead Getters, funnel conversions
history[]:  each prescription + outcome  <- the self-improvement trail
```

## 5. Skill anatomy (standard for all four)

```
<skill>/
  SKILL.md      # thin: what it's for, when to trigger, index of playbooks & scripts, mini-diagnostic
  references/   # framework knowledge, loaded on demand
  playbooks/    # numbered step-by-step procedures, each producing an artifact
  scripts/      # runnable calculators/generators (Python 3, stdlib only, CLI + importable)
  assets/       # output templates (canvases, checklists)
```

### 5.1 `growth-os`
- `references/`: `roadmap-7-levels.md`, `diagnostic-tree.md`, `financial-spine.md` (canonical LTGP / CAC / CFA / 30-day-cash definitions)
- `scripts/`: `scorecard.py` (create/update/read), `diagnose.py` (routing on scorecard values), `ltgp_cac.py`, `cfa.py`
- `assets/`: `business-scorecard.template.json`

### 5.2 `offer-architect` ($100M Offers)
- `references/`: value-equation, market-selection, pricing-virtuous-cycle, enhancement-layers, magic-naming
- `playbooks/`: `01-select-market`, `02-build-offer` (5 steps: dream -> problems -> solutions -> delivery vehicles (6 cheat codes) -> trim & stack), `03-enhance-offer` (scarcity 3 types / urgency 4 methods / bonuses 11-point / guarantees 4 types + menu), `04-name-offer` (MAGIC + fatigue-variation order)
- `scripts/`: `value_equation_scorer.py`, `guarantee_refund_calc.py`, `offer_stack_builder.py`
- `assets/`: `grand-slam-offer.canvas.md`, `offer-stack.template.md`

### 5.3 `money-model-designer` ($100M Money Models)
- `references/`: money-model definition, four-offer-types (detailed), 30-day-payback
- `playbooks/`: `01-assess-money-model`, `02-attraction`, `03-upsell`, `04-downsell`, `05-continuity`, `06-assemble` (Stages I-III + raise-price roadmap + industry reference models)
- `scripts/`: `cfa_calculator.py`, `continuity_pricing.py` (1.33x->2.66x table; solve standalone price for target continuity %), `money_model_simulator.py`
- `assets/`: `money-model-canvas.md`

### 5.4 `lead-engine` ($100M Leads)
- `references/`: core-four, lead-magnets, rule-of-100, lead-getters, more-better-new
- `playbooks/`: `01-pick-channel`, `02-warm-outreach` (10 steps + A-C-A), `03-post-content` (hook/retain/reward + give:ask), `04-cold-outreach`, `05-paid-ads` (callout + what-who-when + CTA + 3 scaling phases), `06-lead-magnet` (7 steps), `07-referrals`, `08-affiliates`, `09-employees`, `10-agencies`, `11-more-better-new`
- `scripts/`: `constraint_analyzer.py` (funnel -> bottleneck), `cold_outreach_solver.py` (solve for X contacts), `rule_of_100_tracker.py`
- `assets/`: `advertising-checklist.template.md`, `lead-magnet.template.md`

## 6. Cross-cutting decisions

1. **Shared financial math lives in `growth-os`** (`ltgp_cac.py`, `cfa.py`). Book-skills reference the same concepts; to stay self-contained they carry a thin local copy of any pure-math helper they need, but `growth-os` is the canonical definition so diagnosis and tools always agree.
2. **Attribution, not reproduction.** Encode methods in original wording; credit "frameworks from Alex Hormozi's $100M series." No book text pasted.
3. **Every playbook ends in a concrete artifact** written back to the Scorecard, so the loop always has something to measure.
4. **Scripts:** Python 3, stdlib only, each runnable as CLI (`--help`, JSON in/out) AND importable. No external deps so the app can run them anywhere.
5. **SDO:** `description` = triggering conditions only (never a workflow summary); heavy keyword coverage; progressive disclosure (thin SKILL.md, details in references/playbooks).

## 7. Build order

1. `growth-os` scaffold + Scorecard + `diagnose.py` (loop works end-to-end)
2. `offer-architect` (pipeline entry point)
3. `money-model-designer`
4. `lead-engine`

Steps 2-4 can be built in parallel once step 1 fixes the conventions (scorecard schema, financial-spine interface, SKILL.md style).

## 8. Validation

Reference/technique skills: validate by retrieval + application. For each skill, confirm (a) an agent can find the right playbook from a realistic entrepreneur prompt, (b) scripts run and produce correct numbers against the book's worked examples (e.g. continuity pricing table, guarantee refund math, LTGP:CAC 3:1), (c) each playbook yields a filled artifact. Financial scripts are unit-checked against the books' own numeric examples.
