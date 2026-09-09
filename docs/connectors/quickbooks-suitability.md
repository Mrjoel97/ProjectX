# QuickBooks Online — provider suitability record

> **Decision recorded: `approved_production` — 2026-08-27, on OWNER ATTESTATION of an external Intuit approval.** The one
> machine-readable marker below is the authority; the prose is the evidence it was decided
> against. Register and vocabulary: [`README.md`](./README.md).

<!-- phase28-provider-decision
provider: quickbooks
decision: approved_production
decided_on: 2026-08-27
evidence_first: 2026-08-05
evidence_reverified: 2026-08-27
review_by: 2026-11-27
-->

| | |
|---|---|
| **Provider** | QuickBooks Online (Intuit) Accounting API |
| **Decision** | **`approved_production`** — owner judgment, 2026-08-27 (plan 28-01 Task 2), on **OWNER ATTESTATION** of live Intuit production credentials. Expires `review_by: 2026-11-27`. |
| **Blocker status** | **STANDS — and is STRONGER than the 2026-08-05 record** |
| **Evidence first gathered** | 2026-08-05 (`28-RESEARCH.md` lines 172-290) |
| **Evidence re-verified** | 2026-08-27, independent primary-source pass |
| **Re-review by** | 2026-11-27 (90-day evidence life) |
| **Downstream lane** | plan **28-06** (adapter), wave-7 seal **28-23** |

---

## Owner decision — `approved_production`, 2026-08-27 — **on OWNER ATTESTATION**

> **This is testimony, not evidence.** The fact this approval rests on is an approval granted by
> Intuit, outside this repository. No script here checked it, no vendor page proves it, and the
> evidence pass below established that no documentation *can* answer it. It is reproduced verbatim so
> a later reader can see exactly which claim a human made.

**The owner attested, on direct and specific question, on 2026-08-27:**

> Pikar **holds live Intuit production credentials today** — i.e. the production **App Assessment
> Questionnaire is APPROVED**.

That is the answer to the owner question below, and production credentials are the entire gate: if
the attestation is wrong, this approval is void and QuickBooks is `blocked` again. Intuit does not
reveal a production Client ID/Secret until it approves the questionnaire, so nothing short of holding
those credentials clears it.

**Authorizes:** plan **28-06** (adapter) and production exposure for QuickBooks, subject to the open
items below and to the wave-7 seal **28-23**.

### Carried forward — NOT resolved by this approval

1. **There is no read-only accounting scope.** `com.intuit.quickbooks.accounting` is the only
   Accounting-API scope and it includes writes; the provider **will not** constrain this.
   → The **compile-time GET / query / report-only endpoint allow-list is MANDATORY**, with no general
   request-method parameter and no entity create/update export. Binding on plan 28-06.
2. **The write blast radius is ACCEPTED, not eliminated.** The owner approved production knowing a
   stolen live token carries full Accounting-API write reach. Containment is entirely Pikar's
   allow-list — there is no vendor-side backstop.
3. **The App Partner Program tier was NOT stated.** The owner attested to production credentials, not
   to a tier. **Open item:** the **Builder tier carries a 500,000 CorePlus API calls / workspace /
   month** ceiling, which would bound a polling revenue pack. Establish the tier before sizing poll
   budgets in 28-06; do not assume headroom.
4. The concurrent-refresh hazard stands: a racing refresh can **kill the connection**, not merely
   fail. Single-flight lease/CAS and atomic write-back of both ciphertexts remain mandatory.
5. Data-processing / commercial terms, retention & deletion duties and data residency remain **not
   researched**.

### Scope of this approval

- It is **QuickBooks' alone.** There is no all-provider approval flag.
- It **expires** `review_by: 2026-11-27`, or earlier on any re-review trigger — including the
  attestation ceasing to hold (credentials revoked, tier changed, connections approaching 500).
- It was issued **directly as `approved_production`**; no `approved_beta` marker was ever recorded.
  The beta stage was *skipped*, not passed.
- **A partial release is not Phase 28.** QuickBooks shipping does not complete REVN-01..03 and does
  not complete Phase 28.

---

## The owner question

> **Has Pikar's Intuit developer app actually submitted and had APPROVED the production App
> Assessment Questionnaire — i.e. do we hold live production QuickBooks Client ID/Secret today — or
> are we still sandbox-only? And if approved, which Intuit App Partner Program tier is the account
> on, given the new Builder-tier 500,000 calls/workspace/month ceiling?**

