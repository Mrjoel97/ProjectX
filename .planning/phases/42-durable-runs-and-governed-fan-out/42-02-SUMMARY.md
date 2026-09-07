# 42-02 — durable specialist runs, with the paid step never retried

**Closed 2026-09-07.** Head at start `4e307bb`. Phase 42 plan 2 of 3 (G6, Track C step 11).

Owner decision 2 governs this plan: *no auto-retry on the paid step — durability comes from the
journal, a failed turn never re-bills.*

## What shipped

| Piece | Where |
|---|---|
| `DISPATCH_ARGS`, `DISPATCH_KIND`, the two failed-run memo bodies, `failedMemoFor` | `convex/lib/dispatchShared.ts` (new — pure moves) |
| One `workflow.define` (`dispatchRun`) whose single `step.runAction` carries `{ retry: false }` | `convex/dispatchRun.ts` (new) |
| `startDispatchRun` — the one door, writes `plans.workflowId` | `convex/dispatchRun.ts` |
| `onDispatchComplete` — the second, free, idempotent landing | `convex/dispatchRun.ts` |
| `dispatchWorkflowLive` — a throw-safe liveness read | `convex/dispatchRun.ts` |
| Three starters swapped off `scheduler.runAfter(0, internal.dispatch.run*)` | `evaluations.ts`, `llm.ts` ×2 |
| `dispatchLive` asks the component before scanning `_scheduled_functions` | `reliabilitySweep.ts` |
| The `retry: false` source tripwire + a no-bare-scheduling scan | `dispatchGuard.test.ts` |

## The four decisions inside the diff

1. **ONE `workflow.define` with a `kind` switch, not three.** The dangerous edit here is an
   *omitted option*: a `step.runAction` written without `{ retry: false }` inherits the shared
   manager's `maxAttempts: 3` and re-bills a failed model turn three times, with the compiler,
   biome and the whole behavioural suite blind to it. One call site cannot be half-omitted; three
   can. The tripwire pins exactly one, carrying the option.

2. **The starter is SCHEDULED, not inline.** The queued row is what carries the dispatch args in
   the app's own `_scheduled_functions`; a `workflow.start` enqueues into the *component*, where
   five existing test sites that pin `skillVersions` / `tenantSkillIds` / `depth` / `ancestry`
   cannot see it. Inline would have bought transactional atomicity for exactly one of the three
   callers — `applyActOnGap`; the two cockpit tools run in an action ctx and are a second
   transaction either way — at the price of those pins. Trading a live guard for atomicity one
   caller in three would gain is a bad trade, so it was not made.

3. **`dispatchLive` had to move in the same commit, and it is a data-loss fix.** A durable dispatch
   is enqueued by the component, so the app-side scan returns *false* for a genuinely running
   specialist. Armed, the sweep would then patch a live run's plan to `proposed` +
   `COLLECTING_FALLBACK_BODY`, and when the real turn landed, `landSpecialistResult`'s CAS would
   **discard the memo the tenant paid for**. Shipping 42-02 without this would have put that one
   env var away from live. The fix reuses `plans.workflowId` — the upgrade path the function's own
   ponytail comment already named — and catches `workflow.status`'s throw so an unresolvable id
   falls through instead of killing the sweep batch.

4. **Durability is described honestly.** `dispatchAndLand`'s `finally` guarantees "the plan always
   leaves `collecting`" *within one action invocation*. `onDispatchComplete` covers the invocation
   that never reaches it: a second, free, idempotent landing attempt. It is a mutation, it calls no
   model, and the CAS makes it a no-op on the happy path. It is not a re-run and not a rescue from
   eviction, and the playbook says so in those words.

## What the nine-agent review changed before a line was written

Seven agents measured four seams, synthesized one plan, and two adversaries attacked it. Both
adversaries independently found the same **fatal defect in the 42-03 half** — children minted by a
bare `insertPlan` carry `kind: undefined`, and three fail-closed gates (`landSpecialistResult`'s
CAS, the sibling flip, `sweepStuckPlans`' `collectingPlane`) all require `kind === "memo"`, so every
child's paid memo would be silently discarded and the parent would hang at `collecting` forever.
Verified against the code; carried into 42-03 as a mint-time requirement with its own test.

The citation adversary also corrected six `file:line` claims in the plan, including the
money-critical one (`step.runAction` is `workflowContext.d.ts:68`, not `:60-66` — `:60` is
`runMutation`, which takes no `retry`).

**A defect in ADR-037 itself** — see the open items below.

## Verification

- **Backend 4048 green** (shards 2081 + 1967). `tsc --noEmit` clean in both packages. Biome clean.
- **Five new behavioural tests** for the terminal (lands a dead run, the kind-correct sentence,
  cannot overwrite a landed row, writes nothing on success, the audit row carries no error text)
  plus **two source tripwires**.
- **Three mutations verified RED and `cmp`-restored:** deleting `{ retry: false }` (the tripwire),
  making the terminal return early on `failed` (3 red), dropping `landSpecialistResult`'s CAS
  (5 red).
- Eight existing assertions rewritten, never dropped — every arg pin they carried survives, and
  `runCockpitAgent.test.ts`'s tenant-skill pin (the only proof that pin survives the media
  hand-off) now matches on the code-owned `kind` as well as the function name.

## Open

- **ADR-037 Decision 6 is arithmetically wrong** and 42-03 cannot ship on it as written. It says a
  child with a divided envelope of 0 is refused `budget_exhausted` at `dispatch.ts:481` (`0 >= 0`).
  But `governedDispatch` reads `args.envelopeCents > 0 ? args.envelopeCents : derive(...)`, so a
  child passed `0` takes the **derive** branch and receives the *full* 25 % rail. `Math.floor(root/n)`
  is 0 for every `root < n`, not only for `root === 0` — so on a nearly drained rail, five children
  would each get the whole remaining envelope instead of none of it. Needs an owner decision (see
  below) and a superseding ADR; ADRs are never edited after acceptance.
- **`RELIABILITY_SWEEP_ARMED=1` on production.** Not a blocker for 42-02 — nothing stalls that did
  not stall before — but 42-03 must not ship without it.
- **`agentSteps` still has no worker index** (`stepKey = dispatch:<rootRequestId>`). Deliberately
  not touched here: the same `turnId` also keys every spend row through `recordMovement`, which
  de-dupes on `(correlationId, tenantId, phase)` and returns the existing row without inserting — so
  making N workers share a turnId would silently collapse N spend-ledger rows into one. 42-03 owns
  the surface and must not solve it by sharing.
- **`groundMediaBrief` still runs a paid turn with no envelope check** (`dispatch.ts`). 42-03 must
  state whether it runs once per media root or once per child.
- **Two playbook blocks in this commit were written by tooling, not by me** —
  `business-evaluation.md` and `knowledge-search-routines.md` gained 42-02 entries during the test
  cycle. I read both in full and verified every claim against the code before letting them ship.
