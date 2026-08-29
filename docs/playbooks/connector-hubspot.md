# Playbook: HubSpot connector (REVN-01)

> Last verified: 2026-08-28 against 28-05 (the read-only rail: auth lifecycle, bounded CRM reads,
> the revocation-cascade probe and the lane smoke)
> Build history: `.planning/phases/28-connector-backed-revenue-pack/` (28-05, 28-22) · Related ADRs: none yet

> **Status: BUILT, LANE NOT PASSED.** The adapter, the parsers, the auth lifecycle and the smoke
> exist and are offline-tested at the `Last verified` sha. **Nothing has ever spoken to HubSpot.**
> `node scripts/check-provider-lane.mjs --provider hubspot` reads `consistent`, which is NOT
> `passed`: no live read, no live revoke, and the open condition below is still open. The
> **[PENDING LIVE]** marks below are exactly that distinction. Shared credential, OAuth-state,
> fetch, token-POST, telemetry and release rules live in `revenue-connectors.md` and are not
> repeated here.

## Purpose

Read-only access to a tenant's own HubSpot CRM so revenue workflows can do lead triage, call lists
and pipeline review over real deal data. HubSpot is the *only* Phase 28 provider that touches people,
which makes its single hardest rule structural: **it must not become a second CRM.**

## Key files

- `packages/revenue/src/providers/hubspot.ts` (+ `.test.ts`) — the pure half: scope strings, the
  date-versioned OAuth endpoints, the GET path and property allow-lists, and total parsers from raw
  contact/company/deal/owner/pipeline pages into bounded projections. No Convex imports.
