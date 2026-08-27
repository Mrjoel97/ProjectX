# Playbook: HubSpot connector (REVN-01)

> Last verified: 2026-08-27 against 4295bcc
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-05, 28-22) · Related ADRs: none yet

> **Status: REGISTERED AHEAD OF IMPLEMENTATION.** No HubSpot code exists at the `Last verified` sha.
> Everything marked **[PLANNED]** is a contract a later plan must satisfy, not a claim of landed
> behaviour. Shared credential, OAuth-state, fetch, telemetry and release rules live in
> `revenue-connectors.md` and are not repeated here.

## Purpose

Read-only access to a tenant's own HubSpot CRM so revenue workflows can do lead triage, call lists
and pipeline review over real deal data. HubSpot is the *only* Phase 28 provider that touches people,
which makes its single hardest rule structural: **it must not become a second CRM.**

## Key files

**[PLANNED]**

- `packages/revenue/src/providers/hubspot.ts` (+ `.test.ts`) — pure normalization of contact, company,
  deal, owner and pipeline pages into bounded projections. No Convex imports.
- `packages/backend/convex/hubspotAuth.ts` — authorize URL, callback, refresh, revoke.
- `packages/backend/convex/hubspot.ts` (+ `.test.ts`) — Node actions performing bounded reads.
- `scripts/smoke-hubspot-read.mjs` — controlled live read + revoke evidence for the lane gate.
- `docs/connectors/hubspot-suitability.md` — the suitability record (28-01 drafts, 28-22 decides).

## Dependencies & blast radius

`graphify query "hubspot connector"`. Beyond that:

- `convex/contacts.ts` (Phase 19, owned by `contacts-crm.md`) — the ONLY person/consent/suppression
  store. HubSpot attaches provider refs to it.
- Shared envelope + `connectorFetch` + `providerGates` — see `revenue-connectors.md`.
- HubSpot public-app credentials and redirect URI in Convex environment configuration.

## Admission blocker — read this before writing code

**HubSpot Marketplace listing rules classify some products as an "AI connector" and require those to
use HubSpot's MCP Server.** Pikar must determine *with HubSpot* whether this product is classified
that way and whether private/public direct OAuth distribution is permitted for the intended beta.

- This does **not** authorize adding a generic MCP client.
- If the classification forces a provider-specific MCP path, that is a separate architecture and
  terms decision requiring its own plan — never an implicit fallback inside this lane.
- Until answered, the lane is `parked`. See `revenue-connectors.md` → Release semantics.

## Data flow

1. Authorize via HubSpot's **versioned** OAuth API (pin the version; do not copy a legacy `/oauth/v1`
   example) with the exact read scopes the operation matrix demonstrates.
2. Callback consumes the one-time state, exchanges server-side, verifies the returned portal/account
   belongs to the intended connection, seals the credential.
3. Reads poll bounded contact/company/deal pages on demand. Batch endpoints where useful; CRM Search
   is bounded **separately** because it has its own cost profile.
4. Adapter emits a bounded projection with provider, coverage window, retrieval time and
   partial/capped state. Raw payloads stop here.
5. Refresh: the OAuth app owns TTL and refresh behaviour. Rate limits apply **per installed account**.

## Invariants — what must never break

1. **No second CRM.** HubSpot may attach provider refs to Phase 19 contacts. It must not create
   another person store, nor a local opportunity/stage/deal-value table. *Enforced by:* [PLANNED]
   integration tests against the landed Phase 19 API (28-10/28-21).
2. **Read scopes only.** The requested scope set contains no `.write`, import, export, marketing-send,
   workflow or sensitive-data scope. *Enforced by:* [PLANNED] scope-constant test + 28-26 reachability.
3. **Current revoke endpoint only.** Use the versioned token-revoke endpoint. The legacy
   refresh-token delete did **not** invalidate existing access tokens or uninstall the app — using it
   would make "disconnect" a lie. *Enforced by:* [PLANNED] endpoint allow-list test.
4. **Pinned API version.** No unversioned or legacy path. *Enforced by:* [PLANNED] allow-list test.
5. **429 is partial, not zero.** A throttled page yields `partial` coverage; downstream reports
   unknown, never a fabricated count.
6. Plus every invariant in `revenue-connectors.md`.

## How to change safely

- New endpoint → add to the compile-time allow-list *and* to the suitability record's operation
  matrix. An endpoint not in both is not reachable.
- New scope → re-open the suitability decision. Scopes are not a code detail.
- Webhooks are deferred. If later justified: verify signatures, dedupe event ids, tolerate retries and
  out-of-order delivery, and reconcile against periodic reads.

## How to verify

| Command | Proves | Needs |
|---|---|---|
| `cd packages/revenue && pnpm vitest run src/providers/hubspot` [PLANNED] | Pagination, 429, 401 and projection shape against fixtures. | offline |
| backend `pnpm test hubspot` [PLANNED] | Two-tenant isolation, refresh, revoke ordering. | offline |
| `node scripts/smoke-hubspot-read.mjs` [PLANNED] | Controlled live read + revoke. Lane evidence. | live creds |
| `node scripts/check-provider-lane.mjs hubspot` [PLANNED] | `passed` or `parked`. | offline |

## Operational notes

- Rate limiting is per installed account for OAuth-distributed apps — one noisy tenant cannot starve
  another, but one tenant can starve itself. Bound pages.
- Sandbox/test portal fidelity is recorded in the suitability record, not assumed.

## Known gaps & deferred work

- The Marketplace/AI-connector classification question above is unanswered. It is the single reason
  this lane cannot start.
- Everything [PLANNED] is unbuilt. Invariants 1-4 have no enforcement yet.
- Webhooks, and any write scope, are out of phase scope.
