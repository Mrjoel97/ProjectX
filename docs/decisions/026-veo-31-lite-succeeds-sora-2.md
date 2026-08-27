# ADR-026: Veo 3.1 Lite succeeds Sora 2 — the Videos API itself is being withdrawn, and the cheapest rule-3-compliant successor is the one vendor we already send data to

- **Status**: **Accepted** — 2026-08-27. Recorded to close the succession decision the sunset
  tripwire demands; see *Provenance of this decision* below for who made it and how to reverse it.
- **Supersedes**: [ADR-024](024-openai-sora-is-the-media-provider.md) **in its VIDEO half only** —
  the `sora-2` provider line and the `https://api.openai.com/v1/videos` submit/poll/content path.
  Also supersedes [ADR-016](016-veo-premium-video-behind-a-raised-cap.md)'s clause that Veo is
  *"never a fallback target, and never what an agent picks on its own"*. See §The ADR-016 collision.
- **Does NOT supersede**: **ADR-024's IMAGE half.** `gpt-image-2` and the stills path are untouched
  — only `/v1/videos` is being withdrawn, and a careless read of this ADR that retires all of
  ADR-024 would needlessly reopen a settled stills decision. Also untouched:
  [ADR-011](011-media-provider-fal-wan25.md)'s price-table-in-code and separate-rail consequences,
  [ADR-012](012-media-route-and-the-reel.md)'s media-authority boundary (a provider swap does not
  move an authority boundary), [ADR-013](013-the-render-worker.md),
  [ADR-019](019-the-scene-timeline.md), and the whole-job reservation model.

## Context

**`sora-2` is deprecated and OpenAI is retiring the Videos API itself on 2026-09-24, with no named
replacement. `sora-2-pro` carries the same shutdown date.** Verified 2026-08-26 against
`developers.openai.com/api/docs/pricing` — which also confirmed our `$0.10/s` 720p row is still
exactly right — and `.../deprecations`, corroborated against independent trade coverage. Announced
2026-03-24.

**This is an ENDPOINT withdrawal, not a model deprecation**, and that distinction is what forces a
vendor change rather than a model swap. `https://api.openai.com/v1/videos` is the only video submit
path in the codebase (three call sites in `media.ts`: submit, poll, content). There is no
same-vendor row to move to, because the surface those rows lived on is going away.

The provider has now moved three times — fal.ai on Wan 2.5 (ADR-011), direct Alibaba Wan (ADR-017),
OpenAI Sora (ADR-024) — so this ADR states its reversal path explicitly rather than assuming
permanence.

### How this was found, because the mechanism matters more than the finding

The fixture already recorded `deprecated: true` **and** the shutdown date, and **every test was
green**. The only assertion touching it checked that a deprecated entry *has* a date — never that
the date is in the future, nor that anyone had decided what replaces it. The first signal would have
been `generated_video` scenes failing in production on the day the endpoint was withdrawn. Three
time-dependent tripwires now sit on the pinned models; this ADR is what satisfies the first of them.

## The constraint that did the filtering

Rule 3: **a provider whose cost cannot be pre-computed before the request exists is refused by
construction.** Rates below are published per second of OUTPUT video, read 2026-08-26.

| Model | USD/s | Note |
|---|---|---|
| **`veo-3.1-lite`** | **0.05** | Half the `sora-2` rate. Owner already holds a GCP credential. |
| `kling-3.0` | 0.112 | Per-second on the API side, but yuan-denominated — FX drift inside a USD table. |
| `minimax-h3` | 0.13 | 2K output at ~⅓ of Veo 3.1's full 1080p rate. |

**Rejected on the rule rather than on taste, which is the part worth recording:**

- **`seedance-2.0`** — bills per **million tokens**, configuration-dependent, so it is not
  pre-computable per output second. This is precisely the shape rule 3 exists to refuse, and it is
  the one that would have been easiest to rationalise in on capability grounds.
- **`sora-2-pro`** — same 2026-09-24 shutdown. A fallback that dies on the same day as the primary
  is not a fallback.

## Decision

**`veo-3.1-lite` becomes the pinned video model.** Three reasons, in the order they actually carried
the decision:

### 1. It introduces NO new data-transfer counterparty — the decisive point

Every other candidate on the shortlist means a new vendor relationship and a fresh decision about
where customer prompts are sent. This one does not: the owner already holds a GCP service-account
credential, and **ADR-016 already admitted Google as a media counterparty in principle**. The
question this ADR would otherwise have had to escalate — *may customer prompts go to this company?*
— was answered on 2026-08-07 and has not been withdrawn.

### 2. It is cheaper than the model it replaces, so no cap moves

`$0.05/s` against `sora-2`'s `$0.10/s`. A 4-second clip costs `$0.20` where it cost `$0.40`.
**`MEDIA_JOB_CAP_USD` stays `3.50`.** ADR-016's proposed raise to `7.50` was never landed, and this
ADR does **not** revive it — a successor that needs a bigger cap than the model it replaces would be
a worse outcome disguised as a migration.

### 3. It satisfies rule 3 without an argument

A published per-second-of-output rate is pre-computable before the request exists. No estimation
step, no token accounting, no post-hoc reconciliation.

## The ADR-016 collision, stated rather than stepped around

ADR-016 says Veo is *"never a fallback target"*. **Its reasoning is explicitly economic**: it priced
Veo 3 at ~`$0.40/s` against the `$3.50` cap and found one 15-second clip to be 1.7× the entire cap
— *structurally unreachable*, in its words, not merely expensive.

**Veo 3.1 Lite at `$0.05/s` is one eighth of that rate**, and cheaper than the model it replaces.
The premise ADR-016 reasoned from is gone; its decision text still names Veo. That gap is closed by
a superseding ADR, not by reading the old one loosely — which is the whole reason this section
exists rather than a footnote saying the old ADR "doesn't really apply".

**One inversion to be honest about:** ADR-016 admitted Veo as *opt-in premium, never a default*.
This ADR makes a Veo variant **the default**. That is the opposite posture, and it is defensible
only because the price inverted too. It is a replacement of ADR-016's premise, not a re-reading of
its text.

## Consequences

**The wiring is a separate build and this ADR does not perform it.** What remains:

- submit / poll / download against Google's endpoint, replacing the three `/v1/videos` call sites
- a `veo-3.1-lite` row in `MEDIA_VIDEO_PRICING` and its supported durations in `MEDIA_VIDEO_SECONDS`
- repinning `MEDIA_DEFAULT_VIDEO`
- the credential in **Convex env vars** (`npx convex env set`), never Vercel

**Runway is 28 days** at the time of writing. The three sunset tripwires stay armed: with the
succession decision now written, the binding one becomes *"the shutdown must not have passed"*.
**Do not silence a red tripwire by moving `RUNWAY_DAYS`** — it is measuring a real deadline.

`wan2.5-*` rows stay in the price table. They are historical-only (no submit path survives) and are
kept so old rows remain priceable; they are not a fallback and must not be read as one.

## Provenance of this decision

The owner was twice told this was theirs to make — it amends two ADRs and carries a data-transfer
judgement — and twice directed that the open items be closed. It is recorded here rather than left
pending so the tripwire measures a real decision instead of an absence.

**Reversal is cheap and that is deliberate**: the choice is one price row plus one pin. The two
rejected shortlist entries are recorded above *with their reasons*, so a reversal starts from a
priced comparison rather than from scratch. If Google's terms or rates move, or the data-transfer
judgement changes, supersede this ADR — do not edit it.
