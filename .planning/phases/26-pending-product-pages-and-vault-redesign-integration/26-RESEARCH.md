# Phase 26: Connected Product Pages - Research

**Researched:** 2026-08-05
**Requirements:** DASH-01, APRV-01, FIN-01, CONT-01, RPRT-01, HOME-01
**External gate:** Phase 19 ACTN-05 + PIPE-01
**Confidence:** High for repository contracts, file ownership and sequencing; live vendor/UAT gates remain intentionally execution-time.

## Executive Finding

Phase 26 can start now. Phase 25 is not a technical prerequisite; it consumes these finished
surfaces before beta. The safe architecture is twenty small plans across sixteen waves, with each
route hidden until its backend, tests, browser gate and owner UAT pass.

The remaining pages are not one frontend project:

- Approvals needs indexed tenant-wide reads plus missing discard and true schedule-move semantics.
- Finance needs an append-only spend ledger before it can tell historical truth.
- Content is a bounded union across Vault documents, plan attachments/rendered reels and sent requests.
- Reports needs safe time-windowed projections; raw `audit.payload` must never reach React.
- Pipeline belongs to Phase 19's single contacts/consent/suppression store; Phase 26 only consumes it.
- Command Center must land last and compose source summaries rather than reread raw tables.

## Repository Corrections That Change the Plan

1. There are no Approvals, Finance, Content, Reports or Sales Pipeline dashboard routes today.
2. `apps/web/app/(app)/layout.tsx` hardcodes disabled `Soon` items; there is no product-page flag system.
3. `plans` has no tenant/status/created index. Existing `reschedulePlan` reopens a canceled plan; it
   does not atomically move a live schedule. There is no proposed-plan discard mutation.
4. Current limiter windows are enforcement state, not a history. Reasoning and ingest have no
   durable ledger, and media's internal reads are not tenant product APIs.
5. `requests.list` and several current home/notification/DLQ reads are unbounded and expose shapes
   inappropriate for cross-page reuse.
6. Only Phase-18 created documents with `origin:"agent"` are deliberately non-groundable. Research
   findings and approved next-step memos already ingest. Promotion must be offered only to the former.
7. `audit.payload` is `v.any()`. The old event taxonomy is incomplete; the browser needs an explicit
   allowlist projection, actor normalization and unknown-event shells with no raw payload.
8. `packages/backend/convex/pipeline.ts` is the legacy request workflow, not a sales CRM. Do not
   overload it with contacts or pipeline page reads.
9. A suppression check only in `executePlan` is incomplete: scheduled sends re-enter at
   `startFanout`, and legacy `/submit` reaches `gmail.send`. Phase 19 must guard all product-email
   terminals while excluding operational failure notifications.
10. The current Command Center makes two unbounded `requests.list` calls and treats a very small
    mailbox/workspace branch as priority. It cannot safely aggregate the new pages until their
    summary APIs exist.

## Cross-Cutting Architecture

### Public result contracts

- Tenant pages use tenant wrappers; global operational facts and controls use owner wrappers.
- Lists use cursor pagination or explicit time-and-row caps with stable ordering and a `partial` or
  `capped` signal.
- Page contracts distinguish loading, successful empty, partial, retryable error and governed refusal.
- Time filters resolve once into a half-open `[sinceMs, untilMs)` window and a named IANA timezone.
- Money uses integer cents at display boundaries and keeps estimate/reserve/actual/refund/unlanded
  distinct. All product cost copy says USD.
- New route modules are registered in a dedicated `dashboard-pages.md` playbook/watch entry; existing
  subsystem playbooks are updated by the plan that touches their source.

### Additive schema ownership

One early plan owns all Phase 26 edits to `packages/backend/convex/schema.ts` to avoid concurrent
schema conflicts. Candidate additions validated by the repository audits:

- `plans.by_tenant_status_createdAt` plus optional cancellation provenance/progress completeness.
- append-only `spendEvents` and a durable coverage-start record.
- `mediaJobs.by_tenant_createdAt`.
- optional `vaultDocuments.sourceThreadId`, `sourcePlanId`, plus
  `by_tenant_origin_createdAt`.
