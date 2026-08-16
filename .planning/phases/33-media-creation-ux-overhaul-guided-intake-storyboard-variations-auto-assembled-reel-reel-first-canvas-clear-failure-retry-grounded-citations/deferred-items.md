# Phase 33 — deferred items

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
