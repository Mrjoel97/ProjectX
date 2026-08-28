# Playbook: Billing — Pikar's OWN merchant account (Phase 28.1)

> Last verified: 2026-08-28 against 28.1-01 (the Stripe webhook receiver and the
> `billingStripeEvents` idempotency table)
> Build history: `.planning/phases/28.1-stripe-billing-invoicing-and-tax-for-pikar-s-own-merchant-account/`
> · Related ADRs: none yet

> **Status: PARTLY IMPLEMENTED.** At the `Last verified` sha the only billing code on disk is
> **the inbound webhook receiver and its dedupe table**: `packages/billing/src/signature.ts`,
> `packages/billing/src/events.ts`, `packages/backend/convex/billingWebhook.ts`, the
> `billingStripeEvents` table, and one `POST /billing/stripe/webhook` route.
>
> **NOTHING IS BILLED YET AND NOTHING HAS EVER SPOKEN TO STRIPE.** There is no outbound transport,
> no Checkout session, no Customer Portal link, no invoice, no tax posture, no ledger write and no
> tenant↔customer mapping. The effect switch in `receiveAndApply` handles **zero** event types
> today: every verified delivery is recorded `status: "ignored"`. `BILLING_STRIPE_WEBHOOK_SECRET`
> is **not set in any deployment** — with it unset the route refuses every delivery, which is the
> correct and current state. Every test in this plan is offline at $0 against a fabricated
> `whsec_test_…` secret; none of them proves Stripe accepts anything.
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
  `classifyEvent`, whose default arm is `{ kind: "ignored" }`.

**Backend**

- `packages/backend/convex/billingWebhook.ts` — `verifyStripeSignature` (the adapter half, built on
  `hmacHex` from `gmailAuth.ts`) and `receiveAndApply`, the `internalMutation` that owns the dedupe
  insert **and** the effect switch in one transaction.
- `packages/backend/convex/http.ts` — the single `POST /billing/stripe/webhook` route.
- `packages/backend/convex/schema.ts` — `billingStripeEvents`, indexed `by_event` and
  `by_object_type`.
- `packages/backend/convex/lib/env.ts` — `BILLING_STRIPE_WEBHOOK_SECRET`, tier `feature`.
- `packages/core/src/tenantData.ts` — `billingStripeEvents: "global"`.

**Tests**

- `packages/billing/src/signature.test.ts`, `packages/billing/src/events.test.ts` — pure, sub-second.
- `packages/backend/convex/billingWebhook.test.ts` — the real route via `convexTest(...).fetch()`.

## Dependencies & blast radius

Run `graphify query "billing webhook"` for the current subgraph. Couplings graphify cannot see:

- **`BILLING_STRIPE_WEBHOOK_SECRET`** (Convex deployment env, `npx convex env set` from
  `packages/backend` — never Vercel, never `.env`). Unset ⇒ the route 400s every delivery. There is
  deliberately **no development fallback** (`p25-no-dev-fallback`).
- **`hmacHex`** is imported across modules from `convex/gmailAuth.ts`. Changing its encoding
  (hex → base64) silently breaks this route; `signature.test.ts` pins the law independently.
- **Stripe Dashboard endpoint configuration** decides which event types are delivered and which API
  version shapes them. Neither is code-owned yet (28.1-02).
- **`SPEND_RAILS` is deliberately untouched.** Billing revenue does not join the spend ledger;
  `packages/core/src/spend.ts` and `convex/spendLedger.ts` must stay unmodified by this subsystem.

## Data flow

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
- **Never** widen this into `connectorFetch.ts` (a GET-only read transport with a deliberately empty
  `stripe: []` allow-list) or into `SPEND_RAILS`.

## How to verify

```bash
cd packages/billing && npx vitest run && npx tsc --noEmit
cd packages/backend && npx vitest run convex/billingWebhook.test.ts convex/env.test.ts convex/importGuard.test.ts convex/dashboardSchema.test.ts && npx tsc --noEmit
cd packages/core   && npx vitest run && npx tsc --noEmit
node scripts/check-playbooks.mjs < /dev/null     # READ ITS STDOUT — it always exits 0
```

- The `packages/billing` run proves the pure signature law and the closed event union.
- The backend run drives the **real** `httpAction` in-memory via `convexTest(...).fetch()`; it
  proves accept/reject and both duplicate shapes. **Never a bare filter** — a filtered run cannot
  tell you `env.test.ts` is red.
- `npx tsc --noEmit` is run **separately per package**: a green vitest suite is not a typecheck.
- Manual/live: nothing here has been verified against Stripe. A live check needs 28.1-02's
  credentials plus `stripe listen --forward-to` and `stripe trigger`.

## Operational notes

- Secret: `npx convex env set BILLING_STRIPE_WEBHOOK_SECRET whsec_…` from `packages/backend`.
  Roll it by adding the new secret in the Dashboard first; the receiver checks every `v1` value, so
  both old and new signatures verify during the overlap.
- Merchant account: `acct_1U9DJHV05ajSTq7I` ("Pikar-Ai", test **and** live);
  `acct_1U9DJsV05pYaPPIE` is the sandbox. Zero products configured in test mode as of 2026-08-28.
- The endpoint URL is the Convex **site** origin (`*.convex.site`), not the app origin.
- Event ORDER is not guaranteed by Stripe. Do not build sequencing assumptions on arrival order.

## Known gaps & deferred work

- **The effect switch is empty.** Every verified event is recorded `ignored`. Ledger writes are
  28.1-06.
- **`HANDLED_EVENT_TYPES` is v1 snapshot events only.** v2 thin events (`v1.billing.meter.*`) need
  a separate endpoint and `parseEventNotification`; mixing them on this route is a defect.
- **[PLANNED]** outbound transport with a deterministic `Idempotency-Key` (28.1-04) — Convex actions
  are at-most-once and Stripe retries, so a mutating POST without a key mints a second invoice.
- **[PLANNED]** tenant↔`customer` mapping and the dead-letter refusal to auto-provision (28.1-05).
- **[PLANNED]** honest tax posture — `taxability_reason: "not_collecting"` is **ambiguous**, and
  threshold monitoring is live-mode-only and notification-gated at $10k/yr prior-year revenue, so
  BILL-05's "explicit alert" is a posture recorded in code, **not a signal we can receive**. No
  tax-threshold monitor is buildable from Stripe's API and none exists in this repo (28.1-03).
- **[PLANNED]** `convex/tenantDelete.ts` says nothing about billing today; deleting a tenant would
  leave a live subscription charging a card (28.1-08).
- **`ponytail:`** the signature check is ~25 hand-written lines of Web Crypto rather than the
  `stripe` SDK. Ceiling: no typed Stripe event objects. Upgrade path: add `stripe` and use
  `constructEventAsync(..., Stripe.createSubtleCryptoProvider())` — `http.ts` cannot be
  `"use node"`, so the sync `constructEvent` is never an option.
