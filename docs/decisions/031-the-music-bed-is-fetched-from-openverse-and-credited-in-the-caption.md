# ADR-031: The music bed is fetched from Openverse, and credited in the post caption

- **Status**: **Accepted** — 2026-09-04.
- **Supersedes**: the media playbook's *"It gets NO `mediaJobs` row, and that is load-bearing"*
  design for the bed (plan 20-14's baked-library music line). Not an ADR; recorded here because
  the reason it was load-bearing is the reason it is now replaced, and that must survive.
- **Does NOT supersede**: [ADR-012](012-media-route-and-the-reel.md), [ADR-019](019-the-scene-timeline.md),
  [ADR-030](030-grok-clips-carry-a-soundtrack-a-narrated-scene-takes-no-bed-from-its-clip.md).

## Context

The bed was designed as a $0 line resolved against a library baked into the sandbox snapshot from
`apps/web/scripts/music/`, behind a licence attestation in `LICENSES.md`. On 2026-09-04 the audit
found that directory holds the attestation file and a README and **no track** — every reel ever
rendered has been bedless by the assembler's WARN path. The owner asked for a public library
"like Pexels", with an API key if one is needed.

Probed rather than assumed: **Openverse** (`api.openverse.org/v1/audio/`) serves CC-licensed
music from Jamendo with no key — anonymous limits `20/min`, `200/day` read off its response
headers — returns a direct `audio/mpeg` download URL, a duration, and **the licence's own
attribution string**. Its `license_type=commercial` filter is a real gate: CC BY-NC tracks are
not returned at all. Jamendo direct needs a free client id for the same catalogue.

The one fact that shaped the design: **what survives that filter is CC BY, not CC0.** Pexels asks
no credit. CC BY requires one. A track without its credit line is not free — it is a breach.

## Decision

**The bed is a stock row.** `reserveSceneJobInner` writes, for a deck whose art direction names a
mood, one `mediaJobs` row: `provider: "stock"`, `kind: "audio"`, `model: "openverse/v1"`,
`spec: {kind: "stock", media: "audio", seconds: <reel>}`, `estUsd: 0`, at `MUSIC_BLOCK_INDEX` (−2,
beside captions at −1, outside every scene). The invoice's $0 `music` line is unchanged; this row
is the mechanism that fetches what that line names. `submitBatch` fetches it FIRST, so it has
landed before the paid lines do.

**It is optional, by construction.** `batchToRender` ships the bed as the `music.mp3` input with
`musicFile` set only when its row has landed; a failed, missing or still-landing bed is a bedless
reel through the assembler's existing WARN path — never a refusal, never a stall. This is the
property the old "no row" rule bought, kept without the rule.

**Instrumental only.** The search is `<mood> instrumental`. A vocal track under narration is two
voices — the defect ADR-030 removed for generated clips, not to be reintroduced by the bed.

**The credit goes in the post caption.** The owner's choice, over an end card. The Openverse
`attribution` string lands on the plan as `musicCredit` when the row lands, is written into the
reel's vault document as a `Music:` line, and is shown beside the finished reel on the canvas as a
copy-ready credit. It is never hidden and never abbreviated.

**No key.** Openverse anonymous access is sufficient at one bed per reel; a Jamendo client id is
the upgrade path if search quality or limits ever bind, and it slots in as a second `fetchStock*`
with the same row shape.

## Consequences

- Reels have music from the next generate, at $0, from a library that can be searched by mood.
- The owner must paste the credit line into the post caption. The product makes that the easiest
  thing on the screen; it cannot make it automatic, because it does not post.
- The baked library and `LICENSES.md` remain valid for a hand-curated track — the assembler still
  probes them when no fetched track is present — but nothing depends on them.
- `mediaJobs.kind` gained `audio` (widen-only). `plans.musicCredit` is new and optional.
- Verified on the first rendered reel's own assets: a real Openverse track through the shipped
  assembler — `music bed: upbeat -> 15s at I=-33`, `mix 3 take(s) + 0 diegetic bed(s) +
  music:upbeat`, decode-validated.

**To reverse it:** delete the `audio` line in `reserveSceneJobInner` and the bed branch in
`batchToRender`; the assembler falls back to the library lookup untouched.
