# Pending Pages + Knowledge Vault: Pre-Implementation Integration Map

**Status:** Ready for owner review. No frontend implementation has started.  
**Prepared:** 2026-08-04  
**Design sources:**

- `docs/design/mockups/pending-pages.html`
- `docs/design/mockups/vault-redesign.html`

## 1. Outcome

The designs can be implemented, but they are not all equally ready.

The Knowledge Vault redesign is mostly a presentation change over an already connected surface. Approvals, Content, Reports, and Command Center can reuse substantial existing product logic, but they need new tenant-wide read models and several explicit action adapters before their buttons are real. Finance needs a durable spend ledger before its historical charts can be truthful. Sales Pipeline must remain **Soon** until Phase 19 ships its contacts, consent, suppression, and follow-up substrate.

The implementation rule for this work is:

> No visual control ships until its data source, authorization boundary, mutation semantics, failure state, audit event, and production verification path are named and tested.

This document is the dependency contract for the frontend work. If implementation discovers a new requirement, it must be added here or to the owning roadmap phase before UI is merged.

## 2. Readiness and cost summary

Effort is a planning estimate for one engineer already familiar with this repository. It includes implementation, unit/isolation tests, frontend states, and a focused browser verification; it excludes owner-only live vendor gates that already exist elsewhere.

| Surface | Current readiness | Required backend work | Engineering size | Estimated effort | Runtime / infrastructure cost |
|---|---|---:|---:|---:|---|
| Knowledge Vault redesign | Mostly connected | Optional exact category counters; otherwise none | S–M | 2–4 engineer-days | No new vendor cost |
| Approvals | Core actions exist; tenant-wide queue does not | New read models, plan index, discard/reschedule/change-time semantics, progress aggregation | L | 6–9 engineer-days | No new vendor; media approval spends existing fal budget |
| Finance | Current allowance exists; honest history does not | New spend ledger, owner adapters, indexed period reads | XL | 8–12 engineer-days plus data-aging window | Convex rows for each spend movement; no new vendor |
| Content | Artifacts exist in three different stores | Unified artifact projection, provenance, download/reuse adapters, pagination | L | 6–9 engineer-days | Signed storage reads; no new vendor |
| Reports | Raw sources mostly exist | Windowed projections, safe audit reader, export/skill owner readers, PDF report contract | XL | 9–14 engineer-days | PDF render/storage; WORM remains existing S3 cost |
| Sales Pipeline | Not built | Phase 19 contacts/CRM/consent/suppression/postal-address work | XL / separate phase | 2–3 weeks, governed by Phase 19 | Convex storage; legal/compliance work may add external cost |
| Command Center v2 | Existing page is a four-query shell | Cross-surface summary and priority algorithm; latest briefing/health reads | M–L after dependencies | 4–6 engineer-days | No new vendor |

These estimates should be treated as ranges, not promises. Finance and Reports have the largest uncertainty because their mockups imply historical truth that the current write plane was not designed to preserve.

## 3. Readiness vocabulary

- **Ready:** A tenant-safe public API and the intended mutation already exist and are used by a live UI.
- **Adapter:** The underlying data/logic exists, but a new bounded tenant or owner wrapper/projection is required.
- **Backend gap:** A new stored fact, index, state transition, or write-path instrumentation is required.
- **Blocked:** Shipping the UI would fabricate data or expose a control with no safe terminal.

## 4. Repository reality that overrides the mockup annotations

The coloured `exists` / `new` notes in `pending-pages.html` are design annotations, not verified contracts. The following corrections are load-bearing:

1. `plans` has only `by_thread`, `by_calendar_run`, and `by_media_run`. It has no tenant/status index. A tenant-wide approvals queue therefore needs a new compound index.
2. `cockpit.reschedulePlan` does **not** reschedule a currently scheduled plan. It only reopens an already-canceled plan, and the current UI then re-executes it. The mockup's direct **Reschedule** control needs orchestration or a new atomic mutation.
3. There is no direct discard mutation for a proposed plan. Reusing scheduled cancellation without recording why would make the existing reschedule path capable of reopening something the user deliberately discarded.
4. There is no direct calendar-event time editor. `calendar.createEvent` is internal and only runs after approval. A **Change time** button needs a safe staged-event mutation plus availability recheck, or must be relabelled as a cockpit deep link.
5. `guardrails.remainingDailyCents`, `mediaRemainingCents`, and `ingestRemainingCents` are internal reads. The media estimate has a public per-plan read, but the Finance page needs new tenant/owner projections.
6. Reasoning and ingest spend have no durable historical ledger. Rate-limit windows expose current allowance, not a time series. Cockpit terminal telemetry intentionally records reasoning `costUsd: 0`. The mockup's all-rails chart and cost-per-send claims cannot be populated honestly from current data.
7. `media.spendForPeriod` and `media.listJobs` are internal operator queries. They need tenant-safe projections and better period indexes before becoming product APIs.
8. `notifications.list` already returns all notifications, not only unread. It is unbounded and sorts in memory, so the required change is pagination/windowing, not merely an “all” option.
9. `requests.list` already exists but returns raw content and uses unbounded `.collect()`. New dashboards should not reuse it directly; they need bounded projections.
10. `evaluations` already has `by_tenant`, so a cross-thread history read needs a bounded query, not necessarily a new index. The semantics of “current gate” and “gaps closed” still need to be defined.
11. `audit.payload` is `v.any()` in the Convex schema. The payload is kept safe by the `AuditPayload` TypeScript contract and static tests, not by the database validator. A browser viewer must receive a server-side safe projection, never the raw payload object.
12. `exportCursors` and active `skills` are deployment-global. They are owner-only operational facts, not tenant facts.
13. The Vault mock says every feature and copy line is already shipped, but the current UI does not show category counts, does not use document-type-specific glyph colours, does not show the eyebrow/subtitles in the mock, and has additional live preview controls that must not be removed.
14. The mock's finance prose says “rand” while all current guardrail and provider costs are USD. Cost pages must say USD. Revenue currency belongs to Phase 19/profile work and must not be inferred.
15. Static SAST dates/times in the mock are examples. Runtime dates must use a real tenant/browser IANA timezone. The current profile has no canonical timezone field; browser-local formatting is acceptable only as an explicitly documented v1 fallback.

