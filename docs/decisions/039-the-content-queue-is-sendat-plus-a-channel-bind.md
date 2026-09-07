# ADR-039 — The content queue is `sendAt` plus a channel bind, and a batch is armed by one Approve

- **Status:** Accepted
- **Date:** 2026-09-07
- **Closes design questions for:** G10 (batch content + content queue).
- **Builds on:** ADR-037 (a root is an artifact, a child is a worker), ADR-038 (a fan-out narrows to
  what the rail can fund), ADR-040 (a child is an assignment).
- **Owner decisions, 2026-09-07:** a batch produces **N variants of one piece**; **one approval card**
  for the whole batch; **build the channel-agnostic queue now**, even though email is the only
  channel that exists.

## Context

G10 asks for "batch content + content queue (`deliverables[]`, `publishAt`)". Three facts about the
code as it stands change the shape of that:

1. **The scheduling half already exists.** `plans.sendAt` (one absolute epoch ms) and
   `plans.status: "scheduled"` are shipped, with an armed scheduler and a `scheduledFunctionId`
   handle. `sendAt` is documented in `schema.ts` as "the ONE source of truth".
2. **Email is the only delivery channel.** `deliverApprovedPlan` reuses `gmail.send`. Nothing in the
   repo publishes anywhere else.
3. **The parent/child spine is already built.** ADR-037 shipped `plans.parentPlanId` + `by_parent`,
   `insertPlan` taking `parentPlanId`/`kind`/`subject` at birth, and `flipParentWhenSiblingsDone`.
   ADR-040 made a child an assignment with its own sub-question.

So G10 is mostly a matter of *reusing* three shipped mechanisms rather than adding a fourth.

## Decision

**1. `sendAt` is REUSED. There is no `publishAt`.** One timer column, one `scheduledFunctionId`
handle, one `scheduled` status literal, one queue view. A second scheduling field on the same table
is two mechanisms that can disagree about when a row fires, and the disagreement would surface as a
double send or a silent no-send — both invisible until a user notices. `sendAt`'s comment block
widens to say "when this plan acts"; the field does not change.

**2. The channel is a new closed enum, `plans.channel`.** `v.optional(v.union(v.literal("email"),
v.literal("vault")))`, absence meaning `"email"` — no migration, no backfill, the
`sendAt`/`mailProvider` precedent. Two members from day one deliberately: a one-member union is
scaffolding that cannot be got wrong, and the `satisfies Record<Channel, ChannelSpec>` bind only
starts catching anything at two.

The owner chose to build this now, ahead of a second publishing channel. That is speculative under
ponytail rung 1 and was flagged as such; the mitigation is Decision 3, which is what stops the
speculation from becoming a lie.

**3. An unschedulable channel REFUSES. It never silently fires immediately.** Each channel carries a
spec (`schedulable`, `horizonMs`). A channel that cannot be scheduled returns
`channel_not_schedulable` at stage time, before a row is written — it does not accept a `sendAt` and
then deliver now. This is the whole reason the enum is allowed to exist before its second member has
a transport: an unimplemented channel must **fail closed**, or the queue is a promise the system
does not keep.

**4. The canonical channel list lives in `packages/core`, and the schema union is a MIRROR.** Per
CLAUDE.md §1, and because `schema.ts`'s closed unions are a declaration site rather than an
enforcement layer — a missing literal throws inside the SDK where the error is swallowed, which this
repo has been bitten by four times (`agentSteps.tool`). A parity test binds the two both ways.

**5. A batch is a root plus N children, and ONE Approve arms them all.** Identical to the fan-out:
children land without approval cards, only the root reaches `proposed`. The parent's single Approve
walks `by_parent` and schedules each child that carries a `sendAt`; **cancel walks `by_parent` and
cancels every `scheduledFunctionId`**, so a cancelled batch leaves no armed timer behind. A child is
never armed through `executePlan`, which is the single-plan door and knows nothing about siblings.

**6. `plans.kind` stays `"memo"` end to end. No new member.** Three fail-closed gates test
`kind === "memo"` by equality — `landSpecialistResult`'s CAS, the sibling flip, and
`reliabilitySweep`'s `collectingPlane`. A new member would be discarded by all three: paid children
silently lost, parent hung at `collecting` for ever. This is the same fatal ADR-040's predecessor
found, and the answer is not to widen the gates but to not need to.

**7. `channel` joins `resetPlan`'s wipe list.** A thread that queued one channel must not keep it
across a "start over".

## Rejected

- **`deliverables[]` as an array column.** Rejected by name in ADR-037's options table. A variant is
  a `plans` row: it already has a body, a status, a `sendAt`, a `scheduledFunctionId` and an
  approval story. An array would need every one of those re-invented inside it, and none of the
  existing readers would see them.
- **A new `publishAt` field.** Decision 1.
- **A queue index.** The scheduler is push-based; there is nothing to poll.
- **A new `plans.kind` member for content.** Decision 6.

## Consequences

- The "content queue" is a VIEW over `plans` with a `sendAt`, not a new table.
- `channel: "vault"` is the honest second member: it is a real destination the system already has
  (a saved document), so the enum's second value is not fictional.
- Nothing here lets a batch publish to a channel that has no transport. When one arrives, it adds a
  `CHANNEL_SPECS` row and a transport; the queue, the arming and the cancel path are unchanged.
- The measurement discipline from 42.1 applies: `43-08` prints the observed variant count and
  per-child spend on a dry run before the first paid batch.
