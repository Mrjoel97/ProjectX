---
phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations
plan: "08"
subsystem: media
tags: [react, ui, brand, derivations, vitest, tdd, a11y, citations, provenance, failure, money]

# Dependency graph
requires:
  - phase: 33 (plan 33-02)
    provides: plans.shots[].source / needsConfirmation / confirmedAt, media.confirmClaim
  - phase: 33 (plan 33-03)
    provides: media.sceneCitations, the unconfirmed_claims gate on jobEstimate and the reserve
  - phase: 33 (plan 33-04)
    provides: media.retryRender, media.setSceneVisual, rearmAfterFix, the doubled render line
  - phase: 33 (plan 33-06)
    provides: mediaCanvasView as the derivation home, heroState's held/failed modes, failureText
  - phase: 20.2 (wave 6)
    provides: media.regenerateBlock's scene arm, media.setSceneAsset, the vault picker on the tile
  - phase: 26 (plan 26-08)
    provides: UNLANDED_RESOLVES.media === false — media money never resolves
provides:
  - citationView — the four citation states, the link rule, and the deck's confirm count
  - failureCards — the four card families, the sunk-cost line and the retry price
  - failureClause — an unknown code gets a sentence, never becomes the prose
  - FailureCardBlock + the citation row + the fix menu in MediaCanvas.tsx
  - media.byPlan's JobFace carries failureReason
affects: [33-09, 33-10, media, mediaCanvasView, MediaCanvas, cards]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "compute the link ONCE above every branch, so no arm of a state machine can mint one it should not"
    - "a fourth state rather than a rounding: unverified is not needs_confirmation, because the backend gate and the confirm mutation both key on the flag"
    - "swap-test money by TRANSPOSING two rendered values, not by deleting one — deletion is noticed by almost any assertion"
    - "a failure code has two renderings: a sentence (unknown → generic) for prose, and itself for the subordinate detail line"

key-files:
  created: []
  modified:
    - apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts
    - apps/web/app/(app)/dashboard/workspace/mediaCanvas.test.ts
    - apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - packages/backend/convex/media.ts
    - docs/playbooks/media.md
    - docs/playbooks/cockpit.md

key-decisions:
  - "`unverified` is a FOURTH citation state, not the `needs_confirmation` the plan named: confirmClaim answers not_a_claim for a scene the parser never flagged, and the Generate gate keys on needsConfirmation alone — so a confirm button there could only ever refuse and calling it a block would be a second lie"
  - "The retry price adds the estimate's OWN render line, because regenerateBlock reserves a render alongside the scene; with no estimate loaded the label says 'plus the re-assembly' rather than quoting a number that omits it — understating money is the one direction a price label may not err in"
  - "A kind switch is priced FREE and says the cheaper picture is bought by the regenerate that follows, rather than quoting a per-still figure derived by dividing the estimate's stills line — a per-unit division would be a second estimate, which is the one thing this module may not produce"
  - "media.byPlan's JobFace gained failureReason (a 2-line backend change) rather than reading the code off assetUrls: that query returns every attempt oldest-first while the face is one chosen row, so on a regenerated scene the two can name different attempts"
  - "cards.tsx's VaultDocButton was EXPORTED rather than copied — it already routes through api.vault.vaultDoc, whose null-for-another-tenant answer is exactly the guarantee a citation click-through needs"
  - "The held card carries no arm of its own and points at the failed scene's card: a Retry render there buys a second sandbox over the same hole"
  - "confirmedAtLabel was dropped: a formatted timestamp in a server-rendered React tree is a hydration hazard for no information the audit log does not already hold — the card says WHO confirmed, which is the part that matters"

patterns-established:
  - "mutation-check a money assertion by transposing two rendered values rather than deleting one, and record the red count"

requirements-completed: [33-CITE, 33-FAIL]

# Metrics
duration: ~1 session
completed: 2026-08-16
---

# Phase 33 Plan 08: Grounded citations and clear failure on the canvas Summary

The canvas is finished. Every scene that states a figure now shows **where it came from** — the
vault document's title, clickable through to `PreviewModal` — or shows that **nobody has vouched
for it yet**, with the one click that changes that. Every failure now reads as a sentence with a
price beside it: what broke, what the attempt already cost, and what each way out adds.

## What shipped

### The citations, and the fourth state

`citationView(citations)` folds `media.sceneCitations` into four per-scene states. Three were in
the plan; the fourth is the one worth the paragraph.

`sceneCitations` returns `verified: false` for a source id that is foreign, malformed or deleted —
deliberately indistinguishable from each other, so a probing model learns nothing. The plan said to
render such a row as `needs_confirmation`. **It cannot be.** `confirmClaim` answers `not_a_claim`
for a scene the parser never flagged, and `firstUnconfirmedClaim` — the gate on both `jobEstimate`
and the reserve — keys on `needsConfirmation` alone. Rendering an unverifiable source as "needs
your confirmation" would therefore promise a button that can only refuse *and* announce a block
that is not there. So `unverified` is its own state: plain text, no link, no button, no count. A
row that is **both** unverified and flagged is still confirmable — the owner is the door, and that
door does not depend on the model's cited document checking out.

