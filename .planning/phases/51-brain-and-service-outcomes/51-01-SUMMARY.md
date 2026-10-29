---
phase: 51-brain-and-service-outcomes
plan: "01"
status: partial
completed: false
requirements-completed: []
---

# 51-01 — Native outcome linkage and bounded history implemented locally

As of 2026-10-23, authenticated goal binding uses tenant checks and safe configuration/control compare-and-set; new runs copy the goal reference. User usefulness feedback is separate from execution completion. Neither write marks a goal achieved. Cost and activity remain in spendEvents and agentSteps, referenced rather than duplicated.

Trusted Zernio finishReport completion captures report history after current connection/revision/lease admission. Canonical snapshots exclude fetched time and normalize ordering. Repeating the latest identical snapshot deduplicates; genuine reversion remains a new observation. Retention keeps at most 30 observations across the tenant, pages at most 20, and the existing tenant export/erasure classification includes the table. Changed connection generation, selected scope or source availability invalidates outcome/history reads.

Per-post comparisons require exact account/platform/native-post/source identity. Missing metrics differ from zero; retrieval and upstream clocks remain independent. Unknown/zoneless/future source times, same-time conflicting metrics and connection failure cannot establish movement. Every projected businessImprovement remains not_established.

Local checks: core serviceOutcomes (6) tests, native serviceOutcomes (8) tests and existing Zernio (6) tests pass. Native tests exercise accepted completion/history, two tenants, stale/overflow CAS, original source confirmation times, feedback, retention/pagination, selection withdrawal and stored Buffer lineage with unverified attribution. The four new outcome files pass scoped Biome. Checks use no provider calls or deployment. Graphify is unavailable; named plans, source writers and indexed reads were inspected directly.

Remaining: current-source CI/release acceptance, authenticated end-to-end journeys, actual source withdrawal/erasure acceptance and measured business outcomes. The independent local implementation does not close Phase 50 qualification, issue a Phase 51 seal or claim hosted behavior.

Architecture is recorded in ADR-064. Local UI follow-up passes ServiceOutcomesPanel (17 tests) and ManagedServicesPanel (15 tests) tests, including explicit goal linking/usefulness and stale/unknown recovery views. This is synthetic frontend behavior, not a signed-in browser witness.
