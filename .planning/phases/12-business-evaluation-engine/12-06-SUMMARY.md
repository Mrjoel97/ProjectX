---
phase: 12-business-evaluation-engine
plan: 06
subsystem: agent-runtime
tags: [eval-gate, golden-fixtures, skill-registry, cockpit-agent, grounding, governance, phase-gate]

# Dependency graph
requires:
  - phase: 3.6
    provides: "the EVAL_GATE — a gated candidate activates only against recorded passing eval evidence"
  - phase: 12-02
    provides: "the 7 GATED evaluation/specialist skills (4 rubrics + 3 specialist targets)"
  - phase: 12-03
    provides: "runEvaluation + the evaluations table (the observables the new expect keys read)"
  - phase: 12-04
    provides: "evaluateBusiness / recordScorecardAnswer cockpit tools + the EVALUATION card"
  - phase: 12-05
    provides: "actOnGap → the memo terminal (the acting half verified at this checkpoint)"
provides:
  - "evaluationPresent / findingsPresent / gapCount — three new keys in the eval harness's CLOSED expect vocabulary"
  - "smoke:evaluationCountForThread / findingCountForThread / gapCountForThread (tenant-scoped reads over the evaluations table)"
  - "27-grounded-assessment + 28-healthy-no-gaps golden fixtures (fixture floor 18 → 27)"
  - "cockpit-agent@15 ACTIVE — teaches WHEN to call evaluateBusiness and the store half (recordScorecardAnswer)"
  - "growth-os-diagnostic / swot / lean-canvas / bmc + the 3 specialist targets seeded ACTIVE at v1"
affects:
  - "Phase 13 proactive review — it schedules THIS evaluation engine; the fixtures are its regression floor"
  - "Any future cockpit-agent body edit — it now starts from @15 and must ride the gate"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Anti-vacuous assertion pair: gapCount:0 is only meaningful alongside findingsPresent, because the engine force-clears gaps at zero findings"
    - "Profile-seed grounding: the tenant's own profile-shaped docs are PREPENDED to rag.search results, because top-K is per CHUNK and one large reference doc can monopolise the corpus"
    - "First-seed bootstrap: a GATED skill's FIRST seed lands v1 ACTIVE (rows.length === 0 path); gating costs nothing until the first body EDIT"

key-files:
  created:
    - packages/backend/scripts/eval-cases/27-grounded-assessment.json
    - packages/backend/scripts/eval-cases/28-healthy-no-gaps.json
  modified:
    - packages/backend/scripts/run-eval-golden.mjs
    - packages/backend/convex/smoke.ts
    - packages/contracts/skills/cockpit-agent.md
    - packages/contracts/src/skills/cockpitAgent.ts
    - docs/playbooks/agent-runtime.md
    - docs/playbooks/skill-registry.md

decisions:
  - "findingsPresent added as a THIRD expect key beyond the plan's two: the engine force-clears gaps when there are zero grounded findings (SC #1), so `gapCount: 0` alone passes VACUOUSLY on the honest not-enough-data verdict. Pairing it with findingsPresent is what makes 28-healthy-no-gaps assert health rather than emptiness."
  - "The fixture floor bump (18 → 27) moved from Task 1's commit to Task 2's — raising the floor before the two fixtures exist would have made Task 1's own self-check red."
  - "Only cockpit-agent rode the gate. The 7 Phase-12 rubrics were NEVER SEEDED on this deployment, so their first seed took the rows.length === 0 bootstrap path and landed each v1 ACTIVE — no activateSkill needed, no gate bypassed."
  - "Corrects 12-04's SUMMARY, which inferred the rubrics were 'seeded but gated-not-activated'. They were not seeded at all: `convex dev` alone does not seed — only `pnpm dev` (convex dev --run skills:seedSkills) or `npm run seed` does, and the running watcher predated 12-02 authoring them."

metrics:
  duration: "~120 min (incl. the human-run eval gate + three-part visual verification)"
  completed: 2026-07-25
  tasks_completed: 3
  files_created: 2
  files_modified: 6
  eval_run: "27/27 PASSED, $0.1686, run id ed251c29"
---

# Phase 12 Plan 06: Eval Gate — Assessment Fixtures + Cockpit Teaching Summary

