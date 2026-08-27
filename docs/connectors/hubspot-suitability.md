# HubSpot — provider suitability record

> **Decision recorded: `approved_production` — 2026-08-27, evidence-consistent.** The one
> machine-readable marker below is the authority; the prose is the evidence it was decided
> against. Register and vocabulary: [`README.md`](./README.md).

<!-- phase28-provider-decision
provider: hubspot
decision: approved_production
decided_on: 2026-08-27
evidence_first: 2026-08-05
evidence_reverified: 2026-08-27
review_by: 2026-11-27
-->

| | |
|---|---|
| **Provider** | HubSpot CRM API / OAuth apps, developer platform `2026.03` |
| **Decision** | **`approved_production`** — owner judgment, 2026-08-27 (plan 28-01 Task 2), evidence-consistent. Expires `review_by: 2026-11-27`. |
| **Blocker status** | **CHANGED** — narrower than the 2026-08-05 record |
| **Evidence first gathered** | 2026-08-05 (`28-RESEARCH.md` lines 172-290) |
| **Evidence re-verified** | 2026-08-27, independent primary-source pass |
| **Re-review by** | 2026-11-27 (90-day evidence life) |
| **Downstream lane** | plan **28-05** (adapter), wave-7 seal **28-22** |

---

## Owner decision — `approved_production`, 2026-08-27

**Basis: the evidence.** HubSpot is the only one of the four whose approval is straightforwardly
consistent with the record below. Nothing in it rests on a claim this repository cannot see.

The owner's judgment, as given:

- **Accepts the unlisted install cap** — 25 installs for marketplace-distribution apps until a
  listing is approved; 10 customers for private distribution as an app partner; 100 for a Solution
  Partner.
- **Defers a Marketplace listing.** This is the operative half. Not listing is what keeps the
  AI-connector/MCP rebuild rule from ever being triggered, because the Ecosystem Quality
  classification only happens at listing review.

**Authorizes:** plan **28-05** (adapter) to be built, and production discovery/exposure for HubSpot,
subject to the open condition below and to the wave-7 seal **28-22**.

**Does not authorize:** a Marketplace listing, a generic MCP client, or any write scope. Pursuing a
listing is a *new* decision and re-triggers this record.

### Open condition — carried, NOT resolved by this approval

**Does `POST /oauth/2026-03/token/revoke` invalidate already-issued ACCESS tokens?** Still
**UNPROVEN**. The documentation is silent, and the legacy `DELETE /v1/refresh-tokens/{token}` it
replaced explicitly did *not* cascade. 28-CONTEXT makes per-tenant revocation a hard requirement, so
this is load-bearing — and it is now a **lane deliverable**:

- **28-05 must TEST it** against a live grant — revoke, then attempt a read with the still-unexpired
  access token — and record the observed result in this file.
- **28-22 must NOT seal the HubSpot lane without that result.** If revocation does not cascade,
  disconnect additionally depends on access-token TTL expiry, and that window must be stated honestly
  in the UI.

Also unchanged by this approval: data-processing / commercial terms, retention & deletion duties and
data residency / subprocessors are all still **not researched** (see the checklist). The owner
approved production without them on record.

### Scope of this approval

- It is **HubSpot's alone.** There is no all-provider approval flag; the other three records carry
  their own independent markers, and three of the four rest on different bases.
- It **expires with the evidence** — `review_by: 2026-11-27`, or earlier on any re-review trigger.
- It was issued **directly as `approved_production`**; no `approved_beta` marker was ever recorded
  for HubSpot. The production marker carries beta engineering authority — the beta stage was
  *skipped*, not passed.
- **A partial release is not Phase 28.** HubSpot shipping does not complete REVN-01, REVN-02 or
  REVN-03, and does not complete Phase 28. Those close only when every provider they name carries a
  current production-suitability decision **and** a lane gate marked `passed`.

---

## The owner question

> **Is Pikar registered in HubSpot's App Partner / Solution Partner program with a developer account
> today — and if so, do we intend to pursue a Marketplace listing (which triggers Ecosystem Quality
> classification and the MCP rule), or ship unlisted OAuth under the 25-install / 10-customer cap?**

No HubSpot documentation can answer this. It is a fact about Pikar's account and Pikar's commercial
intent, and it is the fact the decision turns on.

## What the evidence supports

A direct read-only OAuth integration against HubSpot CRM is **buildable today without HubSpot's
permission**, at the cost of an install cap and no Marketplace listing. The AI-connector/MCP rule is
a **listing** requirement, and the classification risk only bites **if Pikar lists**.

---

## The blocker — restated correctly

