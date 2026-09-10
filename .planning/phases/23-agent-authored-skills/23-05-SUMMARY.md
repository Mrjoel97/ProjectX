---
phase: 23-agent-authored-skills
plan: 05
subsystem: skill-registry
tags: [convex, owner-authorization, eval-gate, react]
requires:
  - phase: 23-04
    provides: strict current-suite exact-row evaluation evidence
provides:
  - owner-only activation for agent-authored tenant candidates
  - atomic immutable owner approval bound to the exact passing eval run
  - bounded owner and tenant projections that distinguish user and Executive authorship
  - refs-only agent activation audit events and rollback-preserved provenance
affects: [23-06, 23-07, 23-08, 23-09]
tech-stack:
  added: []
  patterns: [author-discriminated activation, atomic approval-and-activation, refs-only provenance]
key-files:
  created:
    - .planning/phases/23-agent-authored-skills/23-05-SUMMARY.md
  modified:
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - apps/web/app/(app)/ops/page.tsx
    - apps/web/app/(app)/ops/tenantSkillReview.test.ts
    - apps/web/app/(app)/dashboard/workspace/SkillAuthoringPanel.tsx
    - apps/web/app/(app)/dashboard/workspace/skillAuthoring.test.ts
    - docs/playbooks/skill-registry.md
    - docs/playbooks/authorization.md
    - docs/playbooks/cockpit.md
key-decisions:
  - Agent activation requires both current exact-row eval evidence and the authenticated owner; neither gate substitutes for the other.
  - Owner approval is created server-side in the same transition as activation and remains immutable across rollback.
  - Ordinary tenant surfaces disclose only author labels while the owner surface receives bounded provenance references.
patterns-established:
  - Activation exports discriminate candidate author before entering the single shared archive/activate transition.
  - Agent approval records bind ownerUserId, approvedAt, and evalRunId to the activated row.
requirements-completed: []
duration: 41m
completed: 2026-08-20
---

# Phase 23 Plan 05: Owner/Eval Agent Activation Summary

Agent-authored tenant skills now become active only through an owner-authenticated, exact-evidence transition that atomically records immutable approval and keeps rollback provenance intact.

## Performance

- **Duration:** 41 minutes
- **Started:** 2026-08-20T10:17:48Z
- **Completed:** 2026-08-20T10:58:37Z
- **Tasks:** 4
- **Files modified:** 9 source/test/playbook files plus this summary
- **Live/paid calls:** 0

## Accomplishments

- Closed the four-cell trust boundary: only `owner=true` plus current exact-row passing evidence activates an agent candidate.
- Kept user and agent activation doors separate, with both author checks feeding the existing single archive/activate transition.
- Added server-owned approval `{ ownerUserId, approvedAt, evalRunId }`, a distinct refs-only `skill.agent_candidate_activated` audit event, and rollback that preserves evidence, approval, bodies, and lineage.
- Extended the bounded owner queue with agent provenance and explicit approval state while ordinary workspace users see only `Authored by you` or `Authored with Executive`.
- Added source guards proving the agent writer and LLM authoring tool cannot name either activation capability.

## Task Commits

1. **Specify the agent/owner activation boundary** — `6ccdcc3` (`test`)
2. **Implement owner- and eval-gated agent activation** — `78a364b` (`feat`)
3. **Specify bounded review surfaces** — `65201f9` (`test`)
4. **Expose bounded owner review and tenant authorship labels** — `fbcc4ba` (`feat`)
5. **Document and guard activation trust boundaries** — `f0dc8d0` (`docs`)
6. **Align the legacy projection contract with the author discriminator** — `b9a7b80` (`test`)

## Verification

