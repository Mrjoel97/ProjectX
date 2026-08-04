# ADR-014: Standalone images are a first-class `media` deliverable behind the existing human spend gate

- **Status**: Accepted (2026-08-04)
- **Recorded**: 2026-08-04
- **Supersedes in part**: [ADR-012](012-media-route-and-the-reel.md), only where it says the finished
  reel is the sole media deliverable. The reel spine, specialist containment, whole-job reservation,
  budget windows, callback authentication, storage rules, moderation wording and retention decisions
  remain accepted.
- **Relates to**: [ADR-011](011-media-provider-fal-wan25.md) (fal and pinned pricing),
  [ADR-013](013-the-render-worker.md) (reel rendering, which standalone images do not enter)

## Context

The application already priced image specs, constructed the fal FLUX request body, accepted image
callback payloads, downloaded their bytes into Convex storage, validated their content type, recorded
moderation verdicts and minted tenant-guarded signed URLs. None of that plumbing was reachable from a
plan or from the workspace. Users could request rules and reels, but not a still image.

Creating another provider adapter or another budget rail would duplicate the highest-risk parts of
the media subsystem. The missing product is smaller: a standalone plan shape, one reservation entry
point and an output card.

## Decision

A still image is `plans.kind === "media"` with `mediaMode === "image"` and one reviewed
`imagePrompt`. Missing `mediaMode` continues to mean the original reel path, so existing rows need no
migration and the reel UI and execution arm stay unchanged.

The executive agent may call `proposeImage`. That tool stages content only. It cannot reserve, submit,
poll, download or publish anything. The workspace displays the prompt and the exact estimate; only a
human click on **Generate image** calls the paid mutation.

Generation is a one-line media batch using the pinned `MEDIA_DEFAULT_IMAGE` spec:

| Field | Value |
|---|---|
| model | `fal-ai/flux/schnell` |
| size | 1080 × 1920 |
| count | 1 |

That line goes through the same serializable reservation helper as a reel: both kill switches, the
per-job cap, tenant daily media window and keyless deployment media window are checked before both
windows are consumed and before the row is inserted. The estimate constructs the same spec. A second
click sees the existing image row inside the mutation and cannot reserve twice.

`submitBatch` reads standalone image text only from `plans.imagePrompt`; the job row retains only its
hash. The existing fal webhook then authenticates, downloads and stores the bytes, validates the
image, reconciles cost and records one of the existing honest verdicts. No fal asset URL is persisted
or returned to the browser. The output card uses the tenant-guarded storage URL and a native `<img>`.

A standalone image does not create voice, transcript or render lines and never enters the sandbox.
It also does not use `cockpit.executePlan`: the canvas button is the explicit human gate.

## Consequences

- Images and reels share one operational media rail and one set of operator switches.
- The agent can author a prompt but cannot spend. Human review remains structural, not prompt policy.
- Existing reel plans are byte-compatible because absent `mediaMode` retains reel semantics.
- One conversation can own one image attempt. A second image starts in a new conversation, matching
  ADR-012's one-reel-per-conversation ceiling and avoiding ambiguous callback/history ownership.
- FLUX pricing remains MEDIUM confidence until the first invoice-backed reconciliation recorded in
  the media playbook. The UI shows the modelled estimate; it does not imply invoice confirmation.

## Alternatives rejected

- **A new `/images` subsystem or budget window.** Rejected: it duplicates reservation, callback,
  storage, moderation and isolation logic already built for image rows.
- **Generate inside `proposeImage`.** Rejected: it gives model output a paid side effect and breaks
  ADR-012's structural human gate.
- **Treat an image as a one-block reel.** Rejected: it would reserve voice, captions and sandbox
  compute and would promise an mp4 rather than the requested artifact.
- **Store the fal result URL on the plan.** Rejected: provider URLs are bearer capabilities and the
  existing callback deliberately converts them to owned storage before any read surface sees them.
