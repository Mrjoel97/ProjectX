---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: "13"
subsystem: media
tags: [react, ui, brand, derivations, vitest, tdd, failure, disclosure, provenance, live-defect]

# Dependency graph
requires:
  - phase: 33 (plan 33-04)
    provides: retryRender and the free-retry idiom the proposal retry is modelled on
  - phase: 33 (plan 33-07)
    provides: useSendCockpitMessage as the ONE browser-side dispatch path; the two-mount-point rule
  - phase: 33 (plan 33-08)
    provides: FailureCard / FailureFix / FailureCardBlock — the card shape and component reused here
  - phase: 33 (commit 8eb0dd7, 33-11)
    provides: plans.lostVariation — the salvage this plan discloses
  - phase: 33 (commit 1c5b6dc, 33-12)
    provides: plans.deckAdjustments — the repair this plan discloses
provides:
  - plans.proposalRefusal — a refusal is a STATE (code + contract + variation), not a paragraph
  - "@pikar/core/storyboard: SCENE_REFUSAL_WHY / BLOCK_REFUSAL_WHY / deckRefusalClause — ONE vocabulary for the memo body and the canvas"
  - proposalFailureCard — the PROPOSAL stage's failure card, in the RENDER stage's language
  - ProposalFailureCanvas — the media surface for a run that produced no deck, with a working retry
  - salvageNote / adjustmentNotes / ParserNotes — the two disclosures 33-11 and 33-12 owed the user
