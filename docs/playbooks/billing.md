# Playbook: Billing — Pikar's OWN merchant account (Phase 28.1)

> **Formatting-only pass, 2026-08-29.** `biome format` + `organizeImports` ran across this
> subsystem's files to clear a CI `Lint` red that had been blocking the `Test` and `Build`
> steps behind it since 2026-08-27. Whitespace, line wrapping and import order ONLY — no
> behaviour change, and **this is not a re-verification of anything below.** The
> `Last verified` line still means what it said.

> **28.1-09, 2026-08-30 — THE SUBSYSTEM HAS A TENANT-FACING SURFACE FOR THE FIRST TIME.**
> Until this plan, `unappliedFunds` (28.1-06), `renderTaxPosture` (28.1-03) and `billing.invoices`
> (28.1-07) had **zero callers in `apps/web`**, and `?checkout=` — the `success_url` / `cancel_url`
> 28.1-04 hands Stripe — landed on `/dashboard/settings`, which ignored the parameter and showed a
> page about data export. A capability nobody can reach is not shipped, and 28.1-08 was about to
> seal the phase over that hole.
>
> **The surface is `apps/web/app/(app)/dashboard/settings/BillingPanel.tsx`, and its own playbook is
> `dashboard-pages.md`, not this one** — `watch.json` gives this file `packages/billing`,
> `packages/backend/convex/billing` and `docs/billing/`; the page lives under
> `apps/web/app/(app)/dashboard/settings/`, which `dashboard-pages.md` watches. Both carry the
> surface: this file owns the billing DOMAIN, `dashboard-pages.md` owns the PAGE. The 28.1-09 plan
> named only this one and was wrong.
>
> **What the domain now promises a reader, and what still holds it:**
>
> - `billingStatus`'s `unknown` arm is rendered as **unknown** — never `$0`, never a no-cost tier.
>   Three different causes answer `unknown` (no mapping, a checkout whose `customer.subscription.*`
>   has not arrived, a status Stripe added after `subscriptionState` was written) and none of them
>   is a zero.
> - `unappliedFunds` is rendered **with its age**, which was always the actionable half: Stripe
>   returns unreconciled money to the sending bank at `UNRECONCILED_RETURN_DAYS` (75) and sweeps
>   what it cannot return at `UNRECONCILED_SWEEP_DAYS` (90). The panel derives the stage by calling
>   `unappliedStage` — the ONE definition, exactly as its JSDoc anticipated ("later by the
>   tenant-facing surface that renders a stored observation whose age has since grown"). It does
>   **not** re-implement the boundaries, and the web test asserts them against written-out `75`/`90`
>   rather than importing the constants, so moving either constant is RED.
> - `renderTaxPosture` finally has a renderer. The posture is built from `CONFIG_CONFIRMED` and
>   nothing else: while it is false the business holds no tax registration anywhere
>   (`HEAD_OFFICE_COUNTRY` is null), so `{ state: "not-owed", because: "unregistered" }` is a
>   code-owned fact. **It is deliberately NOT derived by feeding `taxPosture` a `"not_collecting"`
>   reason** — Stripe never said that here, and inventing a provider signal to reach a conclusion is
>   fabrication even when the conclusion happens to be right. The day `CONFIG_CONFIRMED` flips, the
>   page answers `unknown` (it does not read invoice tax lines) rather than carrying the old
>   sentence forward.
> - `portalLink` is offered **only** when `billingStatus` is `not_subscribed` or `subscribed` —
>   the two states that can only come from a stored status string, which means a Stripe customer
>   exists. `unknown` gets a disabled control and a reason, and the panel's `manage()` repeats the
>   guard as an early return. The refusal to auto-provision a customer is now protected on both
>   sides of the wire.
> - `billing.invoices` serves **one anchor tag per invoice** and nothing else. The `billing.test.ts`
>   scan that used to assert `billing.invoices` had NO caller in `apps/web` now asserts it has
>   EXACTLY ONE (`BillingPanel.tsx`), that the caller contains `hostedInvoiceUrl`, and that it
>   contains no line-item / subtotal / tax-amount renderer. The old assertion was true and was the
>   gap, not the goal.
>
> **Ceiling, unchanged:** nothing here has spoken to Stripe. No `BILLING_STRIPE_*` variable is set
> in any deployment, so on the live stack `billingStatus` answers `unknown` for every tenant and
> both lists are empty under `coverage: "unknown"`. 28.1-09 was proven offline at $0 against the
> derivations and the rendered markup; the browser, the portal redirect and the query wiring are
> NOT proven. **This is a `Last verified` bump for the surface only, not a re-verification of the
> sections below.**

> Last verified: 2026-08-30 against 28.1-10 (`raiseAdjustment` — the ONLY writer of
> `billingPeriods`, owner-only, provenance from `ctx`; the rollup finally has an input) — after
> 28.1-11 (the ADVERSARIAL-AUDIT FIX WAVE — 15 confirmed defects
> across waves 1-7, every one seen RED before its fix; the correlation defects, the double-invoice
> path, the cleared-hold clock, and four guards that could not fail) — after 28.1-09 (the tenant-facing `BillingPanel` — the first caller
> `unappliedFunds`, `renderTaxPosture` and `billing.invoices` have ever had in `apps/web`; offline
> at $0, 15 mutations run, 0 survivors) — after 28.1-07 (`billingPeriods` — the DURABLE INVOICE CLAIM ROW —
> plus `convex/billingRollup.ts`, the `billing-invoice-rollup` cron and `billing.invoices`;
> offline at $0, 17 mutations run) — after 28.1-06 (`billingEvents` / `billingCoverage` /
> `billingUnapplied` — the billing BOOK OF RECORD, the money arms of the effect switch, and
> `unappliedFunds`; offline at $0) — after 28.1-05 (`billingCustomers` — the tenant↔Stripe-customer
> mapping — plus the refusal to auto-provision, `eventFacts` as the redact-then-write boundary,
> and the first four arms of the effect switch; offline at $0, 28 mutations run, 0 survivors) —
> after 28.1-04 (the outbound transport `billingApi.ts` and the two
> hosted doors `billing.ts`, offline at $0 against a stubbed `fetch`, 31 mutations run) — after
> 28.1-02 close-out (real test-mode Stripe objects created via the API, and
> `docs/billing/stripe-dashboard-setup.md` reconciled against them), 28.1-03 (`tax.ts` and
> `reconcile.ts`, the pure tax posture and the Stripe-signal-to-ledger-phase mapping) and 28.1-01
> (the webhook receiver and the `billingStripeEvents` idempotency table)
> Build history: `.planning/phases/28.1-stripe-billing-invoicing-and-tax-for-pikar-s-own-merchant-account/`
> · Related ADRs: none yet

> **Status: PARTLY IMPLEMENTED.** At the `Last verified` sha the billing code on disk is the
> inbound webhook receiver and its dedupe table, the pure domain modules, the outbound transport
> plus the two hosted doors (`billingApi.ts`, `billing.ts`), **and — new in 28.1-05 — the
> tenant↔Stripe-customer mapping `billingCustomers`, filled by the first four arms of the effect
> switch.**
>
> **What 28.1-05 changed about the two sentences below.** `portalLink` and `billingStatus` are no
> longer structurally dead: a tenant with a `billingCustomers` row now reaches the Customer Portal
> and reads a real state. They remain unexercised against Stripe, and `billingStatus` still
> answers `unknown` for every tenant on this deployment because no delivery has ever arrived.
> The effect switch now handles FOUR event types (`checkout.session.completed` and all three
> `customer.subscription.*`); the invoice, refund, credit-note and cash-balance arms are still
> empty and still record `status: "ignored"` rather than a flattering `applied`.
>
> **NOTHING HAS EVER SPOKEN TO STRIPE, AND NOTHING IS BILLED YET.** 28.1-04 built the request; it
> did not send one. **No `BILLING_STRIPE_*` variable is set in any deployment**, so every one of
> these surfaces currently throws naming the missing variable — which is the correct and current
> state, not a bug. There is still no invoice, no ledger write and no tenant↔customer mapping, so
> `portalLink` refuses for EVERY tenant and `billingStatus` answers `unknown` for every tenant. The
> effect switch in `receiveAndApply` handles **zero** event types: every verified delivery is
> recorded `status: "ignored"`. Every test is offline at $0 against a stubbed `fetch` and a
> fabricated `whsec_test_…` secret; **none of them proves Stripe accepts anything.**
>
> **28.1-03 added `tax.ts` and `reconcile.ts` — PURE FUNCTIONS WITH NO CALLER.** They are fully
> specified and mutation-proven offline, and **nothing invokes them**: `receiveAndApply`'s effect
> switch is still empty and no movement has ever reached a table. The `billingEvents` book of
> record and the wiring are **28.1-06**. A green `reconcile.test.ts` proves the LAW, not that any
> money was ever reconciled.
>
> **28.1-02 close-out (2026-08-29): REAL TEST-MODE STRIPE OBJECTS NOW EXIST.**
> `prod_VA8pHxqMVhfHZ3` and `price_1U9oXpV05ajSTq7I4Z4U1se9` (USD 4900/month, 14-day trial,
> `tax_behavior: exclusive`, tax code `txcd_10105002`) were created through the Stripe API on
> `acct_1U9DJHV05ajSTq7I`, **test mode only** — the business is not registered, so live mode is
> empty and untouched. The price AMOUNT is a placeholder, tagged `pikar_placeholder_amount` in
> Stripe metadata. **`CONFIG_CONFIRMED` stays `false`, and `HEAD_OFFICE_COUNTRY` is the only
> reason** — an unregistered business has no head office, so that null is a fact rather than an
> unanswered question. **No webhook endpoint was registered, deliberately:** `CONVEX_SITE_URL` is
> `http://127.0.0.1:3211` and Stripe cannot reach it; a registered endpoint would fail every
> delivery and be auto-disabled. Use `stripe listen` locally instead.
>
> Everything marked **[PLANNED]** below is a contract a later plan must satisfy, not a claim that
> code exists. Do not cite a [PLANNED] line as evidence that something works.

## Purpose

Pikar charges for **itself**. A tenant subscribes to pikar-ai.com through Stripe-hosted Checkout,
invoices are issued programmatically, and billing outcomes reconcile into Pikar's own append-only
ledger — Stripe is a payment processor, never the book of record. This playbook owns that
outbound-charging direction end to end.

**`docs/playbooks/connector-stripe.md` is the OPPOSITE direction** — a *tenant's* Stripe account,
read-only, for their business finance. The two integrations must never share a secret, a module
name or an env prefix:

|  | `connector-stripe.md` (Phase 28) | **this playbook** (Phase 28.1) |
| --- | --- | --- |
| Whose account | the tenant's | **Pikar's own** |
| Direction | reads in | charges out |
| Names | `convex/stripe*.ts`, `packages/revenue/src/providers/stripe.ts`, `STRIPE_APP_*` | `convex/billing*.ts`, `packages/billing/`, `BILLING_STRIPE_*` |

## Key files

**Pure packages**

- `packages/billing/src/signature.ts` — `parseStripeSignature`, `timingSafeEqualHex`,
  `SIGNATURE_TOLERANCE_S`. No `ctx`, no `fetch`, no Convex import (CLAUDE.md §1).
- `packages/billing/src/events.ts` — `HANDLED_EVENT_TYPES` (the closed v1-snapshot list) and
  `classifyEvent`, whose default arm is `{ kind: "ignored" }`. **28.1-05 added two more laws to
  the same file:** `eventFacts(eventType, dataObject)` — THE redact-then-write boundary, a type
  that names every id it lifts so no Stripe field can ride along — and `subscriptionState`, whose
  default arm is `unknown`. `MAPPING_EVENT_TYPES` is the exact four-member subset the mapping arm
  acts on; it is a Set membership test, never a `startsWith`.
- `packages/billing/src/reconcile.ts` — `reconcileEvent`, `PAYMENT_METHOD_BANK_TRANSFER`,
  `UNRECONCILED_RETURN_DAYS` / `UNRECONCILED_SWEEP_DAYS`, `unappliedStage`, `REF_TOKEN`.
  BILL-03's pure half: one Stripe event in, ledger movements + observations out. Stateless per
  event (Stripe does not guarantee order) and `nowMs` is an ARGUMENT — no clock read inside.
  **28.1-06 is its first caller** and changed none of its decisions: `unappliedStage` was
  extracted from the inline ternary so the 75/90 boundaries have ONE definition, and
  `REF_TOKEN` was exported so the Convex adapter validates against the same pattern that
  built the values instead of a third copy.
- **28.1-07 added NO pure module.** The rollup is scheduling, transport and a claim row —
  Convex-shaped work with no portable domain law in it. The one thing that looked like domain
  logic, `prepareInvoice`, is a plain exported function inside `billingRollup.ts` because it
  reads `Doc<"billingPeriods">` and has exactly one caller (CLAUDE.md §8 rung 1).
- `packages/billing/src/tax.ts` — `taxPosture` + `renderTaxPosture` + the written-out
  `TAXABILITY_REASONS` table. BILL-05's whole code surface. Pure; the product tax code is an
  ARGUMENT, never read from config inside the function. **28.1-06 added
  `invoiceTaxabilityReason` + `INVOICE_TAX_FIELD`**: the invoice tax breakdown is
  `total_taxes[]` from `2025-03-31.basil` onward and `total_tax_amounts[]` before it, and the
  pre-Basil name is deliberately NOT read — `tax.test.ts` pins `STRIPE_API_VERSION` and the
  field name side by side, so a version change is RED rather than a silent `null` on every
  invoice. It returns `null` when several tax entries DISAGREE: there is no single reason to
  claim, and picking the first would print a confident sentence about the wrong half.
- `packages/backend/convex/billingLedger.ts` — `recordBillingMovement`,
  `ensureBillingCoverage`, `billingCoverageFor`, `listBillingEventsFor`,
  `BILLING_EVENT_PAGE_LIMIT`. The Convex adapter for the book of record; mirrors
  `spendLedger.ts` symbol for symbol over a different table. **Append-only** — it exposes no
  `patch`/`replace`/`delete` and `billingLedger.test.ts` scans its source for one.
- `packages/billing/src/config.ts` — the DASHBOARD mirrored as code-owned constants
  (`STRIPE_API_VERSION`, `PRODUCT_TAX_CODE`, `HEAD_OFFICE_COUNTRY`, `BANK_TRANSFER_ENABLED`,
  `TRIAL_DAYS`, `NONTAXABLE_TAX_CODE`, `STRIPE_API_BASE`). Products, prices, tax category, head
  office, portal, Smart Retries and bank transfer have no API surface here by decision, so this
  file is the only way the codebase can SEE them. Every pending value is `null` and
  `CONFIG_CONFIRMED` is `false` until the owner reports (28.1-02 Task 3).

**Docs**

- `docs/billing/stripe-dashboard-setup.md` — the ordered owner checklist, each item naming what
  breaks SILENTLY if it is wrong, plus an "As configured" table that a drift is diffed against.

**Backend**

- `packages/backend/convex/billingWebhook.ts` — `verifyStripeSignature` (the adapter half, built on
  `hmacHex` from `gmailAuth.ts`) and `receiveAndApply`, the `internalMutation` that owns the dedupe
  insert **and** the effect switch in one transaction.
- `packages/backend/convex/http.ts` — the single `POST /billing/stripe/webhook` route.
- `packages/backend/convex/schema.ts` — `billingStripeEvents`, indexed `by_event` and
  `by_object_type`.
- `packages/backend/convex/billingApi.ts` — **THE** outbound transport. `stripePost` (form-encoded,
  pinned `Stripe-Version`, REQUIRED `Idempotency-Key`), `stripeGet` (no key — Stripe honours it on
  POST only) and `BILLING_STRIPE_TIMEOUT_MS`. Not `"use node"`, deliberately: a `"use node"` module
  may hold only actions, which would stop `billing.ts` importing from it.
- `packages/backend/convex/billing.ts` — the two hosted doors. `startCheckout` and `portalLink`
  (`tenantAction`), `billingStatus` (`tenantQuery`), plus the pure `checkoutParams` /
  `billingPeriodKey` and the exported `portalSession` transport arm.
- `packages/backend/convex/lib/env.ts` — `BILLING_STRIPE_WEBHOOK_SECRET`, `BILLING_STRIPE_SECRET_KEY`
  and `BILLING_STRIPE_PRICE_ID`, all tier `feature`. The latter two landed in 28.1-04, each in the
  same commit as its first literal `process.env` read.
- `packages/core/src/tenantData.ts` — `billingStripeEvents: "global"`.

**Tests**

- `packages/billing/src/signature.test.ts`, `packages/billing/src/events.test.ts` — pure, sub-second.
- `packages/billing/src/config.test.ts` — the guard that outlives 28.1-02: `PRODUCT_TAX_CODE` is
  never `txcd_00000000` in ANY state, and the config is wholly pending or wholly landed, never
  half (a value that lands while `CONFIG_CONFIRMED` stays `false` would escape every format
  check).
- `packages/backend/convex/billingWebhook.test.ts` — the real route via `convexTest(...).fetch()`.
- `packages/backend/convex/billingApi.test.ts` — the transport against a stubbed `fetch`: the four
  headers, form encoding, and four refusals proven INDEPENDENTLY.
- `packages/backend/convex/billing.test.ts` — the two doors against a real in-memory Convex backend
  plus a stubbed `fetch`, and the source scans (no card data, no 3DS, no `connectorFetch`, no
  `/v1/customers`, and `billingApi.ts` as the only module naming Stripe's origin).

## Dependencies & blast radius

Run `graphify query "billing webhook"` for the current subgraph. Couplings graphify cannot see:

- **`BILLING_STRIPE_WEBHOOK_SECRET`** (Convex deployment env, `npx convex env set` from
  `packages/backend` — never Vercel, never `.env`). Unset ⇒ the route 400s every delivery. There is
  deliberately **no development fallback** (`p25-no-dev-fallback`).
- **`hmacHex`** is imported across modules from `convex/gmailAuth.ts`. Changing its encoding
  (hex → base64) silently breaks this route; `signature.test.ts` pins the law independently.
- **Stripe Dashboard endpoint configuration** decides which event types are delivered and which API
  version shapes them. `packages/billing/src/config.ts` is where that gets code-owned; its values
  are still `null` pending the 28.1-02 checkpoint, so nothing downstream may assume a version yet.
- **`SPEND_RAILS` is deliberately untouched.** Billing revenue does not join the spend ledger;
  `packages/core/src/spend.ts` and `convex/spendLedger.ts` must stay unmodified by this subsystem.

## Data flow

### The mapping — who owns which Stripe customer (28.1-05)

`billingCustomers` is the ONLY row joining a tenant to a Stripe customer, and it is written from
exactly one place: the mapping arm inside `receiveAndApply`, in the same transaction as the
dedupe insert.

1. `startCheckout` threads the tenant id THREE ways: `client_reference_id`,
   `metadata[tenantId]` on the session, and `subscription_data[metadata][tenantId]` on the
   subscription. The third is not redundant — a `customer.subscription.created` that overtakes
   its checkout session carries no `client_reference_id` at all, and Stripe does not guarantee
   delivery order.
2. `http.ts` calls `eventFacts(event.type, event.data.object)` at the trust boundary and passes
   ONLY the resulting ids into the mutation. The parsed Stripe object never crosses into Convex.
3. The mapping arm resolves the tenant from `client_reference_id`, then
   `metadata.tenantId`, then an existing `by_customer` row — any one is enough, which is what
   makes it order-independent.
4. The tenant must EXIST (`normalizeId("users", …)` + `db.get`). No match ⇒ dead letter, and
   nothing is created.
5. Conflicts are recorded, never absorbed: a second Stripe customer for a mapped tenant, or a
   second tenant claiming a mapped customer, dead-letters and the FIRST mapping stands.
6. A status only moves if the delivery CARRIED one and `event.created` is not older than the
   delivery that set the current status (`statusAt`). Without that, a re-delivered `updated`
   arriving after a `deleted` hands a canceled customer their access back.
7. `billingStatus` reads the row through `subscriptionState`; `portalLink` reads
   `stripeCustomerFor`. Neither ever creates anything to make itself work.

### Outbound — subscribe (28.1-04)

1. A tenant calls `api.billing.startCheckout` (a `tenantAction`, so `ctx.tenantId` is injected and
   can be neither spoofed nor forgotten).
2. `requirePriceId()` and `requireAppOrigin()` read `BILLING_STRIPE_PRICE_ID` and `SITE_URL`.
   Either unset ⇒ **throws naming the variable, before `fetch`**. There is no localhost fallback:
   a checkout whose `success_url` points at a dead origin takes the money and strands the buyer.
3. `checkoutParams({ tenantId, priceId, trialDays: TRIAL_DAYS, origin })` builds the body from
   inputs ONLY. A null, zero, negative or fractional `TRIAL_DAYS` ⇒ throws.
4. `stripePost("/v1/checkout/sessions", params, { idempotencyKey })` with the key
   `checkout:<tenantId>:<priceId>:<UTC day>` — derived from exactly the inputs that built the body,
   because Stripe errors when one key is replayed with different parameters.
5. `stripePost` reads `BILLING_STRIPE_SECRET_KEY` and `STRIPE_API_VERSION`; either missing ⇒
   **throws before `fetch`**. Then one form-encoded POST carrying four headers.
6. The response is reduced to `{ ok: true, url }`, and `url` is refused unless it is `https:` on a
   `*.stripe.com` host. Nothing else from the session (customer id, `customer_details.email`, the
   amount) reaches the caller.
7. The buyer completes the hosted page. Stripe sends `checkout.session.completed` carrying
   `client_reference_id = <tenantId>`, which **28.1-05** matches on. Until 28.1-05 lands, that event
   is recorded `ignored` and no tenant is mapped.

`portalLink` is the same path against `/v1/billing_portal/sessions`, except that it first resolves
the tenant's `stripeCustomerId` — `null` for every tenant until 28.1-05 — so it returns
`{ ok: false, reason: "no_stripe_customer" }` and **never creates a customer to make itself work**.

### Inbound — webhook (28.1-01)

1. Stripe POSTs to `/billing/stripe/webhook` with a `Stripe-Signature` header.
2. The `httpAction` reads `process.env.BILLING_STRIPE_WEBHOOK_SECRET` and the header. Either
   missing ⇒ **400, body never read**.
3. `const raw = await req.text()` — **once**, and this exact string is what gets verified.
4. `verifyStripeSignature(raw, header, secret, nowS)` — parse the header, reject if
   `|now − t| > SIGNATURE_TOLERANCE_S`, HMAC-SHA-256 `` `${t}.${raw}` ``, constant-time compare
   against **every** `v1=` value. Failure ⇒ **400, zero rows**.
5. Only now `JSON.parse(raw)`; `id`, `type` and `data.object.id` are lifted out.
6. `ctx.runMutation(internal.billingWebhook.receiveAndApply, …)`, which returns a three-value
   `outcome`:
   a. read `by_event` — a row for this `eventId` ⇒ `duplicate_event`, insert nothing (Stripe
      re-delivering the same Event object);
   b. read `by_object_type` — a row for this `(objectId, eventType)` ⇒ `duplicate_object`: insert
      `status: "ignored"` so the delivery stays visible, but apply nothing (the
      two-distinct-Event-objects case). An EMPTY `objectId` is never a dedupe key;
   c. otherwise `new` — `classifyEvent(type)`, run the effect switch **in this same transaction**,
      and insert the row with the resulting status.

   `outcome` is three values rather than a boolean on purpose. While the effect switch is empty,
   `status` is `ignored` on every path, so the stored row cannot distinguish the by-object branch
   from the ordinary one — and a branch no test can observe is a branch no test can prove. The
   mutation that swaps the `by_object_type` index columns fails exactly one test, and it is the
   one that reads `outcome`.
7. `200`, always fast. A timeout is a delivery failure to Stripe and buys a retry storm.

### Outbound — invoice (28.1-07, BILL-04)

Stripe has **no built-in recurrence for standalone invoices**, so the schedule is ours. The shape
below is dictated by Convex's scheduling guarantees, not chosen:

```
crons.daily("billing-invoice-rollup", 07:00 UTC)
        │
        ▼
internal.billingRollup.tick            MUTATION — exactly-once, auto-retried on internal error
        │  claims each DUE period:  status -> "claimed", claimedAt, attempts + 1
        │  scheduler.runAfter(0, postInvoice)   ← ATOMIC with the claim; rollback schedules nothing
        ▼
internal.billingRollup.postInvoice     ACTION — AT MOST ONCE, never auto-retried
        │  1. POST /v1/invoices        pending_invoice_items_behavior=exclude   ← THE BOUND
        │  2. POST /v1/invoiceitems    one per in-window charge, invoice=<id>, explicit period
        │  3. POST /v1/invoices/<id>/finalize   ← mints hosted_invoice_url; a DRAFT has none
        ▼
internal.billingRollup.settlePeriod    MUTATION — settles ONLY a `claimed` row
           posted  (terminal: invoice id, hosted url, Stripe's amount_due)
           failed  (a code token; re-claimable until MAX_PERIOD_ATTEMPTS)
```

**Why the cron points at a MUTATION.** Scheduled ACTIONS are at-most-once and are **not**
auto-retried; scheduled MUTATIONS are exactly-once and auto-retried on an internal error. A cron
aimed straight at `postInvoice` drops an entire billing period in silence — no retry, no error
surface, no invoice. A cron run is also *skipped* while the previous one is still executing, which
is the second reason the outbound work cannot live in the tick. `billingRollup.test.ts` fails if
`crons.ts` ever names `postInvoice`.

**Why `billingPeriods` is the guard and the `Idempotency-Key` is not.** Stripe prunes idempotency
keys once they are ~24h old and then treats a reuse as a brand-new request, so a rollup retried a
day later with the identical key mints a **second invoice**. The header is a same-day belt; the
claim row never expires. Every refusal in `postInvoice` is checked against the ROW, before
`stripePost` is reached — the test that proves it clears the stub's key memory entirely and asserts
`fetch` is never called.

**Why the invoice is created before its lines.** `POST /v1/invoices` pulls **all** pending invoice
items for a customer, so creating items first and rolling them afterwards is unbounded by
construction: the leftovers of a period that failed last month land on this month's bill. The
document is created first with `pending_invoice_items_behavior=exclude`, each line is attached to
that invoice by id, and only then is it finalized. (This is a deliberate DEVIATION from the 28.1-07
plan, which specified items-first.)

### `raiseAdjustment` — the ONLY writer of `billingPeriods` (28.1-10)

28.1-07 shipped a correct, bounded, 28-mutation-proven rollup **with no input**: nothing opened a
period, so the cron ran daily, found nothing due, and did nothing, for every tenant, forever.
`raiseAdjustment` is the input, and it is the only one.

It is an **`ownerMutation`**, never a `tenantMutation` (CLAUDE.md §2). A tenant must not be able to
bill themselves, and must not be able to bill anyone else. `isolation.test.ts` pins it into the
owner surface by name, with a fixture of VALID arguments — argument validation runs *before* the
owner wrapper, so a malformed fixture would fail with a validator error that reads exactly like an
authorization one.

**Provenance comes from `ctx`, never from an argument.** `charges[].raisedBy` is the authenticated
owner's identity, resolved by `requireOwner` before the handler runs; there is no parameter that
could override it. A money figure a request body can author, stored in a row that later renders as
the owner's own charge, is this repo's recorded provenance-laundering defect class. `periodForPost`
**strips `raisedBy`** on the way to the posting action: it is a local fact, and the half of the
module that talks to Stripe has no business reading it (§4).

**`kind` is hard-coded at the call site and is deliberately NOT a parameter.** The metered kind
stays in the schema union and stays unwritten — the phase's locked decision is that metering stays
internal for v1, and the day metered events go to Stripe is the day the Customer Portal can no
longer manage those subscriptions. Do not wire `spendEvents` to it. Do not derive an amount from
cost. A `kind` parameter is exactly how that gets written by accident, which is why the test asserts
the *source* carries no `kind: args.kind` and no write of the metered literal.

**Every refusal is at the door, not at the invoice.** A charge `prepareInvoice` would later reject
is refused here where the owner can see it, rather than silently turning a period into one that can
only fail:

| Refused | Because |
|---|---|
| a non-`pending` period (`claimed` / `posted` / `failed`) | an invoice already claimed or sent cannot grow, and a charge landing on a `claimed` row would ride onto a retry. It does **not** open a second period — that would split one month across two invoices |
| an amount that is not a positive safe integer | direction lives in the kind, never in the sign; a credit is a Stripe credit note |
| a `ref` that is not ref-safe, 1–64 chars | it is half the per-line Stripe idempotency key, which is an HTTP **header value** |
| a tenant id that is not ref-safe | same reason, via `periodKeyFor` |
| a second currency in one period | one invoice carries exactly one currency (`@pikar/revenue`'s law) |
| a `MAX_PERIOD_CHARGES`-th line | beyond the cap `prepareInvoice` refuses the whole period |

**Raising the same `ref` twice is a no-op, and the FIRST amount stands.** `ref` is half the per-line
idempotency key, so a second line under the same ref would be *replayed* by Stripe rather than added
— a silently short bill. Re-raising is not a revaluation; to change an amount, raise a new `ref`.

**The window is derived once.** `monthWindow(occurredAt)` produces the UTC month, half-open
`[periodStart, periodEnd)` — the same window `prepareInvoice` filters against. Deriving it anywhere
else is how a charge gets opened into a period that later answers `no_charges_in_period`: a bill for
nothing that also consumes the period's only claim. `periodEnd` doubles as `dueAt`, so a period
becomes claimable the instant its month closes and never mid-month.

**Operationally there is no admin UI** (`ponytail:` at the site). The owner reaches this through the
Convex dashboard or a script. The upgrade path is an owner-only panel beside `BillingPanel` — the
validation and the provenance law live in the mutation, so a UI would only have to call it.

## The Ledger — `billingEvents` is a SEPARATE book from `spendEvents` (28.1-06, BILL-03)

**Owner decision, 2026-08-28. Do not reopen it.** Money-in gets its own table. It is NOT a fourth
`revenue` rail on `spendEvents`, and the reasons are structural rather than aesthetic:

- `SPEND_RAILS` is a **closed COST union** — `packages/core/src/spend.ts:16` says so verbatim:
  *"The three metered rails. A fourth is a deliberate schema edit, not a string."*
- `aggregateSpend` hard-codes all three rails in **five** places (`zero()`, `perRail`, `byRail`,
  the blended `unlanded` sum, `UNLANDED_RESOLVES`). A fourth member is not a data change.
- **Phase 26 Finance renders those totals as *what Pikar SPENDS*, today.** A revenue rail would add
  money-in to a money-out figure on a live screen, silently.

`aggregateSpend` therefore needed **no change**, and `billing.test.ts` proves it two ways: a
written-out `SPEND_RAILS` literal, and a `finance.summary` call whose `tracked` payload is
byte-identical for a tenant with and without a full `billingEvents` history in a currency the
spend plane has never heard of.

### The phase vocabulary

`SPEND_PHASES` **verbatim** — no phase name is invented for billing, because "what does `reserved`
mean" must have one answer. Every amount is POSITIVE in the currency's MINOR units; direction lives
in the phase, never in the sign.

| Stripe signal | Phase | `kind` | Why |
| --- | --- | --- | --- |
| `invoice.finalized` | `estimated` | `invoice-finalized` | What we expect to collect. Not money, not yet. |
| `invoice.paid`, CARD | `actual` | `invoice-paid-card` | A positively-identified non-cash-balance payment IS collection. |
| `invoice.paid`, BANK TRANSFER | **nothing** | — | The money is in the customer's cash balance, not ours. One `awaiting-cash-application` observation. |
| `invoice.paid`, method UNDETERMINABLE | **nothing** | — | Unknown is never card. Books nothing and writes a `billing_undetermined_payment_method` dead letter. |
| `customer_cash_balance_transaction.created` `funded` | `reserved` | `cash-funded` | Money EXISTS but is not ours yet. |
| … `applied_to_payment` | `actual` | `cash-applied` | **THE collection signal on this rail.** Correlates on the PaymentIntent. |
| … `funding_reversed` | `refunded` | `funding-reversed` | The transfer was pulled back. Never dropped. |
| … `unapplied_from_payment` / `refunded_from_payment` | `refunded` | `cash-unapplied` / `cash-refunded` | Money leaving a payment it had been applied to. |
| `cash_balance.funds_available` | **nothing** | — | LEFTOVER money, not an arrival. One `billingUnapplied` row. |
| `refund.created` | `refunded` | `refund-created` | Positive amount; the phase carries the direction. Correlated on the `re_`, so a SECOND partial refund on one charge is its own movement. **`charge.refunded` is deliberately NOT handled** — its `amount_refunded` is a running total, not this refund's delta (28.1-11 #6). |
| `credit_note.created` | `refunded` | `credit-note` | Same. |
| `invoice.payment_failed` | **nothing** | — | A failed attempt is not a movement in either direction. |

**THE CENTRAL LAW: `invoice.paid` is not cash in hand.** `BANK_TRANSFER_ENABLED` is `true`
(owner-confirmed 2026-08-29), so this is live code on a live path, not defensive code. Booking
`actual` on a bank-transfer `invoice.paid` records money we do not have, in an append-only table
that cannot quietly correct it — and `funding_reversed` is what turns that from a theoretical
error into a real one.

### Identity, and why it is not the correlation alone

`(tenantId, correlationId, phase)`. A bank transfer ARRIVING (`reserved`) and the same money being
COLLECTED (`actual`) share one correlation **on purpose** — that is what makes them reconcilable —
so a correlation-only guard would swallow every collection this merchant ever makes. A replay
returns the stored id and **ignores the replayed amount**: a retry reporting a different number is
an upstream bug, and letting it through would rewrite recorded money.

A currency MISMATCH inside one correlation is **refused, never summed** — two currencies are not a
number anyone can add up, and picking a winner would invent an exchange rate.

### `audit_immutable`, and the two obligations it carries

`billingEvents` and `billingCoverage` are `audit_immutable` in `packages/core/src/tenantData.ts`.
`spendEvents` next door is `tenant_owned` because it records what Pikar SPENT ON a tenant;
`billingEvents` records what the tenant PAID PIKAR, which is Pikar's own accounting record of its
own revenue. An erasure that rewrote it would let a customer delete the merchant's books. The
tenant is not deprived: their invoices and receipts are served by Stripe's hosted Customer Portal,
which 28.1-04 already opens for them.

1. **The writer must be insert-only** (CLAUDE.md §3). `billingLedger.ts` is the only one, and
   `billingLedger.test.ts` scans its source for `patch`/`replace`/`delete`.
2. **Nothing there may ever become personal data.** It holds ids, code-owned tokens, an ISO 4217
   code and integer minor units. A description or line-item text added later would put customer
   content beyond the reach of every erasure request this deployment can honour.

`billingUnapplied` is the opposite call and deliberately so: it is MUTABLE (a re-observed balance
updates the amount), and the money it describes is still the CUSTOMER'S, so it is `tenant_owned` —
it exports, and an erasure removes it rather than stranding a row that points at a live Stripe
customer for a person who no longer exists here.

### Unapplied funds and the 75/90-day clock

`cash_balance.funds_available` fires — under Stripe's DEFAULT automatic reconciliation — **only
when a positive balance REMAINS after reconciliation**. It is "money we hold that is attached to
nothing", not "money arrived". Getting that backwards is the exact trap the research flagged.

The AGE is the actionable half. Stripe emails reminders, attempts to **RETURN** unreconciled funds
to the customer's bank at `UNRECONCILED_RETURN_DAYS` (**75**), and **SWEEPS** what it cannot return
to the account balance by `UNRECONCILED_SWEEP_DAYS` (**90**). `unappliedFunds` (a `tenantQuery`)
returns each amount with its `ageDays` and its `stage` (`held` / `return-attempted` / `swept`),
bounded at `UNAPPLIED_FUNDS_PAGE_LIMIT` (100) with an explicit `truncated` flag.

`observedAt` is the START of that clock and never moves *while the hold lasts*. A re-observed
balance updates the AMOUNT only — restarting the clock on every notification would hide exactly the
row that is about to be taken away. That is why `billingUnapplied` carries a
`by_tenant_object_currency` index: a CashBalance object has no `id`, so `billingStripeEvents`'
by-object dedupe cannot see two notifications as the same thing, and a plain insert would report one
pile of money three times.

**A ZERO CLEARS THE HOLD, and the row stays at zero (28.1-11 #8/#13).** `fundsAvailable` used to
skip a zero balance — and this event is the *only* notification that a hold has cleared, so a
balance Stripe applied months ago went on being reported, and went on aging toward `swept`, for as
long as the row lived. Zero is now carried as an observation and `observeUnapplied` decides what it
means. Three rules hold together and none of them survives alone:

1. **The cleared row is ZEROED, not deleted.** Deleting it deletes `amountAt` with it, and Stripe
   redelivers for days — the pre-clear event arriving afterwards would re-insert the old figure as
   a brand-new hold that no later delivery is going to clear again.
2. **`amountAt` is the ordering guard.** It carries the `event.created` of the delivery that set
   the amount; an older delivery is ignored rather than believed. Without it, a redelivered
   `funds_available` reporting 50000 overwrites a newer 500 and the surface shows money that has
   already moved. This is the same problem the mapping arm solves with `statusIsFresh`/`statusAt`.
3. **Reopening a cleared row restarts `observedAt`.** Money held again after the balance reached
   zero is a *different* hold on a fresh clock; carrying the old date forward would render brand-new
   money as already returned or swept — the dangerous direction.

**Readers exclude zeros.** `unappliedFunds` filters `amountMinor !== 0` before paging: a zeroed row
is a guard, not a balance, and it must never reach a surface wearing an age and a 75/90 stage over
an amount of nothing.

### Coverage is UNKNOWN, never zero

`billingCoverageFor` returns `null` for a tenant this ledger never began watching. `unappliedFunds`
reports `coverage: "unknown"` beside an empty list, which is a DIFFERENT statement from
`coverage: "known"` beside an empty list ("there is genuinely nothing held"). Rendering both as
"nothing owed" is the `CashFigure` mistake (`packages/core/src/cash.ts`): missing history is
unknown, never zero.

Unlike `spendLedger.ensureCoverage`, there is no billing GATE that can open coverage early —
nothing in this deployment can observe that a tenant definitely paid nothing, because only Stripe
knows that. The first recorded movement is genuinely the first moment this ledger can see anything.

### Where `reconcileEvent` is called, and why it is not inside the mutation

At the **HTTP boundary** (`http.ts`), beside `eventFacts`, and for the identical reason: it is the
only thing that reads the Stripe object, and what crosses into `receiveAndApply` is its CLOSED
OUTPUT — a phase, an integer count of minor units, an ISO 4217 code, a `billing/<id>` correlation
and a code-owned kind token. There is nowhere in that shape to put an email, a name or a line-item
description (CLAUDE.md §4). The 28.1-06 plan specified calling it inside the mutation; that would
have required passing the raw Stripe object across the redaction boundary, which is precisely what
`eventFacts` exists to prevent. **`billingWebhook.ts` never re-derives a phase or an amount — it
only writes what it is given**, so the central law lives in exactly one place.

The money arms still run INSIDE `receiveAndApply`'s single transaction, which is the other half of
the property: the Stripe dedupe row and the ledger rows commit or fail together, so "we recorded
the delivery" and "we booked the money" can never diverge.

### Tenant resolution is the mapping row and NOTHING else

A money event has no `client_reference_id` thread to fall back on, unlike the mapping arm. No
`billingCustomers` row means the refusal path and **no ledger row**: an unattributable payment is
visible in the dead-letter queue and is recoverable, whereas a misattributed one is written into an
append-only table that cannot take it back.

## Invariants — what must never break

| Rule | Why | Enforced by |
| --- | --- | --- |
| **`invoice.paid` on a bank-transfer invoice books NO `actual`** | The money is in the customer's cash balance, not ours; an append-only ledger cannot un-say that it collected | `billingWebhook.test.ts` — "books NO actual — nothing was collected" (asserts the ABSENCE) + `reconcile.test.ts` |
| An UNDETERMINABLE payment method is never read as a card | Fail closed: "we could not tell" is not a card | `billingWebhook.test.ts` — "never read as a card — no actual, one dead letter" |
| `applied_to_payment` is the ONLY collection signal on the cash rail | `funded` is arrival, not collection; `funding_reversed` takes it back | `billingWebhook.test.ts` — the funded/applied/reversed trio + the net-position assertion |
| `funding_reversed` writes a NEW `refunded` row, never an edit | The history of the collection must survive its reversal | `billingWebhook.test.ts` — "net returns to nothing collected", every amount still positive |
| Ledger identity is `(tenantId, correlationId, phase)` | A reservation and its actual SHARE a correlation on purpose | `billingLedger.test.ts` — reserve+actual coexist; two cash txns on one PaymentIntent book once |
| A replay IGNORES the replayed amount | A retry reporting a different number would rewrite recorded money | `billingLedger.test.ts` — "inserts ONCE and ignores the replayed amount" |
| A currency mismatch in one correlation is REFUSED, never summed | Picking a winner invents an exchange rate | `billingLedger.test.ts` — "REFUSED rather than summed" |
| Every ledger amount is a POSITIVE safe integer of minor units | Direction lives in the phase; a float is not money | `billingLedger.test.ts` — 0, -1, 12.5, NaN and MAX_SAFE+2 all rejected |
| Missing billing history reads as UNKNOWN, never zero | A zero that means "we were not watching" is a confident lie about revenue | `billingLedger.test.ts` (null is not 0) + `billing.test.ts` (`coverage: "unknown"` ≠ `"known"` with an empty list) |
| `cash_balance.funds_available` books ZERO ledger rows | It is leftover money, not an arrival | `billingWebhook.test.ts` — "ONE unapplied row and ZERO ledger rows" |
| A re-observed balance never restarts the 75/90-day clock | The clock is what makes the row actionable before Stripe takes the money back | `billingWebhook.test.ts` — "updates the amount and never restarts" |
| A CLEARED balance stops being reported and stops aging | `funds_available` at zero is the only signal that a hold ended; skipping it reported money we no longer hold | `billingWebhook.test.ts` — "a funds_available of ZERO clears the hold"; `reconcile.test.ts` — "a balance that has gone to ZERO is an observation" |
| An OUT-OF-ORDER redelivery never lowers a newer amount, and never resurrects a cleared hold | Stripe does not guarantee delivery order and a CashBalance carries no `id`, so only an exact same-`eventId` redelivery is caught upstream | `billingWebhook.test.ts` — "neither lowers a newer amount nor restarts the clock" |
| Money held AGAIN after a clear gets a NEW 75/90 clock | Carrying the old date forward renders fresh money as already swept | `billingWebhook.test.ts` — "starts a NEW clock, not the cleared hold's" |
| `billingPeriods` has exactly ONE writer and it is owner-only | A tenant must not be able to bill themselves or anyone else; a period is money on a customer's bill | `isolation.test.ts` pins `billingRollup.raiseAdjustment` into the owner surface by name; `billingRollup.test.ts` — a non-owner and an unauthenticated caller are refused and write NOTHING |
| The stored author of a charge is the AUTHENTICATED owner, never an argument | A money figure a request body can author, stored as the owner's own charge, is the provenance-laundering defect class | `billingRollup.test.ts` — "the stored author is the AUTHENTICATED owner, never an argument" |
| A non-`pending` period REFUSES a new charge, and does not open a second one | An invoice already claimed or sent cannot grow, and a second period would split one month across two invoices | `billingRollup.test.ts` — one test per `claimed`/`posted`/`failed`, each asserting the charges are byte-identical afterwards |
| Raising the same `ref` twice adds ONE charge, at the FIRST amount | `ref` is half the per-line Stripe idempotency key: a second line under it is REPLAYED, not added — a silently short bill | `billingRollup.test.ts` — "the SAME ref twice adds ONE charge" |
| One period produces exactly ONE invoice | The most expensive defect this subsystem can ship is a second bill for one month | `billingRollup.test.ts` — double tick queues ONE post; a `posted` period is never re-claimed and refuses a re-post BEFORE fetch |
| The cron points at a MUTATION, never at the action | A scheduled action is at-most-once and never retried — a dropped period is silent | `billingRollup.test.ts` — `crons.ts` must name `.tick` and must NOT name `postInvoice`; `tick` is asserted callable as a mutation AND declared `internalMutation` by name |
| `postInvoice` is the ONLY action in the module | Each action is another at-most-once link in the chain | `billingRollup.test.ts` — exactly one `internalAction(` in the source |
| A `claimed` period past `CLAIM_STALE_MS` is RE-CLAIMED | A severed scheduler chain writes no terminal and throws nothing; nothing else would notice | `billingRollup.test.ts` — stale re-claim, and a fresh claim is NOT taken |
| A failure leaves the period re-claimable, up to `MAX_PERIOD_ATTEMPTS` | A transient Stripe failure costs a day, not a period; a permanent one stops rather than hammering Stripe daily | `billingRollup.test.ts` — failed→posted on the next tick; attempts 4 retried, 5 stops |
| The invoice is bounded by the PERIOD, never by "whatever is pending" | `POST /v1/invoices` sweeps every unattached pending item the customer has | `billingRollup.test.ts` — `pending_invoice_items_behavior=exclude`, lines attached by invoice id, an out-of-window charge is excluded |
| The same period re-posted sends the same KEY **and** the same BODY | Stripe errors when a key is replayed with different parameters | `billingRollup.test.ts` — two runs compared field by field, with a non-vacuity length pin |
| A hosted url is validated to an https `*.stripe.com` origin before it is stored | It is stored and later rendered as a link — an unvalidated one is an open redirect | `billingRollup.test.ts` — `invoice.stripe.com.evil.example` is refused, nothing stored |
| No card field, CVC, expiry or 3DS exists in the repo — INCLUDING `apps/web` | Stripe-hosted everything is the locked decision; a card input is that decision reversed by accident | `billing.test.ts` — the pattern scan over `convex/billing*`, `packages/billing/src` **and** `apps/web/app/**/*.tsx`, each with a non-vacuity pin |
| Every `stripePost` CALL SITE passes an `idempotencyKey` | A unit test of the transport cannot tell you a caller forgot | `billing.test.ts` — call-site scan over `convex/billing*.ts`, asserting WHICH modules it found |
| `SPEND_RAILS` stays exactly the three COST rails | Phase 26 Finance renders those totals as what Pikar SPENDS | `billing.test.ts` — written-out literal + `finance.summary` byte-identical with/without `billingEvents` |
| The billing ledger writer is INSERT-ONLY | `audit_immutable` is a lie otherwise | `billingLedger.test.ts` — source scan for `patch`/`replace`/`delete` |
| A money event for an unmapped Stripe customer writes NO ledger row | A misattributed payment is permanent; an unattributed one is recoverable | `billingWebhook.test.ts` — "dead-letters and writes NO ledger row" |
| The effect switch is EXHAUSTIVE over `HandledEventType` | A new money type must be a compile error, not a silently unbooked delivery | `billingWebhook.ts` — the `never` arm; `tsc --noEmit` |
| Signature verified **before** the body is parsed | An unverified payload must never reach a parser or the DB | `billingWebhook.test.ts` — "tampered body ⇒ 400 and zero rows" |
| The raw string is verified, never a re-serialized object | Stripe: *any manipulation of the raw body causes verification to fail* | `billingWebhook.test.ts` — the fixture body has non-canonical key order/whitespace |
| **Every** `v1=` value is checked | A secret roll puts two `v1`s on one header; checking only the first breaks the roll | `signature.test.ts` (multi-`v1`) + `billingWebhook.test.ts` ("only the SECOND is correct ⇒ 200") |
| `v0=` is dropped, never honoured | `v0` is Stripe's fake test scheme; honouring it is a downgrade attack | `signature.test.ts` + the `v0`-only 400 route test |
| `SIGNATURE_TOLERANCE_S` is 300 and never 0 | 0 disables the recency check entirely, re-opening replay | `signature.test.ts` asserts the literal `300` |
| The compare is constant-time | `!==` on a digest is a timing oracle | `signature.test.ts` (length-first, XOR accumulate) |
| The insert **is** the dedupe, and lives in the same transaction as the effect | An `httpAction` is not transactional: an insert-here/apply-there split lets a crash leave a dedupe row with no effect, and Stripe's retry is then silently suppressed | `billingWebhook.test.ts` — duplicate delivery leaves exactly one row; `receiveAndApply` does no I/O |
| An unknown event type is `ignored`, never thrown | Stripe adds event types; a throw turns a new type into a 500 and a retry storm | `events.test.ts` + "unhandled type ⇒ 200 with `status: "ignored"`" |
| No development fallback for the secret | `p25-no-dev-fallback`; a fallback accepts unverified input | "secret unset ⇒ 400 and the body is never read" |
| `billingStripeEvents` rows carry ids, types and counts only | CLAUDE.md §4 — a raw Stripe payload must never become a PII honeypot | the table has no payload field at all |
| **A Stripe customer with no matching tenant is dead-lettered by ref and NEVER auto-provisioned** | Creating a tenant from a webhook is how a billing system invents users. The customer stays orphaned and VISIBLE, which is the point | `billingWebhook.test.ts` — "a checkout for an unknown tenant creates zero users, zero mappings, one dead letter" (asserted by COUNTS) + "the mapping module contains no way to create a user or a tenant" |
| **No email, no name and no Stripe object may enter a dead-letter or audit payload** | `deadLetters` is `audit_immutable`: excluded from BOTH the erasure walk and the export walk, so anything personal there outlives every deletion request | `billingWebhook.test.ts` — "the stored dead letter contains NO email and NO name — whole-row string assertion" and its audit twin; `events.test.ts` — "no email, name, phone or amount survives the extraction" |
| The redaction happens at the HTTP boundary, before the mutation | Redact-then-write is a step ORDERING. `receiveAndApply`'s validator has no argument that can carry an email, so a leak needs a deliberate two-file edit | proven by mutation: adding `customerEmail` to `BillingEventFacts` and to the payload reddens both layers |
| The mapping resolves in BOTH directions | `by_tenant` alone cannot answer a subscription event that carries no tenant; `by_customer` alone cannot answer the portal | `billingWebhook.test.ts` drives both indexes explicitly, never a `.collect()` filter |
| One tenant ⇔ one Stripe customer; a conflict is RECORDED, not overwritten | Overwriting strands a live Stripe customer that nothing points at any more | `billingWebhook.test.ts` — the two conflict tests; the guards kill DISJOINT test sets |
| A status only moves forward in `event.created` order | Stripe does not guarantee order; a stale `updated` after a `deleted` restores access to a canceled customer | `billingWebhook.test.ts` — "a LATE `updated` cannot resurrect a canceled subscription" |
| `billingStatus` answers `unknown` for a mapping that has never seen a subscription event | `pending` is a sentinel, not a tier. Reporting it as subscribed grants access off a row with no status | `billing.test.ts` + `events.test.ts` — `subscriptionState`'s default arm |
| `billingCustomers` is `tenant_owned` | It is the only link from a person to a live merchant record; erasure must remove it. NOT `tenant_credential` — a `cus_…` grants nothing without the API key, and that category would summarise it out of the tenant's own export | `tenantData.test.ts` — "the Stripe-customer mapping is tenant-owned" |
| `not_collecting` + a REAL product tax code reads *not owed, unregistered*; `not_collecting` + `txcd_00000000` reads *we declared it nontaxable* | Stripe's own docs call `not_collecting` ambiguous; the product code is the ONLY disambiguator, so a one-argument `taxPosture` cannot be honest | `tax.test.ts` — both halves, with `txcd_00000000` written out as a literal |
| `not_collecting` with an UNCONFIGURED (`null`) product tax code is `unknown`, never `unregistered` | `PRODUCT_TAX_CODE` is still `null`. Guessing "unregistered" asserts a registration gap we have no evidence for — missing history is unknown, never zero | `tax.test.ts` — "an unconfigured (null) product tax code = unknown" |
| `zero_rated` / `not_subject_to_tax` / `reverse_charge` / `customer_exempt` / `product_exempt` / `not_supported` are **calculated zero**, a different statement from not-owed | A calculation ran. Collapsing it into "not owed" claims a registration posture Stripe never reported | `tax.test.ts` — every published reason has an asserted posture, and the two never render the same sentence |
| A positive tax amount beats ANY reason | Money that was charged was charged, whatever Stripe said about why | `tax.test.ts` — "a positive amount wins over reason …" |
| **No zero posture ever renders a bare `0.00`** | BILL-05's promise is about what a human READS; a perfect enum behind a `$0.00` has delivered nothing. Every zero arm of `renderTaxPosture` emits no amount at all, so the bare number is unreachable rather than discouraged | `tax.test.ts` — "NO zero-tax posture renders a bare 0.00 anywhere", asserted across the whole reason × product-code grid |
| **`invoice.paid` is NOT collection for a bank transfer** — it produces zero movements and one `awaiting-cash-application` observation | Bank-transfer funds land in the customer CASH BALANCE, not on the invoice. Booking `actual` here records money we do not have, in an append-only ledger that cannot quietly correct it — and `funding_reversed` makes that a real error, not a theoretical one | `reconcile.test.ts` — "a BANK TRANSFER invoice produces NO actual movement" |
| `invoice.paid` for a CARD **is** collection → `actual` | Card is synchronous; the trap does not apply. The two paths differ and both are tested | `reconcile.test.ts` — "a CARD invoice IS collection" |
| An UNDETERMINABLE payment method also books no `actual` | `payment_settings.payment_method_types` is what was ALLOWED, not what was USED. Unknown is never card — both guards fail closed and are mutation-proven INDEPENDENTLY | `reconcile.test.ts` — "an UNDETERMINABLE payment method books no actual either" + "customer_balance among SEVERAL allowed methods" |
| cash-balance `funded` → `reserved`; `applied_to_payment` → `actual`; `funding_reversed` / `unapplied_from_payment` / `refunded_from_payment` → `refunded` | `funded` is ARRIVAL (money exists, it is not ours). `applied_to_payment` is the ONLY collection signal on this rail. `funding_reversed` TAKES IT BACK and is never silently dropped | `reconcile.test.ts` — one test per row |
| `applied_to_payment` without a PaymentIntent is an ERROR, never an uncorrelated `actual` | The PI is the only tie back to the invoice; an uncorrelated `actual` in an append-only ledger can never be paired up | `reconcile.test.ts` — "applied_to_payment WITHOUT a PaymentIntent is an error" |
| `cash_balance.funds_available` produces ZERO movements and one `unapplied-funds` observation carrying an AGE | Under Stripe's default AUTOMATIC reconciliation this fires only when money is LEFT OVER — it is the unapplied-funds signal, **not** an arrival signal, and getting it backwards is the trap. Unreconciled funds are returned at `UNRECONCILED_RETURN_DAYS` (75) and swept at `UNRECONCILED_SWEEP_DAYS` (90), so the surface shows age, not just amount | `reconcile.test.ts` — "produces ZERO ledger movements and one visibility record" + the 74/75/89/90 boundary test |
| Every movement amount is POSITIVE and in integer minor units | Direction lives in the PHASE, never in the sign (`spend.ts:25`); Stripe's cash-balance `net_amount` is signed and is `Math.abs`-ed at this boundary. Stripe is natively minor units — never multiplied, never divided, never a float | `reconcile.test.ts` — the money-boundary block (lowercase `usd`, JPY 0-digit, `applied_to_payment` with a negative `net_amount`) |
| A movement that cannot be BUILT returns an error, never a zero | A ledger that writes a zero because it could not read a number is worse than one that refuses | `reconcile.test.ts` — "a movement that cannot be built returns an error rather than a zero" |
| `correlationId` is `billing/<stripe id>` and nothing else, ref-token-checked | CLAUDE.md §4 — refs, hashes, ids and counts ONLY. A movement is audit-bound; no Stripe object, email, name or prose may reach it | `reconcile.test.ts` — the ref-safe-token refusal + "no Stripe object, email or prose ever reaches a movement" |
| `reconcileEvent` is stateless per event and takes `nowMs` as an ARGUMENT | Stripe does not guarantee delivery order, so nothing may depend on what arrived first; and a pure function that reads a clock cannot be tested at a boundary | `reconcile.test.ts` — "the same events in reverse produce the same movement SET" |
| `billingApi.ts` is the ONLY module that talks outward to Stripe on Pikar's own key | One transport = one place where the version pin, the key and the redaction live. A second one drifts from the first silently | `billing.test.ts` — "billingApi.ts is the ONLY module that names Stripe's origin" |
| **Every** mutating POST carries an `Idempotency-Key`, and it is a REQUIRED parameter | Convex actions are at-most-once while Stripe's own client retries; a keyless POST mints a second subscription or invoice. Optional-with-a-default is how it gets forgotten | `billingApi.test.ts` — GUARD 3, plus the deletion AND rename mutations of the header line |
| The Stripe key is a **same-day belt only**, never the durable guard | Stripe prunes keys after ~24h and then treats the request as new. The durable guard is our own claim row (28.1-07 `billingPeriods`) | Documented on `stripePost`; the checkout key's window is one UTC day for exactly this reason |
| An unset `BILLING_STRIPE_SECRET_KEY` throws **before** `fetch`, with no development fallback | `p25-no-dev-fallback`. A fallback key charges a real card from a misconfigured deployment | `billingApi.test.ts` — GUARD 1 and 1b (blank counts as unset) |
| A null `STRIPE_API_VERSION` refuses **exactly like an unset secret** | An unpinned request still succeeds — it just inherits the Dashboard default, and the version decides whether the invoice tax field is `total_tax_amounts` or `total_taxes`. Sending a payload our parsers may not read is worse than not sending it | `billingApi.test.ts` — GUARD 2, driven through a real re-import under a mocked config |
| A Stripe failure carries `error.code` + `Request-Id` and NOTHING else, both shape-checked | CLAUDE.md §4. `error.message` is prose that routinely quotes the offending value back — an email, a name, someone else's object id | `billingApi.test.ts` — a prose sentinel hunted across `JSON.stringify(result)`; a hostile `error.code` is dropped |
| `client_reference_id` **equals** `ctx.tenantId` | It is the ONLY thread 28.1-05's webhook has back to a tenant. Without it a paid checkout must dead-letter — a paying customer with nothing provisioned | `billing.test.ts` — asserted per tenant across TWO tenants on ONE backend, so a hardcoded value cannot pass |
| `payment_method_collection=always` alongside the trial | A trial, not freemium: the card is collected up front so the subscription auto-converts. `if_required` silently turns the plan into freemium | `billing.test.ts` — the request-shape test; the `if_required` mutation is red |
| A hosted `url` is refused unless it is `https:` on a `*.stripe.com` host | The caller redirects a browser to it, so an unvalidated `url` field is an open redirect sourced from a Stripe response | `billing.test.ts` — "a `url` that is not a Stripe host is REFUSED" |
| ONLY the `url` reaches the caller | A Checkout session carries `customer`, `customer_details.email` and the amount. None of it is the caller's business and none of it belongs in a log | `billing.test.ts` — sentinel email, customer id and amount hunted in the returned JSON |
| `portalLink` **never** creates a Stripe customer to make itself work | Provisioning to satisfy a read mints a Stripe object nothing maps back to. Refusing is the honest answer until 28.1-05 lands the mapping | `billing.test.ts` — refusal + `fetch` never called + a `/v1/customers` source scan |
| The portal idempotency window is 60s, NOT the checkout's day | A portal `url` is single-use and short-lived; replaying a day-old key hands the user back a spent link | `billing.test.ts` — `PORTAL_IDEMPOTENCY_WINDOW_MS` asserted as a written-out literal |
| `billingStatus` answers `unknown`, never `not_subscribed`, `0` or "free tier" | There is no row to read for anyone yet. Missing history is unknown, never zero — the same law `tax.ts` encodes for tax | `billing.test.ts` — "a tenant with no billing row is `unknown`" |
| No card number, CVC, expiry or 3DS handling exists anywhere in this subsystem | Stripe-hosted is the whole point; the moment any of it appears, PCI scope changes | `billing.test.ts` — a comment-stripped source scan over `packages/billing/**` and `convex/billing*`, with an anti-vacuity check that the scan read both halves |
| There is **no** tax-threshold monitor, constant or subscription anywhere | Stripe publishes no `tax.threshold.*` event, monitoring is live-mode only, and notification is gated at $10k prior-year revenue — a monitor here could not fire. See Operations below | `grep -rn "tax.threshold" packages/ apps/` returns nothing |

## How to change safely

- **Adding a handled event type:** add the literal to `HANDLED_EVENT_TYPES`, add its arm to
  `classifyEvent`, add its case to the ONE switch in `receiveAndApply`, and extend the literal-array
  assertion in `events.test.ts`. Never add a second switch.
- **Schema change:** `billingStripeEvents` is new and additive; adding an optional field needs no
  migration (`convex-migration-helper`). Any NEW table needs a `TENANT_TABLE_CLASSIFICATION` row in
  the same commit or the source-level drift test fails closed.
- **A new `BILLING_*` env name:** add its `ENV_MANIFEST` row in the SAME commit as the
  `process.env` literal. `convex/env.test.ts` scans source and went red twice in Phase 28 for
  exactly this, both times under a green *filtered* run.
- **Adding an outbound Stripe call:** it goes through `stripePost`/`stripeGet` and nowhere else, and
  a POST must pass a key derived from the SAME inputs that build its body. Do not add an
  `idempotencyKey?:` optional — optional-with-a-default is how it gets forgotten.
- **Bumping `STRIPE_API_VERSION`:** edit `packages/billing/src/config.ts`, then re-read the invoice
  tax field shape (`total_tax_amounts` before Basil, `total_taxes` from `2025-03-31.basil` onward).
  Two tests assert the version as a WRITTEN-OUT literal and will go red — that is their point.
- **Adding a module under `convex/`:** run `npx convex codegen`, or `api.billing` will not typecheck.
  A new EXPORT inside an existing module needs no codegen — the generated file maps modules.
- **Touching the mapping arm:** it is ONE function shared by the checkout and all three
  subscription types, because the difference between them is entirely which facts the delivery
  carried. Do not split it into two; the second copy is where the conflict guards get forgotten.
- **Adding a field to a dead-letter or audit payload here:** it must be an id, an enum token or a
  count. If you cannot write it into `BillingEventFacts` without adding a field that could hold
  prose, the answer is no — that type is the boundary, not a convenience.
- **Adding an index to `billingCustomers`:** any index not leading with `tenantId` must be named
  in `isolation.test.ts`'s `NON_TENANT_LEADING` with a written reason, or the suite fails.
- **Never** widen this into `connectorFetch.ts` (a GET-only read transport with a deliberately empty
  `stripe: []` allow-list) or into `SPEND_RAILS`.
- **Adding a second writer of `billingPeriods`:** don't, without changing this line first. The
  single-writer rule is what makes "the stored author is the authenticated owner" checkable at all.
  If a writer must exist, it states its own `raisedBy` (the field is REQUIRED so it cannot inherit
  the owner's by omission), and it refuses a non-`pending` period the same way.
- **Writing or touching a SOURCE SCAN** (`expect(src).not.toMatch(...)`): import `codeOf` from
  `packages/backend/__fixtures__/sourceScan.ts`. Do not paste a stripper. That helper has been
  wrong twice — once eating 63% of a module including every export, once truncating every line at
  `https://` — and each repair reached only the copies its author was looking at, which is how a
  guard on the never-auto-provision law sat blind through three plans (28.1-11 #10, #12). Every
  negative scan pairs with a POSITIVE tripwire and a `nonBlankLines` floor: a blanked file passes
  every `not.toMatch` ever written. `spendLedger.test.ts` still carries a private copy; whoever
  next touches that file should point it here.
- **Asserting a table is never mutated:** Convex patches by `_id`, so no regex can say "never patch
  a `deadLetters` row" — the table name is nowhere in the call. Ban the bare call name
  (`/db\.patch\(/`) where the module has no legitimate patch, and where it does, pin the CENSUS
  (`expect(src.match(/db\.patch\(/g) ?? []).toHaveLength(2)`) with each site named in a comment. A
  pattern that asks for a table-name argument has zero reachable matches and discharges the
  `audit_immutable` obligation by being unable to fail (28.1-11 #11).

## How to verify

```bash
cd packages/billing && npx vitest run && npx tsc --noEmit
cd packages/backend && npx vitest run convex/billing convex/env.test.ts convex/importGuard.test.ts convex/dashboardSchema.test.ts convex/deadLetters.test.ts convex/isolation.test.ts convex/reliabilitySweep.test.ts
cd packages/backend && npx tsc --noEmit          # SEPARATELY — chaining reports the wrong exit code
cd packages/core   && npx vitest run && npx tsc --noEmit
node scripts/check-playbooks.mjs < /dev/null     # READ ITS STDOUT — it always exits 0
```

- The `packages/billing` run proves the pure signature law and the closed event union.
- The backend run drives the **real** `httpAction` in-memory via `convexTest(...).fetch()`; it
  proves accept/reject and both duplicate shapes. **Never a bare filter** — a filtered run cannot
  tell you `env.test.ts` is red.
- `npx tsc --noEmit` is run **separately per package**, and never chained behind another command:
  a green vitest suite is not a typecheck, and a chained `$?` reports the wrong command's status.
- `convex/billing` (no `.test.ts`) is a PREFIX and picks up `billing.test.ts`, `billingApi.test.ts`
  and `billingWebhook.test.ts` in one run. `pnpm test -- <filter>` does NOT filter — drop the `--`.
- 28.1-06's money arms are driven through the SAME signature-verified route with fabricated,
  correctly-signed `customer_cash_balance_transaction` and `cash_balance.funds_available`
  events. A handler cannot tell a fabricated one from a real one — that is what makes the
  coverage both $0 and complete for the SHAPES Stripe documents. It is NOT evidence that
  Stripe sends those shapes.
- `convex/billing` also picks up `billingRollup.test.ts` (same prefix). `reliabilitySweep.test.ts`
  is in the list because it pins the CRON COUNT — 28.1-07 moved it 5 → 6, and a job added
  without touching that number is meant to be red.
- The rollup's Stripe calls are a stubbed `fetch` that records every Request. Nothing there is
  evidence that Stripe ACCEPTS `pending_invoice_items_behavior`, that a finalize returns
  `hosted_invoice_url`, or that `amount_due` carries tax. **No invoice has ever been posted.**
- Manual/live: nothing here has been verified against Stripe. A live check needs 28.1-02's
  credentials plus `stripe listen --forward-to` and `stripe trigger`.

## Operations — a `claimed` billing period that is not moving (28.1-07)

A `billingPeriods` row sitting at `status: "claimed"` for more than `CLAIM_STALE_MS` (one hour)
means the SCHEDULER CHAIN WAS SEVERED: `tick` claimed the period and scheduled `postInvoice`, and
that action died before `settlePeriod` ran. Actions are at-most-once and are not auto-retried, so
nothing will resume it on its own.

**You do not need to do anything.** The NEXT daily tick re-claims any `claimed` row past the
threshold and schedules the post again, which is why the row is not lost. `reliability-sweep`
(every 30 min, `crons.ts`) remains the repo's general surface for non-terminal states; a second
watchdog for this table was deliberately not built.

**When to actually look:** a row at `status: "failed"` with `attempts >= MAX_PERIOD_ATTEMPTS` (5)
has STOPPED. It stays in the table, visible, with a `failureCode` — read that code first:

| `failureCode` | Meaning |
| --- | --- |
| `no_stripe_customer` | The tenant has no `billingCustomers` mapping. Nothing is auto-provisioned; see the orphan runbook below. |
| `mixed_currency` / `duplicate_charge_ref` / `unusable_charge_amount` / `too_many_charges` | The period row itself is malformed — a producer bug, not a Stripe problem. |
| `no_charges_in_period` | Every charge on the row falls outside `[periodStart, periodEnd)`. |
| `no_hosted_url` / `unreadable_invoice_total` | Stripe finalized the invoice but the response could not be read. **A Stripe invoice may exist**; check the Dashboard before re-running anything. |
| anything else | Stripe's own `error.code`, or `stripe_http` / `stripe_network` / `stripe_timeout`. |

## Operations — reconciling an ORPHANED Stripe customer (28.1-05)

A dead letter with `source: "billing"` and `error: billing_unknown_tenant` /
`billing_unattributable_customer` means **somebody paid and this deployment has no idea who.**
It is filed under the code-owned sentinel tenant `billing:unattributed`, so it is invisible to
every tenant and visible to the owner through `deadLetters.listAll` on `/ops`.

There is no code path that fixes this and there is deliberately not going to be one — an
"attach this customer to that tenant" button is the auto-provisioning door with a human in
front of it. The recovery is manual and it is a decision, not a repair:

1. Read the payload: `stripeCustomerId`, `stripeEventId`, `stripeEventType`, `stripeObjectId`.
   Nothing else is stored, and nothing else ever will be.
2. Look the customer up in the Stripe Dashboard by `cus_…` to see who they are. That lookup
   happens in Stripe, NOT in this database — which is exactly why the email is not stored here.
3. Decide which of the two real situations it is:
   - **They have an account.** Have them sign in and run Checkout again; the new session
     carries a `client_reference_id` and maps correctly. Then **refund or cancel the orphaned
     subscription in the Dashboard** — otherwise they are charged twice.
   - **They have no account.** Refund in the Dashboard and invite them. Do not create a user
     to make the row fit.
4. `deadLetters.markResolved` is TENANT-scoped, so an owner cannot clear the sentinel row from
   `/ops` today. The row stays. That is a known gap, not a mystery — see below.

A `billing_customer_tenant_conflict` / `billing_tenant_customer_conflict` row is a different
problem: the tenant IS known and the mapping was NOT changed. Someone has two Stripe customers
or two tenants share one. Resolve it in the Dashboard and leave the stored mapping alone.

## Operational notes

- Secret: `npx convex env set BILLING_STRIPE_WEBHOOK_SECRET whsec_…` from `packages/backend`.
  Roll it by adding the new secret in the Dashboard first; the receiver checks every `v1` value, so
  both old and new signatures verify during the overlap.
- Merchant account: `acct_1U9DJHV05ajSTq7I` ("Pikar-Ai", test **and** live);
  `acct_1U9DJsV05pYaPPIE` is the sandbox. Zero products configured in test mode as of 2026-08-28.
- The endpoint URL is the Convex **site** origin (`*.convex.site`), not the app origin.
- Event ORDER is not guaranteed by Stripe. Do not build sequencing assumptions on arrival order.

## Operations — owner duties that no code can do

### Tax threshold monitoring is an OWNER duty, and the absence of a monitor is deliberate

**There is ZERO threshold-monitoring code in this repo and there must never be any.** That is not
an oversight; a monitor could never fire. Each of these is a verified Stripe fact:

- **No webhook exists.** There is no `tax.threshold.*` event type at all — the only tax event
  Stripe emits is `tax.settings.updated`. There is nothing to subscribe to.
- **Live mode only.** *"Obligations are only monitored in live mode."* Nothing about monitoring
  is observable in test mode, so no test in this repo can cover it and none pretends to.
- **Notification is email + a Dashboard bell** to the account owner (from
  `support+updates@stripe.com`). It never reaches the application by any channel.
- **$10,000 USD of revenue in the previous year is a hard precondition**, alongside: opted into
  Stripe Tax, notifications not disabled, no active live-mode registration for that location, and
  no threshold notification in the past 7 days. **Pikar is below the $10k gate, so no
  notification will fire today** — that silence proves nothing about obligations.
- **The home jurisdiction is never monitored.** The head-office/origin address is what EXCLUDES
  it, not merely what includes others.

**Do not read the silence as safety.** A future reader finding no alerts and no monitor code must
conclude "nobody is watching", not "there is nothing to watch".

**Cadence:** the account owner checks **Dashboard → Tax → Monitoring** manually, **monthly**, and
again within a week of any month where revenue steps up materially. Monitoring attributes a
location per transaction once a day and new transactions surface within ~7 days, so a month is the
smallest window that means anything.

**What code DOES own** (BILL-05's buildable half, 28.1-03): the `taxability_reason`
discrimination. `not_collecting` + a real product tax code = *not owed, unregistered*;
`not_collecting` + `txcd_00000000` = *we declared it nontaxable*, a different claim entirely;
`zero_rated` / `not_subject_to_tax` = *calculated as zero*. Because `not_collecting` is AMBIGUOUS
on its own, `PRODUCT_TAX_CODE` in `packages/billing/src/config.ts` is **load-bearing for the
signal, not cosmetic** — and `config.test.ts` refuses `txcd_00000000` in every state, asserted
against the written-out literal so renaming the constant cannot make it pass vacuously.

**Testing tax at all requires a sandbox registration.** Stripe Tax has SEPARATE settings for
sandboxes and only calculates where a registration exists. With none, every sandbox calculation
returns the same empty result and a broken tax path is indistinguishable from a correct one. Any
such registration goes in `acct_1U9DJsV05pYaPPIE` (the sandbox), never in the live account.

### Bank transfer is COUNTRY-GATED, and the answer is not in this repo

**ANSWERED `true` by the account owner on 2026-08-29.** `BANK_TRANSFER_ENABLED` in `config.ts` is
`true`, so **BILL-03's cash-balance arm is SHIPPED code on a live path, not recorded dead code**, and
the reconciliation law in `reconcile.ts` is load-bearing. (`HEAD_OFFICE_COUNTRY` is still `null` —
the owner deferred it, so `CONFIG_CONFIRMED` stays `false`.) The reasoning that made this a blocking
question is kept below because it is what makes the answer re-checkable:

Bank-transfer eligibility depends on the merchant's country, and **the account's country cannot be
read from this codebase**. That makes it a blocking owner question, not an assumption.

- **Answer `true`** → BILL-03's cash-balance path ships. `invoice.paid` is then NOT cash in hand:
  money lands in the customer **cash balance** first (`funded` = arrival, `applied_to_payment` =
  collection) and can be pulled back (`funding_reversed`).
- **Answer `false`** → a legitimate outcome, not a failure. The cash-balance handlers stay as
  **recorded dead code for this merchant**: their offline tests still prove the LAW — money in a
  cash balance is not collected until it is applied — which is what makes them safe to keep
  rather than delete, and what makes re-enabling after a country change a configuration change
  instead of a rebuild. If it is `false`, `config.ts` names the country and the date on the
  constant, so the answer carries its own expiry.

To exercise bank transfer in test mode the invoice needs `collection_method: "send_invoice"` and
`payment_settings[payment_method_types] = ["customer_balance"]`, then **Send** from the Dashboard
— sending is what mints the customer's virtual bank account number.

### The `BILLING_*` env names are classified WITH their first consumer, never before

**DONE in 28.1-04** — `BILLING_STRIPE_SECRET_KEY` landed in the same commit as `billingApi.ts`, and
`BILLING_STRIPE_PRICE_ID` in the same commit as `billing.ts`. The rule below is kept because it is
what any future `BILLING_*` name must still follow.

`BILLING_STRIPE_SECRET_KEY` and `BILLING_STRIPE_PRICE_ID` were **deliberately not in**
`ENV_MANIFEST` before 28.1-04. `convex/env.test.ts` checks **both directions**: an unclassified consumer fails at
line 82, and a **dead entry that no source reads fails at line 87** ("a name nothing reads is
removed, not carried" — a stale row makes a readiness screen demand a key that does nothing).
Adding a row today, before any `process.env.BILLING_STRIPE_SECRET_KEY` literal exists, was probed
and turned `env.test.ts` **RED**. So each row lands in the SAME commit as its first literal read.
`npx convex env set` does not affect this test either way — the scan reads source, not the
deployment. Use a LITERAL `process.env.X`: a computed `process.env[name]` is invisible to the scan,
which is how `CONNECTOR_CREDENTIAL_KEY_V1`/`_V2` escaped classification entirely.

**Set them with** `npx convex env set BILLING_STRIPE_SECRET_KEY sk_test_…` and
`npx convex env set BILLING_STRIPE_PRICE_ID price_1U9oXpV05ajSTq7I4Z4U1se9`, from
`packages/backend` — never Vercel, never `.env`. **Neither is set in any deployment as of
2026-08-29**, so `startCheckout` throws naming the missing variable for every caller.
## Known gaps & deferred work

- ~~**The effect switch handles the four MAPPING types only.**~~ **CLOSED by 28.1-06** — the
  invoice, refund and cash-balance arms all write the ledger now, and the switch is exhaustive.
- ~~**NOTHING PRODUCES A `billingPeriods` ROW.**~~ **CLOSED by 28.1-10** — `raiseAdjustment` is
  the producer, and deliberately the ONLY one. What remains open is narrower and is a DECISION, not
  a gap: **there is no automatic producer.** No subscription renewal, no usage meter and no cron
  opens a period; a period exists because the owner raised a charge on it. Recurring subscription
  revenue is collected by Stripe on the SUBSCRIPTION rail (28.1-04's hosted Checkout), which never
  touches `billingPeriods` — this table is for one-off charges Pikar bills itself.
- **No invoice has ever been posted to Stripe.** Every request above is asserted against a stubbed
  `fetch`. `pending_invoice_items_behavior`, the finalize endpoint's `hosted_invoice_url`, and
  `amount_due` carrying Stripe Tax are all read from Stripe's documentation, not from a response.
- **Bank transfer on the hosted invoice page is COUNTRY-GATED and unanswerable here.**
  `BANK_TRANSFER_ENABLED` is `true` in config, but `HEAD_OFFICE_COUNTRY` is null and
  `CONFIG_CONFIRMED` is `false` — the business is not registered. If transfer turns out not to be
  available for the eventual country, nothing in the code changes and nothing is faked: the hosted
  page serves card payment and the transfer instructions simply do not appear. The code path stays,
  because the law it encodes (we serve a link, we never render a payment surface) is what makes it
  safe to enable later.
- ~~**`billing.invoices` has no caller in `apps/web` either.**~~ **CLOSED by 28.1-09** — it renders
  in `BillingPanel.tsx`, and `billing.test.ts` now asserts the caller set is exactly
  `["BillingPanel.tsx"]` rather than asserting it is empty.
- **The invoice list filters `posted` AFTER paging.** A tenant with more than
  `INVOICE_PAGE_LIMIT` (50) unposted periods could push posted ones off the page. Marked
  `ponytail:` at the site with `by_tenant_status` as the upgrade path; not reachable while no
  producer exists.
- ~~**No UI renders any of the ledger.**~~ **CLOSED by 28.1-09** — `BillingPanel.tsx` on
  `/dashboard/settings` renders subscription state, the portal link, unapplied funds *with* their
  75/90-day age, and `renderTaxPosture`'s words. The `billingEvents` rows themselves are still not
  rendered, and deliberately are not: a tenant's payment history is Stripe's hosted Customer
  Portal, not a table we re-derive.
- **A ledger write that throws is a 500 and a Stripe retry.** `recordBillingMovement` throws rather
  than coercing (the `spendLedger.recordMovement` posture), and `receiveAndApply` does not catch.
  Every caller today comes through `reconcileEvent`, which pre-validates amount and currency, so a
  throw means a programming error — but the CURRENCY-MISMATCH guard could in principle be reached
  by real cross-currency data, and it would be loud rather than absorbed. Recorded, not mitigated:
  a `try`/`catch` inside the mutation would 200 the delivery away and could leave a half-written
  event, which is worse.
- **The 75/90 stage is derived from `observedAt` = the delivery's `event.created`**, not from
  Stripe's own view of when the funds landed. Those should agree; nothing checks it.
- **`invoice.payment_failed` books nothing and dunning is not modelled.** Stripe's Smart Retries
  own that today, and the subscription status on `billingCustomers` is the only trace.
- **NOTHING HAS EVER BEEN DELIVERED.** Every mapping test fabricates a `whsec_`, signs its own
  body and drives the real route in memory. That proves what the handler DOES with a delivery;
  it does not prove Stripe ever sends one, nor that `client_reference_id` survives a real
  Checkout, nor that the field names on a real `data.object` match the ones `eventFacts` reads.
  The first `stripe trigger checkout.session.completed` is where any of that becomes evidence.
- **The sentinel dead letter cannot be cleared from `/ops`.** `deadLetters.markResolved` is
  `tenantMutation`, so it refuses a row whose `tenantId` is `billing:unattributed` for every
  caller including the owner. The row is visible and permanent until an owner-scoped resolve
  exists (deliberately not added here — 25.1-CONTEXT deferred owner-scoped DLQ writes).
- **`pending` is a status Stripe never sends.** It is a code-owned sentinel for "mapped, no
  subscription event seen yet". If Stripe ever introduces a real `pending` status the two would
  collide and `subscriptionState` would keep answering `unknown` — which is safe, but wrong for
  the wrong reason.
- **`HANDLED_EVENT_TYPES` is v1 snapshot events only.** v2 thin events (`v1.billing.meter.*`) need
  a separate endpoint and `parseEventNotification`; mixing them on this route is a defect.
- **SHIPPED (28.1-04), NEVER EXERCISED.** The outbound transport and both doors are proven offline
  against a stubbed `fetch` and 31 mutations. **No request has ever been sent to Stripe**, no
  `BILLING_STRIPE_*` variable is set anywhere, and `CONVEX_SITE_URL` is `http://127.0.0.1:3211`, so
  a live check is not possible from this deployment. A green suite here proves the REQUEST, not that
  Stripe accepts it.
- **`stripeGet` has no production caller.** It exists so the read half of the transport is not
  invented in a hurry in 28.1-05/06. It is tested; it is not used.
- ~~**`portalLink`'s success arm is unreachable until 28.1-05.**~~ **CLOSED (28.1-05).**
  `stripeCustomerFor` is an `internalQuery` over `billingCustomers.by_tenant`, and the success
  path is driven end to end in `billing.test.ts` against a stubbed `fetch`, including a
  two-tenants-on-one-backend test so a "first row in the table" implementation cannot pass.
- ~~**`billingStatus`'s `not_subscribed` and `subscribed` arms are unreachable today.**~~
  **CLOSED (28.1-05).** Both arms are reached from a real row. `unknown` still covers three
  distinct cases — no row, a `pending` row, and a status `subscriptionState` does not recognise.
- **No `automatic_tax` on the Checkout session.** Stripe Tax calculates nothing without a
  registration and there is none, so enabling it would produce `not_collecting` on every line —
  which `taxPosture` already models. Turning `automatic_tax[enabled]=true` on is a deliberate later
  edit paired with a sandbox registration, not a default to flip.
- **Nothing stops a tenant subscribing twice — and 28.1-05 did not fix it, it made it VISIBLE.**
  `startCheckout` still does not consult `billingCustomers` before opening a session. A second
  checkout that produces a second Stripe customer is now REFUSED at the mapping arm and
  dead-lettered (`billing_tenant_customer_conflict`) — but the customer has already been charged
  by then. Refusing at `startCheckout` is 28.1-07's, and it is the one that prevents the charge.
- **No UI calls either door.** `apps/web` has no `/dashboard/billing` page; `success_url` and
  `cancel_url` point at `/dashboard/settings?checkout=…`, which exists but ignores the parameter.
- **[PLANNED]** honest tax posture — `taxability_reason: "not_collecting"` is **ambiguous**, and
  threshold monitoring is live-mode-only and notification-gated at $10k/yr prior-year revenue, so
  BILL-05's "explicit alert" is a posture recorded in code, **not a signal we can receive**. No
  tax-threshold monitor is buildable from Stripe's API and none exists in this repo (28.1-03).
- **[PLANNED]** `convex/tenantDelete.ts` says nothing about billing today; deleting a tenant would
  leave a live subscription charging a card (28.1-08). 28.1-05 made this SHARPER, not safer:
  `billingCustomers` is `tenant_owned`, so the deletion page loop now removes the row holding the
  `stripeCustomerId` — which means 28.1-08's billing arm has to cancel BEFORE the loop runs, or
  the id it needs is already gone.
- **`ponytail:`** the signature check is ~25 hand-written lines of Web Crypto rather than the
  `stripe` SDK. Ceiling: no typed Stripe event objects. Upgrade path: add `stripe` and use
  `constructEventAsync(..., Stripe.createSubtleCryptoProvider())` — `http.ts` cannot be
  `"use node"`, so the sync `constructEvent` is never an option.
