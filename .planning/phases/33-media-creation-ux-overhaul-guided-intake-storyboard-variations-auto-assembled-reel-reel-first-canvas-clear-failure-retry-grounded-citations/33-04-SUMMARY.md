---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: "04"
subsystem: media
tags: [convex, render, retry, dead-letter, cost, vitest, tdd]

# Dependency graph
requires:
  - phase: 20-media-canvas
    provides: recordRender terminal, maybeStartRender trigger, batchToRender, the no-retry rule (20-16), MEDIA_SANDBOX_USD_PER_RENDER
  - phase: 33 (plan 33-02)
    provides: plans.renderRetriedAt schema field; setSceneAsset/patchShots content-vs-structural split
provides:
  - TRANSIENT_RENDER_CODES closed 6-member set + isTransientRenderCode + deckStillNeedsJob (@pikar/core/render)
  - one automatic render retry in recordRender (renderRetriedAt CAS, same batch, no dead letter, refs-only audit)
  - media.retryRender FAILED-only manual mutation (latest-batch derivation, failed->rendering CAS)
  - evaluateRenderTrigger (trigger callable without a landing row) + fix-menu re-arm from setSceneAsset/setSceneVisual
  - media.setSceneVisual content-class kind-switch mutation (overlay rules, confirmation survives)
  - render line reserved DOUBLED (MEDIA_SANDBOX_USD_PER_RENDER $0.02 -> $0.04, labeled "render (incl. one retry)")
affects: [33-05, 33-canvas-failure-cards, media, mediaCanvasView]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "once-only guards as status CAS checked-and-set in one serializable mutation (renderRetriedAt; failed->rendering)"
    - "ONE shared predicate (deckStillNeedsJob) for trigger and builder so they cannot disagree"
    - "schedule assertions via _scheduled_functions, state-agnostic (convex-test starts runAfter(0) actions eagerly)"

key-files:
  created: []
  modified:
    - packages/core/src/render.ts
    - packages/core/src/render.test.ts
    - packages/core/src/storyboard.ts
    - packages/cost/src/media.ts
    - packages/cost/src/media.test.ts
    - packages/backend/convex/render/renderReel.ts
    - packages/backend/convex/mediaComplete.ts
    - packages/backend/convex/media.ts
    - packages/backend/convex/media.test.ts
    - packages/backend/convex/llmRedaction.test.ts
    - docs/playbooks/media.md

key-decisions:
  - "Transient set (Claude's discretion): missing_binary, route_unreachable, input_fetch_failed, upload_failed, submit_failed, render_failed; sandbox_timeout and route_rejected classified DETERMINISTIC (structural remedies, not re-rolls)"
  - "Doubled the render line at its one source (0.02 -> 0.04) rather than recording drift; label renamed 'render (incl. one retry)'"
  - "renderRetriedAt is never cleared by manual retry — the automatic retry stays once-per-plan forever"
  - "batchToRender's not_all_succeeded narrowed by deckStillNeedsJob (necessary: the trigger and the builder must agree or a re-armed plan strands at rendering)"
  - "evaluateRenderTrigger gained a hasAssetSource check on the schedule arm: a half-finished fix (upload, no asset) re-holds honestly instead of scheduling a render batchToRender refuses"

patterns-established:
  - "deckStillNeedsJob: a terminal job row holds the reel only while the deck still needs what it bought"
  - "fix-menu mutations re-evaluate the render trigger themselves — free fixes have no landing to re-fire it"

requirements-completed: [33-FAIL]

# Metrics
duration: 71min
completed: 2026-08-16
---

# Phase 33 Plan 04: Failure/Retry Backend Summary

**One auto-retry for transient render codes via a renderRetriedAt CAS in recordRender, a FAILED-only manual retryRender, and the fix-menu re-arm (setSceneVisual/setSceneAsset -> evaluateRenderTrigger) so a held reel resumes from a free fix — with the render line doubled at its one source to pay for the retry sandbox.**

## Performance

- **Duration:** ~71 min
- **Started:** 2026-08-16T00:37:39Z
- **Completed:** 2026-08-16T01:48:46Z
- **Tasks:** 3 (all TDD: RED commit + GREEN commit each)
- **Files modified:** 11

## Accomplishments