- `packages/backend/node_modules/.bin/vitest.CMD run convex/skills.test.ts --maxWorkers=1` — **111/111 passed**.
- `node apps/web/node_modules/vitest/vitest.mjs run ...tenantSkillReview.test.ts ...skillAuthoring.test.ts` — **29/29 passed**.
- `apps/web/node_modules/.bin/tsc.CMD --noEmit` — **passed**, no diagnostics.
- `node scripts/check-playbooks.mjs` — **passed** after restoring the UI mutation.
- `git diff --check` over all plan-owned files — **passed**.
- UI mount-removal mutation — **red as expected** (`1 failed, 15 passed`), then restored to **29/29 green**.
- Backend source guard — **1/1 passed** (`110 skipped`) and asserts the activation export remains `ownerMutation` while the authoring tool names no activation door.

## Decisions Made

- Treat owner authorization and exact current evaluation as independent mandatory inputs.
- Stamp approval exclusively on the server during the successful activation patch; model-authored content cannot supply approval fields.
- Preserve approval and evidence on rollback for forensic continuity rather than erasing the historical authorization decision.
- Render raw Executive provenance only in the owner-only review surface; keep ordinary workspace disclosure identity-free.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated a legacy projection assertion for the new author discriminator**

- **Found during:** Final focused backend verification
- **Issue:** The Phase 21 `myUserSkills` key-set assertion still expected the pre-Phase-23 projection and rejected the intentional `author` field.
- **Fix:** Added `author` to the exact expected projection without weakening any body, evidence, or identity disclosure assertions.
- **Files modified:** `packages/backend/convex/skills.test.ts`
- **Commit:** `b9a7b80`

### Verification Limitation

The planned deliberate backend wrapper downgrade (`ownerMutation` to `tenantMutation`) was not applied: the execution safety reviewer rejected creating even a temporary privilege-escalating source state. The checked-in source-level regression test still directly asserts the owner wrapper and passed. The separate UI mount-removal mutation was executed, observed red, restored, and rerun green.

### Supplementary offline mutation evidence — 2026-09-10

The previously unexecuted backend mutation is now observed through an isolated Vitest module
transform, without ever writing a weakened source file or exposing it to a deployment watcher.
`node scripts/check-phase23-owner-boundary.mjs --self-check` runs the existing behavioral test
`the four cells are non-vacuous: exact current eval AND a real owner are both required` in three
fresh processes. The original module passes (exit 0); the in-memory replacement of precisely
`activateAgentCandidate = ownerMutation` with `tenantMutation` fails (exit 1, `EVAL_GATE` received
where `OWNER_REQUIRED` is required); the fresh original module passes again (exit 0). Thus the test
detects crossing the authorization boundary before the handler's eval gate, rather than merely
scanning source spelling. Fetch is disabled in the sandbox and provider/deployment credentials are
not inherited. No mutation touched any deployment or user row outside convex-test's in-memory DB.

Original source SHA-256 before and after:
`acd5ad34a9011887f9259a28348e792e4be5b38cef08c94ad4196f7a347deded`.
Transformed in-memory module SHA-256:
`8144378667afe31ca97593646ada7aa4e6bc8770edded269c0049d0415b6f4a9`.
The driver is registered in the CI free-gate registry and repeats the control/red/control proof on
future source revisions. This supplements the historical refusal above; it does not rewrite that
session or supply any browser, paid-eval, activation or rollback observation for Plans 23-06–09.

## Issues Encountered

- Workspace-filtered `pnpm exec` did not resolve restored Vitest/TypeScript shims. Package-local binaries and the Vitest module entrypoint ran successfully instead.
- Dependencies were unavailable at the start of execution but were restored before final verification; no network or paid service was used by this plan.
- `.planning/STATE.md` remains pre-existing malformed, so state, roadmap, and requirement completion commands were intentionally not run per orchestration instructions.

## Next Phase Readiness

- Phase 23-06 can consume the strict agent activation boundary and bounded review projections.
- This plan advances `SKILL-02` but does not close it; plans 23-06 through 23-09 and phase verification remain mandatory.
- No product implementation blocker remains.

## Self-Check: PASSED

- All nine plan-owned implementation/test/playbook files exist.
- All six task/fix commits are present in repository history.
- Focused backend, web, TypeScript, playbook, whitespace, source-separation, and restored-mutation checks passed.
- No live tenant state or paid evaluation service was touched.
