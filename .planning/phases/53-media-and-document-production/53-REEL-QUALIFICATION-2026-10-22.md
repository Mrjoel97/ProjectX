# Reel quality qualification — operator review, 2026-10-22

The owner approved a shared **$5 testing policy allowance**, and the authorized staging key may
be supplied in memory without saving or printing it. The completed image comparison reported
**$0.211995**, leaving **$4.788005** before any further approved lane spend. These figures are
policy admission targets, not guaranteed provider invoice ceilings. No reel purchase has occurred
while preparing this proposal. No application default, price, hosted record, skill activation,
deployment, provider setting or external publication changes in this experiment.

## Exact paid scope

One 30-second and one 60-second vertical fictional Soko Studio concept use the frozen synthetic
facts and narration in `packages/core/src/productionQuality.fixtures.ts`. Both use six/twelve
five-second scenes. The 60-second version develops additional coverage rather than stretching
the 30-second render. Stock illustrates routines; it does not depict actual Soko premises,
employees, products, customer outcomes or environmental savings.

| Submission | Count | Existing route/model | Policy allowance each | Scope allowance |
|---|---:|---|---:|---:|
| Generated motion | 2 | OpenRouter `/videos`, `x-ai/grok-imagine-video`, 5 s, 720p, 9:16 | $0.50 | $1.00 |
| Unique verbatim voice takes | 16 | OpenRouter `/chat/completions`, `openai/gpt-audio-mini`, nova, PCM16, 24 kHz, streaming | $0.05 | $0.80 |
| Clean-voice word transcription, last paid call | 1 | OpenRouter `/audio/transcriptions`, `openai/whisper-1`, verbose JSON, word timestamps | $0.10 | $0.10 |
| New generated stills / planning calls | 0 | Reuse the completed high PNG and existing frozen editorial fixtures | $0 | $0 |
| Total | **19 POSTs** | One at a time; no automatic purchase retry or failover | — | **$1.90** |

The two video requests reproduce the existing pure `buildSubmitBody` wire contract. They are
text-to-video requests; there is no invented image-reference field or identity guarantee. The first
opening is reused in both edits. The second motion detail appears only in the 60-second edit.
The high PNG is reused for three animated-still occurrences, with no additional image purchase.
Generated and stock bottle designs may differ; that is a review limitation, not real-product proof.

The 16 unique voice scripts total 684 submitted characters. The existing empirical character
proxy would estimate $0.004104, but this route bills generated audio tokens, so that proxy is
**not a provider exposure bound**. At the existing measured $0.07/video-second, motion estimates
$0.70. STT estimates $0.006 per measured clean-audio minute; its duration exists only after voice
delivery. Roughly $0.71 combined is an indicative expectation, not a reservation ceiling or a
promise. The approved $1.90 scope policy is deliberately separate. Each request must fit inside
the remaining shared $5 policy allowance before submission, and a per-request policy overrun
is recorded before stopping all later purchases.

## Reviewable manifest and licensed sources

`packages/backend/scripts/run-reel-quality-qualification.mjs` creates
`.tmp/phase53-reel-qualification/manifest.json` containing every literal prompt/script/body,
model/route/format, per-request allowance, scene order, immutable source hashes, original high-image
hash and chosen asset metadata/hashes. The final manifest digest must be reviewed after the six
stock clips and music are curated; an asset-free draft cannot execute.