The link is computed **once, above every branch**, so no arm can mint one from an unverified row —
the property is structural rather than repeated in four places. Click-through reuses
`cards.tsx`'s `VaultDocButton`, exported rather than copied: it already routes through
`api.vault.vaultDoc`, which answers `null` for another tenant's id, and a second copy would have
been a second place to forget that. It renders in `--teal-900` and **underlined**, because small
`--teal-600` text is ~2.9:1 (BRAND §6) and an affordance signalled by colour alone is no
affordance.

Beside the disabled Generate button, `blockLine` says `"Confirm 2 claims to enable Generate."` —
the COUNT, which `jobEstimate`'s refusal cannot give, since it names only the first offending
scene. The refusal sentence stays the authoritative "why".

### The failure cards, and the money

`failureCards(plan, scenes, estimate)` returns four families through one card shape: a per-scene
card for every failed or blocked face, a RENDER card with the free retry, a HELD card, and a
CAPTION card. Hero cards first, then scenes in deck order.

**The held card carries no arm of its own.** `incomplete_batch` means a scene never landed; a
"Retry render" there buys a second sandbox over the same hole. It names the offending scene and
sends the user to that tile's fix menu, which is where the levers already are.

**The caption card has no arm either**, and that is honest rather than lazy: no re-burn mutation
exists, and 20-17's rule is that a caption failure never unpublishes the reel. It reports a
degraded deliverable over a reel that still plays.

**The two money rules are the reason this is a tested fold and not JSX:**

- **Sunk** is `actualCents` when a face LANDED and its `estUsd` reservation when it FAILED.
  `media.ts` states that `actualCents` *"stays absent if it failed"*, and `UNLANDED_RESOLVES.media`
  is `false` — that reservation is spent, permanently. The line says **spent**; the word "pending"
  cannot appear.
- **Retry adds** is this scene's own reserved lines **plus the estimate's own `render (incl. one
  retry)` line**, because `regenerateBlock` reserves a render alongside the scene. Nothing is
  re-priced: every component is a number the server computed against the table the reserve
  consumes. With no estimate loaded the label reads `"$0.42 adds, plus the re-assembly"` rather
  than quoting a total that silently omits it.

A kind switch is **free** and buys nothing — the cheaper picture is bought by the regenerate that
follows, "about a fortieth of a generated clip" (the measured ratio, not the old tenth).
`text_card` is the arm that can end a hold with no spend at all, and it asks for the card's words
before firing rather than buying a knowable `no_overlay` refusal.

### A code is never prose

`failureClause` maps every code in four closed vocabularies — `STDERR_CODES` / `RenderRunnerCode`,
`RenderRefusal` plus the trigger-side `incomplete_batch`, the retrier's
`submit_canceled`/`submit_failed`, and the caption codes — to a sentence, and an **unknown** code
falls back to a generic clause. `failureText` still falls through to the code itself, which is
right for the detail line and wrong for a headline. Every card prints its code exactly once, in
`.trace-line` (the mono, dimmed idiom the tile already uses), underneath.

No card model can contain a provider string by construction: `mediaJobs.failureReason` and
`plans.renderReason` are CODE fields by schema contract (§4).

## Task commits

| Task | RED | GREEN |
|------|-----|-------|
| 1 — citationView / failureCards / failureClause | `b56f0ec` | `3b58092` |
| 2 — citation chips, confirm flow, `JobFace.failureReason` | — (typecheck-verified) | `dfae8d9` |
| 3 — failure cards, fix menu, retry | — (typecheck-verified) | `d6e4e1a` |
| playbooks — §9 same-phase update | — | `6a060f8` |

## Verification

```
apps/web         npx vitest run
  Test Files  24 passed (24)
  Tests       376 passed (376)
  app/(app)/dashboard/workspace/mediaCanvas.test.ts (101 tests) ✓

packages/backend npx vitest run media.test.ts llmRedaction.test.ts importGuard.test.ts
  Test Files  3 passed (3)
  Tests       382 passed | 24 skipped (406)

apps/web         npx tsc --noEmit  → clean
packages/backend npx tsc --noEmit  → clean
biome check (5 touched files)      → 1 warning, pre-existing (see Deferred)
node scripts/check-playbooks.mjs   → media.md and cockpit.md satisfied
```

`mediaCanvas.test.ts` went 78 → 101. **The RED was real:** the first run of the task-1 tests was
`22 failed | 78 passed` with `(0 , failureCards) is not a function`.

**The mutation check.** The repo's vacuous-test lesson says deletion is a weak mutation — an absent
value is noticed by almost any assertion — so the sunk-cost guarantee was checked by
**transposition**: the two rendered money expressions (`faceCents(clip) + faceCents(voice)` and
`sceneEstCents(s) + renderCents`) were swapped in the implementation, leaving both numbers present
under the wrong labels. **4 tests went red.** Reverted; 100 green again. The fixtures keep the two
numbers deliberately unequal ($0.52 sunk, $0.47 adds) for exactly this reason, and one test also
transposes `estUsd` ↔ `actualCents` in the fixture and pins that the line moves ($0.52 → $0.42).

