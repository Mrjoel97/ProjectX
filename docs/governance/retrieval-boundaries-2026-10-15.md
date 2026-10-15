# Retrieval boundary inventory — 2026-10-15

Scope: production Convex `.collect()` callsites, request-facing histories and nested reads beneath actions/workers. Tests, schema comments and explicitly isolated smoke harnesses are excluded from production risk counts. This is a local implementation inventory, not deployed load-test evidence.

## Replaced unbounded histories

| Surface | Current boundary and completeness contract |
| --- | --- |
| Requests and review queue | Tenant/time or tenant/status/time cursor pages;25 initial,100 maximum per transaction. Load more exposes complete history. Legacy list100. |
| Goals / Blueprint / agenda | UI cursor pages50, server100; Blueprint uses exact earliest3 dated active goals ordered targetDate then createdAt. Agenda resolves one goal by tenant/status/segment. Legacy list100 per status. |
| Research reuse | Exact tenant/questionHash/createdAt index, first matching result. No full document-history scan. |
| Registry and pack candidate/rollback selectors | Name/version or name/status/version descending first row. Active row remains exact unique lookup. Inspector versionCount is a1000-row lower bound with versionCountCapped. |
| Document graph preview |256 edges plus one overflow probe; preview explicitly discloses truncation. |
| Document graph deletion / revision replacement |128 edges per mutation, durable continuation; shared-node degree accounting and orphan cleanup. Revision replacement remains content-hash guarded. |
| Drive refresh | Exact tenant/driveFolderId index. Folder member ingestion remains its existing paged worker. |
| Media canvas / render assembly | Latest indexed row per current block/kind; render selects succeeded rows. Immutable old attempts cannot enlarge the read. Deck lookup rejects more than103 slot indexes; batch/active status readers refuse more than100 rows per batch/status. |
| Media retry / caption selection | Latest createdAt or exact STT slot/kind lookup. No full plan history. |
| Media financial reconciliation |500-row indexed time-window pages, isDone and continueCursor. Sum actualCents and unrounded estUsd across pages, then round estimates once. Page totals are never complete-period totals until all pages are consumed. |
| Media operator history | listJobsPage100 rows. Compatibility listJobs refuses histories over1000 instead of silently returning partial money records. |
| Pin run ordinal | Internal action counts200-row audit cursor pages, retaining only count and cursor. The event discriminator remains mandatory. No automatic run or standing authorization added. |
| Optimizer eligibility | Newest1000 feedback sample with truncated flag. |
| SkillOpt export |100-row token-gated cursor pages; CI exporter follows every page and rejects repeated/invalid cursors. Existing PII scrubbing remains per row. |
| Tenant DLQ | Newest100 unresolved items;100+ badge is explicitly a lower bound; resolution reveals older rows. |
| Pending proposals, intake artifacts, demo rows | Compatibility working lists capped100; these APIs are not full data exports. |
| Pending connector consent | Exact unused/unexpired tenant index; more than100 pending states produces an explicit error rather than an incomplete count. |
| Reconnect-warning retirement |100-row durable pages; consent-time cutoff prevents delayed cleanup clearing a later incident. |
| Reliability sweep | Current media slots plus indexed live jobs; batch readers bounded100. Legacy scheduled-function probe takes1001 and conservatively treats overflow as potentially live. Audit activity probe similarly defers terminalization on overflow. Migration runner retains its checkpointed table paging. |

## Retained bounded collections

These are collections of a code-owned finite set, not histories. They remain visible here so a future expansion cannot silently invalidate the assumption.

| Callsite family | Reason the set is bounded / required review when widened |
| --- | --- |
| agenda.current and lib/agenda rowsFor | One row per closed prescription route/playbook key, upserted by tenant/key. Adding prescription vocabulary requires reassessing this bound. |
| cash.inputStatesFor | One financeInputs row per closed CASH_INPUTS field, upserted by tenant/field. Monetary totals are not truncated. |
| connectorConnections.viewFor / connectorCredentials.connectorStatuses | One credential connection per closed provider/environment pair. New providers/environments require review. |
| providerGates connectable/inspection/known-gate reads | Closed provider/environment configuration set, unique upserts. No event history in this table. |
| pinnedWorkflows pinWorkflow/listPins | One current pin per tenant/known template; changing lineage deletes its predecessor in the same transaction. Ordinary saved prompts have no templateId. |
| lib/planRow.flipParentWhenSiblingsDone and reliabilitySweep child completion | One immutable child set per root, constrained by MAX_FAN_OUT15. |
| review.fireTimeout | One request correlation's regeneration attempts, constrained by pipeline MAX_REGENERATE. Not a tenant-wide timeout scan. |

Delivery lane: new email fanout is capped at100 recipients before writes. Legacy oversized move/reschedule requests refuse explicitly. Report pages are cursor-paged (server50, UI25), preserving access to legacy reports over100 recipients; the compatibility whole-report reader rejects overflow. CRM reads use indexed per-contact due/ref lookups; suppression reads probe1001 and conservatively omit contacts when coverage is incomplete. Operations signals use at most1000 rows per source and a90-day horizon with explicit sample/partial metadata. Owner email inspection probes101 rows. Tenant deletion/auth credential walks remain the identity lane’s separate erasure audit.

Smoke-only collectors remain intentionally available for deterministic fixture assertions. They must never be promoted into production user reads. The tenant-delete test cleanup helper's full-table collection likewise belongs only to its guarded fixture path.

## Structural split and local evidence

`llm.ts` delegates research tool transport to `lib/webResearchTools.ts` and deterministic PDF rendering to `lib/markdownPdf.ts`; its existing exports remain compatibility aliases. `lib/mediaRead.ts` centralizes the current-slot, active-status and batch queries so canvas, rendering and recovery use the same bounds.

High-cardinality regression coverage:235 mixed-status requests paginated without omission or tenant leakage;520 media attempts select the current row and produce exact500+20 paged cost totals;300 graph edges disclose preview truncation and complete deletion over multiple mutations. Existing research tools, PDF, registry, Blueprint/goals, media, pin, reliability and export suites were also run locally. A101-recipient legacy report regression proves complete cursor access and foreign-plan rejection; the jsdom report test exercises Load more and retains all loaded outcomes. Full web run:1041 passed,2 skipped,2 pagination-mock failures; the corrected affected suite passes9 tests including the new pagination regression. Production index rollout and load/provider acceptance remain separate evidence.
