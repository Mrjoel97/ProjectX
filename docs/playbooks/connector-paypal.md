# Playbook: PayPal connector (REVN-03)

> Last verified: 2026-08-28 (28-08 complete — model, reads and the offline lane gate landed)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-08, 28-25) · Related ADRs: none yet

> **Status: BUILT, PARKED, AND UNABLE TO CONNECT — deliberately.** The normalizer, the bounded read
> path and the authorization model all exist and are proven offline. What does NOT exist is a way to
> obtain a credential: PayPal publishes no third-party read surface (`partner-transactions` is named
> in the spec with no published operation), so `beginConnect` declines and names the gap rather than
> offering the app's own client credentials as a tenant connection. **That refusal is the deliverable,
> not a shortfall** — the alternative, wiring an app token into a tenant connection so that something
> reads, is the data-disclosure defect this lane exists to prevent. No PayPal credential exists in any
> deployment; nothing here has ever spoken to PayPal, and the sandbox could not prove it if it had.
> Items still marked **[PLANNED]** are contracts a later plan must satisfy. Shared credential,
> OAuth-state, fetch, telemetry and release rules live in `revenue-connectors.md`.

## Purpose

Read-only access to a tenant's own PayPal merchant data — transactions, invoices, settlement and
read-only dispute context — feeding the deterministic finance core. PayPal carries the phase's most
easily-mismodelled authorization story, and getting it wrong would silently read the **wrong
merchant's** data.

## Key files

- `packages/revenue/src/providers/paypal.ts` (+ `.test.ts`) — **LANDED (28-08 Task 2).** Pure
  normalization of Transaction Search and balance payloads. Decimal strings go through `parseMoney`
  (BigInt/string arithmetic — no float ever holds an amount). Owns the two read paths, the page-number
  pagination, PayPal's 31-day maximum range and its three-hour listing latency, and
  `PAYPAL_PARTNER_TRANSACTIONS_PATH = null` — the gap as a value. No Convex imports.
- `packages/backend/convex/paypalAuth.ts` — **LANDED (28-08 Task 1).** The authorization model:
  the exact read scopes, the read-only feature package and the write-capable set it refuses,
  `classifyGrantSubject` (the app-owner/delegated-merchant split), `parsePayPalCredential`, the
  `beginConnect` refusal, and a local-only `disconnect` recorded as `unsupported`. It mints no
  token: the only token this repo could mint reads Pikar's own account.
- `packages/backend/convex/paypalConnector.ts` (+ `.test.ts`) — **LANDED (28-08 Task 2).** Bounded
  reads over the two allow-listed paths, gated on `providerGates` for tenant-facing callers and
  ungated for `paypalReadEvidence` (the evidence door, so a seal is never a prerequisite for its own
  evidence). Re-checks the grant subject AFTER decryption and refuses an app-owner credential before
  any request leaves.
- `scripts/smoke-paypal-read.mjs` — **LANDED (28-08 Task 3).** Runnable-on-credentials evidence
  producer. `--self-test` runs 31 offline cases through the SAME builder a live run uses and requires
  every guard to refuse; a bare run exits **2**; `--verify-evidence` refuses to read a stub as a live
  pass and prints a non-probativeness banner over sandbox evidence. Its hardest rule is
  `delegatedMerchant`: a read that produced rows on a credential bound to Pikar's own account is
  rejected outright.
- `docs/connectors/paypal-suitability.md` — the suitability record (28-01 drafts, 28-25 decides).

## Dependencies & blast radius

`graphify query "paypal connector"`. Beyond that:

- `revenue-finance.md` consumes these projections. Same double-counting caution as Stripe: a payment
  visible in both PayPal and QuickBooks is reconciled by source authority, never summed.
- Shared envelope + `connectorFetch` + `providerGates`.

## Admission blocker — SETTLED 2026-08-27, with conditions

