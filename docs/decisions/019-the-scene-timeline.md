# ADR-019: The scene timeline supersedes the uniform block deck

Status: Accepted — 2026-08-14

Supersedes row 3 of ADR-012's Decision 1 (D8) — *"`storyboard` → N fixed-length blocks"* — and the
fixed-window guarantees built on it. The rest of the D8 spine (the reel is the deliverable, the
stage order, the whole-job reservation, no time-stretch ever, the `assembly.json` sidecar as proof
of a governed render) is preserved and re-expressed, not replaced.

## Context

D8's reel was `N × clipSeconds` long: every block the same length, every narration line mixed
inside its own window, and the total whatever the arithmetic happened to produce. Three things made
that untenable.

**The length was an accident.** No stage anywhere named a target duration, so a reel could not be
asked for at 15, 30 or 60 seconds — the lengths every distribution surface actually wants.

**The narration band was near-impossible.** A 4-second window with `SPEECH_SLACK_S = 1.4` forces
every line into 31–56 characters and 2.6–4.0 s of measured speech, enforced twice. Natural
narration does not fit a 56-character cell.

**The specialist was taught to write decks the money gate refuses.** `media-director` emits
`SCREEN REC` and `TEXT` blocks; `PAID["SCREEN REC"] = false`, so `reserveJobInner` refused the whole
deck as `unrenderable_block`. The reel was unreachable in production, and the proposal stage is free
— so the user only discovered it at the Generate button.

**And the provider grid is real.** Sora 2 returns 4, 8 or 12 second clips. Measured against the
shipped price tables during this phase:

- **15 s and 30 s cannot be composed from generated video at all.** Every supported clip length is a
  multiple of 4, so no sum of them is 15 or 30.
- **60 s can be composed and costs $6.00**, over the $3.50 whole-job cap (D10).

**Not one target duration is reachable with generated video alone.** The cheap scene kinds are not a
fallback or an optimisation; without them the contract has no legal reel.

## Decision

**A reel is a list of SCENES with their own durations, summing exactly to a declared target.**

- `TARGET_DURATIONS = [15, 30, 60]`, declared in the deck header, stored on the plan row, carried to
  the assembler as `--target-seconds`, and asserted on the output at ±0.5 s. A deck that does not
  sum to its declared target is refused as `illegal_duration` **before a cent moves**.
- Four visual kinds, priced by one table in `packages/cost/src/media.ts` (`SCENE_VISUAL_LINE` /
  `sceneVisualSpec`), read by both the reservation and the estimate the canvas prints:

  | Kind | Buys | USD at 4 s | Duration freedom |
  |---|---|---|---|
  | `generated_video` | one `sora-2` clip | $0.40 | 4 / 8 / 12 s only |
  | `animated_image` | one `gpt-image-2` still, panned by ffmpeg | $0.01 | any |
  | `uploaded_video` | nothing — a tenant vault asset | $0 | any |
  | `text_card` | nothing — `drawtext` in the sandbox | $0 | any |

  A free kind has **no provider line at all**, not a zero-dollar one. A still costs the same at 12 s
  as at 2 s, which is what makes an exact target reachable: the §2.3 worked 30-second reel (3 clips
  + 4 stills + 1 card) costs **$1.24** in pictures, against $2.80 for the nearest composable
  all-generated reel — which is 28 seconds, not 30.
- **Narration moves to one master audio timeline.** Takes are level-matched individually, placed at
  their scene's absolute `startMs`, mixed once, then linear-loudnormed at −16 LUFS over the whole
  reel. A line may run past its scene boundary; narration is written for the reel, not for a cell.
  The per-window band is deleted and replaced by two timeline errors (speech past the reel's end,
  speech into the next line).
- **Narration is optional per scene, and the assert is re-expressed rather than relaxed.** The
  "narration in every window" gate keys off *declared* narration, so a deliberately silent card
  passes and a scene that declares a line and carries none still fails.
- **The sidecar is v2 and the old shape is refused by name** (`legacy_sidecar`). A validator that
  accepts two shapes proves neither.
- **`uploaded_video` bytes come from the vault only.** `Scene.asset` is `{ source: "vault"; docId }`
  and there is no other variant to parse, price or render. A direct canvas upload would be a new
  `source` member plus its own ingest surface — additive, and a decision rather than a patch.

## Consequences

`mixed_durations` is gone as a refusal — disagreeing durations are the point. The exact-length
tolerance tightens from 1.0 s to 0.5 s, because every duration is now ours to choose. Captions group
by **take** rather than by scene, since a line can span a boundary.

Every published reel was checked before the sidecar shape changed: **257 `plans` rows in production,
zero with a `sidecarStorageId`.** No reel is orphaned by the hard rejection, so there is no migration
and no dual-shape tolerance.

`asset.docId` is model-authored text on `plans.shots`, so the tenant check lives on the row at
render time and `resolveRenderAsset` is narrowed to `video/*` — serving any vault document by id is
a far larger capability than a render needs.

The pricing tables stay hand-maintained against the manual reconciliation procedure in
`docs/playbooks/media.md`; the per-kind economics above are **derived** from them and re-computed
from the live tables by `packages/cost/src/media.test.ts`, so this ADR's arithmetic cannot rot
silently while a price row moves.

One thing this ADR does **not** yet deliver: the `media-director` skill body still teaches the block
contract. Under CLAUDE.md §5 a body is a versioned registry row, so replacing it costs a candidate
seed, a paid eval gate and a blocking owner activation — paid exactly once, on this contract, rather
than twice on a body with a two-week life. Until that lands, `cockpit.executePlan` refuses a scene
deck by name (`scene_render_not_ready`) rather than mispricing one.
