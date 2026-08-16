---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: "07"
subsystem: media
tags: [react, ui, brand, derivations, vitest, tdd, a11y, intake, variations]

# Dependency graph
requires:
  - phase: 33 (plan 33-01)
    provides: the parsed brief and the two-deck variation parse
  - phase: 33 (plan 33-02)
    provides: plans.brief / briefChangedAt / deckProposedAt / altShots / deckLockedAt, media.editBrief, media.switchDeck
  - phase: 33 (plan 33-03)
    provides: generateReel stamping deckLockedAt and discarding altShots
  - phase: 33 (plan 33-06)
    provides: mediaCanvasView as the canvas's derivation home; refusalText's no_alternate / deck_locked sentences
  - phase: 19 (plan 19-12)
    provides: useSendCockpitMessage — the ONE browser-side dispatch path the re-propose reuses
  - phase: 11
    provides: the sparse-start rule that makes audience/tone/brandVoice non-blocking
provides:
  - briefChips — the five-chip model, two required fields, defaulted markers, preset-only length
  - deckStale — the two-stamp staleness predicate behind the badge
  - deckSummary / variationView — ONE fold used for both decks, and the switcher's whole lifecycle
  - briefRefusalText — editBrief's three refusals in words
  - BriefRow + VariationCompare + DeckCard in MediaCanvas.tsx
affects: [33-08, 33-10, media, mediaCanvasView, MediaCanvas]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "native <fieldset> + aria-pressed buttons as the preset control — the platform's own grouping element, which is what biome demands over a role='group' div"
    - "the length options are built FROM the constant the server validates against, so the matching refusal is unreachable from the control"
    - "ONE cost-note carrier: the note is on the option OR on the chip, never both, so the component can render both slots unconditionally"
    - "the canvas reuses useSendCockpitMessage rather than gaining a second UI→dispatch entry point"

key-files:
  created: []
  modified:
    - apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts
    - apps/web/app/(app)/dashboard/workspace/mediaCanvas.test.ts
    - apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx
    - docs/playbooks/media.md

key-decisions:
  - "The re-propose button calls useSendCockpitMessage IN the canvas rather than taking a lifted prop — six surfaces already instantiate that hook, including cards.tsx beside this one, and threading a callback through BOTH mount points (page.tsx→CanvasPane and cards.tsx's plan-kind switch) is two chances to forget it, which is the exact defect the hook was created to kill"
  - "The length chip's options are TARGET_DURATIONS itself, imported from @pikar/core/storyboard — the same closed set media.editBrief validates against, so illegal_duration cannot be produced by the control at all"
  - "Only topic and length may block. That is a Phase-11 obligation, not a preference: a chip row demanding an audience would re-gate exactly the idea-stage tenants Phase 11 admitted"
  - "The 60 s cost note has ONE carrier — on the option while 60 is not current, on the chip once it is — so the component renders both slots with no conditional and the sentence still appears once"
  - "After Generate the compare region is ABSENT, not disabled: a greyed switch is a control that can only ever answer deck_locked, and the canvas already knows that answer"
  - "briefRefusalText joined the view module rather than the .tsx — a sentence a user reads is a thing that can be wrong on a Tuesday, which is that module's founding rule"

patterns-established:
  - "build a control's option list from the server's own validation constant, so the matching refusal becomes unreachable rather than merely unlikely"

requirements-completed: [33-INTAKE, 33-VARIA]

# Metrics
duration: ~1 session
completed: 2026-08-16
---

# Phase 33 Plan 07: Guided intake and variations on the canvas Summary

The media canvas now opens with the **brief** — the parsed ask as five editable chips — then the
**two proposals side by side**, then the hero and the strip 33-06 built. Editing a chip stamps the
brief and raises a "brief changed" badge with one free re-propose button beside it; nothing on the
surface spends without a click, and after Generate both new regions go read-only or vanish outright.

## What shipped

