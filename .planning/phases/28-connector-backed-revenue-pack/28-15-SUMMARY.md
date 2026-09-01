---
phase: 28-connector-backed-revenue-pack
plan: 15
subsystem: revenue-telemetry
tags: [revenue, telemetry, privacy, bounded-metrics, convex, shared-event-plane]
requires:
  - phase: 27-workflow-packs
    provides: Append-only workflowPackEvents plane and bounded operational-signal projection patterns
  - phase: 28-connector-backed-revenue-pack
    provides: Connector lifecycle, revenue workflow, finance, reminder, and activation contracts from plans 28-09 through 28-20
provides:
  - Closed content-free revenue outcome vocabulary on the existing shared event plane
  - Tenant-scoped bounded projections for availability, completion, recovery, finance coverage, cost, and latency
  - Recursive privacy, isolation, idempotency, retention, cardinality, and partial-window regression guards
affects: [28-21, 28-29, 28-16, 28-27]
tech-stack:
  added: []
  patterns: [single shared append-only event plane, canonical-owner metric joins, explicit partial-window reasons]
key-files:
  created:
    - packages/backend/convex/revenueTelemetry.ts
  modified:
    - packages/backend/convex/workflowPackEventLog.ts
    - packages/backend/convex/opsSignals.ts
    - packages/core/src/workflowPackMetrics.ts
    - docs/playbooks/revenue-connectors.md
key-decisions:
  - "Revenue outcomes reuse workflowPackEvents; no second telemetry table or parallel analytics plane exists."
  - "Revenue event rows never carry cost or latency; projections join spendEvents and agentSteps as canonical owners."
  - "Recovery is counted only from a later paid/resolved provider observation and is never attributed causally to drafting, approval, or sending."
patterns-established:
  - "Every revenue event is tenant-scoped, idempotent by tenant/run/event, and restricted to closed enums, opaque refs, bounded counts, booleans, and timestamps."
  - "Every bounded report exposes denominators and labels retention, event-cap, and join-cap incompleteness explicitly."
requirements-completed: []
requirements-blocked: [REVN-04, REVN-05, REVN-06]
duration: 51min
completed: 2026-09-01
---

# Phase 28 Plan 15: Privacy-Safe Revenue Outcome Measurement Summary

**A closed revenue event stream on the existing shared plane now projects tenant-scoped outcome metrics without storing customer content, financial amounts, provider payloads, cost, or latency in event rows.**

## Performance

- **Duration:** 51 min
- **Started:** 2026-09-01T10:30:11Z
- **Completed:** 2026-09-01T11:21:10Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments

- Extended the Phase 27 shared `workflowPackEvents` plane with the minimum closed revenue vocabulary and one shared insert primitive; no second table or analytics plane was created.
- Added bounded tenant projections for connector availability/read completion, follow-up completion, later-observed recovery, response handling, finance coverage/confidence, workflow cost, and workflow latency.
- Locked the boundary with recursive forbidden-field scans, tenant-isolation tests, duplicate/reordered-event guards, a 90-day retention clamp, a 500-event cap, a 25-run canonical join cap, and explicit incomplete-window reasons.
- Documented the vocabulary, allowed fields, recovery semantics, dashboard limitations, canonical metric owners, and disable/rollback procedure.

## Event Allow-List

| Event | Meaning | Bounded event-row fields |
|---|---|---|
| `connector_lifecycle` | A provider connection reached a lifecycle terminal. | `provider`, closed lifecycle `status` |
| `connector_read` | A bounded normalized provider read ended. | `provider`, `ready\|partial\|unavailable`, optional counts/coverage flags |
| `workflow_completed` | A revenue workflow reached a terminal. | closed `workflow`, closed `outcome`, optional evidence/source counts |
| `finance_computed` | Deterministic finance computation completed. | closed `workflow`, `coverage`, `confidence`, counts, `hasGap` |
| `reminder_staged` | An ordinary invoice-reminder plan was staged. | `revenue-invoice-reminder`, invoice-ref count |
| `plan_decided` | A staged plan was approved, edited, or rejected. | closed decision `status`, opaque plan/run refs |
| `recovery_observed` | A later normalized provider read observed an overdue item paid/resolved. | `provider`, opaque subject ref, `paid\|resolved`, `observedAt` |

All event rows are limited to tenant id, the `revenue` stream id, server/code-shaped opaque refs,
closed provider/workflow/status/outcome/coverage/confidence enums, bounded non-negative integer counts,
booleans, and timestamps. Customer names, emails, messages, descriptions, amounts, currencies,
credentials, tokens, raw payloads, cost, latency, and duration fields are structurally refused.

## Privacy Scan

- The shared write-boundary tests inject forbidden fields recursively and require both the mutation to reject and the event table to remain empty.
- Stored-row scans reject content-shaped key names and bound every string leaf.
- Projection scans recursively allow only numeric/boolean/null leaves plus the closed labels `ratio`, `not_applicable`, `no_data`, `zero_denominator`, `retention_boundary`, `event_cap`, and `join_cap`.
- Tenant-isolation tests cover events and the canonical `spendEvents`/`agentSteps` joins independently; another tenant receives an empty report and no derived cost or latency.

## Metric Semantics

