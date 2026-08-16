---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: "06"
subsystem: media
tags: [react, ui, brand, derivations, vitest, tdd, no-polling]

# Dependency graph
requires:
  - phase: 33 (plan 33-02)
    provides: deckLockedAt / the deck-lock refusal code the canvas now words
  - phase: 33 (plan 33-03)
    provides: unconfirmed_claims refusal at jobEstimate, in the same pre-flight order
  - phase: 33 (plan 33-04)
    provides: renderRetriedAt stamp, "render (incl. one retry)" estimate line, nothing_to_render
  - phase: 33 (plan 33-05)
    provides: the held artifact triple — media.reel serves a url at ANY renderStatus
  - phase: 20-media-canvas
    provides: byPlan / assetUrls / reel / jobEstimate reactive reads, mediaCanvasView derivation home
provides:
  - trackerView — the four-stage pipeline spine folded from the two independent job faces
  - heroState — the five-mode hero slot (tracker / video / held / failed), both 20-10 traps intact
  - estimateView — one $X.XX headline over jobEstimate, never re-added from the lines
  - pricedAsLine, usd — the last two sentences/formatters lifted out of the .tsx
  - ReelHero + PipelineTracker + GenerateBar — hero-then-strip layout in MediaCanvas.tsx
affects: [33-08, 33-10, media, mediaCanvasView, MediaCanvas]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "native <video autoPlay muted loop playsInline controls> — muted-autoplay-tap-for-sound with no player library"
    - "native <details>/<summary> as the disclosure widget — keyboard + SR support with no state and no ARIA of our own"
    - "discriminated-union view state (HeroState) instead of five booleans that could co-occur"
    - "skipped as a first-class stage state, so a job that will never be requested never reads as 'waiting'"

key-files:
  created: []
  modified:
    - apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts
    - apps/web/app/(app)/dashboard/workspace/mediaCanvas.test.ts
    - apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx
    - docs/playbooks/media.md

key-decisions:
  - "The hero slot exists from the moment the deck is picked and holds tracker OR reel OR both — the layout never jumps when a render lands"
  - "A url with a non-rendered renderStatus is the PREVIOUS reel and says so: 33-05 holds the validated triple, so 'there is a url' no longer means 'this is current'"
  - "estimateView's headline is jobEstimate's totalCents, never a sum of the lines — the render line is a constant no line-sum reproduces, and a second sum is a second estimate"
  - "The three failure codes that mean a scene never landed (incomplete_batch / not_all_succeeded / incomplete_blocks) render as HELD, not FAILED — the cure is a per-scene fix, not a retry"
  - "Deck-shape prose (pricedAsLine) moved into the view module too: a sentence that picks between two shapes is a decision, and decisions are testable"
  - "The tracker reads renderRetriedAt because 33-04's auto-retry leaves renderStatus 'rendering' standing — without it the second sandbox is indistinguishable from a slow first one"

patterns-established:
  - "roll-up rule for staged pipelines: empty column = skipped, any failure = failed, all done = done, otherwise active"

requirements-completed: [33-CANVAS]

# Metrics
duration: ~1 session
completed: 2026-08-16
---

# Phase 33 Plan 06: Reel-first canvas Summary

The media canvas is now one layout for the whole lifecycle — a player hero on top and the scene
strip below — with the pipeline tracker living in the hero slot until there is a reel to put there,
and the estimate promoted to a single `$X.XX` headline over an expandable per-kind breakdown.

## What shipped

**The hero slot.** It exists from the moment a deck is picked and never moves. `heroState` decides
what goes in it: the tracker before anything is built, the final `<video>` once a url exists, both
at once during a regenerate (the old final keeps playing under a compact tracker), or a held/failed
sentence with the stages still visible underneath. Both of 20-10's traps survive verbatim —
stale-vs-never-built is still separated by the landed count, and `rendered`-with-no-url is still
D8's governed refusal to publish rather than a missing file. One trap is NEW, from 33-05: because
`clearRender` now holds the validated artifact triple, a url can arrive with any `renderStatus`, so
anything other than `rendered` is labelled the *previous* reel in words.

**The tracker.** `trackerView` folds `generate → voice → assemble → captions` out of reads that were
already reactive: `byPlan`'s two independent job faces plus the plan row's `renderStatus`,
`captionStatus` and `renderRetriedAt`. No `setInterval`, no ticker, nothing new subscribed. `skipped`
is a first-class state — a deck of cards and uploads buys no picture, a silent deck is never
transcribed — so no stage ever says "waiting" about a job that will never be requested. Failure wins
a roll-up, which is what sends a user to the fix menu instead of to a wait with no end.

**The cost control.** `estimateView` reformats `jobEstimate` and does no arithmetic beyond
cents→USD. The headline is `totalCents`; a test feeds it deliberately inconsistent input (lines
summing to 95¢, total claiming 112¢) so a future re-add goes red. The itemisation moved into a
native `<details>` without losing the 40× clip-vs-still lever, which now says so in words on the
clips line. Four refusal codes that existed on the rail with no sentence got one:
`unconfirmed_claims` (→ the confirmation badge, not a rewrite), `deck_locked`, `no_alternate`,
`nothing_to_render`.

