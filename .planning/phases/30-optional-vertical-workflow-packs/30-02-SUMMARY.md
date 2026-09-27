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

## 2026-09-27 repository-local integrity recheck

Two current-tree regressions found that workload updates dropped a previously selected legal
playbook when the optional argument was omitted, and that an exact confirmed CSV source beyond
the five-row discovery sample was invisible to a Data preview. Both failed before their repairs
and passed afterward. A third control kept the ready CSV rows but deleted their shared storage
object: `prepare` incorrectly returned `ok:true` before the repair and now refuses with
`validator-unavailable`. Deleted document rows also refuse. Discovery reads at most two confirmed
artifact IDs per six packs plus the existing five-row sample, filters tenant/status/sealed rows,
and now verifies storage metadata for Data/Design readiness without reading file bytes.

The focused controls, native binding and telemetry selection passed 22/22 on the changed source;
backend TypeScript, source formatting, all 30 registered free gates and strict planning/playbook
checks passed. Graphify and Convex-edge refresh completed after the source edits. This adds
repository-local integrity proof only. The plan remains **partial**: exact-version semantic
evaluation, authenticated browser control/UAT, complete outcome-event coverage and release
evidence are not supplied by these regressions; VERT-01/02 and Phase 30 remain open.
