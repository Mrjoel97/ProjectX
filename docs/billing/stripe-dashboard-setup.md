# Stripe Dashboard setup — Pikar's OWN merchant account (Phase 28.1)

> Written: 2026-08-28 by 28.1-02 · Owner playbook: `docs/playbooks/billing.md`
> Code mirror: `packages/billing/src/config.ts` — every answer below has a constant there, so a
> Dashboard drift is detectable by diffing this file against that one.

**Do this in TEST MODE first, on `acct_1U9DJHV05ajSTq7I` ("Pikar-Ai").** The account exists in both
test and live mode; `acct_1U9DJsV05pYaPPIE` is the separate sandbox. It was a clean slate on
2026-08-28; on **2026-08-29 the product and price below were created via the Stripe API**, in test
mode only. Steps 3, 4 and 6 are therefore already DONE — read them to understand what breaks, not
as instructions to repeat. Creating a second product would split the catalogue in half.

**This is the OUTBOUND direction — Pikar charging its own customers.** It is not
`docs/playbooks/connector-stripe.md`, which reads a *tenant's* Stripe account read-only. The two
must never share a secret, a module name or an env prefix.

Work top to bottom. Each item says what breaks **silently** if it is wrong — silently is the point:
none of these produce an error, they produce a wrong answer that looks like a right one.

---

## 1. Confirm the account and the mode

**Where:** top-left account switcher, and the **Test mode** toggle.

Confirm `acct_1U9DJHV05ajSTq7I`, test mode ON.

**Breaks silently if wrong:** every id you copy below (`price_…`, `whsec_…`, `sk_…`) is
mode-scoped. A live `price_…` handed to a test key fails at runtime with a "no such price" that
reads like a code bug. Worse, live-mode configuration performed by accident is real money.

## 2. Invoice and Checkout branding

**Where:** Settings → Business → **Branding**.

Set the logo, the brand/accent colour and the invoice footer. **Nothing else** — no rendering
templates, no per-segment layouts (locked decision: branding only at beta scale).

**Breaks silently if wrong:** the Stripe-hosted Checkout page and the Hosted Invoice Page are the
only billing UI a customer ever sees. Unbranded, they look like a phishing page and conversion
drops without a single error being logged.

## 3. One product, one flat-rate recurring price

**Where:** Product catalogue → **Add product**.

One product ("Pikar AI"), one **recurring** price, flat rate. No per-seat, no volume tiers, no
metered usage (all deferred — metering stays internal for v1; pushing metered events to Stripe is
the day the Customer Portal stops being able to manage these subscriptions).

**Record the `price_…` id and the trial length in days.**

> **DONE 2026-08-29 via the API, test mode.** `prod_VA8pHxqMVhfHZ3` / `price_1U9oXpV05ajSTq7I4Z4U1se9`
> — USD 4900 minor units per month, `trial_period_days: 14`, `tax_behavior: exclusive`, set as the
> product's `default_price`. **The AMOUNT is a placeholder** and carries the Stripe metadata tag
> `pikar_placeholder_amount: "true"` so it cannot be mistaken for a pricing decision; pricing was
> never decided. Change it (or mint a new price) before live mode.

**Breaks silently if wrong:** a *one-off* price instead of a recurring one produces a Checkout
session that completes, charges once and never renews — a subscription that silently is not one.

## 4. Product tax category — the sharp one

**Where:** the product → **Tax category**.

Pick a real Software-as-a-Service code. **It MUST NOT be `txcd_00000000` ("Nontaxable").**

Research proposed **`txcd_10103001` (Software as a service)** at **LOW confidence** — a suggestion,
not a fact. The RULE is what was certain, not the id.

> **DONE 2026-08-29.** Stripe's own tax-code list was read and **`txcd_10105002` — "Artificial
> Intelligence as a Service (AIaaS) - Cloud Based - Business Use"** was selected over the research's
> generic SaaS code, and set on `prod_VA8pHxqMVhfHZ3`. Stripe's description — *access to cloud-hosted
> artificial intelligence platforms for commercial, professional, or organizational purposes* — is
> Pikar exactly. Revisit only if the product stops being AI-centric, or gains a downloaded component
> (that is `txcd_10105004`).