**No logic entered `MediaCanvas.tsx`.** It gained JSX and event wiring; every sentence, fold and
state decision landed in `mediaCanvasView.ts` and is asserted by being called. That is the module's
founding rule, and this plan moved two more things across it (`pricedAsLine`, `usd`) rather than
leaving them where only source-text assertions could reach them.

## Task commits

| Task | RED | GREEN |
|------|-----|-------|
| 1 — tracker + hero-state derivations | `549c6bb` | `1bc1ab7` |
| 2 — estimate headline + breakdown, new refusal codes | `eafcb09` | `97dec46` |
| 3 — hero + strip layout in MediaCanvas.tsx | — (typecheck-verified) | `d1f2bf5` |
| playbook — §9 same-phase update | — | `6dbd4c3` |

## Verification

```
pnpm --filter web test
  Test Files  24 passed (24)
  Tests       332 passed (332)
  app/(app)/dashboard/workspace/mediaCanvas.test.ts (59 tests) ✓

apps/web       npx tsc --noEmit  → clean
packages/backend npx tsc --noEmit → clean
biome check (3 touched files)     → 1 warning, pre-existing (see Deferred)
diff grep setInterval|setTimeout  → no matches added
```

`mediaCanvas.test.ts` went 25 → 59 tests. The 34 new ones are all behavioural: fresh deck,
picture-less deck, silent deck, mid-generation counts, blocked/failed pictures, independent job
faces, retrying assembly, captions burning/failed/captioned, per-scene landing rows, and all five
hero modes including the regenerating and held-final cases; then the estimate's headline, line
labels, 40× note, remaining budget, three disable paths and every new refusal code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A still was documented as "about a tenth of a clip"; it is a fortieth**

- **Found during:** Task 2, while wiring the 40× cost discoverability the plan asked for
- **Issue:** `KIND_COST_NOTE.animated_image` — shipped UI copy on every animated-still tile — read
  *"One still, panned in the render — about a tenth of a clip."* The measured price table
  (`storyboard.ts`, 20.2 wave 7 / ADR-019) is $0.40 for a 4 s generated clip and $0.01 for a still
  at ANY length. The single biggest cost lever a user has was understated by 4×, in the one place
  the product explains it. The same wrong ratio appeared in a `MediaCanvas.tsx` comment and in the
  playbook's scene-kind table.
- **Fix:** all three sites now say "a fortieth", each with the measured figures beside it; a test
  pins the copy so it cannot drift back.
- **Files modified:** `mediaCanvasView.ts`, `MediaCanvas.tsx`, `docs/playbooks/media.md`
- **Commits:** `97dec46`, `d1f2bf5`, `6dbd4c3`

### In-plan judgement calls

- **`estimateView` takes a second argument.** The plan wrote `estimateView(est)`, but `refusalText`
  needs the deck's noun and its narration ceiling, and neither is in `jobEstimate`'s return. They
  are passed as `{ noun, maxChars }` and touch no number — the money path is `est` alone.
- **`estimateView` accepts `undefined`.** Handling the in-flight query inside the derivation is what
  keeps the loading branch (and the "disabled until the estimate resolves" rule, D7) out of the
  `.tsx` as a ternary.
- **`pricedAsLine` was added in task 3.** The e2e gate asserts the "A 30-second reel of 4 scenes,
  priced per scene" sentence, and the plan's own rule forbids the branch living in the `.tsx`. It
  moved to the view module with a test rather than being dropped or inlined.
- **`ReelHero` reads the render plane from `media.reel`, not the plan row.** `reel.status`/`.reason`
  mirror `renderStatus`/`renderReason`, and `reel` is also where the url guarantee lives — one
  source for the render plane. Only `captionStatus` and `renderRetriedAt`, which `reel` does not
  carry, widened the `MediaPlan` type (`plans.byThread` already returns the whole document).
- **The `biome-ignore lint/a11y/useMediaCaption` on the player is gone.** `muted` takes the element
  out of that rule's scope, so biome reported the suppression as having no effect. Replaced with a
  comment saying why there is no `<track>` (the captions are burned-in pixels, 20-17).

## Deferred Issues

- **`SceneTile`'s `clipSeconds` parameter is unused** (biome `noUnusedFunctionParameters`, 1
  warning). Verified pre-existing against a clean tree — not caused by this plan, and out of its
  scope. It became dead when the per-scene narration ceiling moved to `byPlan`'s own `maxChars`.
- **Not seen in a browser.** Every guarantee here is unit-asserted by calling; the layout itself has
  only been typechecked. 33-10 owns the live gate, and `apps/web/e2e/media-canvas.spec.ts` will need
  its hero/tracker assertions extended there (its four existing estimate assertions were checked
  against the new markup and still hold — the priced-as sentence moved inside `<details>`, which
  Playwright's `toContainText` reads through).

## Self-Check: PASSED

- `apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts` — FOUND
- `apps/web/app/(app)/dashboard/workspace/mediaCanvas.test.ts` — FOUND
- `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx` — FOUND
- `docs/playbooks/media.md` — FOUND
- commits `549c6bb`, `1bc1ab7`, `eafcb09`, `97dec46`, `d1f2bf5`, `6dbd4c3` — all FOUND
