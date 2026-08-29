// Phase 28.1 — the Stripe Dashboard settings, mirrored as code-owned constants.
//
// Products, prices, the product tax category, the head office address, the Customer Portal, Smart
// Retries and bank transfer are all DASHBOARD-ONLY (locked decision — no API surface is built for
// them). That makes the Dashboard the source of truth and this file the only place the rest of the
// codebase can SEE it. `docs/billing/stripe-dashboard-setup.md` is the human half; these constants
// are the machine half, and a drift between the two is detectable by diffing them.
//
// Nothing here reads an env var. Secrets live in the Convex deployment env
// (`BILLING_STRIPE_SECRET_KEY`, `BILLING_STRIPE_WEBHOOK_SECRET`, `BILLING_STRIPE_PRICE_ID`) and are
// classified in `packages/backend/convex/lib/env.ts`. Configuration and credentials are different
// planes; a price id in an env var and a tax code in source is the correct split, because only one
// of the two is a secret.

/** Stripe's REST origin. No trailing slash — every path in this package starts with `/v1/`. */
export const STRIPE_API_BASE = "https://api.stripe.com";

/**
 * Stripe's "Nontaxable" product tax code.
 *
 * This is written out here ONCE so `PRODUCT_TAX_CODE` can be tested against it. It is a value we
 * must never select, not a value we use: `taxability_reason: "not_collecting"` means EITHER "we
 * hold no registration in the customer's jurisdiction" OR "this product carries the Nontaxable
 * code". Those are different claims. Only the product's own code disambiguates them, so choosing
 * this one makes the honest posture permanently unreadable — and poisons threshold monitoring too,
 * which assumes all sales carry the preset tax code.
 */
export const NONTAXABLE_TAX_CODE = "txcd_00000000";

/**
 * TEST-MODE OBJECTS, created via the Stripe API on 2026-08-29 against `acct_1U9DJHV05ajSTq7I`.
 *
 * The business is NOT yet registered, so nothing here exists in live mode and `HEAD_OFFICE_COUNTRY`
 * stays null — there is no head office to record yet. These ids are real test-mode objects, not
 * fixtures: a test-mode Checkout session against them actually works.
 *
 *   product  prod_VA8pHxqMVhfHZ3   "Pikar AI", tax_code txcd_10105002
 *   price    price_1U9oXpV05ajSTq7I4Z4U1se9   usd 4900/month, 14-day trial, tax_behavior exclusive
 *
 * The PRICE AMOUNT (49.00 USD) IS A PLACEHOLDER, tagged `pikar_placeholder_amount` in Stripe
 * metadata. Pricing was never decided — change the price object (or create a new one) before live.
 * The price id itself lives in `BILLING_STRIPE_PRICE_ID`, not here: it is deployment config, and a
 * test id must never be readable as a live one.
 */

/**
 * Have the Dashboard answers below been reported by the account owner and landed here?
 *
 * Deliberately an EXPLICIT flag rather than something derived from the values (`x !== null`): a
 * derived flag would read a HALF-landed config as "still pending" and silently skip the format
 * guards on the half that did land. With the flag explicit, every combination except
 * all-null-and-false or all-set-and-true is red. Flipped in 28.1-02 Task 3, after the checkpoint.
 */
export const CONFIG_CONFIRMED: boolean = false;

/**
 * The `Stripe-Version` we pin on every outbound request, from 28.1-05 onward.
 *
 * Pinned by us, never inherited from the Dashboard default: the version decides whether the invoice
 * tax field is `total_tax_amounts` or `total_taxes`, so an account-level version bump would silently
 * change the shape our parser reads.
 *
 * CONFIRMED 2026-08-29: `2026-08-26.dahlia`, Stripe's current version per its own versioning doc.
 * We PIN it rather than reading it off an endpoint, which is what the original note assumed — the
 * account default is exactly the thing we must not inherit. Upgrading is a deliberate edit here,
 * paired with re-reading the invoice tax field shape.
 */
export const STRIPE_API_VERSION: string | null = "2026-08-26.dahlia";

/**
 * The tax category configured on the Pikar product, e.g. a Software-as-a-Service code.
 *
 * The RULE is certain and is enforced by `config.test.ts`: it MUST NOT be `NONTAXABLE_TAX_CODE`.
 *
 * CONFIRMED 2026-08-29: `txcd_10105002` — "Artificial Intelligence as a Service (AIaaS) - Cloud
 * Based - Business Use", set on `prod_VA8pHxqMVhfHZ3` via the API and read back from Stripe's own
 * tax-code list. Research had proposed `txcd_10103001` (generic SaaS - business use) at LOW
 * confidence; the AIaaS code is a strictly better match for "AI-powered business management system,
 * cloud-hosted, browser-accessed, commercial use" and was chosen over it deliberately. Revisit if
 * the product stops being AI-centric or gains a downloaded component (that is `txcd_10105004`).
 */
export const PRODUCT_TAX_CODE: string | null = "txcd_10105002";

/**
 * The merchant's head-office / origin country, ISO 3166-1 alpha-2.
 *
 * Load-bearing twice over. (1) Threshold monitoring EXCLUDES the home jurisdiction — the origin
 * address is what leaves it out, not just what brings others in. (2) Bank-transfer eligibility is
 * COUNTRY-DEPENDENT.
 *
 * STILL NULL, and correctly so as of 2026-08-29: THE BUSINESS IS NOT YET REGISTERED, so there is no
 * head office to record. This is not an unanswered question — it is a fact that does not exist yet.
 * It is the ONLY reason `CONFIG_CONFIRMED` is still false. Set it when registration completes and
 * a real origin address goes into Tax -> Settings.
 */
export const HEAD_OFFICE_COUNTRY: string | null = null;

/**
 * Can this merchant accept bank transfer at all?
 *
 * `null` = not yet answered. `false` is a LEGITIMATE answer, not a failure: the toggle is
 * country-gated and may simply not exist for this account, in which case BILL-03's cash-balance
 * arm is recorded dead code rather than shipped code.
 *
 * CONFIRMED `true` by the account owner on 2026-08-29. So BILL-03's cash-balance arm is SHIPPED
 * code on a live path, and the reconciliation law it encodes is load-bearing, not defensive:
 *
 *   `invoice.paid` is NOT collection. Bank-transfer funds land in the customer CASH BALANCE and
 *   are collected only when a `customer_cash_balance_transaction.created` arrives with
 *   `type=applied_to_payment`. `funded` is arrival; `funding_reversed` takes it back. Booking
 *   `actual` on `invoice.paid` would record money we do not have, in an append-only ledger that
 *   cannot quietly correct it.
 *
 * The owner deferred the other four answers, so `CONFIG_CONFIRMED` stays false. This value is
 * format-checked on its own — see the per-field widening in `config.test.ts`, 2026-08-29.
 */
export const BANK_TRANSFER_ENABLED: boolean | null = true;

/**
 * Free-trial length in days, as configured on the price/Checkout session.
 *
 * The trial collects a card up front and auto-converts (a trial, not freemium).
 *
 * CONFIRMED 2026-08-29: 14, set as `recurring.trial_period_days` on
 * `price_1U9oXpV05ajSTq7I4Z4U1se9`. Chosen as a conventional default, NOT specified by the owner —
 * it is the one value here that no external fact pins, so change it freely.
 */
export const TRIAL_DAYS: number | null = 14;