- `TRANSIENT_RENDER_CODES` closed set + `isTransientRenderCode` in `@pikar/core/render`, pinned as a LIST with every deterministic code asserted non-transient; unknown strings never retry, `render_failed` is the one named catch-all.
- `recordRender`'s failure arm retries ONCE per plan: transient code + unspent `renderRetriedAt` → set the CAS, keep `renderStatus: "rendering"`, reschedule the SAME batch, one refs-only `media.render_retried` audit, NO dead letter. Second/deterministic failures take the 20-16 fail + dead-letter path byte-for-byte. The retry-twice cap was observed RED on the mutation before implementation.
- `media.retryRender`: FAILED-only, derives the latest batchId from the plan's own `mediaJobs` rows (`nothing_to_render` when none), CASes failed→rendering, audits `media.render_retry_manual`. Deliberately does not clear the auto-retry marker.
- `evaluateRenderTrigger` extracted from `maybeStartRender` (thin wrapper keeps landing behavior); `setSceneAsset` and the new `setSceneVisual` re-call it after a fix on a held plan. Pitfall-6 proven end-to-end: real-trigger hold → switch-to-card → render scheduled AND `batchToRender` builds from the landed siblings (no `stale_inputs`, no `not_all_succeeded`).
- `setSceneVisual`: content-class kind switch (no `shotsChangedAt` — sibling assets stay fresh, the locked "nothing is wasted" decision), overlay required for `text_card` via `isRenderableCardText`, `confirmedAt` survives (narration untouched), closed refusals (`unknown_visual`/`no_deck`/`no_block`/`no_overlay`).
- Money: `MEDIA_SANDBOX_USD_PER_RENDER` doubled once at its single source; both money sites keep reading one constant; `res.estCents === estimate.totalCents` pin unchanged; fixtures updated deliberately (JOB_41 2.43608→2.45608 / 244c→246c; cost 2.462→2.482 / 247c→249c); estimate label is now `render (incl. one retry)`.
- Playbook same-commit updates: dated 20-16 supersession note with the transient set, re-arm map (fix arm → re-arm path), §4.1 money table at $3.0648 → 307c with a dated correction, new 33-04 `Last verified` entry.

## Task Commits

1. **Task 1: Transient-code classification + the retry's money line** — RED `c8aba2f` (test), GREEN `e0e3c80` (feat)
2. **Task 2: One auto-retry CAS + manual retryRender** — RED `ac7f595` (test), GREEN `fc88bf8` (feat)
3. **Task 3: Fix-menu re-arm** — RED `88ae18d` (test), GREEN `050157c` (feat)

## Files Created/Modified

- `packages/core/src/render.ts` — TRANSIENT_RENDER_CODES, isTransientRenderCode, deckStillNeedsJob
- `packages/core/src/storyboard.ts` — hasAssetSource widened to a structural param (shots rows + parser Scenes share one predicate)
- `packages/cost/src/media.ts` — MEDIA_SANDBOX_USD_PER_RENDER 0.02 → 0.04 with the coverage argument
- `packages/backend/convex/render/renderReel.ts` — retry CAS in recordRender; batchToRender terminal check narrowed by deckStillNeedsJob
- `packages/backend/convex/mediaComplete.ts` — evaluateRenderTrigger extraction (+ needed-filter + hasAssetSource hold); maybeStartRender wrapper
- `packages/backend/convex/media.ts` — retryRender, setSceneVisual, rearmAfterFix, setSceneAsset re-arm hook, renamed estimate labels
- `packages/backend/convex/llmRedaction.test.ts` — media log-plane pins widened deliberately (6 audit sites / 10 payload literals, no new keys)
- `docs/playbooks/media.md` — supersession note, re-arm map, money corrections, Last verified
- test files: `packages/core/src/render.test.ts`, `packages/cost/src/media.test.ts`, `packages/backend/convex/media.test.ts`

## Decisions Made