- `requests.by_tenant_status_createdAt` for bounded sent-mail periods.
- `briefings.by_tenant_createdAt` and `feedback.by_tenant_createdAt`.
- report snapshot/artifact metadata only if the board-pack plan proves it cannot reuse an existing
  compatible artifact row.

All fields are optional/backward-compatible where legacy rows exist. No destructive narrowing or
invented historical backfill is allowed.

## Approvals

### Existing rails to reuse

- `cockpit.executePlan` already owns the common approve gate and is CAS-idempotent.
- `plans.setPlanSendTime`, canceled-plan reopen, media estimate, calendar staged fields and memo
  landing already exist in their respective flows.
- `/dashboard/workspace?thread=<id>` is the safe revision destination.

### Required work

- `cockpit.discardPlan`: `proposed -> canceled` with `cancelKind:"discarded"`; it can never enter the
  scheduled re-arm path.
- An atomic schedule move returning `moved | already_fired | not_scheduled` and tested against the
  scheduler race.
- Progress counters or an explicitly bounded/partial legacy fallback updated at delivery terminals.
- New `approvals.ts` summary and paginated lists for awaiting, scheduled, in-flight, decisions and
  cleared states; no raw plan projection.
- Calendar Change Time remains a cockpit deep link in v1.
- `/dashboard/approvals` stays gated until email, media, calendar and memo fixtures execute in the
  authenticated browser run.

## Finance

### Ledger contract

`spendEvents` is append-only and correlation-idempotent:

```text
tenantId
rail: reasoning | media | ingest
phase: estimated | reserved | actual | refunded | adjustment
amountCents
correlationId
planId? / requestId? / folderId? / mediaJobId?
model? / kind?
createdAt
```

The limiter remains enforcement truth; the ledger is reporting/reconciliation truth. Tests must
pair every money movement with exactly one event and must survive retries/webhook replay. Tracking
before `coverageStartedAt` is unknown. Ledger instrumentation remains active even if the Finance UI
is rolled back, otherwise the history develops a hole.

Reasoning/ingest and media instrumentation can run in parallel after the ledger core because they
own separate source/playbook files. `finance.ts` then exposes tenant summaries/series/ledger and
owner-only global rails/controls with range validation and refs-only audit.

## Content

The unified page spans four real shapes:

- Vault documents: created docs, research and memos.
- `plans.attachments`: generated email attachments.
- rendered plan reels, valid only with storage ID, sidecar ID and successful render proof.
- terminal sent-mail requests, grouped by plan where available.

Reuse the tenant-safe Vault detail/download, `plans.attachmentUrls` and `media.reel` adapters.
Do not expose `requests.list` directly.

Add stable provenance at created-document, research and memo writes. A new `content.ts` provides
bounded artifact/sent-mail projections, on-demand signed URLs, cockpit-prefill reuse and an
idempotent `origin:"agent" -> "agent_promoted"` transition that starts ingest exactly once. Legacy
unknown provenance remains explicit. Exact mock filter counts are omitted or capped.

## Reports

Business and operations projections reuse bounded evaluation, blueprint, Vault, telemetry, feedback
and source-page summaries. Every period card receives the same resolved window. Comparisons only
combine comparable Growth-OS snapshots and disclose incomplete populations.

Governance is isolated in a separate module:

- inventory known audit event types and allow safe keys per event;
- return unknown events as event/time/category shells with no payload detail;
- normalize the tenant actor to `you`, system actors to fixed labels, and never return raw actor IDs;
- drop nested values and content-like keys before serialization;
- keep WORM cursor and active skill versions behind owner queries, returning metadata only.

Board-pack generation reads one internal transactional snapshot for one as-of/window, renders it,
stores a non-groundable artifact and audits only artifact ID, window, section counts and result. It
must not assemble several browser subscriptions from different moments.

## Pipeline / Phase 19 External Gate

Phase 19 owns the person store, consent evidence, suppression, follow-ups, postal address/footer,
governed CRM writes and the narrow Pipeline route. It must guard immediate approval, scheduled
fan-out and the provider terminal; a suppressed target is a governed refusal with no partial group
send, request row, provider call or DLQ accident.

