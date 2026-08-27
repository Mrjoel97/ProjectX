# Playbook: Deterministic business finance (REVN-05)

> Last verified: 2026-08-27 against 4295bcc
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-02, 28-11) · Related ADRs: none yet

> **Status: REGISTERED AHEAD OF IMPLEMENTATION.** At the `Last verified` sha `packages/revenue/`
> exists but holds only the frozen contracts (28-02, `d963bf3`, still in flight). No finance
> arithmetic has landed. Everything marked **[PLANNED]** is a contract a later plan must satisfy, not
> a claim of landed behaviour. Connector lifecycle, credentials and release semantics live in
> `revenue-connectors.md`.

> **Naming:** "Business Finance" means the *tenant's own* cash, receivables and payroll. It is a
> different subsystem from Pikar's usage/spend reporting (`dashboard-pages.md`, Phase 26 Finance).
> The two must stay separately named in code and in copy, or a user will read one as the other.

## Purpose

Every number a revenue workflow shows is computed here, in pure TypeScript with no Convex import and
no model call. The model receives an already-computed, immutable result and may only explain it. This
is the whole point of the subsystem: **an LLM must never create, modify or silently repair a
financial figure.**

## Key files

**[PLANNED]**

- `packages/revenue/src/money.ts` (+ `.test.ts`) — `parseMoney`, `sumMoney`, `groupByCurrency`. The
  `Money` **type** itself already lives in the landed `contracts.ts` (owned by
  `revenue-connectors.md`); this file owns the arithmetic over it, not the shape.
- `packages/revenue/src/finance.ts` (+ `.test.ts`) — `ageReceivables`, `paymentLag`,
  `buildCashTimeline`, `payrollGap`, `classifyCoverage`, `classifyConfidence`, `composeFinanceResult`.
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
   *Enforced by:* [PLANNED] boundary/property tests (28-02).
3. **Never silently combine currencies.** Produce one result per currency, or return
   `mixed_currency`. FX conversion is out of scope until a named rate source, timestamp and policy
   exist. *Enforced by:* [PLANNED] mixed-currency test.
4. **No double-counting.** QuickBooks booked revenue and Stripe/PayPal gross receipts describe the
   same business activity. Adding them double-counts. Without a deterministic reconciliation key,
   show the accounting view and the rail view **separately** and say they cannot be combined.
5. **Missing is unknown, never zero.** A missing, stale, capped or throttled source lowers coverage.
   A zero here becomes a confident false cash figure — the most expensive failure mode in this phase.
6. **Confidence is a coverage label, not a probability.** The closed set already exists as
   `FINANCE_CONFIDENCES` in `contracts.ts` — derive from it, never retype it. The rules:
   `high` = authoritative opening cash plus complete uncapped AR/AP and confirmed payroll coverage
   for the whole horizon; `medium` = authority present but one non-critical source missing/stale;
   `low` = material sources partial/capped, or payroll user-entered without supporting data;
   `unavailable` = no opening cash, mixed currency for the requested aggregate, no confirmed payroll
   obligation, or no usable coverage. *Enforced by:* [PLANNED] closed-set test — the label strings are
   part of the output contract, so assert the **rendered** string, not just the branch.
7. **Payroll confidence requires a real obligation.** A provider-supported obligation or a
   user-confirmed next payroll amount and date. It must **never** be inferred from a vague "payroll"
   expense pattern.
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
| `cd packages/revenue && pnpm vitest run` [PLANNED] | Unit, boundary, invariant and property-style tests for money and finance. | offline |
| `cd packages/backend && pnpm vitest run revenueFinance` [PLANNED] | Orchestration, source-authority selection, coverage propagation. | offline |
| grep for a formula in `packages/contracts/skills/revenue-*.md` [PLANNED] | No arithmetic delegated to a skill body. | offline |

Run vitest from **inside** the package. `vitest --root <pkg>` from the repo root breaks convex-test's
`_generated` glob and fakes mass failures.

## Operational notes

- Confidence labels are user-visible strings. Changing one is a copy change *and* a contract change.
- Insufficient-sample states (`paymentLag` with too few paid invoices) are first-class results, not
  errors to swallow.

## Known gaps & deferred work

- Everything [PLANNED] is unbuilt. Invariants 1-3 and 6 have no enforcement yet; they land with 28-02.
- FX conversion, reconciliation keys linking accounting and rail records, and any write-back of a
  computed figure to a provider are all out of phase scope.
