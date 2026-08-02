# 20-09 — SUMMARY

**Plan:** the canvas's backend plane — what it reads, what it can spend, and what it can edit for
free, with the isolation assertion that ships alongside the surface.

**Status: implementation complete and test-green** (shipped in the Phase-20 wave-9 commits;
verified and summarised 2026-08-03). **Cost: $0** — every query in this plan is a query and cannot
consume.

> ⚠ **This summary was written after the fact, from the committed code and a test run.** The work
> shipped and its SUMMARY was never written, so the phase read as 14/19 when it was 15/19. Nothing
> below is carried from the plan text; every claim was read off `media.ts` or the passing tests.
> The same gap existed for 20-16 and was closed the same way.

## The eight truths, and where each is enforced

| Truth | Where |
|---|---|
| The itemised estimate is readable BEFORE anything is spent | `jobEstimate` — four `EstimateLine`s, `totalCents`, `capCents`, `remainingCents`, `refusal` |
| A human click generates the reel or one block through the identical reserve-then-submit path | `generateReel` / `regenerateBlock`, both `tenantMutation` |
| Each block reports TWO independent states plus its narration and character count | `byPlan` → `{ clip: faceOf(video), voice: faceOf(tts), narrationChars, maxChars, overCharLimit }` |
| A reel is readable only when its sidecar validated | `reel` returns a url ONLY when `renderStatus === "rendered"` **and** both storage ids **and** `renderSummary` are set |
| Regenerating a block CLEARS the render | `clearRender` — **one helper, six callers** |
| Prompt / narration edits, reorder and delete cost nothing | `editBlockPrompt`, `editBlockNarration`, `reorderBlocks`, `deleteBlock` — all mutations, no reservation |
| Another tenant gets empty reads and cannot spend or edit | `ownedPlan` / `ownedPlanOrThrow`; BETA-05 isolation test |
| A signed asset URL is minted only inside a tenant-guarded query, never logged | `assetUrls` is the ONLY `storage.getUrl` on this plane |

## The decisions worth not rediscovering

- **`jobEstimate` ITEMISES because one total is not enough.** D7 requires the estimate before the
  button; the re-scope made the purchase four cost lines (clips, voice, captions, render) rather
  than "N clips", and **the user has to see WHICH line is expensive before deciding to cut a
  block.** It builds the SAME spec list `reserveJobInner` builds from the SAME price table, and
  `media.test.ts` asserts the two numbers are equal for the same deck — the canvas and the rail
  cannot drift.
- **`jobEstimate` re-applies `reserveJobInner`'s pre-flight refusals in the same order**, so the
  canvas can name the lever BEFORE the button is pressed instead of after the money moves.
- **`clearRender` is one helper with six callers, deliberately.** Six copies of a four-field unset
  is exactly how one ends up missing a field, and the guarantee — a canvas can never show a stale
  `final.mp4` beside a block that has since changed — is the kind of lie a user only discovers by
  watching the whole reel.
- **`faceOf` carries no URL by construction.** `assetUrls` is the only read that mints a bearer
  capability, which is what keeps the "signed URL only inside a tenantQuery" scan meaningful.
- **`mediaRemainingCentsInner` exists because a Convex query cannot `runQuery`.** The
  `reserveJobInner` / `reserveJob` split has the same cause; `guardrails.ts` carries the plain
  function face so `jobEstimate` can show today's remaining budget beside the estimate.
- **`byPlan` reads each job's OWN `blockIndex`, never the array position.** That is what survives a
  reorder.

## Verification

| Check | Result |
|---|---|
| `media.test.ts` canvas + isolation cases | **10/10** (BETA-05: every read empty for the wrong tenant; no cross-tenant spend or edit) |
| `packages/backend` full suite | 1107/1107 (2026-08-03) |
| Live | The plane has been exercised only by tests. Its CONSUMER shipped at 20-10. |

## What this plan did NOT include

**No UI.** The read plane had no consumer for four plans — 20-10 is the canvas that finally reads
it. If you are looking for why these queries existed with nothing calling them, that is the reason.
