# ADR-027: Grok Imagine Video succeeds Sora 2, both media planes move to OpenRouter, and the duration grid is bought with a new counterparty and a structural guarantee

- **Status**: **Accepted** — 2026-08-30. See *Provenance of this decision* for who made it and how
  to reverse it.
- **Supersedes**: [ADR-026](026-veo-31-lite-succeeds-sora-2.md) **in its VIDEO half only** — the
  `veo-3.1-lite` pin and the Google endpoint it specified, which was never built. ADR-026's
  *analysis* of the withdrawal, and its rule-3 rejection of Seedance, both stand and are reused here.
- **Does NOT supersede**: **ADR-024's IMAGE half.** `gpt-image-2` remains the stills model; only its
  TRANSPORT moves. ADR-026 warned that a careless read retiring all of ADR-024 would needlessly
  reopen a settled stills decision — that warning is still live and applies to this ADR too. Also
  untouched: [ADR-011](011-media-provider-fal-wan25.md)'s price-table-in-code consequence,
  [ADR-012](012-media-route-and-the-reel.md)'s media-authority boundary (a provider swap does not
  move an authority boundary), [ADR-013](013-the-render-worker.md),
  [ADR-019](019-the-scene-timeline.md), and the whole-job reservation model.

## Context

**Two independent drivers, and only one of them was known when ADR-026 was written.**

**1. The endpoint dies.** OpenAI is retiring `https://api.openai.com/v1/videos` on **2026-09-24**,
announced 2026-03-24. `sora-2` and `sora-2-pro` share the date. This is an ENDPOINT withdrawal, not
a model deprecation, so there is no same-vendor row to move to — the surface those rows lived on is
going away. ADR-026 recorded the succession decision and **none of the wiring**;
`succession.replacementWiredUp` is still `false`, which is why the runway tripwire in
`packages/cost/src/media.test.ts` is still armed and turns the cost suite red on **2026-09-10**.

**2. The account is empty, and this one ADR-026 could not have known.** The two most recent
`mediaJobs` rows read `failureReason: "credit_balance_exhausted"` — OpenAI's own error code, a
string that appears nowhere in this repository, surfaced through `providerReasonCode`. **No media
has generated since ~2026-08-17.** The text plane moved to OpenRouter at `845f4b1` when the same
account ran dry; the media plane never did and still posts to `api.openai.com`.

So the migration is not only a deadline. The product is already down.

## Decision

**`x-ai/grok-imagine-video` becomes the pinned video model, and both media planes go through
OpenRouter.** `openai/gpt-image-2` stays the stills model and moves onto the same transport. One
door, one funded key.

### Why the grid is the reason, and the only reason

| | `grok-imagine-video` | `veo-3.1-lite` (ADR-026) | `sora-2` (dying) |
|---|---|---|---|
| Durations | **1–15, any integer** | 4, 6, 8 | 4, 8, 12 |
| 720p | $0.07/s | $0.05/s w/audio · $0.03 w/o | $0.10/s |
| 480p | $0.05/s | not offered | not offered |
| 9:16 | yes | yes | yes |
| Native audio | none | yes | — |

On 2026-08-30 the owner hit **two** live defects. One was a closed arg validator (fixed in 33.1-01).
The other was `illegal_generated_duration`: the media director wrote 5 s and 6 s generated scenes
against a `4/8/12` grid. `1–15 any integer` **retires that failure class outright**. Veo's `4/6/8`
merely narrows it — 5 s and 7 s scenes would still refuse.

Grok has **no native audio**, and that suits this pipeline rather than costing it: narration is
generated separately as TTS and muxed in `assemble_final.sh`. Veo's synchronised audio is a feature
we would have paid for and then discarded.

Cost moves **down** from the model it replaces ($0.07/s against $0.10/s at 720p), so
**`MEDIA_JOB_CAP_USD` stays `3.50`** and ADR-016's never-landed raise to `7.50` stays unlanded.

## The counterparty cost

**ADR-026's decisive argument was that Veo introduced no new data-transfer counterparty.** The owner
already held a GCP credential and ADR-016 had admitted Google in principle, so the question *may
customer prompts go to this company?* had already been answered.

