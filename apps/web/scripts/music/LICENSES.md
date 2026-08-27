# Music-bed licence attestations

**This file is the gate.** `bake-sandbox-snapshot.mjs` refuses to bake any audio file in this
directory whose filename does not appear below. It checks that a line exists — it cannot check
that the line is true. Every entry is a human attestation that the track is cleared for
commercial use in a hosted product with no attribution requirement.

Do not add a line for a track you have not verified yourself. An unverified line here is worse
than a missing one: the missing one stops the bake, and the unverified one ships.

## Format

One bullet per track: the exact filename, the licence, the source URL, and the date you verified
it. Keep the filename first — that is the substring the bake script looks for.

    - `calm.mp3` — CC0 1.0 Universal (public domain dedication). Source: <url>. Verified: YYYY-MM-DD by <who>.

## Tracks

_None yet._ The library is empty, which is a valid state: `--music` degrades to no bed and the
sidecar records `"music":"none"`. Add tracks per `README.md` and re-bake.