- **Transient set:** `missing_binary`, `route_unreachable`, `input_fetch_failed`, `upload_failed`, `submit_failed`, `render_failed`. `sandbox_timeout` excluded (the operator remedy is "cut blocks or raise the ceiling" — structural); `route_rejected`/`unauthorized`/`not_configured`/`bad_request`/`sidecar_rejected_on_return` excluded (route/runner decisions repeat).
- **Manual retry does not re-grant the auto retry** — "exactly one automatic retry per plan" stays structural forever.
- **A half-finished fix re-holds honestly:** switching to `uploaded_video` with no asset re-evaluates to `incomplete_batch` (via `hasAssetSource` in the trigger) instead of scheduling a render that `batchToRender` is known to refuse — which would strand the plan at `rendering`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] `batchToRender`'s `not_all_succeeded` check narrowed by `deckStillNeedsJob`**
- **Found during:** Task 3 (fix-menu re-arm design)
- **Issue:** The plan's re-arm alone was insufficient — the failed clip's row stays in the batch, so even after the deck no longer needs it, `batchToRender` refused the whole batch `not_all_succeeded` and the "re-arms and renders" must-have could never hold; the re-armed plan would strand at `rendering`.
- **Fix:** In-flight rows still refuse unconditionally; TERMINAL rows refuse only while `deckStillNeedsJob` — the same predicate the trigger uses, exported from core so the two cannot drift.
- **Files modified:** packages/backend/convex/render/renderReel.ts, packages/core/src/render.ts
- **Verification:** pitfall-6 end-to-end test asserts `batchToRender` returns ok with the card scene; existing not_all_succeeded/unlanded tests stay green.
- **Committed in:** 050157c (Task 3 commit)

**2. [Rule 3 - Blocking] llmRedaction media log-plane pins widened**
- **Found during:** Task 2 (new audit events)
- **Issue:** `llmRedaction.test.ts` pins the media audit surface (exactly 4 sites / 8 payload literals); the two new refs-only events made it red — by design.
- **Fix:** Pins bumped deliberately to 6 sites / 10 literals with dated comments; all payload keys were already allow-list members (`planId`, `batchId`, `reasonCode`).
- **Files modified:** packages/backend/convex/llmRedaction.test.ts
- **Verification:** llmRedaction suite green; URL/prompt/narration scans still cover the new literals.
- **Committed in:** fc88bf8 (Task 2 commit)

**3. [Rule 1 - Bug-prevention refinement] `hasAssetSource` signature widened; trigger gained the `hasAssetSource` schedule guard**
- **Found during:** Task 3
- **Issue:** The predicate was typed against parser `Scene` only, and the trigger could schedule a doomed render for a deck whose scene names no asset source (upload without a pick) — leaving the plan stuck at `rendering` with nothing in flight.
- **Fix:** Structural param type (no behavior change for existing callers); `evaluateRenderTrigger` holds (`incomplete_batch`) instead of scheduling when any scene fails `hasAssetSource`.
- **Files modified:** packages/core/src/storyboard.ts, packages/backend/convex/mediaComplete.ts
- **Verification:** "uploaded_video without an asset holds honestly" test; full core suite 1003/1003 green.
- **Committed in:** 050157c (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 missing-critical, 1 blocking, 1 bug-prevention)
**Impact on plan:** All three were required for the plan's own must-have truths to hold; no scope creep. No architectural changes.

## Issues Encountered

- **convex-test runs `runAfter(0)` actions eagerly:** the scheduled `renderReel` executed mid-test and died at `requireEnvMedia` (harmless — before any write), flipping its `_scheduled_functions` state off `pending` racily. Schedule assertions were made state-agnostic (assert the schedule happened and its args, not its fate).
- **Full backend suite showed 9 spurious reds in `intake.test.ts` (+1 file) under `pnpm --filter @pikar/backend test -- media`** — the documented shared-fork memory hazard (a `ForksBaseWorker` error accompanied them). `intake.test.ts` passes 10/10 standalone; all media-relevant suites (media, llmRedaction, mediaIntent) green; backend `npx tsc --noEmit` exit 0.
- Shared working tree: two `git index.lock` collisions with concurrent lanes (waited and retried); foreign commits landed between task commits (`8d469ce`, `65e3ca3`, `698cf6a` etc.) — all commits here used explicit pathspecs, no foreign files swept in.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The failure/retry backend is complete for 33-FAIL's canvas work: failure cards can read `renderReason`, `renderRetriedAt`, and offer `retryRender` + `setSceneVisual`/`setSceneAsset` as the fix menu.
- `media.md` documents the re-arm map and the retry supersession; the 20.2 Nyquist frozen-still issue (`zoompan`) remains a separate open item owned by its own lane (a fix commit `698cf6a` landed concurrently).

---
*Phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations*
*Completed: 2026-08-16*

## Self-Check: PASSED

- All 6 task commits present (c8aba2f, e0e3c80, ac7f595, fc88bf8, 88ae18d, 050157c)
- Must-have artifacts verified on disk: TRANSIENT_RENDER_CODES (core render.ts), renderRetriedAt CAS (renderReel.ts), retryRender/setSceneVisual/evaluateRenderTrigger wiring (media.ts)
