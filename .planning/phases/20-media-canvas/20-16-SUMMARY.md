# 20-16 — SUMMARY

**Plan:** the assemble stage as an orchestration — the moment every clip and voice take of a reel
has landed, render them into ONE mp4, publish only on a valid sidecar, and delete the intermediates.

**Status: implementation complete and test-green, NOT live-verified** (2026-08-02). **Cost: $0** —
no sandbox has ever been created.

> ⚠ **This summary was written after the fact, from the committed code and a test run**, not by the
> executor that wrote the plan. The work sat uncommitted in the working tree with no SUMMARY; it was
> verified and landed in `63263cb` (together with 20-15, which was in the same uncommitted pile).
> Every claim below was read off the source or the test output — none is carried from the plan text.

## The five must-have truths, and where each is enforced

| Truth | Where |
|---|---|
| The last landing starts the render — no poller, no ticker, no wait loop | `mediaComplete.maybeStartRender` (`mediaComplete.ts:180`), called from `landResult` |
| A reel publishes only when its sidecar validates | `renderReel.ts:359` re-parses with `parseAssemblySidecar`; the success arm writes both storage ids **and** `renderSummary` in ONE patch |
| Delete intermediates on success, KEEP them on failure | `recordRender` (`renderReel.ts:241-259` success loop; `:191` failure arm returns before it) |
| A batch with a failed or blocked line never renders | `maybeStartRender:197` — `every(succeeded)`, else it records a reason |
| A failed render dead-letters refs and counts only | `renderReel.ts:182` — `{ batchId, planId, reasonCode }`, never ffmpeg output |

## The design decision this plan made, and it is a refusal

Delta §6.7 N4 described a post-approve **chain** (reserve → submit → wait-for-all-landed → render),
and 20-07 left a hand-off to re-point `EXTERNAL_TARGETS.media` at a chain entry action.
**20-16 evaluated that and declined it** — the note is recorded at the hand-off site in
`cockpit.ts`, so the next reader finds the decision where they would go looking for the chain.

`landResult` already runs on every arrival, already holds the batch id, and already runs inside a
serializable mutation. So "wait for all" is four lines there, and the `pending → rendering`
transition IS the once-only guard: two concurrent last-landings cannot both observe `pending`, so
they cannot both schedule a render — **and a double render is a double sandbox.**

## Two orderings that are load-bearing

1. **Publish, then delete** (`renderReel.ts:231-234`). A crash between them leaves orphaned blobs —
   ~35 MB of waste. The reverse order leaves a published reel pointing at deleted blobs — a broken
   canvas. *Fail toward waste, not toward a lie.*
2. **Both env reads before any fetch exists** (`renderReel.ts:285-286`), with the offline fixture
   seam AFTER them, so "no secret" is the same refusal in fixture mode as in production.
   `media.test.ts` asserts a fetch-call-count of **zero**, not merely that the message was right.

## Details worth not rediscovering

- **`storage.delete` throws on an already-deleted id**, so a blob referenced by two rows would abort
  the cleanup loop *after* the reel was published, leaving the rest of the batch undeleted forever.
  The `deleted` Set is one line and removes the whole class.
- **`renderSummary` exists because a Convex query cannot read a blob** — `ctx.storage` in a query is
  a `StorageReader` with `getUrl` and nothing else. Parsing once at the terminal also beats parsing
  once per canvas subscription tick.
- **A failed render does NOT retry.** At 480p a structural failure repeats, and the action-retrier
  would buy N sandboxes to learn the same thing N times.
- **`stt` is deliberately NOT in the renderable set** (`mediaComplete.ts:190-192`). Captions are a
  post-assembly step (D8, plan 20-17), so a pending STT line must never hold the reel hostage.
- **Retention is the loop, not a cron.** ~55 MB/job × 2 jobs/day = ~3.3 GB/month against a Convex
  Free/Starter allowance of 1 GB total. The `ponytail:` note names the upgrade path (a scheduled
  sweep of old `mediaJobs`) and says it is deliberately not one today.

## Verification

| Check | Result |
|---|---|
| `media.test.ts` + `llmRedaction.test.ts` | **193/193 green** (136 in `media.test.ts`) |
| `packages/core` full suite | **536/536** |
| `apps/web` `tsc --noEmit` / `next build` | exit 0 / green |
| Live render | **NEVER RUN.** Needs `MEDIA_RENDER_SECRET` + `MEDIA_RENDER_URL` and a real sandbox |

The one stderr line in the test output (`Media env not configured: MEDIA_RENDER_SECRET`) is the
negative test proving the refusal fires before any fetch — it is expected output, not a failure.