No Intuit documentation can answer this. It is a fact about Pikar's developer account.

## What the evidence supports

Sandbox engineering is available immediately. **Production is not available at Pikar's discretion at
all** — Intuit does not reveal a production Client ID/Secret until it approves the App Assessment
Questionnaire. Separately, there is **no read-only accounting scope in existence**, so any live
token carries full Accounting-API write blast radius that the provider will not constrain. The
compile-time GET/query-only endpoint allow-list is therefore **mandatory, not a nicety**.

---

## The blocker — both halves hold, one is stronger than recorded

### Half 1 — no read-only scope exists (unchanged, verified)

The scopes doc's table "Current scopes for the QuickBooks Online Accounting API" lists exactly three
entries: **`com.intuit.quickbooks.accounting`** (the whole Accounting API), `com.intuit.quickbooks.payment`,
and `openid`. **No read/write split.** Intuit frames scopes as data "buckets" determining what an app
"can read and update".

Searched and confirmed: there is **no narrower read-only accounting scope today**. The only `.read`
scopes anywhere in Intuit's catalogue are outside the Accounting API — QBO GraphQL
(`app-foundations.custom-field-definitions.read`, `payroll.compensation.read`) and payroll /
workforce / time-tracking scopes (`qb.company.read`, `qb.employee.read`,
`worker-management.employee.read`, `time-tracking.time-entry.read`,
`com.intuit.quickbooks.cash.account.read`, `lending.credit-attributes.read`, and others). **None
cover Accounting-API entities** (Invoice, Bill, JournalEntry, Customer) or the Reports endpoints.
Reading a P&L or an invoice list still requires the full read+write scope.

**Consequence, binding on plan 28-06:** a compile-time endpoint allow-list containing only
GET/query/report calls, with **no general request-method parameter** and no entity create/update
export. This broader stolen-token blast radius must be explicitly accepted by the owner or
QuickBooks stays `blocked`.

### Half 2 — production is an APPROVAL gate, not a self-assessment (STRONGER than recorded)

The 2026-08-05 record called this "production self-assessment". **That understates it.**

Intuit's "Publish your app" page (the non-App-Store production path) makes Step 4 "Complete the App
Assessment Questionnaire" under *Keys and credentials → Production → Compliance*, and **Step 6
states the Show Credentials switch only appears after the questionnaire is approved**.

**There is no production Client ID/Secret until Intuit approves.** It is not a form you file and
proceed past. Lead time is not documented.

Separately, the security-requirements page is scoped to *App Store listing* review, but its "Security
scans and audits" section binds **all** developers under the Intuit Developer Terms: allow Intuit
vulnerability scans within 2 weeks of request (or supply scan results from the last year), and
complete a security affidavit within 2 weeks of request. **Any app with over 500 connections is
pulled into annual review even without an App Store listing.**

---

## Verified from primary vendor documentation (2026-08-27)

| Item | Finding |
|---|---|
| **Authorization endpoint** | `https://appcenter.intuit.com/connect/oauth2` |
| **Token endpoint** | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` (issuer `https://oauth.platform.intuit.com/op/v1`) |
| **Revoke endpoint** | `POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke` — confirmed live in the OIDC discovery document as `revocation_endpoint` (same value for production and sandbox discovery). JSON body `{"token": "<bearer or refresh token>"}` with HTTP Basic client auth. 200 on success, 400 on failure. Revoking removes the app's permissions. |
| **Access token lifetime** | `expires_in` = 3600 (60 minutes). |
| **Refresh token lifetime** | `x_refresh_token_expires_in` = 8640000 s (100 days), rolling — extended on each use. Five-year hard cap exposed as `x_refresh_token_hard_expires_in` (157680000 s), returned **only** when the request sets header `x-include-refresh-token-hard-expires-in: true`. |
| **Refresh token VALUE rotation** | Rotated roughly **every 24 hours** (or on the next refresh after 24h), staling the previous value. Storage must be **write-back-on-refresh, not write-once**. |
| **Concurrent refresh — worse than a transient error** | With two concurrent attempts using the same refresh token, the first succeeds and the second returns `invalid_grant`; **Intuit's servers may treat this as a security issue and revoke the refresh token issued by the first successful call**, so the next refresh also fails and the app must restart the full authorization flow. Multiple attempts may invalidate the refresh token outright. The same one-at-a-time warning applies to exchanging the authorization code. **This mandates a per-connection lease/CAS (single-flight) and atomic replacement of both access and refresh ciphertext.** A racing refresh does not just fail — it can kill the connection and force the user to re-consent. |
| **Account binding** | Per `realmId`. |
| **Rate limits (sandbox and production alike)** | REST: **500 requests/minute per realm ID**, **10 requests/second per realm ID and app**. Batch: recommended max 30 payloads/batch, throttled at 40 batch req/min per realm+app and 120 batch req/min per realm. Combined 800 req/min per realm+app if the app also hits non-QBO endpoints. HTTP 429 on throttle — wait 60 s before retry. Requests over 120 s time out. GraphQL: 500 req/min per realm, 800 req/min per app. |
| **Pagination** | Query responses cap at **1000 entities**; paginate beyond that. |
| **NEW commercial ceiling (not in the Aug-5 record)** | Apps in the **Builder tier of the Intuit App Partner Program** have an included limit of **500,000 CorePlus API calls per workspace per month**, with 429s beyond it. This is a cost/entitlement axis, not just a throttle. |
| **Discovery doc caveat** | `scopes_supported` in the OIDC discovery document lists only `openid`, `email`, `profile`, `address`, `phone` — the API **data** scopes are not advertised there. Do not infer scope availability from discovery. |

