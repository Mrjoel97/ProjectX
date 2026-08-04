# Phase 26: Connected Product Pages - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning
**Source:** PRD Express Path (`docs/superpowers/plans/2026-08-04-pending-pages-vault-integration-plan.md`) plus owner-approved sequence

<domain>
## Phase Boundary

Replace the remaining placeholders in `docs/design/mockups/pending-pages.html` with real connected
routes in this locked order:

1. Shared backend contracts
2. Approvals
3. Finance
4. Content
5. Reports
6. Pipeline alongside Phase 19
7. Command Center v2

The Knowledge Vault redesign is already complete under Phase 15.4 and is a visual/verification
baseline, not Phase 26 implementation scope. Phase 26 is pulled before Phase 25; only real
plan-specific dependencies may block an individual wave.

</domain>

<decisions>
## Implementation Decisions

### Connection before presentation
- No visual control or live navigation entry ships until its data source, authorization boundary,
  mutation semantics, failure state, audit event and production verification path are named and tested.
- Every list is cursor-paginated or bounded by both time and rows. Counts are maintained or honestly
  capped/partial; no hot-path `.collect().length` and no mega-query feeding an entire page.
- Query errors never become zero. Every page distinguishes loading, empty, capped/partial, retryable
  error, mutation busy/idempotent, governed refusal and external reauthorization where applicable.

### Authorization and content safety
- New public reads/writes use the repository's tenant wrappers; deployment-global facts and controls
  use `requireOwner`. Hiding a control is presentation, never the trust boundary.
- Signed storage URLs are minted only after ownership checks and are never stored in audit or logs.
- Browser audit views receive a server-sanitized projection; raw `audit.payload` never reaches React.
- State-changing dashboard mutations are state-guarded, idempotent and write refs/counts-only audit.

### Time and money
- Persist instants as epoch milliseconds, filter with half-open windows and format with a named IANA
  timezone. Browser timezone is the documented initial fallback until the profile owns one.
- Costs are USD. Estimated, reserved, actual, refunded and unlanded remain distinct.
- Finance starts an append-only coverage window; pre-ledger history is unknown, never fabricated zero.

### Surface-specific locked defaults
- Approvals calendar time revision returns to the originating cockpit in the first release; no inline
  editor until availability recheck and CAS semantics exist.
- Content reuse opens/prefills the cockpit; it does not silently duplicate, attach or send content.
- Phase 19 remains the narrow contacts/follow-up/consent/suppression substrate. Pipeline does not add
  opportunities, stages or monetary pipeline values in this phase.
- Non-owner tenants may see generic health. WORM, active-skill, deployment-budget and kill-switch
  facts remain owner-only.
- Command Center v2 lands last and composes page summaries rather than rereading raw tables.

### Navigation and rollout
- Route/nav activation is page-specific and follows its connected automated and authenticated browser
  gates. Pages may ship independently; one incomplete page does not force fake data into another.
- Additive schema/index changes precede readers. Optional fields stay backward-compatible; backfills
  are resumable/bounded where needed. No destructive narrowing or invented historical rewrite.

### Claude's Discretion
- Exact plan count, wave granularity, component split, projection names and whether compatible schema
  foundations can be shared across adjacent plans.
- Visual implementation details within the approved mockup and existing scoped product tokens.

</decisions>

<specifics>
## Specific Ideas

- Treat `docs/superpowers/plans/2026-08-04-pending-pages-vault-integration-plan.md` as the dependency,
  cost, blast-radius and source-of-truth map.
- Prefer separate stable summary subscriptions and paginated ledgers over one cross-page query.
- Pair Pipeline planning with Phase 19 file ownership and tests so the person/consent store is built once.
- Reuse the Phase 15.4 discipline: executed browser coverage, watched playbooks, honest external/live
  boundaries and explicit rollback before owner UAT.

</specifics>

<deferred>
## Deferred Ideas

- Exact Vault category counters remain deferred; Phase 15.4 intentionally omitted fabricated counts.
- Inline Approvals calendar editing is deferred until a safe availability/CAS mutation is justified.
- Full opportunities/deal-stage/value CRM is deferred beyond Phase 19's narrow first release.
- Any new Drive write scope, vendor, billing system or alternate dashboard data plane is out of scope.

</deferred>

---

*Phase: 26-connected-product-pages*
*Context gathered: 2026-08-05 via PRD Express Path*
