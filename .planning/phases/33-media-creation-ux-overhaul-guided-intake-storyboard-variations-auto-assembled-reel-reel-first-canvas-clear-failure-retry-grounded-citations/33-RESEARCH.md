# Phase 33: Media Creation UX Overhaul - Research

**Researched:** 2026-08-15
**Domain:** UX overhaul over the shipped scene-deck reel pipeline (Phase 20 + 20.2) — Convex + Next.js workspace canvas, no new generation capability
**Confidence:** HIGH (almost everything verified against in-repo code and playbooks; one external fact web-verified)

## Summary

Phase 33 is a UX phase over machinery that is **more finished than the phase title implies**. The
critical baseline finding: **Phase 20.2 waves 1–8 are ALL code-complete on disk** despite the
`status: proposed` header and missing per-plan SUMMARYs. Verified directly: `parseSceneDeck` /
`TARGET_DURATIONS` / `Scene` in `packages/core/src/storyboard.ts`, `reserveSceneJobInner` /
`jobEstimate` / `generateReel` / `regenerateBlock` / `setSceneAsset` in
`packages/backend/convex/media.ts`, `media-director.md` v2 (SCENE DECK + Target duration),
scene sidecar + captions-by-take, the wave-6 canvas (ribbon, vault picker, per-kind statuses), and
the wave-7 price table (`SCENE_VISUAL_LINE` in `packages/cost/src/media.ts`, ADR-019). The playbook
(`docs/playbooks/media.md`) carries dated landing notes for every wave through 2026-08-15.
**The one unverifiable-offline item: whether `media-director` v2 is SEEDED in the live deployment**
— `pnpm dev` seeds, `npx convex dev` does not, and until seeded the live specialist still writes
block decks. That is a Wave-0 pre-flight, with a read-back (skill-version-collision gotcha).

Second key finding: **the "auto-assembled reel" is already mostly true.** After the one Generate
click, the pipeline runs unattended: webhook landings → `maybeStartRender` (last landing, once-only
`pending → rendering` guard) → sandbox assemble → `maybeStartCaptions`/`maybeBurnCaptions` (STT in
parallel with render; burn fires from whichever terminal arrives second) → `renderStorageId`
repointed at the **captioned** cut. Zero intermediate clicks exist today. What phase 33 actually
adds on this deliverable: vault auto-save of the final, regenerate-after-done re-assembly UX, and
the failure/retry surface. Most of the six deliverables are **presentation + contract extensions**
over existing reads (`byPlan`, `jobEstimate`, `reel`, `assetUrls` — all reactive, no polling).

Third: **the two genuinely new backend contracts are (a) two decks against one plan and (b)
per-scene citations with owner confirmation.** `plans.by_thread` is `.unique()` — one plan row per
thread, deck inline in `plans.shots` — so variations must live as new optional fields on that one
row, and every money/regenerate path (`sceneDeckOf`, `reserveSceneJobInner`, `batchToRender`,
`regenerateBlock`) must only ever see the PICKED deck. Citations have strong in-repo precedents:
the Phase-14 document-level citation shape (`citationDocId`/`citationTitle`/`citationExcerpt` on
evaluations), the blueprint's derived-vs-confirmed tier with its confirm gate, and the
provenance rule's implementation idiom ("derived from authenticated identity, never from args").

**Primary recommendation:** Plan this as thin extensions of named existing modules —
`mediaCanvasView.ts` for every new sentence/derivation, `storyboard.ts` §-parsers for brief +
citations + second deck, `plans` row fields for new state, `spendEvents`/`mediaJobs` for sunk-cost
honesty — and treat the media-director body edit (free, ungated, but seeding + round-trip-test +
A/B discipline required) as its own late wave.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary:** Reshape the EXPERIENCE of creating a reel on top of the shipped scene-deck
pipeline. Six deliverables: guided intake, storyboard variations, auto-assembled reel, reel-first
canvas, clear failure retry, grounded citations. No new generation capability, no new provider, no
publishing.

