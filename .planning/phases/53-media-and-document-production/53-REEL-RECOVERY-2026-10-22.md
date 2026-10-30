# Actual reel requests and read-only recovery — 2026-10-22

The integration owner executed exactly the reviewed 19 paid requests against manifest
`99fd051f8502fc6ecc5adf8cb85efedf8ab0bcc45439dff7b98d1685243fe255`.
There was no purchase retry, extra image purchase, planning call, publication, deployment or
production preset activation in this operator comparison. The original request bodies, source,
manifest, delivered assets, transcript and financial receipts remain frozen.

## Actual reported charges

| Request type | Count | Reported USD | Sequential request time |
|---|---:|---:|---:|
| Five-second generated video | 2 | $0.7000000 | 126.607 s |
| Unique verbatim voice takes | 16 | $0.0037818 | 29.629 s |
| Final clean-voice transcription | 1 | $0.0056000 | 33.533 s |
| This reel request scope | **19** | **$0.7093818** | **189.769 s** |
| Earlier three image requests | 3 | $0.2119950 | Recorded separately |
| Shared testing known actual | **22** | **$0.9213768** | — |

These are provider-reported request charges, not an account invoice reconciliation or guaranteed
general billing ceilings. Video and voice responses reported `is_byok:false`; voice responses
also reported `openai/gpt-audio-mini`. Video responses did not report a model identity, so requested
model and reported identity remain distinct. STT reported 56 billed seconds and $0.0056; it did not
report `is_byok`. Its credit-billing basis remains the current staging account metadata plus the
owner's standard-credit attestation, not a fabricated response field.

## Why the original result stopped

The original `result.json` truthfully remains `status:stopped`, `reason:stt_words_missing`,
`completed:18`. The final STT returned 147 words and a known finite cost. Nineteen words have
exactly equal start/end timestamps. The frozen operator's predicate `w.end <= w.start` rejected
those zero-duration word alignments. There are no inverse or nonfinite timestamps, and the full
normalized 147-word sequence exactly matches all 18 frozen script occurrences.

This was an overly strict artifact gate in the operator experiment, not a missing transcript or
unknown charge. The existing production caption builder retains such words and groups them into
caption lines. The original request's $0.0056 is already retained and counted. Its unresolved
ledger hold remains intact; no financial parser, receipt, ledger status or original result is edited
to make the run appear completed. No additional purchase is permitted through this hold.

## Read-only numerical review

All 16 delivered voices are mono 24 kHz PCM16 WAV, between 2.45 and 3.70 seconds. Rebuilding
the 18 occurrence sequence with the existing `concatWavTakes` reproduces the exact submitted
55.15-second WAV and all 18 original offsets:
`563f4679bd1c13a8100ae6abbba41b89f9e6e1af9302f5ee03c8319a951db919`.
No voice was regenerated, stretched or replaced, and no provider word timing was changed.

Grouping the original word times per clean take with the existing `groupIntoLines` assigns all
147 words exactly once and produces positive-duration preflight groups. This is a numerical
preflight, not final cue proof: absolute captions still require the actual governed assembly
sidecars, including measured speech placement and silence.

There is also a separate timing weakness that must remain visible in the review. Two following
words begin just before their concatenated take boundary: the first **Keep** starts at
2.74000001 s against a 3.00 s boundary; **Leave** starts at 27.34000015 s against 27.35 s.
Consequently four adjacent take partitions do not individually match their script, even though
the full sequence is exact. The existing timestamp-based caption builder may place these words
with the preceding take. This comparison must not claim perfect word-to-shot synchronization.
The original timestamps are retained for the baseline; no guessed word timings are introduced.

The numerical report is `.tmp/phase53-reel-qualification/recovery-review.json`. A SHA-256
snapshot of 25 original source/receipt/media/ledger files is
`recovery-evidence-before.json` in the same directory, for later immutability comparison.

## Recovery scope at the pre-render checkpoint

The integration owner authorized and executed this historical offline command **before the
shared caption source edits**:

```text
node packages/backend/scripts/run-reel-quality-qualification.mjs --render-only --review-hash 99fd051f8502fc6ecc5adf8cb85efedf8ab0bcc45439dff7b98d1685243fe255
```

That completed command created the baseline exports from already delivered video, voices,
licensed stock and music, with no provider request or financial settlement. The frozen `99fd…`
seal describes the earlier source bytes; it no longer qualifies the updated caption source.
Do not reuse that historical seal as approval or provenance for the corrected candidate. The
candidate uses a separately recorded helper/source/input fingerprint and offline recovery receipt.
Check actual governed sidecars, final cue durations/word coverage, full decode, output geometry,
complete playback, caption placement and final-mix listening before claiming finished quality.
Actual listening and creative/production acceptance remain open. At that historical read-only
checkpoint, heavy rendering had not yet started.

## Subsequent baseline exports and actual visual review

The unchanged offline `--render-only` path subsequently produced both baseline exports:

| Baseline | Actual duration | Geometry / frame rate | Caption cues | Words |
|---|---:|---|---:|---:|
| `soko-30-v1/out/final.captioned.mp4` | 30.10 s | 720×1280 / 30 fps | 12 | 50 |
| `soko-60-v1/out/final.captioned.mp4` | 60.01 s | 720×1280 / 30 fps | 24 | 97 |

