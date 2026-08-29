# PayPal — provider suitability record

> **Decision recorded: `approved_production` — 2026-08-27, on OWNER ATTESTATION of an external PayPal partner approval.** The one
> machine-readable marker below is the authority; the prose is the evidence it was decided
> against. Register and vocabulary: [`README.md`](./README.md).

<!-- phase28-provider-decision
provider: paypal
decision: approved_production
decided_on: 2026-08-27
evidence_first: 2026-08-05
evidence_reverified: 2026-08-27
review_by: 2026-11-27
-->

| | |
|---|---|
| **Provider** | PayPal (Transaction Search / Partner Referrals) |
| **Decision** | **`approved_production`** — owner judgment, 2026-08-27 (plan 28-01 Task 2), on **OWNER ATTESTATION** of live PayPal partner acceptance. Expires `review_by: 2026-11-27`. |
| **Blocker status** | **STANDS — verbatim, in PayPal's live OpenAPI spec (v1.9)** |
| **Evidence first gathered** | 2026-08-05 (`28-RESEARCH.md` lines 172-290) |
| **Evidence re-verified** | 2026-08-27, independent primary-source pass |
| **Re-review by** | 2026-11-27 (90-day evidence life) |
| **Downstream lane** | plan **28-08** (adapter), wave-7 seal **28-25** |

---

## Owner decision — `approved_production`, 2026-08-27 — **on OWNER ATTESTATION**

> **This is testimony, not evidence.** The fact this approval rests on is PayPal's acceptance of
> Pikar as a partner — an event outside this repository. No script here checked it, no vendor page
> proves it, and the evidence pass below established that PayPal's live enablement is a human,
> representative-mediated process with no self-serve answer. It is reproduced verbatim so a later
> reader can see exactly which claim a human made.

**The owner attested, on direct and specific question, on 2026-08-27:**

> Pikar **holds PayPal partner acceptance**, with an **assigned partner manager**, on a **LIVE
> partner account** today.

That is the answer to the owner question below. If the attestation is wrong, third-party Transaction
Search returns 401 Unauthorized, this approval is void, and PayPal is `blocked` again.

**Authorizes:** plan **28-08** (adapter) and production exposure for PayPal, subject to the open
items below and to the wave-7 seal **28-25**.

### Carried forward — NOT resolved by this approval

1. **No revoke endpoint is documented anywhere for PayPal.** `POST /v1/oauth2/token` is the only
   documented authentication call; seller-side revocation of granted third-party permissions is an
   **account action, not an API**. 28-CONTEXT requires per-tenant revocation. **Partner acceptance
   does not create an endpoint** — resolve the revocation story with the assigned partner manager,
   and **28-25 must not seal the lane on an undocumented assumption**.
2. **Sandbox is explicitly NON-PROBATIVE about production authorization.** PayPal states outright
   that sandbox calls work *before* approval. A green sandbox suite is evidence of nothing here and
   must never be cited as corroborating the attestation above.
3. The partner surface is **separate**: `partner-transactions` is named in the published spec with
   **no published operation**. Do not plan on `GET /v1/reporting/transactions` simply behaving
   differently once a partner token is in hand.
4. **The exact read-only permission package is still not documented as self-serve.**
   `ADVANCED_TRANSACTIONS_SEARCH` is schema-expressible, but no public page documents enabling it,
   and the Partner Referrals default feature set is write-capable (`PAYMENT`, `REFUND`,
   `DELAY_FUNDS_DISBURSEMENT`). Agree the package with the partner manager before writing code.
5. Rate limits are **not readable**; data-processing / commercial terms, retention & deletion duties
   and data residency remain **not researched**.

### Scope of this approval

- It is **PayPal's alone.** There is no all-provider approval flag.
- It **expires** `review_by: 2026-11-27`, or earlier on any re-review trigger — including loss of
  partner status or reassignment of the partner manager.
- It was issued **directly as `approved_production`**; no `approved_beta` marker was ever recorded.
  The beta stage was *skipped*, not passed.
- **A partial release is not Phase 28.** PayPal shipping does not complete REVN-01..03 and does not
  complete Phase 28.

---

## The owner question

> **Has Pikar actually been accepted as an approved PayPal partner — i.e. submitted the
> platform-onboarding form, received approval, and been assigned a PayPal partner manager /
> representative on a LIVE partner account (not just a standard developer REST app or a sandbox
> partner setup)?**

No PayPal documentation can answer this. It is a fact about Pikar's relationship with PayPal, and
because PayPal's live enablement is a human, representative-mediated process, it may not have a
self-serve answer at all.

## What the evidence supports

**Per-tenant third-party Transaction Search is not self-serve and cannot be made so by writing
code.** It requires partner-network acceptance plus partner-manager coordination. A plain
client-credentials token reads **only the app owner's own PayPal account** — that is a
single-merchant integration, not a multi-tenant one. Sandbox works before approval and therefore
**proves nothing** about production authorization.

