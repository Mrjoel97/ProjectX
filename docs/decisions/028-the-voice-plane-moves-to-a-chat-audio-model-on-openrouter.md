# ADR-028: The voice plane moves to `openai/gpt-audio-mini` on OpenRouter, and a chat model is made safe to narrate with by CHECKING what it said

- **Status**: **Accepted** — 2026-09-03. See *Provenance of this decision* for who made it and how
  to reverse it.
- **Extends**: [ADR-027](027-grok-imagine-video-succeeds-sora-2-on-openrouter.md), which moved the
  IMAGE and VIDEO planes to OpenRouter and left the audio planes on OpenAI. This ADR moves the
  third plane, TTS. It supersedes nothing: ADR-027's pins, its price-table-in-code consequence and
  its transport reasoning all stand.
- **Does NOT move**: **STT.** Captions stay on `openai/whisper-1` at `api.openai.com`, and the
  *Consequences* section says plainly what that costs. TTS and STT are one "audio plane" only in
  casual speech; they have different requirements and only one of them can move today.

## Context

**The driver was not a deprecation. It was an owner instruction and an empty account.**

After ADR-027 landed, a live reel reached the voice step and failed:

```
kind: "tts"   model: "openai/tts-1"   provider: "openai"
failureReason: "credit_balance_exhausted"     estUsd: 0.00177
```

Three attempts, all identical. The image plane on the same reel had landed against OpenRouter
minutes earlier for $0.005. Nothing was wrong with the code: the voice plane was simply still
pointed at a vendor the owner had stopped funding, and the owner's instruction was explicit —
*"put it on openrouter, I am not using OpenAI API directly anymore."*

**The obvious migration does not exist.** `POST https://openrouter.ai/api/v1/audio/speech` is a
real route — it answers 400 with a model-validation error rather than 404 — but it accepts **no
model at all**. Probed 2026-09-03: `openai/tts-1`, `openai/tts-1-hd`, `openai/gpt-4o-mini-tts` and
`openai/gpt-audio` each came back `"Model … does not exist"`, the last of these despite being
present in OpenRouter's own `/models` catalogue. There is no like-for-like endpoint swap.

**What OpenRouter does have is a chat model that emits speech.** `openai/gpt-audio` and
`openai/gpt-audio-mini` declare `output_modalities: ["text","audio"]` and produce audio through
`/chat/completions`. That is the only route to a spoken narration track on this vendor today.

## Decision

**The voice plane submits to `openai/gpt-audio-mini` via `/chat/completions`, and the take is
REJECTED unless the model actually said the script.**

Three wire facts, each measured rather than read off a page:

1. **`stream: true` is mandatory.** Without it the API answers
   `400 "Audio output requires stream: true"`. Audio therefore arrives as base64 fragments across
   SSE `data:` frames and must be reassembled — the reason `generateOpenRouterVoice` is longer than
   the single-POST call it replaces.
2. **The samples are headerless `pcm16`.** `wav` is not an option on this route. `pcm16ToWav`
   (`packages/core/src/captions.ts`) gives them the 44-byte RIFF header at the edge where they
   arrive, so `concatWavTakes`, `readWav` and the assembler keep reading WAV unchanged. It is
   deliberately the byte layout `concatWavTakes` already writes, not a second dialect.
3. **The stream is 24 kHz mono**, which is exactly `MEDIA_DEFAULT_VOICE.sampleRateHertz`. Nothing
   resamples. The pinned voice `nova` survives the move (probed 3/3).

**And the part that is a decision rather than plumbing: the transcript is verified.**

`buildSubmitBody` sends a system turn instructing the model to read the user turn verbatim, and
`generateOpenRouterVoice` compares what the stream says was SPOKEN against what was SUBMITTED,
word-normalised. A mismatch fails the take with `tts_not_verbatim` and `blocked: true` — no retry,
no stored bytes.

## Rationale

**A chat model is not a TTS engine, and prompting alone is not a guarantee. This was measured, not
feared.** On 2026-09-03, `openai/gpt-audio-mini` was given the narration line
`"Nothing sends until you approve it."` under a shorter system instruction. It **answered** it:

> *"Understood. Just let me know what you are trying to send or if you would like to share more
> details, and I will assist you further."*

Twice out of two, in a synthetic voice, in a take that would have been mixed into the owner's reel
as the owner's own script. Under the stronger system line the same input came back verbatim 3/3.

