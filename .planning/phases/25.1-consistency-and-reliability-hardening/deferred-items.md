# Deferred items — phase 25.1

Out-of-scope discoveries logged during execution. Nothing here was fixed.

## 1. `isolation.test.ts` owner-gate fixture missing for `skills.activateAgentCandidate` (RED on this branch)

Found during 25.1-03's full backend sweep. `convex/isolation.test.ts` fails:

    skills.activateAgentCandidate rejects a non-owner with OWNER_REQUIRED
    expected [Function] to throw error matching /OWNER_REQUIRED/
    but got 'Validator error: Missing required field `candidateId` in object'

The endpoint (23-05) takes a required `candidateId` and has no entry in `OWNER_ARGS`, so the
non-owner call dies on the validator before the owner check runs — **the owner gate on that
endpoint is currently unproven.**

**The guard that should have caught this is vacuous by construction.** `REQUIRES_ARGS` is derived
from `Object.keys(OWNER_ARGS)`, so the test "every owner endpoint with required args has a fixture"
can only ever flag an endpoint that already has a fixture. The honest fix reads each function's
validator for required fields rather than reusing the fixture map as its own oracle.

Owning lane: skills / owner-plane (23-05), not media. Two pieces of work: add the fixture
(`{ candidateId: "id:tenantSkills" }` — the sentinel already resolves), and de-vacuify `REQUIRES_ARGS`.

## 2. `plans.resetPlan` still does not clear the whole media plane

25.1-03 added `reelVaultDocId` (D7). Still surviving a reset, all optional media-plane fields
written by the pipeline: `renderRunId`, `renderSummary`, `captionStatus`, `captionReason`,
`captionOffsetsS`, `renderRetriedAt`, `deckLockedAt`, `altShots`, `altTargetDurationSeconds`,
`brief`, `deckAdjustments`, `lostVariation`, `refusedBody`, `shotsChangedAt`, `deckProposedAt`.

`schema.ts` claims "resetPlan wipes every field below" over this block — that comment is FALSE
today. None of the survivors is currently harmful: every new reel purchase runs `clearRender`
(which resets the caption plane and the retry clock), and the retrier terminals re-check
`renderStatus` before acting, so a stale run id no-ops. Left alone deliberately rather than swept
into a media-vault plan; the fix is a clear-set audit against the schema block, with a test per
field like the `DECK_AND_RENDER` list.

## 3. `mediaCanvasView.ts` has no copy for the newer reason codes

Carried forward from 25.1-01 and 25.1-02: `render_crashed`, `render_canceled`,
`route_bad_response`, `watchdog_render_timeout`, `watchdog_caption_timeout`,
`watchdog_submit_timeout` all render through the generic failure clause plus the raw `detailCode`.
Honest, but wordless. Cosmetic follow-up.
