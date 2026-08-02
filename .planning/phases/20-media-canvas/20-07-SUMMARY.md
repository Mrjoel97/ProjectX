# 20-07 — SUMMARY

**Plan:** `media` becomes the `externalAction` arm's second occupant, and the arm stops being
hardcoded to calendar. **Status: complete, UNCOMMITTED** (shared tree). Cost to build: **$0**.

## What shipped

| File | What changed |
|---|---|
| `packages/core/src/actionType.ts` | `ACTION_TYPES` += `"media"`; `actionTypeOf` widened; `ARMS.media = "externalAction"`; the `Arm` doc comment corrected — the arm is no longer calendar's |
| `packages/core/src/actionType.test.ts` | the exact-array + `armFor("media")` assertions; `_COMPLETE_ARMS` widened |
| `packages/backend/convex/schema.ts` | `plans.kind` += `v.literal("media")`; **`plans.mediaRunId` + `.index("by_media_run")`** |
| `packages/backend/convex/plans.ts` | `patchPlan`'s hand-maintained kind mirror widened; `resetPlan` clears `mediaRunId` |
| `packages/backend/convex/cockpit.ts` | `_ARM_TABLE` += media; `ExternalActionType` (derived); `EXTERNAL_TARGETS`; the per-type pre-step; the widened return union |
| `packages/backend/convex/mediaComplete.ts` | `onSubmitComplete` — the retrier terminal |
| `packages/backend/convex/cockpit.test.ts` | +12 tests (the media arm + the two calendar regressions) |
| `packages/backend/convex/dispatchGuard.test.ts` | the arm scan UPDATED, not weakened |
| `packages/cost/src/media.test.ts` | **a pre-existing RED fixed** — see below |
| `docs/playbooks/cockpit.md` | `## The externalAction arm (20-07)` + `Last verified` |
| `docs/playbooks/media.md` | an `onSubmitComplete` subsection — **`Last verified` deliberately NOT bumped, 20-14 owns it this wave** |

Verification: **`pnpm test` 8/8 packages green** — backend **1003** (was 991), core **445**, cost
**56**. Backend `tsc --noEmit` **13 — the pre-existing baseline, delta 0**, zero non-test errors;
core and cost **0**. Biome **delta 0 on every edited file** (per-file `git show HEAD:` baseline
compare). All mutation checks observed RED and restored.

## `EXTERNAL_TARGETS` — the shape plan 20-16 re-points and plan 20-10 reads around

```ts
type ExternalActionType = {                       // DERIVED from _ARM_TABLE, not hand-listed
  [K in ActionType]: (typeof _ARM_TABLE)[K] extends "externalAction" ? K : never;
}[ActionType];

const EXTERNAL_TARGETS = {
  calendar_event: (ctx, a) => retrier.run(ctx, internal.calendar.createEvent,
    { planId: a.planId, tenantId: a.tenantId, correlationId: a.correlationId },
    { onComplete: internal.calendarComplete.onCreateComplete }),
  media: (ctx, a) => retrier.run(ctx, internal.media.submitBatch,
    { tenantId: a.tenantId, batchId: a.batchId ?? "" },
    { onComplete: internal.mediaComplete.onSubmitComplete }),
} satisfies Record<ExternalActionType, (ctx: MutationCtx, a: ExternalArgs) => Promise<unknown>>;

type ExternalArgs = { planId: Id<"plans">; tenantId: string; correlationId: string; batchId?: string };
```

**PLAN 20-16 CHANGES EXACTLY ONE LINE HERE** — `internal.media.submitBatch` → the reel-chain entry
(which itself calls `submitBatch` first). Nothing else in the arm moves.

## THE WIDENED `executePlan` RETURN UNION — plan 20-10's canvas renders these

```ts
| { ok: true; workflowId?: string; alreadyStarted?: true; scheduled?: true }
| { ok: false; reason:
      "gmail_not_connected" | "send_time_too_far" | "review_escalated"
    | "no_deck" | ReserveRefusal }
```

`ReserveRefusal` is **re-exported from `media.ts`**, not re-typed, so the two unions cannot drift.
It resolves to `kill_switch | unknown_model | over_job_cap | illegal_duration |
narration_too_long | narration_too_short | media_daily_exhausted | deployment_media_exhausted`.
`no_deck` is `executePlan`'s own, returned before `reserveJobInner`. **Eight new members; every one
is a governed stop that names a lever, and only bugs throw.**

## Deliberate deviations from the plan — read these before writing a dependent plan

1. **THE ARM TESTS LIVE IN `cockpit.test.ts`, NOT `cockpitTools.test.ts`.** The plan's
   `files_modified` names the latter, but `cockpitTools.test.ts` has **zero** `executePlan` tests —
   the whole `executePlan calendar arm (ACTN-02)` suite, the `withDelivery()` harness, `retrierTest`
   and `withIdentity` all live in `cockpit.test.ts`. Writing a parallel harness next door would have
   been rung-2 slop. The media suite sits directly beneath the calendar one, sharing its helpers.
2. **`plans.mediaRunId` + `by_media_run` were ADDED — the plan said not to.** Step 4 says to record
   a media run id "only if something reads it, and nothing does yet". But the SAME plan mandates
   `onSubmitComplete`, and the action-retrier's `onComplete` receives **only `{runId, result}`** —
   verified against `@convex-dev/action-retrier@0.3.1`'s `RunOptions`, which has no context field.
   Without an indexed run id the terminal cannot find its own plan, so the premise was stale. It is
   the `by_calendar_run` precedent verbatim, and **deliberately a SECOND column** — overloading
   `calendarRunId` would make a media retry resolvable as a calendar plan by `calendarComplete`.