**The chips.** `briefChips(brief, deckLocked)` returns topic, length, audience, tone and brand voice
in that order. **Only topic and length are required**, and that is a Phase-11 obligation rather than
a style choice: Phase 11 deliberately admits tenants whose whole profile is a one-line description,
so a chip row that demanded an audience would re-gate the users that phase let in. The three
optional chips render empty and never stop anything.

A field named in `brief.defaulted` — the model's word, not the user's — carries a `"from your
profile"` **marker in text**, never a colour (BRAND §6), and stays fully editable, because editing
it is exactly what makes it the user's (`editBrief` drops every patched field from `defaulted`).
Rendering a model-authored value identically to a stated one is the provenance-laundering shape this
repo already has a defect class for.

**The length chip cannot produce its own refusal.** Its options are `TARGET_DURATIONS`, imported
from `@pikar/core/storyboard` — literally the same closed set `media.editBrief` validates against —
rendered as a native `<fieldset>` of `aria-pressed` buttons. There is no field to type an
unpriceable number into, so `illegal_duration` is unreachable from the control; `briefRefusalText`
still words it as the fail-closed backstop. The 60 s cost note has **one carrier**: on the option
while 60 is not the current ask, on the chip once it is. The component renders both slots with no
conditional, and the sentence still appears exactly once.

**Nothing auto-fires.** A chip edit calls `editBrief` and stops. What a divergence produces is
`deckStale(briefChangedAt, deckProposedAt)` — true iff BOTH stamps exist and the brief moved last —
which raises the badge and a **"Re-propose (free)"** button. That button sends ONE canned message
through `useSendCockpitMessage` with THIS thread's id: the existing chat path, not a second door
into the agent loop. `threadId` is required rather than optional-with-a-fallback, because sending
without one mints a NEW thread and moves the conversation out from under the canvas.

**The two decks.** `variationView` folds both through ONE `deckSummary` (opening concept, scene
count, `KIND_LABEL` kind mix, summed durations), so the compare region cannot count scenes on one
side and shots on the other. Switching calls `media.switchDeck` and needs no estimate wiring —
`jobEstimate` prices whatever is in `shots`, so the `$X.XX` headline follows on its own
subscription. After Generate the region is **absent, not disabled**: `variationView` nulls the
alternate for any locked plan and `briefChips` marks every chip read-only off the same flag, because
a greyed switch is a control that can only ever answer `deck_locked`.

**No logic entered `MediaCanvas.tsx`.** It gained JSX, event wiring and one four-branch patch
builder; every sentence, model and state decision landed in `mediaCanvasView.ts` and is asserted by
being called.

## Task commits

| Task | RED | GREEN |
|------|-----|-------|
| 1 — briefChips / deckStale / variationView derivations | `8e1481b` | `1c0bb3e` |
| 2 — chips row + stale badge + re-propose | — (typecheck-verified) | `6aaba39` |
| 3 — side-by-side variation switcher | — (typecheck-verified) | `261d962` |
| playbook — §9 same-phase update | — | `860671b` |

## Verification

```
apps/web       pnpm vitest run
  Test Files  24 passed (24)
  Tests       351 passed (351)
  app/(app)/dashboard/workspace/mediaCanvas.test.ts (78 tests) ✓

apps/web         npx tsc --noEmit  → clean
packages/backend npx tsc --noEmit  → clean
packages/core    vitest run storyboard → 92 passed (TARGET_DURATIONS' owner, untouched)
biome check (3 touched files)      → 1 warning, pre-existing (see Deferred)
node scripts/check-playbooks.mjs   → exit 0
```

`mediaCanvas.test.ts` went 59 → 78. The 19 new tests are behavioural: chip order and the two
required fields; the empty-optional resting state; the defaulted marker appearing on the marked
field and NOT on its neighbour; the preset list being `TARGET_DURATIONS` with the current one
flagged; the 60 s note in both of its positions and in neither at once; every chip read-only under a
lock; no brief → no chips; `deckStale`'s four boundary cases including both absent stamps and equal
stamps; `briefRefusalText`'s three codes plus the unknown-code arm; and the summary parity, the
block-deck fallback, the empty deck, and the locked plan whose alternate is gone.

