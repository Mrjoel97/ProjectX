---
phase: 28-connector-backed-revenue-pack
plan: 20
subsystem: revenue-skill-activation
tags: [revenue, skills, exact-pin, eval-gate, activation, fail-closed]
requires:
  - phase: 28-connector-backed-revenue-pack
    provides: Eight byte-pinned dark revenue candidates and complete exact-pin activation evidence from plans 28-28 and 28-19
provides:
  - Exact owner judgments for all eight revenue name@1 pins
  - Three approved exact pins proven through the real activation transition with byte-identical bodies
  - Five failed exact pins durably parked and proven undiscoverable
affects: [28-15, 28-16, 28-21, 28-29]
tech-stack:
  added: []
  patterns: [immutable publication pin plus durable owner decision, offline real-transition activation proof]
key-files:
  created:
    - .planning/phases/28-connector-backed-revenue-pack/28-20-SUMMARY.md
  modified:
    - packages/backend/skills-lock.json
    - packages/backend/convex/skills.test.ts
    - packages/contracts/src/skills/skillBodies.test.ts
    - docs/playbooks/skill-registry.md
    - docs/playbooks/revenue-connectors.md
key-decisions:
  - "APPROVE exactly revenue-call-list@1, revenue-lead-triage@1, and revenue-specialist@1."
  - "PARK exactly revenue-cash-flow@1, revenue-customer-pulse@1, revenue-invoice-reminder@1, revenue-payroll-confidence@1, and revenue-pipeline-review@1 because their complete exact-pin runs failed."
  - "Keep code-owned publication status candidate-only; activation remains a deliberate activateSkill transition and never becomes an implicit fresh-deployment side effect."
patterns-established:
  - "Every owner judgment records the exact name@version, evidence SHA-256, and pin-specific reason."
  - "Approved activation is proved by loading and hashing the active row; parking is proved by both EVAL_GATE refusal and NO_ACTIVE_SKILL discovery refusal."
requirements-completed: []
requirements-blocked: [REVN-04, REVN-05, REVN-06]
duration: 7h 47m including owner checkpoint
completed: 2026-09-01
---

# Phase 28 Plan 20: Version-Specific Revenue Activation Summary

**Three fully-green revenue v1 pins are owner-approved and activation-proven; five red pins are durably parked, fail the activation gate, and remain undiscoverable.**

## Performance

- **Duration:** 7h 47m elapsed including the blocking owner-decision checkpoint
- **Started:** 2026-09-01T02:32:04Z (Task 1 evidence commit)
- **Completed:** 2026-09-01T10:19:10Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Verified Task 1 commit `cd6901d` and re-hashed both immutable evidence artifacts before accepting any owner judgment.
- Recorded the owner's exact three approvals without broadening them, and mandatory-parked every failed pin.
- Exercised the real evidence-recording and activation mutations offline: only the three approved rows became active, their loaded bodies retained the lock-file SHA-256, and all five parked rows stayed unreachable.
- Preserved unrelated shared-tree changes by staging only plan-owned files and only the Plan 28-20 hunk in the already-dirty revenue connector playbook.

## Exact Owner Decisions

| Exact pin | Evidence result | Owner judgment | Durable outcome |
|---|---|---|---|
| `revenue-call-list@1` | PASS | APPROVE | Activation-proven; loaded body SHA-256 `36e760292676ad2a8881cf9d712e78ea595d7f1d9150bbe8a58576d648346c3d` |
| `revenue-lead-triage@1` | PASS | APPROVE | Activation-proven; loaded body SHA-256 `640c210f6fff276a32dbcdfd0093e984452b2264b09db1e7683547823734c9f8` |
| `revenue-specialist@1` | PASS | APPROVE | Activation-proven; loaded body SHA-256 `558cca103e7c298472a7d9f1ff4cd48651c4b08388f4ebadb2dd0ff63c082b24` |
| `revenue-cash-flow@1` | FAIL | PARK | `EVAL_GATE`; no active discovery |
| `revenue-customer-pulse@1` | FAIL | PARK | `EVAL_GATE`; no active discovery |
| `revenue-invoice-reminder@1` | FAIL | PARK | `EVAL_GATE`; no active discovery |
| `revenue-payroll-confidence@1` | FAIL | PARK | `EVAL_GATE`; no active discovery |
| `revenue-pipeline-review@1` | FAIL | PARK | `EVAL_GATE`; no active discovery |

