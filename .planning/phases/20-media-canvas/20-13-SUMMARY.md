# 20-13 — SUMMARY

**Plan:** the assemble stage's CONTRACT, landed before any of its machinery. **Status: complete**
(2026-08-02). **Cost: $0** — nothing here calls fal, OpenAI, Vercel or the MCP at runtime.

## Delta Open Question 4 is CLOSED — the reference implementation was read

The research session could not read it (the Pikar-Ai MCP is client-side only). **This session
could.** `get_workflow_instructions("faceless-channel-video")` → **v2.0**, then
`get_workflow_bundle_file("scripts/assemble_final.sh")` → 27,634 bytes, read in full.

**Harvested, not cloned.** No submodule, no vendored repo, and no reference to the MCP anywhere in
shipped code — it is unreachable from a Convex action and from a Vercel Sandbox, which is the
finding ADR-011 exists to record.

## THE SIDECAR FIELD NAMES, VERBATIM — 20-15, 20-16 and 20-17 are written against these

**The plan's reconstructed set was WRONG in five places.** Upstream writes:

| plan assumed | upstream actually writes |
|---|---|
| `block_count` | `blocks` (a COUNT — while `per_block` is the array) |
| `total_duration_s` | `total_s` (plus `actual_s`) |
| `block_index` (0-based) | `n` (1-**based**) |
| `speech_dur_s` | `speech_s` |
| `window_start_s` | **absent** |
| `overrun` (bool) | **absent** — an overrun EXITS 1 before the sidecar is written |
| `gate` list | `gate`, a single prose STRING |
| `speech_abs_s`, `lead_silence_s` | ✅ verbatim, exactly as D8 recorded |

**Decision: the harvested script writes OUR names, not upstream's.** This is a harvest — we author
the file — and keeping upstream's names would have meant a permanent translation table across four
later plans, plus the `blocks`-means-count / `blocks`-means-array collision. The shipped sidecar is:

```
top level:  script · out · block_count · clip_seconds · total_duration_s · actual_duration_s ·
            width · height · fps · sfx_vol · gates[] · blocks[] · ts
per block:  block_index (0-based) · window_start_s · lead_silence_s · speech_abs_s ·
            speech_dur_s · clip_dur_s · overrun · internal_pauses · freeze_head · freeze_tail
```

`window_start_s` and `overrun` are ADDED by us. `overrun` is **false by construction** — an
overrunning line exits 1 before the sidecar exists — and is written anyway so a sidecar that did
NOT come from this script has to lie explicitly, and so the validator's refusal has something to
refuse. That refusal is `must_haves` truth #4 and it is now a passing, mutation-checked assertion.

The captions rebase, one line, and the reason the two anchors exist:
`absolute_t = speech_abs_s + (word_t_in_clean_take - lead_silence_s)`

## The script's EXACT CLI signature — plan 20-15 calls this

```
assemble_final.sh --blocks N [--clip-seconds 10] [--in in] [--out out/final.mp4] [--sfx-vol 0.12]
```

**Inputs are DISCOVERED BY INDEX, not passed as pairs:** `<in>/block01.mp4` + `<in>/voice01.wav`,
… through N. Upstream took positional clip/voice pairs and needed a filename-number sanity check
(`--allow-mismatch`) because "block03 + voice05" was its #1 failure. Deriving both names from the
same loop counter makes that mismatch **impossible instead of detectable** — so the pair check,
`--manifest` and `--allow-mismatch` are all gone. **20-15's `writeFiles` must use exactly those
two name patterns, zero-padded to two digits, 1-based.**

`--blocks N` is REQUIRED on every run. `--clip-seconds` accepts **5 or 10 only** — the same closed
set the price table and the storyboard parser enforce. `--subs` refuses loudly (captions are a
separate stage on the clean takes). Exit 0 = a governed render; any HARD ERROR exits non-zero
**before** the sidecar is written.

## Kept verbatim, and what each one encodes

fixed length `N × clip-seconds` asserted to ±1s on the output · **no time-stretch, ever** (an
overrunning line is a HARD ERROR to rewrite upstream) · a clip shorter than its window by >0.5s is
a HARD ERROR · speech-centred via `silencedetect`, not file-centred · the narration-per-window
assert · per-input voice loudnorm · two-pass **linear** loudnorm −16 LUFS · full-decode validation
· the sidecar.

