---
phase: 34-goal-engine-v0-the-agenda-speaks
plan: 01
status: complete
completed: 2026-09-05
commits: [see the phase-close commit's parent — feat(34-01)]
requirements-completed: [G13 v0]
requirements-pending: [G13 v1 (goal↔plan↔outcome, after Phase 27), G13 v2 (earned autonomy, after Phase 29 ROUT-02 + ADR-004 grants)]
---

# 34-01 — Goal Engine v0: the agenda speaks

**What a tenant sees.** Every Monday the weekly review still runs. Now it also folds its gaps into a
persistent agenda and stages the top open one as a proposal — the same memo or specialist run the
review card's "Act on this" button produces — which waits on `/dashboard/approvals` behind the same
Approve gate. The Command Center gains a "Your agenda" section: up to three rows, each the gap in
plain words, its status word (Open / Awaiting your approval / Acted on / Came back), `diagnose()`'s own
reason and proof metric, "Grounded in:" the review's document titles, and "Toward your goal:" the
active goal on that gap's segment. When the review lacks data, the remaining rows are its asks, each
linking to the workspace where the cockpit stores the answer with provenance. The only controls are
"Stage for approval" and "Dismiss". A staged week's notification says so and links to approvals.

**The diffs.**
- `packages/core/src/agenda.ts` (new): the five statuses and the pure rules — `nextAgendaStatus`
  (never seen → open; acted and still here → recurring; dismissed holds until the gap closed and came
  back), `agendaStatusFromPlan` (approved/scheduled/delivering/done → acted, canceled → dismissed),
  `segmentForRoute`, `AGENDA_LIMIT = 3`, code-owned status words. `AGENDA_PROPOSAL_MESSAGE` beside
  the two review messages. `agenda: "tenant_owned"`; table count 58.
- `schema.ts`: the `agenda` table (`by_tenant`, `by_tenant_key`), content plane, no migration.
- `convex/lib/agenda.ts` (new): `syncAgenda` (materialise plan fate → transition every current gap →
  return the lowest-rank stageable index) and `markAgendaProposed` (review thread only; upsert; any
  other row `proposed` under the same recycled plan goes back to `open`).
- `convex/agenda.ts` (new): `syncFromReview` (internal, cron hop), `current` (the read: ≤3 rows,
  read-time fate, citations, goal), `dismiss` (refuses a `proposed` row — answer that at the gate).
- `evaluations.ts`: `applyActOnGap` exported; **a `done` memo is recyclable** — before this the review
  thread's one plan row was `plan_busy` forever after its first approved memo, so the review could
  propose exactly once, ever; both terminals call `markAgendaProposed`.
- `proactiveReview.ts`: after `runEvaluation`, `internal.agenda.syncFromReview` in its own try/catch;
  notification `agenda_proposal` when staged, else the existing notify-on-change; the kind is outside
  `NOTIFICATION_KINDS` (guard test extended).
- `CommandCenter.tsx`: `AgendaCard` + `ConnectedAgenda`, sixth `SectionBoundary`, own subscription;
  `NotificationsBanner` deep-links `agenda_proposal` to approvals.
- `_generated/api.d.ts` hand-extended (`agenda`, `lib/agenda`); `routines.test.ts` module pin.

**Tests.** `agenda.test.ts` (backend, 10): first sync stages a proposed memo and nothing executes;
a waiting proposal is not re-staged and the plan is not recycled; approved reads as acted at once and
is re-proposed as recurring next week; a dismissal holds, then lifts once the gap closed and came back;
dismiss refuses a proposed row; the review card's own button marks the same row; `current` is null
before any review, empty after a clean one, cited and goal-linked, tenant-scoped, ≤3 rows with asks
filling the rest, and never shows a row from an older review. `agenda.test.ts` (core, 6).
`proactiveReview.test.ts` 8/8 (kind → `agenda_proposal`; audit assertion "contains `evaluation.ran`,
no `review.*`" because the staged dispatch writes `subagent.dispatched/refused`; `./dispatch.ts` warmed
before the timer-pumped drain). `commandCenter.test.ts` 61/61 (5 new: proposed row words, citations,
goal, approvals link; open row = two controls and no send; recurring/acted words and links; the four
honest states; the status line; the connected section reads `agenda:current` only).

**Measured:** repo typecheck 12/12; full backend suite in two shards 67 files / 2034 tests + 66 files / 1923 tests, both exit 0; contracts, core, extraction, pii, revenue, voice, billing, cost, vault all green; web 862 tests green with two files (`workflows/PinnedWorkflowButton.test.ts`, `workflows/WorkflowPackCustomizer.container.test.ts`) failing at jsdom environment setup before any test runs — `Cannot find module ./xhr-sync-worker.js`, absent from this worktree's jsdom@27.4.0 install (the server-only/empty.js class of worktree-install artifact; both files predate this phase and import nothing from it; green on CI's clean install).

**Playbooks:** business-evaluation.md, dashboard-pages.md, audit-dead-letter.md bumped; five paths
registered under business-evaluation.md in watch.json. ADR-033 accepted.

**Not done, by design:** conversing with the pinned review thread (composer stays suppressed; the
proposal is answered on approvals, the ask in a new chat); dismissing an ask; any recurrence, grant or
auto-execute tier (v2); goal-status proposals and the goal↔plan↔outcome join (v1, after Phase 27).
