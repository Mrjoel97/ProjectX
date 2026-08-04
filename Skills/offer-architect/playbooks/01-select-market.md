# Playbook 01 — Select the Market

**Goal:** validate or pick the market, pass the `Market > Offer > Persuasion` gate, niche down, and commit to a positioning statement. This runs **before any offer building** — a bad market cannot be fixed by a great offer.

**Inputs:**
- The business's current or candidate market/audience.
- Any known numbers (annual revenue, who currently buys).
- Reference: `../references/market-selection.md`.

**Artifact produced:** a committed niche + a filled positioning statement, recorded to the Scorecard `identity` fields.

---

## Steps

### 1. Anchor to an eternal market
Confirm the candidate sits under **Health**, **Wealth**, or **Relationships**. If it doesn't, reframe it until it does — everything durable ladders up to one of these.

### 2. Check the growth direction
Is the market **growing, normal, or shrinking**? If **shrinking, STOP** — pick a different market. Never build an offer for a contracting market.

### 3. Rate the four indicators
Score the market on each (great / normal / bad) and write one line of evidence for each:
1. **Massive Pain** — do they desperately *need* this? (Pain is the pitch; pain ∝ price.)
2. **Purchasing Power** — can they afford to pay a premium?
3. **Easy to Target** — do reachable lists/groups/associations exist?
4. **Growing** — is there a tailwind?

If any indicator is **bad**, either narrow to a sub-segment where it becomes at least normal, or choose a different market.

### 4. Pass the three-lever gate
Rate the three levers:
```
Starving Crowd (Market)  >  Offer Strength  >  Persuasion Skills
```
- If **Market = bad → STOP.** Do not proceed to offer building. Fix the market first.
- If Market is normal/great → proceed. A great market forgives an average first offer.

### 5. Niche down (if under ~$10M/yr)
Apply the niching price multiplier: take the broad market and narrow the avatar until the buyer hears "this is *exactly* for me." Draft 2–3 narrowing steps and note the price each unlocks (e.g. generic $19 → segment $99 → sub-segment $499 → hyper-specific $1,000+). Pick **ONE** niche and commit.

### 6. Write the positioning statement
Fill in:
> "I solve **[problem]** for **[specific person]** in this unique, counter-intuitive way that **reverses their deepest fear**."

### 7. Record to the Scorecard
Write the committed decisions:
```
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path identity.eternal_market --value '"Health"'
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path identity.market --value '"local fitness"'
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path identity.niche --value '"busy moms, postpartum weight loss"'
python ../growth-os/scripts/scorecard.py set --scorecard <path> --path identity.avatar --value '"<the positioning statement>"'
python ../growth-os/scripts/scorecard.py log --scorecard <path> --entry '{"skill":"offer-architect","playbook":"01-select-market","committed_niche":"...","market_rating":"great"}'
```

**Exit check:** a single committed niche, a written positioning statement, and Market rated at least "normal". Only then proceed to `02-build-offer.md`.

## Attribution
Frameworks derived from Alex Hormozi's *$100M Offers*. Methods encoded as executable procedures; book text not reproduced.
