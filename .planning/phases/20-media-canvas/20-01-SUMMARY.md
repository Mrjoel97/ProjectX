# 20-01 — SUMMARY

**Plan:** the pure, Convex-free media core. **Status: complete** (task 1 shipped in `4565254`;
tasks 2 + 3 landed 2026-08-02). Cost to build: **$0** — no test calls a model or a provider.

## What shipped

| File | What it is |
|---|---|
| `docs/playbooks/media.md` | the subsystem playbook — invariants, the §4.1 economics, the retention rule, and now the runnable `## Reconciliation` procedure |
| `docs/playbooks/watch.json` | `media.md`'s ten production prefixes (unblocks 20-13, 20-15 and every later plan) |
| `packages/core/src/storyboard.ts` | `parseBlockDeck` → N fixed-length blocks; `SHOT_TYPES`; `CLIP_SECONDS`; `MAX_CHARS_PER_BLOCK`; `isPaidBlock`; `narrationChars` |
| `packages/core/src/storyboard.test.ts` | 22 tests |
| `packages/cost/src/media.ts` | four billing units, `estimateMediaUsd` / `estimateBatchUsd` / `chooseMediaBatch`, the D10 constants |
| `packages/cost/src/media.test.ts` | 29 tests, incl. the D12(a) pinning test and the SC5 static assertions |
| `packages/cost/src/media.fixtures.json` | the vendor-price provenance fixture |

Verification: `@pikar/core` **404 tests green**, `@pikar/cost` **56 green**, both `tsc --noEmit`
clean, biome clean. No backend file was touched, so the backend typecheck baseline is unmoved.

## PREFLIGHT — live figures observed 2026-08-02 (vendor-direct, verbatim)

`GET https://fal.ai/api/models?keywords={wan-25|inworld|scribe|schnell}&page=1`, unauthenticated.

| id | vendor string (verbatim) | status |
|---|---|---|
| `fal-ai/wan-25-preview/text-to-video` | *"Your request will cost \*\*$0.05\*\* per second for \*\*480p\*\*, \*\*$0.10\*\* per second for \*\*720p\*\*, \*\*$0.15\*\* per second for \*\*1080p\*\*."* | public, `deprecated:false`, `removed:false` |
| `fal-ai/inworld-tts` | *"Your request will cost \*\*$0.01\*\* per 1000 character."* | public, live |
| `fal-ai/elevenlabs/speech-to-text/scribe-v2` | *"Your request will cost \*\*$0.008 per input audio minutes\*\*. If keyterm is used, you request will cost %30 more."* | public, live |
| `fal-ai/flux/schnell` | **no `pricingInfoOverride`**; `billingMessage: "Images are billed by rounding up to the nearest megapixel."` | public, live |

**NO figure changed against the plan's table.** Three things the read added:

1. **scribe-v2 carries a +30% keyterm surcharge.** We submit `keyterms: []`. Sending keyterms
   without re-pricing the row to $0.0104/min is a silent 30% under-reservation. Pinned in the
   fixture's `notes`.
2. **FLUX schnell's $0.003/megapixel is NOT vendor-confirmed** — the endpoint publishes the
   rounding RULE only. Recorded as `confidence: "MEDIUM"`; the fixture-agreement test allows an
   unjustified number *only* when the entry is marked MEDIUM. First invoice resolves it.
3. **The `-preview` rename risk has not fired.** `fal-ai/wan-25-preview/*` is live and not
   deprecated; its `image-to-video` sibling carries an identical price string.

## The exact fal request-schema field names — for plans 20-05 and 20-14

Read from `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`. **Pin every one of
these explicitly on submit; do not inherit a default.**

**`fal-ai/wan-25-preview/text-to-video`** — `prompt`, `duration`, `resolution`, `aspect_ratio`,
`audio_url`, `enable_safety_checker`, `enable_prompt_expansion`, `negative_prompt`, `seed`.

- ⚠️ **`duration` is a STRING enum `["5","10"]`, default `"5"`.** Submitting the *number* `10`
  fails schema validation — **after** the reservation is taken. `MediaSpec.seconds` is a number by
  design (it is arithmetic); the adapter must `String(seconds)` at the boundary.
- ⚠️ **`resolution` defaults to `"1080p"`** — the 3× under-report this plan exists to contain.
- There is no `enable_audio` flag. Audio is `audio_url` (optional); D8's voiceover is muxed by the
  assembler, not by the provider.
- `enable_prompt_expansion` defaults **true** — a model-side rewrite of our prompt. 20-05 should
  pin it `false`, or the prompt we priced is not the prompt that ran.

**`fal-ai/inworld-tts`** — `text`, `voice` (closed enum; `"Evelyn (en)"` is a member), and
`sample_rate_hertz` (enum `[8000,16000,24000,32000,40000,48000]`, **default 48000** — we pin
24000). The endpoint exposes **no pace/stretch parameter at all**, which is exactly why it was
chosen over `fal-ai/kokoro/*` (delta pitfall 15).

**`fal-ai/elevenlabs/speech-to-text/scribe-v2`** — `audio_url`, `keyterms` (default `[]`,
**keep it empty — +30%**), `diarize`, `tag_audio_events`, `language_code`.

