# Stripe Billing — accepted integration plan (2026-08-28)

Source: Stripe `stripe_implementation_planner`, guide_id `iguide_61VIbfMAu8kdIrDnB41V05ajSTq7I`,
status `accepted`. Account `acct_1U9DJHV05ajSTq7I` ("Pikar-Ai", test + live). A separate
`acct_1U9DJsV05pYaPPIE` ("Pikar-Ai sandbox") exists. **Zero products configured in test mode as of
2026-08-28 — this is a clean slate.**

## THE BOUNDARY THAT MUST NOT BLUR

Two Stripe integrations now exist in this repo, pointing in OPPOSITE directions:

| | Phase 28 (28-07) | THIS work |
|---|---|---|
| Whose account | the TENANT's | **Pikar's own** |
| Direction | reads in | charges out |
| Capability | `*_read` ONLY, fails closed | write-capable by necessity |
| Names | `convex/stripe*.ts`, `packages/revenue/src/providers/stripe.ts`, `STRIPE_APP_*` | `convex/billing*.ts`, `packages/billing/`, `BILLING_STRIPE_*` |

Owner decision 2026-08-28: **`billing*` naming**, so the wrong secret cannot reach the wrong path.
Phase 28's `stripe*` names are RESERVED and must not be taken.

## Accepted decisions

- **Checkout**: Stripe-hosted Checkout (redirect). Managed Payments **not** assumed — eligibility is
  country-gated and unverified for this merchant.
- **Pricing**: flat-rate tiers. Per-seat and volume-tiered deferred.
- **Billing model**: free trial with **card on file** at signup, auto-converts. Not freemium.
- **Invoice creation**: Invoicing API driven by a **Convex scheduled function**; accumulate
  `POST /v1/invoiceitems` through the period, roll into one invoice on billing day.
  Stripe has NO built-in recurrence for standalone invoices.
- **Collection**: `auto_advance: true` against a saved payment method, PLUS **bank transfer**
  enabled and the **Hosted Invoice Page** (`invoice.hosted_invoice_url`) for B2B customers who
  cannot pay by card. No custom 3DS — the hosted page handles it.
- **Reconciliation**: **webhook-driven** into our own append-only ledger. Stripe is NOT the book of record.
- **Lifecycle**: Customer Portal (holds ONLY while flat-rate).
- **Recovery**: Smart Retries + automated emails (Dashboard, no code).
- **Tax**: **free threshold monitoring, no collection.** No registrations exist.

## THE FOUR TRAPS (each cost-bearing)

1. **`invoice.paid` is NOT cash in hand.** Bank-transfer funds land in the customer CASH BALANCE, not
   on the invoice. Stripe auto-applies only when amount AND reference match exactly; partial
   payments, VBAN typos or a missing reference leave funds unapplied. Settlement 1-5 business days.
   Our ledger's `estimated/reserved/actual/refunded` states must NOT record `actual` on
   `invoice.paid` alone for bank transfer. Handle `cash_balance.funds_available` and
   `customer_cash_balance_transaction.created` (surfaces `funding_reversed`).
2. **Threshold monitoring's real failure mode is misconfiguration, not zero tax.** With no
   registrations, zero tax IS correct. Monitoring alerts BEFORE crossing into taxable territory.
   Must configure: **product tax category** + **head office address**. Wrong values = watching the
   wrong thresholds, which is the actual silent failure.
3. **Usage-based billing ends Customer Portal.** v1 keeps metering INTERNAL and bills flat-rate.
   The day metered events go to Stripe, the Portal can no longer manage those subscriptions and
   management must move to the Subscription Update API. Treat as a migration, not a flag.
4. **Convex retries actions AND Stripe retries webhooks.** Idempotency must be structural: a
   `stripeEvents` table keyed on `event.id`, inserted BEFORE side effects, the insert itself being
   the dedupe. Every POST to Stripe needs an **idempotency key** or a Convex action retry mints a
   second invoice.

## Tenant <-> Stripe customer mapping

Store BOTH directions: tenant row holds `stripeCustomerId`; the Stripe customer holds
`metadata.tenantId` (metadata flows through webhooks and Sigma). Neither side is a single point of
failure.

- **Stripe customer with no tenant** (paid before onboarding finished, or tenant deleted):
  NEVER auto-create a tenant from a webhook. Dead-letter it (refs/ids only, CLAUDE.md §4) and leave
  the customer orphaned but visible.
- **Tenant deleted, customer alive**: `convex/tenantDelete.ts` today reports only Google/Microsoft
  disconnects and says NOTHING about billing — deleting a tenant would silently leave a live
  subscription charging a card. It needs a billing arm. (Same file was already flagged in 28-03 for
  saying nothing about connector grants.)

## Webhook events that matter

`invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `credit_note.created`,
plus for bank transfer: `cash_balance.funds_available`, `customer_cash_balance_transaction.created`.
Subscription lifecycle: `customer.subscription.created|updated|deleted`,
`checkout.session.completed`.

## Build order

1. **Dashboard only, no code**: branding; product + prices; tax category + head office address;
   Customer Portal config; Smart Retries; bank transfer payment method.
2. **Secrets** via `npx convex env set` — NEVER Vercel, NEVER `.env` (`p25-no-dev-fallback`).
   TEST keys first. New names go in `ENV_MANIFEST` (`convex/lib/env.ts`) or `env.test.ts` reds.
3. **Webhook receiver + `stripeEvents` idempotency table.** Nothing else is safe until this exists.
4. Checkout session + tenant/customer mapping.
5. Subscription lifecycle -> ledger writes.
6. Invoicing rollup scheduled function (only if invoicing outside subscriptions).

## Repo constraints inherited

- CLAUDE.md §1 pure domain logic in `packages/billing`, convex/ a thin adapter.
- §2 tenant-scoped wrappers from `convex/lib/functions.ts`, never raw `_generated/server`.
- §3 audit insert-only. §4 refs/hashes/ids/counts only — never a raw Stripe payload in audit/telemetry.
- §9 needs `docs/playbooks/billing.md` + a `watch.json` entry or the Stop hook blocks.
- Money: reuse `packages/revenue/src/money.ts` (integer minor units + explicit currency, `parseMoney`).
  Stripe is natively minor units — do NOT double-convert, never use floats.
- Missing history is **unknown, never zero** — reuse the `CashFigure` vocabulary in
  `packages/core/src/cash.ts`. Phase 26 Finance "never fabricates historical zeroes"; billing must
  not backfill before an explicit coverage start.