Both pass governed sidecar validation and full decode. All 36 cue durations remain positive at
actual ASS centisecond precision, with all 147 words present. Actual Edge playback advances,
reports ready state 4, shows native controls and loads without external requests or page errors.
The 390 px fixture has no horizontal overflow. This is a local MP4 player inspection, not hosted
authenticated application acceptance. Muted browser playback is not a listening claim.

Actual frames expose the concrete baseline failures: `come back to Keep` at 3.13–4.39 seconds
in the 30-second reel, and `to find Leave` at 13.23–14.71 seconds in the 60-second reel. These
following-take words were attached to the previous sentence by raw boundary partitioning.
Caption placement is also low enough to overlap the native controls. The generated opening has
an unsupported rear terracotta bottle that visibly floats above the shelf. The generated detail
has a different screw-cap design from the reviewed loop-cap still. These generated clips are
preserved as failed creative-QC comparison evidence; delivered bytes and finite costs do not
establish physical quality, consistent identity or video-provider acceptance.

The 25 original hash comparisons remain unchanged after baseline rendering. Numerical/cue
evidence is `baseline-cue-review.json`; actual frame and playback evidence is under `review/` in
the original qualification directory. The original `result.json` still reports its historical
artifact-gate stop, and the financial hold is not cleared by successful local rendering.

## Corrected offline QC candidate

The integration owner authorized a separate candidate with the shared caption fix, reviewed
safe-area placement, and an explicit free editorial fallback. The generated opening/detail are
replaced with the original purchased high-quality still, animated by the unchanged canonical
image renderer. This removes the observed floating bottle and inconsistent cap identity; it
does not qualify the generated-video samples as a creative success. Licensed B-roll, cards,
all original voices and the original STT word timestamps are reused. No provider request,
purchase retry, ledger settlement, deployment or production preset activation occurs.

Candidate fingerprint:
`789ca93f69bc59dad6cf2487f035dd9ff0c2c27d657620b6a87b6e9162b27257`.
Its independent helper/source/input receipt is
`.tmp/phase53-reel-quality-candidate-20261022/candidate-receipt.json`; the old `99fd…` seal
remains solely the historical baseline provenance.

| Corrected candidate path under `.tmp/phase53-reel-quality-candidate-20261022/` | Duration | Words / cues | SHA-256 |
|---|---:|---:|---|
| `soko-30-v1/out/final.captioned.mp4` | 30.10 s | 50 / 12 | `33fbf329c974cb081a9d233f7fa010146c118b66a23cfc524f963c1e4afa327b` |
| `soko-60-v1/out/final.captioned.mp4` | 60.01 s | 97 / 24 | `083fcf71e646af8c8fab8bcb84d46304372d050b4c4fbc1035db2ae17098fdf3` |

Both have validated governed sidecars, 720×1280 at 30 fps, full decode, an audio track,
147/147 exact-script word coverage and ownership, and positive cue durations at actual ASS
precision. The core strictly refuses decreasing start/end times, inverse/nonfinite times,
ambiguous tokenization, mismatched submitted scripts, timing outside the half-second take
bound and cues collapsing to zero centiseconds. Unit evidence: 52 core caption tests and 29
focused backend renderer/tenant/batch-binding tests pass. Independent read-only review found
and verified the added decreasing-end and centisecond-collapse guards.

Actual candidate Edge playback advances with ready state 4 and native controls. The local
desktop/mobile review loads with zero external requests, zero page errors and no 390 px
horizontal overflow. Captured frames were visually inspected: the repeated still has supported
loop-cap bottles; captions visibly sit above native controls; the former stray **Keep** and
**Leave** now belong to their following sentences. The parent and media agents inspected these
specific visible corrections; user creative acceptance remains open. Evidence is under candidate `review/`,
including `reel-30-3p5.png`, `reel-30-6p5.png`, `reel-60-13p8.png`, `reel-60-36p5.png` and
`playback-report.json`. This is local artifact QA, not hosted authenticated app acceptance.

Six cues still exceed the candidate 20-character/second readability target. The fastest include
**comfortable reach** at 0.40 seconds and **routine** at 0.26 seconds. Their original provider
times are retained; no display duration was fabricated to conceal this limitation. Actual
final-mix listening, fast-cue readability and broader owner creative acceptance remain open.
Muted browser playback is not a human listening claim.

The final 25-file hash comparison remains unchanged, including original paid inputs, transcript,
manifest, receipts and financial ledger. Known shared actual spend remains **$0.9213768**, with
the original single STT artifact-gate hold intact and zero new purchases. No financial parser or
receipt was edited to convert the historical stopped run into a success.

`CREDITS.txt` accompanies the candidate outputs: **Clean Soul** by **Kevin MacLeod**, from
[Incompetech](https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1300033),
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with excerpt/mix notice, plus all
six Pexels creators/source pages and the Pexels License. Keep those credits with any shared
review copy. The concept and stock appearances remain illustrative, with no endorsement or
real Soko business/product claims.