> **`approved_production`, on OWNER ATTESTATION — testimony, not evidence.** Owner judgment recorded
> in [`docs/connectors/paypal-suitability.md`](../connectors/paypal-suitability.md); that marker block
> is the authority. The owner attested that Pikar **holds PayPal partner acceptance with an assigned
> partner manager on a LIVE partner account today**. Nothing here checked that and no vendor page can.
> If it is wrong, third-party Transaction Search returns 401 and this lane is `blocked` again.
> Expires `review_by: 2026-11-27`.
>
> **STILL OPEN:** **no revoke endpoint is documented anywhere for PayPal** — partner acceptance does
> not create one. Resolve the revocation story with the partner manager; **28-25 must not seal this
> lane on an undocumented assumption.** And **sandbox is explicitly NON-PROBATIVE** about production
> authorization: PayPal states sandbox calls work *before* approval, so a green sandbox suite
> corroborates nothing here.

The authorization shape below is unchanged by the approval:

**An app-level client-credentials token reads the app/merchant's *own* data. It is NOT a general
tenant grant for unrelated Pikar customers.** PayPal states that Transaction Search on behalf of
third parties requires **partner status and partner-manager coordination**.

- Phase 28 **must not model ordinary client credentials as per-tenant authorization.** Doing so would
  serve one merchant's figures to every tenant — a data-disclosure defect that would read green in
  every unit test, because the call succeeds.
- If partner access is approved, use the seller onboarding / Partner Referrals flow.
- The **default onboarding feature set includes write-capable payment/refund permissions**. The exact
  read-only permission package must be agreed with PayPal *before* code is written.
- The partner surface is **separate**: `partner-transactions` is named in the published spec with no
  published operation. Do not expect `GET /v1/reporting/transactions` to behave differently once a
  partner token is in hand.

## Data flow

1. Seller onboarding / Partner Referrals grants access for a specific merchant.
2. Verify the returned merchant id belongs to the intended connection before sealing. **This check is
   the only thing that distinguishes a tenant grant from the app's own account.**
3. Reads are bounded transaction/invoice/settlement/dispute-context calls, date- and page-capped.
4. Adapter emits bounded projections with coverage window, retrieval time and partial/capped state.
5. Disconnect: **local clear only.** PayPal documents no revoke endpoint, so there is no upstream
   call to order anything against; the outcome is recorded `unsupported`, never `confirmed`.

## Invariants — what must never break

1. **Per-merchant binding, asserted on every read.** A projection is attributed only to the merchant
   whose grant produced it. Never to "the app". *Enforced by:* `paypalConnector.accessTokenFor`,
   which classifies the decrypted credential's subject and returns `unavailable` — **without issuing
   the request** — for an app-owner credential or an unset `PAYPAL_PARTNER_MERCHANT_ID`. Two-tenant
   and ciphertext-graft tests in `paypalConnector.test.ts`.
2. **Client credentials are never treated as a tenant grant.** *Enforced by:* `paypalAuth.
   classifyGrantSubject`, which returns `app_owner` for a missing, malformed **or partner-owned**
   merchant id and can only ever return a delegated grant for a well-formed id that is somebody
   else's; `PayPalCredential.merchantId` is required by TYPE and `parsePayPalCredential` refuses a
   blob without one. Both tested in `paypalConnector.test.ts` (28-08 Task 1).
3. **Read-only permission package.** No payment, refund, invoice-dispatch or dispute-write
   permission is requested or reachable. *Enforced by:* `PAYPAL_REQUESTED_FEATURES` /
   `PAYPAL_REFUSED_FEATURES` + `checkGrantedFeatures`, which refuses a grant carrying ANY
   write-capable feature — including PayPal's own default `PAYMENT`/`REFUND`/
   `DELAY_FUNDS_DISBURSEMENT` set. **`INVOICE_READ_WRITE` is refused too**, so the invoice half of
   the approved read surface is DROPPED rather than bought with a write permission: PayPal's feature
   enum has no read-only invoice member.
4. **Revocation is never claimed.** `disconnect` attempts nothing upstream and records
   `revocation.upstream = "unsupported"`; `classifyRevokeOutcome` makes `confirmed` unreachable for
   this provider even given a 200. A local ciphertext clear is not a revocation and must never be
   rendered as one. Open condition `no-documented-revoke-endpoint`, owed by 28-25.