## 5. Cross-cutting contracts to build first

### 5.1 Authorization

- Tenant-owned reads and writes use `tenantQuery`, `tenantMutation`, or `tenantAction`. The browser never supplies `tenantId` for authorization.
- Deployment-global configuration, WORM status, skill versions, deployment ceilings, and kill switches use `ownerQuery` / `ownerMutation` and are hidden from non-owners only as presentation on top of the server gate.
- Cross-tenant isolation tests ship with every new query and mutation, including guessed foreign IDs.
- Signed storage URLs are returned only after a tenant ownership check and are never stored in audit, telemetry, or logs.

### 5.2 Query shape

- Every list is cursor-paginated or explicitly bounded by both time and row count.
- Counts that appear on navigation badges or summary tiles are maintained counters or honest bounded values with `+`/partial copy. No `.collect().length` is added to a hot path.
- Dashboard APIs return page-specific projections, not raw `plans`, `requests`, `vaultDocuments`, or `audit` rows.
- Every projection distinguishes `undefined/loading`, empty, capped/partial, and error. A query error must have a visible retry path; it must never silently become zero.

### 5.3 Mutation shape

- Every action button has a server-side state guard and an idempotent result.
- Double click, stale tab, and concurrent scheduler races are tested.
- Expected governance refusals return discriminated results and user-facing remedies; bugs throw and surface through an error boundary/notification.
- State-changing dashboard mutations write refs/counts-only audit events. Content remains in content-plane tables.

### 5.4 Time and money

- Persist instants as epoch milliseconds; format with a named IANA timezone.
- Use half-open windows `[sinceMs, untilMs)` for reporting.
- Provider/guardrail cost is USD and stored in integer cents at display boundaries. Media's existing fractional-USD line-item contract remains intact internally.
- Estimated, reserved, actual, refunded, and unlanded are different states. The UI never calls an unlanded job free and never labels a reservation as actual spend.

### 5.5 Common UI states

Every page gets:

- authenticated loading state;
- empty state driven by a successful zero result;
- partial/capped state;
- recoverable query error with retry;
- mutation busy/idempotent state;
- governed refusal copy;
- external connection/reauth state where applicable;
- mobile/tablet layout and keyboard/focus verification;
- no colour-only meaning.

## 6. Proposed backend read-model modules

Names are proposed contracts, not implementation commitments. They keep page composition out of React and prevent every tile from independently re-reading the same unbounded tables.

| Module | Proposed public surface | Purpose |
|---|---|---|
| `approvals.ts` | `summary`, `listAwaiting`, `listScheduled`, `listInFlight`, `listCleared`, `listDecisions` | Bounded, tenant-safe approval page projections |
| `finance.ts` | `summary`, `spendSeries`, `mediaLedger`, `ownerControls`, `setOwnerControls` | Tenant cost facts plus owner-only global controls |
| `content.ts` | `listArtifacts`, `artifactById`, `listSentMail`, `promoteArtifact`, optional `reuseArtifact` | Unified content library across vault, plans/media, and requests |
| `reports.ts` | `business`, `operations`, `governance`, `ownerGovernance`, `generateBoardPack` | Windowed and safe reporting projections |
| `home.ts` | `summary`, `health` | Command Center roll-up after the source surfaces are stable |
| `briefings.ts` | `latestForTenant` | Latest standing briefing independent of a known cockpit thread |

Do not implement a single mega-query for every page. Stable headline summaries and paginated ledgers should be separate subscriptions so one large list cannot fail the whole page.

## 7. Data-model and index plan

### 7.1 Required before Approvals

1. Add `plans.by_tenant_status_createdAt = [tenantId, status, createdAt]`.
2. Add optional cancellation provenance, recommended as:
   - `cancelKind: "scheduled_cancel" | "discarded"`
   - `canceledAt: number`
   Existing `canceled` rows without `cancelKind` are treated as legacy scheduled cancellations.
3. Add `cockpit.discardPlan` for `proposed -> canceled` with `cancelKind: "discarded"`; clear scheduled handles defensively; emit `plan.discarded` with `{planId, kind}` only.
4. Add an atomic current-schedule move or explicitly implement the existing safe multi-step cancel/reopen/re-arm flow. The preferred production contract is one mutation that returns `moved | already_fired | not_scheduled` and never claims success after the scheduler has won the race.
5. Decide progress aggregation. Recommended: optional plan counters (`recipientTotal`, `sentCount`, `failedCount`, `queuedCount`) updated at the existing delivery terminals. Legacy plans may fall back to the current `reportForPlan` only inside a strict bound.

### 7.2 Required before Finance

Add an append-only `spendEvents` table rather than reverse-engineering historical spend from unrelated terminal rows:

```text
tenantId
rail: reasoning | media | ingest
phase: estimated | reserved | actual | refunded | adjustment
amountCents
correlationId
planId? / requestId? / folderId? / mediaJobId?
model? or kind? (code-owned identifier only)
createdAt
```

Indexes:

- `by_tenant_createdAt`
- `by_tenant_rail_createdAt`
- optional `by_correlation` for reconciliation

Write events at the existing money movement points:

- reasoning: `guardrails.prepare` estimate and `recordSpend` actual;
- media: whole-job reservation, job landing actual, and settlement/refund;
- ingest: folder reservation, actual extraction spend, and settlement/refund.

The rate limiter remains the enforcement source of truth. `spendEvents` is the reporting/reconciliation source. Both must be written in the same transaction where possible, and tests must fail if one moves without the other.

Historical data before deployment of this table is **unknown**, not zero. Finance should show “Tracking began <date>” and must not backfill fabricated detail from current rate-limit values.

Also add:

