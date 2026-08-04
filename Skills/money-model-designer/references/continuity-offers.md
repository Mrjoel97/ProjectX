# Continuity Offers — keep them buying (Stage III)

**"Ongoing value for ongoing payments until they cancel."**

**Never use continuity as a standalone attraction offer** — it crashes 30-day cash
(you get one small payment against the full acquisition cost). Correct order:
**Attraction + Upsell + Downsell FIRST, THEN continuity, THEN a bulk-prepaid block that
auto-rolls to month-to-month.**

The 3 continuity offers:

## 1. Continuity Bonus
Give a **bonus worth MORE than the first payment.** Advertise **the bonus, not the
membership.**

**Continuity vs standalone pricing table** — price the one-time standalone as a multiple
of the **MONTHLY** rate to control what fraction choose continuity. *"People pay ~33%
more to avoid continuity."*

| Standalone price (x monthly) | % who choose continuity |
|---|---|
| 1.33x | 50% |
| 1.66x | 60% |
| 2.00x | 70% |
| 2.33x | 80% |
| 2.66x | 90% |

(Compute with `scripts/continuity_pricing.py`.)

**Bulk prepaid "buy 5 get 1 free":** even at only **1 in 8** takers, it lifts 30-day
profit by **+50%**.

## 2. Continuity Discount
Trade **free time for a longer commitment.**

**4 ways to apply the discount:**
1. Up front.
2. At the end.
3. Spread over time (e.g. 3 months free on a 12-month term = **$50/mo off**).
4. After the first 1-2 payments.

**Highest-value tactics:**
- **Bill in 4-week cycles, not monthly** — 13 cycles/year = **+8.3% revenue**
  (**+41% profit at a 20% margin**).
- **Add a +3% processing fee** — **+30% profit at a 10% margin**; use it to get a 2nd
  payment method / ACH.
- **Gift cards.**
- **Lifetime discount at your churn point** — offer the lock-in right where people quit.
- **Extend the term, don't eat into it.**

**Cancellation handling:** cancellation fee = the discount they received; run an **exit
interview** (waive the fee in exchange for feedback -> "**save a third**").

## 3. Waived Fee
Waive a **startup fee** if they commit; they pay it **only if they cancel early.**
- **Fee = 3-5x the monthly** rate (use **1.5-3x** if you want more up-front cash).
- **Commitment >= 1 year.**
- **Diagnostic:** if **>5%** cancel early, fix the product.

## Choosing among the 3
- You have a great deliverable to give away -> **Bonus** (advertise the bonus).
- You want long commitments and can trade time -> **Discount** (+ 4-week billing, +3% fee).
- You have a natural setup/onboarding cost -> **Waived Fee**.
