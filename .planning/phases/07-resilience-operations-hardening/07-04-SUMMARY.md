---
phase: 07-resilience-operations-hardening
plan: 04
subsystem: api
tags: [convex, agent, review-gate, notifications, timeout, fail-closed, cockpit]

# Dependency graph
requires:
  - phase: 07-01
    provides: "@pikar/core classifyReviewDecision + MAX_REGENERATE, notificationMessage(agent.timeout|retry.limit), plans.reviseCount/escalated schema fields"
  - phase: 07-03
    provides: "the pipeline review gate's classifyReviewDecision wiring — the shared classifier this plan reuses for the cockpit gate"
provides:
  - "AGNT-04: an exhausted Executive-Agent timeout (primary + CHEAP_MODEL fallback both time out) fires ONE agent.timeout notification and stays non-dead-ending"
  - "REVW-02 (cockpit): proposeEmailPlan counts each redraft on plans.reviseCount via classifyReviewDecision; past MAX_REGENERATE it escalates (plans.escalated) + notifies retry.limit and stops re-proposing"
  - "executePlan fail-closed guard: refuses an escalated plan (review_escalated) before the CAS flip/seed/send — the cockpit mirror of the pipeline unapproved-send guard"
  - "both new notification kinds (agent.timeout, retry.limit) feed the OPSG-05 matrix"
affects: [07-05, 07-06, OPSG-05, cockpit, agent-runtime]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Content-free ConvexError { kind } marker to carry an error class across a ctx.runAction boundary (the error name is lost, ConvexError data survives)"
    - "Shared @pikar/core classifyReviewDecision at BOTH review gates (pipeline 07-03 + cockpit here) — one fail-closed classifier, never a forked copy (CLAUDE.md §8)"
    - "SMOKE::agent::timeout offline seam forcing both models to time out through the REAL runAgentLoop (mirrors the route/draft fail=primary sentinels)"

key-files:
  created: []
  modified:
    - "packages/backend/convex/llm.ts — runAgentLoop timeout marker + isTimeoutError; SMOKE::agent::timeout seam; proposePlan tool surfaces escalation"
    - "packages/backend/convex/cockpit.ts — notifyIfAgentTimeout helper wired into both drivers; proposeEmailPlan revise cap; executePlan escalated guard"
    - "packages/backend/convex/runCockpitAgent.test.ts — AGNT-04 positive + negative cases"
    - "packages/backend/convex/cockpit.test.ts — REVW-02 revise-cap + fail-closed executePlan cases"
    - "docs/playbooks/agent-runtime.md — invariant 11 extended (agent.timeout)"
    - "docs/playbooks/cockpit.md — live-gate revise cap + executePlan escalated invariant"

key-decisions:
  - "Carry the exhausted-timeout signal across the ctx.runAction boundary as a ConvexError data marker (name doesn't survive the boundary; ConvexError.data does)"
  - "Reuse classifyReviewDecision for the cockpit gate instead of a direct MAX_REGENERATE compare — the shared fail-closed classifier reaches both gates (07-03 + 07-04)"
  - "Wire the agent.timeout notify into BOTH cockpit agent entry points (sendCockpitMessage + resolveRecipients) via a shared helper — the root-cause fix, not one driver"

patterns-established:
  - "Pattern: a ConvexError { kind } marker is the reliable cross-action-boundary signal when an error's name/class is needed by the caller"
  - "Pattern: an escalated plan is a fail-closed terminal — proposeEmailPlan stops re-proposing AND executePlan refuses to send it"

requirements-completed: [AGNT-04, REVW-02, OPSG-05]

# Metrics
duration: 15min
completed: 2026-07-21
---

# Phase 7 Plan 04: Cockpit Resilience — Agent-Timeout Notification + Fail-Closed Revise Cap Summary

**An exhausted Executive-Agent timeout now fires an agent.timeout notification (staying non-dead-ending), and the LIVE cockpit review gate is bounded + fails closed — a past-MAX_REGENERATE redraft escalates + notifies retry.limit and can never be sent.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-21T02:35:00Z
- **Completed:** 2026-07-21T02:48:00Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- AGNT-04: `runAgentLoop` re-throws a content-free `ConvexError { kind: "agent_timeout" }` on a double (primary + CHEAP_MODEL) abort/timeout; both cockpit drivers fire ONE `agent.timeout` notification from the catch tail (finally stays trace-only). A non-timeout failure notifies nothing.
- REVW-02 (cockpit): `proposeEmailPlan` counts each redraft on `plans.reviseCount` via the shared `@pikar/core classifyReviewDecision`; past `MAX_REGENERATE`(=3) it sets `plans.escalated` + notifies `retry.limit` and stops re-proposing (bounded).
- `executePlan` refuses an escalated plan (`review_escalated`) as an early guard before the CAS flip/seed/send — the cockpit mirror of the 07-03 pipeline unapproved-send guard.
- Both new notification kinds (`agent.timeout`, `retry.limit`) now flow into the OPSG-05 notification matrix.