`packages/backend` was re-tested because of the one-field `JobFace` change:
`llmRedaction.test.ts`'s media count pins (11 payload literals, 7 audit sites, media.ts's 2) are
untouched — no audit or log-plane site was added.

## Deviations from Plan

### In-plan judgement calls

- **`unverified` is a fourth citation state.** The plan said a `verified:false` row "maps to
  needs_confirmation". It cannot, for the two reasons above — a button that only refuses and a gate
  that is not there. Documented in `media.md` so the next reader does not "fix" it back.

- **`confirmedAtLabel` was dropped.** The plan named it. A formatted timestamp in a server-rendered
  React tree is a hydration hazard, and the information it carries (when) is in the audit log while
  the information that matters (who) is in the word "You". The confirmed state says "You confirmed
  this figure."

- **The cheaper-kind arm quotes no dollar figure of its own.** The plan offered "priceLabel from
  the estimate's still/card line or 'free'". The estimate's `stills` line is a deck-wide aggregate;
  deriving a per-still price by dividing it would be a second estimate, which this module's founding
  rule forbids. The switch is genuinely free — `setSceneVisual` buys nothing — and the note names
  the 40× ratio and says the still is bought by the regenerate that follows. That is both the
  cheaper claim and the true one.

- **`packages/backend/convex/media.ts` was modified, and it is not in the plan's `files_modified`.**
  Two lines: `failureReason` on `JobFace` and on `faceOf`. The alternative was reading the code off
  `assetUrls`, which is change-free and wrong — that query returns every attempt oldest-first while
  the face is one chosen row, so on a regenerated scene a card would say "failed" from one row and
  print the other row's code. Safe to project by the same rule that lets it be stored: it is a CODE
  field, never provider prose (§4).

- **`cards.tsx` was modified, and it is not in the plan's `files_modified`.** One keyword:
  `VaultDocButton` is now exported. Ladder rung 2 — the component that opens a vault doc from an id
  already exists three hundred lines away and already has the tenant check the citation needs.

- **`refusalText` gained five codes** (`no_overlay`, `not_failed`, `no_block`/`no_deck`,
  `unknown_visual`, `not_a_claim`) rather than a new refusal map for the fix menu. One refusal
  vocabulary, wherever it is read — the same reason 33-06 put `no_alternate` and `deck_locked`
  there.

- **`docs/playbooks/cockpit.md` was updated too.** It watches the whole
  `apps/web/app/(app)/dashboard/workspace/` directory, so `cards.tsx` and `MediaCanvas.tsx` are
  both its files. The entry records that there is NO new cockpit behaviour — one exported keyword,
  four direct `useMutation` calls, and still exactly one `useSendCockpitMessage` caller on this
  canvas.

### Auto-fixed Issues

None. No bug, missing-critical-functionality or blocking issue was found inside this plan's scope.

## Deferred Issues

- **A cited document's TITLE is model-authored even when `verified` is true.** Found while reading
  `sceneCitations`: `verified` answers only "is that docId yours?", while `title` is the string the
  model wrote. A model can cite a real owned document under an invented name. This is the
  provenance-laundering defect class one door further along — the FIGURE is gated by `confirmClaim`,
  the SOURCE LABEL beside it is not. It is 33-03's shipped surface, not something this plan's
  changes introduced, so the scope boundary applies. Written up with the ~3-line fix (the query
  already has `doc` in hand) in
  `.planning/phases/33-…/deferred-items.md`. **Owner: 33-09 or 33-10.**
- **`SceneTile`'s `clipSeconds` parameter is unused** (biome `noUnusedFunctionParameters`, 1
  warning). Carried from 33-06 through 33-07, verified pre-existing, still out of scope.
- **Not seen in a browser.** Every guarantee here is unit-asserted by calling; the citation chips,
  the confirm button, the fix menu and the retry have only been typechecked. **33-10 owns the live
  gate** and now owes `apps/web/e2e/media-canvas.spec.ts` assertions for: a citation chip opening
  the real document, a confirm click clearing the Generate block, and a held reel's card routing to
  the failed scene's fix menu. The interaction most worth watching is `setSceneVisual` →
  `rearmAfterFix` → the hold ending with no new landing, which no unit test can reach.
- **`graphify update` / `extract-convex-edges` not run by this plan.** `graphify-out/*` carries
  foreign uncommitted changes from another lane on this shared tree; the per-commit background
  rebuild and the SessionStart hook cover it, and staging those files here would sweep up work this
  plan does not own.

## Self-Check: PASSED

- `apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts` — FOUND
- `apps/web/app/(app)/dashboard/workspace/mediaCanvas.test.ts` — FOUND
- `apps/web/app/(app)/dashboard/workspace/MediaCanvas.tsx` — FOUND
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` — FOUND
- `packages/backend/convex/media.ts` — FOUND
- `docs/playbooks/media.md` — FOUND
- `docs/playbooks/cockpit.md` — FOUND
- commits `b56f0ec`, `3b58092`, `dfae8d9`, `d6e4e1a`, `6a060f8` — all FOUND