**This ADR reverses that argument, not merely its conclusion.** xAI becomes a new recipient of
customer scene prompts — text derived from the tenant's own business material. Routing through
OpenRouter does not soften it: OpenRouter is a transport already approved for all text traffic since
`845f4b1`, but **xAI is a company this product has never sent anything to.**

**The owner was shown this argument explicitly, in these terms, and chose Grok anyway** — in
exchange for the duration grid above. That sentence is the point of recording it: a later reader can
tell an accepted cost from an overlooked one, and this one was accepted.

## The structural guarantee this ADR spends

`packages/cost/src/media.test.ts` asserts *"NOT ONE target duration is reachable with generated video
alone"*, and `media.fixtures.json` records `targetsUnreachableByGeneratedVideoAlone: [15, 30, 60]`.
That guarantee rests **entirely** on every Sora clip length being a multiple of four.

At `1–15` and `$0.07/s` it evaporates:

- **15 s all-generated = $1.05** — under the `$3.50` cap
- **30 s all-generated = $2.10** — under the cap
- 60 s = $4.20 — still over

A mixed 30-second deck costs about a **third** of an all-generated one, because four of its five
scenes come from a free library. Three places encode the claim that is now false, and 33.1-04 and
33.1-06 update them:

1. `GENERATED_CLIP_SECONDS`'s doc comment — *"this is the real reason the other three kinds exist"*
2. `media.test.ts`'s *"NOT ONE target duration is reachable"* test
3. `media-director.md`'s *"Every legal reel therefore mixes kinds"*

Kind-mixing drops from **structural** to **advisory** — and the only thing left enforcing prose is
prose that `dispatch.ts` already records as *violated twice in six attempts*.

### The mitigation: `MEDIA_GENERATED_SECONDS_CAP`

A code-owned ceiling on **total generated seconds per reservation**, enforced inside
`chooseMediaBatch` — the choke point every reel reservation and every on-screen estimate already
passes through, so the number the user sees and the number that spends agree by construction.
Surfaced as a governed refusal code, `over_generated_seconds`, with its own sentence on the canvas.
Never a silent trim of the deck, and never a fall-through that buys the clips anyway.

**The ceiling is 12 seconds, and it is derived rather than chosen.** It is the longest single clip
the old Sora grid allowed, and it is exactly what `media-director.md`'s shipped VARIATION A
(`4 + 8`) and `media.fixtures.json`'s `reel30s.mixed` (`3 × 4`) already spend — so the body's own
worked example and this ADR's own economics both stay legal without either being edited. `12` is
below the smallest `TARGET_DURATIONS` member (`15`), so an all-generated reel is refused at **every**
target rather than only at 60, and generated spend is bounded at **$0.84** per reel whatever the
target duration.

Both of those artifacts sit **exactly on the boundary with zero slack**. A one-second nudge to
either would make the shipped example illegal, and nothing checks that today — 33.1-04 adds a test
that parses the shipped worked answer and prices it under the cap.

**Three alternatives were rejected, so a reversal starts from a comparison and not from scratch:**

- **Narrowing the grid below what Grok supports** — throws away exactly what the new counterparty
  was accepted for, and re-introduces `illegal_generated_duration`, one of the two defects this
  migration exists to kill.
- **Lowering `MEDIA_JOB_CAP_USD` below $2.10** — shrinks every legitimate mixed reel's headroom, and
  contradicts ADR-026's own rule that a successor needing a cap change is a worse outcome wearing a
  migration's clothes.
- **Relying on the skill body** — prose, of the kind already recorded as violated twice in six
  attempts. Which is why this is code and not another sentence in the body.

### What the mitigation is not

**A ceiling in code is not the same thing as an impossibility in arithmetic.**

The old guarantee could not be switched off. No sum of 4, 8 and 12 is 15 or 30 — no configuration,
no constant, no future edit could make one. The new guarantee is a number somebody can raise, in a
check somebody can move or route around. **Plan 33.1-04 already found one such route**: a legacy
BLOCK deck reaches the same reservation through a different parser, and would have evaded a
non-uniform cap entirely. It is resolved deliberately (the cap is uniform) rather than by silence,
but the fact that the route existed at all is the point.

