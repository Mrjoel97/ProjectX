# Stripe — provider suitability record

> **Decision recorded: `approved_production` — 2026-08-27, by OWNER OVERRIDE against this evidence.** The one
> machine-readable marker below is the authority; the prose is the evidence it was decided
> against. Register and vocabulary: [`README.md`](./README.md).

<!-- phase28-provider-decision
provider: stripe
decision: approved_production
decided_on: 2026-08-27
evidence_first: 2026-08-05
evidence_reverified: 2026-08-27
review_by: 2026-11-27
-->

| | |
|---|---|
| **Provider** | Stripe (Connect OAuth / Stripe Apps) |
| **Decision** | **`approved_production`** — owner judgment, 2026-08-27 (plan 28-01 Task 2), **OWNER OVERRIDE** — the evidence did not support production. Expires `review_by: 2026-11-27`. |
| **Blocker status** | **REVERSED — in BOTH directions.** See below. |
| **Evidence first gathered** | 2026-08-05 (`28-RESEARCH.md` lines 172-290) |
| **Evidence re-verified** | 2026-08-27, independent primary-source pass |
| **Re-review by** | 2026-11-27 (90-day evidence life) |
| **Downstream lane** | plan **28-07** (adapter), wave-7 seal **28-24** |

---

## Owner decision — `approved_production`, 2026-08-27 — **OWNER OVERRIDE**

> **This is an override, not a finding.** The evidence below does **not** support production, and the
> owner was shown that before deciding. Nothing in this record became true on 2026-08-27; a person
> accepted the risk.

**What the prepared record said — and still says:** production is **not supportable today** on the
viable route, because **platform-initiated revocation for Stripe Apps is undocumented**. Only two
mechanisms exist in the documentation: the *user* uninstalling from Settings → Installed Apps, and
the `account.application.deauthorized` event that reports it after the fact. Connect's
`POST https://connect.stripe.com/oauth/deauthorize` belongs to the *other* flow, and no documentation
says it applies to app installs. **28-CONTEXT makes per-tenant revocation a hard requirement.**

**The owner overrode that on 2026-08-27** and recorded `approved_production` anyway.

### The condition REMAINS OPEN

This approval does not resolve it, soften it, or discharge it.

- **28-24 must confront it** — with a Stripe support answer, or with an explicit, tenant-visible
  statement that "disconnect" on this route means Pikar stops using and deletes the stored ciphertext
  locally while the grant stays live on Stripe's side until the user uninstalls.
- It must **not** be closed by a green test. No test in this repository can prove a revocation API
  that is not documented to exist.

### Route — this part is evidence, not testimony

- Connect **Extensions are deprecated**: "You can no longer build new Connect extensions." The
  2026-08-05 remedy of "become an Extension" is a closed door, not a slow one.
- The route is therefore a **Stripe App** with `stripe_api_access_type: "oauth"` declaring only
  `*_read` permissions — read-only by construction.
- Stripe's own `oauth-changes-for-standard-platforms` page **still describes the dead Extension
  path**. It is stale. Do not follow it and do not cite it.

**Authorizes:** plan **28-07** (adapter) and production exposure for Stripe, subject to the open
condition above and to the wave-7 seal **28-24**.

### Scope of this approval

- It is **Stripe's alone.** There is no all-provider approval flag.
- It **expires** `review_by: 2026-11-27`, or earlier on any re-review trigger — including the day
  Stripe documents a platform-initiated revoke, which would turn this override back into an
  evidence-supported decision.
- It was issued **directly as `approved_production`**; no `approved_beta` marker was ever recorded.
  The beta stage was *skipped*, not passed.
- Data-processing / commercial terms, retention & deletion duties and data residency remain **not
  researched**. The override covers them by silence, which is not the same as clearing them.
- **A partial release is not Phase 28.** Stripe shipping does not complete REVN-01..03 and does not
  complete Phase 28.

---

## The owner question

> **Is Pikar's Stripe account's Connect application currently registered as an "Extension" under
> Connect Settings → Availability (i.e. grandfathered in before Stripe closed new Extension creation
> in 2022), or as a "Platform"? And does the account already own a published or uploaded Stripe App,
> given Stripe allows only one published app per account?**

