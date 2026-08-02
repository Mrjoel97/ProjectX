# 20-17 — SUMMARY

**Plan:** the transcript stage, the pure `.ass` writer, the burn pass, and their offline assertions.

**Status: implementation complete and test-green, NOT live-verified** (2026-08-03). **Cost: $0** —
no sandbox has been created and no STT minute has been bought. Commit `cb60358`.

**THE CUT LINE WAS NOT CUT.** 20-17 was authored as the phase's designated drop-if-running-long
plan. It shipped, and the reel now works on an autoplay-muted feed.

## What it did NOT add — the design goal, restated as an outcome

No Python runtime. No Whisper weights (~1.5–3 GB). No font fetcher. **Nothing at all added to the
sandbox image.** The reference implementation's captions path implied all four; moving the STT to
fal — where the adapter, the auth, the queue, the webhook, the price table and the reconciliation
procedure already existed — cost one `kind` arm and one wire field.

## The exact request/response contract (what 20-11's live gate will confirm)

| | |
|---|---|
| Model | `fal-ai/elevenlabs/speech-to-text/scribe-v2` |
| Request body | `{ audio_url }` — **that is the entire body**. No `keyterms` (+30%). |
| `audio_url` form | **`data:audio/wav;base64,…`** (see the deviation below) |
| Response read | `payload.words[]`, each `{ text, start, end, type }` |
| `type` values consumed | `"word"` kept; `"spacing"` and `"audio_event"` DROPPED |
| Landing | INLINE — no URL, no fetch, no host check. Re-serialised before storage. |
| Billing | per INPUT audio minute ⇒ `EXACT_SPEND_KINDS`, zero window delta |

**Field names are UNPROVEN against the live provider.** They come from the plan's vendor-direct
read of 2026-08-01, not from a response this code has seen.

## Concatenated, not per-block — and why that was not a free choice

`reserveJobInner` already creates **ONE** `stt` line at `blockIndex: -1`, priced at the whole deck's
audio minutes. N requests would spend one reservation N times, so the takes are concatenated.

**That forced a real wav header rewrite.** The delta called it *"a byte-level concat of same-format
WAVs"* and that is wrong in a way that fails silently: gluing two wav files together leaves a header
claiming the FIRST file's length, a decoder stops there, and the transcript covers take 1 only —
looking entirely plausible. `concatWavTakes` writes a canonical 44-byte header and returns
`offsetsS`, which is persisted as `plans.captionOffsetsS` because it cannot be recomputed once the
takes are deleted. Mismatched formats are refused rather than concatenated.

## ⚠ THE DEVIATION: a `data:` URI, not fal's file-upload endpoint

The plan said: POST the bytes to fal's file-upload endpoint, submit the returned fal-hosted URL.
**Shipped instead: a `data:` URI on the existing submit request.**

- **The binding requirement is satisfied absolutely.** The plan's own truth is *"a Convex signed
  storage URL is NEVER handed to a third party"* — `plans.attachmentUrls`' header calls such a URL a
  bearer capability. With a data URI, no URL of ours exists to hand over.
- **Why not the upload:** it is a multi-step protocol (initiate → PUT → derive) whose exact shape
  could not be confirmed vendor-direct in this session; the delta records only that it "returns a
  fal-hosted URL". Guessing a protocol at a money boundary fails at the first live call.
- **It removes a ceiling the plan expected to record.** There is no copy of tenant audio sitting in
  fal's storage under a retention policy we do not control. The bytes reach fal for the request and
  no longer.
- **Bounded:** `MAX_STT_AUDIO_BYTES` = 6 MB pre-base64 (a 6×10s reel at the pinned 24 kHz mono
  16-bit is ~2.9 MB). Over it is a governed stop with a code, never a 413 after the spend.
- **Scanned:** `llmRedaction.test.ts` greps `submitCaptions` for `storage.getUrl` and pins every
  `audio_url` construction site. This is one line away from being false and the symptom would be
  invisible — the transcript returns correctly either way.
- **Upgrade path:** fal's file-upload endpoint, confirmed against its OpenAPI spec first. The seam
  is the single `audioDataUri` function.

