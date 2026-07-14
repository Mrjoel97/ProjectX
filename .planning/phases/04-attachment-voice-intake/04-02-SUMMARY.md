---
phase: 04-attachment-voice-intake
plan: 02
subsystem: llm
tags: [skill-registry, convex, ocr, prompt-versioning, vitest]

# Dependency graph
requires:
  - phase: 03.3 (Attachment Generation)
    provides: the 5-file skill-mirror pattern (document-drafter precedent) this plan copies
provides:
  - an active `attachment-extractor` registry skill (v1) loadable via `loadSkill`/`getActiveSkill`
  - the canonical OCR/extraction system prompt for the inbound image/PDF `generateText` call
affects: [04-04 (attachment extraction pipeline consumes this skill), 04 (attachment-voice-intake) phase close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "5-file skill mirror (canonical .md -> byte-identical derived .ts -> name const -> seedSkills row -> drift test row), applied for the 5th time, unchanged from the document-drafter precedent"

key-files:
  created:
    - packages/contracts/skills/attachment-extractor.md
    - packages/contracts/src/skills/attachmentExtractor.ts
  modified:
    - packages/contracts/src/skill.ts
    - packages/backend/convex/skills.ts
    - packages/backend/convex/skills.test.ts
    - docs/playbooks/skill-registry.md

key-decisions:
  - "OCR prompt distinguishes verbatim-text-extraction from no-text-visual-description as two mutually exclusive output modes, per the plan's <action> spec"
  - "No skill needed for transcription (audio->text is not a generative prompt) — confirmed, not built here"

patterns-established: []

requirements-completed: [INTK-02]

# Metrics
duration: ~20min
completed: 2026-07-14
---

# Phase 04 Plan 02: Attachment Extractor Skill Summary

**Registered `attachment-extractor` as an active v1 registry skill via the 5-file mirror — the OCR/extraction system prompt for inbound image/PDF intake, with zero hardcoded prompt in convex source (§5) and a green drift test.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-14T12:16:32Z
- **Tasks:** 3/3 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- Authored the canonical `attachment-extractor.md` OCR/extraction system prompt (verbatim text extraction preserving structure; factual visual description when no text; plain-text-only output, no commentary/fences/preamble) plus its byte-identical derived `attachmentExtractorSkillBody` constant and the `ATTACHMENT_EXTRACTOR_SKILL` name const.
- Appended the `attachment-extractor` row to `seedSkills` (append-only — the four existing rows untouched) and the corresponding drift `test.each` row in `skills.test.ts`; the pre-existing active-seed assertion now also covers the new skill.
- Bumped `docs/playbooks/skill-registry.md` (§9): Current-skills list += `attachment-extractor`, `Last verified` -> 04-02.

## Task Commits

Each task was committed atomically (Task 1's files landed inside a sibling plan's commit due to a shared-worktree git-index race — see Deviations):

1. **Task 1: Author the canonical prompt + derived body + name const** — landed in `6e9374f` (sibling 04-03's commit; see Deviations) — files verified present and correct at HEAD
2. **Task 2: Append the seedSkills row + drift test row, prove no-drift + active-seed** - `39e6aae` (feat)
3. **Task 3: Bump skill-registry.md playbook (§9)** - `c1a382d` (docs)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/contracts/skills/attachment-extractor.md` - canonical OCR/extraction system prompt
- `packages/contracts/src/skills/attachmentExtractor.ts` - byte-identical derived `attachmentExtractorSkillBody` const
- `packages/contracts/src/skill.ts` - `ATTACHMENT_EXTRACTOR_SKILL` name const
- `packages/backend/convex/skills.ts` - `seedSkills` array gains the appended row
- `packages/backend/convex/skills.test.ts` - drift `test.each` gains the appended row
- `docs/playbooks/skill-registry.md` - Current-skills list + Last-verified bump

## Decisions Made
- The OCR prompt's output contract treats "extract verbatim" and "describe factually" as mutually exclusive modes selected by whether the attachment has readable text, per the plan's `<action>` spec — no hybrid output (never both a description and the text).
- Confirmed (not built) that transcription needs no registry skill, per the plan objective — audio-to-text is not a generative/creative prompt, so it stays out of scope for this plan.

## Deviations from Plan

### Auto-fixed Issues

None — no Rule 1/2/3 code fixes were needed; the plan's 5-file-mirror recipe applied directly.

### Process Deviations (shared-worktree coordination artifacts, not code defects)

**1. Task 1's files committed under a sibling plan's commit (git-index race)**
- **Found during:** Task 1 commit
- **Issue:** `git add` staged Task 1's three files, but `git commit` hit `index.lock` held by a concurrently-committing sibling plan (04-01/04-03 run in the same worktree per the parallel-wave design). The lock cleared, but by then sibling plan 04-03's own `git add` + `git commit` picked up 04-02's already-staged files alongside its own — Task 1's `attachment-extractor.md`, `attachmentExtractor.ts`, and the `ATTACHMENT_EXTRACTOR_SKILL` const in `skill.ts` landed inside commit `6e9374f` ("feat(04-03): append intakeArtifacts table") rather than a 04-02-authored commit.
- **Fix:** None needed — verified via `git log --stat` and `git diff HEAD` that all three files are present, correct, and match this plan's spec exactly at HEAD. No re-commit (nothing left to stage; a re-commit would be an empty no-op).
- **Impact:** Attribution-only; a structural risk of the "same worktree, no branching" parallelization mode (documented in `CRITICAL_CONSTRAINTS`), not a 04-02 defect. Logged to `deferred-items.md`.

**2. `pnpm --filter @pikar/backend test -- skills` does not narrow to `skills.test.ts`**
- **Found during:** Task 2 verify
- **Issue:** The backend package's `test` script is plain `vitest run` — the trailing `skills` arg is swallowed rather than used as a filename filter, so the plan's verify command runs the FULL 17-file suite. Pre-existing script behavior, not introduced by this plan.
- **Fix:** Ran the intended narrow assertion directly: `npx vitest run convex/skills.test.ts` -> 13/13 green (includes the new attachment-extractor no-drift row and the active-seed coverage).
- **Impact:** Verification intent satisfied via the equivalent scoped command. Logged to `deferred-items.md`; out of this plan's file scope to fix the script.

**3. Full-suite runs flaky under concurrent sibling test/build load**
- **Found during:** Task 2 verify (full-suite fallback runs)
- **Issue:** With sibling wave-1 plans (04-01/04-03) executing concurrently in the same worktree, `cockpitDraft.test.ts`, `cockpitTools.test.ts`, `documentDraft.test.ts`, and `runCockpitAgent.test.ts` intermittently hit vitest's 5000ms default timeout (mock-LLM-loop tests are timing-sensitive under CPU contention). These files are entirely outside this plan's scope (`skills.ts`/`skills.test.ts` only).
- **Fix:** None — out of scope per the deviation-rules scope boundary. Logged to `deferred-items.md`; expected to self-resolve once the wave finishes and phase-close/verify-work re-runs the suite serially.
- **Impact:** No impact on this plan's deliverable — `skills.test.ts` itself is 13/13 green in isolation, both directly and via the full-suite run.

---

**Total deviations:** 0 code auto-fixes; 3 shared-worktree coordination artifacts (all logged, none requiring a code change).
**Impact on plan:** None on the deliverable — attachment-extractor is a correct, active, drift-free registry skill. All three deviations are inherent to the parallel-wave "same worktree, no branching" execution mode, not defects in this plan's work.

## Issues Encountered
None beyond the coordination artifacts documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `attachment-extractor` is seeded (via `seedSkills`) and loadable at runtime for the Plan 04 vision/OCR `generateText` call.
- `docs/playbooks/skill-registry.md` §9 discipline is current; `check-playbooks.mjs` reports `skill-registry.md` itself clean (the one remaining stale-playbook flag, `intake.md`, belongs to sibling plan 04-01/04-03's in-progress work, not this plan).
- No blockers for downstream Plan 04 (extract -> redact -> persist safeText) consuming this skill.

---
*Phase: 04-attachment-voice-intake*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 7 claimed files verified present on disk; all 3 claimed commit hashes (`6e9374f`, `39e6aae`, `c1a382d`) verified present in git history.