No Stripe documentation can answer this. It is a fact about Pikar's Stripe account.

## What the evidence supports

**A read-only Stripe integration is achievable without being an Extension**, via a Stripe App
declaring only `*_read` permissions. A 0-to-25-customer pilot needs **no Stripe approval at all**.
Publishing costs a ~4-business-day App Review, one published app per Stripe account. **The one
unresolved condition is server-initiated revocation**, which 28-CONTEXT requires and which is
undocumented on this route.

---

## The blocker — reversed in both directions

### Worse: the Extension door is CLOSED, not gated

The 2026-08-05 record said Pikar "must be accepted/configured as an Extension or explicitly decide
that Stripe is blocked." **That remedy no longer exists.**

`https://docs.stripe.com/building-extensions` is now titled **"[Deprecated] Legacy Connect
extensions"** and carries the banner:

> "Stripe Apps replaces Connect extensions — You can no longer build new Connect extensions."

The migration page repeats it verbatim: "You can no longer create new Connect extensions. All
mention of legacy Connect extensions were removed from the Stripe Partner Directory." and "Stripe
Apps replaced Connect extensions as the preferred way to integrate Stripe with other tools as of
2022."

**There is no application, review, or self-serve path to Extension status.** The recorded blocker is
now **unresolvable on its own terms** — anyone planning around "become an Extension" is planning
against a closed door. (The underlying Connect constraint is still literally true: the Connect OAuth
reference still documents `scope` as "read_write or read_only… Note read_only [can only be specified
for extensions]", and "Only Extensions can use `read_only`, which ensures that platforms can't read
other applications' data.")

### Better: a non-Extension read-only route EXISTS

The Aug-5 record framed read-only Stripe as possibly impossible for a non-Extension. **That is wrong
as of today.**

A **Stripe App** with `stripe_api_access_type: "oauth"` declaring only `*_read` permissions is
**read-only by construction**, and any Stripe account can install it. Verbatim permission examples
from Stripe's reference: `charge_read`, `customer_read`, `invoice_read`, `subscription_read`,
`payment_intent_read`, `balance_read` (read-only, no write counterpart), `payout_read`,
`dispute_read`, `event_read` (read-only), `connected_account_read`,
`report_runs_and_report_types_read`, `balance_transaction_source_read`.

Stripe states this is the intended successor. Migration page: Connect extensions "are limited to
either all read or all write permissions. No support for granular permissions," versus "You can
request a granular set of permissions from users as part of app installation." The publish-app page
says outright: **"Stripe deprecated the Connect Stripe authentication method, so use this OAuth
method instead."**

**Pikar does NOT need to be an Extension to read a connected Standard account.**

### DOC HAZARD — Stripe contradicts itself, and the stale page is the one Aug-5 cited

`https://docs.stripe.com/connect/oauth-changes-for-standard-platforms` **has not been updated for
the deprecation** and still instructs: "if you previously selected `Platform` for your Connect
application and you now need Extension functionality, you must contact us to modify your integration
selection" (Connect Settings → Availability).

That instruction appears stale against the deprecation notice. **Do not treat it as a live path
without a support ticket confirming it.** It is one of the two URLs the 2026-08-05 research cited for
this blocker.

---

## Verified from primary vendor documentation (2026-08-27)

