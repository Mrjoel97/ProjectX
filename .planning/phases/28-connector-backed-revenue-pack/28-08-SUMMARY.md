---
phase: 28-connector-backed-revenue-pack
plan: 08
subsystem: revenue-connectors
tags: [paypal, transaction-search, partner-network, read-only, provider-lane, owner-attestation, parked]
requires:
  - 28-01 (paypal admission `approved_production` on OWNER ATTESTATION, one open condition)
  - 28-02 (@pikar/revenue contracts + finance core: Projection, Money, parseMoney, reconcilePayments)
  - 28-03 (sealed credential envelope, 4-state `revocation.upstream`)
  - 28-04 (GET-only allow-listed read transport; `PROVIDER_READ_PATHS.paypal` already populated)
  - 28-26 (provider gate plane; `readPathCount` wired into the pure eligibility rule)
  - 28-18 (playbook/watch ownership — `connector-paypal.md` was pre-registered)
provides:
  - "packages/revenue/src/providers/paypal.ts — decimal-string normalization through parseMoney, page-number pagination, PayPal's 31-day and 3-hour bounds, and PAYPAL_PARTNER_TRANSACTIONS_PATH = null"
  - "convex/paypalAuth.ts — the authorization MODEL: classifyGrantSubject, the read-only feature package, the beginConnect refusal, a local-only disconnect recorded `unsupported`"
  - "convex/paypalConnector.ts — bounded reads over a two-member closed union; the app-owner refusal re-checked AFTER decryption"
  - "convex/paypalConnector.paypalReadEvidence — the ungated internal read 28-25 would drive"
  - "convex/paypalAuth.disconnectForTenant — the lane runner's local clear"
  - "scripts/smoke-paypal-read.mjs — evidence producer + offline validator whose hardest rule is `delegatedMerchant`"
  - "ENV_MANIFEST: PAYPAL_PARTNER_MERCHANT_ID (feature tier, not a credential)"
affects:
  - "28-25 (the PayPal lane seal — still owes the partner-manager answer on revocation AND on the unpublished third-party read surface)"
  - "28-09 (connections UI — `beginConnect` returns a refusal with a reason, not a URL)"
  - "28-12/28-13 (nothing consumes these projections yet)"
tech-stack:
  added: []
  patterns:
    - "an unbuildable vendor surface recorded as a NULL VALUE plus a code-owned sentence, never guessed at"
    - "a refusal is the deliverable when the working alternative is a data-disclosure defect"
    - "the coverage window ends at the provider's own listing latency, so 'ready' is true rather than permanently 'partial'"
    - "an evidence validator that rejects a successful read of the WRONG account, not merely a failed one"
key-files:
  created:
    - packages/revenue/src/providers/paypal.ts
    - packages/revenue/src/providers/paypal.test.ts
    - packages/backend/convex/paypalAuth.ts
    - packages/backend/convex/paypalConnector.ts
    - packages/backend/convex/paypalConnector.test.ts
    - scripts/smoke-paypal-read.mjs
  modified:
    - packages/backend/convex/lib/env.ts
    - packages/backend/convex/_generated/api.d.ts
    - docs/connectors/paypal-suitability.md
    - docs/playbooks/connector-paypal.md
    - docs/playbooks/production-beta.md
decisions:
  - "PayPal client credentials are modelled as an APP-OWNER subject that can never be sealed or read with — three independent refusals, all mutation-proven"
  - "`beginConnect` REFUSES rather than offering an app token as a tenant connection; the lane can therefore never connect today, and that is correct"
  - "`partner-transactions` recorded as `PAYPAL_PARTNER_TRANSACTIONS_PATH = null`; no endpoint invented, no fixture asserting an unproducible response"
  - "INVOICE_READ_WRITE refused, so the invoice half of the approved read surface is DROPPED rather than bought with a write permission"
  - "coverage windows end 3 hours back (PayPal's listing latency) instead of marking every read partial"
  - "page size 100 / page cap 5 recorded as THIS repo's bounds — PayPal's rate limits are unsourced"
  - "revocation stays `unsupported`; `no-documented-revoke-endpoint` UNCLEARED for 28-25"
requirements-completed: []
metrics:
  duration: ~2h10m
  tasks: 3
  files: 11
  tests-added: 74
  completed: 2026-08-28
---

# Phase 28 Plan 08: Independent read-only PayPal rail Summary

The payment rail that refuses to connect — PayPal's third-party read surface is unpublished, so the lane is built, proven offline, and honestly `parked` rather than wired to an app token that would read Pikar's own account.

