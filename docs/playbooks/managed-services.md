> Last verified: 2026-10-23 — Selected Zernio account pins and observation lineage use the stable connection permission generation (grantRevision, with legacy revision fallback). Saving the same accounts or changing the daily-report preference preserves configured service readiness and history; an actual selected-account change invalidates the old scope. Zernio execution revision and lease fences remain independent.

# Playbook: Managed services

> Last verified: 2026-10-23 — Goal linkage, user usefulness feedback, trusted report history and the cited brain view pass local pure/native tests. Execution completion, usefulness and metric movement remain separate; business improvement is not established by any of them. Read-only projections preserve unknown attribution and source clocks. No hosted service cycle, activation or release is certified by these checks.

> Last verified: 2026-10-23 — Attended setup, durable execution, scoped SDK tools, per-run ledger admission and the service UI pass focused local tests. The scripted native path creates one owned thread/workflow, stages a draft, saves its reply and rejects duplicate execution. Release/live admission remains closed; local proof is not hosted acceptance.
> Build history: `.planning/phases/49-shared-managed-service-boundary/` · Related ADRs: [062](../decisions/062-managed-service-boundary.md), [064](../decisions/064-service-outcomes-preserve-source-authority.md), [046](../decisions/046-a-standing-approval-reads-and-prepares-it-never-sends.md)

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
- `packages/core/src/serviceOutcomes.ts` and `socialServiceOutcome.ts`: native-post comparison, separate retrieval/upstream clocks and conservative publication/report projections.
- `packages/backend/convex/serviceOutcomes.ts`: user-owned goal/feedback writes, trusted report history, bounded outcome reads and the cited service brain view.
- Corresponding `managedServices.test.ts` files: pure policy and native local adapter checks.

## Data and authority

The authenticated server context determines tenant ownership. Configuration stores account/connection references, skill identity/hash references and a budget ceiling; it stores no credential, skill body, provider payload, execution spend or active cadence. Server reads resolve whether references remain owned, selected, connected and effective. A stale configuration edit refuses instead of overwriting a newer revision. Status has explicit unavailable reasons; it must not echo credential ciphertext or registry bodies.

Operation admission is initially empty in the adapter. Neither a browser argument, environment toggle, stored setup nor model-provided tool name can supply qualification. The Phase 48 readiness seal and relevant execution acceptance must precede any admission change. Pure test capability snapshots are local test inputs, not live qualification artifacts.

## Invariants and changes

Preserve tenant wrappers, bounded indexed reads, revision compare-and-set, code-owned operations and exact account/skill pins. Update tenant export/erasure classification whenever adding a table. Audit events expose only code-owned enums, refs, revisions and counts; objectives, account labels, prompts and bodies never enter the audit projection.

An attended start persists one idempotent native claim and binds its owned conversation before the existing workflow starts one action with retry:false. The Executive reads its exact registry pin and intersects tools with the fixed social operations; unrelated email, media, authoring and publishing tools are absent. Each new model step/tool rereads authoritative configuration/control, while native provider admission and local draft staging check the fence in their write transactions. Pause/Stop prevents future work; explicit Resume updates control revision without starting work. Old callbacks remain fenced. Unknown outcomes and cost holds block replay; existing Buffer approval and provider queue ownership remain authoritative.

The 1–1000-cent attended run ceiling is enforced per provider attempt using the existing spendEvents reservation/settlement rows. The spend index leads with tenantId and the native bill read constrains that tenant before the run id. Precise settled USD and full unknown holds share one indexed transaction; ordinary tenant/deployment rails remain additional constraints. Settlement remains permitted after Stop or the one-hour attended-run lifetime, so accepted usage is not lost. This is not Phase 50's whole-run unattended reservation or recurrence admission.

The user goal and actual reply live in the existing Agent conversation store, never audit/run metadata. Reply publication and a completed terminal require a fresh scope and clean cost ledger in one native mutation. A workflow returning without its expected terminal is unknown; it never automatically repeats the model action.

Before changing scope, try `graphify query "managed services"`; if unavailable, inspect the named policy, adapter and caller seams directly. After code changes run the graph fixup required by CLAUDE.md. Do not regenerate the separate frozen PR82 qualification source/handoff because an unreleased service file changed.

## Verification

Run the owning pure and native `managedServices.test.ts` suites and package typechecks. Native adapter tests must exercise two authenticated tenants, stale edits, changed connection/skill references, missing sources, credential-safe views and export/erasure classification. Preserve the recurrence absence tests and existing audit projection tests. Local tests perform no provider calls or deployment.

## Goal, evidence and brain view

`bindGoal` validates both tenant-owned references and configuration/control revisions, increments both revisions and preserves pause/stop. A new run copies the goal reference; later setup edits cannot rewrite that run's goal. Only the authenticated user's `recordUsefulness` writes accepted/rejected feedback for a resolved terminal run. Neither operation changes a goal's active/achieved/dropped status. `spendEvents` and `agentSteps` remain the cost and activity authorities; outcomes return their join references rather than a second numeric ledger.

