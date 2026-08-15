---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: 01
subsystem: media
tags: [storyboard, parser, pure-ts, citations, variations, guided-intake, tdd]

# Dependency graph
requires:
  - phase: 20.2-media-scene-timeline
    provides: parseSceneDeck, Scene/ParsedSceneDeck types, sectionOf/fieldOf idioms in packages/core/src/storyboard.ts
provides:
  - parseBrief + BriefFields — guided-intake BRIEF section parser (preset durations only, defaulted-marker stripping)
  - Per-scene document-level citations — Scene.source {docId,title} / Scene.needsConfirmation from Source lines, malformed_source refusal
  - parseVariations + ParsedVariations/VariationSlice — two-variation body splitter over the unchanged parseSceneDeck, refusal-over-fallback
affects: [33-02 schema, 33-03 persist terminal, 33-04 money gates, canvas plans, skill body v3]

# Tech tracking
tech-stack:
  added: []
  patterns: [null-when-incomplete for UX-optional sections (parseArtDirection precedent), refusal-union for money-adjacent contracts, thin splitter over existing parser (no duplicate scene parsing)]

key-files:
  created: []
  modified:
    - packages/core/src/storyboard.ts
    - packages/core/src/storyboard.test.ts
    - docs/playbooks/media.md

key-decisions:
  - "Source: lines live in the per-scene SCENE PROMPTS blocks (beside Prompt:), not the deck table — the table stays byte-for-byte v2, which is what keeps every existing fixture green"
  - "A Source line that is neither `<title> [doc:<id>]` nor `unverified` refuses the deck (malformed_source) — a citation the parser cannot read must never silently become creative copy"
  - "VariationSlice carries each variation's raw body slice so SCRIPT/ART DIRECTION parse per-variation without cross-contamination"
  - "parseVariations split is order-agnostic (heading positions sorted), one heading without its sibling refuses as no_deck"

patterns-established:
  - "Provenance door at the type level: parser output types must never carry a confirmation timestamp; a @ts-expect-error test guards the door"
  - "Playbook edits on CRLF files via node script with assert-unique single-line anchors + git apply --cached for lane-scoped staging"

requirements-completed: [33-INTAKE, 33-VARIA, 33-CITE]

# Metrics
duration: 32min
completed: 2026-08-15
---

# Phase 33 Plan 01: Storyboard Parse Contracts Summary

**Three free-at-parse surfaces in @pikar/core storyboard.ts — parseBrief (guided intake, preset-only durations), per-scene document-level Source citations with a malformed_source refusal, and parseVariations (two-deck splitter that refuses the whole proposal over any inner refusal)**

## Performance

- **Duration:** ~32 min (resumed session; prior session carried Task 1 RED+GREEN)
- **Started:** 2026-08-15T17:21:42Z (resume)
- **Completed:** 2026-08-15T17:53:00Z
- **Tasks:** 3/3 (all TDD)
- **Files modified:** 3

## Accomplishments
- `parseBrief` + `BriefFields`: BRIEF section via the shared `sectionOf` idiom, null-when-incomplete (parseArtDirection precedent), 15/30/60 presets only, `(defaulted)` markers stripped into a field-name array so the marker can never render as copy
- `Scene` widened with `source?: {docId,title}` and `needsConfirmation?: true`; `Source:` lines read from SCENE PROMPTS blocks by a new `sceneSourcesOf` (shared `parsePrompts` untouched); empty `[doc:]` ids and freehand Source lines refuse the deck (`malformed_source`); parser output carries NO confirmation field — `confirmedAt` is a tenant mutation's word, guarded by a `@ts-expect-error` test
- `parseVariations` + `ParsedVariations`/`VariationSlice`: thin, order-agnostic split at VARIATION A/B headings over the unchanged `parseSceneDeck`; any inner refusal (incl. `no_deck` in a declared variation or a missing sibling heading) refuses the WHOLE proposal — no silent one-deck fallback; bodies without headings return `kind:"one"` and v2 parsing is byte-for-byte unaffected
- Full `@pikar/core` suite green: 974/974 (28 new tests), typecheck clean; `docs/playbooks/media.md` documents all three contracts

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: BRIEF section parser** — `1ccf8dc` (test, prior session) + `14c5465` (feat: prior session's verified GREEN, committed at resume)
2. **Task 2: Per-scene citation lines** — `9f0e304` (test) + `22158c9` (feat)
3. **Task 3: Two-variation body parser** — `f3c0373` (test) + `3701928` (feat)

**Playbook:** `f8b9eff` (docs: media.md, 33-01 hunks only — foreign-lane hunks left uncommitted)

## Files Created/Modified
- `packages/core/src/storyboard.ts` — parseBrief/BriefFields, Scene.source/needsConfirmation, sceneSourcesOf, malformed_source refusal, parseVariations/ParsedVariations/VariationSlice; BRIEF registered as a section token
- `packages/core/src/storyboard.test.ts` — 28 new tests across three describes (round-trips, refusals, composition, provenance-door guard)
- `docs/playbooks/media.md` — new Last-verified entry + "The Phase-33 parse surfaces (33-01)" subsection under the scene-deck section

## Decisions Made
- Source lines parse from the SCENE PROMPTS per-scene blocks, not a new table column — keeps the v2 deck table untouched and reuses the `Scene N` head walk
- Freehand Source lines (no doc token, not "unverified") refuse rather than drop — same never-silently-dropped posture as the empty-id case
- `VariationSlice.body` exposes each variation's raw slice for per-variation SCRIPT/ART DIRECTION parsing downstream

## Deviations from Plan

None — plan executed exactly as written. (Resume note: Task 1's GREEN implementation was found uncommitted in the working tree from the terminated prior session; it was verified green against the committed RED tests and committed as-is, not re-implemented. Foreign-lane changes sharing the working tree — `packages/core/src/render.ts`, `packages/backend/convex/render/*`, `apps/web` MediaCanvas, and the top-of-file media.md hunks — were left uncommitted for their own lane; media.md was staged hunk-selectively via `git apply --cached`.)

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three parse contracts closed and tested; downstream plans (schema, persist terminal, money gates, canvas, skill body v3) can build on `parseBrief`, `Scene.source`/`needsConfirmation`, and `parseVariations` without interpreting model text
- The skill body (media-director.md) does not yet teach BRIEF / Source / VARIATION shapes — that lands in the skill-body-v3 plan; absent sections are legal by contract, so nothing breaks meanwhile

## Self-Check: PASSED

All 7 commits (1ccf8dc, 14c5465, 9f0e304, 22158c9, f3c0373, 3701928, f8b9eff) and all 3 modified files verified on disk; full @pikar/core suite 974/974 green.

---
*Phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations*
*Completed: 2026-08-15*
