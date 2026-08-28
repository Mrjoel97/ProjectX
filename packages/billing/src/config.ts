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
 * change the shape our parser reads. UNCONFIRMED — the webhook endpoint reports the version, and
 * only the owner can read it. Set in 28.1-02 Task 3.
 */
export const STRIPE_API_VERSION: string | null = null;

/**
 * The tax category configured on the Pikar product, e.g. a Software-as-a-Service code.
 *
 * The RULE is certain and is enforced by `config.test.ts`: it MUST NOT be `NONTAXABLE_TAX_CODE`.
 * The specific id is not — research proposed `txcd_10103001` at LOW confidence and the Dashboard's
 * own tax-code selector wins. UNCONFIRMED. Set in 28.1-02 Task 3.
 */
export const PRODUCT_TAX_CODE: string | null = null;

/**
 * The merchant's head-office / origin country, ISO 3166-1 alpha-2.
 *
 * Load-bearing twice over. (1) Threshold monitoring EXCLUDES the home jurisdiction — the origin
 * address is what leaves it out, not just what brings others in. (2) Bank-transfer eligibility is
 * COUNTRY-DEPENDENT, and this repo cannot read the account's country. UNCONFIRMED. Set in
 * 28.1-02 Task 3.
 */
export const HEAD_OFFICE_COUNTRY: string | null = null;

/**
 * Can this merchant accept bank transfer at all?
 *
 * `null` = not yet answered. `false` is a LEGITIMATE answer, not a failure: the toggle is
 * country-gated and may simply not exist for this account, in which case BILL-03's cash-balance
 * arm is recorded dead code rather than shipped code. UNCONFIRMED. Set in 28.1-02 Task 3.
 */
export const BANK_TRANSFER_ENABLED: boolean | null = null;

/**
 * Free-trial length in days, as configured on the price/Checkout session.
 *
 * The trial collects a card up front and auto-converts (a trial, not freemium). UNCONFIRMED.
 * Set in 28.1-02 Task 3.
 */
export const TRIAL_DAYS: number | null = null;