The assessment path is now eval-gated and live: two golden fixtures assert a *cited* finding and an
honest *zero-gap* health verdict against the real model, and `cockpit-agent@15` — the body that teaches
WHEN to call `evaluateBusiness` and to store a stated figure with `recordScorecardAnswer` — went ACTIVE
only through a recorded 27/27 passing run (SC #4). Phase 12's three-part visual debt is paid.

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| 1 | Expect vocabulary + smoke reads | `4a04ca5` |
| 2 | Two golden fixtures + cockpit-agent teaching + fixture floor | `d11d3c0` |
| 3 | Eval gate run + activation + three-part visual verification | — (no code; evidence written to the skill row) |

### Task 1 — the evaluation observables (`4a04ca5`)

`evaluationPresent`, `findingsPresent` and `gapCount` joined the CLOSED `EXPECT_KEYS` vocabulary with a
case each in `evaluateExpect`, reading from the **evaluations table** (the `briefingPresent` seam) rather
than the plan row — an evaluation is not a plan. `smoke.ts` gained the three tenant-scoped reads
(`evaluationCountForThread`, `findingCountForThread`, `gapCountForThread`) threaded through the case
runner on the existing positional-arg precedent. The self-check gained two mutation-checked negatives, and
the unknown-key rejection stayed intact.

### Task 2 — the fixtures + the teaching (`d11d3c0`)

- **`27-grounded-assessment.json`** — the user states a CAC figure → the agent stores it → carry-forward →
  `evaluateBusiness`. Expects `evaluationPresent + findingsPresent + gapCount: 1`: one cited finding
  producing one *real* leverage-ranked gap, not a fabricated one.
- **`28-healthy-no-gaps.json` (SC #2)** — a business with no failing gate: findings present, **zero gaps**.
  The affirmative-healthy outcome is now a first-class eval-tested verdict.
- **`cockpit-agent.md` candidate body** gained two sections: *"Assessing the business"* (intent
  recognition, engine-picks-the-framework unless named, the closed four-value framework enum, "the card
  renders it — do NOT recite it", the honest thin-data instruction, and a **not-on-a-composing-turn**
  regression guard protecting the 25 pre-existing fixtures) and *"Remembering figures the user gives you"*
  (the store half — enumerating the exact scorecard dot-paths the free-form `field` arg accepts, one call
  per field, never record what the user did not say). `cockpitAgent.ts` regenerated byte-identically
  (`skillBodies.test.ts` green). No rubric prose hardcoded in source (§5).

### Task 3 — the gate (human-run, owner-approved)

**`pnpm eval:golden --skill cockpit-agent@15` → 27/27 PASSED, total cost $0.1686, run id `ed251c29`.**

- Both new fixtures passed **first try**: `27-grounded-assessment`, `28-healthy-no-gaps`.
- One retry on the pre-existing flaky `18-briefing-then-action` (not new, not caused here).
- Evidence recorded on `cockpit-agent` v15; `activateSkill` then **ACTIVATED cockpit-agent@15**. Verified
  live: `getActiveSkill` returns version 15 and the body contains `## Assessing the business` +
  `## Remembering figures the user gives you`.
- **The 7 Phase-12 rubric skills needed no `activateSkill`.** They had never been seeded on this
  deployment, and a GATED skill's FIRST seed takes the `rows.length === 0` bootstrap path — each landed
  **v1 ACTIVE**. Verified live: `growth-os-diagnostic` / `swot` / `lean-canvas` / `bmc` all return
  version 1. Gating costs nothing until a skill's first body EDIT, so only `cockpit-agent` rode the gate.

**Correction to 12-04's SUMMARY:** it inferred the rubrics were "seeded but gated-not-activated". They
were **NOT SEEDED AT ALL**. `convex dev` alone does not seed; only `pnpm dev`
(`convex dev --run skills:seedSkills`) or `npm run seed` does, and the running watcher had been started
before 12-02 authored them. The observed symptom (no rubric → fail-closed) was right; the cause was not.

**Visual verification (three parts, owner-run):** 12-04's card states, 12-05's gap → memo → approve →
vault-doc-with-no-email, and 12-06's teaching. Owner verdict: *"Everything worked. I approve."* The
deferred 12-04 checkpoint is therefore **CLEARED**.

## Verification-Driven Fixes (landed outside this plan's tasks, already committed)

Live verification surfaced five real defects. All are committed and are **not** re-done here:

| Commit | Fix |
|--------|-----|
| `d5814ae` | **fix(upload):** shared `resolveMimeType` — Windows reports `File.type` `""` for `.md`, so the allow-list check rejected an allow-listed type. Fixed once at the shared helper, not per caller. |
| `f971613` | **fix(upload):** literal extensions in the `accept` strings — Chrome resolves accept MIME types via the OS registry, which has no `text/markdown` entry, so `.md` was invisible in the file picker. |
| `b5e0f7f` + `7efa4f9` | **feat(intake):** cockpit attachments now persist to the Knowledge Vault (owner-reported gap). Spec: `docs/superpowers/specs/2026-07-25-cockpit-attachments-to-vault-design.md`. |
| `f5c279e` | **fix(eval):** TWO grounding defects in the 12-03 engine — see below. |

`f5c279e` in detail (both were masking the entire assessment):

1. **A large reference PDF monopolised the corpus.** `rag.search` top-K is per **CHUNK**, so grounding
   returned ONE doc (a 300-page book) and the engine honestly reported "not enough data". Fixed by
   prepending the tenant's own profile-shaped docs via the new `internal.vault.profileSeedDocs`.
2. **`fillVault` could never fill `identity.currentOffers`** — its default is an empty array, which is not
   `null`, so the fill guard never fired. `diagnose()` therefore returned **Gate 1 on every**
   vault-grounded run, masking the real constraint.

Verified live on a fresh thread afterwards: `growth-os`, **8 cited findings**, gap = *"Customer doesn't
pay for themselves in 30 days"* → `money-model-designer`. The regression test was **confirmed failing**
against the old guard before the fix landed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] a third expect key, `findingsPresent`**
- **Found during:** Task 1
- **Issue:** The plan specified two keys (`evaluationPresent`, `gapCount`). But 12-03's engine
  **force-clears gaps when there are zero grounded findings** (the no-fabricated-diagnosis guarantee,
  SC #1). So `gapCount: 0` passes **vacuously** on the honest not-enough-data verdict — fixture 28 would
  have asserted "healthy" while actually proving "we know nothing about this business".
- **Fix:** added `findingsPresent` (backed by `smoke:findingCountForThread`) as the anti-vacuous half, and
  both new fixtures assert it.
- **Files modified:** `packages/backend/scripts/run-eval-golden.mjs`, `packages/backend/convex/smoke.ts`
- **Commit:** `4a04ca5`

**2. [Rule 3 - Blocking] the fixture-floor bump moved from Task 1 to Task 2**
- **Found during:** Task 1
- **Issue:** The plan put the `>= 18` → `>= 27` self-check floor bump in Task 1, but the two fixtures that
  make 27 exist only land in Task 2 — Task 1's own `--self-check` verification would have been red.
- **Fix:** the floor bump shipped in Task 2's commit alongside the fixtures. Both tasks' self-checks green.
- **Files modified:** `packages/backend/scripts/run-eval-golden.mjs`
- **Commit:** `d11d3c0`

### Scope boundaries honored

- No rubric prose hardcoded in source; the teaching is a versioned skill body (§5).
- No gated skill activated without recorded passing evidence (SC #4).

## Known Gap — logged, NOT fixed

**Re-running an evaluation in the SAME thread collapses `findingCount` (8 → 1).** Carry-forward preserves
the scorecard **values** but not their **provenance**, so only freshly-filled paths are re-cited. The
workaround is a fresh thread per evaluation. Recorded in `deferred-items.md`; a provenance-carrying
carry-forward is the fix when it matters.

## Carried-Forward Deferred Items (still open)

1. **`convex/audit.test.ts` "auditCounts is not registered"** — pre-existing, unchanged. Full backend
   suite sits at **479/480** because of it. Not claimed fixed.
2. **`pnpm --filter @pikar/backend typecheck` red (~52 errors)** — all in `*.test.ts` files; production
   sources compile clean. Pre-existing.

## Next

Phase 12 is complete: BEVL-01 and BEVL-02 are met and live-verified. `/gsd:verify-work`, then Phase 13
(Proactive In-App Review), which schedules this same evaluation engine on a recurring cadence.

## Self-Check: PASSED

Files verified present on disk: `packages/backend/scripts/eval-cases/27-grounded-assessment.json`,
`packages/backend/scripts/eval-cases/28-healthy-no-gaps.json`,
`packages/backend/scripts/run-eval-golden.mjs`, `packages/backend/convex/smoke.ts`,
`packages/contracts/skills/cockpit-agent.md`, `packages/contracts/src/skills/cockpitAgent.ts`,
`docs/playbooks/agent-runtime.md`, `docs/playbooks/skill-registry.md`.
Commits verified in `git log`: `4a04ca5` (Task 1), `d11d3c0` (Task 2), plus the verification-driven
`d5814ae`, `f971613`, `b5e0f7f`, `7efa4f9`, `f5c279e`.
Gate evidence verified by execution, not assertion: 27/27, $0.1686, run `ed251c29`; `getActiveSkill`
returns `cockpit-agent` v15 carrying both new sections; the four rubric skills return v1.
