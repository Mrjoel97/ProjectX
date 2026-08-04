# Growth OS — a self-improvement skill suite for businesses

Four Anthropic Agent Skills that turn Alex Hormozi's $100M series into an executable, self-improving system an agent runs *with* an entrepreneur. Not three reference books — one closed loop: **diagnose → prescribe → execute → measure → re-diagnose.**

## The suite

| Skill | Source | Job |
|---|---|---|
| **`growth-os`** | the spine | Diagnoses the business, finds the one bottleneck, routes to the right skill, owns the shared financial math + the Business Scorecard |
| **`offer-architect`** | $100M Offers | Build/upgrade a Grand Slam Offer |
| **`money-model-designer`** | $100M Money Models | Sequence offers so the business gets *paid* to acquire customers |
| **`lead-engine`** | $100M Leads | Get engaged leads (Core Four + Lead Getters) |

## How they connect

```
                         ┌───────────────┐
                         │   growth-os   │  diagnoses + routes + holds state
                         └──────┬────────┘
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                        ▼
 offer-architect       money-model-designer         lead-engine
 (something worth   →  (get paid to acquire)   →   (get people to
  buying)                                            know about it)
        └──────── shared spine: LTGP:CAC, 30-day cash, CFA ───────┘
```

`growth-os` never guesses. It computes the financial spine, finds the current constraint, and hands off to exactly one specialist. Each specialist runs a numbered **playbook** that ends in a concrete **artifact** written back to the **Business Scorecard**, so the next diagnosis is grounded in real numbers.

## The loop (owned by growth-os)

1. **Diagnose** — build/load the Business Scorecard (`growth-os/scripts/scorecard.py`).
2. **Locate** — place on the 7-Level Roadmap, compute LTGP:CAC and CFA.
3. **Prescribe** — `growth-os/scripts/diagnose.py` returns the constraint + the one skill + playbook + reason.
4. **Execute** — the specialist skill produces an artifact (offer canvas, money-model canvas, ad brief…).
5. **Measure** — record outcomes into the Scorecard.
6. **Re-diagnose** — loop; the next bottleneck surfaces.

## Using it

Start every ambiguous growth request with `growth-os`. It will tell you which specialist to invoke and why. For a narrow, explicit task ("write me a guarantee", "design a continuity offer"), invoke the specialist directly.

All scripts are **Python 3, standard library only** — runnable as a CLI (`python <script> --help`, JSON output) *and* importable as functions, so your app can shell out or import. No dependencies to install.

## Structure of each skill

```
<skill>/
  SKILL.md      # thin: when to use + how to run + file index
  references/   # framework knowledge (loaded on demand)
  playbooks/    # numbered step-by-step procedures, each ends in an artifact
  scripts/      # runnable calculators/generators
  assets/       # fill-in templates
```

## Design

See `docs/specs/2026-07-24-growth-os-skills-design.md` for the full design spec, routing rules, and the Business Scorecard schema.

## Attribution

Frameworks derived from Alex Hormozi's $100M series — *$100M Offers*, *$100M Money Models*, *$100M Leads*. The skills encode the **methods** in original wording as executable procedures; book text is not reproduced.
