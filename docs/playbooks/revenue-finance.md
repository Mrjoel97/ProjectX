# Playbook: Deterministic business finance (REVN-05)

> Last verified: 2026-08-31 against 3d76cb3 (28-11 orchestration and provenance tests)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-02, 28-11) · Related ADRs: none yet
>
> **Status: LANDED.** `revenueFinance.ts` resolves the deployment-global provider gate before it
> calls any optional adapter, validates every normalized projection, composes whichever independent
> rails passed, and returns immutable per-result coverage, exclusions and review semantics. A
> parked, expired or failed lane is absent; a read that fails after a lane passed becomes an
> unavailable projection and can only lower confidence.
>
> **The six rules, and every one of them is a refusal to invent a number:**
>
> 1. **No rails connected is "honestly unavailable", NEVER a zero.** This is the same rule the cash
>    surface already carries, arriving one layer down. A zero total is a claim about the business; an
>    absent one is a claim about our knowledge, and only the second is true here.
> 2. **QuickBooks alone owns opening cash, receivables and booked receipts.** The accounting rail is
>    the only source for a figure that is an accounting concept.
> 3. **Stripe alone stays useful AND KEEPS ITS OWN CURRENCY.** No FX conversion is invented to make
>    rails add up — a converted figure would be a rate we do not have.
> 4. **PayPal alone reports rail receipts and available balance WITHOUT INVENTING AR.** A payment
>    rail cannot see receivables, so it does not report them.
> 5. **The accounting window excludes overlapping Stripe and PayPal receipts** — the double-count
>    rule. Two rails that both saw the same money must not both be summed into it.
> 6. **Partial and refreshed-failed reads can only LOWER coverage.** Coverage is monotonic
>    downward: a failed refresh must never raise confidence in a figure, which is what makes
>    coverage a safe thing to render.
>
> **Read 2–4 together as one principle:** each rail answers only for what it can actually observe,
> and a gap stays a gap. The failure this forbids is a plausible total assembled from rails that
> each saw part of the picture — which reads as authoritative and is not.)

> **Naming:** "Business Finance" means the *tenant's own* cash, receivables and payroll. It is a
> different subsystem from Pikar's usage/spend reporting (`dashboard-pages.md`, Phase 26 Finance).
> The two must stay separately named in code and in copy, or a user will read one as the other.

## Purpose

Every number a revenue workflow shows is computed here, in pure TypeScript with no Convex import and
no model call. The model receives an already-computed, immutable result and may only explain it. This
is the whole point of the subsystem: **an LLM must never create, modify or silently repair a
financial figure.**

## Key files

**Pure package (28-02, `eaea00c`)**

- `packages/revenue/src/money.ts` (+ `.test.ts`) — `normalizeCurrency`, `minorDigits`, `parseMoney`,
  `moneyFromMinor`, `moneyFromNumber`, `formatMoneyAmount`, `addMoney`, `subMoney`, `negateMoney`,
  `compareMoney`, `sumMoney`, `groupByCurrency`, `zeroMoney`, `isZeroMoney`. **This is the only
  module in the repo allowed to MAKE a money value.** The `Money` *type* lives in the landed
  `contracts.ts` (owned by `revenue-connectors.md`); this file owns the arithmetic, not the shape.
- `packages/revenue/src/finance.ts` (+ `.test.ts`) — `agingBucket`, `agingReport`, `paymentLag`,
  `cashTimeline`, `payrollGap`, `reconcilePayments`, `receiptsTotal`, `coverageOf`, `confidenceFor`,
  `financeResult`, `toCashFigure`.
  **These are the real names.** An earlier draft of this playbook listed `ageReceivables`,
  `buildCashTimeline`, `classifyCoverage`, `classifyConfidence` and `composeFinanceResult` as
  [PLANNED] names; none of those exist. Use the landed names.

**Convex orchestration (28-11)**

- `packages/backend/convex/revenueFinance.ts` — `readPassedFinanceSources` gates QuickBooks,
  Stripe and PayPal independently; `composeBusinessFinance` validates normalized projections,
  selects authority and delegates every calculation to `@pikar/revenue`; `businessFinance` is the
  tenant-scoped action whose arguments deliberately contain no `tenantId`.
- `packages/backend/convex/revenueFinance.test.ts` — independent-rail combinations, accounting
  reconciliation, refreshed failure, two-tenant sentinels, malformed-number refusal, no-model
  arithmetic boundary, coverage, exclusions and accountant-review notice.

`packages/revenue/src/contracts.ts`, `credential.ts`, `reminders.ts` and the package manifest belong
to `revenue-connectors.md`. `packages/revenue/src/crm.ts` belongs to `revenue-crm.md`.

## Dependencies & blast radius

`graphify query "revenue finance"`. Beyond that:

- Provider projections from `connector-quickbooks.md` (accounting authority) and
  `connector-stripe.md` / `connector-paypal.md` (payment rails). A renamed normalized field in a
  provider adapter lands here as a missing input — and a missing input must surface as *unknown*, not
  zero, so this failure is silent unless the coverage label is asserted.