- `mediaJobs.by_tenant_createdAt = [tenantId, createdAt]` for the ledger;
- tenant queries that expose personal remaining reasoning/media/ingest rails;
- owner queries that expose each deployment-global rail separately;
- owner mutations around kill switches and `budgetUsdPerRequest` with range validation and audit.

Do not present one combined “deployment ceiling” unless the three distinct deployment rails are intentionally combined by a documented formula. Today they have different caps.

### 7.3 Required before Content

1. Add a stable artifact provenance field to `vaultDocuments`, recommended:
   - `sourceThreadId?: string`
   - `sourcePlanId?: Id<"plans">`
   - existing `origin` remains the trust/grounding discriminator.
2. Populate provenance at created-document, research, memo, and any future promoted-artifact write sites.
3. Add `vaultDocuments.by_tenant_origin_createdAt` if agent-created/promoted documents are a primary library filter.
4. Add `plans.by_tenant_status_createdAt` from Approvals to find rendered media plans; do not copy reel blobs into another table solely for listing.
5. Add a tenant-safe signed reel URL projection that requires `renderStatus="rendered"`, `renderStorageId`, and a valid sidecar proof.
6. Add bounded request/sent-mail projections; do not expose `requests.list` directly.
7. Promotion must patch `origin: "agent_promoted"` and invoke the existing ingest path exactly once. It needs idempotency and a visible processing state.

### 7.4 Required before Reports

- Add `briefings.by_tenant_createdAt` for latest standing briefing.
- Add a safe, paginated `audit` projection using `by_tenant_ts`. Whitelist/normalize flat payload values server-side; never return the raw `v.any()` object.
- Add tenant-scoped feedback aggregation or a tenant-prefixed feedback index; the existing global `by_skill` index is unsuitable for a tenant report.
- Add owner-only reads for WORM cursor health and active skill versions.
- Reuse `evaluations.by_tenant` with a bounded time window; define a deterministic latest-growth-OS snapshot and delta semantics.
- Add a telemetry series projection using `by_tenant_created`; do not imply cockpit reasoning cost completeness until `spendEvents` is live.

### 7.5 Required before exact Vault mock counts

The current vault deliberately returns a bounded newest window and marks it `capped`. If exact category counts are required in each tab, add maintained category counters or a dedicated counter table updated at every vault insert/delete/category change. Do not add six unbounded scans.

The colour redesign itself does not require this. It may ship while preserving honest `200+` totals and omitting exact tab counts.

### 7.6 Sales Pipeline / Phase 19

Do not duplicate Phase 19. The existing roadmap already requires:

- contacts/person store with origin;
- leads and follow-ups;
- reproducible consent capture;
- unsubscribe/suppression state;
- suppression check in the actual send path;
- tenant postal address and required commercial-email footer;
- tenant isolation and refs-only audit.

The pipeline UI becomes an additional Phase 19 success criterion after those contracts are planned. Until then the nav item remains disabled with **Soon**.

### 7.7 Migration and backward compatibility

- New Convex indexes are additive and built by Convex; they do not require application-authored row migrations.
- New cancellation/provenance/timezone fields remain optional. Reads must map absence to an explicit legacy/unknown state.
- Existing `canceled` plans with no `cancelKind` are treated as scheduled cancellations only for compatibility; newly discarded plans always write `cancelKind: "discarded"` and can never enter the re-arm path.
- `spendEvents` starts at zero rows and records a `coverageStartedAt` configuration/first-event timestamp. No backfill attempts to invent reasoning or ingest history.
- If plan delivery counters are adopted, update all new transitions first, then backfill legacy plans in bounded batches. Until a plan is marked counter-complete, the UI uses the legacy bounded report projection and labels it partial if capped.
- Vault provenance remains unknown on existing artifacts. Do not infer a cockpit thread by scanning `vaultSources.docIds` arrays.
- Exact vault category counters, if approved, need a resumable bounded backfill plus dual-write tests before the UI trusts them. During the backfill the existing bounded/capped stats remain authoritative.
- New page APIs are additive. Existing workspace, Ops, `/requests`, and `/review` callers continue to use their current contracts until each migration is independently verified.
- No destructive schema narrowing, field removal, or historical row rewrite is part of this project.

## 8. Page-by-page mapping

## 8.1 Approvals — `/dashboard/approvals`

### Header and badge

| Design element | Current source | Readiness | Required contract |
|---|---|---|---|
| Date | Browser clock only | Adapter | Use browser IANA timezone initially; later tenant profile timezone |
| Awaiting count | No tenant-wide plan read | Backend gap | `approvals.summary.awaitingCount` from maintained/indexed plan data |
| Oldest waiting | `plans.createdAt` exists | Adapter | Oldest `proposed` plan; return timestamp, not preformatted “2 days” |
| Rail badge | No live approvals badge | Backend gap | Same summary subscription; no second count query |

### Awaiting email plan

- **Display data:** existing plan fields cover subject, body, recipients, recipient-specific bodies, thread ID, send time, and attachment metadata/URLs.
- **Approve:** `cockpit.executePlan` is ready and CAS-idempotent.
- **Schedule:** `plans.setPlanSendTime` is ready for proposed email plans; the page must then call `executePlan` only after the user confirms the absolute timezone-resolved time.
- **Open/revise in cockpit:** deep link `/dashboard/workspace?thread=<threadId>` is ready. Use a link, not a mutation.
- **Discard:** backend gap; add `cockpit.discardPlan` as described above.
- **Estimated email cost:** not currently attributable to a plan. Either omit this number in the first release or compute/store an estimate at plan proposal and reconcile through `spendEvents`. Do not use the mock's hard-coded `$0.004`.
- **Attachments:** use tenant-guarded signed URLs only when the user opens/downloads; do not eagerly mint URLs for the entire queue if metadata is enough.

### Awaiting media plan

- Deck metadata and current plan shape exist.
- `media.jobEstimate` is the correct pre-spend source and already derives the same batch the reservation uses. Reuse its four real lines (clips, voice, captions, render); the mock's three lines are outdated because render is also priced.
- Approve via `cockpit.executePlan`; show governed refusal reasons and keep the plan proposed on refusal.
- **Edit blocks** deep-links to the existing cockpit/media canvas thread.
- Discard uses the new common discard contract.
- Live provider generation remains behind the existing media budget and the Phase 20 owner live gate; the page does not create a second paid entry point.

