# The music-bed library

Four short instrumental tracks, one per mood slug, baked into the render sandbox snapshot beside
ffmpeg and the caption font. `assemble_final.sh --music <slug>` looks a track up here by slug and
lays it under the narration at a pinned level.

## The slugs are a closed set

`MUSIC_MOODS` in `packages/core/src/storyboard.ts` is the vocabulary the specialist may ask for:

    calm    warm    upbeat    cinematic

One slug is one file: `<slug>.mp3` (`.m4a`, `.ogg`, `.wav` and `.flac` are also accepted — the
slug is the contract, not the container). Adding a fifth mood means adding it to `MUSIC_MOODS`,
adding a vouched track here, and re-baking. Until all three are done the mood parses, prices at
$0 and renders **without** a bed — recorded in the assembly sidecar as `"music":"none"`, never
silently.

## Adding a track — the licence line is the gate

`bake-sandbox-snapshot.mjs` **refuses to bake a track whose filename does not appear in
`LICENSES.md`.** That is deliberate and it is the only thing standing between this directory and
an unlicensed track in a commercial product. It is a filename check, not a licence check — it
cannot tell you the licence is real, only that a human wrote one down.

1. Source a track you are certain is CC0 / public domain, or otherwise cleared for commercial use
   with no attribution requirement. Genuinely-CC0 routes: **Free Music Archive** (the `HoliznaCC0`
   catalogue is explicitly CC0), **free-stock-music.com** filtered to `CC0 Universal 1.0`, and
   **itch.io** CC0 music packs.

   **Pixabay is NOT CC0.** It moved to its own Pixabay Content License in 2019; tracks there may
   be *tagged* `cc0` by uploaders but the site licence governs. Read it before relying on it.

2. Save it here as `<slug>.mp3`. Keep it instrumental, loopable, and 60 s or longer (shorter is
   fine — the assembler loops it — but a short loop is audible).

3. Add its line to `LICENSES.md`. **You are attesting to this, not the tooling.**

4. Re-bake and record the new snapshot id:

       pnpm --filter @pikar/web bake:sandbox
       cd apps/web && npx vercel env add MEDIA_SANDBOX_SNAPSHOT_ID

5. **Re-bake BEFORE re-seeding the skill.** The specialist only writes a `Music:` line once
   `media-director` is re-seeded; if the deployed snapshot has no library yet, every deck that
   asks for a bed renders without one. Nothing breaks and nothing is charged — but the reels are
   quietly bedless until the snapshot catches up, so do it in this order.

## Why the tracks live in git rather than behind a URL

The risk this library carries is provenance, not bytes. Committed files make the licence
attestation auditable in the same history as the code that plays them, and remove the mode where
a pinned URL serves different bytes on a later bake. It costs a few MB in a repo that otherwise
has no binaries; that is the trade, made deliberately.
