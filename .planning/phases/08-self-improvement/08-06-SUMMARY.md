---
phase: 08-self-improvement
plan: 06
subsystem: web
tags: [ui, feedback, ops, optimizer, kill-switch, eval-gate, IMPR-01, IMPR-02, IMPR-03]

# Dependency graph
requires:
  - phase: 08-self-improvement
    provides: feedback.submitFeedback/undoFeedback/myFeedback (Plan 02 — the mutations the control calls)
  - phase: 08-self-improvement
    provides: skills.activateSkill/EVAL_GATE + insertCandidate candidate rows (Plan 01/05 — what the panel activates)
  - phase: 08-self-improvement
    provides: optimizerConfig.getOptimizerConfig/setOptimizerConfig single-row kill switch (Plan 01)
provides:
  - "cards.tsx FeedbackControl — thumbs±comment on the delivered ReportCard sent rows, editable/undoable, keyed by requestId"
  - "plans.reportForPlan now returns requestId (r._id) — the row id the feedback keys off"
  - "skills.activateCandidate (owner-gated) + candidatesForReview (before/after+evidence) + the shared activateSkillVersion EVAL_GATE helper"
  - "optimizerConfig.getOptimizerStatus + setOptimizerEnabled — public ops-page wrappers over the same single row"
  - "ops/page.tsx Optimizer section — kill-switch toggle + candidate review/activate panel with unified body diff"
affects: [08-08 dry-run (the owner activate click this panel provides is the end of the export→SkillOpt→eval→writeback→activate seam)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The EVAL_GATE flip is defined ONCE (activateSkillVersion) — activateSkill (internal) and activateCandidate (owner/tenant) both route through it, never a second copy of the gate (CLAUDE.md §8)"
    - "The optimizerConfig upsert is defined ONCE (writeConfig) — the internal CI mutation and the public ops toggle write the same single row through it"
    - "Owner gate in the single-user MVP = tenantMutation/tenantQuery (an authenticated identity is required); the skills/optimizerConfig registries are global rows the identity just guards access to"
    - "Feedback selection is never colour-only (aria-pressed + weight + ✓); the toggle is a real role=switch with aria-checked (BRAND §6)"

key-files:
  created: []
  modified:
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/app/(app)/ops/page.tsx
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - packages/backend/convex/optimizerConfig.ts
    - packages/backend/convex/optimizerConfig.test.ts
    - packages/backend/convex/plans.ts

key-decisions:
  - "Feedback renders ONLY on sent (delivered) rows — a non-sent row is not a real outcome to rate, and only a sent row carries the attributable skillVersion (Plan 02) the rating scores"
  - "activateCandidate reuses the shared activateSkillVersion gate rather than duplicating the EVAL_GATE — an unevaluated gated candidate is refused from the UI exactly as from the runner"
  - "candidatesForReview returns BOTH bodies (fromBody+toBody) so the before/after diff renders without a second fetch, plus gatePassed so the panel pre-warns an Activate the gate will refuse"
  - "The before/after diff is a plain positional line compare (no diff library, ponytail-flagged ceiling) — LCS only if reviewers find the tail-misalignment noisy"

requirements-completed: [IMPR-01, IMPR-02, IMPR-03]
requirements-contributed: []

# Metrics
duration: ~11min
completed: 2026-07-24
---

# Phase 8 Plan 06: Feedback Control + Optimizer Ops Panel Summary

**The human controls land on surfaces the owner already uses: a thumbs±comment feedback control (editable/undoable, keyed by requestId) on the delivered ReportCard sent rows, and an Optimizer section on the Phase-7 ops page — a role=switch kill toggle bound to optimizerConfig.enabled plus a candidate-review panel that shows the before/after skill-body diff + triggering evidence and a one-click Activate that routes through the SAME shared EVAL_GATE as the runner (an unevaluated gated candidate cannot go live).**

## Performance

- **Duration:** ~11 min
- **Tasks:** 2
- **Files modified:** 7 (0 created, 7 modified)

## Accomplishments

- **FeedbackControl (Task 1, cards.tsx)** — two thumb buttons + an optional single-line comment (revealed on thumbs-down, the qualitative "why" SkillOpt needs), wired to the Plan-02 `feedback.myFeedback`/`submitFeedback`/`undoFeedback`. Clicking the opposite thumb EDITS; clicking the selected thumb again UNDOES; the comment saves on blur/Enter. Selection is not colour-only — `aria-pressed` + fill/weight + a `✓` (BRAND §6). Rendered ONLY on `sent` rows. ponytail: no debounce/optimistic cache — Convex reactivity re-renders `myFeedback` after every mutation.
- **reportForPlan now exposes requestId (plans.ts)** — the ReportCard row carried `correlationId` but not the `requests._id` the feedback keys off; added `requestId: r._id` so a rating attributes to the exact skillVersion copied onto that row at executePlan (blocking prerequisite, deviation Rule 3).
- **Shared EVAL_GATE helper + activateCandidate (Task 2, skills.ts)** — factored `activateSkill`'s core (target lookup + EVAL_GATE + archive-current + activate-target) into ONE `activateSkillVersion(ctx,name,version)` helper; `activateSkill` (internal) and the new owner-gated `activateCandidate` (tenantMutation) both call it, so the gate is defined once (CLAUDE.md §8 root-cause). Added `candidatesForReview` — the newest candidate per gated skill with `{ name, fromVersion, fromBody, toVersion, toBody, evidence, gatePassed }` (the before/after + evidence + a gate pre-warning).
- **Optimizer config wrappers (optimizerConfig.ts)** — factored the upsert into a shared `writeConfig`; added public `getOptimizerStatus` (tenantQuery, default-on-read DORMANT) + `setOptimizerEnabled` (tenantMutation) that flip the SAME single row the internal CI mutation and eligibility check read.
- **Optimizer ops section (ops/page.tsx)** — a `role="switch"` kill toggle (aria-checked, On/Dormant word + knob) bound to `optimizerConfig.enabled`, and a candidate-review panel: fromVersion→toVersion header, a `<details>` unified body diff (plain positional line compare, no library), the recorded evidence, and an Activate button that surfaces an EVAL_GATE refusal inline (`role="alert"`, never swallowed).

## Task Commits

1. **Task 1: feedback control on the delivered ReportCard rows** — `eda0b9e` (feat) — FeedbackControl + reportForPlan requestId.
2. **Task 2: optimizer panel on the ops page** — `dba9cb6` (feat) — shared gate helper + activateCandidate/candidatesForReview, optimizer wrappers, ops Optimizer section, tests.

## Files Created/Modified

- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — `FeedbackControl` + `ReportRow`/`RequestId` types; rendered on sent rows.
- `apps/web/app/(app)/ops/page.tsx` — `unifiedDiff` + `OptimizerPanel` + the Optimizer section.
- `packages/backend/convex/skills.ts` — `activateSkillVersion` shared helper, `activateCandidate`, `candidatesForReview`.
- `packages/backend/convex/skills.test.ts` — 4 new cases (gate refusal, passing-evidence flip, owner-gate, candidatesForReview shape).
- `packages/backend/convex/optimizerConfig.ts` — `writeConfig` shared upsert, `getOptimizerStatus`, `setOptimizerEnabled`.
- `packages/backend/convex/optimizerConfig.test.ts` — 3 new cases (owner read, flip-same-row, owner-gate).
- `packages/backend/convex/plans.ts` — `requestId: r._id` on the reportForPlan return.

## Decisions Made

- **Owner gate = tenantMutation/tenantQuery** — in the single-user MVP an authenticated identity IS the owner; the skills/optimizerConfig rows are global, the identity just guards UI access. `activateCandidate`/`setOptimizerEnabled` need a public callable, so the tenant wrappers (CLAUDE.md §2) are the sanctioned path.
- **One gate, one upsert** — reused rather than duplicated: `activateSkillVersion` and `writeConfig` are each defined once; the new public functions are thin wrappers. A second copy of the EVAL_GATE would be the exact §8 slop the plan forbids.
- **Diff is a plain positional line compare** — no diff dependency added; the ceiling (tail misalignment on an inserted line) is ponytail-flagged with the LCS upgrade path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] reportForPlan did not expose the requestId the feedback control keys off**
- **Found during:** Task 1
- **Issue:** The plan's interface note assumed each ReportCard row's `_id` is available as the requestId, but `plans.reportForPlan` returned only `{ recipient, status, correlationId, messageId, attachments }` — no `requests._id`. Without it the feedback mutations (`v.id("requests")`) can't be wired.
- **Fix:** Added `requestId: r._id` to the reportForPlan return object (plans.ts, watched by cockpit.md — not in the plan's files_modified, but the minimal correct plumbing for Task 1).
- **Files modified:** packages/backend/convex/plans.ts
- **Commit:** eda0b9e

## Authentication Gates

None — no external service configuration. Live paint + the activate flow are owner-verified in Plan 08's dry-run checkpoint (per the plan's NOTE).