### Awaiting calendar plan

- Staged event fields and `executePlan` calendar dispatch exist.
- Approve/create is ready and does not require Gmail send semantics.
- Availability shown as “checked, free” needs a stored check timestamp/result or a fresh query; it cannot be inferred from the fact the plan exists.
- **Change time** options:
  1. Recommended: new `calendar.updateStagedEvent({planId,startMs,durationMs,tz})` that owns the plan, requires `proposed/calendar_event`, rechecks availability, and updates only on a free result.
  2. Lower-cost first release: relabel to **Revise in cockpit** and deep-link the thread.
- Never let the browser call `calendar.createEvent` directly; it remains internal behind approval.

### Awaiting memo / diagnosis

- `evaluations.actOnGap` stages the plan and `executePlan` persists it to the vault. This is ready.
- The approvals queue must display only a landed `proposed` memo, not the intermediate `collecting` specialist state.
- Discard uses the common discard contract.
- The card should link back to the originating evaluation/thread through `threadId`.

### Scheduled

- Existing current behavior: cancel is ready; re-schedule is a canceled-plan reopen + re-execute flow.
- The table needs a tenant-wide scheduled-plan query and the new plan index.
- Direct rescheduling must explicitly handle the scheduler race. A response that says `already_fired` moves the row to In Flight; it must not display “Rescheduled.”
- Recipient count comes from the frozen plan/request contract; do not display raw recipient addresses in this ledger.

### In flight

- `plans.reportForPlan` can prove the concept but is unbounded and performs per-row audit joins.
- Production target is maintained per-plan progress counters updated by delivery terminals.
- The UI subscribes to a bounded list of in-flight plans and renders sent/queued/failed totals. A failed recipient links to Compliance or the originating cockpit report.
- “Bounced” is shown only if the stored reason code really distinguishes a bounce from a generic failure.

### Other decisions

- **Diagnostic question:** `evaluations.recordScorecardAnswer` exists. The page needs an open-question projection that returns `threadId`, validated field path/type, prompt label, and latest value. Never accept an arbitrary field name from rendered row content.
- **Blocked/PII:** `deadLetters.listNew`, notifications, and the existing `/ops` page exist. Use a bounded projection and link to `/ops`; do not duplicate resolution controls on Approvals initially.
- Notifications need pagination/windowing before use here.

### Cleared

- New windowed plan projection over `done` and `canceled` is required.
- Outcome comes from plan kind plus progress/reel/event terminal facts.
- Cost is blocked on the spend ledger. Before then show status and time without a cost column, or mark cost “not tracked” for legacy rows. Never render `$0.000` merely because no row was found.

### Approvals blast radius

- `schema.ts` plan indexes/optional cancellation fields;
- `cockpit.ts` state machine and scheduler race logic;
- delivery terminals if progress counters are added;
- workspace cards, because they render the same plan states;
- app shell rail badge and route;
- audit event/type tests, redaction scans, tenant isolation, scheduling tests, cockpit e2e.

## 8.2 Finance — `/dashboard/finance`

### Budget rails

| Tile | Authoritative source | Gap |
|---|---|---|
| Reasoning & drafting remaining | rate limiter via `remainingDailyCents` | New tenant wrapper; disclose that it is the tighter of tenant/deployment windows or return both |
| Media remaining | `mediaRemainingCentsInner` / `media.jobEstimate` | New tenant summary wrapper |
| Folder ingest remaining | `ingestRemainingCentsInner` | New tenant summary wrapper; current cap is $25/day, not the mock's $1 |
| Deployment ceilings | three global rate-limit windows | Owner-only; show separately, not as one fabricated combined cap |

The page must say “cost console,” not finance/revenue accounting. There is no income, invoice, bank, or cash-position substrate today.

### Where it went / daily chart

- Media 30-day aggregate can reuse the logic in `media.spendForPeriod` after it becomes tenant-safe and indexed.
- All-rails history is **blocked** until `spendEvents` is live.
- Historical coverage begins on the deployment date of `spendEvents`; no retroactive precision.
- Chart buckets use tenant timezone, but enforcement windows currently reset in UTC. The UI must label that distinction.

### Job ledger

- Reuse `mediaJobs` projections without asset storage IDs or signed URLs.
- Paginate by tenant + createdAt.
- Show actual cost only when `actualCents` exists; otherwise show **unlanded** with status/failure reason.
- Preserve the current 2× TTS reservation explanation and whole-batch rounding caveat.

### Controls

- Master and media kill switches are deployment-global. They are owner-only and must say they affect every tenant/action covered by the switch.
- Add owner mutations wrapping the existing config writer; do not expose internal mutations directly.
- Validate per-request budget bounds server-side. Display the currently stored global value and updated time.
- Every change writes an owner audit event with old/new numeric/boolean values only.
- Use confirmation for kill switches and show the effective state returned by the server, not an optimistic toggle.

### Finance blast radius

- new `spendEvents` write path at every cost rail;
- rate limiter reconciliation tests;
- media/folder settlement and refund logic;
- global owner authorization;
- retention/storage growth and paginated chart reads;
- existing Ops metrics, because their incomplete cost labels must not conflict with Finance.

## 8.3 Content — `/dashboard/content`

### Filters and counts

The library is a union, not one table:

- standalone documents/posts/research/memos: `vaultDocuments`;
- rendered reels: `plans` + render proof + storage;
- sent email: `requests` grouped by `planId` where possible.

Counts must come from maintained/indexed summaries. Do not concatenate three unbounded client arrays and count them in React.

### Artifact cards

