# Financial Spine — canonical definitions

These are the shared metrics the whole suite agrees on. offer-architect, money-model-designer, and lead-engine all defer to these definitions so diagnosis and tools never disagree.

## Gross Profit (GP)
Revenue minus the **direct cost of servicing an additional customer**. Not net profit — indirect/overhead costs are excluded. This is the money a new customer actually frees up.

## LTGP — Lifetime Gross Profit
All the gross profit a customer produces over their whole life with you.
```
LTGP = gross_profit_per_purchase x number_of_purchases_over_lifetime
```
Worked example (Offers): `$1,000/mo x 90% margin x 5 months = $4,500 LTGP`. Always gross profit, never revenue. (Some material calls this LTV; use gross profit.)

## CAC — Cost to Acquire a Customer
Everything spent to turn a stranger into a paying customer: ad spend, sales labor, tools, allocated across the customers actually won.
```
CAC = total_acquisition_spend / customers_acquired
```
Employee variant (Leads): `Total Payroll / Total Engaged Leads = cost per engaged lead`; `x leads_per_customer = CAC`.

## LTGP:CAC — the health ratio
```
ratio = LTGP / CAC
```
- **< 3:1** → the business struggles to scale. This is the floor.
- **>= 3:1** → scalable; the higher the better (30:1 is not unusual for great businesses).

### The master switch (industry-relative)
Compare your CAC to the **industry average CAC**:
- CAC **below ~3x** industry average → advertising is fine; the ceiling is the **business model** → raise **LTGP** (better offer via offer-architect, better monetization via money-model-designer).
- CAC **above ~3x** industry average → the ceiling is **advertising** → lower **CAC** (lead-engine: Better / constraint testing).

## 30-Day Cash & the payback rule
The amount of gross profit a **single customer** produces in the **first 30 days**.
- **Rule:** cover the cost to get **and** service a customer within 30 days. Then interest-free 30-day credit-card float lets you recycle the cash and acquire the next customer — repeatedly — with no cash constraint.
- **Baseline money model:** 30-day profit from one customer > cost to get+service that one customer.
- **$100M target:** 30-day profit from one customer >= cost to get+service **2 or more** additional customers.

## CFA — Client Financed Acquisition ("get paid to acquire")
A business achieves CFA when a customer pays **more than the cost to get + fulfill them within the first 30 days**. At that point acquisition is self-funding and scaling is limited only by demand.

Worked example (Leads): membership `$15/mo - $5 cost = $10 GP`; 10-month life = `$100 LTGP`; `$30 CAC` = 3.3:1 — healthy lifetime, but only `$10` comes back in month 1, so cash is trapped. **Fix:** add a `$100` upsell at 100% margin taken by 1 in 5 customers = `+$20` per customer → `$10 + $20 = $30` in 30 days = breaks even on acquisition in month 1 = "free customers." This is the bridge between lead-engine and money-model-designer: a good LTGP:CAC can still fail if the cash arrives too slowly; money-model-designer pulls the cash forward.

## The compounding lever
Value x Volume x Speed multiply. Double all three → business grows **8x** (2^3). Triple all three → **27x** (3^3). Growth OS looks for the lever that is currently lowest.