**Breaks silently if wrong:** Stripe reports `taxability_reason: "not_collecting"` for **two
different situations** — "we hold no registration in the customer's jurisdiction" and "this product
is coded Nontaxable". Only the product's own tax code tells them apart. Choose `txcd_00000000` and
Pikar's honest posture ("no tax owed, we are not registered") becomes permanently unreadable from
the data, and threshold monitoring is poisoned too: it *assumes all sales are conducted with your
preset tax code*. Nothing errors. The number is just wrong forever.

## 5. Head office / origin address

**Where:** Tax → **Settings** → Origin address (head office).

Set the real head-office address. **Record the country.**

**Breaks silently if wrong:** the origin address is what **EXCLUDES** the home jurisdiction from
threshold monitoring — *"obligations aren't monitored for your home US state or country"* — not
just what includes others. A wrong origin therefore either monitors a jurisdiction that needs no
monitoring, or stays silent about one that does. Both look identical to a correct setup.

## 6. Stripe Tax enabled, monitoring mode, NO registrations

**Where:** Tax → enable Stripe Tax. Add **no** registrations.

Zero tax is the **correct** answer today and must be reported as *not owed*, never as *calculated*.

**Note for testing:** Stripe Tax has **separate settings for sandboxes**, and it only calculates tax
where a registration exists. If tax behaviour is to be exercisable at all before launch, add **at
least one registration in the sandbox** (`acct_1U9DJsV05pYaPPIE`) — never in the live account.
Without one, every sandbox calculation returns the same empty result, and a broken tax path is
indistinguishable from a correct one.

**Breaks silently if wrong:** adding a live registration you do not actually hold starts collecting
tax you are not authorised to collect.

## 7. Customer Portal

**Where:** Settings → Billing → **Customer portal**.

Enable: upgrade, downgrade, cancel, update payment method. No custom subscription-management UI is
being built (locked decision).

**Breaks silently if wrong:** an unconfigured portal still returns a session URL. The page just
loads with nothing on it — a support ticket, not an error.

## 8. Smart Retries and automated failed-payment emails

**Where:** Settings → Billing → **Revenue recovery**.

Enable Smart Retries and the automated failed-payment emails. Dashboard only — **zero code**, and
no dunning beyond Stripe's defaults.

**Breaks silently if wrong:** a failed renewal is retried never, nobody is emailed, and the
subscription simply lapses. From the app's side that is indistinguishable from a voluntary cancel.

## 9. Bank transfer

**Where:** Settings → Billing → **Invoices** → Payment methods → Bank transfer.

**Bank-transfer eligibility is COUNTRY-DEPENDENT and this repo cannot read the account's country.**
Attempt to enable it and **report what you see**:

- Enabled → `BANK_TRANSFER_ENABLED = true`, and BILL-03's cash-balance path ships.
- Toggle absent or unavailable for this country → **that is the answer, not a failure.**
  `BANK_TRANSFER_ENABLED = false`, and BILL-03's cash-balance handlers become recorded dead code
  that is kept because their offline tests still prove the LAW (money sitting in a customer cash
  balance is not collected until it is *applied*).

**Breaks silently if wrong:** if bank transfer is enabled but the code assumes it is not,
`invoice.paid` gets recorded as cash in hand. Bank-transfer money lands in the customer **cash
balance** first and can be reversed (`funding_reversed`), so that records revenue that may never
arrive.

**To exercise it in test mode** the invoice must be created with `collection_method:
"send_invoice"` and `payment_settings[payment_method_types] = ["customer_balance"]`, then **Sent**
from the Dashboard — sending is what mints the customer's virtual bank account number.

## 10. Webhook endpoint

**Where:** Developers → **Webhooks** → Add endpoint.

> **DELIBERATELY NOT DONE, 2026-08-29 — and this is not an oversight.** `CONVEX_SITE_URL` is
> `http://127.0.0.1:3211`: a **local** deployment Stripe cannot reach. A registered endpoint would
> fail every delivery, be auto-disabled by Stripe, and leave an object in the account that *looks*
> configured. Register this only once a Convex **cloud** deployment exists.
>
> For local delivery in the meantime, use the Stripe CLI (installed, v1.40.2, **not yet
> authenticated**) — it needs no registered endpoint and prints its own session `whsec_…`:
>
> ```bash
> stripe login                     # interactive, browser
> stripe listen --forward-to localhost:3211/billing/stripe/webhook
> ```
>
> Nothing is blocked by this: 28.1-01 proves signature verification offline against a fabricated
> `whsec_`, and the API version below was pinned from Stripe's versioning doc instead of read off an
> endpoint — which is the better source anyway, since the account default is the one thing we must
> never inherit.

