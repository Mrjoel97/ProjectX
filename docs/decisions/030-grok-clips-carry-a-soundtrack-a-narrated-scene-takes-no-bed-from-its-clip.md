# ADR-030: Grok clips carry a soundtrack — a narrated scene takes no bed from its clip

- **Status**: **Accepted** — 2026-09-04.
- **Supersedes**: [ADR-027](027-grok-imagine-video-succeeds-sora-2-on-openrouter.md) **in one
  claim only** — that `x-ai/grok-imagine-video` has *"no native audio"* and that this *"suits this
  pipeline rather than costing it."* ADR-027's choice of model, its price rows and its wire facts
  all STAND. Only the audio row of its comparison table, and the sentence built on it, are wrong.
- **Does NOT supersede**: [ADR-012](012-media-route-and-the-reel.md)'s master-audio-timeline
  design, or [ADR-028](028-the-voice-plane-moves-to-a-chat-audio-model-on-openrouter.md).

## Context

The first reel this product ever rendered end to end (2026-09-04, plan `mh74cdsv…`) opened on a
7-second Grok clip of a presenter **speaking to camera**. The clip arrived with a stereo AAC track —
`mean_volume −11.4 dB, max_volume 0.0 dB` — louder than the narration take laid over it
(`−19.4 dB` mean). `assemble_final.sh` did what it was designed to do with a clip's own audio: it
lifted it as a *diegetic bed* and mixed it at `SFXVOL=0.12` under the narration. The owner heard
two voices at once and asked whether the system could detect a clip's voice and skip the
narration instead.

ADR-027 had recorded, from the catalogue rather than from a clip, that Grok produced no audio. The
`media.ts` submit comment repeated it. Both were written before any clip had been listened to.

## Decision

**A scene the deck narrates takes NO bed from its clip. A silent scene keeps its clip's sound.**
In `assemble_final.sh` the diegetic extraction is gated on the scene having no voice take:

```
if [[ "$KIND" == "video" && ! -f "$voice" ]]; then   # was: if [[ "$KIND" == "video" ]]
```

Nothing else in the mix changes. The bed path, its gain and its placement survive for the case it
was built for — ambience under a scene nobody speaks over.

**The narration stays. The clip's speech goes.** The owner's proposal — detect a voice in the clip
and skip the take — is declined, and the reasoning is the decision:

- The narration is the user's SCRIPT, reviewed on the canvas before a cent moved. A clip's speech
  is whatever the video model improvised from a picture prompt; nobody has read it, and it is not
  what the owner approved. Keeping the improvised voice and dropping the approved one inverts the
  provenance rule this repo holds everywhere else.
- Speech detection is a judgement over audio — music with vocals, a crowd, a radio in shot all
  read as "voice" — and a wrong answer silently swaps the reel's words. The file-existence gate is
  a fact, costs nothing, and cannot be fooled.
- The take costs a fraction of a cent. There is no spend worth saving.

**`generate_audio` is still not sent.** Whether the OpenRouter video route accepts an audio-off
flag for Grok is UNKNOWN: `/models/x-ai/grok-imagine-video/endpoints` lists chat parameters only —
the same catalogue-is-not-the-API lesson ADR-029 recorded — and the only way to learn it is a paid
request. Not sending the flag costs nothing now that the assembler drops the audio, so the probe
is deferred rather than spent.

## Consequences

- A narrated Grok scene now sounds like the owner's script and nothing else. A silent Grok scene
  keeps its soundtrack, which for a talking-head clip is the presenter — the specialist can choose
  that deliberately by leaving the `Narration` cell empty.
- ADR-027's comparison table is wrong in its "Native audio" row (Grok: **yes**, not *none*). The
  cost comparison it drew from that row still holds — Grok is not billed per audio, the price rows
  are per generated second.
- The prompt side is a separate lever, not taken here: a `generated_video` prompt that does not
  say *no speech, no talking to camera* leaves it to the model. That belongs to the skill body (§5)
  and to the model-upgrade phase the owner has prioritised, with its eval gate — not to a hotfix.

## Provenance of this decision

Made 2026-09-04 by the repo owner reviewing the first rendered reel, on the arithmetic above. The
fix was verified by re-assembling the same five landed assets: the mix line reports
`3 take(s) + 0 diegetic bed(s)` where it had reported one, and the reel decode-validates at
15.100000s. **To reverse it:** remove `&& ! -f "$voice"` from the gate and regenerate
`assembleScript.ts`; the drift test will tell you if you forgot the second half.
