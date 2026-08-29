# Playbook: Billing — Pikar's OWN merchant account (Phase 28.1)

> **Formatting-only pass, 2026-08-29.** `biome format` + `organizeImports` ran across this
> subsystem's files to clear a CI `Lint` red that had been blocking the `Test` and `Build`
> steps behind it since 2026-08-27. Whitespace, line wrapping and import order ONLY — no
> behaviour change, and **this is not a re-verification of anything below.** The
> `Last verified` line still means what it said.

> Last verified: 2026-08-29 against 28.1-05 (`billingCustomers` — the tenant↔Stripe-customer
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
  `UNRECONCILED_RETURN_DAYS` / `UNRECONCILED_SWEEP_DAYS`. BILL-03's pure half: one Stripe event in,
  ledger movements + observations out. Stateless per event (Stripe does not guarantee order) and
  `nowMs` is an ARGUMENT — no clock read inside.
- `packages/billing/src/tax.ts` — `taxPosture` + `renderTaxPosture` + the written-out
  `TAXABILITY_REASONS` table. BILL-05's whole code surface. Pure; the product tax code is an
  ARGUMENT, never read from config inside the function.
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

## Invariants — what must never break

| Rule | Why | Enforced by |
| --- | --- | --- |
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

## How to verify

```bash
cd packages/billing && npx vitest run && npx tsc --noEmit
cd packages/backend && npx vitest run convex/billing convex/env.test.ts convex/importGuard.test.ts convex/dashboardSchema.test.ts convex/deadLetters.test.ts convex/isolation.test.ts
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
- Manual/live: nothing here has been verified against Stripe. A live check needs 28.1-02's
  credentials plus `stripe listen --forward-to` and `stripe trigger`.

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

- **The effect switch handles the four MAPPING types only.** `invoice.*`, `charge.refunded`,
  `credit_note.created` and both cash-balance types are still recorded `ignored`. Ledger writes
  are 28.1-06.
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
