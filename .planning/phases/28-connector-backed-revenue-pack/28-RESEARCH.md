# Phase 28: Connector-Backed Revenue Pack — Research

**Researched:** 2026-08-05  
**Requirements:** REVN-01, REVN-02, REVN-03, REVN-04, REVN-05, REVN-06  
**Research question:** What do we need to know to plan this phase well?

## Executive Summary

Phase 28 is not primarily an API-integration phase. It is a trust-boundary phase with four
independent provider admission decisions, one shared encrypted-credential prerequisite, a bounded
normalization layer, and a deterministic finance package. The upstream Anthropic `.mcp.json` is a
lead list only. None of its URLs, authentication assumptions, scopes, or commercial rights are
evidence that a connector can run inside Pikar's Convex backend or serve unrelated tenants.

The phase should ship in this order:

1. Close dependency and provider-suitability gates before provider code.
2. Add application-level encrypted credential storage and one-time OAuth state handling.
3. Add pure-TypeScript normalized contracts and financial calculations.
4. Implement provider adapters independently, starting with HubSpot, then QuickBooks, then Stripe,
   then PayPal unless real beta-user coverage justifies a different order.
5. Add read-only revenue workflows over Phase 19 and Phase 27 contracts.
6. Add invoice-reminder drafting by reusing the existing email plan; do not add an action type or a
   provider send path.
7. Expose each connector-backed workflow only after automated, live read-only, eval, browser, terms,
   and two-tenant gates pass.

No provider is pre-cleared by this research. HubSpot is the cleanest technical starting point but
its current marketplace rules include a special rule for AI connectors that needs product/legal
classification. QuickBooks offers a broad Accounting scope rather than a read-verb-only scope.
Stripe `read_only` OAuth is available only to Extensions. PayPal third-party Transaction Search
requires partner status. These are go/no-go inputs, not details to resolve after implementation.

The existing Google connection is a useful lifecycle pattern, but not a sufficient credential
pattern: `gmailTokens` stores token strings directly in Convex. The Connections UI already names
encrypted credential storage as the blocker for CRMs and databases. Phase 28 must close that blocker
for its new connectors rather than copying the Google table.

## Requirement Coverage

| Requirement | Planning consequence | Proof required before completion |
|---|---|---|
| REVN-01 | HubSpot gets a provider-specific OAuth/read adapter, bounded contact/company/deal projections, and an independent suitability record. It may link to Phase 19 people but cannot become another person store. | Scope/endpoint/terms record; encrypted and revocable credentials; two-tenant tests; pagination/429/401 tests; controlled live read smoke; no write endpoint reachable. |
| REVN-02 | QuickBooks uses its own OAuth lifecycle and report allow-list. The adapter parses only the reports/entities needed for cash, AR, AP, and revenue. | Realm-bound auth; rotating-refresh-token CAS; sandbox reads; report fixture tests; broad-scope risk accepted or provider blocked; production/self-assessment evidence. |
| REVN-03 | Stripe and PayPal are separate adapters and separate admission gates. Partial/unavailable is a first-class result. | Stripe Extension/read-only eligibility or explicit block; PayPal partner eligibility or explicit block; per-provider revoke, sandbox, rate-limit, pagination, and controlled live-read evidence. |
| REVN-04 | Revenue workflows consume Phase 19 person, consent, suppression, and follow-up APIs plus connector projections. They do not create local opportunities, stages, or deal values. | Integration tests against the landed Phase 19 API; no duplicate person/pipeline tables; external deal facts retain provider provenance; missing CRM facts are unknown. |
| REVN-05 | All arithmetic and confidence classification lives in a Convex-free package. The LLM receives computed results, not operands it is expected to calculate. | Unit, boundary, invariant, and mutation/property-style tests; mixed-currency refusal/separation; coverage/provenance; no financial formula in skill bodies. |
| REVN-06 | Invoice reminders are ordinary email drafts/plans. Provider writes, refunds, credits, dispute changes, CRM mutations, and accounting writes are absent from specialist grants and adapter exports. | Static reachability tests; plan remains `proposed` until human approval; zero sends before approval; Phase 19 suppression check still runs at every email terminal. |

## Dependency Gates

### Phase 19 — hard functional prerequisite

Phase 28 must not begin revenue workflow integration until ACTN-05 and PIPE-01 are complete. Phase
19 owns the only person/follow-up/consent/suppression data plane and the terminal send-path
suppression guard. Phase 28 must consume these landed interfaces rather than anticipate their
schema.

The minimum Phase 19 contract Phase 28 needs is:

- tenant-scoped person resolution by stable local contact id;
- reproducible consent evidence and current suppression state;
- due/overdue follow-up projection;
- a safe way to attach or resolve an opaque provider object reference;
- the bounded Pipeline summary used by Phase 26;
- suppression checks in immediate, scheduled, and legacy provider email terminals.

If Phase 19 does not put provider references on the contact row, Phase 28 may add a narrow join table
`contactProviderRefs(tenantId, contactId, provider, externalObjectIdHash/ref)`. That is an identity
link, not a second contact store. It must not copy names, email addresses, stages, notes, or monetary
values.

Phase 26 plan 26-18 is valuable acceptance evidence, but Phase 28's formal dependency is the
completed Phase 19 requirements and interfaces. Do not duplicate Phase 26's Pipeline route or home
summary.

### Phase 25 — hard deployment/auth prerequisite, not proof of encryption

Phase 25 is expected to establish the multi-user production identity, deployment secret, OAuth,
connection-status, and provider-routing posture. Phase 28 should reuse its final connection UI and
callback conventions. It must inspect the landed code rather than assume Phase 25 created a generic
connector framework.

Phase 25 explicitly avoids abstracting delivery before a second provider exists. The same discipline
applies here: share security primitives and normalized result contracts, but do not force four
vendors through one speculative endpoint/client abstraction.