affects: [media, cockpit, mediaCanvasView, MediaCanvas, cards, dispatch, plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "a refusal is a STATE on the row (code + contract), never prose to be re-parsed by a reader"
    - "the CALLER passes the contract; two vocabularies are never merged into one lookup table"
    - "user-facing copy that both halves must speak lives in packages/core, not in convex/"
    - "the direction of a change lives in the VERB (shortened/lengthened), because a from/to pair under swapped labels reads perfectly and says the opposite"
    - "a disclosure that changes what the artifact IS is never inside a <details>"

key-files:
  created: []
  modified:
    - packages/core/src/storyboard.ts
    - packages/core/src/storyboard.test.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/dispatch.ts
    - packages/backend/convex/dispatch.test.ts
    - apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts
    - apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/app/(app)/dashboard/workspace/mediaCanvas.test.ts
    - docs/playbooks/media.md
    - docs/playbooks/cockpit.md

key-decisions:
  - "The refusal vocabulary MOVED to @pikar/core rather than being copied into apps/web: the canvas cannot import a Convex module, and a second copy is how one reason ends up saying two different things. Two tables (scene/block) keyed by a caller-supplied contract, never one merged lookup — dispatch.ts's own comment names union-merging as the way a reason renders the wrong sentence."
  - "`plans.proposalRefusal` stores the CONTRACT as well as the reason. `no_deck` means 'no scene deck' under one parser and 'no block deck' under the other; a card that guesses tells the user the wrong thing about what the model wrote."
  - "`resetPlan` clears `proposalRefusal` — without it a stale media refusal would put a 'couldn't build your storyboard' card on the next EMAIL draft composed in that thread, because both mount points branch on this field before they look at the kind."
  - "The proposal card's sunk line quotes NO money. This stage refuses before any reservation exists, so there is no estUsd to quote and quoting one would invent a bill; what the user needs at that moment is that the failure cost them nothing."
  - "The surviving variation letter is DERIVED (a <-> b) rather than stored: the variation plane is exactly two decks by construction (parseVariations has no third letter), and naming only the loss leaves the reader guessing which deck is on their screen."
  - "The rebalance line quotes no reel length when `targetDurationSeconds` is absent (a block deck) rather than inventing one — the same rule the estimate module lives by."
  - "ParserNotes is NOT a <details>. Both disclosures change what the storyboard below actually IS, and a disclosure a person has to open is one most people never read — which is the difference between disclosed and silent."

patterns-established:
  - "mutation-check a DISCLOSURE by transposing the two values it labels (kept/lost letter, from/to seconds), never by deleting one"

requirements-completed: [33-FAIL]

# Metrics
duration: ~1 session
completed: 2026-08-16
---

# Phase 33 Plan 13: The proposal stage gets a failure card, and the two parser edits get disclosed Summary

The owner asked the live app for a reel twice and both times got a memo card with **Approve** and
**Save** over a reel that does not exist — *"the user just stays there and stares at the screen
where nothing happens."* 33-11 and 33-12 fixed the two reasons the deck died. This plan fixes the
third — **the dead end itself** — and pays the two disclosure debts the first two fixes created.

## What shipped

### Task 1 — a refusal is a failure card, not a memo

A refused proposal lands on a `kind: "memo"` row (no deck parsed, so `persistStoryboard` never moved
the kind), and that is why it rendered as a memo. The row now carries **what happened**:

```ts
plans.proposalRefusal = { reason, contract, variation? }   // codes only (§4)
```

`landStoryboardRefusal` writes it at all three call sites (scene, variation, block); `persistDeck`
and `resetPlan` both **clear** it, whole-deck-write semantics like every other deck field.

The **sentences moved to `@pikar/core/storyboard`** — `SCENE_REFUSAL_WHY`, `BLOCK_REFUSAL_WHY` and
`deckRefusalClause(contract, reason)`. They lived in `convex/dispatch.ts`, where the memo body was
their only reader; the canvas could not speak them at all, because `apps/web` cannot import a Convex
module. They stay **two tables keyed by contract** — `no_deck` means a different deck under each
parser, and `dispatch.ts`'s own comment names union-merging as how a reason renders the wrong
sentence. `dispatch.ts` deleted both copies and calls the shared one.

On the browser side nothing new was invented. `proposalFailureCard(refusal)` returns the **same
`FailureCard` shape** 33-08 built, `ProposalFailureCanvas` renders it through the **same
`FailureCardBlock`**, and the one arm — **Try again**, `free — nothing was generated` — sends
`RETRY_PROPOSAL_MESSAGE` through **`useSendCockpitMessage()`**, called inside the component. Not a
threaded callback: this canvas has two mount points and 33-07 recorded that as the way one gets
forgotten. Both mount points branch on the refusal **before** the kind — `cards.tsx` ahead of the
memo card, `CanvasPane` ahead of "no reel in this thread yet", which would otherwise tell a user
whose run just failed that they never asked for anything.

The sunk line quotes **no money**: this stage refuses before any reservation exists, so there is no
`estUsd` to quote and quoting one would invent a bill. It says nothing was bought, which is what a
person needs at that moment and is exactly true.

### Task 2 — the salvage says so

`salvageNote(plan.lostVariation)`:

> Only one of the two storyboards could be built: variation A is the one below, and variation B fell
> through because a generated scene asked for a length the video model cannot produce. Ask me to redo
> the variations if you want the choice back.

**Both letters, in order.** The surviving one is derived (`a` <-> `b`) rather than stored — the
variation plane is exactly two decks by construction. A note that names only the loss leaves the
reader guessing which deck is on their screen; a user promised a choice of two and silently handed
one has been told something untrue by omission. The clause comes from the same `SCENE_REFUSAL_WHY`
table the refusal card and the memo body read — one vocabulary, three surfaces.

### Task 3 — the repair shows every second it moved

`adjustmentNotes(plan.deckAdjustments, plan.targetDurationSeconds)`:

> Scene 1 shortened from 10s to 8s — the generator only makes 4, 8 or 12 second clips.
> Scene 2 lengthened from 20s to 22s — the seconds freed above went back into it, so the reel is
> still 30 seconds.

**The direction lives in the verb**, not just in two numbers, because a from/to pair under swapped
labels reads perfectly and says the opposite thing — which is the mutation this suite is written
against. The legal lengths are `GENERATED_CLIP_SECONDS` itself, so the sentence cannot name a set
the repair does not snap to. With no declared reel length (a block deck) the rebalance line quotes
no number rather than inventing one. An unknown `why` still reports the seconds: the disclosure is
never conditional on our vocabulary.

Both render in **`ParserNotes`**, directly under the brief, above the variation region and the
storyboard, **outside every disclosure widget** (`aria-live="polite"`, `--held-text` per BRAND §6,
no meaning in colour alone).

## Task commits

| Task | Commit    | What                                                             |
| ---- | --------- | ---------------------------------------------------------------- |
| 1    | `0484ebd` | proposal refusal → failure card + retry; the code on the row; the vocabulary moves to core |
| 2    | `e54ae63` | `salvageNote` + `ParserNotes`                                     |
| 3    | `7b17640` | `adjustmentNotes` + the notes list                                |
| §9   | `2b53795` | `docs/playbooks/cockpit.md` (media.md was updated inside each task commit) |

## Verification

```
packages/core    npx vitest run storyboard            109 passed (109)     [was 106]
apps/web         pnpm --filter @pikar/web test        24 files, 399 passed [was 386]
                   mediaCanvas.test.ts                123 tests            [was 101 at 33-08]
packages/backend npx vitest run media                 2 files, 248 passed | 24 skipped
packages/backend npx vitest run dispatch plans llmRedaction skills
                                                      4 files, 267 passed
packages/backend (task 1) media+plans+llmRedaction+skills+importGuard
                                                      5 files, 498 passed | 24 skipped
apps/web         npx tsc --noEmit                     CLEAN
packages/backend npx tsc --noEmit                     CLEAN
packages/core    npx tsc --noEmit                     CLEAN
biome check (touched files)                           1 warning, pre-existing (SceneTile clipSeconds)
node scripts/check-playbooks.mjs                      media.md + cockpit.md satisfied
```

**The REDs were real, all three times.**

| Task | RED observed                                                                      |
| ---- | --------------------------------------------------------------------------------- |
| 1    | core `3 failed \| 106 passed` (`deckRefusalClause is not a function`); backend `3 failed` incl. `Validator error: Unexpected field proposalRefusal`; web `9 failed \| 101 passed` |
| 2    | web `6 failed \| 110 passed` (`salvageNote is not a function`)                      |
| 3    | web `7 failed \| 116 passed` (`adjustmentNotes is not a function`)                  |

### The mutation checks — TRANSPOSITION, never deletion

This repo's named defect class is a green suite over a broken capability, and deletion is the weak
mutation (an absent value is noticed by almost any assertion). Every mutation below leaves **every
value present under the wrong label**:

1. **Task 1 — the two contract tables swapped** inside `deckRefusalClause` (`scene` reads the block
   table and vice versa; every sentence still shipped, each under the wrong contract).
   → **2 core tests + 2 canvas tests red.** Reverted, green again.
2. **Task 2 — the kept and lost variation letters swapped** in `salvageNote` (both letters still in
   the sentence, each in the other's role — the user is told the broken deck is the one on screen).
   → **2 canvas tests red.** Reverted, green again.
3. **Task 3 — `fromSeconds` and `toSeconds` swapped** in the rendered sentence
   (`Scene 1 shortened from 8s to 10s` — both numbers present, direction inverted).
   → **1 canvas test red** on `/shortened .*10s.*8s/`. Reverted, green again.

### The log plane

**No audit or log-plane site was added.** `llmRedaction.test.ts`'s pins are untouched and green:
12 dispatch payload literals, 11 media audit payload literals, 7 media audit call sites.
`landStoryboardRefusal` gained three ARGS, not an audit payload — the `media.deck_refused` event
already carried the reason code and was not modified.

## Deviations from Plan

### In-plan judgement calls

- **The refusal vocabulary MOVED rather than being extended.** The task said to reuse `SCENE_WHY`
  in `dispatch.ts` and not write a second table. `apps/web` cannot import a Convex module, so
  "reuse" had exactly one meaning: relocate it to the pure-TS package both halves already import
  (CLAUDE.md §1), beside the union it describes. `dispatch.ts` is now a caller, not an owner.
- **`BLOCK_REFUSAL_WHY` moved too, and the row stores a CONTRACT.** The task named the scene table
  only. The block contract is still live — `parseBlockDeck` is the fallback whenever a body has no
  SCENE DECK heading at all, which is the single most likely shape of a "no deck" run — so a card
  that spoke only the scene vocabulary would have told those users the model "never wrote a scene
  deck" about a block-contract refusal. One extra field, one extra table, no guessing.
- **`resetPlan` also clears the new field** (deviation Rule 2 — missing critical functionality
  introduced by this change). Both mount points branch on `proposalRefusal` before the kind, so a
  stale one would put a media failure card on the next EMAIL draft composed in that thread.
- **`ParserNotes` is one component for both disclosures**, added in task 2 and extended in task 3,
  rather than two blocks. They are the same kind of statement ("what happened to your ask before
  you were shown this") and two boxes would read as two unrelated warnings.
- **`docs/playbooks/cockpit.md` was updated too.** It watches the whole workspace directory AND
  `convex/plans.ts`, both of which this plan touched (§9). The entry records what actually changed
  for the cockpit: one branch in the plan-kind switch, a second `useSendCockpitMessage` caller on
  this canvas, and still no second UI→dispatch entry point.

### Auto-fixed issues

- **[Rule 2 — missing critical functionality] `resetPlan` did not clear `proposalRefusal`.** Found
  while tracing what recycles a thread's plan row. Fixed in the task-1 commit with the comment
  naming the failure it prevents.

## Deferred Issues

- **NOT SEEN IN A BROWSER.** The local Convex backend was out of scope for this session by
  instruction, so every guarantee here is unit-asserted by calling the folds, plus source-slice
  assertions for the JSX wiring. **No live verification is claimed.** What a live run should watch:
  a refused proposal rendering the card in BOTH the card slot and the canvas tab, the retry
  producing exactly ONE chat turn, and a salvaged/adjusted proposal showing its notes above the
  storyboard. `apps/web/e2e/media-canvas.spec.ts` is where those belong.
- **`resetPlan` still does not clear `altShots` / `altTargetDurationSeconds` / `lostVariation` /
  `deckAdjustments`.** Pre-existing (33-02/33-03/33-11/33-12) and unreachable today because
  `persistDeck` whole-deck-writes all four on every proposal. Logged in `deferred-items.md`.
- **The refusal memo body promises a direction it no longer carries** — *"I'll keep the direction
  below"* over a body that IS only the refusal sentence. Mostly invisible now that the canvas
  renders the card instead of the body, still wrong wherever the body is read. Logged in
  `deferred-items.md`.
- **`SceneTile`'s `clipSeconds` parameter is unused** (biome, 1 warning). Carried from 33-06 through
  33-07/33-08, verified pre-existing.
- **`graphify update` / `extract-convex-edges` not run by this plan** — `graphify-out/*` carries
  foreign uncommitted changes from another lane on this shared tree; the per-commit background
  rebuild and the SessionStart hook cover it.
- **STATE.md / ROADMAP.md not edited by this plan**, by instruction (STATE.md carries six
  frontmatter blocks and `gsd-tools state *` was forbidden for this session).

## Self-Check: PASSED

- `packages/core/src/storyboard.ts` — FOUND (`deckRefusalClause`, both tables)
- `packages/backend/convex/schema.ts` — FOUND (`proposalRefusal`)
- `packages/backend/convex/plans.ts` — FOUND (`landStoryboardRefusal` args, two clears)
- `packages/backend/convex/dispatch.ts` — FOUND (three call sites carry the code)
- `apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts` — FOUND (`proposalFailureCard`,
  `salvageNote`, `adjustmentNotes`)
- `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx` — FOUND (`ProposalFailureCanvas`,
  `ParserNotes`)
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — FOUND (refusal branch ahead of the memo card)
- `docs/playbooks/media.md`, `docs/playbooks/cockpit.md` — FOUND
- commits `0484ebd`, `e54ae63`, `7b17640`, `2b53795` — all FOUND in `git log`