## What shipped

**Task 1 — the authorization model** (`de37ee0`). `packages/backend/convex/paypalAuth.ts`. It contains no
token mint, no consent URL and no upstream request, and every one of those absences is deliberate.

**Task 2 — bounded reads** (`954f277`). `packages/revenue/src/providers/paypal.ts` (pure) plus
`packages/backend/convex/paypalConnector.ts` (adapter), over the two paths PayPal publishes.

**Task 3 — the lane gate** (`5012171`). `scripts/smoke-paypal-read.mjs`, runnable-on-credentials,
proven offline against a stub, exiting **2** on a bare run.

## THE DEFECT THIS PLAN EXISTS TO NOT SHIP

A PayPal client-credentials token reads **the app owner's own PayPal account**. It authenticates
Pikar, not a tenant. Model it as a per-tenant grant and you get a green suite, a working smoke run,
and Pikar's own payment data rendered to a tenant as if it were theirs — because every gate in this
phase checks that a read **worked**, and not one of them checks **whose money came back**.

So the distinction is made three times, in three different mechanisms, and all three are
mutation-proven:

1. **`classifyGrantSubject` fails CLOSED to `app_owner`.** A missing id, a malformed id and the
   partner's OWN id all collapse to the same answer. Only a well-formed id that is demonstrably
   somebody else's is a `delegated_merchant`. Inverting the partner comparison turns **12 tests red**;
   degrading a malformed id to `delegated_merchant` turns 2 red.
2. **`PayPalCredential.merchantId` is required BY TYPE**, and `parsePayPalCredential` refuses a blob
   without a well-formed one. An app-owner credential cannot survive the ciphertext round trip.
3. **`paypalConnector` re-checks the subject AFTER decryption** and returns `unavailable`
   **before the request leaves** — asserted by `expect(fetchMock).not.toHaveBeenCalled()`, so the
   wrong merchant's rows are never even fetched. Disabling that branch turns 2 red.

A fourth, in the evidence plane: `smoke-paypal-read.mjs` rejects any read that produced rows with
`delegatedMerchant: false`. A well-formed evidence file recording a *successful* read of Pikar's own
account would otherwise have sealed the lane, and nothing else would have noticed.

## THE GAP, RECORDED — NOT INVENTED

PayPal's published spec (`reporting_transactions_v1.json` v1.9) declares a partner-only
`partner-transactions` tag **with no published operation**, and states verbatim: *"To use the API on
behalf of third parties, you must be part of the PayPal partner network."* The third-party read
surface therefore cannot be built from public documentation.

- `PAYPAL_PARTNER_TRANSACTIONS_PATH = null` — the gap as a **value**, with a test asserting it is null
  and that no allow-listed path contains `partner`.
- `PAYPAL_PARTNER_SURFACE_GAP` — one code-owned sentence, so the connector, `beginConnect` and the
  smoke script cannot drift into narrowing it independently.
- **No fixture asserts a `partner-transactions` response.** Every payload in
  `paypal.test.ts` is a `/v1/reporting/transactions` or `/v1/reporting/balances` shape.
- **`beginConnect` returns `{ available: false, because }`.** It mints no state, calls nothing and
  writes nothing. **No tenant can connect PayPal today** — the honest product state, and the
  alternative (sealing an app token) is exactly the defect above.

## Deviations from the plan

**1. [Rule 4-adjacent, decided in-plan] The plan branched on `approved_beta`; the admission is
`approved_production`.** 28-01 skipped beta and recorded production directly, and the suitability
record explicitly authorizes "plan 28-08 (adapter)". The lane checker's `absence` row agrees
("`approved_production` — the lane may be built"). So the build branch was taken, not the
parked/absence branch. No user decision needed: the record already answers it.

**2. [Rule 3] No Partner Referrals creation call was built.** The plan's Task 1 says "implement the
documented seller/partner onboarding flow". Two blockers, both recorded rather than coded around:
the exact read-only feature package is **not documented as self-serve** and must be agreed with the
partner manager first (carried-forward item 4), and the nested referral body cannot go through
`connectorOAuth.postTokenForm`'s flat form/JSON shape — a bespoke POST in a lane module would also
go **red on `check-provider-lane`'s write-verb scan**. Building a request body against an unagreed
permission package is inventing a contract. Recorded in the playbook's Known gaps.

