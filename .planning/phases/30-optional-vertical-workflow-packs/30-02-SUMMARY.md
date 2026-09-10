---
phase: 30-optional-vertical-workflow-packs
plan: 02
status: partial
requirements: [VERT-01, VERT-02]
date: 2026-09-10
---

# 30-02 — Native vertical controls and evidence-aware discovery

Implemented tenant-scoped explicit intent/reviewer preferences, independent disable, same-tenant
owner rollback, and bounded closed telemetry. `skills` and `tenantSkills` remain the only version,
candidate, activation and rollback state. No release-proof flags, parallel registry or new ledger
were created.

`loadEffectiveSkill` checks the tenant's disabled vertical before either overlay or global fallback.
Rollback uses the existing sole activation transition and requires an exact same-tenant/name row
with native prior-active eligibility. Rollback never re-enables a disabled vertical. Existing Vault
artifacts remain readable. Ordinary users cannot invoke the evidence-exempt owner rollback.

Discovery composes the pure recommender from explicit profile selections and bounded distinct
artifact observations plus two explicitly confirmed prior owned artifact refs (historical workload bootstrap, server validated). It reuses native provenance/eval/browser evidence checks. All reserved
`vertical-{id}` names remain hidden from recommendations because executable native eval and authenticated UAT
evidence do not exist yet; neither a manually inserted active row nor unevaluated candidate can imply release.
New candidate activation remains refused by the explicit vertical eval release lock.

Telemetry uses typed candidate/artifact ids checked against tenant and vertical, closed event,
reason/outcome/cost/latency buckets, bounded counts and exact-key validation. It writes through the
existing insert-only audit choke point. Aggregates return counts over at most 200 events and mark
truncation. The bound native runtime emits actual artifact/completion/failure events; preview observations are excluded from production repeat demand.

## Remaining dependencies

- Reviewed bodies: draft canonical bodies and dormant native dispatch/grant bindings now exist.
- Exact-version current eval and authenticated multi-viewport UAT/provenance evidence.
- Authenticated acceptance of the implemented artifact picker and controls; sixteen local UI tests cover explicit consent, distinct owned artifacts, paging, preference preservation and subscription settling.
- Authenticated browser verification of the implemented tenant UI/runtime entrypoint and disable.
- Operational outcome proof and Data model-output consistency evaluation; trusted deterministic input validation is implemented.

VERT-01/02 are not declared fulfilled. These controls are tested infrastructure; no live publication,
provider spend, skill activation or runtime exposure occurred. The generated API declaration was
updated with exact module imports/types locally; normal deployment codegen should regenerate it.

## Verification

Targeted backend vertical controls, telemetry, owner isolation, recurrence-absence and skill-registry
tests; core vertical policy tests and typechecks. Final counts are reported with the enclosing audit
implementation report after the concurrent worker changes settle.