| Action | Current readiness | Required behavior |
|---|---|---|
| Open/read | Adapter | Reuse the Vault preview through `content.artifactById` or a shared by-id vault projection |
| Download document | Ready per vault doc | Tenant-checked signed URL, minted on demand |
| Play/download reel | Adapter | New tenant-safe reel projection; valid sidecar required |
| Refresh research | Backend gap | Re-enter the originating cockpit thread or stage a new research request; needs stored provenance |
| Reuse | Undefined in backend | Decide whether this means copy to a new cockpit prompt, duplicate a draft, or attach to email; do not ship an ambiguous button |
| Open canvas | Adapter | Deep-link the originating media plan/thread |
| Promote to reference | Backend gap with prepared schema | Patch `origin` to `agent_promoted`, call ingest exactly once, show processing, preserve provenance |

### Sent mail

- Build a projection grouped by plan where possible, with subject, recipient count, terminal counts, sent time, and feedback summary.
- Avoid returning full recipient addresses unless a detail drawer is opened; the list can say `N recipients`.
- Feedback reads must be tenant-scoped and batched, not one `myFeedback` subscription per row.
- Existing legacy `/requests` stays reachable but is not the data contract for this page.

### Grounding safety

- Agent-authored artifacts stay excluded from grounding until explicit promotion.
- The Content page may search agent-created artifacts by title/provenance without inserting them into RAG.
- Promotion is a trust-boundary event and should display what changes: agents may cite this artifact after processing.

### Content blast radius

- optional vault provenance fields and write sites;
- vault search/browse projections and promotion ingestion;
- media plan listing and signed URLs;
- request/feedback aggregation;
- shared preview component boundaries;
- storage retention and delete behavior.

## 8.4 Reports — `/dashboard/reports`

### Period filters

- 7d/30d/90d sends absolute `[sinceMs, untilMs)` args.
- Server clamps the allowed maximum window and row limits.
- All cards display the same resolved window and timezone.

### Business diagnosis

- Source: bounded `evaluations.by_tenant` history plus the latest Growth-OS row.
- Define “gate status” from the latest Growth-OS scorecard/gaps, not by merging unlike frameworks.
- Use stored `delta` only where it exists. For on-demand rows without delta, calculate comparison only between explicitly comparable consecutive Growth-OS snapshots.
- A gap is “closed” only when its stable identity (`route/playbook`) disappeared in a later comparable evaluation. `actOnGap` alone does not close it.
- Proof metric comes from stored gap data; absent stays blank.
- Findings/citations remain content-plane. Summary counts may be returned; full prose should be loaded on demand.

### Blueprint and vault coverage

- `blueprint.blueprintState` is ready for current confirmation/staleness state.
- Mock “18 of 22 fields” needs an explicit pure-core completeness function; do not count object keys ad hoc in React.
- `vault.vaultStats` gives bounded six-category browse stats, not legal/financial/offer semantic coverage. The mock's semantic coverage chips require a real mapping from `docType`/blueprint sections and honest handling of unclassified/legacy documents.

### Operations

- `opsSignals.evalSignals` provides request/review/fallback/DLQ counts but documents important limitations: cockpit reasoning cost is zero and decision counts are legacy-pipeline only.
- Sends-per-day needs a windowed telemetry/request series.
- Approval rate must use a named numerator/denominator that covers the intended lanes; do not relabel `reviewOutcomes` without validating the coverage.
- Feedback needs tenant-scoped aggregation.
- Median/p95 turn duration can derive from terminal `agentSteps` or telemetry only after the population is defined. Missing terminal timestamps are excluded and counted as incomplete.

### Governance record

- Add `reports.governance` as a paginated tenant query over `audit.by_tenant_ts`.
- Return only:
  - timestamp;
  - normalized event type;
  - normalized actor label;
  - correlation ID/reference;
  - an allowlisted flat array of `{key,value}` where value is string/number/boolean/null/string[].
- Reject/drop nested objects and content-like keys server-side, log a code-only invariant violation, and never serialize the raw payload to the client.
- Event types are currently free strings and the canonical `packages/audit` taxonomy is incomplete relative to production events. Reports work must first generate an inventory and either widen the canonical taxonomy or explicitly support an `unknown` label.

### WORM and skills

- WORM cursor health is deployment-global and owner-only. Cursor timestamp alone proves progress, not S3 durability; label it “last cursor advance.” The existing manual Object Lock deletion test remains the durability proof.
- Active skills are deployment-global and owner-only. Add an owner projection of name/version/status/gated only; never return prompt bodies.
- Non-owners either do not see these cards or see a generic “governance managed by your operator” state.

### Board pack

- Reuse the governed document/PDF render helpers, but define an immutable report input snapshot first so the PDF cannot mix data from different reactive moments.
- `generateBoardPack({sinceMs,untilMs,timezone})` should:
  1. read bounded projections;
  2. create a content-plane report artifact with source timestamps and coverage caveats;
  3. render/store PDF;
  4. return a tenant-safe artifact ref;
  5. audit only report ID, window, section counts, and render result.
- Generated board packs remain agent-authored/non-groundable until the user promotes them.

### Reports blast radius

- evaluation semantics and pure-core calculations;
- telemetry/feedback aggregation;
- audit privacy boundary and taxonomy;
- owner-only global operations data;
- PDF render/storage path;
- large-window performance and export retention.

## 8.5 Sales Pipeline — `/dashboard/pipeline`

**Current status: Blocked. Keep Soon.**

The current schema has no durable contacts, leads, opportunities, consent evidence, unsubscribe state, suppression list, pipeline stage, value, next step, or postal address. Gmail name resolution deliberately does not persist a contacts cache.

Before any real pipeline page:

1. Complete the Phase 19 design and plans.
2. Decide the minimal product model. The existing roadmap says scoped contact/CRM and follow-ups, not a full deal-stage CRM; the mock's opportunity stages/value widen that scope and need owner approval.
3. Put suppression in the send path before adding outreach actions.
4. Add tenant isolation, consent export, and CAN-SPAM footer tests.
5. Define pipeline currency separately from provider cost USD.
6. Add data import/dedup rules and deletion/export behavior.

Until those are true, render only the disabled navigation item. Do not ship a page of dashes as if it were connected.

## 8.6 Command Center v2 — `/dashboard`

