---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: 03
subsystem: media
tags: [storyboard, variations, citations, money-gate, provenance, persist-terminal, tdd]

# Dependency graph
requires:
  - phase: 33-01
    provides: parseBrief/BriefFields, Scene.source/needsConfirmation, parseVariations — the parse contracts this terminal lands
  - phase: 33-02
    provides: plans schema planes (brief/altShots/deckLockedAt/citation fields), confirmClaim/switchDeck/editBrief
provides:
  - persistStoryboard variations-first — two decks + brief + citations land in ONE persistDeck call; refusal-over-fallback (variationRefusalBody)
  - persistDeck parsedShot validator — accepts source/needsConfirmation, structurally NO confirmedAt (second provenance door)
  - unconfirmed_claims ReserveRefusal — refuses at jobEstimate AND reserveSceneJobInner in the same pre-flight position, deck-wide
  - generateReel lock+discard — deckLockedAt stamped and altShots deleted in the same mutation as a successful reservation
  - sceneCitations tenantQuery — model-authored docIds verified where consumed; foreign/malformed ids inert (verified:false)
affects: [33-05+ canvas plans, skill body v3, save-to-vault plan]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      variations-first parse ordering with refusal-over-fallback one level up,
      whole-deck-write semantics clearing the variation plane and the lock,
      row-read money gate inside the reserve so no caller can bypass it,
      mutation-proof by disabling the reserve-side check and observing money move,
    ]

key-files:
  created: []
  modified:
    - packages/backend/convex/dispatch.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/media.ts
    - packages/backend/convex/dispatch.test.ts
    - packages/backend/convex/media.test.ts
    - docs/playbooks/media.md

key-decisions:
  - "Task 1 tests live in dispatch.test.ts (not media.test.ts): persistStoryboard is only reachable through __runSpecialistWithScript, whose harness lives there"
  - "The reserve-side unconfirmed_claims check reads the plan ROW inside reserveSceneJobInner — no caller can hand it a deck that skips the gate, and regenerateBlock partial buys refuse too"
  - "switchDeck answers deck_locked BEFORE no_alternate — post-Generate the truthful refusal is 'the choice is bought', not 'there is no second deck'"
  - "persistDeck clears deckLockedAt and the alt plane on EVERY whole-deck write — a new proposal is a new choice; brief is drop-undefined so a revision that omits BRIEF keeps the row's"

requirements-completed: [33-INTAKE, 33-VARIA, 33-CITE]

# Metrics
duration: 39min
completed: 2026-08-15
---

# Phase 33 Plan 03: Persist Terminal + Money Gates Summary

**The variations terminal and the confirm gate go structural: persistStoryboard lands brief + two decks + per-scene citations in one persistDeck call whose validator cannot carry confirmedAt; unconfirmed_claims refuses at the estimate and the reserve together (mutation-proven at the reserve); Generate locks the pick, discards the alternate, and sceneCitations verifies model-authored docIds where consumed**

## Performance

- **Duration:** ~39 min
- **Started:** 2026-08-15T18:48:01Z
- **Completed:** 2026-08-15T19:26:41Z
- **Tasks:** 3/3 (all TDD, RED observed before each GREEN)
- **Files modified:** 6

## Accomplishments

- **Task 1 — the variations terminal:** `persistStoryboard` runs `parseVariations` FIRST. `kind:"two"` lands deck A picked (`shots`+`targetDurationSeconds`) and deck B parked (`altShots`+`altTargetDurationSeconds`) in ONE `persistDeck` call — script/art direction off A's OWN slice, brief off the full body, `source`/`needsConfirmation` riding each shot via one shared `sceneShots` mapping. `kind:"refused"` lands a refusal card naming which variation and why (`variationRefusalBody` over a shared `SCENE_WHY` table) — never a silent one-deck fallback. `kind:"one"` is the untouched v2 flow extended to land brief + citations and CLEAR the alt plane and any stale `deckLockedAt` (whole-deck-write semantics). The `parsedShot` validator accepts the citation fields and has structurally NO `confirmedAt`; a test pins the rejection. `deck_persisted` audit gains `variations`/`citedScenes`/`unverifiedScenes` counts, title/claim text proven absent (§4).
- **Task 2 — the confirm gate:** new `ReserveRefusal` member `unconfirmed_claims`. ONE shared predicate (`firstUnconfirmedClaim`) refuses in the SAME pre-flight position at `jobEstimate` (free, with `blockIndex` of the first offending scene) and inside `reserveSceneJobInner` (reading the plan ROW — deck-wide, `regenerateBlock` included, unbypassable by any caller). `confirmClaim` on every flagged scene clears it reactively and the same deck reserves at the same pinned number. **Mutation-proven:** disabling the reserve-side check made the reservation SUCCEED with an unconfirmed claim — money moved, test red — then restored.
- **Task 3 — lock, discard, citations:** `generateReel` scene arm stamps `deckLockedAt` and DELETES `altShots`/`altTargetDurationSeconds` in the same mutation as a successful reservation; a refusal locks nothing. Picked-deck-only invariant pinned: a parked alternate moves neither the estimate lines nor `res.estCents`. `sceneCitations` returns `{sceneIndex, docId, title, verified, needsConfirmation, confirmedAt}` per claiming scene; `verified` = doc exists AND belongs to the tenant (`normalizeId` fail-closed, the `asset.docId` precedent) — a foreign or malformed id is inert.
- media.test.ts 215 passed, dispatch.test.ts 87, plans.test.ts 27 (329 combined green); mediaComplete/cockpit/render suites 89 green; backend `tsc --noEmit` exit 0; playbook updated in-phase.

## Task Commits

Each task committed atomically (TDD: test → feat):

