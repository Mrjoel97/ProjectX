---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: 02
subsystem: media
tags: [schema, plans-row, variations, citations, provenance, tenant-mutations, tdd]

# Dependency graph
requires:
  - phase: 33-01
    provides: parseBrief/BriefFields, Scene.source/needsConfirmation, parseVariations — the parse contracts this state persists
  - phase: 20.2-media-scene-timeline
    provides: sceneDeckOf/patchShots/structural-vs-content split, shotElement fields, TARGET_DURATIONS
provides:
  - plans schema widened (all optional): brief plane (brief/briefChangedAt/deckProposedAt), variation plane (altShots/altTargetDurationSeconds/deckLockedAt), per-shot citation fields (source/needsConfirmation/confirmedAt), renderRetriedAt, reelVaultDocId
  - shared shotElement validator const — shots and altShots cannot drift
  - editBrief / switchDeck / confirmClaim tenant mutations
  - confirmation-invalidation wired into editBlockNarration (a changed claim is unconfirmed)
affects: [33-03 persist terminal, 33-04 money gates, 33-05+ canvas plans, skill body v3, save-to-vault plan]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      shared element-validator const for paired deck arrays,
      provenance door at the arg-validator shape (args cannot carry actor/timestamp),
      structural-stamp on deck switch (landed assets belong to the deck that bought them),
      mutation-proof by deleting a guard and observing RED,
    ]

key-files:
  created: []
  modified:
    - packages/backend/convex/schema.ts
    - packages/backend/convex/media.ts
    - packages/backend/convex/media.test.ts
    - docs/playbooks/media.md

key-decisions:
  - "editBrief refuses no_brief when the plan has no brief — inventing one from a client patch would launder a client object into 'what the user asked for'"
  - "switchDeck clears the render in addition to stamping shotsChangedAt — the rendered final.mp4 is the OTHER deck's artifact (clearRender's stale-lie rule)"
  - "confirmClaim uses a direct targeted shots patch, NOT patchShots — confirmation is neither structural (no shotsChangedAt) nor a content change (no render clear)"
  - "confirmClaim audit row gets a fresh correlationId (the blueprint.confirmed idiom) with payload {planId, sceneIndex} only"
  - "Invalidation lives in editBlockNarration's map, this scene only, and only on a REAL text change; no overlay editor exists yet — a comment marks that a future one must clear the same way"

requirements-completed: [33-INTAKE, 33-VARIA, 33-CITE]

# Metrics
duration: 43min
completed: 2026-08-15
---

# Phase 33 Plan 02: Plan-Row State + Governed Mutations Summary

**Widened the plans row with the brief / two-deck variation / per-scene citation planes (all optional, widen-only) and shipped the three governed writes — editBrief, switchDeck, and confirmClaim, the provenance front door whose args structurally cannot carry an actor or timestamp**

## Performance

- **Duration:** ~43 min
- **Started:** 2026-08-15T17:56:31Z
- **Completed:** 2026-08-15T18:39:41Z
- **Tasks:** 3/3 (Tasks 2–3 TDD, RED observed before GREEN)
- **Files modified:** 4

## Accomplishments

- **Schema (Task 1):** the `shots` element validator extracted into ONE shared `shotElement` const feeding both `shots` and `altShots` (no hand-copied drift); brief plane (`brief{topic,durationSeconds,audience?,tone?,brandVoice?,defaulted[]}`, `briefChangedAt`, `deckProposedAt`); variation plane (`altShots`, `altTargetDurationSeconds`, `deckLockedAt`) with the refused anti-pattern documented in place (no `decks[]` index the money path reads); citation fields ON the shot element (`source{docId,title}`, `needsConfirmation`, `confirmedAt`) so reorder/delete/switch carry them for free; `renderRetriedAt` + `reelVaultDocId`. Every field optional — no migration, existing rows read correctly.
- **editBrief (Task 2):** merges the chip patch into the brief plane only, strips edited fields from `defaulted`, stamps `briefChangedAt`; refuses `illegal_duration` (non-TARGET_DURATIONS), `deck_locked`, `no_brief`. Provably never moves `targetDurationSeconds` or `shots` (asserted byte-equal in the test).
- **switchDeck (Task 2):** swaps `shots`↔`altShots` and both targets in ONE patch, stamps `shotsChangedAt` (structural — landed assets belong to the deck that bought them), clears the render; refuses `no_alternate` / `deck_locked`. Switch-twice round-trips byte-for-byte. `sceneDeckOf` + `jobEstimate` — textually untouched — price whichever deck is picked (200¢ of clips before the switch, 120¢ after, from the same query).
- **confirmClaim (Task 3):** args are `planId` + `sceneIndex` ONLY; an extra `confirmedAt` or `actor` in the call is a validator error (tested). Requires `needsConfirmation === true` (`not_a_claim` otherwise, `no_block` for a missing scene); idempotent re-confirm; direct targeted patch with no `shotsChangedAt` and no render clear; one insert-only audit row `media.claim_confirmed` with a pinned refs-only key set — the claim text and source title proven absent from the serialized row.
- **Invalidation:** a REAL narration edit of a confirmed scene clears `confirmedAt` (keeps `needsConfirmation` + `source`); re-saving identical text clears nothing; reorder/delete leave siblings' confirmations riding their own shot element through `patchShots`.
- media.test.ts 204 passed / 24 skipped, backend `tsc --noEmit` clean; both `deck_locked` guards mutation-proven (deleting either sent its test RED, observed, restored).