### Operational note for future re-verification

`developer.intuit.com` is now a **client-rendered SPA** — WebFetch returns an empty shell for every
doc URL. The readable primary source is Intuit's own docs CDN behind those pages:
`https://static.developer.intuit.com/output_html/qbo/docs/<path>.html`. API reference pages are
served from `https://static.developer.intuit.com/JSONObjects/` and return 403 to direct requests.

---

## Could NOT verify — do not treat as fact

| Item | Status |
|---|---|
| **The "six months" report date-range recommendation** | **UNSOURCED.** The 2026-08-05 record states "Intuit recommends six months for report requests". This could **not** be verified in primary vendor documentation. It is traceable only to an Intuit Developer post on `medium.com/intuitdev` and to a `help.developer.intuit.com` KB article that renders client-side and could not be read as static content — **neither admissible**. It does not appear on the limits-and-throttles page, the rest-api-features page, or the explore-the-API page, and the Reports API reference JSON store returns 403. **Treat the number as unsourced** until someone reads the Reports reference page in a real browser. Bounding report ranges is still correct practice; the *specific* six-month figure has no primary source. |
| **Reports API reference text** (report cell limits, exact parameters) | Not readable — CDN JSON store returns 403. Read in a browser before building report calls. |
| **Approval lead time for the App Assessment Questionnaire** | Not documented. The App Store review (a different process) averages ~7 days. |
| **Data-processing / commercial terms, retention & deletion duties, data residency / subprocessors** | **NOT RESEARCHED** in either pass. Required before `approved_production`. |
| **Sandbox fidelity vs production** | Not assessed. Rate limits are documented as identical; behavioural fidelity is not. |

---

## Shared checklist

| Requirement | Status | Note |
|---|---|---|
| Stable/versioned endpoints + deprecation policy | verified | Endpoints confirmed live via OIDC discovery |
| OAuth grant type | verified | Authorization code, bound to `realmId` |
| Token lifetimes | verified | 60 min access; 100-day rolling refresh; 5-year hard cap |
| Refresh rotation | verified | Value rotates ~24h — **write-back-on-refresh** |
| Concurrency hazard | verified | Concurrent refresh can **kill the connection**; single-flight lease/CAS required |
| Revoke | verified | `POST .../v2/oauth2/tokens/revoke`; call before local deletion |
| Exact read scopes | verified | **`com.intuit.quickbooks.accounting` is the only option and it includes writes** |
| Provider enforces read-only? | verified | **NO. It cannot.** Compile-time GET/query-only allow-list is mandatory |
| External account binding / multi-account | verified | Per `realmId` |
| Rate / concurrency / pagination | verified | 500/min/realm, 10/s/realm+app, 1000-entity query cap, **+ 500k CorePlus calls/workspace/month on Builder tier** |
| Webhook signing / replay / ordering | not researched | v1 polls on demand |
| Sandbox / test-account fidelity | not researched | Sandbox available now, pre-approval |
| Production credentials / review / lead time | verified | **Approval gate — no production credentials until Intuit approves the App Assessment Questionnaire.** Lead time undocumented |
| Ongoing security obligations | verified | Vulnerability scans within 2 weeks of request (or last-year results); security affidavit within 2 weeks; annual review over 500 connections |
| Data-processing / commercial terms | **not researched** | Gate for `approved_production` |
| Retention / deletion duties | **not researched** | Gate for `approved_production` |
| Data residency / subprocessors | **not researched** | Gate for `approved_production` |
| Live test account + disconnect/re-auth path | sandbox only | Production path blocked on the approval gate |