Most importantly, current Google tokens are plaintext columns in `schema.ts`. Phase 28's requirement
for encrypted credentials is therefore an explicit Wave 1 deliverable even if Phase 25 is complete.

### Phase 27 — hard pack/exposure prerequisite

Phase 28 inherits rather than rebuilds:

- upstream provenance and manual reviewed-diff rules;
- native pack/candidate representation;
- operation-to-tool matrices;
- code-owned tool grants and structural tool absence;
- outcome-state/adversarial eval conventions;
- authenticated responsive browser exposure gate;
- refs/counts/status-only workflow telemetry.

Revenue workflows should be new Phase 27-style candidate versions or additions to the native pack
manifest. They must not introduce a second registry, router, discovery catalogue, or telemetry
plane. Phase 27's active pack version and telemetry helpers should be explicit plan prerequisites.

## Existing Architecture to Reuse

### Tenant boundary

`packages/backend/convex/lib/functions.ts` is the only raw Convex builder boundary.
`tenantQuery`, `tenantMutation`, and `tenantAction` derive `tenantId` from `getAuthUserId`; callers
cannot supply it. New public connector functions must use these wrappers. Internal actions may carry
an explicit tenant id only from a tenant-scoped entry point or a server-minted scheduled job.

Every connection lookup must be keyed by both tenant and provider. External account ids (`hubId`,
QuickBooks `realmId`, Stripe account id, PayPal merchant id) are never authorization inputs by
themselves.

### Existing OAuth lifecycle

`gmailAuth.ts` demonstrates useful patterns:

- callback state is server-bound to the tenant;
- full token rows are internal-only;
- public status returns booleans/timestamps, not tokens or raw scopes;
- refresh failure becomes an honest reconnect state;
- disconnect calls the provider before deleting the local row;
- audit payloads contain flags/status only.

Do not copy three weaknesses into new connectors:

1. token strings are stored directly rather than in an application-encrypted envelope;
2. current Google state is HMAC-bound but has no stored one-time nonce/replay consumption;
3. a shared Google refresh function works because one Google grant covers three Google APIs; it is
   not evidence that unrelated providers share token rotation behavior.

### Code-owned specialist grants

`packages/core/src/specialists.ts` is the capability boundary. The dispatcher resolves a static
specialist spec and passes only `resolved.spec.tools` to the one agent loop. Phase 28 should add a
closed revenue specialist/tool set containing bounded reads and structured refusal only. It must
not include Gmail send, plan approval, provider writes, generic HTTP, arbitrary MCP, or paid media.

### Governed action boundary

`cockpit.executePlan` is a human-triggered `tenantMutation`, not an LLM tool. Its exhaustive arm
table ensures external actions cannot silently inherit the Gmail workflow. Invoice reminders need
no new arm: they are normal email plans and use the existing email workflow after approval. The
revenue specialist may stage a proposed plan through the already-governed planning seam, but cannot
call `executePlan` or any delivery terminal.

## Standard Stack

Use the stack already present unless a live gate proves it insufficient:

- Native `fetch` in provider-specific Convex Node actions, following `gmail.ts`/`calendar.ts`.
- Web Crypto `crypto.subtle` AES-256-GCM for application-level credential envelopes; no custom
  cipher and no new crypto dependency.
- Convex tenant wrappers for public access; internal query/mutation helpers for secrets.
- Strict Convex validators at every persisted or public boundary.
- A new Convex-free `packages/revenue` package for normalized contracts, parsing, money, aging,
  cash flow, payment lag, payroll gap, coverage, and confidence.
- Existing Vitest/convex-test infrastructure. For property-style coverage, use deterministic
  generated loops and invariants rather than adding a property-test library.
- Phase 27 skill registry/eval/browser machinery.
- Existing email plan, approval, scheduler, suppression, telemetry, audit, and notification rails.

Do not add a generic MCP client, a generic user-configurable REST client, a finance SDK solely to
wrap a few GETs, a second workflow runtime, or a parallel CRM/accounting database.

## Provider Suitability Gates

Each provider needs a committed suitability record with an owner, review date, evidence links,
decision (`approved_beta`, `approved_production`, `blocked`, `deferred`), and expiry/re-review
trigger. Code may be written against a sandbox after `approved_beta`; navigation/discovery requires
the appropriate production decision.

Every record must cover:

- stable server-side endpoints and version pinning/deprecation policy;
- tenant authorization flow, state/PKCE requirements, token lifetime, refresh rotation, and revoke;
- exact requested scopes and whether the provider itself can enforce read-only;
- external account binding and multi-account behavior;
- rate/concurrency/pagination rules and retry headers;
- webhook signing, duplication, ordering, retry, replay, and reconciliation behavior, even if v1
  chooses polling;
- sandbox/test-account fidelity;
- production credentials, review, verification, marketplace/partner requirements, and lead time;
- API/developer/data-processing/commercial terms and data retention/deletion requirements;
- data residency/subprocessor implications for Pikar;
- live test account and a disconnect/re-auth test path.

### HubSpot — conditionally first

HubSpot supports public-app authorization-code OAuth with refresh tokens and granular CRM read
scopes. Current documentation uses the versioned OAuth API; pin the chosen version rather than
copying a legacy `/oauth/v1` example. OAuth apps are responsible for TTL and refresh behavior, and
OAuth-distributed apps are rate-limited per installed account. Use batch endpoints where useful and
bound CRM Search separately. See [HubSpot OAuth](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth),
[scopes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes),
and [usage limits](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines).

Minimum requested scopes should be the exact read scopes for contacts, companies, deals, owners,
and pipelines that the operation matrix demonstrates. Do not request any `.write`, import, export,
marketing-send, workflow, or sensitive-data scope.