## Task Commits

1. **Task 1: Widen the plans schema** — `8941f47` (feat)
2. **Task 2: editBrief + switchDeck** — `a25a9b3` (test, observed RED 11/11) + `a9ab521` (feat, GREEN)
3. **Task 3: confirmClaim** — `2d74b1a` (test, observed RED 8/8) + `43770c0` (feat, GREEN)

**Playbook:** `6cb75e9` (docs: media.md, 33-02 hunks only — foreign-lane top-of-file hunks left uncommitted)

## Files Created/Modified

- `packages/backend/convex/schema.ts` — shared `shotElement` const; brief/variation/citation/retry/vault-ref planes, all optional
- `packages/backend/convex/media.ts` — `editBrief`, `switchDeck`, `confirmClaim` tenantMutations; confirmation-invalidation in `editBlockNarration`; TARGET_DURATIONS import
- `packages/backend/convex/media.test.ts` — 19 new tests across three describes (brief plane, deck swap, provenance front door), plus `seedAltDeck`/`seedClaim` fixtures
- `docs/playbooks/media.md` — new Last-verified entry + "The Phase-33 plan-row planes (33-02)" subsection with the provenance question answered per stored field

## Decisions Made

- `no_brief` refusal instead of creating a brief from the patch — a client-supplied object must not become "the user's ask"
- `switchDeck` clears the render (beyond the planned stamp) — the rendered reel is the other deck's artifact; showing it beside the swapped-in deck is the exact stale-final.mp4 lie `clearRender` exists to prevent
- `confirmClaim` bypasses `patchShots` deliberately: no renumber needed, and `patchShots` unconditionally clears the render, which a confirmation must not do
- Audit actor is the tenant (the `plan.canceled` idiom) with a fresh `correlationId` (the `blueprint.confirmed` idiom)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixture used a clip length the pinned model cannot produce**

- **Found during:** Task 2 (GREEN run)
- **Issue:** the alternate-deck fixture used a 10 s `generated_video` scene; 10 s is not in the Sora duration grid, so `jobEstimate` correctly refused `illegal_duration` and the money-path test failed
- **Fix:** fixture changed to a 12 s clip + 3 s still (15 s total, both legal); expected clips line updated 150¢ → 120¢
- **Files modified:** packages/backend/convex/media.test.ts
- **Commit:** a9ab521 (folded into the GREEN commit)

Also minor: the extra-arg rejection test's expected message was corrected to convex-test's actual wording (``Unexpected field `confirmedAt` in object``) — same commit class, `43770c0`.

Otherwise the plan executed as written. `switchDeck`'s render clear is an addition argued from the existing `clearRender` invariant (documented above).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 33-03 (persist terminal) can now write the brief plane, both decks, and per-scene citation fields against a schema that accepts them; `deckProposedAt` is its stamp to write
- 33-04 (money gates) owns setting `deckLockedAt` at Generate — both refusal paths (`editBrief`, `switchDeck`) are already tested against it
- The save-to-vault and retry plans have `reelVaultDocId` / `renderRetriedAt` waiting; nothing writes them yet, and absence reads correctly as "never"
- The money path (`sceneDeckOf`, `jobEstimate`, `reserveSceneJobInner`) is textually untouched by this plan — verified by the pricing test that flips decks under the same query

## Self-Check: PASSED

All 6 commits (8941f47, a25a9b3, a9ab521, 2d74b1a, 43770c0, 6cb75e9) and all 4 modified files verified on disk; media.test.ts 204/204 green; backend typecheck clean.

---

*Phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations*
*Completed: 2026-08-15*
