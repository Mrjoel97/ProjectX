---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: "10"
subsystem: media
tags: [live-verification, owner-gate, skill-registry, prompt, playwright, production, audit-read]

# Dependency graph
requires:
  - phase: 33 (plan 33-08)
    provides: the failure/citation planes the live canvas renders
  - phase: 33 (plan 33-09)
    provides: media-director v3 on disk + the regenerated mediaDirector.ts mirror
provides:
  - live read-back proof that production's ACTIVE media-director IS the v3 body
  - the extended Playwright canvas spec (41b5dd1)
  - an owner browser verdict on the two-variation experience
  - two production defects found AFTER the plan was written, fixed and deployed
affects: [media, cockpit, dispatch, storyboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "read the LIVE registry row back before believing a body is seeded — source cannot see deployment state"
    - "a brief is a SUBJECT, not a task: a system prompt teaches FORMAT, only a user turn compels ACTION"
    - "diagnose production from the audit read surface + the plan row, not from a browser session"
    - "when a reason code has two causes, ship the counter that splits them BEFORE the next failure"

key-files:
  created:
    - packages/backend/convex/audit.ts (recentByType — the deck-refusal read surface)
  modified:
    - packages/core/src/storyboard.ts (repairNarrationWindows / widenNarrationWindow)
    - packages/backend/convex/dispatch.ts (MEDIA_TASK_LINE, the third prompt shape)
    - packages/backend/convex/plans.ts (landStoryboardRefusal keeps the raw body)
    - packages/backend/convex/schema.ts (plans.refusedBody)
    - apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts (the "narration" adjustment sentence)

# Metrics
plan-hours: n/a (closed out-of-band across two sessions)
tests-added: 11
tests-total-after: backend 2041 passed | 24 skipped; @pikar/core 1049; web 197
production-deploys: 2 (ac6a4d5, 8ad8b51)
---

# Phase 33 Plan 10: closing the phase live — and the two defects that only production could show

## What shipped

**The plan's own work was already on disk.** `41b5dd1` extended
`apps/web/e2e/media-canvas.spec.ts` with the phase-33 canvas assertions and is on `origin/main`.
What was missing was this summary, the live read-back, and the owner gate — and, as it turned out,
two defects that no offline gate could have found.

**1. The live read-back (truth #1).** Production's ACTIVE `media-director` is **version 5, 20,041
characters, byte-length identical to `packages/contracts/skills/media-director.md`**, and it
teaches `VARIATION A`, `VARIATION B`, `BRIEF`, `Target duration` and `Source:`. Read back with
`npx convex run --prod skills:getActiveSkill`. **This corrects a false claim that had been sitting
in `STATE.md` since 2026-08-16** — "THE LIVE DEPLOYMENT STILL RUNS THE OLD BODY: no seedSkills ran,
no candidate was inserted, no pointer moved." A seed did run between then and now. Source could not
see it; only the deployment could say.

**2. `audit.recentByType` — the deck-refusal read surface.** `deckTokenCounts` had been writing
five numbers beside every `media.deck_refused` since 2026-08-17 and **nothing could read them**: the
refusal path never persists the specialist's body, so those counts were the entire evidence, and
reaching them needed a browser session against the deployment. One internal query closed that, and
it is what made everything below possible in four CLI calls.

**3. The narration repair (`repairNarrationWindows`).** A two-variation proposal came back with only
variation A; B refused `narration_too_long`. An over-running line now BUYS the seconds it needs by
trading duration between scenes — seconds never words, never a `generated_video` at either end,
total never moves — and every moved second is disclosed as a `SceneAdjustment{why:"narration"}`.
The geometry is the whole design and is not the one the refusal implies: `narrationCeilingSeconds`
is the SUM of a span, so only seconds taken from OUTSIDE the span widen a window.

**4. The root cause of the `no_deck` failures — `MEDIA_TASK_LINE`.** The owner's gate run refused
with `no_deck` under the block contract. The audit reader settled it in one call: a 1,270-character
body with **zero** of all four structural tokens. The parser was innocent. `buildSpecialistPrompt`
has two prompt shapes; the QUESTION branch was built for RESEARCH, where the question genuinely IS
the task, and `runMedia` reused it (`llm.ts` passes `question: brief`) — so a media specialist's
entire user turn was the executive's free-text brief, capped at 500 characters, with **no
instruction to produce the deck at all**. The 20,041-character registry body teaches the FORMAT;
only a user turn can say DO IT NOW.

**Measured, not argued:** the identical brief — `"Create a short video ad for my business."` —
produced a 5-shot deck on one production run and 1,270 characters of prose on another. Same skill
version 5, same body hash `4f41120c…`, `incomplete: false` and `declaredUnsupported: false` on both.
A coin flip is what "no task line" looks like from outside the model.

**One root cause, four symptoms nobody had connected:** the `no_deck` coin flips;
`bad_target_duration` on a 6,331-character deck that never wrote the line; **`variations: 1` on
EVERY deck ever persisted in production** — the A/B contract had never once been honoured live; and
"nothing injects a target duration into the specialist prompt".

**5. `plans.refusedBody`.** The raw specialist output now lands on the PLAN row (`schema.ts`: raw
content lives in `requests`/`plans`), capped at 20k, cleared by `persistDeck`. It is EVIDENCE, not
copy — nothing renders it, `body` is still the sentence the user reads, and a test asserts the prose
never appears anywhere in the audit lineage (§4 intact).

## Task commits

| commit | what |
|---|---|
| `41b5dd1` | the phase-33 canvas in a real browser, for $0 (the plan's own artifact) |
| `c7f0d2c` | `audit.recentByType` — the refusal counts get a reader |
| `ac6a4d5` | a long line buys seconds instead of losing the storyboard |
| `8ad8b51` | a brief is a SUBJECT, not a task — the specialist is told to write the deck |

Deployed to production as `ac6a4d5` (run `32082400812`) and `8ad8b51` (run `32088691623`), both
`success`, both via the scoped-branch cherry-pick route — never by merging the working branch.

## Verification

- **@pikar/core** 1049 passed (39 files) · **web** 197 passed · **backend** 2041 passed | 24 skipped
  (87 files) · `tsc --noEmit` clean in core, backend and web · biome clean (607 files) ·
  `check-playbooks` exit 0.
- **Mutation-proven, 8 mutants, all CAUGHT, each against a green baseline in the same invocation
  style:** audit order desc→asc; audit `gt`→`gte`; donor may be a generated clip; no donor floor;
  receiver may be a generated clip; donor from inside the window; media guard removed (research
  inherits the instruction); cap applied after appending; `persistDeck` stops clearing the body.
- **Live probes:** `skills:getActiveSkill --prod`, `audit:recentByType --prod`, `plans:getById
  --prod`, `https://www.pikar-ai.com` → 200.

### The owner gate — VERBATIM, and what it does and does not cover

> "it all works two storyboards we created and i viewed them and not error occured"

**OBSERVED:** two storyboards were produced from one brief, both were viewed, and no error appeared.
That is the first time the VARIATION A/B contract has been honoured in production — every deck ever
persisted before this carried `variations: 1`.

**NOT INDIVIDUALLY ADJUDICATED, and therefore NOT claimed as verified.** The plan's truth #2 also
listed brief chips, the switch control, confirm-blocking-Generate, hero layout and the estimate
breakdown. The owner did not report on those and was not asked to enumerate them. They are covered
by the Playwright spec (`41b5dd1`) but have no owner verdict. **Do not read this summary as an owner
sign-off on those five items.**

## Deviations from Plan

- **The plan assumed seeding was still to be done.** It had already happened; the work became a
  read-back and a correction to `STATE.md`.
- **Two production defects were found during the gate and fixed before it could pass.** Neither was
  in scope for 33-10 and neither was findable offline: both parsers, both typecheckers and 2,000+
  tests were green throughout. The plan's `files_modified` list (two files) is therefore wrong about
  what closing this phase actually took — see `key-files` above.
- **The gate was run twice.** The first run refused `no_deck`; the second, after `8ad8b51`, produced
  the two storyboards.

## Deferred Issues

- **What the 1,270-character bodies actually SAY is still unobserved.** The inference is that the
  model asked a clarifying question; that is an inference and must not be written down as fact.
  `plans.refusedBody` exists so the next occurrence is read rather than guessed.
- **RESOLVED — and the correction matters more than the original finding.** Mid-session the branch
  was red on the §5 scan and I recorded it as another lane's defect. It was not: **the GUARD was
  wrong.** The scan read JSDoc backticks as template literals, so `a745d36` merely *explaining
  itself in comments* took `cockpitCapabilities.ts` from 1 backtick to 29 and tripped a false
  positive. Fixed at the root by `4ef7646` (`stripComments()` before scanning); `skills.test.ts`
  is 87/87. A crude regex I wrote to "independently confirm" the literal count had the identical
  comment-blindness and agreed with the broken guard — two derivations sharing one assumption are
  not corroboration. **Merging this branch to main is still wrong**, for the unrelated and
  unchanged reason: it carries the BETA-01 invite gate and would close production signup.
- **The variation compare region is still a switcher, by decision.** The alternate gets a summary
  card and the user switches to see it in full; an expand-both accordion was considered and
  deliberately not built, because "which deck is picked" is the same state as "which deck gets
  bought" (`jobEstimate` prices whatever is in `shots`).
- **`WORM_BUCKET` is still unset on prod** (carried forward, unrelated to this plan).

## Self-Check: PASSED

Every truth in `must_haves` is either verified with a named probe above, or explicitly recorded as
not adjudicated. No claim in this document rests on source inspection where deployment state was
the question.
