---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: "09"
subsystem: media
tags: [skill-registry, prompt, media, citations, provenance, vitest, drift-guard, ungated]

# Dependency graph
requires:
  - phase: 33 (plan 33-01)
    provides: parseBrief, parseVariations, per-scene Source parsing in parseSceneDeck
  - phase: 33 (plan 33-03)
    provides: persistStoryboard's parseVariations-first terminal (deck A picked, B parked, brief off the whole turn)
  - phase: 33 (between waves 8 and 9)
    provides: sceneCitations returning the VAULT ROW's title for a verified citation (d69fc29)
  - phase: 20 (plan 20-03)
    provides: the media-director .md/.ts mirror and the round-trip test that reads the body off disk
provides:
  - media-director v3 body on disk — BRIEF echo, VARIATION A/B, per-scene Source lines
  - ONE worked answer that IS the parsed fixture (the two partial examples are gone)
  - a round trip that runs parseVariations first and every per-deck rule against BOTH decks
  - the regenerated mediaDirector.ts mirror (what the Convex runtime actually ships)
affects: [33-10, media, skill-registry, storyboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "one worked example, at the end, that the test parses — a second illustrative example is a second thing to drift"
    - "keep instruction-section field labels BACKTICKED so the prose cannot parse as a filled-in answer"
    - "a per-deck rule loops over BOTH variations; a helper that throws rather than returning [] keeps the loop non-vacuous"
    - "mutation-check a prompt guard by checking out the PREVIOUS body — the whole edit is the mutation"

key-files:
  created: []
  modified:
    - packages/contracts/skills/media-director.md
    - packages/contracts/src/skills/mediaDirector.ts
    - packages/core/src/storyboard.test.ts
    - docs/playbooks/media.md
    - docs/playbooks/skill-registry.md

key-decisions:
  - "ONE worked answer at the END replaced the §3 deck fragment and the §4 prompts fragment: with two variations in the file, a second parseable deck earlier in the document made `parseSceneDeck(body)` read one example's table with the other example's prompts and Source lines merged in. One example is also one thing to keep true."
  - "§1 BRIEF's instruction bullets use BACKTICKED labels (`Topic:`) so `fieldOf` cannot match them — otherwise `parseBrief(body)` would return the instruction prose as a brief, and the round trip would be certifying the teaching rather than the example."
  - "The `## 4. SCENE DECK` heading keeps its `4.` number ON PURPOSE: `parseSceneDeck`'s own `deckAt` regex allows no numeric prefix, so the numbering is what stops the instruction section from being read as a deck. Dropping the numbers would make the rules prose the deck."
  - "The per-deck 'must contain a generated_video' assertion became per-ANSWER. A stills-and-cards concept costing a fortieth of its sibling is the cost lever the body teaches, not a gap — and it is what makes variation B a real alternative rather than a recolour."
  - "The body teaches that the title it writes is a LABEL, not THE label — a verified id shows the vault row's own title. Teaching otherwise would invite a model to compose a source line for a UI that was never going to render it."

patterns-established:
  - "prove a prompt-edit guard by restoring the previous body from git and recording the red count"

requirements-completed: [33-INTAKE, 33-VARIA, 33-CITE]

# Metrics
duration: ~1 session
completed: 2026-08-16
---

# Phase 33 Plan 09: media-director v3 — the specialist learns to write what the parsers read

The parsers for guided intake, two variations and grounded citations have been live since 33-01,
and the canvas that renders them since 33-08. **Nothing has ever emitted any of it**, because the
specialist was never told to. This plan is the other half: the v3 body, and the test that stops the
prompt and the parser from ever drifting apart.

Authored, pinned — **and deliberately not live.** 33-10 seeds it.

## What shipped

### The three teachings

**A `BRIEF` at the top, once.** Topic and duration are required and nothing else is; anything taken
from the business profile rather than from what the user actually said carries `(defaulted)` on the
end of its value, which the canvas badges. The body says outright that a plausible-sounding audience
you invented is worse than a general one you marked — the Phase-11 sparse-start rule, in prompt form,
so an idea-stage account is never handed specifics it never gave.

**`VARIATION A` and `VARIATION B`, each a WHOLE proposal** — its own script, its own art direction
(nine fields; "a second concept with the first one's look is not a second concept"), its own deck
summing to the brief's duration, its own prompts. A is the deck the owner sees picked, so A is the
one to ship and B the real alternative. A section of the body is spent on what "distinct concept"
means and on the kind mix as its visible half: a cinematic concept spending clips where motion is
the point, against a stills-and-cards concept costing a fortieth as much.

**A `Source:` line on every scene that states a checkable fact** — `<title> [doc:<id>]` using only a
document `searchVault` returned this turn, or `Source: unverified` when the vault grounds nothing.
Creative copy carries none. The body says a malformed source line refuses the whole deck, so the two
forms are the only forms.

### The one sentence that is load-bearing

> (The title is a label for the two of you to recognise; when the id names a real document, the
> owner is shown THAT document's own title rather than your words. The id does the work.)

The orchestrator closed that hole between waves 8 and 9 (`d69fc29`): `sceneCitations` now reads the
title off the vault row for a verified citation. A body that told the model its `Source:` title is
what the owner reads would be teaching it to compose for a surface that no longer exists — and the
provenance-laundering lesson is that the model's influence over a STORED, DISPLAYED label is exactly
the door to keep shut. So the body teaches the id as the thing that carries weight.

### One worked answer instead of two fragments

v2 carried two illustrative fenced blocks: a deck in §3 and a prompts entry in §4. With a full
two-variation answer added, the file would have held three parseable decks, and `parseSceneDeck` over
the whole file read the §3 table with the LATER example's prompts and Source lines merged into it
(the prompts section runs to EOF and `Scene N` numbering is shared). Both fragments were replaced by
**one worked answer at the end of the file** — brief, two variations, art directions, decks, prompts,
sources — and that answer is what the test parses. One example is also one thing to keep true.

Two structural facts a future editor needs:

- **The instruction section's field labels are backticked** (`` `Topic:` ``, not `Topic:`), because
  `fieldOf` matches a label at line start. Unbackticked, `parseBrief` would read §1's teaching as a
  filled-in brief and the round trip would certify the instructions instead of the example.
- **`## 4. SCENE DECK` keeps its number.** `parseSceneDeck`'s `deckAt` regex allows `#`s but no
  `N.` prefix, so the numbering is the only reason the rules prose is not read as a deck.

## Task commits

| Task | Commit | What |
|------|--------|------|
| 1 — the v3 body (+ derived `.ts` mirror) | `f8e6801` | brief echo, two variations, Source lines, one worked answer |
| 2 — the round-trip drift guard | `4a2bcb9` | parseVariations first; every per-deck rule over BOTH decks |
| playbooks — §9 same-phase update | `aff9af8` | `media.md` and `skill-registry.md` |

## Verification

```
packages/core     npx vitest run
  Test Files  39 passed (39)
  Tests       1010 passed (1010)
  src/storyboard.test.ts  92 → 99 tests

packages/backend  npx vitest run convex/media.test.ts convex/dispatch.test.ts
  Test Files  2 passed (2)
  Tests       324 passed | 24 skipped (348)

packages/contracts npx vitest run src/skills/skillBodies.test.ts
  Tests       22 passed (22)          ← the .md ↔ .ts byte-identity row

packages/core / packages/contracts  npx tsc --noEmit   → clean
biome check (3 touched code files)                     → clean
node scripts/check-playbooks.mjs → the only remaining block names
  agent-runtime.md against a FOREIGN uncommitted eval-case file, not this plan's paths
```

**The mutation check, three ways.** `media-director` is UNGATED — `seedSkills` publishes at
`maxVersion + 1` straight to active, with no eval between this prose and what the specialist
proposes — so this test is the entire pre-live gate and a vacuous one would be worse than none:

| Mutation | Result |
|----------|--------|
| restore the **v2 body** (`git show f8e6801^:…media-director.md`) | **17 failed** \| 82 passed |
| delete the single `Source: unverified` line | **1 failed** \| 98 passed |
| give variation B a different `Target duration` | **15 failed** \| 84 passed |

All three reverted; 99 green. The second is the sharp one: it is the smallest possible edit to the
example and it still reddens, which is what "the example demonstrates all three citation states"
has to mean.

No audit or log-plane site was added, so `llmRedaction.test.ts`'s media count pins are untouched
(the 33-04/33-05 lesson).

## Deviations from Plan

### `packages/contracts/src/skills/mediaDirector.ts` was modified, and is not in the plan's `files_modified`

**[Rule 3 — Blocking]** The `.md` is the human-editable source; the derived `.ts` constant is what
SHIPS, because the Convex runtime cannot `fs.read` repo files. `skillBodies.test.ts` holds the two
byte-identical, so editing the `.md` alone turns `@pikar/contracts` red and seeds a stale prompt.
There is no committed generator — it was regenerated with a throwaway `JSON.stringify` of the `.md`
plus `biome check --write` (which prefers double quotes; the old file's single-quoted literal was
already off-format). Landed in the task-1 commit, where it belongs.

### `docs/playbooks/skill-registry.md` was updated too, and is not in the plan's `files_modified`

**[Rule 3 — Blocking]** `watch.json` gives `packages/contracts/skills/` to `skill-registry.md`, so
the §9 Stop hook blocks without it. The entry records the two registry facts this body exercises
hardest: the mirror has no generator (which is why the drift row exists), and on disk is not live.

### In-plan judgement calls

- **The plan said "keep the v2 sections' structure; ADD the three new sections."** The sections and
  every rule in them are intact — but the two illustrative fenced examples were REMOVED in favour of
  the single worked answer, for the parser reason above. No v2 rule was weakened, reworded or
  dropped: `searchVault` guidance, the closed `VISUAL_KINDS` set, the 4/8/12 grid, the exact-sum
  rule, the silent-scene rule, the character-window arithmetic, the budget cap and the overlay rules
  are byte-for-byte what they were, plus two additions (both decks run the brief's duration; a
  variation gets its own art direction).
- **The round trip no longer calls `parseSceneDeck(body)` on the whole file.** It reads the body the
  way `persistStoryboard` does — `parseVariations` first, then each slice — which is both more
  faithful and the only way to check variation B at all.
- **"The example MIXES kinds" split in two.** Every deck must still contain a non-generated scene
  (the ADR-019 arithmetic: an all-generated deck cannot sum to 15 or 30). "At least one generated
  clip" became per-ANSWER rather than per-deck, so B can be the cheap stills concept — which is the
  cost lever the body teaches and the thing that makes B a real choice.
- **Two extra assertions beyond the plan's list**: both decks run the BRIEF's duration (two lengths
  would be two different asks, and it pins brief↔deck together), and each variation carries its own
  parseable `SCRIPT` and nine-field `ART DIRECTION` inside its own slice — the terminal reads both
  off `variations.a.body`, and a body that wrote one art direction above the headings would land a
  plan row with `null` rather than an error.

### Auto-fixed Issues

None. No bug, missing-critical-functionality or blocking issue was found inside this plan's scope
beyond the two file-scope extensions above.

## Deferred Issues

- **NOTHING HERE IS LIVE.** No `seedSkills` ran, no candidate row was inserted, no active pointer
  moved. Every deployment still serves the v2 body, so no live proposal has changed. **33-10 owns the
  seed and — the part that actually matters — the READ-BACK**: optimizer dry-run candidates occupy
  version numbers, so the version this lands at is not predictable from any plan (the
  skill-version-collision gotcha).
- **No model has ever been shown this body.** The round trip proves the example obeys the parsers; it
  cannot prove the model FOLLOWS the example. The recorded risk is specific: a body edit can shift
  which optional tool arguments a model passes on unrelated paths. 33-10 should A/B one fixture
  (~$0.01) before theorising about any regression, and watch for the two warning signs the research
  names — both decks emitted under one heading, and prompts silently falling back to descriptions.
- **`graphify update` / `extract-convex-edges` not run by this plan.** `graphify-out/*` carries
  foreign uncommitted changes from another lane on this shared tree; the per-commit background
  rebuild and the SessionStart hook cover it.
- **`docs/playbooks/agent-runtime.md` is blocked by the §9 hook against a foreign uncommitted
  eval-case file** (`packages/backend/scripts/eval-cases/37-finance-update.json`). Not this plan's
  path and not this plan's work — left for the lane that owns it.

## Self-Check: PASSED

- `packages/contracts/skills/media-director.md` — FOUND (contains `VARIATION A`)
- `packages/contracts/src/skills/mediaDirector.ts` — FOUND
- `packages/core/src/storyboard.test.ts` — FOUND
- `docs/playbooks/media.md` — FOUND
- `docs/playbooks/skill-registry.md` — FOUND
- commits `f8e6801`, `4a2bcb9`, `aff9af8` — all FOUND