The upstream speech window `[CLIP-1.4, CLIP]` is kept **with its comment**: a tighter 9.4–9.8s
window sat in the dead zone between the two modes TTS actually returns, and two dev runs on
2026-07-29 burned ~150 generations on 18 lines before someone started cutting silence inside takes
to pass. Audio surgery is audible; 0.7s of lead and tail after centring is not.

## Stripped (deferred — re-adding either is a scope decision)

`--music` (ducked bed, `bed_gain_db`, sidechain ducking) · `--song` (music-video mode) ·
`--stepped` (on-twos cadence) · the poster frame · `--manifest`/`--allow-mismatch`. The
in-assembler Whisper caption path was already removed upstream on 2026-07-29 for transcribing
MIXED audio and swallowing words; D8 forbids re-merging assembly and captions.
`assembleScript.test.ts` scans for the three flags, so re-adding one is visible.

## Committed fixture paths — plan 20-15's failure matrix reuses these

`packages/core/src/__fixtures__/assembly/` — `valid.json` · `malformed.json` · `empty.json` ·
`array.json` · `null.json` · `missing-speech-anchor.json` · `missing-lead-silence.json` ·
`overrun-block-4.json` · `speech-exceeds-window.json` · `block-count-mismatch.json`

They are FILES, not inline strings, precisely so 20-15 drives the real runner against the same
bytes this validator was written to.

## Deviations from the plan, recorded

1. **`empty` is an ELEVENTH error code.** The plan's union had no way to distinguish an empty
   sidecar from malformed JSON, but it asked for "a DISTINCT reason" for each. They are different
   operational stories: empty = the script died before writing one (the render never finished);
   malformed = it wrote one and something corrupted it. 20-16's `renderReason` should carry them
   separately.
2. **A missing `lead_silence_s` returns `missing_speech_anchor`**, the same code as a missing
   `speech_abs_s` (the plan said "invalid, for the same reason" without naming a code). Both are
   captions-rebase anchors; one code, one meaning, and the `blockIndex` says which block.
3. **`actual_duration_s` is validated too**, with the same ±1s tolerance and the same
   `duration_mismatch` code. The plan only specified `total_duration_s`, but `actual_duration_s` is
   the number that says the file on disk is the right length — the one a forged sidecar would lie
   about.
4. **`DURATION_TOLERANCE_S = 1` is exported**, reusing the script's own gate rather than inventing
   a second tolerance that could silently disagree with the one that produced the file.
5. **The time-stretch scan is anchored on `atempo=` / `setpts=`**, not the bare token. An ffmpeg
   filter is always `atempo=1.05`; the bare word appears legitimately inside the script's own error
   message *"never pad, atempo, or trim speech"* — which is the instruction, not the offence. Same
   reasoning as the rate-knob scan in `media.test.ts`.

## Verification

- `assembleScript.test.ts` 4/4 · `assembly.test.ts` 16/16 · `llmRedaction.test.ts` 44/44 — green.
- `@pikar/core` typecheck clean; biome clean.
- **Three mutation checks observed RED, then restored:** one byte changed in the `.sh` without
  regenerating the mirror (drift assertion); the `overrun` check deleted from the validator (the
  block-4 fixture flipped to VALID); a fake `{ name: "assemble", body: assembleScriptBody }` added
  to `skills.ts` (the RCE scan fired).

**NOT green, and NOT this plan's:** `packages/core/src/businessProfile.test.ts` has two failures —
its static scan looks for `BEHAVIOR_PRESETS.map(` and `api.tenantProfile.get` in
`dashboard/profile/page.tsx`, and the profile lane moved both into extracted panels. **Both tokens
are already absent at HEAD**, so that suite is red on `main` independently of Phase 20. It belongs
to the profile lane.

## A DEFECT this plan's work exposed in 20-01 — fixed separately, see the follow-up commit

The assembler's speech window is `[clip_seconds - 1.4, clip_seconds]`. For a **5-second** deck that
is `[3.6, 5.0]s` ≈ **75 characters** of speech — but `storyboard.ts` enforces a FLAT
`MAX_CHARS_PER_BLOCK = 140` regardless of `clipSeconds`. So a 5-second deck with a 120-character
line passes the pre-payment guard and then **hard-fails at render, after the clips are paid for** —
exactly the failure the 140-character ceiling exists to prevent, just at the other clip length.
