# ADR-063 — Construct the recurring adapter without enabling it

- **Status:** Development-only implementation; activation deferred.
- **Date:** 2026-10-23
- **Context:** The owner's instruction to finish the engine permits reversible offline construction. It does not replace the existing evidence requirements for live recurrence.

## Decision

Permit construction and zero-provider-cost native testing of an inert recurrence adapter in an unreleased checkout while the active recurrence decision remains `defer`. This removes the circular dependency between constructing durable claims and obtaining native claim evidence. The historical Phase29 decision and accepted ADR-046 remain unchanged.

The exception is named and limited: `managedServiceRecurrence.ts`, `managedServiceStandingApprovals`, `managedServiceOccurrences`, and their pure policy and synthetic transaction tests. The adapter's sole callable internal claim passes the literal disabled capability; native arguments and environment variables cannot override it. Plain transaction helpers are exercised only by synthetic tests. There is no enabled cadence, cron registration, scheduler arming/rearming, unattended dispatch, provider call, approval creation flow or production exposure. Closed module/storage guards explicitly enumerate this construction and separately prove that scheduling call sites and runtime consumers have not expanded.

Native tests may exercise persisted uniqueness, stale approval/control/account fences, missed occurrences, overlap, whole-run reservations, known-cost settlement, unknown holds and effect reconciliation. Occurrence-envelope movements reuse the append-only spend ledger and existing tenant/deployment limiters. They are distinct from attended per-provider-call movements and are not wired together into a provider dispatch path. This construction does not establish a running recurring service.

Existing reporting exceptions remain supported. Construction evidence neither satisfies `enable-safe` nor qualifies any capability. Live activation still requires a separate recorded decision after the existing evidence requirements pass. No paid evaluation, publishing, owner activation or deployment follows from this exception.

## Consequences

Independent engine work can proceed without pretending native persistence is absent. Future reviewers see the exact storage/module exception and the remaining activation boundary. Unknown costs retain their reservation; known costs alone cannot resolve unknown external effects. The disabled adapter cannot reserve money through its callable route.
