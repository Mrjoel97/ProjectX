# Phase 33: Media Creation UX Overhaul - Context

**Gathered:** 2026-08-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Reshape the EXPERIENCE of creating a reel — from first ask to finished video — on top of the
already-shipped scene-deck pipeline (Phase 20 + 20.2). Six named deliverables from the roadmap
title: guided intake, storyboard variations, auto-assembled reel, reel-first canvas, clear failure
retry, grounded citations. No new generation capability, no new provider, no publishing — this is
a UX overhaul of what exists.

**Locked prior decisions this phase builds on (not revisitable here):**
- The media specialist proposes and opens the canvas; only a human click/Approve spends money
  (Phase 20 D2 — structurally enforced, `searchVault` is the only grant).
- The whole job is reserved in ONE serializable transaction; **no refunds** (20-04).
- Scene decks with four visual kinds priced per kind; cheap kinds are a feasibility requirement
  (ADR-019). Target durations 15/30/60s are what the cost math already reasons about.
- Provider is OpenAI (GPT Image 2 / Sora 2) via ADR-017. **Sora 2 Videos API shuts down
  2026-09-24** — the researcher should check whether that lands inside this phase's window.
- The canvas lives in the workspace right pane (D7); "a canvas, not a video editor" ceiling holds.
- Agent-authored figures must never be stored/rendered as the owner's own word (the
  provenance-laundering rule).

</domain>

<decisions>
## Implementation Decisions

### Guided intake
- **Hybrid shape: chat + brief chips.** The user types freeform in cockpit chat; the canvas shows
  the parsed brief as editable fields (chips) BEFORE any storyboard is proposed. Two surfaces, one
  brief — the canvas is the source of truth for what was captured.
- **Required fields: topic + target duration ONLY.** Audience, tone, brand voice default from the
  business profile / BRAND.md. Phase 11 rule applies: idea-stage tenants are thin by design; never
  block on fields they can't fill.
- **Duration is a preset: 15 / 30 / 60 seconds.** No free entry. These are the durations ADR-019's
  feasibility/cost tables already compute; 60s shows its higher cost up front.
- **Editing a brief chip after storyboards exist marks them stale** ("brief changed" badge) and
  offers a free re-propose button. Nothing auto-fires; token spend stays user-initiated.

### Storyboard variations
- **Two variations, side by side, token-only** (no media dollars until Generate).
- **Variations are distinct concepts** — different angle AND visual treatment (e.g.
  testimonial-style vs data-driven hook, different kind mixes). Not same-script-different-visuals.
- **The unpicked deck stays switchable until Generate.** Generate locks the choice and discards
  the other deck — mixing paid assets across decks would confuse the reservation contract.
- **No cross-deck scene mixing.** Pick one deck, then use the existing per-scene editor (edit
  prompt, reorder, delete, regenerate) to pull in anything liked from the other.

### Reel-first canvas
- **Layout: player hero at top + scene strip below.** One layout for the whole lifecycle; the
  hero slot exists from the moment the deck is picked.
- **Pre-reel hero = live pipeline tracker**: the stage spine (generate → voice → assemble →
  captions) with per-scene landing status. Reactive queries, NO polling, no fake preview.
- **Estimate UI: total headline + expandable breakdown.** One prominent dollar total at the
  Generate control, expandable to per-kind lines (clips / stills / voice / captions / render) and
  remaining daily budget. The 40× clip-vs-still difference stays discoverable.
- **Playback: muted autoplay loop** when the final lands, tap for sound — matching the feeds the
  reel is destined for (the same rationale as burned captions).

### Auto-assembled reel
- **One approval carries the pipeline to the CAPTIONED final mp4.** Generate reserves the whole
  job and the pipeline runs unattended — generate, voice, assemble, captions, zero intermediate
  clicks. Captions cost is already in the reservation.
- **Destination: canvas + auto-save to vault.** The finished mp4 plays in the canvas AND is saved
  as a vault asset automatically (reusable, groundable, survives the plan).
- **Regenerate-after-done keeps the one-click contract**: pay for the scene, pipeline re-assembles
  and re-captions unattended; the old final stays available until the new one lands.
- **Chat revisions until Generate.** Pre-Generate, asking the specialist ("make scene 2 punchier")
  produces a revised deck proposal (free, token-only) that updates the canvas. Post-Generate,
  edits are canvas-only through the paid rail — the money gate stays where the estimate is.

### Failure & retry
- **Plain-language failure cards**: what happened, which scene/stage, and what fixing it costs
  (free vs $). Refusal/STDERR codes stay underneath as a detail line for support.
- **Render-stage failures get ONE automatic retry** (compute is already a reserved line), then
  surface a failure card with a manual "Retry render" button.
- **A failed paid scene HOLDS the reel before assembly** and offers a per-scene fix menu: edit
  prompt & regenerate (paid, price shown), switch to a cheaper kind (still/card), or pick a vault
  asset. Landed sibling work waits — nothing is wasted on the no-refunds rail.