- `providerGates.ts` — a `parked` provider is a missing source, not an empty one.
- Skill bodies (`skill-registry.md`) may explain a result. **No financial formula may appear in a
  skill body.**

## Data flow

1. `businessFinance` authenticates with `tenantAction`; callers choose only environment and a
   bounded horizon, never a tenant id.
2. `readPassedFinanceSources` resolves `providerGates:gateEligibility` for each rail. Only a current
   `passed` result may call the corresponding normalized read action. Each provider is independent,
   so one unavailable lane never blocks the others.
3. `composeBusinessFinance` validates every projection with `validateProjection`. Malformed values
   become unavailable before any calculation boundary; there is no repair prompt or model import.
4. QuickBooks is `accounting_authority`; Stripe and PayPal are `payment_rail`. The accounting
   authority owns receivables, opening cash and receipts in every currency its window covers.
   `reconcilePayments` excludes overlapping rail activity and records why; it never attempts fuzzy
   cross-provider matching beyond the normalized invoice id and accounting coverage window.
5. Currencies stay in separate buckets. No FX rate is inferred, and the output returns one aging,
   cash and payroll result per currency where data exists.
6. `agingReport`, `receiptsTotal`, `cashTimeline` and `payrollGap` compute the figures in the pure
   package. Payroll stays unknown unless the normalized obligations contain an explicit
   `kind: "payroll"` item in the window.
7. `coverageOf`, `confidenceFor` and `financeResult` attach coverage, a monotone confidence label and
   `DECISION_SUPPORT_NOTICE`. The orchestrator adds result-scoped exclusions for unavailable inputs.
   Downstream skills may explain this immutable result and may not recompute it.

## Invariants — what must never break

1. **No Convex import and no model call in `packages/revenue`.** CLAUDE.md §1. *Enforced by:*
   [PLANNED] import-guard test, mirroring `importGuard.test.ts`.
2. **Integer minor units only.** `minor` is a safe integer; `currency` is a validated uppercase ISO
   code. The decimal exponent is used **only** during string parsing/rendering. **Never parse a
   provider decimal string with binary floating-point multiplication.** Reject non-finite values,
   excess scale, unsafe integers, negatives where the domain forbids them, and missing currencies.
   *Enforced by:* `money.test.ts` — exact BigInt string parsing (never float multiplication), the
   per-currency excess-scale boundary, the `MAX_SAFE_INTEGER` boundary in both directions, and a
   generated round-trip over every sign x whole x fraction permutation for USD/JPY/BHD.
3. **Never silently combine currencies.** Every combining operation (`addMoney`, `subMoney`,
   `compareMoney`, `sumMoney`, `agingReport`, `cashTimeline`) returns a `Result` and REFUSES a
   mismatch; `groupByCurrency` is the "produce one result per currency" half. The currency is a
   **required argument** to `sumMoney` and `agingReport`, never inferred from the first element — an
   empty ledger still has to answer in some currency, and inferring one is how a caller silently
   totals the wrong ledger. FX conversion is out of scope until a named rate source, timestamp and
   policy exist. *Enforced by:* mixed-currency refusal tests in `money.test.ts` and
   `finance.test.ts`.
4. **No double-counting.** QuickBooks booked revenue and Stripe/PayPal gross receipts describe the
   same business activity. `reconcilePayments` (landed) excludes a rail payment when it names an
   invoice the books already settled, **or** when its `paidAt` falls inside an accounting
   authority's coverage window — while KEEPING a rail charge no accounting window covers, which is
   genuinely new cash. Every exclusion carries its reason. **`receiptsTotal` is the only exported
   total over payments and it takes a `Reconciled`**, so there is no shape in the public API that
   lets a caller sum raw provider payments. Do not add one.
5. **Missing is unknown, never zero.** A missing, stale, capped or throttled source lowers coverage.
   A zero here becomes a confident false cash figure — the most expensive failure mode in this phase.
6. **Confidence is a coverage label, not a probability.** The closed set is `FINANCE_CONFIDENCES`
   in `contracts.ts` — derive from it, never retype it. The **landed** `confidenceFor` rule, over a
   `Coverage`, where `degraded = capped || partial || missing.length > 0`:

   | Authorities present | clean | degraded |
   |---|---|---|
   | none | `unavailable` | `unavailable` |
   | includes `accounting_authority` | `high` | `medium` |
   | else includes `payment_rail` or `user_confirmed_obligation` | `medium` | `low` |
   | `supplemental` only | `low` | `low` |

   The rule is **monotone downward**: degrading any input can only lower the label, never raise it.
   *Enforced by:* `finance.test.ts` — a permutation test over every non-empty authority subset x
   `capped` x `partial` x `missing`, plus a test asserting the classifier produces all four labels
   and nothing else. The label strings are part of the output contract, so a renderer must assert
   the **rendered** string, not just the branch.