Phase 26 owns only the integration checkpoint: confirm ACTN-05/PIPE-01, Phase 19 isolation/send-safety
tests, authenticated Pipeline E2E and owner UAT, then enable the nav entry. The page shows contacts
needing attention, follow-ups due, consent and suppression states — no opportunities, stages or value.

## Command Center v2

Add a pure priority function and three separate subscriptions: source summary, health, latest
briefing. Suggested deterministic order:

1. connection failure;
2. severe unresolved DLQ;
3. stale approval;
4. scheduled risk;
5. diagnostic blocker;
6. binding constraint;
7. open workspace.

Failed health signals render Unknown, never Healthy. Labels/reasons/routes are code-owned. Any
action-sounding briefing affordance initially opens the workspace; it does not silently write.

## File Ownership and Parallelism

- `schema.ts`: schema foundation plan only.
- shared package indexes/exports: shared contract plan only.
- `cockpit.ts`, plan state transitions and delivery progress: Approvals mutation plan.
- `guardrails.ts`/folder budget sources: reasoning+ingest ledger plan.
- `media.ts`/media completion: media ledger plan.
- Vault provenance writers: Content provenance plan.
- reports business and governance use separate modules and tests.
- `layout.tsx` is serialized through route-gate plans only.
- Pipeline backend/source files remain Phase 19 ownership.

## Validation Architecture

### Automated layers

1. Pure package tests: result/window/money contracts, report metrics, priority ordering and UI state
   reducers.
2. Convex isolation tests: unauthenticated callers, guessed foreign IDs, stable cursors/windows,
   idempotent mutations, scheduler/webhook races and refs-only audit.
3. Mutation/non-vacuity tests: delete a scope predicate, replay a ledger event, reopen a discarded
   plan, emit a nested unsafe audit payload, promote twice, fail a health source.
4. Page component tests: every loading/empty/partial/error/refusal/busy state and disabled/enabled
   route gate.
5. Focused authenticated Playwright per page using live local Convex; no fake provider success.
6. Final both-package suites, both typechecks, production build and playbook watcher.

### Page checkpoints

- Approvals: one email/media/calendar/memo row, double-approve and schedule-race evidence.
- Finance: one controlled movement in each phase; pre-coverage Unknown; owner/non-owner rails.
- Content: every artifact kind, ownership-checked download, reuse deep link and promotion lifecycle.
- Reports: one window controls all cards; governance DOM contains no content; board-pack download;
  owner/non-owner split.
- Pipeline: external Phase 19 two-tenant, suppression/footer and browser evidence.
- Command Center: recommendation changes as blockers clear; failed health never renders healthy.

Each checkpoint includes desktop/tablet/mobile, keyboard/focus, no color-only meaning and a rollback
test. Route/nav activation occurs only after owner approval.

### Rollback boundaries

- Additive fields/indexes remain; disable consumers rather than narrowing schema.
- Approvals falls back to workspace, `/review` and `/requests`; provenance is retained.
- Finance UI can disable, but ledger instrumentation must continue.
- Content disables route/promotion; already promoted rows are not silently demoted.
- Reports disables route/generation; generated artifacts/snapshots remain immutable.
- Pipeline can hide the route, but suppression/footer safety is never rolled back.
- Command Center can restore the current component while keeping source summary APIs.

## Recommended Plan Topology

Twenty plans across sixteen waves:

1. shared contracts and schema foundation in parallel;
2. Approvals mutations and reads in parallel, then route/UAT;
3. ledger core, parallel reasoning+ingest/media instrumentation, Finance reads, route/UAT;
4. Content provenance, reads/actions, route/UAT;
5. parallel report business/governance semantics, board pack, route/UAT;
6. Phase 19 Pipeline external integration gate;
7. Command Center backend/pure priority, then final route/repository UAT.

This topology is intentionally fine-grained: it prevents shared schema, `layout.tsx`, cockpit,
budget and report-privacy files from being edited by parallel executors.

---

*Research synthesized from four parallel repository audits plus the approved integration map.*