- **Full economic honesty per retry**: a paid retry shows what the failed attempt already consumed
  and what the retry adds ("this scene cost $0.40; regenerating adds $0.40"). Free retries say
  "free". No surprises in the spend ledger.

### Grounded citations
*(These four were Claude's recommended options, accepted by the owner with "proceed" rather than
individually selected — flag at plan review if any looks wrong.)*
- **Every factual claim in narration/text cards must cite the vault doc it came from.** Stats,
  figures, business-specific claims. Creative copy (hooks, CTAs) needs no citation.
- **Citations render per scene in the canvas** (vault doc title, clickable → PreviewModal). The
  reel itself stays clean; the canvas is where the owner verifies before paying.
- **Ungrounded claims block Generate until confirmed.** They render with a "needs your
  confirmation" badge; the owner confirms each (making it genuinely their word — the legitimate
  door through the provenance rule) or the line is rewritten. The model proposes; only the owner
  vouches.
- **Citations persist with the vault-saved reel** as metadata — doc refs + which claims, refs and
  ids ONLY (CLAUDE.md §4). Months later "where did that number come from?" has an answer.

### Claude's Discretion
- Chip/badge/tracker visual design, spacing, typography — per BRAND.md and globals.css tokens.
- Exact shape of the citation metadata on the vault asset (refs-only contract binds it).
- How the stale-storyboard badge and switchable-deck UI look.
- How the brief parse (chat → chips) is implemented (specialist tool vs parser).
- Which render failure codes count as "transient" for the one auto-retry.
- Plan/wave decomposition.

</decisions>

<specifics>
## Specific Ideas

- "Reel-first" means the player hero exists BEFORE the reel does — the pipeline tracker lives in
  the same slot the video will fill, so the layout never jumps.
- The confirmation flow for ungrounded claims is the provenance rule's front door: owner
  confirmation is what legitimately converts an agent-proposed figure into the owner's word. The
  stored row must record WHO confirmed (the confirming click), never let the model write it.
- Two decks against one plan pre-Generate is new state; the reservation/regenerate machinery must
  only ever see the PICKED deck.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MediaCanvas.tsx` (workspace right pane) + `mediaCanvasView.ts` — all canvas derivations/copy
  are already extracted and unit-tested; extend there, not in the .tsx.
- `packages/core/src/storyboard.ts` `parseSceneDeck` + `media-director.md` v2 skill body (scene
  author). Variations = two proposals through the same contract.
- `reserveSceneJobInner` / `jobEstimate` — one money gate, one number (pinned equal); the
  estimate-UI decision is a presentation change over `jobEstimate`'s existing per-kind output.
- `spendLedger` (26-08) — sunk-cost honesty for retry cards reads from here; media's `unlanded`
  is PERMANENT, never "pending".
- `PreviewModal` — vault doc preview for citation click-through.
- `plans.ts` proposed → approved lifecycle; `plans.shotsChangedAt` staleness stamp (structural
  writes only) — the stale-badge machinery for decks partially exists.
- `e2e/media-canvas.spec.ts` — live-browser harness for canvas assertions, with the two harness
  traps documented in `e2e/README.md`.

### Established Patterns
- Refusal codes → distinct user levers (`docs/playbooks/media.md` refusal-code section) — the
  failure-card copy maps 1:1 onto these.
- `STDERR_CODES` mapping (this week's SIGPIPE postmortem added `missing_binary`) — the render
  failure vocabulary the cards translate.
- Delete-on-success / KEEP-on-failure retention — failure cards can rely on intermediates
  existing for failed jobs.
- `media-director` is DELIBERATELY UNGATED; body edits activate on seed with no eval. Skill-body
  edits can shift model tool args (see memory: A/B the prior version on one fixture before
  theorising about regressions).

### Integration Points
- The intake chips + variations land in the specialist proposal flow (`persistStoryboard`, the
  deck contract) and the canvas plan.kind switch.
- Auto-run-to-captioned-final extends the existing "last landing starts the render" trigger and
  the captions stage — the researcher must map exactly which manual steps remain today.
- Vault auto-save of the final reel goes through the existing vault ingest path (tenant-scoped,
  budget-aware — check whether a self-produced mp4 should bypass the ingest LLM stages).
- **Phase 20.2 is `status: proposed` with one monolithic plan doc and no per-plan SUMMARYs** (per
  the 2026-08-14 gap audit). The researcher MUST establish what of 20.2 waves 1-8 is actually on
  disk and seeded before planning on top of it. Seeding note: `pnpm dev` seeds, `npx convex dev`
  alone does not.

</code_context>

<deferred>
## Deferred Ideas

- End-of-reel sources/credits card (public-facing citations) — declined for now; canvas-only
  verification plus vault metadata covers provenance. Revisit if reels get published (Phase 32).
- Cross-deck scene mixing UI — declined; the per-scene editor covers it by hand.

</deferred>

---

*Phase: 33-media-creation-ux-overhaul-guided-intake-storyboard-variations-auto-assembled-reel-reel-first-canvas-clear-failure-retry-grounded-citations*
*Context gathered: 2026-08-15*
