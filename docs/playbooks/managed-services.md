# Playbook: Managed services

> Last verified: 2026-10-22 — Local pure policy and native tenant setup/control tests pass, including isolation, stale edits, reference changes, correct business-profile source selection, safe status and audit projection. Release/live admission remain closed. Exact executed checks and remaining integration are recorded in the Phase 49 summaries.
> Build history: `.planning/phases/49-shared-managed-service-boundary/` · Related ADRs: [062](../decisions/062-managed-service-boundary.md), [046](../decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md)

## Purpose

Let a user save an objective, selected accounts and operating boundaries once, then supervise agent-produced work. This initial boundary defines policy and saves setup; it does not yet run a service or introduce general recurrence.

## Key files

- `packages/core/src/managedServices.ts`: fixed operations, exact references, readiness, lifecycle and bounded composition policy.
- `packages/backend/convex/managedServices.ts`: authenticated tenant setup, revision compare-and-set and bounded status/readiness views.
- `packages/backend/convex/schema.ts`: tenant-owned setup storage.
- `packages/core/src/tenantData.ts`: export/erasure classification; credentials remain in their existing stores.
- Corresponding `managedServices.test.ts` files: pure policy and native local adapter checks.

## Data and authority

The authenticated server context determines tenant ownership. Configuration stores account/connection references, skill identity/hash references and a budget ceiling; it stores no credential, skill body, provider payload, execution spend or active cadence. Server reads resolve whether references remain owned, selected, connected and effective. A stale configuration edit refuses instead of overwriting a newer revision. Status has explicit unavailable reasons; it must not echo credential ciphertext or registry bodies.

Operation admission is initially empty in the adapter. Neither a browser argument, environment toggle, stored setup nor model-provided tool name can supply qualification. The Phase 48 readiness seal and relevant execution acceptance must precede any admission change. Pure test capability snapshots are local test inputs, not live qualification artifacts.

## Invariants and changes

Preserve tenant wrappers, bounded indexed reads, revision compare-and-set, code-owned operations and exact account/skill pins. Update tenant export/erasure classification whenever adding a table. Audit events expose only code-owned enums, refs, revisions and counts; objectives, account labels, prompts and bodies never enter the audit projection.

An attended start must reuse governed execution, enforce the approved operation/tool intersection and persist one idempotent claim before paid work. Pause/Stop must reread authoritative control/configuration at each new work boundary; a pure lifecycle test alone does not implement this runtime property. Preserve unknown outcomes and spend holds. Existing Buffer approval and provider queue ownership stay authoritative.

Before changing scope, try `graphify query "managed services"`; if unavailable, inspect the named policy, adapter and caller seams directly. After code changes run the graph fixup required by CLAUDE.md. Do not regenerate the separate frozen PR82 qualification source/handoff because an unreleased service file changed.

## Verification

Run the owning pure and native `managedServices.test.ts` suites and package typechecks. Native adapter tests must exercise two authenticated tenants, stale edits, changed connection/skill references, missing sources, credential-safe views and export/erasure classification. Preserve the recurrence absence tests and existing audit projection tests. Local tests perform no provider calls or deployment.

## Remaining work

Trusted start/status/pause/stop integration, per-tool scope and claim fencing, conversational setup/supervision, release qualification and authenticated responsive acceptance remain required. Recurrence, historical business evidence and the complete social cycle belong to Phases 50–52. No running-service, general-autonomy or measured-business-improvement claim follows from setup persistence.