---

## Lane gate status — 2026-08-28 (28-06)

**NO LIVE GRANT WAS AVAILABLE. THE LANE HAS NEVER SPOKEN TO INTUIT.**

The rail is built and offline-proven: `packages/revenue/src/providers/quickbooks.ts` (73 tests),
`convex/quickbooksAuth.ts` + `convex/quickbooks.ts` (90 tests), and
`scripts/smoke-quickbooks-read.mjs` (22 validator cases). Every one of those ran at $0 against a
stubbed transport. **None of them is evidence about QuickBooks.**

The owner ATTESTED on 2026-08-27 that Pikar holds Intuit production credentials. That attestation
is recorded above as testimony and is not a grant: on 2026-08-28 no Intuit credential is loaded in
this deployment, so 28-06 could not run the live report/revoke gate it was asked for. It built the
gate instead, proved the gate's own guards against a stub, and stopped.

Consequently:

- `providerGates.quickbooks` lane stays **`parked`**. `availableProviders` does not list QuickBooks
  and every tenant-facing read returns `unavailable`.
- The open condition **`partner-tier-and-poll-budget` stays UNCLEARED.** The App Partner Program
  tier is still unknown; the Builder-tier 500,000 CorePlus calls/workspace/month figure is a
  documented ceiling for **one** tier, not this app's entitlement.
- **REVN-02 and REVN-05 stay PENDING.** 28-23 owns the live seal.

### Wave-7 owner judgment — `PARK`, 2026-08-31 (28-23)

The owner chose **park** because no controlled live QuickBooks read/revoke observation exists and
the App Partner Program tier/poll budget is still unknown. Structural consistency and offline tests
are not provider evidence, so neither was promoted into a pass.

The repository seal resolved deterministically through:

```text
node scripts/check-provider-lane.mjs --provider quickbooks --seal-decision from-owner
```

Its production payload remains `lane: "parked"`, carries
`evidenceRef: "docs/connectors/quickbooks-suitability.md#decision"`, retains
`reviewBy: 2026-11-27`, and clears **no** conditions. The existing parked gate therefore stays
invisible through the passed-only `availableProviders` projection, while
`partner-tier-and-poll-budget` remains explicitly uncleared. The gate behavior suite passed 25/25
offline checks; no QuickBooks smoke, read, revoke, OAuth, or other Intuit endpoint was invoked.

This decision is reversible. A later review may pass QuickBooks only after controlled live evidence
exists and every open condition is named and cleared; until then REVN-02 and REVN-05 remain pending.

### What the owner must set before the gate can run

All on the **deployment**, not `.env.local` (`cd packages/backend`):

| `npx convex env set` | Why | Without it |
|---|---|---|
| `QUICKBOOKS_CLIENT_ID` | Intuit app identity | `beginConnect` throws naming the variable |
| `QUICKBOOKS_CLIENT_SECRET` | Token exchange, rolling refresh, revoke | No connect, no refresh, no upstream revoke |
| `QUICKBOOKS_REDIRECT_URI` | `https://<deployment>.convex.site/quickbooks/callback` | Intuit refuses the exchange — it matches the registered URI **exactly** |
| `QUICKBOOKS_HOME_CURRENCY` | ISO 4217 of the company's books; optional | Amounts default to `USD`, which **mislabels money** for a non-USD company rather than failing |
| `CONNECTOR_CREDENTIAL_KEY_V1` | Credential envelope key (already required phase-wide) | No credential can be sealed or opened |

Then connect a company and run:

```
node scripts/smoke-quickbooks-read.mjs --tenant <tenantId> --environment sandbox
node scripts/smoke-quickbooks-read.mjs --tenant <tenantId> --environment sandbox --revoke   # DESTRUCTIVE
```

`--self-test` and `--verify-evidence <file>` are offline and require none of the above. A file
recorded in `self-test` mode is refused as lane evidence by name.

### Still not landed