**Locked prior decisions (not revisitable):** only a human click spends money (`searchVault` is the
specialist's only grant); whole job reserved in ONE serializable transaction, no refunds; scene
decks with four visual kinds priced per kind, cheap kinds are a feasibility requirement (ADR-019);
durations 15/30/60s; provider OpenAI GPT Image 2 / Sora 2 (ADR-017), **Sora 2 Videos API shuts down
2026-09-24**; canvas lives in the workspace right pane, "a canvas, not a video editor"; agent
figures never stored/rendered as the owner's own word.

**Guided intake:**
- Hybrid shape: chat + brief chips. Freeform in cockpit chat; canvas shows the parsed brief as
  editable chips BEFORE any storyboard. Canvas is source of truth for what was captured.
- Required fields: topic + target duration ONLY. Audience/tone/brand voice default from business
  profile / BRAND.md. Phase-11 rule: never block on fields idea-stage tenants can't fill.
- Duration is a preset: 15 / 30 / 60 seconds. No free entry. 60s shows its higher cost up front.
- Editing a brief chip after storyboards exist marks them stale ("brief changed" badge) + free
  re-propose button. Nothing auto-fires; token spend stays user-initiated.

**Storyboard variations:**
- Two variations, side by side, token-only (no media dollars until Generate).
- Variations are distinct concepts — different angle AND visual treatment, not
  same-script-different-visuals.
- Unpicked deck stays switchable until Generate. Generate locks the choice and discards the other.
- No cross-deck scene mixing; the per-scene editor covers it by hand.

**Reel-first canvas:**
- Layout: player hero at top + scene strip below. One layout for the whole lifecycle.
- Pre-reel hero = live pipeline tracker (generate → voice → assemble → captions) with per-scene
  landing status. Reactive queries, NO polling, no fake preview.
- Estimate UI: total headline + expandable breakdown (per-kind lines + remaining daily budget).
  The 40× clip-vs-still difference stays discoverable.
- Playback: muted autoplay loop when the final lands, tap for sound.

**Auto-assembled reel:**
- One approval carries the pipeline to the CAPTIONED final mp4, zero intermediate clicks.
- Destination: canvas + auto-save to vault (reusable, groundable, survives the plan).
- Regenerate-after-done keeps the one-click contract; old final stays available until the new lands.
- Chat revisions until Generate (free re-proposals update the canvas). Post-Generate, edits are
  canvas-only through the paid rail.

**Failure & retry:**
- Plain-language failure cards: what happened, which scene/stage, what fixing it costs (free vs $).
  Refusal/STDERR codes stay underneath as a detail line.
- Render-stage failures get ONE automatic retry, then a failure card with manual "Retry render".
- A failed paid scene HOLDS the reel before assembly; per-scene fix menu: edit prompt & regenerate
  (paid, price shown), switch to a cheaper kind, or pick a vault asset.
- Full economic honesty per retry: show what the failed attempt consumed and what the retry adds.

**Grounded citations** *(Claude's recommendations accepted with "proceed" — flag at plan review if
any looks wrong)*:
- Every factual claim in narration/text cards must cite the vault doc it came from. Creative copy
  needs no citation.
- Citations render per scene in the canvas (doc title, clickable → PreviewModal). The reel stays
  clean.
- Ungrounded claims block Generate until confirmed ("needs your confirmation" badge); the owner
  confirms each or the line is rewritten. The model proposes; only the owner vouches.
- Citations persist with the vault-saved reel as metadata — refs and ids ONLY (CLAUDE.md §4).

### Claude's Discretion
- Chip/badge/tracker visual design, spacing, typography — per BRAND.md and globals.css tokens.
- Exact shape of the citation metadata on the vault asset (refs-only contract binds it).
- How the stale-storyboard badge and switchable-deck UI look.
- How the brief parse (chat → chips) is implemented (specialist tool vs parser).
- Which render failure codes count as "transient" for the one auto-retry.
- Plan/wave decomposition.

### Deferred Ideas (OUT OF SCOPE)
- End-of-reel sources/credits card (public-facing citations) — declined; canvas-only verification
  plus vault metadata covers provenance. Revisit if reels get published (Phase 32).
- Cross-deck scene mixing UI — declined; per-scene editor covers it by hand.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were pre-assigned ("TBD — derive from CONTEXT.md"). The phase serves **MEDIA-01**
(pending; Phase 20/20.2 carry the capability, this phase carries its UX). Researcher-derived
requirement rows for the planner to mint or map:

| ID (proposed) | Description | Research Support |
|----|-------------|-----------------|
| 33-INTAKE | Chat + brief-chip guided intake; topic + duration preset required; chip edit marks decks stale with free re-propose | §-parser precedent (`parseScript`/`parseArtDirection`), `shotsChangedAt` staleness idiom, plan-row field placement |
| 33-VARIA | Two distinct-concept storyboard variations, side by side, token-only, switchable until Generate | `persistStoryboard` terminal, single-plan-row constraint, media-director body ungated |
| 33-REEL | One Generate → captioned final mp4 unattended + vault auto-save + regenerate keeps one-click | Pipeline already unattended (verified); `research.persistFindings` vault-write precedent; retention rules |
| 33-CANVAS | Player-hero + scene-strip layout, pipeline tracker in the hero slot, total-headline estimate, muted autoplay | `byPlan`/`jobEstimate`/`reel` reactive reads already carry every input; `mediaCanvasView.ts` derivation home |
| 33-FAIL | Plain-language failure cards, one auto-retry for transient render codes, per-scene fix menu, sunk-cost honesty | `STDERR_CODES` closed union, `failureText()`, `mediaJobs` per-line costs, `spendEvents` correlations |
| 33-CITE | Per-scene vault citations, ungrounded-claim confirm gate before Generate, refs-only metadata on the saved reel | `searchVault` returns docIds+titles, Phase-14 citation shape, blueprint confirm-tier, provenance idiom |
</phase_requirements>

## Standard Stack

No new libraries. Everything the phase needs is already installed and shipped.

### Core (all existing, reuse)
| Asset | Where | Purpose | Why |
|---------|---------|---------|--------------|
| Convex reactivity | `tenantQuery` subscriptions | Pipeline tracker, deck switch, failure cards | NO-polling rule is load-bearing (playbook: "if a `setInterval` looks necessary, the bug is elsewhere") |
| `mediaCanvasView.ts` | `apps/web/.../workspace/` | ALL new derivations + copy | apps/web runner is .ts-only/DOM-less; logic in the .tsx can only be tested as source text (named defect class) |
| `parseSceneDeck` + §-parsers | `packages/core/src/storyboard.ts` | Brief section, citations, second deck | Free at parse time, refuses before a cent moves; `parseScript`/`parseArtDirection` show the section-parser pattern |
| `reserveSceneJobInner` / `jobEstimate` | `packages/backend/convex/media.ts` | The one money gate / the one number | Pinned equal by test (`res.estCents === estimate.totalCents`); estimate UI is presentation over `jobEstimate`'s existing `lines[] + totalCents + capCents + remainingCents + refusal` |
| `SCENE_VISUAL_LINE` / `sceneVisualSpec` | `packages/cost/src/media.ts` | Per-kind pricing (fix-menu prices) | ONE table both money sites read (ADR-019) |
| `plans` row fields | `packages/backend/convex/schema.ts` | Brief, variant deck, citations, confirms | Deck is INLINE on the unique-per-thread plan row by decision — a second table would fight the editor |
| `spendEvents` + `mediaJobs` | `spendLedger.ts`, `media.ts` | Sunk-cost honesty on retry cards | Correlations `mediabatch:<batchId>` (reserved) and `mediabatch:<batchId>:<jobId>` (actual); per-line `estUsd`/`actualCents` on `mediaJobs` rows |
| `research.persistFindings` idiom | `packages/backend/convex/research.ts:134` | Vault auto-save of the final reel | Direct precedent: system-authored `vaultDocuments` insert with known text, `contentHash`, `status:"processing"` → normal chunk/embed rail |
| `PreviewModal` | `apps/web/.../vault/PreviewModal.tsx` | Citation click-through | Exists; vault doc preview |
| Playwright e2e | `apps/web/e2e/media-canvas.spec.ts` | Browser verification | Live harness exists with traps documented in `e2e/README.md` |

### Provider stack (locked, ADR-017)
| Provider | Purpose | Status |
|---------|---------|--------|
| OpenAI Sora 2 (`sora-2`) | `generated_video` clips (4/8/12 s grid) | **API shuts down 2026-09-24** — verified externally (see State of the Art) |
| OpenAI GPT Image 2 | `animated_image` stills ($0.01 flat) | current |
| OpenAI TTS/STT | voice + word-timed captions | current |
| Vercel Sandbox + baked ffmpeg | assemble + caption burn | snapshot `snap_shetn…` live |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| §-parser for brief (BRIEF section in the specialist body) | A new cockpit tool the model calls (`captureBrief`) | Tool = schema-validated args but a body/tool-args drift risk (memory: skill-body edits shift tool args) and a second write path; §-parser reuses the proven persistStoryboard terminal. **Recommend §-parser.** |
| Two decks in ONE specialist turn | Two separate turns | One turn halves latency/tokens and guarantees the decks are contrasted against each other; doubles output length per turn. **Recommend one turn, two labeled decks.** |
| Vault auto-save via direct `vaultDocuments` insert (persistFindings idiom) | Full upload-ingest path (`vaultIngest`) | Ingest would re-transcribe a video we already have the transcript for (the narration + STT words) — paid LLM/STT work for nothing. **Recommend direct insert, text = narration transcript, mp4 storageId attached.** |

**Installation:** none.

## Architecture Patterns

### Where each deliverable lands

```
packages/core/src/storyboard.ts        # BRIEF §-parser; per-scene Source: line; two-deck parse
packages/contracts/skills/media-director.md  # v3 body: brief echo, two variations, citations (+ .ts mirror regen)
packages/backend/convex/schema.ts      # plans: brief fields, altShots/variant deck, sceneCitations, confirms
packages/backend/convex/media.ts       # confirm-claim mutation, pick-deck mutation, retry-render mutation
packages/backend/convex/mediaComplete.ts / render/renderReel.ts  # one auto-retry, vault auto-save hook
packages/backend/convex/dispatch.ts    # persistStoryboard reads two decks + brief
apps/web/.../workspace/mediaCanvasView.ts  # every new sentence/derivation (tested by calling)
apps/web/.../workspace/MediaCanvas.tsx # hero+strip layout, chips, deck switcher, failure cards
docs/playbooks/media.md                # same-commit bumps (Stop hook enforces)
docs/decisions/                        # new ADR only if the no-render-retry decision is superseded
```

### Pattern 1: The pipeline is ALREADY unattended — extend, don't rebuild
**What:** After Generate: landings → `maybeStartRender` (`pending → rendering` is the once-only
guard, no chain, no poller) → sandbox → `maybeStartCaptions` (last voice take) / `maybeBurnCaptions`
(fires from transcript-landing AND render-terminal; second arrival wins) → `renderStorageId`
repointed at the captioned cut. A caption failure never unpublishes (`renderStatus` stays
`rendered`, uncaptioned cut stands).
**When to use:** The "auto-assembled reel" deliverable is: (a) hook vault auto-save into the
caption terminal (and the no-captions render terminal), (b) keep the old final available during
regenerate (retention already keeps `final.mp4` + sidecar; the regenerate flow clears render fields
— the "old final stays available" decision needs the old storageId held until the new one lands,
a small ordering change, not new machinery), (c) surface it all in the tracker.
**Trap:** the render trigger refuses on a failed sibling (`incomplete_batch`) — that IS the
"failed paid scene HOLDS the reel" behavior, already structural. The fix menu resumes it by making
the scene renderable again (regenerate / kind switch / `setSceneAsset`), after which the NEXT
landing re-fires `maybeStartRender`. Check: a kind-switch to card/still is a STRUCTURAL edit
(stamps `shotsChangedAt`) — verify the re-trigger path for a batch whose last landing already
happened (the render was refused; something must re-arm it — likely the fix mutation itself should
call `maybeStartRender`'s logic or clear/reset render fields).

### Pattern 2: One plan row, two decks — the picked deck is the ONLY deck the money sees
**What:** `plans.by_thread` is `.unique()`; the deck lives inline in `plans.shots`;
`sceneDeckOf(plan)` feeds `jobEstimate`, `reserveSceneJobInner`, `batchToRender`, `regenerateBlock`.
**How:** Keep `plans.shots` = the currently-picked deck (so every existing consumer is untouched);
add optional `altDeck` (shots-shaped array + its own targetDuration if they differ) + a
`pickedAt`/lock flag. "Switch" swaps the two arrays in one mutation (structural edit → stamps
`shotsChangedAt`, correctly invalidating stale per-scene assets). Generate sets the lock and
deletes `altDeck` (the discard decision). The reservation code never learns variations exist.
**Anti-pattern:** a `decks[]` array with an index the money path reads — that puts variation state
inside the reservation contract, exactly what the CONTEXT's "the reservation/regenerate machinery
must only ever see the PICKED deck" warns against.

### Pattern 3: Brief chips = plan-row fields + §-parser + the `shotsChangedAt` staleness idiom
**What:** Specialist body emits a `BRIEF` section (topic, duration preset, audience/tone with
"defaulted from profile" markers); a new §-parser in `storyboard.ts` reads it;
`persistStoryboard` lands it on the plan row beside the deck. Chip edits are a tenant mutation
patching the brief fields + stamping `briefChangedAt`; `deck.proposedAt < briefChangedAt` derives
the "brief changed" badge in `mediaCanvasView.ts`. Free re-propose = the existing chat-revision
path (a new specialist turn), user-initiated.
**Duration preset:** `TARGET_DURATIONS = [15, 30, 60]` is already exported from core — the chips
render that constant; never a free-entry field.
**Phase-11 rule:** audience/tone/brand chips render as "defaulted" when the profile is thin; only
topic + duration are required (and duration can itself default with the chip showing which preset).

### Pattern 4: Citations ride the deck contract, confirmation rides the provenance idiom
**What:** Per-scene optional `Source:` line in the SCENE DECK (or a `CITATIONS` section keyed by
scene) naming a vault doc the specialist retrieved via `searchVault` (which already returns
parallel `docIds`/`titles`/`chunks` — `vaultGround.ts`). Parser carries it onto the scene; a
factual-claim scene without a source gets `needsConfirmation`.
**Tenant check is mandatory:** `asset.docId` precedent — the docId is MODEL-AUTHORED text, so
ownership is checked where it's consumed (canvas read + before persisting to the saved reel), or a
deck could cite any document in the deployment.
**Confirmation:** a tenant mutation `confirmClaim(planId, sceneIndex)` writing
`{ confirmedAt: Date.now() }` with identity **derived from `ctx` (authenticated), never from
args** — the exact idiom at `schema.ts:120` and the tenantProfile `userProvidedAt` provenance
split (ADR-021). The model must have no path to writing the confirmation (provenance-laundering
defect class: ask "who does the STORED row say wrote this, and can the model influence it?").
**Generate gate:** `jobEstimate` already returns a `refusal` the canvas renders and Generate
disables on — add an `unconfirmed_claims` refusal (free, at the estimate) so the block happens
where every other block happens. `reserveSceneJobInner` must refuse it too (the two open together
— the wave-5 co-location rule).
**Persistence:** refs-only metadata on the saved vault doc: `{ sceneIndex, docId, title?, claimHash,
confirmedAt? }` — ids/hashes/counts, never the claim text in audit payloads (CLAUDE.md §4; the
vault doc TEXT itself is content-plane and may carry the narration).
**Prior art for the shape:** Phase-14 evaluation findings (`citationDocId`, `citationTitle`,
`citationExcerpt`, absent-for-user-provided) — document-level citation was a LOCKED Phase-14
decision; stay document-level, not chunk-level.

### Pattern 5: Failure cards = `mediaCanvasView.failureText()` grown up, codes underneath
**What:** `failureText(reason, noun)` already maps codes to sentences. Failure cards extend this:
per-scene/per-stage plain words + cost of the fix (from `SCENE_VISUAL_LINE` via `sceneVisualSpec`)
+ the raw code as a detail line. The vocabularies are closed unions:
- **Reservation refusals:** `kill_switch`, `unknown_model`, `over_job_cap`, `illegal_duration`,
  `narration_too_long/_short`, `media_daily_exhausted`, `deployment_media_exhausted`,
  `unrenderable_block`, `duration_mismatch`, `stale_inputs`, `nothing_to_regenerate`.
- **Render/caption codes (`STDERR_CODES`, `packages/core/src/render.ts:300`):** `missing_binary`,
  `input_missing`, `bad_invocation`, `speech_out_of_window`, `clip_too_short`,
  `missing_narration`, `duration_mismatch`, `no_audio_stream`, `decode_failed`,
  `caption_track_empty`, plus runner-side codes and the catch-all `render_failed`.
- **Trigger-side:** `incomplete_batch` (a failed sibling held the render), `incomplete_blocks`.
**Sunk cost:** per-scene spent = the plan's `mediaJobs` rows (per-line `estUsd`, `actualCents`,
status); the reserved total = `spendEvents` row at `mediabatch:<batchId>`. Media's `unlanded` is
PERMANENT — never render it as "pending" (`UNLANDED_RESOLVES.media === false`).

### Pattern 6: The one auto-retry SUPERSEDES a recorded decision — do it narrowly and say so
**What:** 20-16 recorded "**a failed render does NOT retry**" (structural failures repeat; the
action-retrier would buy N sandboxes to learn the same thing N times) and dead-letters instead.
Phase 33's locked decision grants ONE automatic retry for render-stage failures.
**How to reconcile:** retry ONLY codes that are plausibly environmental, once, with a stored
`renderRetryCount` (or retriedAt) so the guard is structural: candidates are `missing_binary`
(the 2026-08-15 SIGPIPE class was exactly a transient-looking env race), sandbox-creation/transport
failures, and `render_failed` (the unmatched catch-all — unknown is not provably structural).
NEVER retry `duration_mismatch`, `speech_out_of_window`, `clip_too_short`, `missing_narration`,
`bad_invocation`, `input_missing`, `decode_failed` — deterministic repeats. The exact set is
Claude's discretion (per CONTEXT).
**Money note:** the render is a flat reserved line (~$0.02, a named constant, not metered). One
retry means a possible second sandbox against a line reserved once. Either double the render line
at reservation ("compute is already a reserved line" in the CONTEXT suggests the owner believes
it's covered — make it true) or record the cents drift explicitly. Do not let this leak silently
on a no-refunds rail.
**Governance:** this contradicts a dated playbook rule — the playbook section must be rewritten in
the same commit, and because 20-16's no-retry stance is recorded reasoning (not a formal ADR), a
short supersession note in the playbook suffices; a new ADR only if the planner prefers it durable.

### Pattern 7: Reel-first hero + tracker = pure derivation over existing reads
**What:** `byPlan` (per-scene job statuses, two rows per scene), `renderStatus` (5 states incl. the
out-of-date trap), `captionStatus` — all already reactive. The tracker is a fold of these into a
stage spine (generate → voice → assemble → captions) computed in `mediaCanvasView.ts`. The hero
slot renders tracker OR `<video autoPlay muted loop playsInline>` (native attributes, no player
lib — the app deliberately has no component library, BRAND.md).
**Keep:** the out-of-date trap (stale reel vs never-built are both `renderStatus: "pending"`;
landed-asset count separates them), `rendered`-with-no-url as a governed refusal sentence, verdict
copy as compliance statements, `aria-live="polite"` on progress regions (BRAND §6).

### Anti-Patterns to Avoid
- **Any ticker/`setInterval`/polling** — Convex reactivity is the mechanism; a ticker means the bug
  is elsewhere.
- **Logic in `MediaCanvas.tsx`** — it can only be tested as source text; everything derivable goes
  to `mediaCanvasView.ts` (the wave-6 rule).
- **A second estimate number** — `jobEstimate` and `reserveSceneJobInner` are pinned equal; the
  headline+breakdown UI reformats `jobEstimate.lines`, never re-computes.
- **The model writing confirmations, actor fields, or provenance** — three doors were found in one
  prior plan (provenance-laundering defect class).
- **Free-entry duration** — presets only; the cost math and the assembler's grid reason about
  15/30/60 exactly.
- **`git add -A` / casual commits** — lanes share one working tree; this branch
  (`feature/cash-business-finance`) carries foreign modified files right now, including media files.
- **Hand-editing `assembleScript.ts`/`burnCapsScript.ts`** — regenerate mirrors; byte-identity
  drift tests exist.
- **`grep -q` on the left of a pipeline under pipefail** in any sandbox script (the 2026-08-15
  SIGPIPE postmortem rule).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Estimate math / per-kind prices | UI-side price arithmetic | `jobEstimate.lines` + `sceneVisualSpec` | Two numbers that can drift = the money bug in a new costume |
| Staleness detection | A diff engine | `shotsChangedAt` stamp idiom (+ new `briefChangedAt`) | Structural-writes-only stamping already balances regenerate economics |
| Vault save of the reel | An ingest pipeline call (paid re-transcription) | `research.persistFindings`-style direct insert; text = narration/transcript already in hand | The transcript exists (STT words landed inline); embedding text is the only work needed |
| Video playback | A player component/lib | `<video autoPlay muted loop playsInline controls>` | Native covers muted-autoplay-tap-for-sound exactly; no component library by decision |
| Failure copy mapping | Per-card ad-hoc strings | `failureText()`/`refusalText()` extension in `mediaCanvasView.ts` | Closed unions exist; tested by calling |
| Retry idempotence | A retry queue | Status-CAS guards (the `pending → rendering` / `claimLine` idiom) + a stored retry count | Every once-only guard in this subsystem is a status transition |
| Doc preview | A viewer | `PreviewModal` | Exists |
| Sunk-cost accounting | A new cost log | `mediaJobs` per-line rows + `spendEvents` correlations | Append-only ledger shipped in 26-08; media rows already written in-transaction |

**Key insight:** this subsystem's hard problems (money atomicity, once-only triggers, no-refunds
honesty, provenance) are all already solved with tested idioms; phase 33's job is to compose them
into a better experience, and every hand-rolled variant re-opens a closed defect class.

## Common Pitfalls

### Pitfall 1: Planning on an unseeded skill body
**What goes wrong:** `media-director` v2 (scene author) is on disk, but if never seeded, the LIVE
specialist still proposes BLOCK decks; every intake/variation/citation behavior planned against v2
silently doesn't manifest.
**Why:** `seedSkills` runs on `pnpm dev`, not `npx convex dev`; the row is DELIBERATELY UNGATED and
publishes straight to `active` at `maxVersion + 1`.
**How to avoid:** Wave 0 pre-flight: seed, then READ BACK the live version (optimizer dry-run
candidates occupy version numbers — the skill-version-collision gotcha). Phase 33's body edit (v3)
repeats this.
**Warning signs:** specialist proposals with no `Target duration:` line; `parseSceneDeck` returning
`no_deck` and falling through to `parseBlockDeck` in `persistStoryboard`.

### Pitfall 2: The body edit shifting model behavior elsewhere
**What goes wrong:** a skill-body edit changed which optional tool args the model passes, breaking
an unrelated fixture (recorded memory).
**How to avoid:** update the round-trip test (storyboard.test.ts reads the body's own worked
example) in the SAME wave as the body; the v3 example must demonstrate: brief echo, TWO decks that
are distinct concepts, mixed kinds (an all-generated deck can't hit any target — ADR-019), a silent
scene, and at least one cited + one uncited-creative line. A/B the prior body on one fixture
(~$0.01) before theorizing about regressions.
**Warning signs:** the parser round trip passing while the model emits both decks under one
heading; prompts falling back to descriptions (the `Scene N` vs `Block N` class of bug — grep
`parsePrompts`).

### Pitfall 3: Vacuous tests on the new gates
**What goes wrong:** phase 19 hit 22/22 green with the feature broken; five vacuous-test findings
in one phase (`green-tests-over-broken-capability`).
**How to avoid:** every new refusal/gate must be OBSERVED RED under mutation: the
unconfirmed-claims Generate block (delete the check → a reservation succeeds = money moved),
the one-auto-retry cap (retry twice → test red), the picked-deck-only rule (reserve while
`altDeck` present → only picked deck priced), the stale-badge derivation.
**Warning signs:** tests that pin a mutation's arguments rather than the observable outcome
(the `regenerateBlock` lesson: the test pinned the batch's contents, never that it could render).

### Pitfall 4: Breaking the reservation contract with variation state
**What goes wrong:** two decks against one plan is NEW state; if the money path can ever read the
unpicked deck (or a mixed one), the estimate and the reservation diverge, or paid assets get
attributed across decks.
**How to avoid:** `plans.shots` stays "the picked deck"; the alternate lives in a field no money
code reads; switching decks is a structural edit (stamps `shotsChangedAt`, invalidating stale
assets — which is CORRECT, per-scene assets belong to the deck that bought them); Generate deletes
the alternate.
**Warning signs:** any `sceneDeckOf`/`deckOfScenes` caller gaining a deck-index parameter.

### Pitfall 5: The Sora clock
**What goes wrong:** Sora 2 Videos API shuts down **2026-09-24** (verified externally; OpenAI's
deprecation table lists NO replacement). Phase 33 likely lands before that, but any slip past
~6 weeks means `generated_video` dies mid-phase; and everything shipped deepens UX around a
provider with 6 weeks to live.
**How to avoid:** phase 33 must not couple UI to Sora specifics beyond what exists (the provider
grid is already asked of the pinned model's row, never hardcoded — keep it that way). Flag to the
owner that a provider-migration phase is REQUIRED before 2026-09-24 regardless of phase 33; that
migration is out of this phase's locked scope ("no new provider").
**Warning signs:** new code naming `sora`/4-8-12 literals instead of reading the provider table.

### Pitfall 6: Re-arming the render after a per-scene fix
**What goes wrong:** `maybeStartRender` fires on LANDINGS. A held reel (failed sibling →
`incomplete_batch`) whose failed scene is fixed by a FREE action (kind switch to card, vault asset
pick) has no new landing — nothing re-fires the trigger, and the reel stays held forever.
**How to avoid:** the fix-menu mutations must themselves re-evaluate the render trigger (or reset
`renderStatus` so the next check re-arms). Paid fixes (regenerate) produce landings and re-fire
naturally; free fixes don't. Map each fix-menu arm to its re-arm path explicitly in the plan.
**Warning signs:** an e2e where switch-to-card after a failed clip leaves "Not assembled yet"
standing forever.

### Pitfall 7: CRLF + docs edit mechanics
**What goes wrong:** `.planning/*.md` and `docs/playbooks/*.md` are CRLF; multi-line `\n`-anchored
edits silently no-op. `gsd-tools commit` breaks on Windows quoting.
**How to avoid:** normalize/assert-unique before playbook edits; use plain `git commit` with
specific file paths (never `-A`; check `.git/MERGE_HEAD` first — lanes share one working tree).

### Pitfall 8: Presenting media `unlanded` as pending
**What goes wrong:** retry cards showing "what the failed attempt consumed" must read the ledger
honestly — on the media rail `unlanded` is PERMANENT over-reservation, never in-flight money.
**How to avoid:** copy derives from `UNLANDED_RESOLVES.media === false`; a failed line writes NO
movement (its share stays unlanded), so "this scene cost $0.40" comes from the `mediaJobs` row's
`estUsd`/line estimate, not from a ledger movement that doesn't exist.

## Code Examples

Verified in-repo patterns (all HIGH confidence — read from source):

### The estimate the UI reformats (do not recompute)
```ts
// packages/backend/convex/media.ts:2043 — jobEstimate returns:
// { lines: EstimateLine[]; totalCents; capCents; remainingCents; refusal: {reason, blockIndex?, chars?} | null }
// One line per PAID kind (clips / stills / voice / captions / render); free kinds get no line.
// The headline is totalCents; the breakdown is lines; remaining budget is remainingCents.
```

### The provenance-safe confirmation write
```ts
// schema.ts:120 idiom — "Required when author === 'user'; derived from authenticated identity,
// never from args." The confirm mutation takes (planId, sceneIndex) ONLY; the actor and timestamp
// come from ctx. The model has no mutation that can set confirmedAt.
```

### The system-authored vault doc (auto-save precedent)
```ts
// packages/backend/convex/research.ts:134 persistFindings —
await ctx.db.insert("vaultDocuments", {
  tenantId, title, kind: "web_research", category: categoryFor({ source: "agent" }),
  mimeType: "text/markdown", // SEARCHABLE_MIME ⇒ chunked + embedded + graph-extracted
  size, contentHash: await contentHash(markdown), text: markdown, status: "processing", ...
});
// For the reel: text = the narration transcript (already in hand), plus the final.mp4 storageId
// and refs-only citation metadata. No paid ingest stages needed.
```

### The once-only guard idiom (for the auto-retry)
```ts
// mediaComplete.maybeStartRender — the pending → rendering CAS is the once-only guard;
// two concurrent last-landings cannot both observe `pending`. The auto-retry needs the same
// shape: a stored retry marker checked-and-set in the same mutation that schedules the retry.
```

### The stderr → code mapping the failure cards translate
```ts
// packages/core/src/render.ts:300 STDERR_CODES — a CLOSED union, code only (stderr can carry
// URLs/secrets). New card copy maps these codes; it never prints stderr.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Uniform block deck (D8) | Scene timeline, 4 kinds, exact 15/30/60 targets (ADR-019) | 20.2, landed 2026-08-14 | Phase 33 builds ONLY on scenes; block path is legacy-read compatibility |
| fal.ai Wan 2.5 provider | OpenAI GPT Image 2 / Sora 2 direct (ADR-017) | 2026-08-14 cutover | Wan/fal sections of the playbook are superseded history; fal callback route legacy-only |
| "Failed render does not retry" (20-16) | Phase 33 adds ONE auto-retry for transient codes | this phase | Narrow supersession; playbook rewrite in-commit |
| `media-director` v1 (block author) | v2 scene author on disk; **seeding status unknown** | 2026-08-14 | Wave-0 seed + read-back required; phase 33 ships v3 |
| Sora 2 Videos API | **Shuts down 2026-09-24; no announced replacement** (deprecation notice 2026-03-24; covers sora-2, sora-2-pro and snapshots) | external | Provider migration needed within ~6 weeks, OUT of this phase's scope — flag to owner |

**Deprecated/outdated:** the §4.1 block-era economics table, the narration BAND (replaced by the
per-window ceiling + master timeline), `CLIP_SECONDS` on the cost surface, `scene_render_not_ready`
/ `scene_regenerate_not_ready` (deleted).

## Open Questions

1. **Is `media-director` v2 seeded in the live deployment?**
   - What we know: code + body v2 on disk; seeding requires `pnpm dev`; the plan doc's last note
     (2026-08-14) says seeding was still owed.
   - What's unclear: whether the owner ran it since.
   - Recommendation: Wave-0 pre-flight — seed and read back the live version before any body-v3 work.
2. **20-11's live gate / 20-12's cockpit-agent certification remain open** (Phase 20 traceability
   row still Pending; `20-VALIDATION.md` in_progress).
   - What we know: a real prod-sandbox render DID succeed 2026-08-15 (the SIGPIPE postmortem
     re-render, EXIT 0, decode-validated), so the render chain is live-proven; 20-12 (cockpit-agent
     media-route certification, the real ~$0.35 gate) is deliberately a separate owner decision.
   - Recommendation: phase 33 does not block on 20-12, but the planner should surface it as an
     adjacent owner decision; a full paid end-to-end (clips bought → captioned final) has still
     never run as one job.
3. **Where does the free re-propose turn run from?** Chat-revision proposals exist pre-Generate,
   but a canvas "re-propose" button firing a specialist turn is a new UI→dispatch entry.
   - Recommendation: reuse the cockpit turn path (the button seeds a canned user message) rather
     than a second dispatch entry point; keeps "token spend stays user-initiated" literally true.
4. **Does the vault auto-save need a browse/category decision?** `categoryFor` routes agent docs to
   workspace-docs and mimeType video/* wins into videos.
   - Recommendation: Claude's discretion; land it as a video-category doc so the vault picker
     (`isPickableVideo`) can immediately reuse a finished reel as `uploaded_video` footage — a free
     compounding win.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (per-package: `packages/core` 936+, `packages/cost` 61+, `packages/backend` 1714+ via convex-test, `apps/web` .ts-only/DOM-less) + Playwright e2e |
| Config files | `packages/core/vitest.config.ts`, `packages/backend/vitest.config.mts`, `apps/web/vitest.config.mts`, `apps/web/playwright.config.ts` |
| Quick run command | `pnpm --filter @pikar/backend test -- media` (or `-- mediaCanvasView` in apps/web) |
| Full suite command | `turbo run test --concurrency=1` (concurrency 1 per the vitest spawn-fail gotcha) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| 33-INTAKE | BRIEF §-parse + refusals; chip-edit stamps staleness; badge derivation | unit | `pnpm --filter @pikar/core test -- storyboard` + backend `-- media` + web `-- mediaCanvasView` | ✅ extend existing files |
| 33-VARIA | Two-deck parse; picked-deck-only reservation; switch stamps; Generate discards | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend `media.test.ts` |
| 33-REEL | Vault auto-save row shape (refs-only); old-final-held-until-new ordering | unit | `pnpm --filter @pikar/backend test -- media` | ✅ extend |
| 33-CANVAS | Tracker fold, estimate headline/breakdown, hero states | unit | `pnpm --filter web test -- mediaCanvasView` | ✅ extend `mediaCanvasView.test.ts` |
| 33-FAIL | Transient-code classification; ONE retry cap (mutation-checked); sunk-cost lines | unit | core `-- render` + backend `-- media` | ✅ extend |
| 33-CITE | Citation parse; tenant check on model-authored docId; confirm gate blocks Generate (observed RED); ctx-derived confirm actor | unit | backend `-- media` | ✅ extend |
| Canvas end-to-end (chips → variations → tracker → failure card) | live browser | e2e | `npx playwright test media-canvas` (prod build; harness traps in `e2e/README.md`) | ✅ `apps/web/e2e/media-canvas.spec.ts` — extend |

### Sampling Rate
- **Per task commit:** the touched package's filtered suite (e.g. `pnpm --filter @pikar/backend test -- media`)
- **Per wave merge:** `turbo run test --concurrency=1` (all packages) + `tsc` in BOTH `packages/backend` and `apps/web` (the wave-2 lesson: backend tsc green missed a web break)
- **Phase gate:** full suite green + one Playwright media-canvas pass against a prod build before `/gsd:verify-work`; skill-body wave additionally needs seed + live read-back

### Wave 0 Gaps
- [ ] Seed check: read back live `media-director` version (not a test file — a pre-flight; `pnpm dev` seeds)
- [ ] `apps/web/e2e/media-canvas.spec.ts` — extend for the new layout (spec exists; new assertions are per-wave work, not missing infrastructure)
- No missing frameworks or configs — existing test infrastructure covers all phase requirements.

## Sources

### Primary (HIGH confidence — read from repo)
- `.planning/phases/20.2-scene-timeline-reels/20.2-PLAN.md` — full wave 1–8 landing log (all COMPLETE 2026-08-14; 2 owner steps open)
- `docs/playbooks/media.md` — pipeline, money rail, render/caption triggers, refusal codes, retention, spend ledger, seeding rule (last verified 2026-08-15)
- `packages/backend/convex/media.ts` (2688 ln) — `jobEstimate` shape verified at :2043; `reserveSceneJobInner` :414; `generateReel` :2367; `regenerateBlock` :2436
- `packages/backend/convex/mediaComplete.ts` — `maybeStartRender` :183, `maybeStartCaptions` :232
- `packages/core/src/render.ts:300` — `STDERR_CODES`
- `packages/core/src/storyboard.ts` — `TARGET_DURATIONS` :406, `Scene` :439, `parseSceneDeck` :583
- `packages/backend/convex/dispatch.ts:770` — `persistStoryboard` two-contract terminal
- `packages/backend/convex/schema.ts` — plans media/render/caption planes, provenance idioms (:120, :802–818), citation shape (:766–789)
- `packages/backend/convex/research.ts:134` — `persistFindings` vault-write precedent
- `packages/backend/convex/vaultGround.ts` — `searchVault` docIds/titles/chunks contract
- `packages/backend/convex/spendLedger.ts` — movement/coverage/listEvents exports
- `apps/web/app/(app)/dashboard/workspace/mediaCanvasView.ts` — full export surface
- `.planning/phases/33-.../33-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/config.json`

### Secondary (MEDIUM-HIGH confidence)
- Sora 2 Videos API shutdown 2026-09-24, deprecation notice 2026-03-24, **no replacement listed**:
  [OpenAI API deprecations](https://developers.openai.com/api/docs/deprecations) (as surfaced via
  search), corroborated by [community thread](https://community.openai.com/t/is-the-sora2-api-still-working/1379946)
  and secondary coverage — consistent with the in-repo ADR-017 note.

### Tertiary (LOW confidence)
- "Spud" successor-model rumor (Altman remark; no product/timeline/pricing) — do not plan on it.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — everything named exists on disk and was verified by symbol
- Architecture: HIGH — patterns lifted from the shipped subsystem's own recorded decisions
- Pitfalls: HIGH — mostly this repo's own named defect classes and dated postmortems
- Sora shutdown: HIGH on the date (repo + external agree), LOW on any successor

**Research date:** 2026-08-15
**Valid until:** ~2026-09-05 (stable internally; the Sora clock makes anything provider-adjacent expire on 2026-09-24 regardless)
