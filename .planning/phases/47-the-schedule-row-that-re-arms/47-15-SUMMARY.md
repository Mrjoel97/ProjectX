---
phase: 47-the-schedule-row-that-re-arms
plan: 15
subsystem: recurrence-governance
status: complete
completed: 2026-09-28
requires: [47-14]
provides:
  - Reviewed six-file isolated candidate inventory and explicit convex-test harness feasibility
  - Closed stage-checker refusal for unlisted files, runtime imports and forbidden effects
requirements-completed: []
requirements-addressed: [ROUT-02]
---

# Plan 47-15 — six-file evidence-build inventory

The [pre-build isolation review](47-15-ISOLATION-REVIEW.md) accepted the exact six-path
inventory, proved a separate `convex-test` schema and explicit edge-runtime Vitest discovery in
a disposable harness, and recorded the unresolved sweep-only D6 cancellation issue **before**
candidate code existed. The subsequent post-transition review accepted the checker/stage
amendment while preserving the historical operational `defer` decision. The accepted
[stage artifact](47-14-STAGE-DECISION.md) still lists exactly those six files, expires
2026-12-31, and forbids tenant/production activation, provider/paid calls, external writes and
sends. The candidate now exists under the separately executed Plan 47-16; that later state does
not retroactively turn this pre-build review into candidate or production proof.

Current revalidation on 2026-09-28: `check-routine-gate.mjs --self-check` passed 32/32,
`routineDecision.test.ts` passed 92/92, and matrix/eligibility/historical-defer/stage exits were
`0/1/0/0` with 14 eligibility findings. Strict planning was green at the prior checkpoint.
The current [source review packet](47-CURRENT-SOURCE-REVIEW-PACKET-2026-09-28.md) is still
awaiting an independent current-byte verdict; it is not a condition satisfied by this summary.

The original Plan 47-15 changes were integrated in shared commit `6e0db5b`, not an atomic
plan-only commit, because the workspace held overlapping uncommitted edits. This summary records
that deviation rather than inventing an atomic commit. Plan 47-15 is complete at its narrow
governance/inventory boundary. Plan 47-16's fresh review, real spend rails, D6, live traces,
ROUT-02 and Wave 6 remain open; no production/runtime behavior is enabled.