The HTTP callback route. `quickbooksAuth.handleCallback` is an `internalAction` and **nothing
calls it yet** — registering `/quickbooks/callback` on the router touches `http.ts`, which 28-06
does not own (28-09). A live run needs that route first.

---

## Live connect attempt — 2026-09-09 (45-08). BLOCKED at Intuit, NOT on our side.

First attempt to complete a real production consent. It did not connect. Everything below was
observed directly; nothing here is inferred from a previous session's notes.

### Our side is complete and verified live

| Fact | How it was verified |
|---|---|
| `QUICKBOOKS_CLIENT_ID` / `_SECRET` set on prod | `convex env list --prod` (values never printed) |
| `QUICKBOOKS_REDIRECT_URI` = `https://opulent-octopus-494.convex.site/connectors/quickbooks/callback/production` | `convex env get --prod`, read back byte-for-byte |
| The callback endpoint is LIVE and fails closed | `GET` with junk params → `303` to `/dashboard/profile?connect=quickbooks&result=invalid_state`, no provider text in the redirect (§4) |
| The Connect button reaches Intuit | Browser: consent request left with our exact `client_id`, `scope` and `redirect_uri` |
| **The production credentials are VALID** | See the token-endpoint probe below — the one informative provider signal obtained |

### THE REUSABLE DIAGNOSTIC — probe the TOKEN endpoint, never the authorize page

OAuth 2 gives distinct errors for distinct failures at `/oauth2/v1/tokens/bearer`: `invalid_client`
(401) means the client_id/secret pair itself was rejected; `invalid_grant` (400) means the
credentials were ACCEPTED and only the code was bad. So posting a deliberately bogus code answers
“are these keys live?” with no authorization and no consent:

```
curl -u "$ID:$SECRET" -X POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer \
  -H 'Accept: application/json' -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode code=deliberately-bogus-code \
  --data-urlencode "redirect_uri=$RU"
```

2026-09-09 result: **`{"error":"invalid_grant","error_description":"Invalid authorization code"}`**
(HTTP 400). Intuit accepted the production key pair. The keys are not the problem.

### THE AUTHORIZE ERROR PAGE CARRIES NO INFORMATION — do not diagnose from it

`appcenter.intuit.com/app/connect/oauth2` fails to `/oauth2/error` reading “Sorry, but **undefined**
didn't connect”. That app name rendering as `undefined` looks like a clue. It is not. Four requests
were sent and **all four produced the byte-identical page**:

| Probe | Expected to differ? | Result |
|---|---|---|
| real `client_id` + the convex.site URI | — | `/oauth2/error` |
| real `client_id` + the `www.pikar-ai.com` URI | — | `/oauth2/error` |
| real `client_id` + `https://example.com/definitely-not-registered` | yes, if URI matters | `/oauth2/error` |
| **fabricated `client_id`** `ZZnotarealclientid…` | yes, certainly | `/oauth2/error` |

A page that is identical for a client_id THAT DOES NOT EXIST cannot distinguish anything. Any
reading of it — including “Intuit accepted the redirect URI because it got as far as the consent
screen” — is unfalsifiable. The control that establishes this costs one navigation; run it before
theorising, not after. (This is the same discipline as [check-absence-guards]: a detector that
returns the same answer for a known-good and a known-bad input is measuring nothing.)

### The actual blocker — the Intuit developer account has NO WORKSPACE

