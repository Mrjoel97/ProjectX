# Playbook: Managed services

> Last verified: 2026-10-23 — Attended setup, durable execution, scoped SDK tools, per-run ledger admission and the service UI pass focused local tests. The scripted native path creates one owned thread/workflow, stages a draft, saves its reply and rejects duplicate execution. Release/live admission remains closed; local proof is not hosted acceptance.
> Build history: `.planning/phases/49-shared-managed-service-boundary/` · Related ADRs: [062](../decisions/062-managed-service-boundary.md), [046](../decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md)

## Purpose

Let a user save an objective, selected accounts and operating boundaries once, then supervise agent-produced work. The local attended social implementation reuses the existing Executive, native workflow component and provider accounting; it introduces no general recurrence. Release admission remains closed while current-source acceptance is pending.

## Key files

- `packages/core/src/managedServices.ts`: fixed operations, exact references, readiness, lifecycle and bounded composition policy.
- `packages/backend/convex/managedServices.ts`: authenticated tenant setup, revision compare-and-set and bounded status/readiness views.
- `packages/backend/convex/managedServiceRuns.ts` and `managedServiceExecution.ts`: idempotent attended start, one non-retrying workflow action, native scope checks and atomic conversation/result terminals.
- `packages/backend/convex/lib/managedServiceBudget.ts`: native run cap over the existing append-only provider ledger, including unresolved holds.
- `packages/backend/convex/llm.ts` and `bufferTools.ts`: exact skill loading, approved-operation tool intersection and selected-account fences.
- `apps/web/app/(app)/dashboard/skills-workflows/ManagedServicesPanel.tsx`: plain-language goal/account setup and real server-backed supervision.
- `packages/backend/convex/schema.ts`: tenant-owned setup storage.
- `packages/core/src/tenantData.ts`: export/erasure classification; credentials remain in their existing stores.
- Corresponding `managedServices.test.ts` files: pure policy and native local adapter checks.

## Data and authority

The authenticated server context determines tenant ownership. Configuration stores account/connection references, skill identity/hash references and a budget ceiling; it stores no credential, skill body, provider payload, execution spend or active cadence. Server reads resolve whether references remain owned, selected, connected and effective. A stale configuration edit refuses instead of overwriting a newer revision. Status has explicit unavailable reasons; it must not echo credential ciphertext or registry bodies.

Operation admission is initially empty in the adapter. Neither a browser argument, environment toggle, stored setup nor model-provided tool name can supply qualification. The Phase 48 readiness seal and relevant execution acceptance must precede any admission change. Pure test capability snapshots are local test inputs, not live qualification artifacts.

## Invariants and changes

Preserve tenant wrappers, bounded indexed reads, revision compare-and-set, code-owned operations and exact account/skill pins. Update tenant export/erasure classification whenever adding a table. Audit events expose only code-owned enums, refs, revisions and counts; objectives, account labels, prompts and bodies never enter the audit projection.

An attended start persists one idempotent native claim and binds its owned conversation before the existing workflow starts one action with retry:false. The Executive reads its exact registry pin and intersects tools with the fixed social operations; unrelated email, media, authoring and publishing tools are absent. Each new model step/tool rereads authoritative configuration/control, while native provider admission and local draft staging check the fence in their write transactions. Pause/Stop prevents future work; explicit Resume updates control revision without starting work. Old callbacks remain fenced. Unknown outcomes and cost holds block replay; existing Buffer approval and provider queue ownership remain authoritative.

The 1–1000-cent attended run ceiling is enforced per provider attempt using the existing spendEvents reservation/settlement rows. The spend index leads with tenantId and the native bill read constrains that tenant before the run id. Precise settled USD and full unknown holds share one indexed transaction; ordinary tenant/deployment rails remain additional constraints. Settlement remains permitted after Stop or the one-hour attended-run lifetime, so accepted usage is not lost. This is not Phase50's whole-run unattended reservation or recurrence admission.

The user goal and actual reply live in the existing Agent conversation store, never audit/run metadata. Reply publication and a completed terminal require a fresh scope and clean cost ledger in one native mutation. A workflow returning without its expected terminal is unknown; it never automatically repeats the model action.

Before changing scope, try `graphify query "managed services"`; if unavailable, inspect the named policy, adapter and caller seams directly. After code changes run the graph fixup required by CLAUDE.md. Do not regenerate the separate frozen PR82 qualification source/handoff because an unreleased service file changed.

## Verification

Run the owning pure and native `managedServices.test.ts` suites and package typechecks. Native adapter tests must exercise two authenticated tenants, stale edits, changed connection/skill references, missing sources, credential-safe views and export/erasure classification. Preserve the recurrence absence tests and existing audit projection tests. Local tests perform no provider calls or deployment.

## Remaining work

Current-source release acceptance, real account/provider execution and the full social publication/report cycle remain required. The local interface and scripted native tests do not establish hosted production behavior. Arbitrary agent-composed DAG persistence/execution remains unavailable; the initial executor handles only the fixed social operations. Recurrence, historical business evidence and the complete social cycle belong to Phases50–52. Successful execution is not proof of business improvement.
