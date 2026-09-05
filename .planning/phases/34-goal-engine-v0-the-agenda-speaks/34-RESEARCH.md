# Phase 34 — Goal Engine v0, "the agenda speaks": research

**Source:** rev 5 system audit G13 (`.planning/design/system-audit-2026-09-03-merged.md` §4, Track B
step 6) and the design capture `.planning/design/goal-engine.md` §4 (v0). Verified against the tree at
`55d342d` (production, 2026-09-05).
**Spec restated (v0, propose-only):** a persistent, tenant-scoped agenda derived from the pinned review
thread's gap list, with per-gap lifecycle; the weekly review upgraded from "a row changed" to ONE staged
proposal via the existing `applyActOnGap` internals; the progressive interview when the top item is a
`notEnoughData` ask; goal linkage read-only. Nothing acts without approval, nothing recurs.

## What exists, checked

| Piece | Where (verified) | Used as |
|---|---|---|
| Weekly review writes an `evaluations` row on `REVIEW_THREAD_ID` every Monday (batch job since 25.3), notifies on change only | `proactiveReview.ts` | the sense stage; the sync hooks in right after `runEvaluation` |
| Gaps: `{label, leverageRank, route, playbook, reason?, proofMetric?, citationDocId?}`; identity `gapKey` = route/playbook (`@pikar/core` `reports.ts:28`); `diagnose()` emits ONE prescription, so a row carries 0-1 gaps + `notEnoughData` asks | `evaluations.ts:440-540`, `schema.ts` evaluations | agenda key + row content; asks = the interview |
| `applyActOnGap(ctx, tenantId, threadId, gapIndex)`: recycles the thread's ONE plan row; memo terminal (`proposed`) when the route names no registered specialist, else `collecting` + `dispatch.runSpecialist` which always lands an approvable memo (`dispatchAndLand` finally → `landSpecialistResult`) | `evaluations.ts:909-1000`, `dispatch.ts:617-696` | THE staging door — module-private until now |
| `ACTABLE_PLAN_STATUS = {collecting, proposed, canceled}` — a `done` row is `plan_busy` | `evaluations.ts:796` | **defect for the review thread**: a memo's Approve terminal is `done`, so the pinned thread could act exactly once, ever |
| Approvals page renders `kind: "memo"` plans ("Approve & file to vault") | `ApprovalsView.tsx:229,384` | the proposal's surface, unchanged |
| Review thread in the workspace: pinned tab, composer suppressed ("start a new chat to act on anything here"), `EvaluationCard` + `PlanCards` render there | `workspace/page.tsx:762`, `cards.tsx:3212-3226` | the staged memo's card renders on the review tab as it always did |
| Notifications: review kinds inserted DIRECTLY, kept out of `NOTIFICATION_KINDS` (mailbox-path guard); banner `KIND_HREF` opt-in per kind | `notificationTemplates.ts:49`, `NotificationsBanner.tsx:12`, `proactiveReview.test.ts` guard | the third kind `agenda_proposal` follows the same rule |
| Command Center: independent subscriptions per section, `SectionBoundary` each, code-owned copy, source-scanned composition (5 boundaries, marker-once, landmark names) | `CommandCenter.tsx`, `commandCenter.test.ts:874-1030` | a sixth section, `agenda`, with the same rules |
| Goals: `by_tenant_status`, `segmentId` ∈ `BLUEPRINT_SEGMENTS` (each with a `specialist` route or null) | `schema.ts:2415`, `blueprintSegments.ts:26-52` | goal linkage = active goal whose segment's specialist is the gap's route |
| Cockpit `recordScorecardAnswer` tool stores an answer with provenance (ADR-021) | `evaluations.ts:750-790` | the interview's write path — untouched; the ask links to the workspace |
| Pins that move with a new table: schema header count + names (`schema.test.ts:855-900`), `tenantData.test.ts:42` (57), `TENANT_TABLE_CLASSIFICATION` union (`isolation.test.ts`), deletion walk by `by_tenant` (`tenantDelete.ts:193`) | | `agenda` = `tenant_owned`, `by_tenant` index, 58 |
| `routines.test.ts` pins the convex module list from the filesystem and the scheduler call sites | `routines.test.ts:91,298` | `agenda.ts` + `lib/agenda.ts` added to the list; neither schedules |
| Web `commandCenter.test.ts` `mount()` throws on any query it does not name | `commandCenter.test.ts:70-95` | `agenda:current` added |

## Decisions (ADR-033)

1. `agenda` table, one row per gap key, five statuses; pure rules in `@pikar/core` `agenda.ts`.
2. The review stages ONE proposal through `applyActOnGap` (exported) — same terminals, same gate. Only
   `open`/`recurring` rows are stageable; `plan_busy` leaves `open`.
3. A `done` memo is recyclable (the once-ever defect above). A `done` email is still refused.
4. A proposal's fate is READ from its plan row (`agendaStatusFromPlan`): derived at read time, persisted
   on the next sync. No `executePlan` hook.
5. The interview = the review's own `notEnoughData` asks, rendered as openers linking to the workspace.
6. Goal linkage = `segmentForRoute(route)` → active goal on that segment. Read-only.
7. `agenda_proposal` notification, out of `NOTIFICATION_KINDS`, deep-links to approvals.

**Deliberately not done:** conversing with the review thread (composer stays suppressed — a separate
decision about making the pinned thread a live agent thread); dismissing an ask; any recurrence,
grant or auto-execute tier (v2, gated on ROUT-02 + ADR-004).

## Under test

- The proactiveReview fixture's gap routes to `money-model-designer` (registered), so the cron now
  schedules `dispatch.runSpecialist` under test. With both model keys stubbed empty the run throws
  `OPENROUTER_API_KEY is not set`, `dispatchAndLand` audits `subagent.refused`, rethrows (logged by
  convex-test, not a failure) and its `finally` lands the fallback memo `proposed`. Two consequences
  for the file: the dispatch module graph must be warmed before the timer-pumped drain (first test
  otherwise reads "did not complete after 10000 timer pumps"), and the audit assertion becomes "contains
  `evaluation.ran`, no `review.*`" instead of an exact single-row list.
- `agenda.test.ts` seeds an UNREGISTERED route (`document-analyst`) so the memo terminal is exercised
  without a dispatch; the dispatch terminal's `markAgendaProposed` call is the same seam.

## Playbooks owed

business-evaluation.md (agenda, staging, the done-memo recycle), dashboard-pages.md (the agenda
section), audit-dead-letter.md (the third notification kind — owns `notificationTemplates.ts` and the
banner), watch.json (five new paths under business-evaluation.md).