The 2026-08-05 record read this as "HubSpot may forbid direct OAuth distribution for an AI
connector." **That is wrong.** The rule exists verbatim but is narrower and differently shaped.

HubSpot's App Marketplace listing requirements state verbatim:

> "if your app is an AI connector - an app that primarily connects HubSpot to external generative AI
> tools - it must require user-level permissions and be built with HubSpot's MCP Server"

The December 2025 developer rollup scopes the class:

> "AI connectors are defined as apps that primarily connect HubSpot directly to general-purpose
> generative AI assistants or agents"

— i.e. ChatGPT/Claude-class assistants. And in the same rollup, HubSpot says apps unwilling to
rebuild on MCP:

> "can continue to distribute their app and drive installs outside the Marketplace"

subject to new active install limits for unlisted apps.

**So the real cost of not being on MCP is a cap and no listing, not a ban.** The residual risk is a
classification judgement made by HubSpot Ecosystem Quality **at review time** — there is no
documented test for whether a vertical SaaS that reads CRM to generate a revenue pack falls in the
class. That judgement never happens if Pikar does not list.

This does **not** authorize a generic MCP client. If a listing is ever pursued and the
classification lands, rebuilding on HubSpot's MCP Server is a separate architecture and terms
decision, not an implicit fallback.

### Install caps (the actual cost of staying unlisted)

Changelog 2025-09-22, applying to platform 2025.2+:

- marketplace-distribution apps are "capped at 25 installs until they receive approval for the
  Marketplace listing";
- private distribution: "10 customers for app partners" and "100 customers for Solution Partners".

---

## Verified from primary vendor documentation (2026-08-27)

| Item | Finding |
|---|---|
| **Direct OAuth distribution permitted?** | **Yes.** OAuth is in fact *mandatory* for listed apps ("your app must use OAuth as its sole authorization method"). Unlisted is an explicitly supported path: `app-hsmeta.json` `distribution` is `"marketplace"` or `"private"`, with `auth.type` `"oauth"`. |
| **Current token endpoint** | Date-based versioning: `POST /oauth/2026-03/token`. Authorization URL `https://app.hubspot.com/oauth/authorize` (or `.../oauth/{accountId}/authorize`). |
| **Legacy sunset** | `/oauth/v1` is deprecated with sunset **2027-02-16**. Both `v3` and `2026-03` appear live. |
| **Revoke endpoint** | `POST /oauth/2026-03/token/revoke`, body `client_id`, `client_secret`, `token`, `token_type_hint` — RFC 7009-shaped. Deprecation mapping is explicit: `DELETE /v1/refresh-tokens/{token}` → `POST /oauth/2026-03/token/revoke`. |
| **Legacy revoke was non-cascading** | The legacy guide says verbatim: "This will only delete the refresh token. Access tokens generated with the refresh token will not be deleted." |
| **CRM read scopes** | `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`, `crm.objects.owners.read`. |
| **Read-only expressible?** | **Yes.** Read and write are independent scope strings; nothing states a read scope drags in a write scope. `app-hsmeta.json` distinguishes `requiredScopes` / `conditionallyRequiredScopes` / `optionalScopes`, so a read-only install is expressible. |
| **Rate limits (OAuth + marketplace distribution, 2025.2 / 2026.03)** | "each HubSpot account that installs your app is limited to 110 requests every 10 seconds", and this limit "excludes the CRM Search API". Private distribution is tiered per installing account: Free/Starter 100/app per 10s + 250,000/account daily; Professional 190/app + 625,000; Enterprise 190/app + 1,000,000; API Limit Increase add-on 250/app + 1,000,000 on top of base. Burst is per app; the daily cap "is shared across all apps within the same HubSpot account". |
| **Platform-version floor (new since Aug 5)** | From **2026-11-02**, listed/certified apps must be on developer platform v2025.2 or v2026.03; legacy and Projects 2023.2/2025.1 apps "will be rejected for new listings" (changelog 2026-05-07). |
| **Account binding** | Per installed HubSpot account (portal). Rate limits and install caps are both counted per installing account. |
| **MCP server capability** | HubSpot notes "Only CRM read operations are currently available" via its MCP server. |

### SCOPE TRAP — there is no `crm.pipelines.deals.read`

The only scope strings containing "pipelines" are **`crm.pipelines.orders.read` /
`crm.pipelines.orders.write`** — those are **ORDER** pipelines, not deal pipelines.

Reading **deal** pipelines/stages goes through **`crm.objects.deals.read` + `crm.schemas.deals.read`**.
Do not put `crm.pipelines.*` in an install URL expecting deal pipelines. The 2026-08-05 research
said "the exact read scopes for contacts, companies, deals, owners, and pipelines" — that last one
does not exist as written.