Use the current token-revoke endpoint, not the legacy refresh-token delete. The legacy delete did
not invalidate existing access tokens or uninstall the app; HubSpot now documents a versioned
revoke endpoint. See [revoke token](https://developers.hubspot.com/docs/api-reference/latest/authentication/oauth-tokens/revoke-token)
and the [v1 migration warning](https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/v1/migration-guide).

Planning blocker: HubSpot's current Marketplace listing rules say an app classified as an “AI
connector” must use HubSpot's MCP Server. Pikar must determine with HubSpot whether this product is
classified that way and whether private/public direct OAuth distribution is permitted for the
intended beta. This does not authorize a generic MCP client. If the classification requires a
provider-specific MCP path, that is a separate architecture and terms decision, not an implicit
fallback. See [Marketplace listing requirements](https://developers.hubspot.com/docs/apps/developer-platform/list-apps/listing-your-app/app-marketplace-listing-requirements).

V1 should poll bounded contact/company/deal pages on demand. Defer webhooks unless latency evidence
requires them; if added later, verify signatures, dedupe event ids, tolerate retries/out-of-order
events, and reconcile with periodic reads.

### QuickBooks Online — broad-scope risk

Intuit OAuth binds the connection to a `realmId`. Access tokens last about one hour; refresh tokens
roll and the latest refresh token must be persisted. Concurrent refresh attempts using the same
token can produce `invalid_grant` and may invalidate the connection, so refresh requires a
per-connection lease/CAS and atomic replacement of both access and refresh ciphertext. Disconnect
must call Intuit's revoke endpoint before local deletion. See [Intuit OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
and the [token FAQ](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq).

The available `com.intuit.quickbooks.accounting` scope grants access to the Accounting API as a
data category; it is not a read-verb-only scope. Pikar therefore needs a compile-time endpoint
allow-list containing only GET/query/report calls, with no general request method parameter and no
entity create/update exports. This broader stolen-token blast radius must be accepted in the
suitability record or QuickBooks remains blocked. See [Intuit scopes](https://developer.intuit.com/app/developer/qbo/docs/learn/scopes).

Use report endpoints such as Cash Flow, aged receivables/payables, and profit/loss only when they map
to a named normalized field. Bound dates (Intuit recommends six months for report requests), pages,
rows, and total bytes. Respect the documented per-realm limits and treat 429 as partial/unavailable,
not zero. See [run reports](https://developer.intuit.com/app/developer/qbo/docs/workflows/run-reports)
and [limits](https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles).

Intuit requires production self-assessment and ongoing security obligations even for production
connections that are not App Store listed. This is a production gate, not post-launch paperwork.
See [platform requirements](https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/platform-requirements)
and [security requirements](https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app/security-requirements).

### Stripe — Extension/read-only eligibility gate

Stripe Connect OAuth for Standard accounts supports account connection and a deauthorize endpoint.
However, Stripe documents that only Extensions can request `read_only`; ordinary Platforms use a
different control model. Pikar must be accepted/configured as an Extension or explicitly decide
that Stripe is blocked for this read-only phase. Do not request `read_write` “for later.” See the
[Connect OAuth reference](https://docs.stripe.com/connect/oauth-reference) and
[read-only Extension constraint](https://docs.stripe.com/connect/oauth-changes-for-standard-platforms).

If cleared, use Stripe's recommended connected-account access model, pin an API version, and expose
only list/retrieve calls for balances, charges/payment intents, invoices, payouts/balance
transactions, and disputes. Never export refund, capture, cancel, invoice-send/finalize, dispute
update, transfer, payout-create, customer update, or generic request methods.

Bound pagination and concurrency, honor 429 and `Stripe-Rate-Limited-Reason`, and represent a capped
search as partial. See [Stripe rate limits](https://docs.stripe.com/rate-limits).

V1 should poll on demand. If webhooks are later justified, use Stripe's official verification
library, preserve raw bodies, enforce timestamp tolerance, dedupe event ids, and tolerate retries
and out-of-order events. See [Stripe webhooks](https://docs.stripe.com/webhooks).

### PayPal — partner approval gate

An app-level PayPal client-credentials token reads the app/merchant's own data; it is not a general
tenant grant for unrelated Pikar customers. PayPal states that Transaction Search on behalf of
third parties requires PayPal partner status and partner-manager coordination. Phase 28 must not
model ordinary client credentials as per-tenant authorization. See [Transaction Search](https://developer.paypal.com/docs/transaction-search/)
and [PayPal REST authentication/partner note](https://developer.paypal.com/api/rest).

If partner access is approved, use PayPal's seller onboarding/Partner Referrals flow and request
only the permissions needed for transaction, invoice, settlement, and read-only dispute context.
The default onboarding feature set includes write-capable payment/refund permissions, so the exact
read-only permission package must be agreed with PayPal before code. See the
[seller onboarding checklist](https://developer.paypal.com/docs/multiparty/seller-onboarding/onboarding-checklist/).

Sandbox proves payload parsing but not production partner authorization. Production exposure needs
written approval/status evidence plus a controlled merchant read. Webhooks are app-specific, may
retry, and must be verified/deduped if later used. See [PayPal webhooks](https://developer.paypal.com/api/rest/webhooks)
and [sandbox](https://developer.paypal.com/tools/sandbox/).

## Credential and OAuth Architecture

### Encrypted envelope

Add an application-level AES-256-GCM envelope for all new connector credentials:

```ts
type CredentialEnvelope = {
  ciphertextB64: string;
  ivB64: string;          // fresh random 96-bit IV per seal
  keyVersion: "v1";
  algorithm: "AES-256-GCM";
};
```

The deployment secret `CONNECTOR_CREDENTIAL_KEY_V1` is a base64-encoded 32-byte key stored only in
Convex environment configuration. Authenticated additional data binds ciphertext to the stable
tuple `tenantId | provider | connectionId | environment | keyVersion`; copying ciphertext to
another tenant/provider must fail authentication. Decryption occurs only inside provider actions or
internal helpers. Public queries return a sanitized `ConnectionStatus`, never ciphertext, IV,
external account ids, scopes, tokens, or provider errors containing secrets.

Schema should separate connection metadata from the envelope but keep them in one tenant/provider
row unless two implementations prove a need for multiple credential records. Required metadata:

- tenantId, provider, environment, status;
- opaque connection id and encrypted provider credentials;
- hashed or server-only external account id;
- key version, granted-capability booleans, access expiry, refresh state;
- connected/revoked/re-auth timestamps;
- last successful read, last failure class, and updated time.

Do not create a public “store secret” mutation. Only provider callback handlers can create/replace
an envelope. Rotation is a planned internal migration: decrypt with old version, reseal with new,
CAS on the original row, and retain the old key until verification completes.

### One-time OAuth state

Use a dedicated short-lived `connectorOAuthStates` row keyed by a hash of a random nonce. It binds
tenant, provider, redirect target, environment, and expiry and is consumed atomically once. HMAC
binding alone prevents tenant tampering but not callback replay. Callback handlers must:

1. validate/consume state before token exchange;
2. exchange the code server-side;
3. verify the returned provider account/realm belongs to the intended connection;
4. seal credentials before persistence;
5. write a refs/status-only audit event;
6. redirect without code/state/token query parameters.

### Refresh and revoke

Refresh is provider-specific. Share only the seal/open primitive and a discriminated lifecycle
result. QuickBooks rotation needs a per-row refresh lease/CAS; HubSpot and other providers must not
inherit that logic without evidence.

Disconnect order is provider revoke/deauthorize first, local encrypted-row delete second, matching
the Google privacy-control invariant. Local deletion should still occur after an already-invalid
provider response, but a network/5xx failure must yield an honest partial-revoke state and retry
path. Audit only provider, connection ref, status code/class, and flags.

## Normalized Bounded Read Models

Provider JSON must terminate inside its adapter. Neither prompts nor React may consume vendor
response shapes. All adapters return:

```ts
type Provider = "hubspot" | "quickbooks" | "stripe" | "paypal";
type SourceRef = { provider: Provider; kind: string; ref: string };

type ProjectionMeta = {
  provider: Provider;
  retrievedAt: number;
  coverageStart: number | null;
  coverageEnd: number | null;
  partial: boolean;
  capped: boolean;
  unavailableReason?: "not_connected" | "reauth" | "forbidden" | "rate_limited" |
    "provider_error" | "unsupported_account";
  sourceRefs: readonly SourceRef[];
};

type Projection<T> =
  | { status: "ready"; data: T; meta: ProjectionMeta }
  | { status: "partial"; data: T; meta: ProjectionMeta }
  | { status: "unavailable"; data: null; meta: ProjectionMeta };
```

`ref` is an opaque provider object reference usable in the content plane. Audit and telemetry use
the connection id plus counts/statuses, or a hash when an external reference is necessary.

Every adapter defines code-owned maximums: lookback window, page size, page count, item count,
response bytes, and timeout. Hitting any maximum returns retained data with `partial/capped`, never
a fabricated complete result. A failed second page must not discard a valid first page.

Recommended projections:

- HubSpot `CrmSignals`: matched Phase 19 contact refs, company/owner refs, source-provided deal
  stage/value/currency/close date, last activity time, next activity time, and missing fields.
  Exclude notes, descriptions, email bodies, custom free-text properties, workflow instructions,
  and write-capable action links from v1.
- QuickBooks `AccountingSnapshot`: home currency, account balances needed for cash, open invoice
  lines, bill/AP lines, report totals, and coverage. Retain report/date/basis provenance.
- Stripe/PayPal `PaymentRailSnapshot`: balances/settlements, invoices, payments/refunds as facts,
  payout state, and read-only dispute status. Drop HATEOAS write links and arbitrary metadata.

Do not persist raw provider payloads. Prefer on-demand action reads for v1. If latency/rate evidence
requires a cache, persist only the normalized projection in a clearly non-authoritative,
time-bounded data-plane table with `retrievedAt`, `staleAt`, coverage, partial/capped state, and an
explicit purge path. It must never become the Phase 19 CRM or accounting system of record.

## Deterministic Finance Architecture

All finance logic belongs in a new Convex-free `packages/revenue` package. Convex actions fetch and
normalize; the package validates and calculates; skill bodies explain results.

### Money and currency

```ts
type Money = { minor: number; currency: string };
```

`minor` must be a safe integer; `currency` must be a validated uppercase ISO currency code with a
currency-specific decimal exponent used only during string parsing/rendering. Never parse provider
decimal strings with binary floating-point multiplication. Reject non-finite values, excess scale,
unsafe integers, negative values where the domain forbids them, and missing currencies.

Never silently combine currencies. Produce one result per currency or return `mixed_currency`.
Foreign-exchange conversion is out of scope until a named rate source, timestamp, and policy exist.

### Source authority and double-counting

QuickBooks accounting facts and Stripe/PayPal payment-rail facts overlap. Adding QBO revenue to
Stripe/PayPal gross receipts double-counts the same business activity. Every normalized source must
carry a role:

- `accounting_authority` — authoritative booked cash/AR/AP (normally QBO);
- `payment_rail` — settlement and payment-operational detail;
- `user_confirmed_obligation` — e.g. next payroll amount/date;
- `supplemental` — visible but excluded from totals.

Only one authority contributes a given cash movement unless a deterministic reconciliation key
links the records. Without reconciliation, show accounting and rail views separately and say they
cannot be combined.

### Required pure functions

- `parseMoney` / `sumMoney` / `groupByCurrency`;
- `ageReceivables(asOf, invoices)` with current, 1–30, 31–60, 61–90, 90+ and unknown-due buckets;
- `paymentLag(paidInvoices)` with count, median/p90 days-to-pay and days-late, plus insufficient
  sample state;
- `buildCashTimeline(openingCash, actuals, committedInflows, committedOutflows, horizon)`;
- `payrollGap(timeline, confirmedPayrollObligations)` returning earliest gap date, maximum gap, and
  minimum projected balance;
- `classifyCoverage` and `classifyConfidence` from a closed rules table;
- `composeFinanceResult` retaining source refs and excluded-source reasons.

Confidence is a coverage label, not a probability. A suggested closed definition:

- `high`: authoritative opening cash plus complete, uncapped AR/AP and confirmed payroll coverage
  for the whole horizon;
- `medium`: authority present but one non-critical source is missing/stale;
- `low`: material sources are partial/capped or payroll is user-entered without supporting data;
- `unavailable`: no opening cash, mixed currency for the requested aggregate, no confirmed payroll
  obligation, or no usable coverage.

Missing history or a missing source is unknown, never zero. Payroll confidence must not be inferred
from a vague “payroll” expense pattern. It requires a provider-supported obligation or a
user-confirmed next payroll amount/date. All outputs carry coverage dates, as-of time, exclusions,
and “decision support, not accounting/tax advice; review with a qualified professional.”

The LLM receives the final computed structure and may generate explanation only. It may not receive
raw numbers with instructions to total, age, forecast, repair, reconcile, or convert them.

## Revenue Workflow Architecture

### Lead triage and call lists

Join Phase 19 people/follow-ups to bounded HubSpot signals by provider reference. A pure rule ranks
attention using source facts such as overdue follow-up, source-provided next activity, stale contact,
and source-provided deal timing. The LLM may explain the ordered result; it must not invent a deal
stage/value or silently create one locally. Suppressed contacts remain visible only as “do not
contact” and cannot enter an outreach plan.

### Pipeline review

Compose Phase 19's narrow Pipeline summary with source-attributed HubSpot deal projections. Clearly
separate local follow-up state from provider-owned deal fields. If HubSpot is absent, retain the
Phase 19 view and name deal coverage unavailable; do not promote Phase 19 contacts into fictional
opportunities.

### Customer pulse

Use bounded operational signals: open/overdue follow-ups, last contact/activity time, invoice
status, payment lateness, dispute status, and source availability. V1 should exclude arbitrary CRM
notes, support transcripts, custom metadata, and free-text invoice descriptions from the
tool-bearing loop. Any future text ingestion requires the established toolless, schema-validated
summarization pattern.

### Cash flow and payroll confidence

Call provider adapters, normalize, choose source authority, compute in `packages/revenue`, then hand
the immutable result to an explanation-only skill. The output must show separate currencies,
coverage, stale/partial sources, exclusions, and the deterministic confidence label.

### Invoice reminders

An invoice reminder is a draft until the existing plan is approved:

1. User explicitly asks to prepare reminders or selects invoices.
2. Read-only adapter retrieves validated invoice facts by server-held reference.
3. A toolless draft call or deterministic template creates wording. Amount, currency, invoice ref,
   due date, and payment state come only from validated fields.
4. The ordinary email plan is populated with recipient/body/source refs and remains `proposed`.
5. Phase 19 consent/suppression and required footer logic are evaluated at the existing terminal.
6. `executePlan` remains human-only and starts the existing email workflow after approval.

Do not add `invoice_reminder` to `ACTION_TYPES`; do not add a QuickBooks/Stripe/PayPal send endpoint;
do not let a provider-supplied HATEOAS link become a tool; do not auto-send “safe” reminders.

## Untrusted Content and Security Boundary

Treat all provider strings as hostile. The first release should select an allow-list of typed fields
and discard unneeded free text. Provider names/labels that must be displayed are data, not
instructions, and are bounded/escaped. A fenced tool response and a read-only specialist tool set
limit residual prompt-injection impact to analysis quality; they do not create a path to writes.

Security invariants:

- public identity always determines tenant;
- OAuth callback state is one-time and tenant/provider bound;
- credentials are sealed before DB persistence and never reach audit, telemetry, logs, browser,
  thrown errors, fixtures, or model prompts;
- provider account id is verified after token exchange;
- adapter functions expose named GET/report operations, never arbitrary method/path/body;
- URL hosts and path families are compile-time constants; redirects cannot escape the allow-list;
- all reads have timeout, byte, page, row, and date-window caps;
- 401/403 become reauth/forbidden; 429 becomes rate-limited partial/unavailable; 5xx/network errors
  are bounded retriable failures, not infinite loops;
- no raw third-party response is written to audit, telemetry, or dead letters;
- no provider write credential/scope/endpoint is requested “for later.”

## Telemetry and Success Measures

Reuse the Phase 27 workflow measurement plane and add only refs/counts/statuses. Recommended events:

- `connector.read_completed`: provider, projection kind, outcome, item/page/source counts,
  partial/capped flags, freshness bucket, latency, retry count;
- `connector.lifecycle`: provider, outcome (`connected`, `reauth`, `revoked`, `revoke_partial`), no
  scopes/account ids/tokens;
- `revenue.workflow_completed`: workflow id/version, connector-availability bitset, outcome,
  evidence count, partial flag, duration, cost;
- `finance.computed`: result kind, source count, currency count, coverage/confidence enum, has-gap
  boolean, unknown-count — never amounts;
- `invoice_reminder_staged`: plan ref, invoice-ref count, suppressed count, outcome;
- `overdue_item_observed`: hashed/ref id plus state transition when the provider can genuinely
  observe recovery, never customer or amount.

Derive customer-response handling time and follow-up completion from timestamped state transitions.
Do not infer recovery merely because Pikar drafted or sent a reminder. “Observable” means a later
provider read reports paid/closed/completed.

## Suggested File Ownership

Exact names may adapt to landed Phase 19/25/27 code, but ownership should remain narrow:

| Area | Likely owner/files | Notes |
|---|---|---|
| Pure finance/contracts | `packages/revenue/src/*` | One owner; no Convex imports, no model calls. |
| Credential crypto | `packages/revenue` or a small dependency-free security module plus `connectorCredentials.ts` | Share seal/open only; provider lifecycle remains separate. |
| Schema | `packages/backend/convex/schema.ts` | One serialized plan adds all Phase 28 tables/indexes; no later provider wave edits schema. |
| OAuth callbacks | `packages/backend/convex/http.ts` plus provider auth helpers | One serialized owner because `http.ts` is collision-prone. |
| Provider adapters | provider-specific `*Auth.ts` DB helpers and `*.ts` Node actions | Can run in parallel only after shared schema/contracts land. |
| Phase 19 link/read seam | landed contacts/Pipeline public helpers plus a narrow provider-ref adapter | Do not rewrite Phase 19 storage or send guard. |
| Specialist grants/tools | `packages/core/src/specialists.ts`, `packages/backend/convex/llm.ts`/tool module | One serialized plan; read tools only. |
| Skills/candidates | `packages/contracts/src/skill.ts`, skill bodies, seed/candidate fixtures | Reuse Phase 27 manifest/eval conventions. |
| Invoice plan | existing plan-population seam and email plan UI | No `actionType.ts`, external target, or provider terminal changes. |
| Connections UI | landed Phase 25 Connections projection and `ConnectionsPanel` | Replace the truthful encrypted-storage blocker only after the gate is actually closed. |
| Tests/playbooks | matching package/backend/web tests and watched playbooks | Update playbooks in each owned subsystem's plan. |

Highest-collision files (`schema.ts`, `http.ts`, `specialists.ts`, skill registry files, Connections
UI) must each have one serialized plan owner. Provider-specific action/test files are the safe
parallel lanes.

## Plan Topology

Recommended planning waves:

### Wave 0 — admission and dependency evidence

- Confirm Phase 19 ACTN-05/PIPE-01, Phase 25 auth/connection posture, and Phase 27 pack contract.
- Produce four provider suitability records with explicit go/no-go status.
- Record beta-user provider coverage; adjust adapter order only from evidence.
- Stop blocked providers without blocking independent approved providers.

### Wave 1 — pure contracts, encryption, schema

- Add `packages/revenue` contracts, money parser, coverage/confidence rules, and finance functions.
- Add AES-GCM envelope and one-time OAuth state logic/tests.
- Add all Phase 28 schema/indexes in one plan.
- Add client-safe connection status projections and truthful failure states.

### Wave 2 — independent auth adapters

- HubSpot OAuth/connect/refresh/revoke/status.
- QuickBooks OAuth/realm binding/rotation-CAS/revoke/status.
- Stripe OAuth/deauthorize only if Extension/read-only gate passes.
- PayPal partner onboarding/auth/revoke only if partner gate passes.

These plans may parallelize after Wave 1 but must not share `http.ts`; callback registration is a
small serialized integration plan after provider helpers exist.

### Wave 3 — bounded provider reads

- HubSpot CRM projection.
- QuickBooks accounting/report projection.
- Stripe payment-rail projection if cleared.
- PayPal payment-rail projection if cleared.

Each adapter plan owns fixtures, pagination/429/401/partial tests, two-tenant tests, sandbox smoke,
playbook update, and an independent feature flag/exposure decision.

### Wave 4 — deterministic business finance

- Cash timeline, AR aging, payment lag, payroll gap, authority/reconciliation, mixed-currency, and
  confidence tests.
- Thin Convex orchestrator that feeds normalized projections into pure functions.
- Explanation-only candidate and outcome evals.

### Wave 5 — CRM/revenue workflows

- Lead triage and call lists over Phase 19 + HubSpot.
- Pipeline review and customer pulse with honest partial-source semantics.
- Code-owned read-only grants and operation-to-tool matrix.
- Candidate/eval/browser exposure per workflow.

### Wave 6 — invoice reminder containment

- Explicit selection/user-intent seam, toolless drafting, ordinary proposed email plan.
- Suppression/consent/footer coverage across immediate, scheduled, and legacy terminals.
- Static proof that provider writes and direct delivery are unreachable.

### Wave 7 — telemetry and full live gate

- Phase 27 telemetry extensions and bounded read model.
- Controlled live read-only tests for every enabled provider.
- Disconnect/revoke/re-auth, two-tenant, browser, accessibility/responsive, full suites,
  typechecks, build, playbook watcher, and owner UAT.

Do not make the phase all-or-nothing if Stripe or PayPal commercial approval is slow. Requirements
can only be marked complete when their named providers pass, but cleared adapters/workflows can stay
feature-flagged and independently releasable.

## Don't Hand-Roll

- Do not write cryptographic primitives; use Web Crypto AES-GCM.
- Do not implement arbitrary OAuth; each provider gets its documented authorization/revoke flow.
- Do not invent a generic connector or MCP runtime.
- Do not calculate finance inside a prompt or Convex adapter.
- Do not hand-roll exchange-rate conversion.
- Do not build a second contact, opportunity, invoice, or accounting system of record.
- Do not implement webhooks in v1 without a demonstrated freshness need; bounded polling is enough
  for the requested workflows.
- If webhooks are later added, use vendor-supported signature verification and provider event ids;
  do not improvise replay logic from parsed JSON.
- Do not add a new approval/action mechanism for invoice reminders.

## Common Pitfalls

1. **Calling an MCP URL from Convex because it worked in Claude.** Authentication, tenancy,
   commercial rights, and server reachability are unproven.
2. **Treating OAuth as encrypted storage.** Revocability reduces risk but does not encrypt tokens in
   Pikar's database.
3. **Copying `gmailTokens`.** It is internal-only but plaintext and has Google-specific lifecycle.
4. **Concurrent QuickBooks refresh.** Rotating refresh tokens require one-at-a-time CAS/lease.
5. **Assuming a scope is read-only.** QuickBooks Accounting is broad; Stripe read-only is
   Extension-only; PayPal defaults may include refund/payment permissions.
6. **Authorizing on external account id.** It is data, not tenant identity.
7. **Leaking vendor shapes.** HATEOAS write links, metadata, free-text notes, and future fields can
   become accidental capabilities or prompt injection.
8. **Unbounded pagination.** A “list all” call violates rate, latency, cost, and Convex limits.
9. **Turning an interrupted second page into zero.** Preserve valid earlier pages and mark partial.
10. **Double-counting QBO and payment rails.** Booked revenue and Stripe/PayPal receipts often
    describe the same money.
11. **Treating missing history as zero.** Coverage must be visible in every result.
12. **Combining currencies.** Separate or refuse; never silently convert.
13. **Inferring payroll from expense labels.** Require an explicit provider obligation or
    user-confirmed amount/date.
14. **Letting the LLM repair malformed numbers.** Validation failure is unavailable/partial.
15. **Adding provider writes for future convenience.** A hidden refund/send/update export violates
    the phase even if no skill currently calls it.
16. **Marking success after a draft.** Overdue recovery requires a later observed provider state.
17. **Hiding a connector before revoke is tested.** Local deletion is not provider revocation.
18. **One giant live gate.** Provider approval/sandbox/live outcomes must remain independent.

## Code Examples

### Provider endpoint containment

```ts
const HUBSPOT_READS = {
  contacts: "/crm/v3/objects/contacts",
  companies: "/crm/v3/objects/companies",
  deals: "/crm/v3/objects/deals",
  pipelines: "/crm/v3/pipelines/deals",
} as const;

type HubSpotRead = keyof typeof HUBSPOT_READS;

// No method/path/body argument exists. The adapter cannot be steered into a write.
async function hubspotRead(kind: HubSpotRead, query: URLSearchParams): Promise<Response> {
  return fetch(new URL(`${HUBSPOT_READS[kind]}?${query}`, HUBSPOT_API_ORIGIN), {
    method: "GET",
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
}
```

### Confidence from code, not prose

```ts
const CONFIDENCE_RULES = {
  high: (c: Coverage) => c.authoritative && c.completeHorizon && !c.partial && c.payrollConfirmed,
  medium: (c: Coverage) => c.authoritative && c.payrollConfirmed && !c.materialGap,
  low: (c: Coverage) => c.openingCashKnown && c.payrollConfirmed,
} as const;

export function confidence(c: Coverage): Confidence {
  if (CONFIDENCE_RULES.high(c)) return "high";
  if (CONFIDENCE_RULES.medium(c)) return "medium";
  if (CONFIDENCE_RULES.low(c)) return "low";
  return "unavailable";
}
```

## Validation Architecture

Validation must be layered so most failures are caught without provider accounts, while no
connector is exposed without a real read-only proof.

### Layer 1 — pure package tests on every change

`packages/revenue` tests run without Convex or network:

- decimal string to minor-unit parsing for zero/negative/maximum/excess scale;
- safe-integer overflow refusal;
- currency grouping and mixed-currency refusal;
- AR bucket boundaries at exactly 0/1/30/31/60/61/90/91 days;
- sum of known AR buckets equals known outstanding total;
- payment-lag median/p90 determinism and insufficient sample;
- cash timeline ordering, same-day events, missing opening balance, and horizon edges;
- payroll gap never negative; earliest gap and maximum gap invariants;
- authority selection prevents QBO + Stripe/PayPal double count;
- confidence table totality and monotonicity when coverage is removed;
- missing/partial/capped inputs never improve confidence;
- output retains all contributing source refs and names all excluded sources.

Use fixed fixtures plus deterministic generated permutations. Mutation-check the load-bearing
invariants: change a bucket boundary, drop a currency guard, double-count a rail source, convert an
unknown to zero, or let partial data classify high; each mutation must make a named test red.

### Layer 2 — adapter contract tests on every provider change

Use sanitized vendor fixtures and a fake fetch harness:

- strict parsing of the smallest and largest accepted payload;
- unknown fields ignored, required malformed fields rejected;
- pagination success, cap, empty page, repeated cursor, failed second page, and byte cap;
- 401/403/429/5xx/network/timeout discrimination;
- retry-after handling with a bounded retry count;
- no raw payload in thrown errors, audit, telemetry, or dead-letter args;
- exact method/host/path allow-list and zero POST/PATCH/PUT/DELETE data endpoints;
- HATEOAS/write links and arbitrary metadata discarded;
- free-text fields excluded from the tool projection;
- normalized result always carries provider, retrieval time, coverage, partial/capped, and refs.

QuickBooks adds rotating-refresh concurrency tests. Stripe adds API-version/account-header and
deauthorize-mode tests. HubSpot adds optional/missing-scope and token-version tests. PayPal adds
partner/merchant-binding and permission-denied tests.

### Layer 3 — credential and tenant tests on every auth/schema change

With convex-test and two identities:

- tenant A cannot query, refresh, revoke, or use tenant B's connection by connection id or external
  account id;
- state is tenant/provider bound, expires, and is consumed once;
- callback replay makes no token exchange/write;
- seal/open round-trip, random IV difference, AAD tenant/provider swap failure, tamper failure, and
  key-version rotation;
- only ciphertext/IV/keyVersion are persisted; plaintext sentinel scan across serialized DB rows;
- public status contains no token, ciphertext, raw scope, account id, or provider response;
- refresh CAS prevents two successful rotations;
- revoke-before-delete behavior and honest partial-revoke state;
- audit/telemetry/dead letters contain refs/counts/status only.

The two-tenant test must be anti-vacuous: first prove each tenant can read its own distinct sandbox
fixture, then prove the cross-read is unavailable and leaves no cross-tenant ref in logs.

### Layer 4 — reachability and governance tests on every specialist/tool change

Static and runtime assertions prove:

- revenue specialists receive only named read tools and structured refusal;
- no provider adapter exports arbitrary `request`, write method, refund, credit, capture, dispute
  update, CRM update, accounting mutation, or invoice send;
- no specialist can call `executePlan`, `startFanout`, `gmail.send`, or provider write endpoints;
- `ACTION_TYPES`, `armFor`, and `EXTERNAL_TARGETS` remain unchanged for invoice reminders;
- staging a reminder creates a `proposed` email plan and zero request/workflow/send rows;
- double staging/approval remains idempotent under existing plan rules;
- immediate, scheduled, and legacy email terminals all enforce Phase 19 suppression and footer;
- a provider-supplied instruction string cannot change tool selection or stage/send an action.

### Layer 5 — workflow outcome evals before candidate activation

Phase 27-style held-out evals assert state, never prose:

- lead triage orders only source-supported/local follow-up facts;
- no connector returns honest partial/blocked result and named unlock;
- sparse contacts do not become opportunities;
- source-provided stage/value keeps its provider citation;
- mixed currency and missing cash/payroll refuse aggregate confidence;
- an injected CRM field cannot call a write/stage/send tool;
- finance explanation exactly matches the precomputed result values and confidence enum;
- reminder output remains a draft plan until approval;
- suppressed recipient cannot be sent even after approval;
- cross-tenant provider refs retrieve nothing;
- prohibited tool requests are refused.

Candidate activation requires a recorded pass for every workflow version. Rollback changes the skill
version only and never widens grants or connector scopes.

### Layer 6 — live provider read-only gates before exposure

For each provider independently:

1. Connect a provider sandbox/test account through the real callback.
2. Capture server-side request evidence showing only approved auth and GET/report endpoints.
3. Read a known fixture and verify bounded normalized output and coverage.
4. Force pagination, 401/re-auth, 429/rate limit where the sandbox/tooling allows.
5. Disconnect; verify provider-side revocation/deauthorization and local ciphertext deletion.
6. Reconnect and verify state/replay/account binding.
7. Repeat a controlled read with two accounts/tenants and prove isolation.
8. For production, repeat one controlled owner-data read only after terms/review credentials are
   approved. Request no production write scope “for later.”

The live evidence record includes provider, app/environment id ref, scope/capability booleans,
endpoint/method counts, test time, result counts, partial/capped state, revoke result, and evidence
artifact refs. It never includes tokens, names, raw payloads, or amounts.

### Layer 7 — authenticated browser/UAT gate before discovery

At desktop/tablet/mobile verify:

- connecting, checking, reconnecting, partial revoke, disconnecting, and blocked-provider states;
- loading is not rendered as disconnected and missing history is not rendered as zero;
- each workflow names active, missing, stale, partial, and capped sources;
- separate currencies and confidence/coverage explanation are visible;
- invoice reminder review shows exact recipient/body/source facts and nothing has been sent;
- keyboard/focus, error recovery, accessible non-color-only statuses, and responsive layout;
- navigation/discovery remains disabled until the connector and workflow gates pass.

### Requirement-to-gate matrix

| Requirement | Pure | Adapter | Auth/isolation | Reachability | Eval | Live | Browser |
|---|---:|---:|---:|---:|---:|---:|---:|
| REVN-01 HubSpot | — | required | required | required | required | required | required |
| REVN-02 QuickBooks | finance parsers | required | required | required | required | required | required |
| REVN-03 Stripe/PayPal | finance parsers | required each | required each | required each | required | required each | required |
| REVN-04 CRM workflows | ranking rules | projection contracts | two-tenant links | required | required | HubSpot read | required |
| REVN-05 finance | required | normalized fixtures | tenant source refs | no LLM arithmetic | required | controlled facts | required |
| REVN-06 reminders | template/selection | invoice reads | recipient isolation | required | required | read + existing send gate | required |

### Final phase gate

Run focused suites first, then full package tests, backend/web typechecks, production build,
playbook watcher, authenticated E2E, and owner UAT. A provider with unresolved terms, production
credentials, revocation, read-only scope, or live isolation remains blocked and undiscoverable even
if its unit tests are green. Do not weaken REVN-01..03 checkboxes to “adapter code exists.”

## Research Confidence

- **High:** repository tenant/action/skill/OAuth patterns; Phase 19/25/27 dependencies; need for
  encrypted credentials; pure-TypeScript finance and approval containment architecture.
- **High:** QuickBooks rotation/rate/report constraints; Stripe Extension-only read-only constraint;
  PayPal third-party Transaction Search partner requirement; HubSpot OAuth/read-scope/revoke facts,
  based on current official vendor documentation.
- **Medium:** exact production/commercial eligibility for Pikar under HubSpot AI-connector,
  Stripe Extension, Intuit production, and PayPal partner programs. These require vendor/account
  decisions and must remain explicit manual gates.
- **Medium:** final file names and Phase 19/25/27 integration signatures because those phases are
  pending. Plans must re-read the landed implementations before locking tasks.

## Planning Recommendation

Plan Phase 28 as independent gated lanes over one shared security/finance foundation. Do not write
four adapters in one plan and do not postpone provider eligibility to UAT. The critical path is:

`Phase 19 + Phase 25 + Phase 27 complete` → `provider decisions` → `encrypted credentials + pure
contracts` → `cleared adapter reads` → `deterministic workflows` → `invoice draft containment` →
`independent live/eval/browser exposure`.

This yields the intended product: one Pikar chief-of-staff with richer evidence, not four new
capability doors.

