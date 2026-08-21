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

**UPDATE 2026-08-21 — part 1 CLOSED, part 2 still OPEN (commit `d143951`).** The fixture was added
(`"skills.activateAgentCandidate": { candidateId: "id:tenantSkills" }`), `isolation.test.ts` is 32/32,
and the endpoint **does** refuse a non-owner — the gate was unproven, not broken. Part 2 below stands.

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

## 4. `llmRedaction.test.ts`'s dispatch scan cannot see a URL leak

Found during 25.1-05 by mutation B5. Adding `sourceUrls: turn.sources.map(s => s.url)` to
`dispatch.ts`'s `subagent.completed` audit payload leaves `llmRedaction.test.ts` **fully green** —
that scan bans the identifiers `reply|body|text|output` by NAME (`/\b(reply|body|text|output)\b/`)
and knows nothing about a URL, a title, an address or any other content that happens to be called
something else. The leak was caught only by `dispatch.test.ts`'s RUNTIME scan, which walks every
audit row of a real research run for the literal URLs.

Not fixed here: `dispatch.ts` IS covered by that runtime scan, so nothing is currently exposed on
this path. The gap is that the STATIC pin reads as broader protection than it gives, and the modules
whose payloads have no runtime scan inherit that false comfort. The honest fix is a value-shaped
rule (an `http`/URL-literal scan over payload sources, the `media` payload scan at :1412 already does
this) rather than a longer identifier list — an identifier blacklist can only ban names someone
already thought of. Owning lane: governance/§4, not media.

## 5. `pollWanTask` is unreachable — the "pre-cutover tasks" retention has silently expired

Found during 25.1-06 while verifying the fal-removal premise. `media.pollWanTask` (`media.ts:1226`)
is scheduled from **exactly two places, both inside itself**: its own transient-error retry
(`:1241`, `:1277`), capped at 60 attempts ≈ 10 minutes. No submit path enqueues it —
`submitBatch` schedules `pollOpenAiVideoTask` (`:1546`). Its reachability therefore depended entirely
on Convex's scheduler queue at the moment of the ADR-017 cutover (2026-08-13), and that queue drained
within minutes. **`wanBaseUrl`, `WAN_API_BASE_URL` and `Video_and_image_API_Key` are dead in exactly
the sense the fal callback route was.**

**Deliberately NOT removed.** The plan named the poller as the thing not to break, and unlike the fal
route it is an `internalAction` with no HTTP surface and no external caller — a dead code question,
not a security one. Both env names are now CLASSIFIED (`ENV_MANIFEST`, D12) so their absence is at
least honest rather than invisible, and ADR-024 §3 records the finding.

The removal is a media-lane change: delete `pollWanTask`, `wanBaseUrl`, the two env entries, the
`WAN task landing` describe in `media.test.ts` (which calls the action directly, so it will keep
passing regardless — that test cannot see this), and the two `vi.stubEnv` pairs in `media.test.ts`
/ `renderReel.test.ts`. Do it only after confirming no `mediaJobs` row anywhere carries a Wan
`providerRequestId` at `submitted`.

## 6. `llmRedaction.test.ts` still bans `FAL_WEBHOOK_SECRET` by name

Harmless (a denylist entry for a name that no longer exists is a negative assertion that can only
stay true), and left in place at 25.1-06 rather than churned. Worth knowing it is a fossil if that
list is ever read as an inventory of live secrets — it is not one.

## 7. `stripCode` in `llmRedaction.test.ts` mis-reads a slash-star inside a LINE comment

Found 2026-08-21 while fixing the reel vault category. `stripCode` removes block comments before
line comments:

    src.replace(/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1")

A `//` line comment that merely MENTIONS a mime glob (the characters slash-star) therefore reads as
a block-comment OPENER, and the non-greedy match runs forward to the next close marker — silently
swallowing whatever code sits between, including `internal.audit.log` call sites.

Observed exactly that: adding a comment quoting the mime globs to `render/renderReel.ts` dropped the
scan from 8 audit sites to 7 and from 13 payload literals to 12. **The pinned COUNTS caught it** —
which is the whole argument for counts over `>= 1` — but a change that both swallowed a site AND
was written to match the lower count would pass, and the §4 scan would be quietly weaker.

Not fixed here: the honest repair is a real comment-stripper (or stripping line comments FIRST), and
that belongs with whoever next owns the redaction scan. The immediate hazard is documented in a
comment at the call site so the next author does not re-trip it.