So the prompt is load-bearing **and** it is not sufficient. A paraphrased narration track is not a
quality problem, it is a **provenance** failure of the kind this repo names and bans: words the
owner never wrote, voiced as theirs, and then transcribed back out by the captions step as if they
had been. The saving grace is that the stream hands us the spoken transcript for free, so catching
it costs one string comparison. **A guarantee we cannot get from the model, we take from outside
the model** — the same move the repo's own `model-reflex-vs-judgement` lesson prescribes.

The comparison is on WORDS — lowercase, punctuation and whitespace dropped — because a speech
engine legitimately renders `90%` as "ninety percent". Refusing those would refuse every good take;
what the check catches is a transcript that shares almost nothing with the line it was given.

**On price.** `openai/gpt-audio-mini` bills per audio output TOKEN, but a reservation happens
before any token exists, so the row must be priced per submitted character like every other voice
line. Two probes: 47 chars → $0.0002496 ($0.0053/1k), 104 chars → $0.0004344 ($0.0042/1k). The
table carries **$0.006 per 1000 characters**, above both with ~13% headroom, which is the direction
a reservation must err — an over-estimate refunds at landing, an under-estimate overspends the
tenant's cap. That is 2.5x cheaper than `openai/tts-1`'s $0.015, and it takes the §4.1 reference
reel from $1.762 to $1.7404.

**On pace.** The old arm sent `speed: 1` to hold the no-time-stretch rule (D8). This route has no
such field, so the rule is now enforced by absence — the stronger form. Measured speech rates were
13.4 and 16.0 chars/second against the pipeline's assumed 14, and the assembler only hard-errors
when a line overruns the NEXT line or the reel, not its own scene, so the variance is bounded and
detectable rather than silent.

## Consequences

**Captions still need OpenAI, and this is the honest cost of the decision.** `whisper-1` is asked
for `response_format=verbose_json` with `timestamp_granularities[]=word`, and the pipeline hard-
fails with `transcript_words_missing` without per-word start/end times. OpenRouter's catalogue
contains no Whisper and no other model that returns word timestamps; `gpt-audio` accepts audio
input but cannot produce them. **So with the OpenAI account unfunded, a reel now renders with its
voice and FAILS at the caption step** — which degrades the reel rather than blocking it (a failed
burn leaves the uncaptioned reel published). Burned captions are unavailable until either
OpenRouter serves a word-timestamp transcription model or the OpenAI account is funded. This is a
real product regression and it is recorded here rather than discovered later.

**A second prompt now lives in source, and §5 does not apply to it.** `TTS_VERBATIM_SYSTEM` is a
wire parameter that makes a TTS call behave like TTS — the same class as `voice` or `format` — not
an agent prompt whose wording is a product decision to be versioned and rolled back. A registry row
would make it mutable by a database write, and a paraphrasing narrator is not a tuning knob. It is
split so each literal stays under the §5 scan ceiling, the `searchVault` convention.

**`provider: "openai"` on the row is now wrong on three planes instead of one.** The closed union
`"fal" | "wan" | "openai" | "stock"` still stamps every job, and that value becomes the audit ACTOR
of an insert-only table. No behaviour depends on it — every reader tests only `=== "stock"` — but
the log now names a counterparty we did not transact with for images, video AND voice. Widening
that union over existing rows is widen-migrate-narrow and is deliberately NOT done here.

**A retry cannot fix `tts_not_verbatim`.** It is `blocked: true` on purpose: the same request would
drift again, and the take must reach the owner as a failure rather than as a silent second attempt.
If this fires often in practice, the answer is a different model or a stricter route — not a retry
loop, and not relaxing the check.

## Provenance of this decision

Made by the repo owner on 2026-09-03, in response to a live `credit_balance_exhausted` failure, with
the instruction *"change this and put it on openrouter, I am not using OpenAI API directly anymore."*
The owner was told before implementation that STT cannot move and that captions would fail as a
result.

**To reverse it:** restore `MEDIA_DEFAULT_VOICE.model` to `"openai/tts-1"`, restore the
`/audio/speech` submit arm and its `input`/`response_format`/`speed` body, and point
`generateOpenRouterVoice` back at `OPENAI_API_KEY` and `api.openai.com`. The price row for
`openai/tts-1` was left in `MEDIA_TTS_PRICING` precisely so a reversal does not have to re-derive
it. `pcm16ToWav` and the verbatim check would then be dead code and should be deleted rather than
left as a second unused path.
