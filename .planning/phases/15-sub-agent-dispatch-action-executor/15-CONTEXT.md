# Phase 15: Sub-Agent Dispatch & Generalized Action Executor - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the hollow `sub_agent` route real — specialized sub-agents become swappable
`(skill body, tool-set)` pairs run by the **ONE** governed loop, under a depth cap, a shared
root-request cost envelope, cycle refusal, and recorded lineage — and make the approve→execute
spine **action-agnostic**, so later capability phases add an arm instead of re-forking the
executor.

This is a **framework** phase. It ships no new outward capability of its own: Research is
Phase 16 (DISP-02/ACTN-03), Calendar Phase 17, Documents Phase 18, Contacts/CRM Phase 19.
The user-visible payoff in Phase 15 is that Phase 12's "Act on this" gap control stops writing
a deterministic template and starts running the specialist it already names.

</domain>

<decisions>
## Implementation Decisions

### Which specialists go live

- **All three growth specialists become dispatchable**: `offer-architect`,
  `money-model-designer`, `lead-engine`. All three already exist as skill bodies in
  `packages/contracts/skills/`, are already in `GATED_SKILLS`, and `diagnose()` already emits
  them as `gap.route` values — so every gap the user can tap resolves to a runnable specialist.
  No gap is left on the old memo behaviour.