Accepted `zernio.finishReport` completion captures native metric history using the actual current connection/revision/lease. Canonical identity excludes retrieval time and normalizes ordering. Only repetition of the latest identical snapshot deduplicates: returning to an earlier value after a change creates a new observation. Retention keeps at most 30 distinct observations across the tenant; history reads paginate at most 20, check the current connection revision and selected available accounts, and disappear from the view after source withdrawal. Export/erasure uses the existing tenant data walk.

Lifetime metric comparisons join exact account, platform, native post and source. Missing is not zero. Null, zoneless, invalid or future upstream timestamps stay unknown; fetching an old observation does not make it fresh. Conflicting values at the same upstream time do not establish movement. The current connection failure suppresses a confident comparison. No account-level reach/rate aggregation, campaign attribution or business improvement is inferred.

`serviceBrainView` reuses the existing goal, ready business-profile document, foundation revisions and latest run. It exposes original source/confirmation references and times, not a rewritten fact store. A profile document's `source: agent`, kind or row creation time cannot confirm facts. Only an exact latest user-published foundation document/reference/hash match with present owned source references supplies `user_published_snapshot`; this does not convert every claim to `userProvided`. Changed or withdrawn evidence removes that confirmation. Next-action codes follow missing/stale sources, uncertain work, user feedback and the supported social projection. They do not create plans, change goals, activate skills or start another cycle.

Verify with core `serviceOutcomes.test.ts` and backend `serviceOutcomes.test.ts`/`zernio.test.ts`. Local evidence includes two tenants, stale CAS and overflow refusal, source failure/withdrawal, original confirmation times, deduplication/reversion, native lineage, pagination and retention. Publisher attribution remains unverified because no trusted Buffer-to-native-platform receipt producer exists.

The local social projection has 19 focused tests. The outcomes panel has 17 and the managed-services panel 15, covering user-only usefulness, optional owned goal linkage, current revision checks, missing/stale/unknown evidence and explicit recovery without automatic restart. These local checks introduce no provider work and do not replace hosted authenticated acceptance.

## Remaining work

Current-source release acceptance, real account/provider execution and the full social publication/report cycle remain required. The local interface and scripted native tests do not establish hosted production behavior. Arbitrary agent-composed DAG persistence/execution remains unavailable; the initial executor handles only the fixed social operations. Phases50–52 retain their remaining unattended, authenticated and repeated-cycle acceptance. Bounded history and a cited read view are implemented locally; a complete Business Ledger/profile interface and business improvement are not thereby established.

### 2026-10-23 — Field-level Business Ledger

ADR065 keeps a bounded versioned blueprintFieldProvenance sidecar on the existing tenantProfile. Native synthesis snapshots exact source IDs/hash/time before work, confirmation records the actual immutable user-review audit and field/hash refs, and unchanged fields retain their first recording/review times. Observation time is unknown unless actually supplied. Review is a proposal decision, not verification or userProvided authority. The existing profile now shows the Business Ledger with stated/inferred labels, source availability, source links and optional dates/fingerprint details. The Executive service brain reads the same ledger helper. Assured standing context excludes changed, removed and unverified legacy linkage; the values remain visible for review. No new fact store, migration, source refiling, paid work or goal completion occurs.

### 2026-10-23 — Bounded attended admission

ADR066 replaces the blanket empty admission with the existing built-in attended social draft/report capability. Only social-marketing, social.prepare/social.report, exactly one active global cockpit pin, current native account scopes and Executive grants may be ready; budget/control/identity and per-step fences still apply. Tenant overrides, additional skills, packs, business review and verticals remain outside admission. This source slice is accepted by its own current-source CI/native public-start proof and authenticated release checks, not by qualifying an unrelated offer-architect candidate. No prior phase/evidence is rewritten. Recurrence stays disabled, drafts still need exact-content review for scheduling, and unknown costs/effects block replay. No paid run or deployment occurred during construction.

Registry compatibility: the narrow built-in cockpit slice reuses the ordinary loader's unique already-active global authority, including supported bootstrap/rollback versions. Exact saved row/version/body and no active tenant overlay remain mandatory in both setup options and readiness. It does not require a new evaluation of an unchanged already-live body. Candidate/tenant activation and all existing evaluator/owner-approval transitions are unchanged; no evidence is manufactured.

### Last verified: 2026-10-23 — Native reviewed test fixtures

Older positive context fixtures now use a shared test-only helper that creates an actual synthetic source/hash and calls native draft writing plus authenticated public confirmation. It obtains real offline audit/field references rather than inserting pretend review metadata. Positive cockpit/evaluation/search/voice context assertions remain; legacy exclusion and the exact ADR063 absence exception remain explicit. This is simulated native test-user behavior, not live owner approval or golden evidence. Production source behavior and corpus cases are unchanged by the fixture correction.