**3. [Rule 1] The evidence validator's `authorization` substring matched its own prose.** The banned
list initially held the bare word, which appears in this repo's own sentence "nothing about
production **authorization**". Every leak case went green for the wrong reason and the good document
failed. Fixed by banning the **JSON key** (`"authorization"`) rather than the word — the same class
of defect as `env.test.ts`'s "guard catching its own documentation", with a comment saying so.

**4. [Rule 3] `npx convex codegen` cannot run here** (no local backend on :3210), so
`convex/_generated/api.d.ts` was hand-edited to register the two new modules. `tsc --noEmit` verifies
the result.

## New finding: the invoice half of the read surface was DROPPED

The approved read surface names invoices. PayPal's `rest_endpoint_features_enum` has **no read-only
invoice member** — the only feature that reaches an invoice is `INVOICE_READ_WRITE`, which also grants
invoice dispatch, a write 28-CONTEXT defers. So `INVOICE_READ_WRITE` sits on `PAYPAL_REFUSED_FEATURES`
and there is no invoice entity. **The rail is transactions and balances only.** This narrows the
approval; it does not widen it. Recorded in the suitability doc and playbook invariant 3.

## Money, and the boundary that would have been silent

PayPal sends decimal strings plus a currency code. Everything goes through `parseMoney` (BigInt and
string arithmetic — `money.ts` is the only module allowed to make a Money):

- `"0.29"` USD is exactly `29`. `0.29 * 100` in IEEE 754 is `28.999999999999996`.
- `"5000"` JPY is `5000` minor units, not `500000` — JPY's ISO exponent is 0.
- `"1.005"` and `"8.165"` USD are **refused**, not silently rounded to whichever side the float fell.
- **A negative amount is KEPT**, and that is the opposite of the Stripe lane's rule on purpose. PayPal
  reports a refund or chargeback as its own transaction with a negative amount and status `S`, while
  the gross charge stays where it is. Refusing it would report money given back as money kept. (Stripe
  nets refunds into the charge row, which is why a negative there means a broken row.)
- `fee_amount` is deliberately not subtracted: netting it would make "received" mean
  "received after fees" in one rail and not the other, and `reconcilePayments` compares across rails.

## Bounds: two different kinds of fact, kept apart

| Bound | Whose fact |
|---|---|
| 31-day maximum range | **PayPal's**, quoted. `paypalReadWindow` refuses 32. |
| 3-hour listing latency | **PayPal's**, quoted. Every coverage window **ends three hours back**, so `ready` is true rather than every read being permanently `partial`. |
| 3-year history | PayPal's, recorded. |
| page size 100, page cap 5 | **THIS REPO'S.** PayPal's rate-limit page renders no content to a non-JS fetch; no limit could be sourced and none is attributed to PayPal. |

`fields=transaction_info` is a **privacy** bound, not an optimisation: `payer_info`, `cart_info` and
`shipping_info` carry a customer's name, email and address, and narrowing the request is the only
place that content can be stopped before it crosses the wire (CLAUDE.md §4). Asserted on the outgoing
URL, not only on the parsed shape.

## Revocation stays open

No revoke endpoint is documented **anywhere** for PayPal; seller-side removal of granted permissions
is an account action. `disconnect` attempts nothing upstream, clears the local ciphertext and records
`revocation.upstream = "unsupported"`. `classifyRevokeOutcome` makes `confirmed` unreachable for this
provider before it examines a status code — a 200 from somewhere would be a revoke pointed at
something else. The evidence validator rejects `confirmed`, `attempted_failed` **and**
`not_attempted` (the last would claim an endpoint exists that we skipped), and a local clear must
carry `grantRemainsGrantedUpstream: true` — the sentence the seller is owed.

**`no-documented-revoke-endpoint` is UNCLEARED. The lane row is `parked`. 28-25 owns both.**

## Sandbox is non-probative, in the gate's own output

PayPal states sandbox calls work *before* approval and a representative later copies a sandbox
configuration to the live account. So `probativeForProduction` is **derived** by the builder
(`mode === "live" && environment === "production"`), never typed by an operator, and the validator
refuses any sandbox or self-test document claiming it. `--verify-evidence` prints a
`*** SANDBOX EVIDENCE IS NON-PROBATIVE ABOUT PRODUCTION ***` banner over live sandbox evidence and a
`*** THIS FILE IS A STUB, NOT A LIVE PASS ***` banner over anything that is not a live run.

The `approved_production` marker is never rendered as verified fact: the code header, the playbook,
the suitability record and the evidence document itself all say it rests on **owner attestation**.

## Task 3 could not run live — and could not have