The staging Pexels key was unavailable. Manual public Pexels catalogue retrieval is therefore an
operator fallback, **not successful acceptance of the application's authenticated Pexels route**.
Six distinct source records must preserve actual Pexels page, creator, licence link and file hash.
The [Pexels License](https://www.pexels.com/license/) permits composed commercial use; do not
imply endorsement, misrepresent people or distribute unaltered stock as a standalone product.
Keep the clips illustrative and inspect the actual frames for relevance and crop quality.

The instrumental bed must have an actual catalogue or primary composer source record and CC BY or CC0 licence;
the runner refuses BY-SA/NC licence paths for this comparison. Preserve title, creator, source,
licence URL, attribution and downloaded-byte hash. Catalogue search terms do not prove that a
track has no vocals. The integration owner authorized this bounded comparison on source/licence
metadata and numerical review, so it can produce a concrete output before actual listening.
Listening remains pending and blocks finished-creative or production acceptance. Licence evidence and visual/listening
review are recorded alongside the actual assets, not inferred from a query string. Anonymous
Openverse was unreachable during preparation; a manually verified primary composer download is
an operator fallback and does not prove the application's Openverse adapter succeeds.

The selected bed is **Clean Soul** by **Kevin MacLeod**, ISRC **USUAN1300033**, from the
[composer's track catalogue](https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1300033),
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its original MP3 is 12,271,405
bytes, probes to 306.7298 seconds, and passes a full local decode. Original SHA-256:
`458868c225cf8f6dbaf17300aa2e0839386991be8581d0218554699297d7581c`.
Composer metadata describes electric piano and bass; this is not a claim of actual listening.
The local catalogue preserves attribution, the licence link, source and a notice of excerpt/mix
changes. Include that credit with any shared finished reel; do not imply composer endorsement.

The intended scene mapping is:

- 30 s: generated opening, stock 0, stock 1, reused high still, stock 2, closing card.
- 60 s: opening, stock 3, stock 1, high still, stock 4, pause card, stock 0, generated detail,
  stock 2, high still, stock 5, closing card.

The actual six manually retrieved Pexels assets were downloaded and probed before paid review:

| Ref | Primary asset page | Creator | Actual source geometry | Duration |
|---|---|---|---|---:|
| stock 0 | [6963727: arranging shelf ceramics](https://www.pexels.com/video/a-person-stacking-bowls-on-a-shelf-6963727/) | Cup of Couple | 1080×1920 | 8.842 s |
| stock 1 | [5823688: dispenser water pour](https://www.pexels.com/video/person-getting-water-from-a-glass-jar-5823688/) | Charlotte May | 1080×1920 | 12.393 s |
| stock 2 | [10568461: kitchen counter context](https://www.pexels.com/video/a-man-organizing-a-kitchen-counter-10568461/) | Ron Lach | 720×1366 | 34.560 s |
| stock 3 | [10568459: closer kitchen jars](https://www.pexels.com/video/a-person-organizing-a-kitchen-counter-10568459/) | Ron Lach | 1080×2048 | 38.400 s |
| stock 4 | [6932952: water into lemon-water glass](https://www.pexels.com/video/a-woman-pouring-water-on-a-glass-6932952/) | Mikhail Nilov | 1080×1920 | 21.600 s |
| stock 5 | [6211534: water on kitchen scale](https://www.pexels.com/video/pouring-water-into-a-glass-on-digital-scale-6211534/) | Antonius Ferret | 1080×1920 | 14.125 s |

The initial stock 4 candidate was rejected after frame inspection because its amber decanter/bar
composition conflicted with the water-refill concept. Its replacement was inspected at 0.5, 2.5
and 4.5 seconds: the clear water, lemon glass and kitchen routine are visible. It includes a
person's face/body; use remains illustrative with no endorsement or Soko affiliation implied.
The pour begins near 4.5 seconds in the original, so the integration owner approved a local
editorial excerpt of original seconds **3 through 8**. Its 0.5, 2.5 and 4.5 second frames were
inspected: setup leads into an active pour with the bottle and glass inside the portrait crop.
The five-second derivative is 1080×1920, 3,298,228 bytes, and passes full decode. Its SHA-256 is
`b3bf953c1d4d8d593ccadb20627a2b07610ce305551391ae3ef8c0543284e363`.
The full original remains intact at `assets/stock-4.mp4`, SHA-256
`2cb5c79bca0375d2e066d71997362eb7c95a2fa61af08f9799e5d7b99a8c0733`.
The manifest binds the derivative plus `originalPath`, `originalSha256`, original duration,
`excerptStartS:3`, `excerptEndS:8` and the exact command. This is operator editing, not a new app
in/out control or API. No frozen runner source changed to make the excerpt:

```text
ffmpeg -cpucount 2 -y -loglevel error -ss 3 -i .tmp/phase53-reel-qualification/assets/stock-4.mp4 -t 5 -an -c:v libx264 -threads 2 -preset veryfast -crf 18 -pix_fmt yuv420p -movflags +faststart .tmp/phase53-reel-qualification/assets/stock-4-excerpt.mp4
```

Two Ron Lach clips share the same kitchen setting but are
distinct sources/framings, not a duplicate asset counted twice. Stock 2's actual dimensions differ
from its CDN filename; the manifest records the probe result. Export geometry does not imply that
every source is native 1080p or 30 fps. Final rendered crops and captions still need review.

Contact sheet: `.tmp/phase53-reel-qualification/review/stock-contact-sheet.png`.
Replacement motion strip: `review/stock-4-motion-strip.png` in that same directory.
All original byte hashes, credits and licence links are in `assets.json` and the reviewed manifest.

## Billing evidence and stop rules

The same canonical `.tmp/phase53-paid-qualification/charges.jsonl` ledger used for the image
comparison is mandatory for CLI execution. It is never initialized as a fresh reel allowance.
A global exclusive lock serializes benchmark lanes. A single-use execution marker prevents
replaying this run. Each POST has a durable `request_started` receipt before network submission.
Pending video jobs use read-only polling of their recorded ID; a timeout or uncertain outcome
never causes resubmission.

Finite reported actual cost is retained independently of output success. A content download,
verbatim, identity or policy failure cannot erase a known charge. Missing or nonfinite cost leaves
the attempt unresolved and stops later purchases. Known actual spend from every lane is summed
before admitting the next request. A crash leaves a lock/unsettled receipt for manual reconciliation;
there is no automatic hold expiry or resume. Credentials enter only through process environment
variables and never appear in arguments, receipts or local renderer child environments.

[OpenRouter video documentation](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
describes asynchronous submission, read-only status and content retrieval. The response's final
usage is required before a later purchase. [Usage accounting documentation](https://openrouter.ai/docs/cookbook/administration/usage-accounting)
states that streaming usage arrives in the terminal frame; the voice reader preserves it without
adding deprecated request flags. Requested model, explicitly reported model and reported BYOK
status remain separate evidence fields. An explicit different reported model stops the run.

For [transcription](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/), the public
OpenAPI formally makes `usage.cost` optional and does not define an STT `is_byok` field. STT
therefore runs last. A finite response cost, or corroborated read-only generation `total_cost`, is
required to settle. Otherwise the ledger stays unresolved and execution stops; never assume $0.
If the response omits `is_byok`, record that absence and use the current staging key metadata plus
the owner's standard-credit attestation as the distinct account billing basis. Never manufacture
a response `is_byok:false` value. Provider charges remain authoritative even on failure.

## Local render and acceptance evidence

The runner reuses the production `assemble_final.sh` and `burn_caps.sh` unchanged, plus the
existing pure PCM/WAV, concatenation, sidecar and caption-timing functions. It renders one reel
at a time at 720×1280, 30 fps, hard cuts, existing music bed level, ivory/teal cards and actual
clean-voice STT captions. Source audio is discarded under narration by the canonical assembler.
No speech stretching, silent replacement take, fabricated word timestamps or synthetic testbar
footage qualifies as finished production evidence. A short/overlong voice or missing source stops
the comparison, without buying an automatic rewrite.

Record governed sidecars, full decode, actual duration/geometry/audio, caption counts and output
hashes. Then inspect playback, representative frames, captions at cuts, pacing, B-roll variety,
safe-area readability, complete intelligible narration and music below voice. Local Arial/card and
libass substitution can differ from hosted fonts. This is operator quality evidence, not hosted
authenticated application acceptance. A general reference-consistent identity workflow, live batch
recovery, director promotion and default-quality rollout remain separate reviews.

## Operator commands

Offline preparation, with no network:

```text
node packages/backend/scripts/run-reel-quality-qualification.mjs --prepare
```

Read-only curated stock preparation, after the local catalogues exist:

```text
node packages/backend/scripts/run-reel-quality-qualification.mjs --prepare --fetch-stock --stock-catalog .tmp/phase53-reel-qualification/stock-catalog.json --music-catalog .tmp/phase53-reel-qualification/music-catalog.json
```

After final manifest/licence/output review and integration-owner go-ahead, only the authorized
credential broker may inject `OPENROUTER_QUALIFICATION_API_KEY` in memory and invoke:

```text
node packages/backend/scripts/run-reel-quality-qualification.mjs --execute --review-hash 99fd051f8502fc6ecc5adf8cb85efedf8ab0bcc45439dff7b98d1685243fe255 --policy-allowance-ack --credit-billing-only
```

No paid call is authorized by merely preparing a draft. The execution command does not activate
production presets or publish anything externally. Local outputs and sensitive operator receipts
stay under ignored `.tmp`; reviewed summaries contain no credentials or private download links.

Twenty-one focused no-egress tests passed with a synthetic transport and private local mock assets:
exact scope/wire bodies, offline prepare, no key inheritance by render children, SSE/poll cost
retention, licence/catalogue restrictions, digest/ledger/single-use refusal, durable pre-submit
receipts, unknown/over-policy/identity stops, early video geometry/duration refusal, STT-last ordering
and read-only cost corroboration.
The tests do not require the ignored paid image or real credentials, and do not claim provider
acceptance, actual narration, real rendered footage or listening review. Independent source review
found no remaining concrete paid-admission or credential blocker; final actual-source review and
the integration owner's execution go-ahead remain required.

Final prepared manifest after the licensed editorial excerpt:
`99fd051f8502fc6ecc5adf8cb85efedf8ab0bcc45439dff7b98d1685243fe255`.
The saved manifest and freshly recomputed source/asset request manifest must still match at
execution. The shared ledger at this review contains exactly three settled image attempts,
$0.211995 known actual spend and zero unresolved attempts. No paid reel request has been made.
