---
phase: 12-business-evaluation-engine
plan: 04
subsystem: api
tags: [convex, cockpit-tools, evaluation, card, ui, brand, deferred-verification]

# Dependency graph
requires:
  - phase: 12-03
    provides: "internal.evaluations.runEvaluation + recordScorecardAnswer + api.evaluations.byThread"
  - phase: 10
    provides: "searchVault tool shape (shape-1 of the two-shapes rule) + SourceCard render precedent"
provides:
  - "evaluateBusiness read-only cockpit tool (closed framework enum, fail-open, capped synopsis) + SMOKE_OP_TOOL entry"
  - "recordScorecardAnswer write tool (quiet, non-plan-gated, refs-only audit) — the 'store' half in the LLM loop"
  - "internal.evaluations.recordScorecardAnswerInternal (explicit-tenantId twin over a shared applyScorecardAnswer helper)"
  - "EVALUATION card in the cockpit workspace — findings + H/M/L chips + citations, ≤5 ranked gaps + more, healthy + not-enough-data states"
affects: [12-05 gap-to-plan acting (wires the 'Act on this' placeholder), 12-06 cockpit teaching + EVAL_GATE (unblocks end-to-end verification)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shape-1 mirror: validated jsonSchema args → readPlan() cross-tenant guard → internal.* action → capped synopsis into the loop"
    - "Closed enum tool args (the setMode precedent) — the model cannot inject prose into a framework selector"
    - "Fail-open tool body (SC1): a runAction hiccup returns an honest 'I couldn't assess' string, never throws out of the governed loop"
    - "Public tenantMutation + internal explicit-tenantId twin sharing ONE helper — the tool loop carries no live identity"
    - "Dumb card renderer over byThread: all four states (findings / healthy / not-enough-data / loading) come from the engine row"

key-files:
  created: []
  modified:
    - packages/backend/convex/llm.ts
    - packages/backend/convex/evaluations.ts
    - packages/backend/convex/cockpitTools.test.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - docs/playbooks/cockpit.md
    - docs/playbooks/business-evaluation.md

decisions:
  - "recordScorecardAnswerInternal added (Rule 3): the tool loop has no live identity, so the public tenantMutation is uncallable from a tool — an explicit-tenantId internalMutation twin shares applyScorecardAnswer so the tenant-scoping logic exists once"
  - "recordScorecardAnswer is a QUIET write: no agentStep, hence no agentSteps.tool-union / SMOKE_OP_TOOL entry (only evaluateBusiness emits a step)"
  - "The 'Act on this' per-gap control ships DISABLED — its handler is plan 05 (acting), keeping 12-04 strictly read-only per the two-shapes rule"
  - "Task 3 visual verification DEFERRED to plan 12-06's human-verify checkpoint — the flow is not yet verifiable (see Deferred Verification below)"

metrics:
  duration: "~35 min (Tasks 1-2) + deferred checkpoint"
  completed: 2026-07-25
  tasks_completed: 2
  tasks_deferred: 1
  files_modified: 6
---

# Phase 12 Plan 04: Cockpit Evaluation Surface Summary

The evaluation engine becomes reachable and visible: a fail-open, closed-enum `evaluateBusiness` read tool
plus a quiet `recordScorecardAnswer` write tool in the cockpit loop, and an EVALUATION card that renders
cited findings with H/M/L confidence chips, leverage-ranked gaps, and visually distinct healthy vs.
not-enough-data states. The end-to-end visual check is deferred to 12-06, which lands the two halves that
make the flow reachable at runtime.

## Tasks Completed

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Register the evaluateBusiness read-tool (+ recordScorecardAnswer) | COMPLETE | `0ce71e0` |
| 2 | EVALUATION card | COMPLETE | `a23ff21` |
| 3 | Verify the EVALUATION card visually (BEVL-01) | **DEFERRED** — see below | — |

### Task 1 — `evaluateBusiness` + `recordScorecardAnswer` (`0ce71e0`)

`buildCockpitTools` gained two tools, both mirroring `searchVault`'s validated-args → `readPlan()`
cross-tenant guard → `internal.*` shape:

- **`evaluateBusiness`** (read-only, shape-1): optional CLOSED framework enum (`swot | lean | bmc |
  growth-os`; absent = engine auto-picks) so the model cannot inject prose. Calls
  `internal.evaluations.runEvaluation` and returns a CAPPED synopsis (`N finding(s), M gap(s), verdict
  "x" — shown as an evaluation card`), explicitly instructing the model to point at the card rather than
  restate findings. Wrapped in try/catch — a `runAction` hiccup returns an honest "I couldn't assess"
  string rather than throwing out of the governed loop (SC1 fail-open). Registered in `SMOKE_OP_TOOL`
  (Pitfall 2). It never proposes or sends — acting is plan 05.
- **`recordScorecardAnswer`** (write, `{ field, value }`): a DIRECT scorecard write of a figure the user
  states about their own business, cited "user-provided", NOT plan-gated (a self-reported fact is not an
  outbound action, so the Approve gate does not apply). Refs-only audit (field name + value fingerprint,
  never the raw figure — §4). Quiet: no agentStep, therefore no tool-union / `SMOKE_OP_TOOL` entry.

Tool `description` strings are split across concatenated literals each <200 chars (§5 scan ceiling).
`cockpitTools.test.ts` asserts both keys are present in `Object.keys(buildCockpitTools(...))`.

### Task 2 — EVALUATION card (`a23ff21`)

`EvaluationCard` subscribes via `useQuery(api.evaluations.byThread, { threadId })` and is a dumb renderer
over the engine row (mirrors the SourceCard/briefing precedent, no new card idiom, no component library).
Renders: framework section headers; per-finding inline citation + `ConfChip` H/M/L pill (teal/released/ink
tokens via the `color-mix` idiom at `globals.css:474` — no hardcoded hex); gaps sorted by `leverageRank`,
top 5 inline with the rest behind a `{n} more` disclosure, each carrying a **disabled** "Act on this"
placeholder (handler = plan 05); the affirmative HEALTHY banner on the `--released` cleared/success token;
and a visually distinct `insufficientBox` "not enough data to assess — add X" state that is deliberately
NOT styled like a gap. No numeric % or viability score anywhere. `docs/playbooks/cockpit.md` updated with
both the tool and the card, `Last verified:` bumped (§9).

## Verification Results (actually run, 2026-07-25)

| Check | Result |
|-------|--------|
| `pnpm --filter @pikar/backend test` | **470/471 tests pass, 39/40 files pass.** Sole failure is the pre-existing `convex/audit.test.ts > "audit.log inserts exactly one row that round-trips"` (`Component "auditCounts" is not registered`) — a carried-forward deferred item, NOT caused by this plan. |
| `convex/cockpitTools.test.ts` | **57/57 pass** — includes the new both-tool-keys assertion. |
| `pnpm --filter web typecheck` | **exit 0**, clean. |
| `node scripts/check-playbooks.mjs` | **exit 0**. |

## Deferred Verification — Task 3 (NOT passed, NOT skipped)

The user ran the Task 3 visual verification. The EVALUATION card **did not appear**: the cockpit answered
"evaluate my business" with plain prose and emitted no activity step. Investigation confirmed the Task 1-2
code is correct and that the defect is in the PLAN's sequencing — 12-04's checkpoint asks for end-to-end
verification of a flow whose two enabling halves both land in plan 12-06.

**Root cause 1 — the agent is never taught the tool exists.**
`packages/contracts/skills/cockpit-agent.md` contains ZERO mentions of evaluate/scorecard/swot/diagnose
(verified: `grep -ciE "evaluat|scorecard|swot|diagnos"` → `0`). Registering a tool in `buildCockpitTools`
makes it *callable*, not *known*. Teaching is a versioned candidate skill body edit under §5 (no hardcoded
prompts) and is plan **12-06 Task 2**.

**Root cause 2 — every framework rubric is seeded but not activated.**
`evaluations.ts:234` loads the rubric with `getActiveSkill(FRAMEWORK_SKILL[chosen])`. All seven Phase-12
rubrics are in `GATED_SKILLS` (`packages/contracts/src/skill.ts:100-115`, verified). Activation happens
only through a recorded passing EVAL_GATE run — plan **12-06 Task 3** (SC #4). So even a tool that *was*
called would hit the fail-closed-if-missing → fail-open path and render no card.

**Resolution:** the visual verification moves to a single COMBINED human-verify at plan 12-06's own
checkpoint — the first point at which the flow can truthfully be verified. 12-06's checkpoint must cover
BOTH plans' visual checks (12-04 card states + 12-06 teaching/gate). Recorded in `deferred-items.md`.

**Explicitly NOT done as a workaround** (owner-directed): no gated skill was activated, no agent teaching
was hardcoded into source (§5), no throwaway seeding scaffolding was added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `recordScorecardAnswer` was uncallable from the tool loop**
- **Found during:** Task 1
- **Issue:** Plan 03 exposed `recordScorecardAnswer` as a `tenantMutation`, which derives `tenantId` from
  live request identity. The cockpit tool loop runs inside an action with no live identity — it carries
  `tenantId` explicitly — so the public mutation could not be called from the tool at all. The plan's
  instruction to "call `internal.evaluations.recordScorecardAnswer` (tenant-scoped)" had no such function.
- **Fix:** Extracted the body into a shared `applyScorecardAnswer(db, tenantId, threadId, field, value)`
  helper (`evaluations.ts:368`) and added an explicit-tenantId `internalMutation` twin,
  `recordScorecardAnswerInternal` (`evaluations.ts:422`). Both the public `tenantMutation`
  (`evaluations.ts:406`) and the internal twin delegate to it, so the tenant-scoping/carry-forward logic
  exists exactly once — no duplicated write path to drift.
- **Files modified:** `packages/backend/convex/evaluations.ts`, `packages/backend/convex/llm.ts`
- **Playbook:** `docs/playbooks/business-evaluation.md` updated in the same commit to document the twin
  and the "the tool loop carries no live identity" reason it exists.
- **Commit:** `0ce71e0`

### Process Deviation

**2. Task 3 checkpoint deferred by explicit owner decision** — see "Deferred Verification" above. Not a
code deviation; a plan-sequencing correction. No `<resume-signal>` approval was given and none is claimed.

## Carried-Forward Deferred Items (still open, NOT fixed here)

Both pre-date this plan and remain in
`.planning/phases/12-business-evaluation-engine/deferred-items.md`:

1. **`convex/audit.test.ts` round-trip test fails** — `Component "auditCounts" is not registered. Call
   "t.registerComponent"`. Re-observed in this plan's run (the 1 failure of 471). Out of scope: unrelated
   to 12-04's changes.
2. **`pnpm --filter @pikar/backend typecheck` is red (~52 errors)** — all in `*.test.ts` files
   (`import.meta.glob` type gap, `WorkflowId` string assignments, `mintClientSecret` drift). Production
   sources compile clean. Out of scope.

Neither is claimed fixed.

## Next

Plan 12-05 wires the "Act on this" gap control (shape-2, plan-gated acting). Plan 12-06 lands the cockpit
teaching (Task 2) + the EVAL_GATE activation (Task 3) and carries the COMBINED 12-04 + 12-06 visual
verification at its checkpoint.

## Self-Check: PASSED

Files verified present on disk: `packages/backend/convex/llm.ts`,
`packages/backend/convex/evaluations.ts`, `packages/backend/convex/cockpitTools.test.ts`,
`apps/web/app/(app)/dashboard/workspace/cards.tsx`, `docs/playbooks/cockpit.md`,
`docs/playbooks/business-evaluation.md`.
Commits verified in `git log`: `0ce71e0` (Task 1), `a23ff21` (Task 2), `97afebf` (checkpoint pause).
Claims verified by execution, not assertion: backend test 470/471, web typecheck exit 0, playbook check
exit 0, `cockpit-agent.md` evaluate-mentions = 0, all 7 rubrics present in `GATED_SKILLS`.