---

## The blocker — stands, verbatim

PayPal's live API reference and its own published OpenAPI spec
(`openapi/reporting_transactions_v1.json`, `info.version` **"1.9"**) both carry, in
`info.description` and in a Note blockquote:

> "Use the Transaction Search API to get the history of transactions for a PayPal account. **To use
> the API on behalf of third parties, you must be part of the PayPal partner network. Reach out to
> your partner manager for the next steps.** To enroll in the partner program, see Partner with
> PayPal."

**Phase 28 must not model ordinary client credentials as per-tenant authorization.** The spec's
`securitySchemes` documents `Oauth2` with **`flows.clientCredentials`** only, `tokenUrl`
`/v1/oauth2/token` — **there is no per-merchant authorization-code grant for this API**, which is
exactly why third-party use falls back to the partner track.

### New evidence — the partner path is a SEPARATE SURFACE

The published spec's `tags` list includes a third tag with **no published path**:

```
{"name": "partner-transactions", "description": "Use the `/partner-transactions` resource to list transactions."}
```

A partner-only resource is **named but its operation is not in the public spec**. This confirms the
third-party path is a **separate, partner-gated surface** — not the same endpoint with a different
token. Do not plan on `GET /v1/reporting/transactions` behaving differently once a partner token is
in hand.

### Sandbox is settled — and it settles nothing about production

`https://developer.paypal.com/platforms/get-started` states verbatim:

> "Note: The PayPal Complete Payments Platform is only available to approved partners. Calls to the
> PayPal Complete Payments Platform APIs without approval will return a 401 Unauthorized HTTP status
> code. **You can call and test the PayPal Complete Payments Platform APIs with your sandbox
> credentials before you are approved.**"

And on going live:

> "Make sure you have filled out this form to be an approved partner. Contact your PayPal
> representative to go live after you've tested your integration. Share the email addresses and
> client IDs for your sandbox and live accounts with your PayPal representative. When you have
> completed the integration checklist, **a PayPal representative can copy your sandbox configuration
> to your live account.**"

**A green sandbox suite is therefore not evidence of production authorization.** Live enablement is
a human action by a PayPal representative, not a developer-dashboard toggle.

---

## Verified from primary vendor documentation (2026-08-27)

| Item | Finding |
|---|---|
| **Published endpoints** | Only `/v1/reporting/transactions` and `/v1/reporting/balances`. Servers: `https://api-m.sandbox.paypal.com`, `https://api-m.paypal.com`. Site nav also references `/v1/reporting/get-balance-net-summary` and `/v1/reporting/get-daily-summary`. |
| **OAuth flow** | Client credentials only, `tokenUrl` `/v1/oauth2/token`. |
| **Scopes (exact)** | `https://uri.paypal.com/services/reporting/search/read` ("Transactions Search") and `https://uri.paypal.com/services/reporting/balances/read` ("List Balances"). Per-operation: `GET /v1/reporting/transactions` requires the search scope; `GET /v1/reporting/balances` requires the balances scope. |
| **Partner Referrals default feature set is WRITE-CAPABLE** | "By default, PayPal configures your REST app with the following:" **`PAYMENT`, `REFUND`, `DELAY_FUNDS_DISBURSEMENT`**. And: "You can configure your app to include additional features by toggling them on in your REST app settings. The features you add to the API call must match those you configure in the REST app. Otherwise, you will receive an error during onboarding." |
| **Read-only features exist in the schema** | From `openapi/customer_partner_referrals_v2.json`, `rest_endpoint_features_enum` (maxItems 20): `PAYOUTS, PAYMENT, REFUND, FUTURE_PAYMENT, DIRECT_PAYMENT, PARTNER_FEE, DELAY_FUNDS_DISBURSEMENT, READ_SELLER_DISPUTE, UPDATE_SELLER_DISPUTE, ADVANCED_TRANSACTIONS_SEARCH, SWEEP_FUNDS_EXTERNAL_SINK, ACCESS_MERCHANT_INFORMATION, TRACKING_SHIPMENT_READWRITE, INVOICE_READ_WRITE, DISPUTE_READ_BUYER, UPDATE_CUSTOMER_DISPUTES, VAULT, BILLING_AGREEMENT, WITHDRAWALS, LINKED_FINANCIAL_INSTRUMENTS, USER_PROFILE, TRANSACTION_RISK_DATA, PAYPAL_BALANCE, EXCHANGE_CURRENCY`. Read-shaped values do exist — `ADVANCED_TRANSACTIONS_SEARCH`, `ACCESS_MERCHANT_INFORMATION`, `PAYPAL_BALANCE` ("Read the merchant balance amount."). |
| **Production review process** | Onboarding step 1: "Fill out this form to tell us about your platform and business… A PayPal representative will evaluate your business needs and contact you about your approval." The checklist also says: "Before you integrate seller onboarding, discuss with your account manager what types of PayPal accounts and payment options will be available to your sellers." |
| **Hard data constraints (Transaction Search spec)** | "The maximum supported range is **31 days**" (date filters); "It takes a maximum of **three hours** for executed transactions to appear in the list transactions call"; "This call lists transaction for the previous **three years**." |