Implement this last. It is a roll-up of the other contracts and should not create parallel definitions of their metrics.

### Recommended next move

Add a pure, tested priority function in `@pikar/core`, fed by `home.summary`. Recommended initial priority:

1. authentication/connection failure blocking execution;
2. unresolved high-severity dead letter;
3. stale awaiting approval;
4. scheduled item at risk;
5. open diagnostic question blocking evaluation;
6. latest binding business constraint;
7. open workspace.

Every recommendation returns a code-owned label, reason code, target route, and supporting timestamp/count. User content is not interpolated into the recommendation unless it comes from a tenant content-plane projection intended for display.

### Binding constraint

- Use the latest comparable Growth-OS evaluation.
- If insufficient or absent, say that. Do not choose a gate from stale or unlike frameworks.
- **See diagnosis** deep-links to the originating evaluation thread.

### Stats

- Held approvals: `approvals.summary`.
- Spend today: `finance.summary`, after the spend ledger; before then show remaining allowances, not fabricated spend.
- Delivered 30d: reports/operations summary with an exact definition.
- Artifacts made: content summary with types and coverage window.

### Latest briefing

- Add `briefings.latestForTenant` via a tenant/createdAt index.
- Return a bounded projection of the latest row.
- Buttons initially open the owning cockpit thread. If their labels promise one-click actions such as **Propose 3 times**, they need explicit staged cockpit commands and must not silently perform writes.

### Health banner

Build `home.health` from:

- Gmail connected/reauth state;
- Drive-ready state;
- vault failed/pending/capped state;
- unresolved DLQ count;
- relevant global kill-switch state for owners.

“Nothing is blocked” is rendered only when all required signals are successfully loaded and healthy. A failed health query is **Unknown**, never Healthy.

### Command Center blast radius

- current dashboard replacement;
- shared summary contracts from all preceding pages;
- priority algorithm and deep links;
- app-shell health/banner interactions;
- no duplicate counting across legacy and cockpit request lanes.

## 8.7 Knowledge Vault redesign — `/dashboard/vault`

This is one route with four states: browse, inside-folder, preview, and empty.

### What is already connected

- Refresh/re-subscribe behavior;
- bounded vault stats with capped honesty;
- six category filters;
- file upload, folder preflight/reservation/upload, brain dump;
- Drive browse/import;
- hybrid search;
- grid/list toggle;
- folder drill-in and sealed-folder behavior;
- status, origin, and document-type chips;
- extraction retry and folder cancel;
- preview text/media/entities;
- document identity edit;
- download, delete, discuss by voice, and open workspace.

### Browse state mapping

| Design change | Current file(s) | Backend impact | Decision |
|---|---|---:|---|
| Remove teal canvas aura | `globals.css`, `vault/page.tsx` | None | Scope styles to vault so cockpit keeps `.pane-canvas` aura |
| Teal only for actions/active tab | `page.tsx`, `CategoryTabs.tsx`, `DocGrid.tsx`, Dropzone/Drive controls | None | Replace teal document glyphs/toggles with neutral/semantic palettes |
| Soft semantic stat badges | `VaultStats.tsx`, `globals.css` | None | Preserve labels and capped values |
| Document-type colour/glyph | `DocGrid.tsx`, `icons.tsx` | None | Map from machine `docType`/MIME; unclassified stays neutral |
| Eyebrow/subtitles | `page.tsx`, `VaultStats.tsx` | Optional counts | Add only claims supported by the returned stats |
| Category counts | `CategoryTabs.tsx` | Yes for exact totals | Omit initially or add maintained counters; never use bounded current-page counts as totals |
| Agent chip | `DocGrid.tsx` | None | Preserve existing `origin !== undefined` provenance behavior |

### Inside-folder state

- Current breadcrumb already replaces category tabs and shows folder/digest state.
- Upload remains absent because sealed folders accept no new members.
- Search placeholder and scope should say **Search this folder**; current `vaultSearch` only accepts category, not folder. The existing client query passes category even inside a folder, so true folder-scoped server search is a gap. Add optional `folderId` to the action and enforce the same sealed-membership predicate, or clearly state that search is unavailable inside a folder.
- Preserve folder digest rebuild controls and live counters even if the mock does not show them.

### Preview state

- The current preview is richer than the mock: document identity editing, detailed failure copy, voice discussion, and open-workspace actions are shipped product behavior.
- Redesign the container/palette without removing those controls.
- Download remains tenant-checked and on-demand.
- Delete must keep confirmation/busy/error behavior and cascade rules from the existing mutation.
- “Embedded—agents can cite this” is shown only when status/ingest proof supports it; `ready` alone is not sufficient for intentionally non-grounded agent artifacts.

### Empty state

- Current queries already return honest zero/bounded states.
- Preserve upload, folder, Drive, and brain-dump actions.
- Do not show Drive import as ready when the Google connection predates Drive scope; reuse `driveReady`/reauth copy.
- Empty means a successful empty query. Loading or query failure must not render the empty-vault promise.

### Vault mock contradictions to resolve before pixel work

1. The mock claims category counts and subtitles are already shipped; they are not.
2. The mock claims document-type colour already maps the cards; current document glyphs are mostly the same teal file icon and type chips are neutral.
3. The mock preview omits current controls; implementation must be additive/palette-only, not destructive.
4. Exact totals conflict with the current bounded-read safety contract. The production UI must preserve `capped` honesty.
5. The design calls the current vault teal canvas a problem; `.clay-card` comments say its glass treatment depends on that aura. Removing the aura requires retuning card opacity/border/shadow together, not only deleting the background gradient.

### Vault blast radius

- primarily `globals.css` and vault components;
- shared `.pane-canvas`/`.clay-card` classes must be scoped to avoid changing cockpit/media cards;
- visual regression at desktop/tablet/mobile;
- accessibility contrast and focus;
- optional counter/index work if exact tab totals are approved;
- folder-scoped search if the mock's inside-folder search is required.

## 9. Cockpit and navigation integration