5. **Date and page bounds on Transaction Search.** PayPal's documented maximum range is **31 days**
   and `paypalReadWindow` refuses more. Every coverage window **ends three hours back**, because
   PayPal takes up to that long to list an executed transaction — a window ending at `now` would
   claim coverage of a period PayPal had not finished populating. The page size (100) and page cap
   (5) are **this repository's** conservative numbers, not PayPal's: its rate-limit page renders no
   content to a non-JS fetch, so no limit could be sourced and none is attributed to PayPal.
6. **429/5xx and a page cap are partial, not zero.** Rows already read are never discarded, and the
   projection NAMES what is missing. A missing period is unknown coverage.
7. **No payer, cart or shipping data is ever requested.** `fields=transaction_info` narrows the
   response before it crosses the wire; those blocks carry a customer's name, email and address
   (CLAUDE.md §4). Asserted on the outgoing URL, not only on the parsed shape.
8. Plus every invariant in `revenue-connectors.md`.

## How to change safely

- New permission → re-open the suitability decision with PayPal. Permissions here are contractual,
  not configuration.
- New endpoint → allow-list entry + operation-matrix row + fixture test.
- Webhooks are deferred and app-specific; they may retry, so any later use must verify and dedupe.

## How to verify

| Command | Proves | Needs |
|---|---|---|
| `cd packages/revenue && npx vitest run paypal` | Payload parsing, money boundaries, date/page bounds, partial states. | offline |
| `cd packages/backend && npx vitest run paypalConnector` | Merchant binding, two-tenant isolation, gate vs evidence doors, local-clear semantics. | offline |
| `node scripts/smoke-paypal-read.mjs --self-test` | The evidence builder and every validator guard. **NOT a live pass.** | offline |
| `node scripts/smoke-paypal-read.mjs` | Exits 2. There is no grant to read; see Known gaps. | — |
| `node scripts/check-provider-lane.mjs --provider paypal --stage engineering` | The lane is consistent with its record. **Consistent is not passed.** | offline |

## Operational notes

- **Sandbox proves payload parsing and nothing else.** It does not prove production partner
  authorization. Production exposure needs written approval/status evidence *plus* a controlled
  merchant read. A green sandbox run recorded as lane evidence would be a false `passed`.

## Known gaps & deferred work

- **THE LANE CANNOT CONNECT, and no code change here will fix it.** PayPal's third-party read
  surface is the `partner-transactions` resource, named in the published spec with **no published
  operation**. It cannot be built from public documentation, so `beginConnect` refuses. Resolving it
  is a conversation with the assigned partner manager (28-25), not an engineering task — and the
  tempting shortcut, sealing the app's own client-credentials token as a tenant connection, is the
  data-disclosure defect this whole lane exists to prevent.
- **The exact read-only feature package is still not documented as self-serve.** No public page says
  how to enable `ADVANCED_TRANSACTIONS_SEARCH`, and requested features must match the REST app's
  configuration or onboarding errors. Agree the package with the partner manager before any live run.
- **Invoices are OUT of the built read surface.** PayPal's feature enum has no read-only invoice
  member (invariant 3). Transactions and balances are the whole rail.
- **Rate limits are UNSOURCED.** PayPal's rate-limiting page renders no content to a non-JS fetch, so
  the page size (100) and page cap (5) are this repository's conservative bounds, not PayPal's
  numbers. Do not cite them as PayPal's.
- **No refresh path exists.** PayPal's client-credentials flow issues no refresh token; an expired
  access token is a dead connection, not something the connector renews behind the tenant's back.
- PayPal is the most likely of the four to end as a permanent `parked` — which the release semantics
  support: a parked PayPal must not block a subset release, but it *does* block Phase 28 completion
  (REVN-03).
- PayPal invoice dispatch, refunds and dispute changes are explicitly deferred by the phase boundary.