| Item | Finding |
|---|---|
| **Stripe Apps authorize URL** | `https://marketplace.stripe.com/oauth/v2/authorize?client_id=…&redirect_uri=…&state=…` |
| **Token exchange** | `POST https://api.stripe.com/v1/oauth/token` with `code=ac_***`, `grant_type=authorization_code`, authenticated with the app developer's secret key |
| **Scope string returned** | Literally `"scope": "stripe_apps"` — **not** `read_only`/`read_write`. Actual access is governed by the **manifest permissions**, not the scope string. |
| **Token lifetimes** | Access tokens expire in **1 hour**; refresh tokens expire after **1 year** and are **rolled on every exchange** (`grant_type=refresh_token`) |
| **Manifest requirements** | `stripe_api_access_type: "oauth"`, `distribution_type: "public"`, `allowed_redirect_uris` |
| **Alternative install flow** | A non-OAuth install link returning `user_id`, `account_id`, `state`, `install_signature` (HMAC over `{state, user_id, account_id}` with the app signing secret), then `Stripe-Account: acct_***` header calls |
| **`stripe_api_access_type` values** | `"platform" \| "oauth" \| "restricted_api_key"` |
| **Third route — Restricted API Keys** | `restricted_api_key`: "When a user installs your app, Stripe generates a permissioned, restricted API key that users need to copy and paste into your software." Read-only capable. But: "Using RAK authentication requires at least some user interaction" — a **manual copy-paste onboarding step**, worse UX — and "After you upload your RAK app, you can't change the API authentication method." |
| **App Review** | Required to publish publicly: "Your app must pass App Review to list it in the Stripe App Marketplace"; "you'll receive an email in **4 business days** with an approval or feedback." Restrictions: **"You can only publish one app per account"**; "You must activate your account"; listing name "must not contain any of the following words or names: 'Stripe,' 'app,' 'free,' or 'paid.'" Public OAuth install links "don't work until the app is published." |
| **ESCAPE HATCH — external testing** | Other accounts can install an **unpublished** public app: "There is a limit of **25 testers per app**" — **no review needed**. Caveat: "You must inform your users that test apps are still in development and haven't been reviewed by Stripe." **A 0-to-25-customer pilot needs no Stripe approval at all.** |
| **Connect deauthorize (Connect route only)** | `POST https://connect.stripe.com/oauth/deauthorize`, params `client_id` and `stripe_user_id`, platform secret key auth, returns `stripe_user_id`. Caveat verbatim: "You can only revoke a Standard account's access to your platform"; error `no_deauth_on_controlled_account` directs to the rejection API. Dashboard equivalent "permanently resets all platform controls on the account." |
| **Rate limits** | Live mode **100 req/s**; Sandbox **25 req/s**. Individual endpoints 25 req/s unless noted. Search API **20 read req/s**. 429s carry `Stripe-Rate-Limited-Reason` with values `global-rate`, `endpoint-rate`, `global-concurrency`, `endpoint-concurrency`, `resource-specific`. |
| **Connect OAuth `read_write` limitation** | "Platforms using OAuth with `read_write` scope can't connect to Standard accounts that are controlled by another platform" (since June 2021). |

### MATERIAL CEILING — API read-request allocation

This is a real constraint on a polling revenue pack and was not in the Aug-5 record:

- "Your account's read API requests must not exceed an average of **500 per transaction**"
- "Connect platforms use a separate allocation to make read requests on behalf of their connected
  accounts using either their secret API key or OAuth access tokens. This allocation is also 500
  requests per transaction based on the **aggregate transaction count across its connected accounts**"
- Rolling **30-day** window
- "Every account, regardless of transaction count, has a **minimum allocation of 10,000 read requests
  per month**"
- "Write API requests have no allocation limit." Data/Reporting/Tax product endpoints are excluded
  from the allocation.

**A low-transaction connected account gets 10,000 reads/month, floor.** Poll budgets, cache windows
and page sizes in plan 28-07 must be sized against this, not against the 100 req/s rate limit.

---

## Could NOT verify — do not treat as fact

| Item | Status |
|---|---|
| **A platform-initiated revoke / uninstall API for Stripe Apps** | **UNVERIFIED — LOAD-BEARING OPEN CONDITION.** Only two mechanisms are documented: (a) the **user** uninstalling from Settings → Installed Apps, and (b) verbatim, "An `account.application.deauthorized` event occurs when a user disconnects your app from their account." **Do not assume Connect's `POST https://connect.stripe.com/oauth/deauthorize` works for app installs** — that endpoint belongs to the Connect OAuth flow, and no documentation says it applies to Stripe Apps. **28-CONTEXT requires per-tenant revocation.** If Pikar cannot revoke server-side, disconnect on the Stripe Apps route means: stop using and delete the stored ciphertext locally, with the grant remaining live on Stripe's side until the user uninstalls. That is a materially different revocation story and **must be confirmed with Stripe before committing to this route**. |
| **The `oauth-changes-for-standard-platforms` "contact us" path** | Appears stale against the deprecation banner. Unreliable without a support ticket. |
| **Data-processing / commercial terms, retention & deletion duties, data residency / subprocessors** | **NOT RESEARCHED** in either pass. Required before `approved_production`. |
| **Sandbox fidelity for the Stripe Apps OAuth install flow** | Not assessed. Sandbox rate limit (25 req/s) differs from live (100 req/s). |