## Issues Encountered

- **Pre-existing Biome baseline (untouched):** `cards.tsx` `useHookAtTopLevel` at `ResolutionCard`'s `useContacts` (a `use`-prefixed local function the rule-of-hooks heuristic false-flags) is the sole lint error and reproduces on base — documented in prior summaries. My changes add ZERO new Biome errors (formatting + import-order auto-fixed via `biome check --write`).
- **Pre-existing backend non-regression:** the `convex/lib/functions.ts:25` TS2322 remains the only backend source tsc error (documented 08-01); my touched source adds none — verified by the running convex dev regenerating codegen and the green web typecheck resolving the new api types.

## Verification

- `pnpm --filter @pikar/backend` skills + optimizerConfig suites → **48/48 green** (41 skills incl. 4 new, 7 optimizerConfig incl. 3 new).
- `pnpm --filter @pikar/web typecheck` → **clean** (the ops page resolves the regenerated `candidatesForReview`/`activateCandidate`/`getOptimizerStatus`/`setOptimizerEnabled`/`requestId` api types).
- The EVAL_GATE lives in ONE helper (`activateSkillVersion`) shared by `activateSkill` + `activateCandidate` — asserted by the `activateCandidate` gate-refusal test.
- Feedback renders only on sent rows; the toggle flips the same single optimizerConfig row the internal read sees.

## User Setup Required

None.

## Next Phase Readiness

- The human seam is built: feedback on the delivered response + the kill switch + one-click gated activation with before/after + evidence on the existing ops page. Plan 08's dry-run exercises the whole loop (export → SkillOpt → held-out eval → candidate write-back → this owner Activate) and owner-verifies the live paint.
- **Playbook/watch.json for all of Phase 8 remain centralized in Plan 08-08** (deliberately untouched here — the check-playbooks hook self-clears on the second stop, per the plan's environment note).

## Self-Check: PASSED

Both task commits (eda0b9e, dba9cb6) are present in git history; all seven modified files carry the changes (verified by the green test runs + web typecheck that import them).

---
*Phase: 08-self-improvement*
*Completed: 2026-07-24*
