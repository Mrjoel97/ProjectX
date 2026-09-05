# ADR-033: The agenda is a lifecycle table over the review's gaps, and the weekly review stages one proposal

- **Status**: **Accepted** — 2026-09-05.
- **Supersedes**: nothing. This is the "agenda persistence + gap lifecycle (v0)" ADR the goal-engine
  design capture (`.planning/design/goal-engine.md` §4) said v0 would need.
- **Does NOT supersede**: [ADR-004](004-agents-humans-peer-actors.md) (standing commitments are
  grants inside human-gated mutations, never tools), [ADR-021] (the `userProvided` /
  `fieldProvenance` split), the living-map §10 prohibition on an agent goal-write tool, or ROUT-02's
  fail-closed recurrence. v0 collides with none of them and this ADR keeps it that way.
- **Evidence**: `.planning/phases/34-goal-engine-v0-the-agenda-speaks/34-RESEARCH.md`;
  `packages/core/src/agenda.ts`, `packages/backend/convex/agenda.ts`, `convex/lib/agenda.ts`;
  `agenda.test.ts` (backend), `agenda.test.ts` (core), `proactiveReview.test.ts`,
  `commandCenter.test.ts`.

## Context

The product had "sense" and "act" and no "orient": the weekly review wrote a fresh evaluation row
every Monday and a notification that said a row had changed, and the only unprompted outbound act in
the whole product was that notification. Everything else waited for the user to open a page. The
rev-5 audit (G13) ranked a propose-only Goal Engine v0 as the single most tangible unbuilt outcome,
and its only real prerequisite — honest terminals (25.1) — was done.

Three facts shaped the shape:

1. **The gap "agenda" was the latest evaluation row, last-write-wins.** A gap the user had dismissed
   or already acted on came back identical the next Monday, with no way to tell. `evaluations` is
   rewritten weekly by design (carry-forward, delta), so lifecycle cannot live on it.
2. **The staging spine already existed and was exactly right.** `applyActOnGap` turns a gap into an
   approvable memo or a specialist dispatch on the thread's ONE plan row, behind the same Approve gate
   as every email. It was reachable only from a button.
3. **The review thread could propose exactly once, ever.** `applyActOnGap` refused to recycle a
   `done` plan row (`plan_busy`), and a memo's Approve terminal is `done`. After the first approved
   memo, every later "Act on this" on the pinned review thread was refused. Unprompted staging
   would have hit this on its second week.

## Decision

**1. A tenant-scoped `agenda` table, one row per gap the WEEKLY review has surfaced, keyed by
`gapKey` (route/playbook).** Five statuses: `open`, `proposed`, `acted`, `dismissed`, `recurring`.
The rules are pure and live in `@pikar/core` (`nextAgendaStatus`, `agendaStatusFromPlan`):

- present in the latest review and never seen → `open`; `open` / `proposed` / `recurring` hold;
- `acted` and still present → `recurring` (the action did not close it);
- `dismissed` holds while the gap persists, and becomes `recurring` only once the gap was absent
  from a review and came back. A dismissal is the user's word; it is not overruled by repetition,
  only by the world changing.

"Current" is `lastSeenAt === the newest review's createdAt`. Rows that dropped out keep their
status as history and are not shown. The table is bounded by the closed prescription vocabulary
(a dozen keys per tenant, ever), so `by_tenant` collects are honest. `label` is `diagnose()`'s own
prose and content-plane; nothing from this table reaches an audit payload.

**2. The weekly review stages ONE proposal, through the same door as the button.**
`proactiveReview.reviewOne` → `agenda.syncFromReview` folds the review into the agenda and calls
`applyActOnGap(tenantId, REVIEW_THREAD_ID, topOpenGapIndex)` — the same function, the same two
terminals (deterministic memo, or a specialist dispatch that lands as an approvable memo), the same
`plans` row, the same approvals surface, the same Approve gate. Only `open` and `recurring` rows
may be staged; a `proposed` row waits, a `dismissed` row is skipped. `plan_busy` leaves the row
`open` and next Monday retries. Both doors — cron and button — call `markAgendaProposed`, so the
row's status does not depend on which door was used.

**3. A `done` memo is recyclable.** `applyActOnGap` treats `status: "done" && kind: "memo"` as
actable: an approved memo is a vault artifact, not an in-flight send. A `done` EMAIL plan is still
refused, because its card is that thread's delivery report.

**4. The fate of a proposal is read from its plan row, not written by a hook.** `proposed` +
plan `approved|scheduled|delivering|done` reads as `acted`; `proposed` + plan `canceled` (Discard)
reads as `dismissed`. `agenda.current` derives this at read time (approve on a Tuesday, see
"Acted on" on Tuesday); Monday's sync persists it. No `executePlan` change, no second writer.

**5. The interview is the review's own asks.** When the review has `notEnoughData`, those asks
fill the agenda's remaining slots as openers that link to the workspace, where the cockpit's
existing `recordScorecardAnswer` tool stores the answer with provenance. No new mechanism, no model
call, and the provenance split of ADR-021 is untouched.

**6. Goal linkage v0 is a read.** A gap's specialist route names a blueprint segment
(`segmentForRoute`); an active goal anchored on that segment is shown as "the goal this blocks".
The agent still writes no goal (living-map §10 stands).

**7. Notification: a staged week says so.** A new kind `agenda_proposal`, inserted directly by
the review (never via `notifications.notify`) and kept OUT of `NOTIFICATION_KINDS` like the two
review kinds, so it can never arm the mailbox path. It deep-links to `/dashboard/approvals`. A week
that stages nothing falls back to the existing notify-on-change rule.

## Consequences

- Every Monday, a tenant with an open gap gets ONE proposal waiting in approvals, with its
  diagnosis, citations and the goal it blocks on the Command Center. Approving a memo files it to
  the vault; approving a specialist's memo does the same. Nothing is sent, nothing recurs beyond the
  Monday cron, and autonomy beyond "suggest" is still gated on Phase 29's ROUT-02 decisions and
  ADR-004 grants (v2 in the design capture).
- A specialist-routed gap costs a specialist run per tenant per week (cents, under the tenant rail
  and the deployment window checked before the review is even scheduled). A spent deployment day
  schedules no reviews and therefore no proposals.
- The review thread's composer stays suppressed ("start a new chat to act on anything here"); the
  design capture's "converse with the review thread" is NOT delivered here. The proposal is
  answered on approvals, the ask in a new chat. Making the pinned review thread a live agent
  thread is a separate decision.
- v1 (goal↔plan↔outcome join, goal-status proposals) and v2 (earned autonomy tiers) are unchanged
  and still wait for Phase 27's measurement layer and Phase 29's decisions respectively.
