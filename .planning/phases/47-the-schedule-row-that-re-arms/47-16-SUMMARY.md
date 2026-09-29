---
phase: 47-the-schedule-row-that-re-arms
plan: 16
subsystem: recurrence-candidate
tags: [convex-test, edge-runtime, recurrence, isolation, synthetic-evidence]
requires:
  - phase: 47-the-schedule-row-that-re-arms
    provides: Plan 47-15 six-path stage inventory and isolated harness feasibility
provides:
  - Disabled six-file synthetic recurrence candidate with explicit edge-runtime tests
  - Present-source technical review and bounded evidence limits
affects: [ROUT-02, recurrence-D6, recurrence-D8, Wave-6]
tech-stack:
  added: []
  patterns: [separate candidate schema, explicit test-only runner, transactional synthetic claim and admission]
key-files:
  created:
    - packages/backend/candidate/recurrence/schema.ts
    - packages/backend/candidate/recurrence/model.ts
    - packages/backend/candidate/recurrence/model.test.ts
    - packages/backend/candidate/recurrence/tsconfig.json
    - packages/backend/candidate/recurrence/vitest.config.mts
    - packages/backend/candidate/recurrence/README.md
  modified:
    - .planning/phases/47-the-schedule-row-that-re-arms/47-14-STAGE-DECISION.md
    - .planning/phases/47-the-schedule-row-that-re-arms/47-16-TECHNICAL-REVIEW.md
    - docs/playbooks/knowledge-search-routines.md
    - docs/playbooks/watch.json
key-decisions:
  - Retain the accepted, expiring six-file build-for-evidence stage while operational recurrence stays deferred.
  - Treat the 49-test current-source checkpoint as synthetic design evidence only; real rails, D6 and live requirements remain open.
patterns-established:
  - Candidate-to-pure-core schedule reuse with no production or app reverse import.
requirements-completed: []
requirements-open: [ROUT-02]
completed: 2026-09-28
---

# Phase 47 Plan 16: Disabled recurrence candidate summary

**A six-file recurrence candidate exercises Convex transactions and adverse paths under an explicit test-only edge runner while remaining outside the production Convex and app call graphs.**

## Outcome and scope

The original Plan 16 implementation and review have been reconciled against the present source. Exactly six candidate files exist. Their current SHA-256 identities and the ten-file review baseline are in [47-16-TECHNICAL-REVIEW.md](47-16-TECHNICAL-REVIEW.md#current-source-reconciliation--2026-09-28). The stage artifact remains `accepted`, expires 2026-12-31, lists only those six paths and forbids tenant activation, production deployment, provider and paid calls, external writes and sends. The historical operational decision remains `defer`.

The candidate schema is separate from production. The model imports the pure core schedule helper; no production Convex, web or core module imports the candidate. The explicit Vitest config discovers `model.test.ts` in edge runtime; the backend default runner and TypeScript project exclude it. The manually invoked due and recovery entry points have no registered caller. The playbook watch covers the candidate prefix.

Current tests cover structured material changes, one claim across a repeated wall hour, five-minute grace and no burst, overlap, bounded sweep/recovery, retry and unknown paid-effect quarantine, pause/version fencing, synthetic fixed-envelope rails, refs-only audit/dead-letter, synthetic per-run human approval and no outbound fetch in the exercised preparation path. Three later tests probe installed limiter component admission/replay/rollback inside one isolated `convex-test` transaction. They do not connect the candidate reducer to that component or prove keyed terminal release.

## Verification on current bytes

| Command or check | Exit / result |
| --- | --- |
| Explicit candidate Vitest | 0; 49/49 |
| `routineDecision`, `routines`, `dstProbe`, `schema` Vitest | 0; 149/149 |
| Candidate and backend TypeScript | 0 each |
| Historical matrix / eligibility / defer validation / stage validation | **0/1/0/0**; refusal has 14 findings |
| Gate self-check and current-source-review self-test | 0 each; gate 32/32 |
| Strict planning, playbook, claim-capability and diff checks | 0 each |

The original 9/9 review and its SHA-256 table are historical. The current 49/49 result binds only the six hashes in the dated technical review. The installed limiter probe is bounded to same-transaction admission and rollback; actual per-run reserve/lookup/release, cross-window compensation, paid-result authentication and operator reconciliation are still missing. ADR-051/052 conditionally reconcile sweep-only D6 wording but do not prove the deployed selector, real rails or external-action admission. Real DST, seven-day OAuth expiry/reconnect and unattended provider-read traces remain separate requirements. No D1–D8, D6, D8, `enable-safe`, ROUT-02, release or Wave 6 completion is claimed.

## Task disposition and deviations

Tasks 1 and 2 are satisfied by the current exact stage boundary and six-file candidate. Task 3's source/reachability and evidence-limit review is recorded in the dated technical review. No Plan 16 failure condition was found; the fail-closed revocation protocol was not invoked. No external service setup, deployment, provider call, paid call or send occurred in this reconciliation.

This is retrospective plan-record closure in a shared worktree, not a claim that Plan 16's historical tasks had separate atomic commits. The source was already present and clean when reconciliation began; this pass changed only the technical review and this summary. No commit, push, STATE, ROADMAP or requirement completion update was made by this scoped agent.

## Next boundary

The disabled candidate can inform later design review. ROUT-02 and Wave 6 remain open until separate real integration, live evidence, eligibility and owner release decisions meet their own gates.

## Self-Check: PASSED for scoped artifacts

All six candidate files, the technical review and this summary exist. The six SHA-256 values still match the current-source review, the governance exits were 0/1/0/0, and `git diff --check` exits 0. The ROADMAP/STATE metadata now records canonical 11/13 Phase 47 progress, and strict planning passes again. The retrospective record does not claim historical task-atomic commits.
