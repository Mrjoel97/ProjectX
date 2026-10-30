# ADR-065: Native Seedance product films

- Status: Accepted for the isolated source branch, 2026-10-24; not deployed or registry-activated.
- Provenance: the owner approved the actual standard Seedance native-audio sample and requested
  replacing the old production workflow, prioritising quality over lower prices and requesting
  varied product angles and lighting.
- Supersedes ADR-064's separate-audio default and unchanged legacy admission limits for newly
  staged native films only. Historical jobs and financial records retain their original meaning.

## Decision

New reel decks persist `mediaAudioMode: native`. Missing mode remains the historical separate
audio workflow. Native films use exact standard `bytedance/seedance-2.0`, 720p, portrait, with
native audio explicitly persisted in each reserved job. Each generated scene runs 4–15 whole
seconds; complete films run 30, 45 or 60 seconds. Every visual is generated. Native plans cannot
silently buy separate TTS, stock music, free stock, still images or a cheaper fallback.

The full visual prompt, exact narration, overlay and sound intent form one deterministic prompt
envelope. Review, reservation hashes, retry and submission refer to that same content. Changing
words changes the audiovisual purchase; it cannot reuse an old video as proof of new speech.
Existing tenant, batch, cancellation, uncertain-outcome and exact-review boundaries remain.

Native source admission allows at most 60 requested generated seconds and a $15 whole-film
policy estimate. These are separate from the legacy 12-second/$3.50 limits. The owner authorised
the quality-first application change; this is not a new paid testing allowance, an automatic
purchase, or an increase to tenant/deployment spending limits. Each film still needs its exact
content/cost review. Standard 720p reserves `0.1512 × (seconds + 1)` per clip; this is conservative
policy headroom, not a provider billing guarantee. Actual usage and unknown outcomes remain
authoritative. No automatic downgrade or unreviewed paid retry makes a refused film affordable.

The existing assembler preserves native sound from scene start at source gain before final
normalisation. It rejects absent/short native audio and redundant separate audio inputs. It
continues to validate timeline, output profile, full decode and sidecar. Native captions use a
mono PCM extraction of the actual assembled film in the same render sandbox. Immutable audio
bytes/hash, batch and exact source-film identity bind transcription and burn. Timestamps are on
the actual full-film clock; there is no separate-voice centering or per-take rebasing. Checked
captions require the transcript to match the approved narration. A mismatch reports failure and
preserves the uncaptioned film. Storage ownership/export/erasure covers the additional audio.

## Creative quality and its limits

The versioned media director plans a deliberate reveal, details, benefit and final hero. It
varies camera height, three-quarter/profile/macro angles, movement and motivated lighting,
including golden hour where appropriate. Product geometry, materials, colours and approved
claims must remain consistent. Voice and sound direction span the film; short narration leaves
room for the picture. No stock filler or automatic cheaper model is substituted.

Technical validation does not establish artistic quality or actual product fidelity. One
fictional unbranded 4-second sample establishes neither consistent voices across clips nor an
accurate unseen side of a real product. Written references are creative guidance; they are not
proof that product reference images were supplied to the provider. Real-product reference-input
wiring and full multi-scene owner review remain explicit qualification work. Never promise that
all outputs match the accepted sample or label the pipeline an automatic creative-quality judge.

## Compatibility, rollout and verification

Keep historical model prices, separate voice rendering, stock credits and older artifact readers
for existing jobs. New source no longer offers these as native quality fallback controls. Do
not rewrite financial receipts, bulk-convert existing decks, or clear uncertain purchases.

Verify new/legacy admission, prompt integrity, no TTS/music acquisition for native jobs, exact
caption-source binding, actual FFmpeg sound/timing and missing-audio refusal. Test schema storage
coverage, approval changes, editing/retry and campaign behaviour, then run source identity and
free CI gates. Deployment and registry activation require a separate coordinated release; a
source update alone cannot claim the hosted application uses the new director. Rollback affects
new staging only; preserve the explicit mode and rendering support for already accepted jobs.

Primary provider contract checked October 24:
[OpenRouter video generation](https://openrouter.ai/docs/guides/overview/multimodal/video-generation).