URL: `{CONVEX_SITE_URL}/billing/stripe/webhook` — the Convex **site** origin (`*.convex.site`), not
the app origin. Subscribe to the locked event list: `invoice.paid`, `invoice.payment_failed`,
`charge.refunded`, `credit_note.created`, `checkout.session.completed`,
`customer.subscription.created|updated|deleted`, `cash_balance.funds_available`,
`customer_cash_balance_transaction.created`.

**Record the `Stripe-Version` the endpoint reports** (e.g. `2025-03-31.basil`) and copy the
**signing secret** (`whsec_…`).

**Breaks silently if wrong:** the API version decides whether the invoice tax field is
`total_tax_amounts` or `total_taxes`. Read the wrong one and tax is `undefined` — which renders as
"no tax", the same words a correct not-owed posture renders. A wrong URL delivers to nothing, and
Stripe's own retry buries it in a dashboard nobody watches.

## 11. Set the Convex deployment env

**Run from `packages/backend`** — the Convex CLI only works from there.

```bash
npx convex env set BILLING_STRIPE_SECRET_KEY      sk_test_...
npx convex env set BILLING_STRIPE_WEBHOOK_SECRET  whsec_...
npx convex env set BILLING_STRIPE_PRICE_ID        price_...
npx convex env list        # verify it took — values are echoed, so do this privately
```

**Convex deployment env ONLY.** Never Vercel, never `.env`, never a commit. Quoting is fragile on
Windows: if `env set` misbehaves, re-run rather than assuming it took.

**Breaks silently if wrong:** `BILLING_STRIPE_WEBHOOK_SECRET` unset makes the route refuse every
delivery with a 400 — which is the correct *current* state and therefore easy to mistake for
"working". There is deliberately no development fallback.

---

## What must NOT be attempted here

**Tax threshold monitoring.** It does not run in test mode at all, and its notifications require
**$10,000 USD of revenue in the previous year**. There is **no `tax.threshold.*` webhook** to
subscribe to. Nothing about it is verifiable today and no code monitor exists or can exist — see
the Operations section of `docs/playbooks/billing.md`.

---

## As configured on 2026-08-29 (TEST MODE)

This table and `packages/billing/src/config.ts` are two independent recordings of the same facts.
**Diffing them is the drift detector** — so a stale row here does not merely mislead a reader, it
silently disables the check. Update both together, never one.

| Setting | Value | Constant | How |
| --- | --- | --- | --- |
| Product tax code | `txcd_10105002` (AIaaS, cloud, business use) | `PRODUCT_TAX_CODE` | API |
| API version | `2026-08-26.dahlia` | `STRIPE_API_VERSION` | pinned by us |
| Trial length (days) | `14` | `TRIAL_DAYS` | API, on the price |
| Bank transfer available | `true` | `BANK_TRANSFER_ENABLED` | owner, Dashboard |
| Flat-rate price id | `price_1U9oXpV05ajSTq7I4Z4U1se9` | `BILLING_STRIPE_PRICE_ID` (env, not source) | API |
| Product id | `prod_VA8pHxqMVhfHZ3` | _(none — reachable via the price)_ | API |
| Merchant country | **does not exist yet** | `HEAD_OFFICE_COUNTRY` = `null` | — |

`CONFIG_CONFIRMED` is still **`false`**, and `HEAD_OFFICE_COUNTRY` is the single reason. That null is
a **fact, not a gap**: the business is not yet registered, so there is no head office to record.
Do not invent a country to make the flag flip — the flag asserts completeness, and completeness is
genuinely not true. `config.test.ts` format-checks each of the other five **the moment it lands**, so
nothing escapes the guards by arriving early.

### Still owner-only, still open

Steps **2** (branding), **7** (Customer Portal), **8** (Smart Retries) have no API surface in the
tooling available here, and step **11** (the three `convex env set` calls) needs secrets only the
owner holds. None of them block the code: every plan in this phase is provable offline against a
stubbed `fetch`. They block *live traffic*, which is a later gate.
