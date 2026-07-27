# Phase 17: Calendar Actions - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Source:** Roadmap + shipped-adapter precedent (no owner forks outstanding)

<domain>
## Phase Boundary

A **read** tool that surfaces calendar availability in-loop (mirroring `listInbox`), and a
**write** that stages a calendar event into the plan for the human Approve gate to execute
through the Phase-15 generalized executor.

**Out of scope:** recurring-event rules, attendee negotiation / free-busy across external
organizations, calendar-driven scheduling automation, and any standing rule that creates events
without a human approval.

</domain>

<decisions>
## Implementation Decisions

### D1 — Mirror the shipped `gmail.ts` adapter; do not invent a second integration shape

The roadmap says this explicitly ("mirrors the shipped `gmail.ts` adapter pattern"). OAuth token
storage, refresh-on-expiry, and reconnect-prompt handling all already exist for Gmail
(`gmail.ts` / `gmailAuth.ts`, including the `kind: "gmail_reconnect"` surfaced error). Reuse that
shape. CLAUDE.md §8 rung 2: the pattern is already in this codebase.

### D2 — The write is an ACTION TYPE, never a tool side effect (SC#1, hard)

Creating the event happens **only** after the human Approve gate fires `executePlan`. The tool
call stages; it does not create. This is the ACTN-01 spine and it is not negotiable:

- Add the member to `ACTION_TYPES` in `packages/core/src/actionType.ts` **and** its arm in the
  `ARMS` table. The `as const satisfies Record<ActionType, Arm>` bind means forgetting the arm is
  a COMPILE error — that is the designed behaviour, not an obstacle to route around.
- Pick the arm deliberately. `actionType.ts:15-20` already anticipates this phase: `workflow` =
  durable multi-step orchestration ("email today, calendar in Phase 17"), `inline` = a single
  transactional write. Decide from what a calendar write actually needs, and record why.
- `executePlan` stays a `tenantMutation`. **Approve is never a tool** — `dispatchGuard.test.ts`
  asserts this by source scan; do not weaken it.
- `deliverApprovedPlan.ts` is the workflow-backed EMAIL arm's entry point, **not** the universal
  dispatcher. Routing calendar through it would re-expose the gmail fan-out as reachable in
  principle from a calendar action.

### D3 — The read tool follows `listInbox`, including its §4 discipline

Read calendar availability in-loop. Audit rows carry **ids and counts only** — no event titles,
no attendee addresses, no free-text descriptions (CLAUDE.md §4). `mailbox.listed` (`{range,
resultCount}`) is the shape to copy. Attendee addresses are PII and must not reach the model-facing
context in raw form; the `buildRecipientView` index+label precedent (§2-D) exists for exactly this.

### D4 — Tenant scoping and an isolation assertion ship WITH the surface (SC#3)

Every calendar read and write goes through the `convex/lib/functions.ts` tenant wrappers
(CLAUDE.md §2 — raw `query`/`mutation`/`action` imports are banned outside the wrapper module).
A cross-tenant isolation assertion ships in the same phase, not after it.

### D5 — Provider scope: decide and record, do not silently do both or neither

The roadmap names "Google / Microsoft". Shipping both doubles the OAuth surface for one phase.
Recommended: **Google first** (it reuses the existing Gmail OAuth client and consent flow most
directly), with the adapter boundary drawn so Microsoft is a later addition rather than a rewrite.
If research finds that reuse is thinner than it looks, say so and re-scope explicitly — do not
half-build both.

### Claude's Discretion

- The `agentSteps.tool` literals and their `VERB` labels.
- Whether availability rendering is a new card or reuses an existing panel component.
- The `plans` fields a staged event needs, and whether they warrant their own table.
- Test topology and which assertions get mutation-checked.

</decisions>

<specifics>
## Specific Ideas

- `actionType.ts` names this phase in its own comments — read it first; the seam was built for
  this change and the intended shape is documented there.
- The roadmap notes the research phase is "likely skippable" for this phase. Skipping is
  legitimate **only** if the gmail adapter genuinely covers the calendar API's differences
  (recurrence, timezones, all-day events, and free-busy are the usual places that assumption
  breaks). If any of those is non-obvious, research it rather than discovering it mid-execution.
- Timezone handling already has a precedent: `fmtSendInstant` + the trusted-client `tz`
  (§2-D — the model never supplies the clock). Calendar work must not introduce a second clock source.

</specifics>

<deferred>
## Deferred Ideas

- Microsoft/Outlook calendar, if D5 lands on Google-first.
- Recurring events, free-busy negotiation across organizations, and automated scheduling without
  a human approval.

</deferred>

---

*Phase: 17-calendar-actions*
*Context gathered: 2026-07-27*