Every decision is bound to activation-evidence SHA-256
`16681ff2ff13b897ee40cac057c24c5e2fc958d5ceebf46131dd690a28857bec`.

## Evidence and Activation Diff

| Artifact / gate | Result |
|---|---|
| Live diagnostic | `C:\Users\expert\AppData\Local\Temp\pikar-revenue-eval-28-19\revenue-candidate-diagnostic.v1.json`, SHA-256 `73c15e0ac9463e77713b202975441a463c0d9bcb743fd3250e0eb05cbcf3f236` |
| Exact-pin handoff | `C:\Users\expert\AppData\Local\Temp\pikar-revenue-eval-28-19\revenue-activation-evidence.v1.json`, SHA-256 `16681ff2ff13b897ee40cac057c24c5e2fc958d5ceebf46131dd690a28857bec` |
| Decision diff | 3 approve, 5 park; no omitted or extra pin |
| Active discovery | Exactly the three approved rows load as v1 |
| Active byte identity | All three loaded body hashes equal their lock pins |
| Parked isolation | All five reject activation with `EVAL_GATE` and reject discovery with `NO_ACTIVE_SKILL` |
| Deployment/provider activity | None; no Convex deployment, provider, or paid-evaluation call ran |

The lock's publication `status` remains `candidate` for all eight pins by design. A fresh deployment
must still publish dark candidates; the durable `activationDecision` records owner intent, while the
existing `activateSkill` mutation remains the sole code path that changes a registry row to active.

## Verification

| Command | Result |
|---|---|
| `pnpm --filter @pikar/backend test -- skills` | **144/144 passed** |
| `pnpm --filter @pikar/contracts test -- skillBodies` | **48/48 passed** |
| `node scripts/check-playbooks.mjs` | **passed** (silent after both playbooks were updated) |
| `git diff --cached --check` before Task 3 commit | **passed** |

## Task Commits

1. **Task 1: Run the complete pinned activation gate and capture evidence** — `cd6901d`
2. **Task 2: Judge exact candidate pins** — owner decision checkpoint; no file or commit by design
3. **Task 3: Apply activation decisions and verify discovery isolation** — `f74e14e`

## Files Created/Modified

- `packages/backend/skills-lock.json` — durable exact-pin approve/park decisions, evidence hash, and pin-specific reasons.
- `packages/backend/convex/skills.test.ts` — real-transition activation, parked isolation, and active-body hash proof.
- `packages/contracts/src/skills/skillBodies.test.ts` — exact closed approve/park set and durable decision metadata guard.
- `docs/playbooks/skill-registry.md` — evidence, exact owner decision, activation diff, and verification record.
- `docs/playbooks/revenue-connectors.md` — connector-backed revenue exposure state and offline proof.

## Decisions Made

- Approved only `revenue-call-list@1`, `revenue-lead-triage@1`, and `revenue-specialist@1`, exactly as the owner stated.
- Mandatory-parked all five red pins; no failed pin was reinterpreted as eligible.
- Kept REVN-04, REVN-05, and REVN-06 pending because their pipeline/customer, finance, and invoice-reminder pins are parked; an activation decision cannot falsely complete capabilities that remain unavailable.

## Deviations from Plan

None in product scope. The plan's activation transition was verified against an in-memory registry rather than a deployment because the continuation explicitly prohibited deployment/provider calls. This preserves the same mutation and discovery behavior without creating external state.

## Issues Encountered

- The shared worktree contained unrelated connector, schema, generated API, and graph edits plus a prior uncommitted Task 3 draft. Every relevant hunk was audited; only the activation-owned files and the isolated Plan 28-20 connector-playbook hunk entered `f74e14e`.
- The first playbook check correctly reported the new activation tests as undocumented. Adding the exact decision and verification record to the owning playbooks made the gate pass.

## User Setup Required

None. The five parked pins require corrected bodies and new complete exact-pin evidence before any future owner judgment; no setup or rerun is implied here.

## Next Phase Readiness

- Plan 28-15 can consume the closed activation set for privacy-safe outcome measurement.
- The five parked workflows remain intentionally unavailable. Any future revision must be a new immutable pin with a new complete evidence run and a new exact owner decision.

## Self-Check: PASSED

- Summary and all five plan-owned implementation/playbook files exist.
- Task commits `cd6901d` and `f74e14e` exist.
- Final playbook check is silent and successful.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-01*