## The narrowed retention condition, verbatim

20-16: *delete once `final.mp4` is published*. 20-17: **delete once the FINAL artifact is
published.**

```
if (!(await captionsStillOwed(ctx, a.tenantId, a.batchId))) {
  await deleteIntermediates(ctx, a.tenantId, a.batchId);
}
```

`captionsStillOwed` is false when the batch has no `stt` line (⇒ 20-16's behaviour, unchanged) or
when `captionStatus === "captioned"`. A FAILED burn keeps everything, exactly as a failed render
does — only "delete on success" was narrowed. The second caller is the caption terminal, after the
`renderStorageId` repoint.

**Mutation-checked:** replacing the condition with `if (true)` turns *"with captions OWED, the voice
takes SURVIVE the render"* RED. Observed red, then restored.

## Everything else worth not rediscovering

- **`windowStartS + t` is the plausible wrong answer.** It is right for block 1 and drifts for every
  block after it. The first test asserts `speechAbsS` identity directly.
- **A caption failure never unpublishes the reel.** `renderStatus` stays `"rendered"`,
  `renderStorageId` still points at the uncaptioned cut, `captionReason` records why.
- **Narration now crosses into the VM** as the escaped `.ass` track. That is what burning captions
  is. Everything else on the forbidden list still holds, and `reasonCodeFor` is now load-bearing in
  a new way: `subtitles=` echoes the track it choked on into stderr.
- **The `.ass` writer escapes `{`, `}`, `\`.** `.ass` treats braces as inline style overrides and
  the text is model-authored. Hostile fixture pinned.
- **The font is DejaVu Sans because that is what the image bakes.** A font named and absent does not
  fail — libass substitutes silently — so the writer, the bake script and a test all name it.
- **`burn_caps.sh` refuses three silent successes:** an ffmpeg without libass, an empty track, and a
  burn that changed the duration.
- **`resolveRenderAsset` now resolves a `plans` id too**, so the published reel reaches the runner
  through the same bearer-guarded blob route. A plan with no validated sidecar has no
  `renderStorageId` and is unreachable — governance holding by construction.
- **Two `storage.delete` sites now** (both in `render/renderReel.ts`), both failure arms asserted
  clean. Three audit sites. Both counts are pinned and were bumped deliberately.
- **`burnCapsScript.ts` needed the §5 prompt-scan exemption** on identical terms to
  `assembleScript.ts` — it is CODE, not a prompt, and a mutable registry row executing in a VM
  holding tenant media would be RCE. Anti-vacuity checks extended to both.

## Verification

| Check | Result |
|---|---|
| `packages/core` | **572/572** (27 new in `captions.test.ts`, 10 new caption-mode cases in `render.test.ts`) |
| `packages/backend` | **1107/1107** |
| Backend / core / web `tsc` | exit 0, **zero** non-test errors |
| `next build` | green |
| Biome | no new violation; the burn mirror's `noTemplateCurlyInString` matches the assemble mirror's |
| `check-playbooks.mjs` | exit 0 |
| Live | **NEVER RUN** |

⚠ **A full-suite run immediately before the green one reported 9 failures in `intake.test.ts`,
which passes in isolation and passed on re-run.** That file is untouched by this plan; the failures
carried `crypto.randomUUID` undefined and a 20 s timeout, i.e. worker-level flake. There is an
uncommitted `vitest.diag.mts` "TEMPORARY DIAGNOSTIC CONFIG — delete after the flake audit" in the
tree, so this is a known, pre-existing investigation and not 20-17's.

## What 20-11's live gate must establish

1. That `scribe-v2` accepts a `data:` URI at ~3 MB on the queue endpoint. **If it does not, the
   upgrade path above is the fix and the seam is one function.**
2. That its response really is `{ words: [{ text, start, end, type }] }`.
3. That the baked ffmpeg really carries libass (the script refuses loudly if not).
4. That the rebase lands words on the right shots in a video a human watches. Every timing
   assertion here is arithmetic against a fixture sidecar; none of it has been seen on screen.