**The RED was real.** The first run of the task-1 tests was `18 failed | 59 passed` with
`(0 , variationView) is not a function` — the derivations did not exist yet.

## Deviations from Plan

### In-plan judgement calls

- **The re-propose calls `useSendCockpitMessage` in the canvas rather than taking a lifted prop.**
  The plan's parenthetical preferred lifting the send callback down from the page. Six surfaces
  already instantiate that hook directly — `ChatPane`, `page.tsx`, **`cards.tsx` (the component
  that mounts this very canvas)**, `SegmentAnatomy`, `AbnormalBriefBanner`, `PostCall` — and the
  hook's own header says why: it exists so that *"a NEW caller cannot be born clockless"*. The
  canvas has TWO mount points (`page.tsx` → `CanvasPane`, and `cards.tsx`'s `plan.kind` switch), so
  threading a callback through both is two places to forget it, which is the precise defect
  (phase 19-12) the hook was created to eliminate. The plan's actual constraint — *never a second
  UI→dispatch entry point* — is honoured exactly: this is the same hook, the same action, the same
  clock.

- **`briefRefusalText` was added, and it is not in the plan's artifact list.** The plan asked for
  refusals to be surfaced "as the existing sentence pattern" while also forbidding string literals
  in the `.tsx`. `refusalText` is the estimate rail's map and takes a money/noun context that the
  brief plane has nothing to fill, so `editBrief`'s three codes got their own four-line function in
  the view module, with a test. `switchDeck`'s two codes DO reuse `refusalText` — 33-06 added
  `no_alternate` and `deck_locked` there specifically.

- **`TARGET_DURATIONS` is imported into `mediaCanvasView.ts`, which previously had no imports at
  all.** Its header explains that `VisualKind` is typed structurally "so this module stays free of
  the backend's build graph" — `@pikar/core` is a pure-TS workspace package with no dependencies of
  its own, and `apps/web` already imports it (`page.tsx`'s `REVIEW_THREAD_ID`). Re-declaring the
  presets locally would have been a second copy of a closed set whose whole purpose is to be the
  one the server validates against.

- **A `<fieldset>` replaced the `role="group"` div.** Biome's `useSemanticElements` refuses an ARIA
  role where the platform has an element, and it is right — this is ladder rung 4.

- **`variationView` returns `picked` as well as `alternate`.** The plan named only the alternate's
  model, but the parity guarantee it also asks for ("derived from altShots the same way the picked
  deck's summary derives from shots") is only real if one function produces both. It costs one line
  and makes the compare region genuinely side-by-side.

### Auto-fixed Issues

None. No bug, missing-critical-functionality or blocking issue was found in this plan's scope.

## Deferred Issues

- **`SceneTile`'s `clipSeconds` parameter is unused** (biome `noUnusedFunctionParameters`, 1
  warning). Carried forward from 33-06, verified pre-existing, out of this plan's scope.
- **Not seen in a browser.** Every guarantee here is unit-asserted by calling; the chips row, the
  compare region and the re-propose button have only been typechecked. **33-10 owns the live gate**
  and now owes `apps/web/e2e/media-canvas.spec.ts` assertions for: a chip edit raising the badge,
  the re-propose producing exactly ONE chat turn and no proposal, and the compare region
  disappearing after Generate. The three-way interaction most worth watching for is the ordering of
  `editBrief` → badge → re-propose against a live `deckProposedAt` stamp, which no unit test can
  reach.
- **`graphify update` / `extract-convex-edges` not run by this plan.** `graphify-out/*` carries
  foreign uncommitted changes from another lane on this shared tree; the SessionStart hook and the
  per-commit background rebuild cover it, and staging those files here would have swept up work
  this plan does not own.

## Self-Check: PASSED

- `apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts` — FOUND
- `apps/web/app/(app)/dashboard/workspace/mediaCanvas.test.ts` — FOUND
- `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx` — FOUND
- `docs/playbooks/media.md` — FOUND
- commits `8e1481b`, `1c0bb3e`, `6aaba39`, `261d962`, `860671b` — all FOUND
