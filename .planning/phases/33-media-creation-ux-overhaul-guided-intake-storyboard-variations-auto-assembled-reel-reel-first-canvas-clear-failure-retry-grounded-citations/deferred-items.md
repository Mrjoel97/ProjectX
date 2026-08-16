# Phase 33 — deferred items

## ~~A cited document's TITLE is model-authored, even when `verified` is true~~ — CLOSED 2026-08-16, `d69fc29`

**Status: FIXED between waves 8 and 9 by the phase orchestrator**, not deferred to 33-09/33-10.
Neither remaining plan owns `media.ts` (33-09 is the skill body, 33-10 is the e2e gate), so the
"owner: whoever next touches `sceneCitations`" below resolved to nobody and it would have escaped
the phase. `sceneCitations` now returns the vault row's own `title` for a verified citation and
keeps the model's string only where no owned document contradicts it. Two tests added (title comes
from the row; renaming the doc renames the citation) — RED observed before the fix. The
pre-existing assertion expected the model's string and so **enshrined the hole**; it was corrected
with the reason recorded beside it. Full `media.test.ts` 237 passed, `llmRedaction` 60 passed,
`tsc --noEmit` clean.

Original write-up follows.

---

## A cited document's TITLE is model-authored, even when `verified` is true (found in 33-08)

`media.sceneCitations` returns `title: s.source?.title` — the title the MODEL wrote into the shot
element — alongside `verified`, which only answers "is `source.docId` a document of this tenant's?".

The two are independent. A model can cite a real, owned document under a fabricated title:
`verified: true`, `docId` genuine, `title` invented. The canvas then renders the invented title as
the source of the figure, and the click-through opens the real document — where a user who bothers
to look sees a different name, and a user who does not never learns.

This is the provenance-laundering shape this repo already has a named defect class for (agent-written
text rendered as the owner's own), one door further along: the FIGURE is now gated by
`confirmClaim`, but the SOURCE LABEL beside it is not.

**Why 33-08 did not fix it.** The fix belongs in `media.sceneCitations` (return the vault row's own
`title` for a verified doc, and keep the model's string only as an unverified label) —
`packages/backend/convex/media.ts`, which 33-08 does not own beyond the one-field `JobFace`
projection it needed. It is 33-03's shipped surface, not a defect this plan's changes introduced,
so the scope-boundary rule applies.

**Cost of the fix:** ~3 lines in `sceneCitations` (it already has the `doc` in hand from the
ownership check — `doc.title` is right there) plus one test. Cheap, and the canvas needs no change:
`citationView` renders whatever `title` arrives.

**Owner:** whoever next touches `sceneCitations` — 33-09 or 33-10.

---

## 33-13 — two things seen while wiring the proposal failure card

**1. `resetPlan` does not clear `altShots` / `altTargetDurationSeconds` / `lostVariation` /
`deckAdjustments`.** It clears `shots` and the whole render plane, and 33-13 added
`proposalRefusal` to the list (a stale refusal code would have put a media failure card on the
next EMAIL draft in that thread). The four deck-plane siblings are still missing. It is not
reachable today — `persistDeck` writes the whole deck plane on every proposal and clears all four
— so nothing shows a stale alternate or a stale disclosure. It is one `undefined` per field the
day a path writes `shots` without going through `persistDeck`. Pre-existing (33-02/33-03/33-11/
33-12), out of 33-13's scope.

**2. The refusal memo body promises a direction it no longer carries.** `sceneRefusalBody` /
`deckRefusalBody` end with *"Ask me to redo the scene deck and I'll keep the direction below"* —
but `landStoryboardRefusal` PATCHES `plan.body` to that sentence alone, so there is nothing below
it on the row. The specialist's prose is in the transcript, not on the card. 33-13 makes this
mostly invisible (the canvas now renders the failure card, not the memo body) but the sentence is
still wrong wherever the body is read. One-line fix: drop the clause, or append the run's body.