- **The ONLY dispatch trigger this phase is the existing "Act on this" gap control.** The
  executive router's free-text `sub_agent` route stays hollow until Phase 16's Research
  specialist. Rationale: `gap.route` comes from a CLOSED enum computed by `diagnose()`, so
  "an unknown specialist fails closed to `unknown_route`" (SC #1) is a type-level guarantee
  rather than a runtime validation of model-supplied text.
- **Specialist tool-set is read-only, least privilege**: vault grounding + evaluation reads.
  NO send, NO plan-write, NO scorecard write. The specialist returns findings; the executive
  agent stages any write. This is the posture Phase 16 explicitly depends on ("it has NO
  send/write capability, so an injected instruction can at most propose, never execute").
- **The three specialist bodies get rewritten to run.** Drop the "Registered now; a full build
  runs later" placeholder framing; write them as working specialists producing grounded output.

### Eval gate (consequence of rewriting the bodies)

- All three are in `GATED_SKILLS`, so each edit publishes a CANDIDATE that activates only
  through a recorded passing eval run (EVAL-01 / Phase 3.6).
- **One eval run, all three pinned.** Extend `run-eval-golden.mjs`'s `--skill` handling to
  accept multiple pins (or derive valid targets from `GATED_SKILLS` — its `SKILL_NAMES`
  allow-list is currently a hardcoded three that excludes every Phase 12 skill). One run,
  one cost, one sitting; the runner already records evidence per `(name, version)`.
- **Three new golden fixtures, one per specialist, end-to-end**: a gap routing to that
  specialist, tapped, dispatched, output staged. Mirrors the `27-grounded-assessment` /
  `28-healthy-no-gaps` precedent, and exercises depth cap + lineage on the real path.
- **If the gate does not go green inside Phase 15, ship dark.** The framework (dispatch,
  depth cap, cycle refusal, envelope, lineage, executor) still lands and is still tested;
  specialists stay on their active v1 bodies with candidates parked. Phase 15's success
  criteria do not require a rewritten body.
- **Automated green is sufficient to merge** — no owner sign-off gate inside the phase.
  This matches `PARALLELIZATION.md` Stage 3: the merge gate is automated only, and the
  owner's live human-verify happens ONCE on integrated `main` after all lanes land,
  covering Phases 14 and 15 in one pass.

### What the user sees

- **Same plan card, real body, plus a specialist attribution header.** The NEXT-STEP MEMO
  card keeps its shape and its single Approve gate; the body changes from `buildMemo`'s
  deterministic template to the specialist's grounded output, and a visible attribution line
  names which specialist produced it.
- **Dispatch appears in the live activity trace (CKPT-05) as a step that NAMES the
  specialist.** The running step row IS the progress indicator — no separate card pending
  state, no spinner to build. `agentSteps.tool` is a CLOSED literal union in `schema.ts` and
  the UI renders it through a code-owned label map, so carrying "which specialist" means
  either N literals or a second field. **That schema change belongs to the Wave-0 freeze
  commit** (`PARALLELIZATION.md` Stage 1), not to a lane.
- **The user does NOT choose the specialist.** `diagnose()` computes `gap.route`
  deterministically from the binding constraint and "Act on this" honours it. No confirm
  step in front of the Approve gate — Approve is already the consent point. The route is
  never user-supplied.

### Limits and refusal behavior

- **Depth cap = 1** (executive → specialist). A specialist can never dispatch anything.
  Satisfies "no agents spawning agents" literally and makes cycles structurally impossible.
  Phase 16's Research specialist is dispatched BY the executive, so 1 is sufficient for every
  known downstream need.
- **Cycle refusal still ships and is asserted explicitly** (A→B→A rejected), even though
  depth 1 already prevents it. SC #2 names it as its own criterion; defense in depth means
  the guarantee is already there and already tested the day the cap rises.
- **The shared root-request cost envelope is DERIVED from the tenant's remaining daily
  budget** — not a fixed constant. Consequence: `guardrails.ts`'s daily-spend window, today a
  write-only global rail (`recordSpend`), must expose a readable "remaining". **That read
  lands in the Wave-0 freeze commit**, after which `guardrails.ts` is frozen like `llm.ts` and
  `schema.ts`. The envelope is drawn down by every priced call across the whole sub-agent tree.
- **On mid-tree exhaustion: stop, keep the partial output, label it incomplete.** Return what
  the specialist produced with an explicit "incomplete — cost ceiling reached" marker and let
  the human decide at the Approve gate. Matches the codebase's honesty posture (Phase 12's
  not-enough-data verdict is never dressed up as a finding).
- **Every refusal — unknown specialist, depth-cap breach, cycle, drained envelope — is a
  conversational reply, NEVER a dead-letter.** This is the precedent `runAgentLoop` already
  sets with `PAUSED_REPLY` for `kill_switch` / `daily_budget_exhausted`: a governed stop is a
  paused conversation, not a system failure. The cockpit has never DLQ'd a user-facing turn.
- **SC #1 and SC #2 are proven in `convex-test`, offline, with no LLM spend.** Depth cap,
  cycle refusal, unknown specialist, and envelope exhaustion all assert there — the backend
  suite's dominant pattern (~495 offline tests). Paid golden fixtures stay on the happy path.

### The generalized action executor (ACTN-01)

- **Refactor only — a table of two arms** (`email`, `memo`). No third arm and no test-only
  arm is invented: every in-scope candidate action belongs to a later phase. The deliverable
  is the seam plus a test proving that adding an arm requires ZERO spine edits.
  Note that `executePlan` already executes a non-email action type today
  (`plan.kind === "memo"`, shipped 12-05), so SC #4 is about generalizing that branch into a
  dispatch table — not about widening the gmail fan-out.
- **Closed action-type union and the "which arm" decision are pure TS in `packages/core`**
  (Convex-free, unit-testable — CLAUDE.md §1); the arms themselves stay in `convex/` because
  they do DB writes. Mirrors the existing `routing.ts` / `diagnose()` split.
- **Two-level dispatch.** `executePlan` is the dispatcher and picks the arm. Arms that need
  durable multi-step orchestration start a workflow (email today, calendar later); arms that
  do not (memo) execute inline. `deliverApprovedPlan` is generalized as the **workflow-backed
  arm's entry point** rather than as the universal dispatcher.
  *Why not "everything through `deliverApprovedPlan`":* a memo plan starts no workflow at all
  today, so routing it through the workflow would add orchestration, workflow rows, and
  latency for one DB write — and would re-expose the gmail fan-out as reachable-in-principle
  from every action type, a structural safety property 12-05 bought by keeping that file
  byte-unchanged.
- **An unknown action type is impossible by type**: closed union + exhaustive switch means an
  unhandled arm is a COMPILE error, with a runtime throw only as the unreachable backstop.
  Same technique as `routing.ts` ("a route the system cannot validate is a route it must not
  take").
- **The human Approve gate stays a `tenantMutation`, never a tool** (SC #4, and the standing
  v2.0 architecture rule).

### Claude's Discretion

- Exact shape of the lineage rows (SC #3) — which tables carry `rootRequestId` /
  `parentAgentId`, and whether telemetry mirrors audit. Constraint: refs/ids/counts ONLY
  (CLAUDE.md §4), and the call tree must be reconstructable from the insert-only audit with
  cost attributed to the root request.
- Form of the cross-tenant isolation assertion (SC #5) — follow the existing precedent for
  isolation tests on tenant-scoped rows; a sub-agent run keyed on `rootRequestId` must still
  be tenant-scoped.
- Naming: the action-type union members, the dispatch step's literal(s), the specialist
  attribution copy.
- Whether "which specialist" rides `agentSteps` as N literals or a second field.
- The precise fraction/derivation of remaining daily budget that forms the envelope.
- Where the "incomplete — cost ceiling reached" marker lives on the plan row vs in the body.

</decisions>

<specifics>
## Specific Ideas

- "Act on this" must stop being a dead end. Phase 12-05 shipped a memo that NAMES the
  specialist and cites its playbook but explicitly does not run it — Phase 15 is the phase
  that closes that loop, and that is the phase's user-visible point.
- The "no new card idiom" discipline held through Phases 12 and 13 and should keep holding:
  a specialist result is a richer body plus an attribution header on the SAME card, not a
  new card.
- Refusals should read like the existing `PAUSED_REPLY` — a calm conversational message,
  not an error.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets

- `packages/contracts/skills/{offer-architect,money-model-designer,lead-engine}.md` — the
  three specialist bodies, already written, already seeded, already in `GATED_SKILLS`
  (`packages/contracts/src/skill.ts:100-115`). Phase 15 rewrites the bodies; it does not
  create the registry entries.
- `packages/core/src/growth/diagnose.ts` — already emits the three specialist names as
  `gap.route` (lines ~41-165). The route→specialist mapping exists; nothing new to design.
- `runAgentLoop` (`convex/llm.ts:1642`) — THE governed loop. Takes `system` (the skill body)
  and builds tools via `buildCockpitTools`. A specialist is a swapped `(system, tools)` pair
  through this same function: `stopWhen: stepCountIs(8)`, `AbortSignal.timeout`,
  `recordModelSpend`, fallback-on-eligible-failure all come free. **No nested `generateText`.**
- `PAUSED_REPLY` (`convex/llm.ts:1588`) — the governed-stop conversational reply precedent for
  `kill_switch` / `daily_budget_exhausted`. Refusals follow this shape.
- `recordModelSpend` / `priceUsage` / `guardrails.recordSpend` — the existing pricing→spend
  path the envelope draws down through.
- `onToolExecutionStart` / `onToolExecutionEnd` (`convex/llm.ts:1709+`) — the CKPT-05 activity
  trace emitter. Native `ai@7` callbacks; `ctx.runMutation` commits mid-action and pushes to
  live subscribers, which is what makes the dispatch step a working progress indicator.
- `executePlan` (`convex/cockpit.ts:496`) — the Approve gate. Idempotent CAS on `plan.status`;
  the `kind === "memo"` persist terminal at :521 is the branch ACTN-01 generalizes.
- `persistNextStepMemo` / `buildMemo` (`convex/evaluations.ts:639`) — the memo arm's body.
  Specialist output replaces `buildMemo`'s template as the body source.
- `run-eval-golden.mjs` + `scripts/eval-cases/` (27 cases) — the EVAL_GATE harness.

### Established Patterns

- **Two shapes only** (standing v2.0 rule): a read-only tool returning content in-loop, or a
  write staged into the plan for the human Approve mutation. No third mechanism. A dispatched
  specialist is the FIRST shape; its output reaches the world only through the second.
- **Closed unions as the fail-closed mechanism** — `routing.ts` (`unknown_route`, no default
  route), `agentSteps.tool`, the evaluation framework enum. Phase 15's specialist route and
  action type both follow this.
- **Insert-only audit, refs/ids/counts only** (CLAUDE.md §3/§4). Lineage rows carry ids, never
  content.
- **Skills are versioned registry rows, never hardcoded** (CLAUDE.md §5); gated skills need
  recorded eval evidence to activate.
- **`convex-test` offline assertions** are the default proof; paid golden fixtures are reserved
  for model-behaviour claims.
- **Tenant-scoped wrappers only** (`tenantQuery` / `tenantMutation` / `tenantAction` from
  `convex/lib/functions.ts`) — raw `_generated/server` imports are banned (CLAUDE.md §2).
  Note the Phase 12-04 precedent: the tool loop carries no live identity, so a tool-callable
  write needs an explicit-`tenantId` `internalMutation` twin delegating to ONE shared helper.

### Integration Points

- `convex/llm.ts` — dispatch, specialist skill+tool-set swap, depth cap, cycle refusal,
  envelope drawdown. **Lane A's exclusive property after Wave 0.**
- `convex/cockpit.ts` (`executePlan`) + `convex/deliverApprovedPlan.ts` + `convex/plans.ts` —
  the action-type dispatch table and the workflow-backed arm. **Lane B.**
- `convex/evaluations.ts` (`actOnGap`, `persistNextStepMemo`) — where the gap control hands off
  to dispatch.
- `packages/core` — the new closed action-type union and arm-selection function.
- `convex/skills.ts` seeding — **Lane A only this phase**; version collisions are silent
  (`seedSkills` writes `maxVersion + 1` and optimizer dry-run candidates already occupy
  versions). Verify which version carries your body before any eval or activate.

### Wave-0 inputs surfaced by this discussion

`PARALLELIZATION.md` Stage 2's lane table is explicitly provisional and is finalized from the
finished plans. Three shared files are implicated that **no current Phase 15 lane owns**:

1. `convex/schema.ts` — lineage fields (`rootRequestId`, `parentAgentId`) AND the dispatch
   step on the closed `agentSteps.tool` union, carrying the specialist name.
2. `convex/guardrails.ts` — a readable "remaining daily budget" for the envelope. Owner
   decision: **this read lands in Wave 0**, then the file is frozen.
3. `apps/web/app/(app)/dashboard/workspace/cards.tsx` + the activity-trace label map — the
   specialist attribution header and the dispatch step's label. **The Phase 15 lane table has
   no web column; Stage 1 must assign one.**

</code_context>

<deferred>
## Deferred Ideas

- **User-overridable specialist route** — letting the user pick a different specialist than
  `diagnose()` chose. Deliberately out: it opens the route to user-supplied values, the exact
  surface SC #1's fail-closed requirement defends.
- **Depth cap > 1 / specialist-dispatches-specialist composition** — cycle refusal ships now
  so this is cheap later, but the cap stays 1 this phase.
- **A third action arm** — research (Phase 16), calendar (17), documents (18), contacts/CRM
  (19) each add exactly one arm to the table Phase 15 builds.
- **Free-text `sub_agent` routing from the executive router** — arrives with Phase 16's
  Research specialist, which is the first specialist a user can reach by asking.
- **Card pending state during dispatch** — the trace step is the indicator this phase; a
  dedicated card pending state is polish for whenever a web lane exists.
- **Adversarial golden fixtures** (unknown specialist / depth breach / cycle against a real
  model) — refusals are asserted in `convex-test` this phase; paid adversarial fixtures are a
  later hardening pass.
- **Specialist output quality beyond the first rewrite** — the bodies get one honest rewrite;
  deeper method work is its own pass.

</deferred>

---

*Phase: 15-sub-agent-dispatch-action-executor*
*Context gathered: 2026-07-25*