`developer.intuit.com/workspaces` renders its shell but never resolves — the tab reads
`My workspaces (…)` indefinitely, **no XHR for the list is ever issued** (confirmed by reading the
tab's network log: only a notification-tray POST and a logging POST fire) and there is no console
error. `/app/developer/myapps` now 302s to `/homepage`; the legacy route is gone.

The OAuth 2.0 Playground states it plainly: **“To use playground, you must first create a
workspace.”** In Intuit's current model apps live inside workspaces, so with no workspace on the
signed-in developer account there is no surface that will display the app's registered redirect
URIs — which is exactly the fact needed to finish this.

The owner IS authenticated at Intuit throughout (`Welcome, joel` on appcenter; `My Hub` on
developer.intuit.com), so this is not a sign-in problem.

### What is NOT yet known

Whether the redirect URI is registered against THIS `client_id`. It cannot be read while the
workspace is missing, and — per the table above — it cannot be inferred from the authorize page.
Both of these remain open and neither is favoured by the evidence:

1. the URI is registered on a different key set (development vs production) or a different app; or
2. the app is not eligible to be connected in production yet.

### Owner action required

Creating a workspace changes the Intuit account, so it was not done unilaterally. The owner needs
to reach the app's **Keys & credentials → Redirect URIs** for the PRODUCTION key set and confirm
the value matches `QUICKBOOKS_REDIRECT_URI` exactly, or say which Intuit account holds the app.

### Correction to “Still not landed” above

That section says the HTTP callback route is unregistered and “nothing calls it yet”. STALE as of
this date: `packages/backend/convex/http.ts` registers `pathPrefix:
"/connectors/quickbooks/callback/"` and it is live in production (probed above). The section is
left as written because it is a dated record; this note supersedes it.

---
## Intuit console defect — 2026-09-09 (45-09). ROOT-CAUSED, and NOT fixable from our side.

Continuation of the 45-08 record. The owner reports the same failure from the UI: on the app's
**Keys and credentials** page a redirect URI can be TYPED but **there is no Save button**, so it
is never stored. That, not our configuration, is why every consent attempt fails.

### First: the keys are CORRECT. That question is closed.

They live in the root `.env` as `INTUITAPP_CLIENT_ID` / `INTUITAPP_CLIENT_SECRET` — NOT
`QUICKBOOKS_*`, which is why an earlier grep for `^QUICKBOOKS_` reported them absent and briefly
made “wrong keys on prod” look like the leading theory. Compared by SHA-256 (values never
printed): the deployment's `QUICKBOOKS_CLIENT_ID` and `QUICKBOOKS_CLIENT_SECRET` are
**byte-identical** to the `.env` pair. Search every plausible spelling before concluding a secret
is missing.

### The defect, measured

`developer.intuit.com/workspaces` renders 30 spinners and never resolves. The cause is one
failing call, visible in `PerformanceResourceTiming.responseStatus`:

| Call | Status |
|---|---|
| `identity.api.intuit.com/v2/graphql` | 200 |
| `authz-decision.api.intuit.com/v2/authorize` | 200 (console logs `authZ: Authorize Decision - PERMIT`) |
| `accounts.intuit.com/graphql` | 200 |
| `developerdeveloper.api.intuit.com/v4/graphql` (1st) | 200, 519 bytes |
| **`developerdeveloper.api.intuit.com/v4/graphql` (2nd)** | **0 — response never completed** |

`responseStatus: 0` is a network-layer failure, not an HTTP error the app could render. The app
does not retry: a `fetch` interceptor installed afterwards and re-triggered by switching tabs
captured nothing. The list never arrives, so no workspace UI mounts — which is also why there is
no **Create workspace** control to click, and why the same API failing on the app-settings page
leaves its form with no Save.

**Ruled out, each by test rather than assumption:**

- *Local browser state / extensions* — the owner reproduced it in Incognito with extensions off.
- *Authentication* — authZ returns PERMIT and three other authenticated GraphQL calls return 200.
- *Cookie consent* — OneTrust initialised (`OptanonActiveGroups` populated, no banner). The
  `Script error.` from `otSDKStub.js` in the console is cross-origin noise; it was briefly a
  suspect and is not the cause.
- *A malformed host* — `developerdeveloper.api.intuit.com` looks like a doubled-word typo but
  resolves through Akamai and answers 401 to an unauthenticated POST, exactly as
  `developer.api.intuit.com` does. Real host.

A raw `fetch` to that endpoint from the page returns `401 AuthenticationFailed`, but that probe
omits the bearer ticket the SPA attaches — it is INCONCLUSIVE about the app's own call and must
not be read as the cause.

### Consequence

No redirect URI can be registered until Intuit fixes this account's console, so the production
consent cannot be completed and the lane cannot be sealed. Nothing on our side is outstanding.

### The workaround that needs no fix from Intuit

The app already carries at least one registered redirect URI from when it was built, and the
owner CAN read that page even though they cannot save it. If any registered URI is on a host we
control, point `QUICKBOOKS_REDIRECT_URI` at it and serve the callback there — `http.ts` already
answers `/connectors/quickbooks/callback/:environment` on the deployment, and
`apps/web/app/connectors/[provider]/callback/[environment]/route.ts` forwards the same shape from
`www.pikar-ai.com`. Registering a NEW URI is what is blocked; MATCHING an existing one is not.

---
## DIAGNOSIS CLOSED — 2026-09-09 (45-10). The Intuit APP RECORD is unreadable. Not our config.

The decisive test. The only redirect URI registered on the app is Intuit's own Playground
default, `https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl`. Production was pointed
at that exact string and the owner ran a consent. **It failed with the same
`/oauth2/error`.** A REGISTERED redirect URI is refused, so the redirect URI was never the
variable — and every hour spent on which URI to register was spent on the wrong question.

### The chain, and every link is measured

1. `POST /oauth2/v1/tokens/bearer` with a bogus code → `invalid_grant`, not `invalid_client`.
   **The app exists and its credentials are provisioned.**
2. The consent page says “Sorry, but **undefined** didn't connect.” That `undefined` is the app's
   DISPLAY NAME failing to resolve. Given (1), the app is not missing — so appcenter cannot READ
   its record.
3. The developer console cannot read it either: `developerdeveloper.api.intuit.com/v4/graphql`
   returns `responseStatus: 0` on its second call after a 200 on the first, and does not retry.

One unreadable app record explains all four symptoms — the workspace list that never resolves,
the absent Create-workspace control, the missing Save button on Keys and credentials, and the
refused consent. It is a single Intuit-side data/service defect on this account.

**Note on (2).** A fabricated client_id produces the same page, so the error text alone
discriminates NOTHING — that control still stands. `undefined` becomes evidence only when paired
with (1), which independently rules out “the app does not exist”. Neither fact carries the
conclusion on its own.

### Consequence — nothing on our side is outstanding

`QUICKBOOKS_REDIRECT_URI` is restored to
`https://opulent-octopus-494.convex.site/connectors/quickbooks/callback/production` — the value
that represents intent and the endpoint that is live and fails closed. It is NOT registered on
the app, and cannot be until the console can save. That is now a downstream detail, not the
blocker.

### The standby bridge, if Intuit repairs the app record but not the console

The Playground URI would then be a registered, working redirect that our automation cannot
receive on — but a human can carry the code the last few metres:

1. `convex env set QUICKBOOKS_REDIRECT_URI https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl --prod`
2. Connect from the Connections page; approve consent; the browser lands on the Playground URL.
3. Take `state`, `code` and `realmId` from the ADDRESS BAR (the page itself may render broken).
4. `npx convex run --prod quickbooksAuth:handleCallback '{"environment":"production","state":"…","code":"…","realmId":"…"}'`

`handleCallback` is the SAME internalAction the HTTP callback invokes — it consumes the state row
and seals the credential normally, so this is the ordinary path with a manual last hop, not a
shortcut around it. The code and the state row both expire in ~10 minutes. Refresh and revoke do
not use the redirect URI, so once sealed the lane behaves normally.

### Owner action — Intuit support, nothing else

No configuration change on our side can affect this. The ticket text is in the playbook.

---
## Evidence URLs

- https://developer.intuit.com/app/developer/qbo/docs/learn/scopes · https://static.developer.intuit.com/output_html/qbo/docs/learn/scopes.html
- https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0 · https://static.developer.intuit.com/output_html/qbo/docs/develop/authentication-and-authorization/oauth-2.0.html
- https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq · https://static.developer.intuit.com/output_html/qbo/docs/develop/authentication-and-authorization/faq.html
- https://developer.intuit.com/app/developer/qbo/docs/develop/troubleshooting/oauth-errors · https://static.developer.intuit.com/output_html/qbo/docs/develop/troubleshooting/oauth-errors.html
- https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app · https://static.developer.intuit.com/output_html/qbo/docs/go-live/publish-app.html
- https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/security-requirements · https://static.developer.intuit.com/output_html/qbo/docs/go-live/publish-app/security-requirements.html
- https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles · https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html
- https://developer.api.intuit.com/.well-known/openid_configuration
- https://developer.api.intuit.com/.well-known/openid_sandbox_configuration

## Re-review triggers

Standard triggers in [`README.md`](./README.md), plus provider-specific:

- Intuit introduces **any** read-only accounting scope — that would materially change this record.
- The App Assessment Questionnaire is submitted, approved or rejected.
- Pikar's Intuit App Partner Program tier changes, or the 500,000 CorePlus calls/workspace/month
  ceiling is approached or revised.
- Pikar's connection count approaches 500 (triggers annual security review).
- Someone reads the Reports API reference in a browser and can source or refute the six-month figure.

---

*No token, realm id, client id or client secret appears in this document, by policy.*
