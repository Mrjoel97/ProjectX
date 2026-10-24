# Standard Seedance default and native-audio demonstration — 2026-10-24

The owner explicitly chose standard Seedance2.0 over cheaper variants, then asked how its built-in
audio and generated visuals could reduce the existing separate-audio/free-asset workflow.
This continuation changes the source default and demonstrates one native-audio provider clip.
It does not claim that production native-audio orchestration or generated-only films are finished.

## Source default migration

New video reservations select exact `bytedance/seedance-2.0`,720p,4seconds. Neither Mini nor Fast
is a fallback. The supported generated grid is4–15seconds; narration repair cannot donate a
clip below four seconds. Historical Grok jobs remain priceable and keep their stored model.
The workspace names Seedance2.0 and shows the correct grid. Canonical director v8 and its derived
mirror carry that grid and current reservation guidance; no registry row was seeded or activated.
The unactivated v7 editorial candidate is aligned with those runtime limits, not promoted.

At720×1280/24fps, the published $0.000007 per video token is nominally $0.1512/second, with or
without audio. Source admission reserves one extra second per generated clip as conservative
policy headroom: a4sclip reserves $0.756. This is not a guaranteed provider invoice ceiling.
Only reviewed720p is priced; other standard tiers refuse. Whole-job $3.50,12generatedseconds,
tenant/deployment limits, approval hashes and unknown-outcome behavior remain unchanged.
[ADR-064](../../../docs/decisions/064-standard-seedance-quality-default.md) records this explicit
exception to the earlier refusal of output-token billing and the limits of the policy estimate.

## Actual one-call native-audio demonstration

The reviewed manifest is
`11f84058fa32d085a5dd47365e4558ce29001ae1e7b623de78b8e91205bb2850`.
One standard4s720p9:16 request uses `generate_audio:true`, a fictional matte black bottle on
dark stone, a slow camera push and a requested short English line with subtle instrumental sound.
No external product image, free-stock asset, TTS, stock music, transcription or caption request
was made. The same $5 allowance and memory-only staging key were used. Append-before-submit,
exact current catalogue rate checks,1USD policy admission, single-use execution and zero retries
were retained; the previous comparison was not replayed.

- Reported provider cost: **$0.6111**; ready/download time **147.652s**.
- H.264 video:720×1280,97frames,4.041667s. AAC stereo audio:32kHz,4.064s.
- Full error-sensitive decode passed, exit0. Audio is non-silent: mean−17.9dB, peak−3.1dB.
  These measurements do not certify exact words, music quality, listening comfort or lip-sync.
- Four sampled frames show a grounded black bottle and coherent silhouette/material under a
  restrained push-in. This is one fictional, unbranded shot, not cross-shot product consistency.
- Original MP4 SHA256:
  `57f364d093c0c2ba074db15451f0e9e242db845c890c0e12cc2b9422cbed180d`.
- Local original:
  `.tmp/phase53-seedance-standard-native-20261024/delivered/seedance-standard-native-0.mp4`.

Total reported shared testing spend is **$2.1749868**,26attempts,zero unresolved billing attempts.
The prior failed STT output remains unchanged and no new STT purchase was made. The native clip
demonstrates one audio-bearing provider result; listening and exact requested-script fidelity
remain open. It took longer than the earlier, differently prompted short samples, so fewer
generation calls are not represented as faster elapsed production.

## Which steps can be removed

| Step | Existing production path | Native-audio target |
| --- | --- | --- |
| Script and storyboard | Agent proposes reviewed scenes | Retained; include speech and sound intent |
| Picture | Generate clips and fetch/add other visuals | Generate the selected scenes; no stock fallback in an explicit generated-only mode |
| Voice | Separate TTS requests | Included in each Seedance clip |
| Music and scene sound | Separate library/stock bed and mixing | Included in native output when acceptable |
| Assembly | Normalise pictures, place voice, mix bed, validate | Join clips while preserving native audio timing; validate full output |
| Captions | Transcribe separate voice and burn checked cues | Optional timing/alignment from actual native audio, then checked cues |
| Review/delivery | Exact cost/content approval and workspace artifact | Retained |

This pilot reduced picture+speech+sound acquisition to **one generation call** for one clip.
A30/45/60sfilm still needs several4–15sclips and final assembly. Consistent voice/product
identity across those clips and the full-film cost/time need separate evidence. The current
12-generated-second and $3.50 job policies do not admit those all-generated films automatically.

## Production native-audio integration still required

The new typed `generateAudio` wire flag is explicit and standard-only; absent/false retains
separate voice behavior. Current production does not persist a native mode or set true by default.
Enabling true alone would pay for discarded audio: `batchToRender` requires TTS for narrated
scenes, and the assembler drops clip audio under TTS or treats it as a0.12-gain background bed.

A governed native path must bind its mode and full audio-bearing prompt into the reviewed plan
and reserved job, skip TTS/music purchases, preserve native sound from scene start without voice
recentering, and update assembly proof. Captions currently require same-batch TTS WAV/prompt
hashes; native captions need trusted extraction and actual-audio ownership/alignment instead.
Mixed music/speech recognition may refuse; it must not silently create incorrect checked captions.
Historical rows must keep their separate-audio meaning. No mode/schema/renderer/caption bypass
is introduced in this default-model change.

## Verification

Focused checks passed45provider-contract,62cost,161storyboard,137workspace,294backend-media and
16operator tests. Whole-tree lint and exact-head hosted CI are recorded on PR83 after completion.
The unchanged golden46case and vertical40case corpora retain their historical receipts. Current
golden source revision is
`2026-09-11.budgeted-evaluator.219834047fb7b7dc9b7b63857c0e90ecc4536d35f7a2988a46837e91cc6f5c61`.
Graphify remains unavailable; canonical graph fixup ran with0changes and75tables. Phase53 remains
partial,0/3, and the primary phase order is unchanged. No deployment, registry activation,
main merge or publication occurred.