| Measure | Numerator / fact | Denominator / limitation |
|---|---|---|
| Connector availability | connected lifecycle terminals | all connector lifecycle terminals |
| Connector read completion | ready or partial reads | all normalized connector reads |
| Follow-up completion | approved reminder plans | staged reminders/workflow completions after idempotent folding |
| Overdue recovery | distinct opaque items later observed paid/resolved | eligible staged overdue refs; backward observations do not count |
| Response handling | delay from staged reminder to later decision | only pairs with both timestamps; unmeasured pairs remain unknown |
| Finance quality | computation counts by closed coverage/confidence labels | no invoice values or currency totals are aggregated |
| Workflow cost | summed reasoning cents from tenant-owned `spendEvents` | `runsPriced` and `runsJoined`; missing ledger facts are unknown, not zero |
| Workflow latency | span of complete tenant-owned `agentSteps` | `runsMeasured` and `runsJoined`; open/incomplete traces are unknown |

The report defaults to 30 days and clamps to 90 days. It reads at most 500 events and joins at most
25 workflow runs. `retention_boundary`, `event_cap`, and `join_cap` make incomplete windows explicit.
Recovery is an observation metric: it does not claim that a draft, approval, reminder, or Pikar
workflow caused payment.

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @pikar/backend test -- revenueTelemetry telemetry opsSignals` | **31/31 passed** across 2 files |
| `node scripts/check-playbooks.mjs` | **passed** (silent) |

## Task Commits

1. **Task 1 RED: shared-plane revenue contract tests** — `4f28d3b`
2. **Task 1 GREEN: bounded shared-plane revenue outcomes** — `ce17383`
3. **Task 2 RED: bounded revenue signal projection tests** — `affbd22`
4. **Task 2 GREEN: tenant-scoped revenue success measures** — `6501b88`
5. **Task 3: privacy boundary and operations guide** — `452cfb9`

## Files Created/Modified

- `packages/backend/convex/revenueTelemetry.ts` — thin revenue adapter to the shared recorder.
- `packages/backend/convex/revenueTelemetry.test.ts` — closed vocabulary, idempotency, recovery, bounded-ref/count, and recursive privacy tests.
- `packages/backend/convex/workflowPackEventLog.ts` — sole insert primitive and revenue-field validation.
- `packages/backend/convex/schema.ts` — bounded additive fields on the existing shared event table.
- `packages/backend/convex/opsSignals.ts` — tenant-scoped bounded report and canonical-owner joins.
- `packages/backend/convex/opsSignals.test.ts` — metric semantics, tenant isolation, retention, caps, and recursive output scan.
- `packages/backend/convex/workflowPackOutcomes.ts` — canonical cost/latency join helpers and run cap.
- `packages/core/src/workflowPackMetrics.ts` — pure idempotent revenue metric projection.
- `packages/core/src/workflowPackMetrics.test.ts` — duplicate/reordered recovery and projection semantics.
- `packages/core/src/workflowPacks.test.ts` — shared vocabulary contract update.
- `docs/playbooks/revenue-connectors.md` — event allow-list, privacy rules, metric limits, and rollback procedure.

## Decisions Made

- Reused the existing append-only shared event plane and kept `revenueTelemetry.ts` as a thin adapter.
- Kept cost and latency out of event rows; the report joins only the canonical tenant-owned spend and step tables.
- Counted recovery only after a later provider read observes `paid` or `resolved`, deduplicated by opaque item ref.
- Kept REVN-04, REVN-05, and REVN-06 pending: this plan measures their outcomes but cannot make parked provider/workflow capabilities available.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added the minimum bounded shared-plane extension**
- **Found during:** Task 1 (shared event-plane reuse)
- **Issue:** The landed Phase 27 table and pure metric contract did not yet accept the closed revenue stream, so the adapter could not reuse the sole recorder without extending its bounded union.
- **Fix:** Added only the revenue stream/event enums, optional bounded fields, validation, and pure projections to the existing schema/recorder/core metric modules. No second table, dependency, or generic connector runtime was introduced.
- **Files modified:** `schema.ts`, `workflowPackEventLog.ts`, `workflowPackMetrics.ts`, and their contract tests.
- **Verification:** Targeted telemetry and signal suite passed 31/31; recursive field-refusal tests passed.
- **Committed in:** `ce17383` (Task 1 GREEN)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The extension was the smallest change that preserved the mandated single shared event plane and privacy boundary.

## Issues Encountered

- The continuation began with unrelated dirty schema, generated API, agent-runtime, graphify, and revenue-playbook edits. Task 3 staged only `opsSignals.test.ts` plus the isolated 28-15 playbook hunks; all unrelated changes remain untouched and unstaged.
- The sandbox initially refused the Git index write for partial staging. The exact same reviewed hunks were staged with repository-index approval; no working-tree content changed during the failed attempt.

## User Setup Required

None. No deployment, provider operation, paid evaluation, or external mutation ran.

## Next Phase Readiness

- Plan 28-21 can wire connector and workflow terminals to the closed event adapter.
- Plan 28-29 can wire plan decisions and later observed recovery without inventing causal attribution.
- REVN-04/05/06 remain pending until their parked provider/workflow capabilities have new evidence and activation decisions.

## Self-Check: PASSED

- Summary and all five plan-listed implementation/playbook files exist.
- Task commits `4f28d3b`, `ce17383`, `affbd22`, `6501b88`, and `452cfb9` exist.
- Event allow-list, recursive privacy scan, metric semantics, requirements blockers, and verification results are recorded above.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-01*