Same shape as 28-05/06/07, with one difference: those lanes lack a credential, this one lacks a
**route to obtain one**. A bare run exits **2** with `LIVE_EVIDENCE_NOT_PRODUCED` and explains that
this is the expected state. `--self-test` runs **31 offline cases** through the SAME builder a live
run uses and prints "THIS IS NOT A LIVE PASS". Exact deployment names recorded in the script header,
the suitability record and the playbook:

```
cd packages/backend
npx convex env set PAYPAL_PARTNER_MERCHANT_ID   <Pikar's OWN PayPal merchant id>
npx convex env set CONNECTOR_CREDENTIAL_KEY_V1  <base64 32-byte key>
```

Two names, and **neither is a credential family**. There is deliberately no `PAYPAL_CLIENT_ID` /
`PAYPAL_CLIENT_SECRET`: nothing here mints a PayPal token, because the only token it could mint reads
Pikar's account. `PAYPAL_PARTNER_MERCHANT_ID` is a public merchant id whose only job is letting
`classifyGrantSubject` tell Pikar's ledger apart from a tenant's — unset, every read fails closed.

## Verification

| Gate | Result |
|---|---|
| `node scripts/check-phase28-readiness.mjs` | exit **0**, run first, unpiped |
| `cd packages/revenue && npx vitest run` | **296/296** (baseline 265, +31) |
| `cd packages/backend && npx vitest run paypalConnector` | **43/43** |
| `cd packages/backend && npx vitest run` (full) | **2958/2958**, 109 files, **0 failures** — baseline was 2913/2913. Baselined BY FAILURE COUNT. The 1 worker-teardown `ReferenceError: process is not defined` is PRE-EXISTING and present in the baseline too |
| `packages/revenue` `tsc --noEmit` | exit 0, run separately |
| `packages/backend` `tsc --noEmit` | exit 0, run separately (caught 2 real errors a green suite was silent over) |
| `node scripts/smoke-paypal-read.mjs --self-test` | **31/31 guards observed refusing**, exit 0 |
| `node scripts/smoke-paypal-read.mjs` (bare) | exit **2** |
| `node scripts/check-provider-lane.mjs --provider paypal --stage engineering` | **consistent**, adapter + read-only moved PEND→OK, open condition still PENDING |
| `node scripts/check-playbooks.mjs` (unpiped, `</dev/null`) | zero output = pass. **It DID block earlier in this plan** and named the file — its silence here is a real pass, not the known no-op |
| `npx biome check` on all 6 new/changed files | clean |

**11 non-deletion mutations, all RED, all restored** (`diff` against pre-mutation snapshots, tree
verified before and after):

| Mutation | Tests red |
|---|---|
| `classifyGrantSubject` partner comparison inverted | 12 |
| malformed merchant id → `delegated_merchant` | 2 |
| connector app-owner refusal disabled | 2 |
| consumption gate disabled (independently) | 4 |
| refused feature `REFUND` renamed `REFUNDS` | 2 |
| transaction success status `S` → `P` | 7 |
| `PAYPAL_MAX_WINDOW_DAYS` 31 → 32 | 2 |
| listing latency 3h → 2h | 1 |
| `fields` `transaction_info` → `all` | 1 |
| `paypalTime` offset sign flipped | 1 |
| cursor `page + 1` → `page + 2` | 1 |

Bounds imported by tests are additionally pinned as **literals** (`31`, `5`, `100`, `3 * 60 * 60 *
1000`), because a constant the test imports cannot be pinned by mutating it — 28-04's recorded
finding.

## What this does NOT do

- **REVN-03 is NOT complete.** `requirements-completed: []`. The lane is `parked`, its open condition
  is uncleared, and no live gate has run. `requirements mark-complete` was deliberately not called.
- No `/paypal/callback` route and no connections UI (28-09) — there is no consent to come back from.
- Nothing consumes these projections (28-12/28-13).
- No `providerGates` row was sealed. 28-25 owns the live gate.
- Nothing under `packages/billing/`, `convex/billing*.ts` or `BILLING_STRIPE_*` was touched.

## Commits

| Commit | Task |
|---|---|
| `de37ee0` | Task 1 — the authorization model |
| `954f277` | Task 2 — bounded reads |
| `5012171` | Task 3 — the lane gate + docs |

## Self-Check: PASSED

All 6 created files present on disk; all 3 task commits present in `git log`.
`git diff --stat HEAD -- "*.ts" "*.mjs"` empty after each commit — HEAD compiles, no partial staging.