## Task Commits

Each task was committed atomically:

1. **Task 1: Agent-timeout notification (AGNT-04)** - `c14176d` (feat)
2. **Task 2: Cockpit revise cap → escalate + fail-closed executePlan (REVW-02)** - `a8b9b59` (feat)
3. **Task 3: Playbooks** - `40db48f` (docs)

_Note: Tasks 1 & 2 were TDD; each test was written and observed against the new behavior before the implementation was accepted (both landed as a single cohesive feat commit because the offline test seam is production code the test depends on)._

## Files Created/Modified
- `packages/backend/convex/llm.ts` - `isTimeoutError` (RetryError-unwrapping abort/timeout discriminator); `runAgentLoop` throws the `agent_timeout` ConvexError marker on a double-timeout; `SMOKE::agent::timeout` seam forces both models to time out through the real loop; `proposePlan` tool surfaces the escalation to the user.
- `packages/backend/convex/cockpit.ts` - `notifyIfAgentTimeout` helper wired into both `sendCockpitMessage` and `resolveRecipients` catches; `proposeEmailPlan` revise-cap logic (classifyReviewDecision → reviseCount++ / escalate + retry.limit); `executePlan` `review_escalated` early guard + widened return union.
- `packages/backend/convex/runCockpitAgent.test.ts` - AGNT-04 positive (exhausted timeout → one agent.timeout notify + safe reply + terminal trace) + negative (non-timeout failure → no notify).
- `packages/backend/convex/cockpit.test.ts` - REVW-02: 4 redrafts → escalated + one retry.limit + status not advanced; first propose is not a redraft; executePlan refuses an escalated plan (no rows, no workflow).
- `docs/playbooks/agent-runtime.md` - invariant 11 extended for the agent.timeout escalation; new Last verified (07-04).
- `docs/playbooks/cockpit.md` - live-gate revise cap + executePlan escalated fail-closed invariant; new Last verified (07-04).

## Decisions Made
- **ConvexError data marker over error-name preservation:** the error `name` does not survive the `ctx.runAction` boundary between `runCockpitAgent` and its driver, but a `ConvexError`'s `data` does — so the exhausted-timeout signal rides `ConvexError { kind: "agent_timeout" }`, content-free.
- **classifyReviewDecision, not a raw compare:** reused the shared `@pikar/core` classifier (the same one 07-03 wired into the pipeline gate) so the fail-closed cap lives in ONE place (CLAUDE.md §8) rather than an inlined `3`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] agent.timeout notification wired into BOTH cockpit agent entry points, not just sendCockpitMessage**
- **Found during:** Task 1 (Agent-timeout notification)
- **Issue:** The plan named only the `sendCockpitMessage` driver (cockpit.ts:96-121). `resolveRecipients` is the OTHER agent entry point with the identical loop-drive + `catch`/`finally` shape and can time out the same way — leaving it out would silently swallow a timeout on the post-pick continue turn (an inconsistent blind spot).
- **Fix:** Extracted a shared `notifyIfAgentTimeout(ctx, tenantId, e)` helper and called it from both drivers' catch tails — the root-cause fix (one helper, every caller) rather than one driver.
- **Files modified:** packages/backend/convex/cockpit.ts
- **Verification:** `runCockpitAgent.test.ts` green (positive/negative AGNT-04 cases); the existing `resolveRecipients` turn-lifecycle test still passes.
- **Committed in:** c14176d (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical).
**Impact on plan:** The single deviation closes a timeout blind spot on the second agent entry point via a shared helper — strictly within intent, no scope creep. No schema changes were needed (07-01 already added `plans.reviseCount`/`escalated`).

## Issues Encountered
- The full `runCockpitAgent` suite showed one red under parallel load: the pre-existing `mock loop: a scripted edit sequence` test hits the default 5000ms vitest timeout (documented repeatedly in STATE.md as a machine-load flake that "reproduces on base"). Re-run in isolation with `--testTimeout=30000` it passes at ~3.1s. Not a regression — the two new AGNT-04 cases pass in the same run.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- AGNT-04 + REVW-02 (cockpit) are code-complete and unit-verified. The manual phase-gate (07-06) still owes a LIVE confirmation: force an agent turn to time out and confirm one in-app `agent.timeout` notification + the safe reply; re-ask the agent to redraft a plan >3× and confirm it escalates + Approve is refused. Units cannot substitute for the live notification-surface check.
- Both notification kinds are now emitted; OPSG-05's matrix consumes them.

---
*Phase: 07-resilience-operations-hardening*
*Completed: 2026-07-21*

## Self-Check: PASSED
- Files verified present: 07-04-SUMMARY.md, llm.ts, cockpit.ts
- Commits verified present: c14176d (Task 1), a8b9b59 (Task 2), 40db48f (Task 3)