- Add real nav links only when their page's minimum backend contract is live and verified.
- Approvals badge uses the same summary query as the page.
- Every **Open in cockpit**, **Revise**, **Edit blocks**, **Open canvas**, and diagnosis link carries `thread=<threadId>`.
- A deep link that merely opens a thread must not use action wording such as **Send**, **Create**, **Refresh**, or **Propose**.
- Pages must not bypass the cockpit's approval spine. New external writes remain staged plans executed by `cockpit.executePlan` or an explicitly reviewed equivalent.
- Shared plan cards should be extracted only where it genuinely prevents state/label drift; do not make the queue import the entire workspace card stack if a smaller typed projection is safer.

## 10. Failure and observability map

| Failure | Required visible outcome | Required record |
|---|---|---|
| Query loading | Skeleton/loading, not zero | None |
| Query failed | Error + retry; unaffected sections stay usable | Code-only client/server diagnostic |
| Capped list | “Showing newest N / load more” | None |
| Stale approve/discard | Already started/resolved message and refreshed row | Existing/new plan audit only on real transition |
| Scheduler won race | Move to In Flight; never claim rescheduled/canceled | Existing delivery/audit chain |
| Media refusal | Named lever; plan remains proposed; no jobs/spend if pre-reserve refusal | Existing governed refusal/audit rules |
| Calendar conflict | Keep proposed; show conflict and change-time path | Refs/time/counts-only event if recorded |
| Spend data absent | “Tracking began …” / unknown, never $0 | None |
| Audit row violates safe projection | Omit unsafe payload details, show event shell, alert operator | Code-only invariant notification/log |
| Signed URL unavailable | Retry or “original unavailable”; no broken link | No URL in logs |
| Owner-only query as non-owner | Hide/managed-by-operator state | Server rejects direct call |
| External reauth needed | Connection CTA; no action starts | Existing notification/DLQ where applicable |

## 11. Verification gates

### Backend tests for every new surface

- authenticated happy path;
- unauthenticated failure;
- cross-tenant guessed-ID failure;
- pagination boundary and stable ordering;
- empty result vs error;
- max-window/row clamp;
- no content/PII in audit, telemetry, DLQ, or server logs;
- idempotent mutation/double click;
- concurrent stale-state/CAS behavior;
- capped/read-budget behavior;
- expected governed refusals.

### Specific mutation tests

- Proposed discard cannot be re-opened by scheduled reschedule.
- Cancel/reschedule race cannot double-send or claim a moved schedule after fire.
- Calendar change time cannot edit another kind/status and must recheck availability.
- Promotion starts ingestion once and never makes an unpromoted agent artifact groundable.
- Kill switches and global controls reject non-owners server-side.
- Every spend limiter movement has the matching `spendEvents` movement and correct refund/reconciliation.
- Audit viewer cannot return a nested/content-like injected payload even if a bad row is inserted in a test.

### Frontend/component tests

- loading, empty, error, partial, busy, refusal, owner/non-owner;
- labels derived from actual status/kind;
- no hard-coded counts, dates, costs, or timezones;
- keyboard order, dialog focus trap, destructive confirmation;
- mobile tables become labelled cards or horizontal regions without hiding actions.

### Browser/UAT scenarios

1. One email, media, calendar, and memo plan appear in Approvals and open the correct cockpit thread.
2. Double-approve sends/starts once.
3. Scheduled email is moved and canceled without a duplicate send; a deliberately raced fire reports honestly.
4. Finance current allowances match operator reads; a controlled spend appears once in the ledger and correct bucket.
5. Content opens/downloads each artifact kind; promotion changes grounding only after processing.
6. Reports period filters change every section consistently; governance rows reveal no content.
7. Non-owner cannot call global finance/WORM/skills endpoints.
8. Vault browse, folder, preview, empty, loading, failed extraction, capped vault, and Drive-reauth states match the redesign without losing shipped controls.
9. Command Center recommendations change deterministically as blockers are cleared.
10. Two-tenant run proves every new table/index/query remains isolated.

## 12. Implementation sequence

### Wave 0 — Freeze contracts and correct mock assumptions

- Approve this document.
- Decide direct calendar time edit vs cockpit-only revise.
- Decide exact-tab counters vs honest bounded totals in Vault.
- Decide what Content **Reuse** means.
- Decide whether Phase 19 remains scoped follow-up CRM or widens to opportunities/value.
- Add route/API response types and pure-core calculation tests before JSX.

### Wave 1 — Shared backend foundations

- plan indexes/cancellation provenance;
- bounded query helpers/pagination conventions;
- safe audit projection contract;
- `spendEvents` schema and write instrumentation;
- tenant timezone fallback decision and USD copy rule.

No pending-page nav item becomes live in this wave.

### Wave 2 — Knowledge Vault redesign

- Scope neutral paper canvas and card changes to Vault.
- Add semantic badge/glyph mapping.
- Preserve all existing controls/states.
- Add folder-scoped search only if approved.
- Add exact counters only if their backend contract is built first.

This is the lowest dependency surface and can ship independently after its visual regression gate.

### Wave 3 — Approvals end to end

- read models and badge;
- discard/reschedule/change-time decisions;
- progress aggregation;
- page and cockpit deep links;
- isolation/scheduler/UAT gates;
- only then enable the nav item.

### Wave 4 — Finance instrumentation and page

- deploy spend ledger instrumentation first;
- reconcile controlled live transactions;
- let real history accumulate;
- ship current rails/owner controls;
- enable historical charts only for the tracked period.

### Wave 5 — Content library

- artifact provenance and unified projections;
- download/open/play;
- promotion;
- explicit reuse/refresh semantics;
- sent-mail projection.

### Wave 6 — Reports

- business/operations projections;
- safe governance viewer;
- owner-only WORM/skills cards;
- board-pack snapshot/render;
- period-consistency and privacy gates.

### Wave 7 — Sales Pipeline / Phase 19

- Complete the Phase 19 plan and backend first.
- Add the pipeline UI only after suppression and consent are in the send path.

### Wave 8 — Command Center v2

