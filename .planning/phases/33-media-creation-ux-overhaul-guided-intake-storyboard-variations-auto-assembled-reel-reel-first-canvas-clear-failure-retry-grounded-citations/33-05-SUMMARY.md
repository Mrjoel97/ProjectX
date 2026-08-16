---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: "05"
subsystem: media
tags: [convex, render, vault, retention, ordering, vitest, tdd]

# Dependency graph
requires:
  - phase: 33 (plan 33-02)
    provides: plans.reelVaultDocId schema field, per-shot citation fields
  - phase: 33 (plan 33-04)
    provides: render/caption terminals with the retry arm already in place
  - phase: 20-media-canvas
    provides: recordCaptionBurn / recordRender terminals, renderStorageId retention rules
provides:
  - saveReelToVault upsert wired into the caption, degraded and no-captions terminals
  - vaultDocuments.reelMeta refs-only citation metadata (schema)
  - old-final-held-until-new-lands ordering for regenerate-after-done
  - a saved reel is pickable as uploaded_video footage (storedMimeType)
affects: [33-06, 33-08, media, mediaCanvasView, vault]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "persistFindings idiom for the reel doc: direct insert, text = the narration transcript already in hand (no paid ingest, embedding rides free)"
    - "upsert idempotence keyed by plans.reelVaultDocId — one vault doc per plan, patched on re-render"
    - "repoint-then-delete ordering: plan → vault doc → only then delete what nothing references"

key-files:
  created: []
  modified:
    - packages/backend/convex/render/renderReel.ts
    - packages/backend/convex/media.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/media.test.ts
    - packages/backend/convex/llmRedaction.test.ts
    - apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts
    - docs/playbooks/media.md

key-decisions:
  - "The CAPTIONED cut is the artifact of record: the save happens after the plan repoint, so the uncaptioned cut and the doc's previous final become deletable only once both plan and doc have moved off them"
  - "A FAILED burn still saves the degraded uncaptioned reel — it is the deliverable the tenant paid for"
  - "storedMimeType is what the bytes ARE (video/mp4), which is what makes a saved reel immediately pickable as uploaded_video footage"
  - "media.reel_saved audit payload is planId + docId + citations COUNT — the reel's citation list never enters the log plane"

patterns-established:
  - "orphan-blob deletion returns the superseded storageId rather than deleting inline, so the caller deletes only after every reference has moved"

requirements-completed: [33-REEL, 33-CITE]

# Metrics
duration: ~2 sessions (executor terminated by API session limit at the SUMMARY step; closed by the orchestrator)
completed: 2026-08-16
---

# Plan 33-05: Auto-assembled reel — vault save + regenerate ordering

## What shipped

`saveReelToVault` at every pipeline terminal. When the captioned final lands, the reel becomes a
durable tenant vault document whose `text` is the narration transcript already in hand — so it
embeds and becomes groundable for free, with no paid ingest stage. `vaultDocuments.reelMeta`
carries refs-only citation metadata, so months later "where did that number come from?" has an
answer that survives the plan row.

Regenerate-after-done no longer darkens the canvas or dangles a storage reference: the old final
keeps playing until the new one lands, and a blob is deleted only after both the plan and the
vault doc have repointed off it. A finished reel is immediately pickable as `uploaded_video`
footage, because `storedMimeType` records what the bytes actually are.

## Task commits

| Task | RED | GREEN |
|------|-----|-------|
| 1 — saveReelToVault at the terminals | `6497766` | `4723a20` |
| 2 — old final held until the new lands | `3358f90` | `62f4573` |
| 3 — a saved reel is pickable footage | `5afaeee` | `4f287ba` |
| pins — media log-plane widened for `reel_saved` | — | `54535fd` |

## Verification

- `pnpm --filter @pikar/backend test -- llmRedaction` — **83 files / 1884 passed, 24 skipped, 0 red**
  (this scope includes `media.test.ts`, `intake.test.ts` and the governance pins).
- The earlier full-suite `intake.test.ts` reds reproduced the documented shared-fork memory hazard
  and are green in a scoped run — same diagnosis 33-04 recorded.

## Deviation / recovery note

The executing agent was terminated by an API session limit **after** committing all three tasks but
**before** writing this SUMMARY, and it left the suite RED: `saveReelToVault` added a seventh media
audit site without performing the deliberate bump that `llmRedaction.test.ts` demands of every plan
that adds one. The orchestrator closed the gap rather than rubber-stamping it:

- Read the new payload (`planId`, `docId`, `citations.length`) and checked it against §4 — ids and a
  count, no reel text, no storage URL, no citation titles.
- Added `docId` + `citations` to `MEDIA_AUDIT_ALLOWED`, bumped the literals count 10 → 11 and the
  site count 6 → 7 (`renderReel.ts` 3 → 4), each with a comment naming 33-05 — the same discipline
  33-04 followed.
- Re-ran the suite to green before writing this file.

**This is the second time in phase 33 that a governance pin caught a plan's own new log-plane site.**
The pin is doing exactly its job; plans that add an audit site must budget for the bump.
