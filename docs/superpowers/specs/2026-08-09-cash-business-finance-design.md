# Cash — tier-aware business finance on the Finance page

> Design approved by the owner, 2026-08-09. Supersedes the UI half of the 2026-08-07 Cost/Cash
> split: Cash becomes a tab on `/dashboard/finance` rather than its own route.

## Why this exists

The Cost console (Phase 26 plans 06–10) answers *what is Pikar spending*. It says nothing about
whether the business using Pikar is viable. This design adds that second half.

The owner's opening ask named burn rate, runway, CAC, ROAS, MRR, ARR and working capital, and asked
that the metric set differ by business tier because a solopreneur and an SME are at different
stages.

## What reading the source material changed

The owner directed that the metrics be grounded in `money-model-designer`, `offer-architect` and the
three Hormozi books in `Skills/`. Three independent readings of the full texts (828 pages) produced
findings that reshaped the design. They are recorded here because they are the reason this spec
does not look like the opening ask.

**1. The books do not tier by company size.**

- *$100M Money Models* — no size differentiation. Its only segmentation axis is **bootstrapped vs.
  capitalized**. Its stages (Get Cash → Get More Cash → Get The Most Cash) are money-model maturity,
  gated on an offer being *reliable*, never on revenue or headcount.
- *$100M Offers* — one numeric stage rule in the book (niche below ~$10M revenue, broaden above) and
  reader archetypes at <$3M and $3–10M. Otherwise stage-invariant.
- *$100M Leads* — the 7-level roadmap is gated by **who does the advertising** (you → employees →
  executives), not revenue.

**2. Most of the requested metric list is absent from the source.** Across all three books,
`MRR`, `ARR`, `burn rate`, `runway`, `working capital`, `ROAS`, `payback period` and
`Client Financed Acquisition` (as a named construct) do not appear. `ROAS` in particular never
appears — the books use **LTGP:CAC**. `LTV` is explicitly rejected in favour of **LTGP**, because
gross profit is the money actually available to acquire customers. CAC is the only term from the
opening list that survives contact with the source.

**3. A solopreneur should not be shown ratios.** *Leads* states that at Levels 1–2 the readable
signals are **inputs** — reach-outs per day, posts per day, streak — plus the boolean *am I getting
engaged leads*. Rates at small samples are explicitly called unreadable, and cost-per-engaged-lead
is not computable without payroll. A solopreneur dashboard full of ratios is not merely ungrounded;
the framework says it is misleading.

**4. Onboarding already collects the axes the books use.** The profile captures *how it is funded*
(bootstrapped / outside money) and *how many are paid staff*. Those are the capital-posture and
advertising-leverage axes verbatim.

**Owner decision on the findings:** build the books' spine **plus** a small finance-ops layer
(runway, burn, MRR/ARR, working capital), with the added layer clearly marked as outside the
Hormozi framework rather than presented as part of it. The finance-ops metrics are the language
investors and accountants speak, which matters for funded users the books explicitly exclude.

## Section 1 — the metric model

### Two planes

Mirroring the Cost console's limiter/ledger split, so one mental model serves the whole page:

- **Unit economics** — does each customer pay for itself? (the books' spine)
- **Solvency** — how long does the business survive? (the finance-ops layer)

### Capital posture decides which plane leads

Not the tier. Capital posture is the one segmentation axis *Money Models* argues for, and the
profile already stores it.

- **Bootstrapped** → unit economics leads. Without outside money, a customer paying for itself
  inside 30 days *is* survival. CFA is the headline; runway is context.
- **Outside money** → solvency leads. The constraint is the date the money ends. Runway is the
  headline.

This is what earns the finance-ops layer its place: it is the survival metric for exactly the
population the books exclude.

### The four sets

| | Solopreneur | Startup | SME | Enterprise |
|---|---|---|---|---|
| **Headline** *(typical posture)* | CFA — does a customer pay for itself in 30 days? | Runway + net burn | Working capital | Configurable |
| **Unit economics** | 30-day cash vs CAC · LTGP:CAC *with sample size* | LTGP:CAC · CAC payback (months) · CAC vs 3× industry avg | LTGP:CAC per channel · gross margin % · cohort churn | Full set |
| **Solvency** | Runway, only if cash-on-hand and monthly cost are entered | MRR · ARR · net burn · runway | Working capital | Full set |
| **Activity** | Reach-outs/day · posts/day · streak · engaged-leads boolean | Referral % vs the 25% gate | Referral % · referrals vs churn | — |

**Precedence, because tier and posture can disagree.** The Headline row above is what the *typical*
posture for that tier produces — most solopreneurs are bootstrapped, most startups are funded. When
they diverge, **capital posture wins the headline and the tier keeps the sets below it.** A funded
solopreneur leads with runway, not CFA, and still sees the solopreneur unit-economics and activity
rows. A bootstrapped startup leads with CFA and still sees MRR/ARR/burn/runway underneath. One rule,
no per-cell exceptions.

**Formulas for the non-obvious entries:** CAC payback (months) = `CAC ÷ monthly gross profit per
customer`. Cohort churn reads `scorecard.financials.churnByCadence` (monthly / quarterly / annual)
rather than defining a fourth churn figure. Gross margin % appears once, under unit economics — it
is a margin, not a solvency measure.

### Three deliberate choices

- **Solopreneurs lead with activity counts.** The most important row in the table, and the one the
  source material most directly supports.
- **Ratios show their sample size** (`3.2:1 — from 4 customers`) rather than being hidden. Hiding a
  number the reader could judge for themselves is its own dishonesty.
- **No ROAS anywhere.** Absent from all three books, and *Leads* says to stop optimising CAC once
  inside 3× the industry average. Adding ROAS pushes users toward the lever the framework says to
  put down.
- **No MRR/ARR for solopreneurs.** Lumpy project revenue has no meaningful monthly recurring figure.

## Section 2 — collection and provenance

### Six inputs unlock almost everything

| Input | Unlocks |
|---|---|
| Cash on hand | runway |
| Monthly operating cost | net burn, runway |
| CAC | CFA, LTGP:CAC, payback |
| 30-day cash per customer | CFA |
| Gross profit per purchase | LTGP |
| Purchases per customer lifetime | LTGP, LTGP:CAC |

Plus MRR for startups (ARR derived) and receivables/payables for SMEs. Nine at maximum, six for
most. That is the difference between a dashboard and a tax return.

### The activity row costs nothing

Pikar already delivers the emails. `plans.sentCount` and the delivered-send counters **are** the
reach-out count. The row the books say matters most for the smallest user is the one row that
populates itself with no data entry.

### Four origins on every figure

Reusing the `origin` vocabulary the blueprint code already uses:

- **observed** — Pikar measured it (delivered sends; media spend from the Cost ledger)
- **stated** — the user told us, with the date
- **derived** — computed, showing from what (`3.2:1 — from your $4,500 LTGP and $1,400 CAC`)
- **unknown** — names the missing input (`needs your 30-day cash`)

A derived figure is never rendered when any input is unknown. This is `scorecard.ts`'s existing
null-means-ask rule applied at the display boundary.

### Staleness

A `stated` input older than **90 days** renders with a confirm-or-update prompt. *Leads*: outputs
are only readable when inputs are consistent. A stale input silently poisoning a ratio is that
failure.

### Three collection seams, no new wizard

1. **The Approvals decision prompts already do this.** `QUESTION_CATALOG` in `approvals.ts` asks for
   `financials.cac`, `financials.ltgp` and `thirtyDayCashPerCustomer`; `answerDecision` writes them.
   Extend the catalogue.
2. **An inline "your numbers" panel** on the Business tab — six fields, edited in place, each showing
   when it was last confirmed.
3. **The cockpit agent asks** when it needs a value, matching `diagnose()`'s existing behaviour.

## Section 3 — page structure

Three tabs on `/dashboard/finance`, following the tab pattern the Business Profile page already
establishes.

| Tab | Answers | Audience |
|---|---|---|
| **Business** (default) | Can I survive, and does each customer pay for itself? | Every tenant |
| **Pikar spend** | What is the tool costing me, and what is left today? | Every tenant |
| **Operator** | Deployment ceilings, kill switches, per-request budget | **Owner only** |

Moving the deployment controls to an owner-only tab resolves the owner's original complaint — that
global operator state sitting on a tenant page is confusing — as a consequence of the restructure
rather than a separate piece of work.

**Business leads** because the business's money outranks the tool's bill.

**Inside the Business tab**, ordered by the capital-posture switch: headline → unit economics →
solvency → activity → your numbers.

**The Pikar spend tab is the shipped Cost console moved intact** — same rails, same coverage clamp,
same ledger, same per-rail unlanded wording. Nothing about it is reopened.

The page heading changes from "Know what it costs" (cost-only) to a frame covering both, with each
tab carrying its own sub-heading. The nav label stays **Finance**.

## Section 4 — honesty and failure states

### Three truths, where Cost needed two

| State | Means | Example |
|---|---|---|
| **Unknown** | Never asked, or unanswered | Startup that has not entered MRR |
| **Not applicable** | The metric does not exist for this business | Solopreneur with project revenue — MRR is meaningless, not zero |
| **Zero** | Real, measured, and nothing | Startup whose subscriptions billed nothing this month |

"MRR $0" shown to a project-based consultant implies a failing subscription business that does not
exist. `not-applicable` is decided by the tier and the revenue-stage answer already in the profile,
never inferred from absent data.

### Rules

- A derived figure is suppressed whenever any input is unknown, and names the missing one.
- Ratios carry their sample size.
- `stated` inputs older than 90 days carry a confirm-or-update prompt.
- **The industry-CAC routing switch is off by default.** The books say to research the industry
  average yourself and supply no table, so "is my CAC within 3× industry average" cannot run until
  the user supplies that figure. It renders as unavailable with the reason — never as a pass.

### Degenerate arithmetic

Each is a real input a user can supply, and each has a plausible-looking wrong answer:

| Input | Correct rendering |
|---|---|
| CAC = 0 | "no acquisition cost recorded" — never infinity |
| Monthly cost = 0 | "no operating cost recorded" — never infinite runway |
| Burn ≤ 0 (profitable) | "not burning" — not a month count |
| Cash = 0, burn > 0 | `0 months` — never negative |
| Purchases per lifetime < 1 | rejected at input, not silently multiplied |

### Tier change

A solopreneur who hires becomes a startup. **Inputs persist untouched** — they are facts about the
business, not the tier. Only the displayed set changes; newly visible metrics show `unknown` with
their prompt, never back-filled.

### Failure isolation

Each section owns its subscription. A failing scorecard read takes out unit economics and leaves
solvency, activity and the entire Pikar-spend tab standing. Reuses the existing `DashboardResult`
vocabulary — loading / empty / ready / partial / busy / error / refusal — plus the three truths.

## Section 5 — code, tests, ship order

### Placement (CLAUDE.md §1)

- **`packages/core/src/cash.ts`** — derivations, three-truths resolution, tier→set selection,
  capital-posture switch, degenerate guards. The role `spend.ts` plays for Cost.
- **`packages/core/src/growth/scorecard.ts` remains the source of truth for the six Hormozi inputs.**
  It already holds `cac`, `ltgp`, `thirtyDayCashPerCustomer`, `grossMarginPct` and `churnByCadence`,
  and `answerDecision` already writes them. CAC is **not** duplicated into a second table — that
  drift is what produced two separate selector bugs on 2026-08-09.
- **One new tenant-scoped table** for the finance-ops inputs only: cash on hand, monthly operating
  cost, MRR, receivables, payables, each with its own `statedAt`. One writer per field.
- **`packages/backend/convex/cash.ts`** — tenant-scoped read adapters shaped like `finance.ts`.
- **`apps/web/app/(app)/dashboard/finance/CashView.tsx`** plus a tab shell.

### Tests

- **`packages/core/src/cash.test.ts`** carries the weight — derivations, all three truths, all five
  degenerate cases, tier selection, capital-posture switch. Pure, no Convex.
- **`packages/backend/convex/cash.test.ts`** — unauthenticated rejection, foreign-tenant isolation,
  staleness, not-applicable resolution.
- **`apps/web/app/(app)/dashboard/finance/cashView.test.ts`** — `.test.ts` in the DOM-free runner
  (a `.tsx` is silently skipped by `vitest.config.mts`), `renderToStaticMarkup`, covering unknown /
  not-applicable / zero / stale / sample-size / suppressed-derived.
- **`apps/web/e2e/finance.spec.ts`** extended for the tabs and the owner-only Operator tab.

### Mutation checks, named up front

| Mutation | Test that must go red |
|---|---|
| Collapse `not-applicable` into `unknown` | solopreneur MRR test |
| Render a derived figure with one null input | suppression test |
| Drop the sample size from a ratio | small-sample test |
| Return `Infinity` for CAC = 0 | degenerate test |
| Allow negative runway | degenerate test |

### Ship order

**Slice 1 — structure and free data.** Three tabs; Operator controls move off the tenant surface;
Activity row populated from delivered sends; the six-input panel. Ships value with **zero data
entry**, and closes the owner's original complaint.

**Slice 2 — unit economics.** CFA headline, LTGP:CAC with sample size, referral % against the 25%
gate, the three truths, degenerate guards, staleness prompts.

**Slice 3 — solvency and tier differentiation.** Runway, net burn, MRR/ARR, working capital, the
capital-posture switch, the four tier sets.

### Beta posture

Tier comes from onboarding, which already derives it — nobody picks it. **No price is displayed
anywhere in this work.** Tenant-settable caps and tier pricing are separate sub-projects; this
design only consumes the tier, so they stay decoupled.

## Out of scope

- **Connector-derived figures.** Beta is user-entered only. Stripe/QuickBooks/HubSpot rails are
  Phase 28; when they land they replace `stated` with `observed` behind the same origin vocabulary,
  with no redesign of this page.
- **Tenant-settable spend caps and monthly windows** (owner sub-project #2).
- **Tier pricing — $99 / $297 / $597 / Enterprise** (owner sub-project #3).
- **Industry-average CAC data.** The books supply no table; the user provides it or the switch stays
  off.

## Open questions

None blocking. Two to revisit after beta feedback:

1. Whether the 90-day staleness threshold is right, or whether it should vary by metric (cash on
   hand goes stale far faster than purchases-per-lifetime).
2. Whether Enterprise's "configurable" set needs a real editor, or whether the SME set plus the
   ability to hide rows is enough.