7. **Payroll confidence requires a real obligation.** A provider-supported obligation or a
   user-confirmed next payroll amount and date. It must **never** be inferred from a vague "payroll"
   expense pattern. `payrollGap` returns an `unknown` figure when no `kind: "payroll"` obligation
   falls inside the horizon — **never `covered: true`. Silence is not safety.** It likewise stays
   `unknown` when opening cash was never recorded, rather than starting a balance from zero. The
   cash timeline settles same-day outflows BEFORE same-day receipts and reports the intraday
   trough: a receipt expected on payday is not a promise it clears before the payroll debit does.
8. **The LLM explains only.** It receives the final computed structure. It may not receive raw numbers
   with instructions to total, age, forecast, repair, reconcile or convert them. A model-supplied
   figure must never be stored or rendered as if the tenant stated it.
9. **Every output carries** coverage dates, as-of time, exclusions with reasons, and the standing
   line that this is decision support, not financial/tax/accounting advice, and warrants review by a
   qualified professional.

## How to change safely

- **New metric:** pure function first, with fixtures and boundary tests, *then* wire the adapter.
  Never compute in `revenueFinance.ts`.
- **New source role:** extend the closed role set and re-derive the authority rules. A source with no
  role must not contribute to a total.
- **Changing a confidence rule:** update the closed table and the test that enumerates it in the same
  commit. A label the classifier can never produce is a corpus/runtime drift bug.
- **Renaming a normalized field:** grep the provider adapters *and* the renderer. A backend rename
  that never reaches the component leaves the visible symptom standing behind a green test.

## How to verify

| Command | Proves | Needs |
|---|---|---|
| `pnpm --filter @pikar/revenue test` | Unit, boundary, invariant and permutation tests for contracts, money and finance. **337 passing (38 finance) at the `Last verified` sha.** | offline |
| `cd packages/revenue && npx tsc --noEmit` | Types. Vitest transpiles WITHOUT typechecking — 28-02 had 78 green tests sitting over two real `tsc` errors. Run both, always. | offline |
| `pnpm --filter @pikar/backend test -- revenueFinance` | Gate-first adapter reads, independent rails, authority selection, two-tenant isolation, malformed-number refusal, no-model arithmetic and review semantics. | offline |
| `pnpm --filter @pikar/backend typecheck` | Convex reference and result types, including the tenant-scoped public action. | generated Convex types |
| `node scripts/check-playbooks.mjs` | Watched finance files remain paired with this operational contract. | offline |

Run vitest from **inside** the package. `vitest --root <pkg>` from the repo root breaks convex-test's
`_generated` glob and fakes mass failures.

## Operational notes

- Confidence labels are user-visible strings. Changing one is a copy change *and* a contract change.
- Insufficient-sample states (`paymentLag` with too few paid invoices) are first-class results, not
  errors to swallow.
- **Coverage/staleness diagnosis:** inspect `sources[].state`, each coverage window and `capped`,
  then `coverage.missing` and `exclusions`. An expired/parked/failed provider is source-level
  unavailable; a passed lane whose adapter refresh fails also has result-level exclusions naming
  receivables, receipts, opening cash or payroll. Never translate either condition to zero.
- **Standing review rule:** every result carries: “Decision support, not financial, tax or
  accounting advice. Have a qualified professional review before acting.” Do not shorten or hide it
  on a workflow that presents a computed figure.
- **Rollback:** remove/hide the tenant workflow or tool that invokes `businessFinance`, or park the
  affected provider gate. Do not delete normalized connector data and do not edit the Phase 26
  product-spend Finance routes, components or `packages/backend/convex/finance.ts`; that subsystem
  reports Pikar usage/spend and is deliberately separate from tenant Business Finance.

## Known gaps & deferred work

- Invariant 1 holds by package construction and the adapter boundary scan, but the pure package has
  no dedicated dependency import-guard test. Invariants 8 and 9 are enforced at the adapter boundary
  by `revenueFinance.test.ts`; a future renderer still needs its own visible-copy assertion.
- **A `days` unit does not exist in `@pikar/core`'s `CashUnit`.** `DayFigure = Figure<number>` in
  `contracts.ts` carries payment-lag days instead. If a renderer needs the core vocabulary, add
  `"days"` to `CashUnit` rather than stringifying here.
- `agingReport` REFUSES a negative outstanding balance. Credit memos and overpayments are real and
  deferred: a negative balance today means an adapter normalization bug, and quietly aging it would
  hide that bug behind a plausible number.
- `toCashFigure` bridges a `Figure<Money>` to core's single-currency `CashFigure` and returns
  `not-computable` for anything non-USD. Core's `CashUnit` is the literal `"usd"`; that bridge is
  the seam where a currency would otherwise be silently lost.
- FX conversion, reconciliation keys linking accounting and rail records, and any write-back of a
  computed figure to a provider are all out of phase scope.