---

## Shared checklist

| Requirement | Status | Note |
|---|---|---|
| Stable/versioned endpoints + deprecation policy | verified | **Connect Extensions deprecated**; Stripe Apps is the successor. Pin an API version. |
| OAuth grant type | verified | Authorization code via `marketplace.stripe.com/oauth/v2/authorize` |
| Token lifetimes / refresh rotation | verified | 1 h access; 1 y refresh, **rolled on every exchange** |
| Revoke | **UNVERIFIED on the viable route** | Connect deauthorize verified but belongs to the *other* flow. See above. |
| Exact read scopes | verified | Manifest `*_read` permissions; response scope string is just `stripe_apps` |
| Provider enforces read-only? | verified | **Yes** — an app declaring only `*_read` permissions is read-only by construction |
| External account binding / multi-account | verified | Per installing Stripe account (`acct_***` via `Stripe-Account` header on the install-link flow) |
| Rate / concurrency / pagination | verified | 100 req/s live, 25 sandbox, 20 req/s Search — **and the 500-reads-per-transaction / 10,000-per-month allocation** |
| Webhook signing / replay / ordering | not researched | v1 polls on demand. `account.application.deauthorized` is the one webhook that matters for disconnect. |
| Sandbox / test-account fidelity | not researched | Different rate limit; install-flow fidelity unassessed |
| Production review / marketplace / lead time | verified | App Review ~**4 business days**; one published app per account; **25 testers with no review at all** |
| Data-processing / commercial terms | **not researched** | Gate for `approved_production` |
| Retention / deletion duties | **not researched** | Gate for `approved_production` |
| Data residency / subprocessors | **not researched** | Gate for `approved_production` |
| Live test account + disconnect/re-auth path | **blocked on the revoke question** | Cannot be designed until server-initiated revoke is settled |

### Read surface for plan 28-07 (if admitted)

Expose only list/retrieve for balances, charges/payment intents, invoices, payouts/balance
transactions and disputes. **Never** export refund, capture, cancel, invoice send/finalize, dispute
update, transfer, payout-create, customer update, or a generic request method. Do not request
`read_write` "for later".

---

## Evidence URLs

- https://docs.stripe.com/connect/oauth-reference
- https://docs.stripe.com/connect/oauth-changes-for-standard-platforms *(STALE — see doc hazard)*
- https://docs.stripe.com/building-extensions *(now "[Deprecated] Legacy Connect extensions")*
- https://docs.stripe.com/stripe-apps/migrate-connect-extension
- https://docs.stripe.com/stripe-apps/api-authentication
- https://docs.stripe.com/stripe-apps/api-authentication/oauth
- https://docs.stripe.com/stripe-apps/api-authentication/rak
- https://docs.stripe.com/stripe-apps/reference/permissions
- https://docs.stripe.com/stripe-apps/publish-app
- https://docs.stripe.com/stripe-apps/test-app
- https://docs.stripe.com/stripe-apps/install-links
- https://docs.stripe.com/rate-limits

## Re-review triggers

Standard triggers in [`README.md`](./README.md), plus provider-specific:

- Stripe documents (or a support ticket establishes) a platform-initiated revoke for Stripe Apps —
  **this is the single change that would most improve this record**.
- `oauth-changes-for-standard-platforms` is updated or withdrawn.
- The 25-tester external-testing cap, the one-published-app-per-account rule, or the App Review lead
  time changes.
- The read-request allocation (500/transaction, 10,000/month floor) changes.
- A pilot approaches 25 installing accounts.

---

*No token, account id, client id or secret key appears in this document, by policy.*