### Doc churn — two of three Aug-5 URLs moved

- `https://developer.paypal.com/docs/transaction-search/` now returns **HTTP 404**. The Transaction
  Search *Integration Guide* — the page that carried the "enable Transaction Search in your REST app
  settings" instructions — has been dropped from the current information architecture. It appears in
  **no** section index of `developer.paypal.com/llms.txt`; only `/api/transaction-search/v1` and the
  legacy NVP/SOAP pages remain. **PayPal's own spec still hyperlinks to that dead URL.**
- The entire `/docs/multiparty/*` tree **301-redirects** to `/platforms/*`. The onboarding checklist
  is now at `/platforms/seller-onboarding/onboarding-checklist`, with the same default-feature text.
- `https://developer.paypal.com/api/rest` still resolves and lists "PayPal Partner Program — Make
  calls on behalf of a third party."

---

## Could NOT verify — do not treat as fact

| Item | Status |
|---|---|
| **Any self-serve route to get `ADVANCED_TRANSACTIONS_SEARCH` toggled on a REST app** | **NOT DOCUMENTED.** A read-only features array is *schema-expressible*, but the only REST-app toggles PayPal documents are Platform Fee (for `PARTNER_FEE`) and Disputes API (for `READ_SELLER_DISPUTE`, `UPDATE_SELLER_DISPUTE`, `DISPUTE_READ_BUYER`, `UPDATE_CUSTOMER_DISPUTES`). **No public page documents how to enable `ADVANCED_TRANSACTIONS_SEARCH`** — and requested features must match the app config or onboarding errors. So: **read-only is schema-expressible, not documented as self-serve.** The exact read-only permission package must be agreed with PayPal before code. |
| **Any token-revocation endpoint** | **NONE DOCUMENTED.** `https://developer.paypal.com/api/rest/authentication/` documents only `POST /v1/oauth2/token` (client credentials, `expires_in` on the access token). Seller-side revocation of granted third-party permissions is an **account action**, not a documented API. **28-CONTEXT requires per-tenant revocation** — treat as unverified and resolve with the partner manager before committing. |
| **Rate limits** | **NOT READABLE.** `https://developer.paypal.com/api/rest/reference/rate-limiting/` returns 200 but renders no content body to a non-JS fetch ("No Headings"). No numeric limits obtained. |
| **Data-processing / commercial terms, retention & deletion duties, data residency / subprocessors** | **NOT RESEARCHED** in either pass. Required before `approved_production`. |
| **Token lifetime specifics** | Only `expires_in` presence confirmed; no value captured. |

---

## Shared checklist

| Requirement | Status | Note |
|---|---|---|
| Stable/versioned endpoints + deprecation policy | verified | Spec v1.9; **but the integration guide 404'd and the multiparty tree moved** — this IA is unstable |
| OAuth grant type | verified | **Client credentials only. No per-merchant authorization-code grant exists.** |
| Refresh behaviour / rotation | n/a | Client credentials — re-mint, no refresh token |
| Revoke | **NONE DOCUMENTED** | Blocking concern against 28-CONTEXT's per-tenant revocation requirement |
| Exact read scopes | verified | Two reporting `…/read` scopes |
| Provider enforces read-only? | **partly** | The reporting scopes are read-only, but the **Partner Referrals default feature set is `PAYMENT` + `REFUND` + `DELAY_FUNDS_DISBURSEMENT`** — write-capable by default |
| External account binding / multi-account | **verified as BLOCKING** | Client credentials bind to the **app owner's own account**; third-party requires partner network |
| Rate / concurrency / pagination | **not readable** | Hard constraints known: 31-day max range, 3-hour transaction latency, 3-year history |
| Webhook signing / replay / ordering | not researched | App-specific, may retry; verify + dedupe if ever used |
| Sandbox / test-account fidelity | **verified as NON-PROBATIVE** | Sandbox works *before* approval; a rep copies sandbox config to live |
| Production review / partner status / lead time | verified as human-mediated | Form → PayPal representative evaluation → approval. **Lead time undocumented.** |
| Data-processing / commercial terms | **not researched** | Gate for `approved_production` |
| Retention / deletion duties | **not researched** | Gate for `approved_production` |
| Data residency / subprocessors | **not researched** | Gate for `approved_production` |
| Live test account + disconnect/re-auth path | **not establishable today** | No documented revoke; production requires partner approval |

