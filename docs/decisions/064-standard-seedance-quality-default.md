# ADR-064: Standard Seedance 2.0 as the quality-first video default

- Status: Accepted for this isolated source branch, 2026-10-24. Not deployed or registry-seeded.
- Provenance: the owner explicitly selected standard Seedance 2.0 and prioritised quality over
  cheaper variants after reviewing the1.5/Mini comparison. This is a provider preference,
  not a claim that standard2.0 has passed full-film creative or latency acceptance.
- Supersedes ADR-027's new-video model pin and1–15-second generated grid, and ADR-026's blanket
  refusal of output-token billing for this explicitly selected profile only. Historical prices,
  reserved job identity, authority boundaries and all other limits remain unchanged.

## Decision

New video reservations select exact `bytedance/seedance-2.0`,720p, with a four-second default
and integer4–15-second generated grid. Mini, Fast and1.5 are not automatic fallbacks. Historical
Grok rows retain their original prices, duration grid and submitted model. Other standard
resolutions are not admitted by the cost table until their profile is reviewed.

The current public video catalogue publishes $0.000007 per output-video token both with and
without audio. At720×1280 and24fps this is nominally $0.1512 per second. Earlier Seedance
five-second samples returned5.041667-second output and cost slightly more than the nominal
five-second estimate. No published inclusive-frame or maximum-output-token guarantee was found.

For standard720p only, reserve `0.1512 × (submittedSeconds + 1)` per generated clip as an
explicit conservative policy allowance. A four-second clip reserves $0.756. This is **not a
verified provider invoice ceiling**. It replaces the old estimator's unsupported-model refusal
for this owner-selected profile; it does not pretend that output-token billing became exact
requested-second billing. Provider actual usage remains authoritative, unknown outcomes stop
work, and an over-reservation actual remains a breach to reconcile rather than free spend.
Keep the existing $3.50 whole-job cap,12-generated-second total, tenant/deployment rails,
exact reviewed content/cost approval and retry rules. No arbitrary resolution/model fallback
or silent downgrade can make an otherwise unaffordable plan fit.

The scene parser and narration repair use a four-second generated minimum. Repair may not
shrink a valid clip into an unsupported two/three-second purchase. Other scene kinds and
15/30/60-second final targets retain their existing meaning. This decision does not implement45s
or generated-only full films; those require their own plan/price/mode contract.

## Native audio is an explicit, separate integration

The wire contract carries optional `generateAudio` and sends true only when explicitly selected
for standard2.0. An absent flag retains the current separate-voice workflow, with standard
video audio disabled. Comparison variants retain their frozen silent contract. The price
published for standard720p is the same for native audio and silent output.

The owner's subsequent request to examine fewer steps is addressed by a bounded native-audio
provider demonstration and the accompanying integration analysis. Production native audio must
persist its mode in the approved plan and reserved job, incorporate narration/sound intent in
the exact prompt hash, omit redundant TTS/stock music, preserve native audio at scene start and
bind captions to that actual source. The current renderer otherwise drops audio under TTS or
mixes it as a quiet background bed; changing the request flag alone is not integration.
No native-audio mode, all-generated admission or removal of existing asset choices is claimed
by this model-pin change. Captions, full-film voice consistency and creative acceptance remain
separate checks. A short provider clip cannot establish a faster30–60-second production path.

## Verification and rollback

Verify exact standard model/profile in reservation and wire tests; preserve historical Grok
contracts; test every supported grid point, unknown resolutions, caps, fixture parity and
narration-donor minimums. Regenerate the canonical director mirror and source identities without
changing evaluator case bytes. All free gates and actual FFmpeg fixtures must pass on the final
source. Do not reseed/activate a registry row or deploy as part of this local branch change.

Rollback the new default and parser grid together, leaving historical prices and financial
receipts intact. Never reinterpret an already accepted job by looking up a different global
default, clear an uncertain purchase, or replace a failed expensive model with an unreviewed
cheaper one automatically.

Sources checked October24:
[OpenRouter catalogue](https://openrouter.ai/api/v1/videos/models),
[standard model/pricing](https://openrouter.ai/bytedance/seedance-2.0),
[video request contract](https://openrouter.ai/docs/guides/overview/multimodal/video-generation),
[BytePlus pricing estimates](https://docs.byteplus.com/en/docs/modelark/model-pricing?redirect=1).
