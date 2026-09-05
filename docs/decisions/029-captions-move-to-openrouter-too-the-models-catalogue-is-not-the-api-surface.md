# ADR-029: Captions move to OpenRouter too — a `/models` catalogue is not an API surface

- **Status**: **Accepted** — 2026-09-03.
- **Supersedes**: [ADR-028](028-the-voice-plane-moves-to-a-chat-audio-model-on-openrouter.md) **in
  its STT half ONLY** — the claim that transcription cannot move off OpenAI, and the product
  regression that claim justified. ADR-028's TTS decision, its verbatim check, its price row and
  its wire facts all STAND and are not reopened here.
- **Does NOT supersede**: [ADR-027](027-grok-imagine-video-succeeds-sora-2-on-openrouter.md), or
  any earlier media ADR.

## Context

ADR-028 was accepted earlier the same day and stated, as a consequence the owner was asked to
accept:

> *"OpenRouter's catalogue contains no Whisper and no other model that returns word timestamps …
> So with the OpenAI account unfunded, a reel now renders with its voice and FAILS at the caption
> step."*

**That was wrong, and the reasoning error is the reason this ADR exists rather than a quiet fix.**

The conclusion came from `GET https://openrouter.ai/api/v1/models`: 424 entries, filtered for
anything audio-shaped, yielding only `openai/gpt-audio` and `openai/gpt-audio-mini` — neither of
which can emit word timings. From "no Whisper in the catalogue" came "no Whisper on the platform".

The owner refused the consequence and asked for the question to be reopened. It took one request:

```
POST https://openrouter.ai/api/v1/audio/transcriptions
  model=openai/whisper-1  response_format=verbose_json  timestamp_granularities[]=word
-> HTTP 200
{"text":"Founders lose 90 minutes a day to the inbox.",
 "duration":3.5, "usage":{"seconds":4,"cost":0.0004},
 "words":[{"word":"Founders","start":0,"end":0.6}, … 9 words, 0 malformed]}
```

Complete per-word `start`/`end`, in exactly the shape `submitCaptions` already parses.

## Decision

**The STT plane submits to `https://openrouter.ai/api/v1/audio/transcriptions` on
`OPENROUTER_API_KEY`, with the model id `openai/whisper-1` sent UNSTRIPPED.**

Everything else about the caption path is unchanged: the same multipart form, the same
`verbose_json` + `timestamp_granularities[]=word` request, the same `transcript_words_missing`
fail-closed behaviour, the same `MEDIA_STT_PRICING` row.

**`MEDIA_STT_PRICING` does not move**, and that is a measured claim rather than an assumption:
`usage.cost / usage.seconds × 60` came to **$0.0060/minute**, identical to OpenAI's published
whisper-1 rate. A migration that changes a price silently is the failure mode the media price table
exists to prevent, so the equality was checked rather than hoped for.

**`api.openai.com` now appears in `media.ts` for the retained Sora poller ALONE**, which no submit
path reaches and which may be deleted after 2026-09-24. `OPENAI_API_KEY` is read by nothing that
submits work.

## Rationale — the mistake, named, because it will be made again

**A `/models` catalogue lists what a CHAT endpoint can route to. It is not an inventory of the
platform.** OpenRouter's audio routes have their own model registries that the catalogue does not
describe, in both directions:

- `openai/gpt-audio` **is** in the catalogue and is **rejected** by `/audio/speech`.
- `openai/whisper-1` is **absent** from the catalogue and is **served** by `/audio/transcriptions`.

So the catalogue is not merely incomplete, it is uncorrelated with these routes. Any conclusion of
the form "OpenRouter cannot do X because X is not in `/models`" is unsound, and this ADR is the
record of that conclusion being drawn and costing a documented product regression.

**The compounding factor is that the same error had already been caught once in the same session.**
The `/audio/speech` finding — a real route, 400 rather than 404, accepting no models — was itself
discovered by probing rather than by reading the catalogue. Having learned that the catalogue does
not describe `/audio/speech`, the correct inference was that it does not describe
`/audio/transcriptions` either. Instead the catalogue was consulted again and believed again.

**The rule this leaves behind:** for any OpenRouter capability question, **probe the endpoint**. A
route that answers `400` with a model-validation error exists; a route that answers `404` does not.
The catalogue answers a different question than the one being asked.

**On why this is an ADR and not an edit.** ADR-028 was hours old and materially wrong on a point
the owner was asked to accept a regression for. §9 makes ADRs immutable precisely so that a record
of what was believed, and when, survives being wrong. Editing ADR-028 would have erased the
mistake; superseding it keeps the reason a future reader should distrust a catalogue-based
capability claim.

## Consequences

**The regression ADR-028 recorded does not exist.** Reels render with voice AND burned captions,
with no OpenAI credit, on one credential.

**Every paid media plane now reads one credential from one vendor** — images, video, voice and
captions. `requireEnvMedia("OPENAI_API_KEY")` survives at exactly one call site, in
`pollOpenAiVideoTask`, and when that poller is deleted after 2026-09-24 the variable can be removed
from the deployment entirely.

**The caption routing test now asserts the RESOLVED url**, which it never did. It checked the form
fields and the response and nothing about where the request went — so it would have passed
unchanged had the host stayed on OpenAI. `media.ts`'s own header warns that a source scan proves
spelling and not routing; the test that most needed that discipline did not have it.

**A stale sentence was removed from `media.ts`'s adapter header.** It read "tts/stt -> still
OpenAI", which was true when written and false twice over within a day. It now names the single
surviving OpenAI call site and carries the catalogue warning above.

## Provenance of this decision

Made by the repo owner on 2026-09-03, who rejected ADR-028's caption regression and asked for the
alternatives to be researched properly rather than accepted. The probe that settled it took one
request against an endpoint that had not been tried. The owner was right to push.

**To reverse it:** point the `submitCaptions` fetch back at
`https://api.openai.com/v1/audio/transcriptions`, restore `requireEnvMedia("OPENAI_API_KEY")` at
that call site, and restore the `.replace(/^openai\//, "")` on the `model` form field — OpenAI's
own API does not accept the route prefix. No price row changes in either direction.