- Compose stable summaries from Waves 3–7.
- Add deterministic recommendation/health logic.
- Replace current four-tile dashboard.

## 13. Release strategy

- Use route-level feature flags or keep nav entries **Soon** until backend and UI are deployed together.
- Deploy additive schema/index changes before functions that require them.
- Deploy spend instrumentation before historical Finance UI and mark the coverage start.
- Do not rename/remove existing APIs in the first release; add page adapters, migrate callers, then retire legacy surfaces separately.
- Roll out owner-only governance/finance controls to the owner account first.
- Keep the legacy `/requests` and `/review` routes reachable until the new Approvals and Content views have passed live UAT; they need not remain in nav.
- Each page gets an explicit rollback: disable route/nav without rolling back additive data instrumentation.

## 14. Definition of done

A page is not done because it matches the mock. It is done only when:

1. every displayed fact has a named authoritative source;
2. every control reaches a guarded, idempotent terminal;
3. tenant/global authorization is enforced server-side;
4. loading, empty, error, capped, stale, and refusal states are visible;
5. no content or PII crosses into audit/telemetry/DLQ/log projections;
6. list queries are bounded and production-scale behavior is named;
7. costs distinguish estimate/reserve/actual/refund/unlanded;
8. cross-tenant and concurrent-action tests pass;
9. browser UAT proves the real backend connection, not seeded static JSX;
10. deferred gaps remain attached to their owning roadmap phase and are not represented as live UI.

## 15. Owner decisions required before implementation

1. **Calendar:** Should Approvals edit staged event time inline, or route all revisions back through the cockpit? Recommended first release: cockpit revise; add inline edit only if speed justifies the additional availability/CAS contract.
2. **Vault counts:** Do category tabs need exact totals? Recommended first release: preserve bounded/honest totals and omit exact per-tab counts until counters exist.
3. **Content Reuse:** Does reuse mean prefill a cockpit request, attach the artifact to a new email plan, or duplicate it as a new artifact? Recommended: prefill/open cockpit; no silent duplication.
4. **Sales Pipeline scope:** Keep Phase 19 as contacts/follow-ups/consent, or widen it to opportunities, stages, and monetary pipeline value? Recommended: keep the narrower Phase 19 scope first.
5. **Global operations visibility:** Should non-owner tenants see generic system health while WORM/skill/deployment budgets remain owner-only? Recommended: yes.

## 16. Existing source-of-truth map

This is the concrete code surface the implementation must preserve or adapt.

### Frontend

- Authenticated shell, navigation, onboarding gate, badges: `apps/web/app/(app)/layout.tsx`
- Existing Command Center: `apps/web/app/(app)/dashboard/page.tsx`
- Cockpit route and thread deep links: `apps/web/app/(app)/dashboard/workspace/page.tsx`
- Plan, scheduled, canceled, report, briefing, evaluation, source, and output cards: `apps/web/app/(app)/dashboard/workspace/cards.tsx`
- Media estimate/editor/reel status: `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx`
- Compliance/dead letters/owner optimizer surface: `apps/web/app/(app)/ops/page.tsx`
- Legacy request/review surfaces: `apps/web/app/(app)/requests/page.tsx`, `apps/web/app/(app)/review/`
- Vault composition: `apps/web/app/(app)/dashboard/vault/page.tsx`
- Vault stats/categories/grid/folder/preview/ingest/Drive: `VaultStats.tsx`, `CategoryTabs.tsx`, `DocGrid.tsx`, `FolderBreadcrumb.tsx`, `PreviewModal.tsx`, `Dropzone.tsx`, `PreFlight.tsx`, `DriveBrowser.tsx`
- Shared tokens, rail, canvas, clay cards: `apps/web/app/globals.css`

### Backend and data plane

- Tenant/owner authorization wrappers: `packages/backend/convex/lib/functions.ts`, `owner.ts`
- Tables/indexes: `packages/backend/convex/schema.ts`
- Plan storage/read adapters: `plans.ts`
- Approve/schedule/cancel/reschedule and action dispatch: `cockpit.ts`
- Delivery rows and legacy list/review reads: `requests.ts`, `deliverApprovedPlan.ts`
- Calendar staging terminal: `calendar.ts`, `calendarComplete.ts`
- Media estimate/jobs/reconciliation/render: `media.ts`, `mediaComplete.ts`, `render/renderReel.ts`
- Budget enforcement: `guardrails.ts`
- Terminal telemetry/ops projections: `telemetry.ts`, `opsSignals.ts`
- Evaluation/gap/memo plane: `evaluations.ts`, `proactiveReview.ts`, `blueprint.ts`
- Vault documents/folders/search/digest/Drive/extraction: `vault.ts`, `vaultFolders.ts`, `vaultDigest.ts`, `vaultDrive.ts`, `vaultSweep.ts`
- Created-artifact source cards/provenance seam: `vaultSources.ts`, `vault.ts`
- Notifications and dead letters: `notifications.ts`, `deadLetters.ts`, `deadLetter.ts`
- Audit/WORM: `audit.ts`, `worm.ts`, `wormCursor.ts`, `crons.ts`
- Feedback and skills: `feedback.ts`, `skills.ts`, `optimizerConfig.ts`
- Redaction-safe audit type: `packages/contracts/src/audit.ts`
- Current cost model: `packages/cost/`

### Decision and operational records

- Convex orchestration: `docs/decisions/001-convex-data-orchestration-plane.md`
- Insert-only audit/WORM: `docs/decisions/002-insert-only-audit.md`
- Vault trust/retrieval: `docs/decisions/ADR-006-vault-chunks-trusted-as-own.md`
- Governed media/render: `docs/decisions/011-*`, `012-*`, `013-*`
- Operational invariants: `docs/playbooks/cockpit.md`, `guardrails.md`, `media.md`, `vault.md`, `audit-dead-letter.md`, `business-evaluation.md`
- Sales/consent owner: `.planning/ROADMAP.md` Phase 19 and `.planning/REQUIREMENTS.md` ACTN-05
