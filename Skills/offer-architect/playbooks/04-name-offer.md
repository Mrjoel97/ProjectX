# Playbook 04 — Name the Offer

**Goal:** wrap the finished offer in a magnetic name that earns the click, and prepare a variation backlog for when the offer fatigues.

**Inputs:**
- The enhanced offer (from `03-enhance-offer.md`; Scorecard `offer_card`).
- Reference: `../references/magic-naming.md`.

**Artifact produced:** the committed **offer name** + a **variation backlog**, recorded to the Scorecard `offer_card.offer_name` and `offer_card.enhancers.named`.

---

## Step 1 — Choose 3–5 MAGIC components
Draft the name using **3 to 5** of the five components (brevity + specificity):
- **M — Magnetic Reason Why** (Free, 88% Off, Giveaway, Spring, Grand Opening)
- **A — Announce the Avatar** (Bee Cave Dentists, Rolling Hills Moms — hyper-local beats city)
- **G — Give a Goal** (Pain Free, Double Your Profit, First Client)
- **I — Indicate a Time Interval** (4 Hour, 21 Day, 6 Week)
- **C — Container Word** (Challenge, Blueprint, Bootcamp, Intensive, Incubator, Masterclass, Accelerator, Sprint, System, Transformation)

## Step 2 — Draft candidates and add enhancers
Write 3–5 candidate names. Layer in **rhyme** or **alliteration** where it helps memorability. Examples to match the bar: *"Free Six-Week Lean-By-Halloween Challenge"*, *"5 Clients in 5 Days Blueprint."*

## Step 3 — Pick the shortest, most specific one
Choose the single name that is briefest while still specific. That's the committed offer name.

## Step 4 — Build the fatigue-variation backlog
The market will eventually tire of the offer and response will drop. Pre-write the **7-step variation order** so the next move is always ready (change one thing at a time, cheapest first):
1. Change the **creative**
2. Change the **body copy**
3. Change the **headline / wrapper** (the MAGIC name)
4. **Rename seasonally**
5. Change the **duration**
6. Change the **enhancer**
7. Change the **monetization / price** (last resort)

Note: **local markets fatigue faster** — expect to walk this order sooner. Keep untried steps as a standing backlog.

---

## Record to the Scorecard
```
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path offer_card.offer_name --value '"Free Six-Week Lean-By-Halloween Challenge"'
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path offer_card.enhancers.named --value true
python ../growth-os/scripts/scorecard.py log --scorecard <path> --entry '{"skill":"offer-architect","playbook":"04-name-offer","offer_name":"...","variation_backlog":["creative","body copy","headline","seasonal","duration","enhancer","price"]}'
```

**Exit check:** `offer_card.offer_name` set, `offer_card.enhancers.named = true`, and a variation backlog logged. The Grand Slam Offer is complete — hand back to `growth-os` to re-diagnose the next constraint.

## Attribution
Frameworks derived from Alex Hormozi's *$100M Offers*. Methods encoded as executable procedures; book text not reproduced.
