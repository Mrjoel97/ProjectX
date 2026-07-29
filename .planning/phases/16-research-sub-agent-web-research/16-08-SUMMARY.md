---
phase: 16-research-sub-agent-web-research
plan: 08
subsystem: research dispatch verification
tags: [research, containment, degradation, audit, lineage, mutation-testing]
requires: [16-05, 16-06, 16-07]
provides:
  - "Offline D11 failure-mode matrix"
  - "Positive research capability-containment proof"
  - "Recursive research audit leak scan and correlation lineage proof"
affects:
  - packages/backend/convex/dispatch.test.ts
  - packages/backend/convex/research.test.ts
  - packages/backend/convex/dispatch.ts
  - packages/backend/convex/evaluations.ts
  - docs/playbooks/cockpit.md
tech-stack:
  added: []
  patterns:
    - "same-turn positive/negative capability proof"
    - "scripted provider failure matrix"
    - "recursive audit payload value scan"
key-files:
  created:
    - .planning/phases/16-research-sub-agent-web-research/16-08-SUMMARY.md
  modified:
    - packages/backend/convex/dispatch.test.ts
    - packages/backend/convex/research.test.ts
    - packages/backend/convex/dispatch.ts
    - packages/backend/convex/evaluations.ts
    - docs/playbooks/cockpit.md
key-decisions:
  - "Hosted provider search remains invisible to agentSteps; only granted local tools emit activity rows."
  - "The governed stop reason is carried through landing so cost, step, and clock incompleteness stay distinct on the approvable card."
  - "Code degradation and prompt quality are separate proofs: 16-08 owns deterministic code behavior; 16-09 owns the eval gate."
requirements-completed: [DISP-02, ACTN-03]
duration: ~44 min
completed: 2026-07-29
---

# Phase 16 Plan 08: Deterministic Research Degradation Summary

The research route now has a mutation-verified, $0 offline proof that withheld capabilities cannot
write, every D11 failure mode has a governed outcome, partial findings survive step/clock/cost
stops, and audit lineage contains hashes/counts/refs rather than questions, URLs, or specialist
prose.

## Tasks Completed

| Task | Commit | Result |
|---|---|---|
| 1. Positive containment | `a22ad14` | In one turn, granted `searchVault` runs and emits a step while `proposePlan`, `setSubject`, and `replyToMessage` cannot move the plan; provider-hosted search contributes sources without emitting a second activity literal. |
| 2. D11 failure matrix | `abd265c` | Scripted tests cover retryable fallback, non-retryable propagation, zero results, contradictions, cost, steps, clock, distinct markers, and the one-literal activity contract. |
| 3. Audit lineage and ledger | `be78fc5` | Recursive §4 scanning proves the exact question hash/source count positive shape and rejects question/URL/`http`/prose; correlation rows reconstruct research dispatch through completion and sum cost to the root. |

## Verification

- `vitest run convex/dispatch.test.ts -t "SC#1 withheld"` → **3/3 passed**.
- `vitest run convex/dispatch.test.ts convex/research.test.ts` → **71/71 passed**.
- `vitest run convex/dispatch.test.ts -t "§4"` → **1/1 passed**.
- `vitest run convex/dispatch.test.ts -t "call tree"` → **2/2 passed**.
- Required mutations were each observed RED and reverted:
  - grant `proposePlan` to research;
  - emit a hosted-search activity row and add its schema literal;
  - throw at the soft wall-clock cutoff;
  - omit the incomplete stop reason from landing;
  - add raw question, source URLs, and specialist prose to `research.persisted`.
- `node scripts/check-playbooks.mjs` inspected the 16-08 cockpit update, then reported a global
  block only for concurrently changed 16-09 eval files awaiting their own
  `docs/playbooks/agent-runtime.md` update. No 16-08-owned playbook was named.

### 16-VALIDATION.md map owned by this plan

- [x] Containment/withheld writes — `dispatch.test.ts -t "SC#1 withheld"`.
- [x] D11 scripted failure matrix — `dispatch.test.ts research.test.ts` (71 tests).
- [x] Hosted-search/local-tool activity distinction — `dispatch.test.ts -t "ONE literal"`.
- [x] Wall-clock partial-result behavior — `dispatch.test.ts -t "wall clock"`.
- [x] Recursive §4 audit scan — `dispatch.test.ts -t "§4"`.
- [x] Correlation lineage reconstruction — `dispatch.test.ts -t "call tree"`.

## Mutation-Verification Ledger

The complete 16-05 through 16-08 ledger is recorded in
`docs/playbooks/cockpit.md` under `Phase 16 — the research degradation contract`. Every row says
`yes`; the section also names the exact proving test for each of D11's six modes and records the
code-proof/prompt-proof split.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Carried `incompleteReason` through the real landing seam**

- **Found during:** Task 2.
- **Issue:** The loop returned `cost | steps | clock`, but `dispatchAndLand` and
  `landSpecialistResult` dropped that reason, so every incomplete plan card rendered the legacy
  cost sentence and the required three-way proof could not be truthful.
- **Fix:** Added the optional closed-union field to `Landing`, the mutation validator, and the
  `specialistMemoBody` call.
- **Files modified:** `packages/backend/convex/dispatch.ts`,
  `packages/backend/convex/evaluations.ts`.
- **Commit:** `abd265c`.
- **Mutation proof:** removing the handoff made both clock and step card assertions RED.

**2. [Rule 3 - Blocking] Registered workflow components in the §4 research terminal harness**

- **Found during:** Task 3.
- **Issue:** Without the existing workflow/workpool test components, `startIngest` failed before
  `research.persisted`, making the required positive `queryHash`/`sourceCount` assertion impossible.
- **Fix:** Registered the same workflow components already used by `research.test.ts`.
- **Files modified:** `packages/backend/convex/dispatch.test.ts`.
- **Commit:** `be78fc5`.

## Deferred Issues

- The repository-wide playbook check currently names only concurrent plan 16-09 eval-runner/case
  changes. Their owner must update `docs/playbooks/agent-runtime.md`; 16-08 did not modify or stage
  those files.

## Self-Check: PASSED

- All five key modified files exist.
- Task commits `a22ad14`, `abd265c`, and `be78fc5` exist in repository history.
- Temporary mutations in `specialists.ts`, `schema.ts`, `llm.ts`, and `research.ts` were reverted
  and were not committed.
