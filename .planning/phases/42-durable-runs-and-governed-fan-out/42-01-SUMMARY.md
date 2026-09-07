# 42-01 — the plan-row migration: ADR-037 becomes code

**Closed 2026-09-07.** Head at start `3ca34e9`. Phase 42 plan 1 of 3 (G6, Track C step 11).

## What shipped

The invariant that shaped the cockpit since 12-05 — one plan row per thread — is retired, and
nothing yet creates a second row. That ordering is the whole point of splitting the phase: the
risky read change ships and is watched in production before any fan-out is built on it.

| Piece | Where |
|---|---|
| `parentPlanId: v.optional(v.id("plans"))` + `by_parent: ["tenantId","parentPlanId"]` | `schema.ts` |
| `ROOT_SCAN = 20`, `isRoot`, `threadRoots`, `newestRoot`, `isOpenRoot` | `convex/lib/planRow.ts` (new) |
| `plans.byThread` → newest ROOT by bounded descending scan | `plans.ts` |
| `plans.byId` — new tenant-guarded public read | `plans.ts` |
| The three stagers: reuse the OPEN root, INSERT beside a finished one | `plans.ts` |
| `applyActOnGap`: a root per gap + the in-flight guard it never had | `evaluations.ts` |
| `listThreadMessages`: `.unique()` → `.first()` | `cockpit.ts` |
| All four approvals subscriptions + the `Plan` alias → `plans.byId` | `ApprovalsView.tsx` |

## The four decisions inside the diff

1. **LIFETIME ceilings died; CONCURRENCY interlocks survived.** Deleted: `image_already_started`
   (it refused a second image on any thread that had ever produced one), `RECYCLABLE_STATUS`, the
   `completedMemo` carve-out, and every "start a new chat" line in code and UI copy. Kept, meaning
   untouched: `draft_in_progress`, `research_in_flight`, `dispatch_in_flight`, `reel_in_flight`,
   `render_in_flight`, `image_in_flight`, `image_proposal_pending`, the UNDERWAY replies.

2. **At most one root per thread is `collecting`** — enforced by the stagers reusing the open root
   rather than inserting beside it. This is what makes "the newest root" and "the row the user is
   typing into" provably the same row, and it is why Decision 2 of the ADR is safe.

3. **The media stagers scan the whole root window; the research stager does not.** A rendering reel
   sits at `proposed`, which is not an open root, so a newer root can legally sit in front of it —
   a newest-only check would let a second reel start while the first is still spending. A
   `collecting` root, by contrast, can never sit behind a newer one, so the research stager needs
   only `roots[0]`. The asymmetry is recorded in both places.

4. **`image_proposal_pending` was KEPT although its original cause is gone.** It existed to stop
   the recycle destroying an un-acted-on image proposal; under ADR-037 nothing is destroyed. It
   stays because the ADR lists it among the surviving interlocks, because widening it away is a
   behaviour change nobody asked for, and because fail-closed is the right default on the money
   path. Named here rather than removed quietly.

## What the ADR predicted that measurement refuted

**No skill-body edit was needed, so there is no gated candidate and no eval gate on this plan.**
ADR-037 expected a `cockpit-agent` version bump for Decision 3. The body's "One reel at a time" and
"One image at a time" bullets describe the IN-FLIGHT interlocks, all of which survive; the lifetime
ceiling lived only in `IMAGE_REFUSAL_REPLY.image_already_started`, a driver-plane code string.
Verified by grep over `packages/contracts/skills/` and its `.ts` mirror, not assumed.

**And one thing the ADR understated.** The stagers did not insert — they RECYCLED (`planId =
plan._id` + `resetPlan`). Turning that into "insert when no root is open" is the real body of the
migration and rippled through `RECYCLABLE_STATUS`, `hasDraftContent`, the `completedMemo` branch
and the three refusal vocabularies. The schema field was the easy half.

## Verification

- **Backend 4034 green** (shard 1: 2072, shard 2: 1962), including **5 new** plan-row tests in
  `plans.test.ts` (33 total) and eight rewritten tests across `gapAction`, `dispatch` and
  `evaluations`. **Web 898 + 2 skipped.** `tsc --noEmit` clean in both packages. Biome clean.
- **Three mutations verified RED and restored by `cmp`:** dropping the `isRoot` filter in
  `threadRoots` (2 red), widening `isOpenRoot` to include `proposed` (3 red), dropping the
  `plan.kind === "memo"` guard in `applyActOnGap` (2 red).
- The rewritten tests are rewrites, not deletions. `gapAction.test.ts:343-344` argued in its own
  words that a duplicate *"would make every later read of the thread THROW"* — that argument was
  correct under `.unique()` and its replacement now states what is bought back instead.

## Open, carried into 42-02 / 42-03

- **`RELIABILITY_SWEEP_ARMED=1` is still not set on production.** No fan-out exists yet, so nothing
  is at risk today; but 42-03 must not ship without it, or a fan-out with one dead worker leaves
  its parent at `collecting` forever (`reliabilitySweep.ts:353`).
- **`groundMediaBrief` runs a paid specialist turn with no envelope check** (`dispatch.ts:1354`).
  42-03 must state whether it runs once per media root or once per child before any media fan-out.
- **13 e2e reads of `api.plans.byThread`** across three specs still resolve by thread. They stay
  correct (byThread returns the newest root) but were not re-driven live — the e2e stack was not
  run for this plan.
- **`agentSteps` still has no worker index** (`stepKey = dispatch:<rootRequestId>`), so five
  same-root workers would collide on one trace step. 42-02 owns it.