**That difference — between "impossible" and "refused" — is the residual cost of this decision, and
it does not disappear because it was mitigated.** An ADR that let the mitigation stand in for the
loss would be repeating, one level up, the exact mistake the runway tripwire was re-keyed to stop:
treating a decision as though it were a migration.

## Rejections on the rule, not on taste

- **`bytedance/seedance-*`** — the cheapest published rate on OpenRouter ($0.01345/s) and
  structurally unusable. Its live SKU is `{"video_tokens": "0.0000035"}`: billed per video token,
  configuration-dependent, not pre-computable before a request exists. `packages/cost/src/media.ts`
  rule 1 refuses any such unit by construction, because the whole-job reservation must be priced
  *before* any provider request. **ADR-026 and the 2026-08-30 review reached this conclusion
  independently**, which is the strongest evidence the rule is doing real work.
- **`x-ai/grok-imagine-image-2.0`** — rejected for stills despite the single-vendor tidiness.
  `n: {min: 1, max: 1}` (no batch) against `gpt-image-2`'s `n: 1–10`, and $0.04/image against
  ~$0.01. Batch is an explicit product requirement; a single-vendor story does not outrank it.
- **`openai/sora-2-pro`** — shares the 2026-09-24 shutdown. A fallback that dies with the primary is
  not a fallback. (ADR-026's phrasing, kept.)

## Consequences

**This ADR does not perform the migration.** What remains, and what 33.1-03 through 33.1-06 own:

- submit / poll / download against `https://openrouter.ai/api/v1/videos` (async: `202` →
  `polling_url` → `unsigned_urls[0]`), replacing the three `/v1/videos` call sites
- the image submit moved to `https://openrouter.ai/api/v1/images` (synchronous; the response is
  `data[0].b64_json`, which `submitLine` already parses byte-identically)
- `MEDIA_VIDEO_PRICING` / `MEDIA_VIDEO_SECONDS` rows, the `MEDIA_DEFAULT_VIDEO` repin, and
  `GENERATED_CLIP_SECONDS` widened to `1..15`
- `MEDIA_GENERATED_SECONDS_CAP` and its refusal sentence
- `OPENROUTER_API_KEY` reaching the media path in **Convex env vars**, never Vercel

**`succession.replacementWiredUp` may only be set `true` in the same commit as a landed submit path
AND a landed price row.** A decision is not a migration — that is the whole reason `7012608` re-keyed
the tripwire off `status !== "decision_pending"`, and this ADR is exactly the kind of document that
would otherwise flip it green while production still posts to a dying endpoint.

**Repinning `MEDIA_DEFAULT_VIDEO` silently disarms the tripwire, and this is not obvious.**
`PINNED_MODELS` is derived from `MEDIA_DEFAULT_VIDEO.model`, so the moment the pin moves to Grok,
`sora-2` falls out of the set and all three shutdown tripwires `continue` past it — green, with
nothing wired. 33.1-04 re-keys them onto *"carries an unretired succession"*. Anyone repinning a
media model in future should check this first.

**`wan2.5-*` and `sora-2` rows stay in the price table.** Historical-only, so old rows remain
priceable. They are not fallbacks and must not be read as one. The Sora **poller** is likewise
retained so in-flight jobs can land; only the Sora **submit** path is removed.

## Provenance of this decision

The owner was shown, explicitly and before deciding: that ADR-026 existed and had already chosen
`veo-3.1-lite`; that the counterparty argument was ADR-026's decisive one and that Grok reverses it;
that Grok's images cannot batch and cost 4x, which is why the stills stayed on `gpt-image-2`; and,
after planning surfaced it, that the wider grid destroys the reachability guarantee and what that
costs in dollars. The owner chose Grok for video, `gpt-image-2` for stills, OpenRouter for both, and
a code-owned generated-seconds cap over the three alternatives above.

**To reverse:** the model pin, the price row, the duration grid and the base URL are four constants;
`veo-3.1-lite` remains available on the same OpenRouter transport at `$0.03–0.05/s`, so a reversal
is a re-pin and not a re-integration. What a reversal would NOT undo is the counterparty disclosure
— prompts already sent are already sent.
