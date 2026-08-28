# Playbook: Deterministic business finance (REVN-05)

> Last verified: 2026-08-27 against eaea00c (28-02 landed the pure money and finance core)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-02, 28-11) · Related ADRs: none yet

> **Status: THE PURE CORE HAS LANDED.** At the `Last verified` sha `packages/revenue/src/money.ts`
> and `finance.ts` exist with 79 passing tests (28-02, `d963bf3` + `eaea00c`). Invariants 2, 3, 4, 5,
> 6 and 7 are enforced by code and by tests you can run today. **Only the Convex orchestration
> (`revenueFinance.ts`, 28-11) and the import guard are still [PLANNED]** — invariants 1, 8 and 9
> hold by construction inside the pure package but have no adapter-level enforcement yet. Connector
> lifecycle, credentials and release semantics live in `revenue-connectors.md`.

> **Naming:** "Business Finance" means the *tenant's own* cash, receivables and payroll. It is a
> different subsystem from Pikar's usage/spend reporting (`dashboard-pages.md`, Phase 26 Finance).
> The two must stay separately named in code and in copy, or a user will read one as the other.

## Purpose

Every number a revenue workflow shows is computed here, in pure TypeScript with no Convex import and
no model call. The model receives an already-computed, immutable result and may only explain it. This
is the whole point of the subsystem: **an LLM must never create, modify or silently repair a
financial figure.**

## Key files

**Landed (28-02, `eaea00c`)**

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

**[PLANNED]**

- `packages/backend/convex/revenueFinance.ts` (+ `.test.ts`) — thin orchestration: call adapters,
  choose source authority, call the pure functions, hand the immutable result to an
  explanation-only skill.

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

1. `revenueFinance.ts` fetches bounded projections from the connected providers.
2. Each normalized source is tagged with a **role**: `accounting_authority` (normally QuickBooks),
   `payment_rail` (Stripe/PayPal settlement detail), `user_confirmed_obligation` (e.g. next payroll
   amount and date), or `supplemental` (visible, excluded from totals).
3. Source authority is resolved. Only one authority contributes a given cash movement.
4. Pure functions compute aging, payment lag, the cash timeline and the payroll gap.
5. `classifyCoverage` / `classifyConfidence` produce labels from a **closed rules table**.
6. `composeFinanceResult` retains source refs and the reason each excluded source was excluded.
7. The immutable result goes to an explanation-only skill. Nothing recomputes downstream.

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
| `cd packages/revenue && npx vitest run` | Unit, boundary, invariant and permutation tests for contracts, money and finance. **79 passing at the `Last verified` sha.** | offline |
| `cd packages/revenue && npx tsc --noEmit` | Types. Vitest transpiles WITHOUT typechecking — 28-02 had 78 green tests sitting over two real `tsc` errors. Run both, always. | offline |
| `cd packages/backend && pnpm vitest run revenueFinance` [PLANNED] | Orchestration, source-authority selection, coverage propagation. | offline |
| grep for a formula in `packages/contracts/skills/revenue-*.md` [PLANNED] | No arithmetic delegated to a skill body. | offline |

Run vitest from **inside** the package. `vitest --root <pkg>` from the repo root breaks convex-test's
`_generated` glob and fakes mass failures.

## Operational notes

- Confidence labels are user-visible strings. Changing one is a copy change *and* a contract change.
- Insufficient-sample states (`paymentLag` with too few paid invoices) are first-class results, not
  errors to swallow.

## Known gaps & deferred work

- Invariants 2-7 are enforced by landed code and tests. Invariant 1 (no Convex import) holds by
  construction — `packages/revenue` has exactly one dependency, `@pikar/core` — but has no
  import-guard test yet. Invariants 8 and 9 hold inside the pure package (`financeResult` always
  attaches `DECISION_SUPPORT_NOTICE`) and are unenforced at the adapter/skill layer until 28-11.
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
