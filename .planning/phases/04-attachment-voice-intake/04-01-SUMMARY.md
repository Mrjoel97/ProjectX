---
phase: 04-attachment-voice-intake
plan: 01
subsystem: intake
tags: [extraction, classifier, vitest, pure-ts, playbook, watch.json]

# Dependency graph
requires: []
provides:
  - "@pikar/extraction pure-TS package: classify() (image/pdf/audio/document/unknown) + frameForConversation() (attachment frame vs. verbatim dictation)"
  - "docs/playbooks/intake.md — the §9 governance surface for the whole Lane B intake feature"
  - "docs/playbooks/watch.json intake.md key pre-registering packages/extraction/, convex/intake.ts, convex/intakeDb.ts, IntakeControls.tsx"
affects: [04-02, 04-03, 04-04, 04-05, 04-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-TS classifier: magic-bytes > mime > extension trust order, hand-rolled sniff (no file-type dep)"
    - "Conversation-turn framing: attachment kinds get a named-file wrapper, audio/dictation passes through verbatim"

key-files:
  created:
    - packages/extraction/package.json
    - packages/extraction/tsconfig.json
    - packages/extraction/vitest.config.ts
    - packages/extraction/src/index.ts
    - packages/extraction/src/classify.ts
    - packages/extraction/src/classify.test.ts
    - packages/extraction/src/frame.ts
    - packages/extraction/src/frame.test.ts
    - docs/playbooks/intake.md
  modified:
    - docs/playbooks/watch.json
    - pnpm-lock.yaml

key-decisions:
  - "Hand-rolled magic-byte sniff instead of a file-type dependency (ponytail rung 6/3 — the sniff is ~90 lines total across both functions)"
  - "frameForConversation lives in packages/extraction (not convex) so it stays offline-testable per CLAUDE.md §1"

patterns-established:
  - "New pure package scaffold mirrors @pikar/cost exactly (package.json exports/scripts, tsconfig, vitest.config) for future packages/* additions"

requirements-completed: [INTK-02, INTK-03]

# Metrics
duration: 11min
completed: 2026-07-14
---

# Phase 4 Plan 01: Extraction Foundation + Intake Playbook Summary

**Pure-TS `@pikar/extraction` package (magic-byte/mime/extension classifier + conversation-turn framer) plus the `docs/playbooks/intake.md` §9 governance surface covering the entire Lane B intake feature.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-07-14T15:05:31+03:00
- **Completed:** 2026-07-14T15:16:16+03:00
- **Tasks:** 3 completed
- **Files modified:** 11 (9 created, 2 modified)

## Accomplishments
- `classify(bytes, mimeType, filename)` correctly buckets image/pdf/audio/document/unknown from magic bytes (trusted first), mime type, then filename extension — including the MediaRecorder webm/matroska signature that is the INTK-03 dictation-path contract (28/28 tests green, including a mime/bytes-disagree defense-in-depth case).
- `frameForConversation(kind, filename, safeText)` wraps attachment content ("Here is the content of the attached file …") while passing dictation transcripts through verbatim — the transcript IS the request, never wrapped.
- `docs/playbooks/intake.md` created with the three mandated invariants (redact-before-audit/merge, the bounded extraction-model GRDL-01 exception, safeText-only persistence) and `watch.json` pre-registers the whole Lane B surface (`packages/extraction/`, `convex/intake.ts`, `convex/intakeDb.ts`, `IntakeControls.tsx`) so downstream plans in this phase do not trip the §9 Stop hook.

## Task Commits

Each task was committed atomically (Task 2/3 used TDD RED→GREEN):

1. **Task 1: Scaffold @pikar/extraction + intake §9 playbook/watch** - `00d711c` (feat)
2. **Task 2: classify() RED** - `684bb32` (test) → **GREEN** - `003fa8d` (feat)
3. **Task 3: frameForConversation() RED** - `af1e448` (test) → **GREEN** - `999bd42` (feat)

_Plan metadata commit follows this summary._

## Files Created/Modified
- `packages/extraction/package.json` - `@pikar/extraction` package manifest, mirrors `@pikar/cost` shape
- `packages/extraction/tsconfig.json` - extends repo base tsconfig
- `packages/extraction/vitest.config.ts` - run-only vitest config (no watch)
- `packages/extraction/src/index.ts` - public exports (`classify`, `frameForConversation`, types)
- `packages/extraction/src/classify.ts` - pure magic-byte + mime + extension classifier
- `packages/extraction/src/classify.test.ts` - 22 cases across all buckets + defense-in-depth
- `packages/extraction/src/frame.ts` - `frameForConversation` — the synthetic merge turn
- `packages/extraction/src/frame.test.ts` - 6 cases (attachment framing, dictation verbatim, no leak)
- `docs/playbooks/intake.md` - §9 playbook for the whole Lane B intake surface
- `docs/playbooks/watch.json` - new `intake.md` key added (other blocks untouched)
- `pnpm-lock.yaml` - lockfile entry for the new workspace package (required for `pnpm --filter` to resolve)

## Decisions Made
- Hand-rolled the byte sniffer instead of pulling in a `file-type` dependency — the whole classifier is ~90 lines, well within the ponytail "does an already-installed dependency solve it" / "can this be one line" ladder, and keeps the package's only dependency at `vitest` (devDependency).
- Registered the playbook and its four watched prefixes even though `convex/intake.ts`, `convex/intakeDb.ts`, and `IntakeControls.tsx` do not exist yet — intentional per the plan, so plans 02–06 land without re-triggering the Stop hook's "uncovered new file" check.

## Deviations from Plan

None - plan executed exactly as written. `pnpm install` (required to link the new workspace package so `pnpm --filter @pikar/extraction` resolves) is a necessary side effect of package scaffolding, not a deviation from the plan's Task 1 action.

## Issues Encountered
- `node scripts/check-playbooks.mjs` transiently reported `docs/playbooks/skill-registry.md` stale during Task 1's verify — caused by a concurrent sibling plan (04-02) editing `packages/backend/convex/skills.ts` mid-execution in the same shared worktree, not by this plan's files. Logged to `.planning/phases/04-attachment-voice-intake/deferred-items.md` (out-of-scope, self-resolved once 04-02 committed its own playbook bump — confirmed clean on a final re-run: `node scripts/check-playbooks.mjs` now exits with no output/block).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `@pikar/extraction` (`classify` + `frameForConversation`) is ready for 04-02 (attachment-extractor skill) and later plans (04-04 `intake.ts`/`intakeDb.ts`) to import.
- The `docs/playbooks/intake.md` + `watch.json` registration clears the §9 Stop hook for the rest of the Lane B intake surface — plans 02–06 can create `convex/intake.ts`, `convex/intakeDb.ts`, and `IntakeControls.tsx` without needing a new playbook.
- No blockers.

---
*Phase: 04-attachment-voice-intake*
*Completed: 2026-07-14*

## Self-Check: PASSED

All 9 created files verified present on disk; all 5 task commits (00d711c, 684bb32, 003fa8d, af1e448, 999bd42) verified present in git history.