3. **`EXTERNAL_TARGETS` is a table of THUNKS, not of `{action, args, onComplete}` records.** The
   plan's record shape does not type-check: each action has its own argument validator, so TS unions
   the function reference and the args independently and loses the correlation. Worse, the plan's
   shared arg object (`{planId, tenantId, correlationId, ...batchId}`) would pass `correlationId` to
   `submitBatch`, whose validator takes `{tenantId, batchId}` and rejects it. Each thunk closes over
   its own `retrier.run` call and type-checks against its own target.
4. **`ExternalActionType` is DERIVED from `_ARM_TABLE`, not hand-listed** — a strengthening the plan
   did not ask for. A hand-written union would have let a third type be marked `"externalAction"`
   and reach `EXTERNAL_TARGETS[type]` as `undefined` at runtime. Derived, that is a compile error
   (observed — see the mutation table).
5. **`no_deck` is a NEW refusal reason.** `reserveJobInner` with an absent `clipSeconds` already
   returns `illegal_duration`, but an EMPTY `shots` array would have reserved only the flat $0.02
   render line and "succeeded" on a reel with no blocks. The guard also rejects a shot `type` outside
   `SHOT_TYPES` — `plans.shots[].type` is `v.string()` in the schema while `reserveJobInner` wants
   the closed `ShotType`, so this is the boundary narrowing, not a cast. All three cases are
   `no_deck`: **a money gate does not assume its writer was correct.**
6. **`withCaptions` is pinned `true`.** There is no schema field and no toggle until the canvas
   (20-09). Fail-closed direction: an unused STT line costs $0.008; an unreserved one that IS used
   is spend outside the rail. `ponytail:` comment at the site.
7. **`dispatchGuard.test.ts` was UPDATED (not in `files_modified`, and unavoidable).** It asserted
   `retrier.run(` / `internal.calendar.createEvent` / the terminal literal lived INSIDE the switch
   case; after the refactor they live in `EXTERNAL_TARGETS`. The guard's subject moved, so the guard
   moved — and got stronger: it now checks **each occupant's own** action + terminal in the table,
   that the case dispatches through `EXTERNAL_TARGETS[...]` rather than naming a target inline, and
   that `reserveJobInner` is present in the arm. `workflow.start`/`deliverApprovedPlan` stay
   forbidden. **Weakening it to "the arm exists" was the easy read of that failure and the wrong one.**

## A PRE-EXISTING RED, found and fixed: `packages/cost/src/media.test.ts`

`pnpm test` (the whole monorepo, which this plan's own verification section demands) surfaced
`SC5 — the reconciliation procedure is runnable, not aspirational` FAILING. **It was red at `HEAD`,
before any of this phase's uncommitted work** — proven by running the assertion against
`git show HEAD:docs/playbooks/media.md`:

```
the naive    split("## Reconciliation")[1] at HEAD contains "convex run": False
the anchored split(/^## Reconciliation$/m)[1] at HEAD contains "convex run": True
```

Root cause: the test did `playbook.split("## Reconciliation")[1]`, a BARE string split. The playbook
legitimately REFERS to `` `## Reconciliation` `` in prose four times above the section itself (the
first such reference was added by a foreign session's registration note at the top of the file), so
`[1]` was a slice of the header block, which contains no command. Fixed by splitting on the
**anchored heading** `/^## Reconciliation$/m` — one line, root cause not symptom. The earlier
backend-only filtered runs never executed `@pikar/cost`, which is why three plans passed over it.

## The mutation checks — every one observed, then restored

| mutation | what fired |
|---|---|
| `media` removed from `@pikar/core`'s `ARMS` | `src/actionType.ts(53,12): TS2741: Property 'media' is missing … required in type 'Record<"calendar_event" \| "email" \| "media" \| "memo", Arm>'` — in BOTH packages |
| `media` removed from `cockpit.ts`'s `_ARM_TABLE` | the same TS2741 at the dispatcher's own bind, **plus** TS2353 on `EXTERNAL_TARGETS` |
| **`media` left `"externalAction"` but given NO target** | `cockpit.ts(557,3): TS2741: Property 'media' is missing … required in type 'Record<ExternalActionType, …>'` — **the derived guarantee working** |
| the media pre-step moved AFTER the `approved` patch | **6 tests RED**, all `expected 'approved' to be 'proposed'` |

Restored after each; `tsc` back to 13, `cockpit.test.ts` 44/44.

## Committing — the tree is still shared

`ls .git/MERGE_HEAD` → absent. This plan's files are all its own **except** `docs/playbooks/cockpit.md`,
which still carries foreign hunks predating this session (see 20-05-SUMMARY.md for the hunk-select
recipe). `packages/backend/convex/gmailAuth.ts` is likewise still mixed, from 20-05.
**`git stash` remains BANNED in this tree.**

## Three things a later plan must know

1. **20-16 owns the ONE line.** `EXTERNAL_TARGETS.media`'s thunk is the hand-off point and no other
   plan may re-point it. The arm shape does not move again.
2. **`plans.mediaRunId` is written ONLY by `executePlan` and read ONLY by `onSubmitComplete`.** It is
   deliberately not a `patchPlan` arg — the `calendarRunId`/`calendarEventId` rule verbatim: nothing
   reachable from the MODEL may write a run id. `resetPlan` clears it (a stale run id would let a
   terminal fail rows on a plan since reset to a fresh compose).
3. **`convex/onboarding.test.ts` flaked again** — one backend run failed while the immediately
   following identical run passed 1003/1003, and `pnpm test` (turbo) was green either side. Same
   intermittent recorded in 20-05-SUMMARY.md; still not this lane's code, still not chased.
   `check-playbooks.mjs` also still reports `block` for the foreign `onboarding.md` — **OWNER
   DECISION 2026-08-02, unchanged.** This plan's own playbook is not in the demand list.
</content>