### DOC HAZARD — HubSpot contradicts itself on the token endpoint

The build-apps guide `working-with-oauth` still tells you to "make an API request to
`/oauth/v3/token`" and links refresh instructions into the **legacy** section, while the API
reference and the deprecation changelog present `/oauth/2026-03/token` as current. **That guide page
is stale relative to the reference.** Pin from the reference, not the guide.

---

## Could NOT verify — do not treat as fact

| Item | Status |
|---|---|
| **Does `POST /oauth/2026-03/token/revoke` invalidate already-issued ACCESS tokens?** | **UNPROVEN — MUST TEST.** No primary page states it. The reference only says it "Deletes/Revokes provided Refresh Token". The presence of `token_type_hint` implies an access token could be passed, but that is *inference, not documentation* — and the legacy `DELETE` explicitly did **not** cascade. **28-CONTEXT requires per-tenant revocation**, so this is load-bearing: if it does not cascade, disconnect must additionally rely on access-token TTL expiry and that window must be stated honestly in the UI. |
| **CRM Search API per-account limits** | Documented separately as "limits that are unique from or stricter than the general limits" — not read this pass. Bound CRM Search separately regardless. |
| **AI-connector classification of Pikar specifically** | Unknowable from docs. It is a HubSpot Ecosystem Quality judgement made at listing review. |
| **Data-processing / commercial terms, retention & deletion duties, data residency / subprocessor implications** | **NOT RESEARCHED** in either pass. Required before `approved_production`; not required for a sandbox `approved_beta`. |
| **Token lifetimes (access/refresh TTL)** | Not captured this pass. The Aug-5 record notes only that OAuth apps are responsible for TTL and refresh behaviour. Read before building refresh. |

---

## Shared checklist

| Requirement | Status | Note |
|---|---|---|
| Stable/versioned endpoints + deprecation policy | verified | Date-based `2026-03`; v1 sunsets 2027-02-16; pin from the reference, not the stale guide |
| OAuth grant type | verified | Authorization code, public app; OAuth mandatory for listed apps |
| Refresh behaviour / rotation | unverified | Not captured this pass |
| Revoke | **partly verified** | Endpoint verified; **cascade to access tokens UNPROVEN** |
| Exact read scopes | verified | Plus the `crm.pipelines.*` trap above |
| Provider enforces read-only? | verified | Yes — independent read/write scope strings |
| External account binding / multi-account | verified | Per installing HubSpot account |
| Rate / concurrency / pagination | verified | 110 req/10s per installed account (OAuth+marketplace); CRM Search excluded and separately limited |
| Webhook signing / replay / ordering | not researched | v1 polls bounded pages on demand; webhooks deferred |
| Sandbox / test-account fidelity | not researched | HubSpot developer test accounts exist; fidelity not assessed |
| Production review / marketplace / lead time | verified | Only required to **list**; unlisted needs no HubSpot approval |
| Data-processing / commercial terms | **not researched** | Gate for `approved_production` |
| Retention / deletion duties | **not researched** | Gate for `approved_production` |
| Data residency / subprocessors | **not researched** | Gate for `approved_production` |
| Live test account + disconnect/re-auth path | not established | Blocked on the revoke-cascade test above |

---

## Evidence URLs

- https://developers.hubspot.com/docs/apps/developer-platform/list-apps/listing-your-app/app-marketplace-listing-requirements
- https://developers.hubspot.com/changelog/november-2025-developer-rollup
- https://developers.hubspot.com/changelog/new-marketplace-distribution-app-install-limits
- https://developers.hubspot.com/docs/apps/developer-platform/build-apps/app-configuration
- https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/overview
- https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth *(stale — see doc hazard)*
- https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes
- https://developers.hubspot.com/docs/api-reference/latest/authentication/oauth-tokens/revoke-token
- https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/v1/guide
- https://developers.hubspot.com/changelog/v1-oauth-api-deprecation
- https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide
- https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines
- https://developers.hubspot.com/changelog/app-listing-and-app-certification-requirement-updates-for-may-2026
- https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server

## Re-review triggers

Standard triggers in [`README.md`](./README.md), plus provider-specific:

- Pikar submits or withdraws a Marketplace listing (triggers Ecosystem Quality classification).
- HubSpot restates, widens or narrows the "AI connector" definition. *(Nothing in the July or August
  2026 rollups relaxes or restates it.)*
- The `2026-03` OAuth surface is superseded, or the v1 sunset date (2027-02-16) moves.
- The install caps change.
- Approaching **2026-11-02**, the platform-version floor for listed/certified apps.

---

*No token, portal id, client id or client secret appears in this document, by policy.*