- `packages/backend/convex/hubspotAuth.ts` — connect URL, callback completion, access-token refresh,
  revoke, and `probeRevocationCascade` (the open condition's live test).
- `packages/backend/convex/hubspot.ts` (+ `hubspot.test.ts`) — five bounded read actions over
  `connectorFetch.readPages`, plus the sanitized evidence projection the smoke records.
- `scripts/smoke-hubspot-read.mjs` — the lane evidence producer: `--self-test` (offline, 20 guard
  cases), `--verify-evidence` (offline validation) and a live read / `--revoke` probe.
- `docs/connectors/hubspot-suitability.md` — the suitability record and the open condition.

**No OAuth callback ROUTE exists yet, and no connections UI.** `completeHubSpotConnect` is an
`internalAction` waiting for 28-09's surface to call it; until then a consent is completed by
driving that action directly. That is deliberate — the route and the UI are 28-09's, not this
lane's.

## Dependencies & blast radius

`graphify query "hubspot connector"`. Beyond that:

- `convex/contacts.ts` (Phase 19, owned by `contacts-crm.md`) — the ONLY person/consent/suppression
  store. HubSpot attaches provider refs to it.
- Shared envelope + `connectorFetch` + `providerGates` — see `revenue-connectors.md`.
- HubSpot public-app credentials and redirect URI in Convex environment configuration.

## Admission blocker — SETTLED 2026-08-27

> **`approved_production`, on the evidence.** Owner judgment recorded in
> [`docs/connectors/hubspot-suitability.md`](../connectors/hubspot-suitability.md); that marker block
> is the authority, not this paragraph. The lane is **unparked**. The install cap (25 marketplace-
> distribution / 10 private / 100 Solution Partner) is **accepted** and a Marketplace listing is
> **deferred** — which is precisely what keeps the rule below from ever being triggered. Expires
> `review_by: 2026-11-27`.
>
> **STILL OPEN — a 28-05 deliverable, not a settled point:** whether
> `POST /oauth/2026-03/token/revoke` invalidates already-issued **access** tokens is **UNPROVEN**
> (docs silent; the legacy `DELETE` explicitly did not cascade). **28-05 must test it against a live
> grant; 28-22 must not seal this lane without the result.**

Why the listing stays deferred:

**HubSpot Marketplace listing rules classify some products as an "AI connector" and require those to
use HubSpot's MCP Server.** Pikar must determine *with HubSpot* whether this product is classified
that way and whether private/public direct OAuth distribution is permitted for the intended beta.

- This does **not** authorize adding a generic MCP client.
- If the classification forces a provider-specific MCP path, that is a separate architecture and
  terms decision requiring its own plan — never an implicit fallback inside this lane.
- Pursuing a listing is a **new decision**: it re-triggers the suitability record and submits Pikar
  to Ecosystem Quality classification at review time. See `revenue-connectors.md` → Release semantics.

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

1. **No second CRM, enforced at the REQUEST rather than at the parse.** The rail never asks HubSpot
   for a name, an email, a phone or a deal title: `HUBSPOT_CONTACT_PROPERTIES`,
   `HUBSPOT_COMPANY_PROPERTIES` and `HUBSPOT_DEAL_PROPERTIES` are compile-time allow-lists of
   timestamps, stage keys, an owner id and money fields. There is no free text in the response to
   drop. Phase 19's contacts substrate stays the only person store and HubSpot attaches refs to it;
   there is no local opportunity/stage/deal-value table. *Enforced by:* property allow-list tests in
   both packages, plus projection tests asserting a vendor sentinel never appears.
2. **Read scopes only.** Exactly `crm.objects.contacts.read`, `crm.objects.companies.read`,
   `crm.objects.deals.read`, `crm.objects.owners.read`, `crm.schemas.deals.read` — no `.write`,
   import, export, marketing-send, workflow or sensitive-data scope, and **no `crm.pipelines.*`**
   (that family is ORDER pipelines; deal pipelines come from the deals + deal-schemas pair).
   *Enforced by:* a whole-array literal comparison in `providers/hubspot.test.ts`, so a RENAME
   breaks it and not only a deletion.
3. **Current revoke endpoint only.** `POST /oauth/2026-03/token/revoke`. The legacy
   `DELETE /oauth/v1/refresh-tokens/{token}` did **not** invalidate existing access tokens — using it
   would make "disconnect" a lie. *Enforced by:* literal endpoint tests plus a backend assertion
   that no call ever reaches a `refresh-tokens` URL.
4. **Pinned API version.** `2026-03` for OAuth, `v3` for CRM; no unversioned or legacy path, and no
   single-object, search or batch path. *Enforced by:* `PROVIDER_READ_PATHS` parity and
   `isAllowedRead` rejection tests.
5. **429 is partial, not zero.** A throttled page yields `partial` coverage carrying what WAS read;
   downstream reports unknown, never a fabricated count. A cap can never produce `ready`.
   *Enforced by:* the page-two-429 and page-cap tests.
6. **A revoke never claims more than it proved.** HubSpot's cascade to already-issued access tokens
   is unproven, so a 2xx revoke records `confirmed` **with** `residualAccessUntil` set to the access
   token's own expiry. A disconnect that reported a clean kill would be the product asserting
   something nobody observed. *Enforced by:* `classifyRevokeOutcome` (`PROVIDER_REVOKE_SUPPORT` pins
   hubspot to `unproven`) and the disconnect tests.
7. Plus every invariant in `revenue-connectors.md`.

## How to change safely

- New endpoint → add to the compile-time allow-list *and* to the suitability record's operation
  matrix. An endpoint not in both is not reachable.
- New scope → re-open the suitability decision. Scopes are not a code detail.
- Webhooks are deferred. If later justified: verify signatures, dedupe event ids, tolerate retries and
  out-of-order delivery, and reconcile against periodic reads.

## How to verify

| Command | Proves | Needs |
|---|---|---|
| `cd packages/revenue && npx vitest run src/providers/hubspot` | Scope/endpoint literals, parsing, money figures, projection shape. 30 tests. | offline |
| `cd packages/backend && npx vitest run convex/hubspot.test.ts` | Two-tenant isolation, replay, refresh, revoke, the cascade probe, the read-only source scan. 47 tests. | offline |
| `cd packages/backend && npx tsc --noEmit` | The suite is not a typecheck. Run it separately, always. | offline |
| `node scripts/smoke-hubspot-read.mjs --self-test` | The evidence validator refuses 19 kinds of bad evidence. | offline |
| `node scripts/smoke-hubspot-read.mjs --tenant <id> [--revoke]` **[PENDING LIVE]** | Controlled live read, and the revoke-cascade observation. | live creds + a disposable portal |
| `node scripts/check-provider-lane.mjs --provider hubspot` | `consistent` today. `passed` is 28-22's. | offline |

## Operational notes

- Rate limiting is per installed account for OAuth-distributed apps — one noisy tenant cannot starve
  another, but one tenant can starve itself. Bound pages.
- Sandbox/test portal fidelity is recorded in the suitability record, not assumed.

## Known gaps & deferred work

- **THE LANE HAS NEVER RUN LIVE.** Every test is offline against a stubbed provider. `consistent` is
  not `passed`, and 28-22 owns the seal.
- **The open condition is untouched.** `revoke-cascades-to-access-tokens` is still unresolved:
  `probeRevocationCascade` and the smoke exist to answer it and have not been pointed at a real
  grant. Until they are, disconnect must be described to the user as "we revoked the grant and
  deleted our copy; access may survive until `residualAccessUntil`".
- **No callback route, no connections UI** — 28-09.
- **Nothing consumes the projections yet.** Attaching HubSpot refs to Phase 19 contacts is
  28-10/28-21; this lane only produces the refs.
- **`hub_id` binding is opportunistic.** No primary page read in the suitability pass promises
  `hub_id` on the `2026-03` token response. When it is absent no external-account hash is recorded
  and the re-consent binding check does not run — unknown never satisfies it. If a live run shows
  `hub_id` is always present, record that in the suitability record and make the check mandatory.
- **The granted scope is recorded as REQUESTED, not as confirmed.** HubSpot's token response does
  not restate the grant. A live run should verify the install actually carries all five.
- **CRM Search is deliberately not on the allow-list.** HubSpot's 110 req/10 s per-installed-account
  limit excludes it and it has its own stricter limits, so it needs its own budget and its own
  decision.
- The Marketplace/AI-connector classification question above stays unanswered, and stays that way
  as long as the listing is deferred.
- Webhooks, and any write scope, are out of phase scope.