1. **Task 1: persistStoryboard lands brief + variations + citations** — `870dc3a` (test, RED 5/5) + `220ca02` (feat, GREEN)
2. **Task 2: unconfirmed_claims gate at estimate AND reserve** — `4c28b32` (test, RED 4/5) + `7fd6315` (feat, GREEN; reserve-side mutation-proof observed red then restored)
3. **Task 3: Generate locks + discards; sceneCitations** — `550c8d6` (test, RED 4/6) + `efe565b` (feat, GREEN)

**Playbook:** `8d35fab` (docs: media.md — 33-03 hunks only, foreign-lane top-of-file hunks left uncommitted)

## Files Created/Modified

- `packages/backend/convex/dispatch.ts` — parseVariations-first ordering, `sceneShots` shared mapping, `persistSceneDeck` extras (alt/brief), `variationRefusalBody` + extracted `SCENE_WHY` (with the missing `malformed_source` sentence), audit counts
- `packages/backend/convex/plans.ts` — `parsedShot` shared validator (source/needsConfirmation, NO confirmedAt), `altShots`/`altTargetDurationSeconds`/`brief` args, whole-deck-write clears alt plane + `deckLockedAt`, stamps `deckProposedAt`
- `packages/backend/convex/media.ts` — `unconfirmed_claims` refusal at both money sites via `firstUnconfirmedClaim`; generateReel lock+discard; switchDeck lock-first guard order; `sceneCitations` tenantQuery
- `packages/backend/convex/dispatch.test.ts` — 5 new tests (two-deck landing, audit counts, refusal-over-fallback, single-deck revision discard, validator door)
- `packages/backend/convex/media.test.ts` — 8 new tests (confirm gate both sites + regenerate, reactive clear, lock/discard, refused-generate no-op, picked-deck-only pricing pin, citations verified/foreign/malformed/tenant-B)
- `docs/playbooks/media.md` — new Last-verified entry + "The Phase-33 money gates and the variations terminal (33-03)" section

## Decisions Made

- Task 1 tests in dispatch.test.ts rather than media.test.ts: `persistStoryboard` is only exercisable through `__runSpecialistWithScript`, whose scripted-model harness lives there (media.test.ts deliberately does not mount it)
- Reserve-side gate reads the ROW, not the passed scenes: parser `Scene`s structurally cannot carry `confirmedAt`, so `plans.shots` is the only place the answer exists — and reading it inside `reserveSceneJobInner` makes the gate unbypassable and deck-wide
- `switchDeck` guard reorder (`deck_locked` before `no_alternate`): after Generate discards the alternate, both conditions hold, and the lock is the truthful ceiling
- `persistDeck` brief is drop-undefined (a chat revision that omits BRIEF keeps the row's brief), while the deck/alt/lock fields are whole-deck-write (undefined clears)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 tests placed in dispatch.test.ts, not media.test.ts**

- **Found during:** Task 1 (RED)
- **Issue:** the plan's file list named media.test.ts, but persistStoryboard's only harness (`__runSpecialistWithScript`, scripted model, staged media plan) lives in dispatch.test.ts; replicating it in media.test.ts would duplicate the whole setup
- **Fix:** the 33-03 terminal describe (5 tests) added to dispatch.test.ts; Tasks 2–3 tests are in media.test.ts as planned
- **Files modified:** packages/backend/convex/dispatch.test.ts
- **Commit:** 870dc3a

**2. [Rule 2 - Missing] `malformed_source` sentence added to the scene refusal vocabulary**

- **Found during:** Task 1
- **Issue:** 33-01 added the `malformed_source` refusal reason but the dispatch refusal card fell through to the generic "the deck did not parse" sentence
- **Fix:** one entry in the extracted `SCENE_WHY` table ("a scene cited a source in a form I couldn't read back")
- **Files modified:** packages/backend/convex/dispatch.ts
- **Commit:** 220ca02

**3. [Rule 1 - Bug] switchDeck answered `no_alternate` on a locked deck**

- **Found during:** Task 3 (GREEN)
- **Issue:** after Generate discards the alternate, `switchDeck`'s `no_alternate` guard fired before `deck_locked`, misnaming the ceiling ("no second deck" when the truth is "the choice is bought")
- **Fix:** guard order swapped, lock first; the 33-02 locked-with-alternate test still passes
- **Files modified:** packages/backend/convex/media.ts
- **Commit:** efe565b

Otherwise the plan executed as written.

## Issues Encountered

None beyond the deviations above. The two Task 3 invariant pins ("refused Generate locks nothing", picked-deck-only pricing) were green at RED-time by design — they are regression pins whose red-ability comes from the behavior they forbid (the pricing pin goes red if any money site ever reads `altShots`).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The canvas plans (33-05+) can now render: the brief chips (33-02 reads), the two-deck chooser over `altShots` (`switchDeck` until `deckLockedAt`), the confirm chip driven by `jobEstimate.refusal.reason === "unconfirmed_claims"` + `blockIndex`, and citations via `sceneCitations` (unverified entries render as non-clickable)
- The skill-body-v3 plan can teach BRIEF / Source / VARIATION shapes knowing the terminal refuses malformed ones rather than mislanding them
- The model cannot self-confirm through any path introduced this phase: parser type (33-01), persist validator (33-03), and confirmClaim's arg shape (33-02) are three independent doors

## Self-Check: PASSED

All 7 commits (870dc3a, 220ca02, 4c28b32, 7fd6315, 550c8d6, efe565b, 8d35fab) verified in `git log`; all 6 modified files verified on disk; combined suites 329 passed; backend typecheck exit 0.

---

*Phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations*
*Completed: 2026-08-15*