**`fal-ai/flux/schnell`** — ⚠️ **there is no `width`/`height`.** The field is `image_size` (a preset
name OR a `{width, height}` object), plus `num_images` (default `1`, **a straight price
multiplier**), `num_inference_steps`, `output_format`, `acceleration`, `guidance_scale`, `seed`.
`MediaSpec.image` keeps `width`/`height` because that is what megapixels are computed from; the
adapter maps them onto `image_size` and must pin `num_images: 1`.

## The D12(a) mutation check — observed numbers

Mutation: move the cents floor into `estimateMediaUsd` so it applies per line item.

| | true cost | once-only (shipped) | per-line (the bug) |
|---|---|---|---|
| 6 voice lines × 200 chars | $0.012 | **2 cents** | **6 cents** |
| the §4.1 job | $3.052 | 306 cents | 3.068 → 307+ |

**Correction to the plan's arithmetic, recorded deliberately.** The plan asserted *"a 6-line batch
of $0.002 items reserves 1 cent, not 6."* $0.012 **is 1.2 cents**, so the fail-closed ceiling is
**2**, not 1. The contrast the test exists for is unchanged and is asserted both ways: 2 once-only
vs 6 per-line — 3× the reservation and 5× the true cost. The plan's second case *does* land on 1:
13 sub-cent lines (50 chars each, $0.0065 total) reserve **1 cent, not 13**. Both are pinned.

## All six mutation checks — every one observed RED, then restored

| mutation | assertion that fired |
|---|---|
| cents floored per line item | `expected 0.02 to be close to 0.012` + the §4.1 total moves to 3.068 |
| image estimator drops `Math.ceil` | `expected 0.0062208 to be close to 0.009` |
| TTS rounds its thousands up | `expected 0.02 to be close to 0.012` |
| missing resolution falls back to the 480p row | `expected 'ok' to be 'unknown_model'` |
| the 140-char guard removed | `narration_too_long` stops firing |
| per-row duration silently renormalised | `mixed_durations` stops firing |

## Deliberate deviations from the plan — read these before writing a dependent plan

1. **STT rounds up to whole input minutes** (`Math.ceil(audioMinutes)`). The plan pinned only the
   exact 1-minute case and was silent on rounding; the vendor's unit is a minute, and the
   `priceTranscription` precedent in `cost.ts:84` rounds up. Bounded cost of the bias: $0.008, 0.2%
   of the job cap. A 30-second reel still buys one minute.
2. **`Block.prompt` is parsed from an optional `BLOCK PROMPTS` section**, matched by 1-based block
   number (`Block 2` → `Prompt: …`), and **falls back to the block's description** when absent.
   The plan declared the field but never said who fills it. **Plan 20-03's body must emit that
   section in that shape** or every generation prompt silently degrades to a visual description —
   which is not a parse failure and would ship quietly. The round-trip test in 20-03 should assert
   at least one block's `prompt !== description`.
3. **`index` is 0-based and comes from ROW ORDER, not the `#` column.** `windowStartMs = index *
   clipSeconds * 1000`, so block one starts at 0 ms. The `#` column is display only.
4. **An absent `Clip seconds:` declaration is `bad_duration`** — the parser does NOT fall back to
   `DEFAULT_CLIP_SECONDS`. Guessing a block length picks a price. `DEFAULT_CLIP_SECONDS` remains
   exported for the canvas editor (20-09) to start a new deck at.
5. **Columns are mapped BY HEADER NAME**, and only an explicit `Seconds`/`Secs`/`Duration` column
   is read as a duration — a `Time` column is ignored entirely, per D8's "a model's arithmetic is
   not an input to a timeline".
6. **`illegal_duration` doubles as the code for any non-finite/negative submitted count** (chars,
   megapixel dimensions, audio minutes). The plan's union has three members and adding a fourth for
   a case the parser already prevents was not worth it; the union's doc comment says so.
7. **No `// @vitest-environment node` pragma was needed.** `packages/cost/vitest.config.ts` already
   runs the default node environment — the plan assumed `edge-runtime`. Same for `packages/core`.
8. **The pitfall-15 tripwire is SCOPED**, not a bare token grep. The plan asked for "no `speed` /
   `rate` / `atempo` / `setpts` token anywhere"; a literal `\brate\b` fires on `sample_rate_hertz`,
   which is a pinned audio sample size, not a playback lever. The shipped assertion is
   `/\b(atempo|setpts)\b/i` plus `/\b(speed|rate)\s*[:=]/i` — it catches a KNOB (a field named
   speed or rate) while allowing the vendor's field name. The reasoning is in the test.

## What the next plans inherit

- **20-02** — `mediaJobs.estUsd` stores **fractional USD**; only the batch reservation is cents.
  `MediaSpec`'s four paid kinds match the schema's four-member `kind` union exactly.
- **20-03** — `parseBlockDeck` is the contract. The body must emit `BLOCK DECK`, a `Clip seconds:`
  line ∈ {5,10}, a table with `Type` / `Description` / `Narration` (+ optional `Text overlay`), and
  a `BLOCK PROMPTS` section keyed `Block N`. Narration ≤ 140 chars **inclusive**.
- **20-05 / 20-14** — the field-name list above. `String(seconds)` for `duration`;
  `enable_prompt_expansion: false`; `num_images: 1`; `keyterms: []`; `sample_rate_hertz: 24000`.
- **20-11 / ADR-012** — the FLUX MEDIUM-confidence figure and the scribe-v2 keyterm surcharge are
  the two open price items. The reconciliation procedure in `media.md` is their resolution path.