### Read surface for plan 28-08 (if admitted)

Only transaction, invoice, settlement and read-only dispute context. **No PayPal invoice sends, no
refunds, no credits** — those are explicitly deferred by 28-CONTEXT.

---

## What plan 28-08 actually built — 2026-08-28

**The lane is BUILT, PARKED, and cannot connect. That is the deliverable, not a shortfall.**

| Landed | What it is |
|---|---|
| `packages/revenue/src/providers/paypal.ts` | Pure normalizer for the two published reporting responses. Decimal strings through `parseMoney` (BigInt/string; no float ever holds an amount). `PAYPAL_PARTNER_TRANSACTIONS_PATH = null` — **the gap as a value**. |
| `packages/backend/convex/paypalAuth.ts` | The authorization model. `classifyGrantSubject` fails CLOSED to `app_owner`; `beginConnect` refuses and names the gap; `disconnect` is a local clear recorded `unsupported`. No token is minted anywhere. |
| `packages/backend/convex/paypalConnector.ts` | Bounded reads, gated for tenants and ungated for the evidence door. Re-checks the grant subject after decryption and refuses an app-owner credential **before the request leaves**. |
| `scripts/smoke-paypal-read.mjs` | Runnable-on-credentials. `--self-test` is 31 offline cases, every guard observed refusing. A bare run exits **2**. |

**No live run has happened and none can happen today.** `beginConnect` refuses because the
third-party read surface is unpublished (carried-forward item 3 below). A client-credentials token
would read **Pikar's own PayPal account**; wiring one into a tenant connection so that something
reads is the data-disclosure defect this lane exists to prevent, and it would have produced a green
suite and a working smoke run.

### New finding from implementation — the invoice half of the read surface was DROPPED

The approved read surface names invoices. PayPal's `rest_endpoint_features_enum` has **no read-only
invoice member**: the only feature that reaches an invoice is `INVOICE_READ_WRITE`, which also grants
invoice dispatch — a write 28-CONTEXT explicitly defers. So `INVOICE_READ_WRITE` is on
`PAYPAL_REFUSED_FEATURES` and the invoice entity does not exist. The read surface built is
**transactions and balances only**. This narrows the approval; it does not widen it.

### Deployment configuration — TWO names, and neither is a credential family

```
cd packages/backend
npx convex env set PAYPAL_PARTNER_MERCHANT_ID   <Pikar's OWN PayPal merchant id>
npx convex env set CONNECTOR_CREDENTIAL_KEY_V1  <base64 32-byte key>   # if not already set
```

There is deliberately **no `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`**, because nothing in this
repository mints a PayPal token. `PAYPAL_PARTNER_MERCHANT_ID` is a public merchant id, not a secret;
it exists so `classifyGrantSubject` can tell Pikar's ledger apart from a tenant's, and every read
fails closed while it is unset.

### Nothing above clears anything

`no-documented-revoke-endpoint` remains **UNRESOLVED**, the `providerGates` lane row remains
**`parked`**, and the `approved_production` marker still rests on owner testimony. A sandbox run
could not change any of that: PayPal states sandbox calls work *before* approval.

---

## Evidence URLs

- https://developer.paypal.com/api/transaction-search/v1/
- https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/reporting_transactions_v1.json
- https://raw.githubusercontent.com/paypal/paypal-rest-api-specifications/main/openapi/reporting_transactions_v1.json
- https://raw.githubusercontent.com/paypal/paypal-rest-api-specifications/main/openapi/customer_partner_referrals_v2.json
- https://developer.paypal.com/platforms/seller-onboarding/onboarding-checklist
- https://developer.paypal.com/platforms/get-started
- https://developer.paypal.com/api/rest
- https://developer.paypal.com/api/rest/authentication/
- https://developer.paypal.com/llms.txt
- https://developer.paypal.com/other/llms.txt
- https://developer.paypal.com/docs/transaction-search/ *(404 as of 2026-08-27 — recorded because the Aug-5 research cited it)*

## Re-review triggers

Standard triggers in [`README.md`](./README.md), plus provider-specific:

- Pikar submits the platform-onboarding form, or receives/loses partner approval, or is assigned a
  partner manager.
- PayPal publishes the `/partner-transactions` operation, or documents a self-serve route to
  `ADVANCED_TRANSACTIONS_SEARCH`.
- PayPal documents a token-revocation endpoint — **this is the single change that would most improve
  this record**.
- The partner-network sentence changes in the OpenAPI spec (`info.version` moves past 1.9).
- Anyone reads the rate-limiting page in a real browser and can source the numbers.

---

*No token, merchant id, client id or client secret appears in this document, by policy.*
