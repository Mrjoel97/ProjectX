# ADR-042 — A channel is a TERMINAL the row can actually reach, not a default it inherits

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** ADR-039 Decision 2 (the `channel` default) and narrows ADR-039 Decision 3.
  ADR-039's other decisions stand unchanged.
- **Owner decision, 2026-09-07:** each variant in a batch is **individually schedulable**. The
  content queue is built for real this phase; 43-06 lands the arm that makes `vault` schedulable.

## Context

ADR-039 was accepted on 2026-09-07 and a nine-agent review of the plan it shipped with found a
contradiction between two of its own decisions and the code they describe. The finding is exact and
was verified end to end before this ADR was written:

- **D2** makes an absent `channel` mean `"email"`.
- **D6** pins every batch row to `kind: "memo"`.
- `executePlan` dispatches on `armFor(actionTypeOf(plan.kind))`, and `ARMS.memo` is `"inline"`
  (`packages/core/src/actionType.ts`). The `inline` arm's memo terminal is
  `patch(planId, {status:"done"})` → `persistNextStepMemo` → `return { ok: true }`
  (`convex/cockpit.ts`). It returns **before** `case "workflow": break;`, and therefore before the
  Gmail-token check, the postal-address check, the request seeding, the `send_time_too_far` cap and
  the scheduler arm.

So a `kind: "memo"` row **structurally cannot reach the email terminal**. A batch row written
exactly as ADR-039 specifies is accepted into the queue as an email and then, at Approve, silently
files a vault document. D3 does not catch it: D3 refuses a channel whose spec says
`schedulable: false`, and `email` is the schedulable one.

This is the failure mode ADR-039 D3 exists to prevent — a row that accepts a `sendAt` and then does
something else — arriving through D2's front door.

## Decision

**1. `channel` is REQUIRED on every row a batch mints. There is no default.** ADR-039 D2's
"absent means email" is superseded. Absence remains legal on the table for the ~all rows written
before this phase (no migration, no backfill — that half of D2 was right), but a batch stager must
pass it explicitly. A default is what let a row inherit a terminal nobody chose for it.

**2. `channel: "email"` on a `kind: "memo"` row is REFUSED at stage time.** The pair is
unsatisfiable by construction, not merely unwise: email delivery loops over `requests` rows and a
memo plan has none, so the honest outcome of "schedule this memo as an email" is a row that reads
`scheduled → delivering → done` having published nothing, with no throw and no audit. Refusing the
pair is cheaper than making it work, and this is exactly the silent no-publish the review named as
the likeliest trap in the whole phase.

**3. `vault` is the batch's channel this phase, and 43-06 makes it schedulable.** Per the owner's
decision, a variant carries its own `sendAt`. 43-03 ships the enum with `vault` **unschedulable**
and the D3 refusal live; 43-06 lands the memo/vault scheduler arm and flips `schedulable` to true
in the same commit as the arm. The flip and the arm must not be separable — a `schedulable: true`
with no arm behind it is precisely the lie D3 was written to forbid.

**4. When both members become schedulable, the non-vacuity check MOVES rather than dies.** This is
the part that must be decided now, not discovered in 43-06.

At 43-03 the guard is provable directly: `CHANNELS.filter(c => !CHANNEL_SPECS[c].schedulable)` is
non-empty, so the refusal has a reachable subject. The moment 43-06 flips `vault`, that filter is
empty and the check passes over a guard nothing can trigger — an unfalsifiable check, and this
repo has shipped enough of those to name the class.

The replacement is a **binding test, in `packages/backend`**, where both sides are visible at once:
*every channel whose spec says `schedulable: true` has an arm*. That is strictly stronger than what
it replaces. The old check asked "does some channel refuse?", which is a fact about a list; the new
one asks "can every channel that claims to be schedulable actually be scheduled?", which is the
hazard. It stays falsifiable for ever: mark a channel schedulable without writing its arm and it
goes red. `packages/core` cannot express this — it must not import `convex/` (§1) — which is why
the binding lives on the backend side, next to the arm it binds to.

## Rejected

- **Widening `armFor`/`ARMS` so `memo` can take the email arm.** ADR-039 D6 is right and stands:
  three fail-closed gates test `kind === "memo"` by equality, and a memo that routes to email would
  need `requests` rows it structurally does not have.
- **Keeping the `"email"` default and refusing later, at Approve.** The refusal has to happen where
  the row is written. A queue that accepts a row and rejects it days later, at the moment it was
  supposed to act, is worse than one that never accepted it.
- **A `channel` argument on `patchPlan`.** `patchPlan` is the model's door. `channel` is birth-only
  on `insertPlan`, which removes the set-`sendAt`-then-flip-`channel` bypass for free rather than
  needing a second guard to close it.
- **Deleting the D3 refusal once both channels are schedulable.** It is the fail-closed guard for
  the next channel added without a transport. Decision 4 is what keeps it honest instead.

## Consequences

- ADR-039 D1 (`sendAt` reused, no `publishAt`), D4 (core is canonical, schema mirrors), D5 (one
  Approve arms all children, cancel walks `by_parent`), D6 (`kind` stays `"memo"`) and D7
  (`channel` joins `resetPlan`) are unaffected and still binding.
- 43-03 ships `packages/core/src/channel.ts`, the schema mirror, the two-way compile bind and the
  birth-only `insertPlan` argument, with `vault` unschedulable.
- 43-06 lands the arm, flips `vault`, and in the SAME commit replaces the non-vacuity check per
  Decision 4. A commit that does one without the other is the defect.
- The review's other traps stand as build notes for 43-06, not decisions: the arm must branch
  *inside* `startScheduledDelivery` on the row it already re-read (arming a memo child on the email
  callback publishes nothing while reading `done`), and the `by_parent` cancel walk needs a
  per-child `status === "scheduled"` guard because `scheduler.cancel` throws on a committed id and
  one already-fired child would otherwise roll back the whole cancel and leave every sibling armed.
