# 42-03 — the governed fan-out: one question, up to five specialists, one approval

**Closed 2026-09-07.** Head at start `0dfe186`. Phase 42 plan 3 of 3 — **G6 closed**.

Owner decision of 2026-09-07: when the rail cannot fund every worker, **fan out to fewer workers**.
That answer is recorded as **ADR-038**, which supersedes ADR-037 Decision 6 on the two clauses it
got wrong.

## What shipped

| Piece | Where |
|---|---|
| `narrowFanOut` — the money arithmetic, pure and unit-testable | `convex/lib/dispatchShared.ts` |
| `MAX_FAN_OUT`, `ENVELOPE_FRACTION` (moved from `dispatch.ts`) | `convex/lib/dispatchShared.ts` |
| `startTeamRun` — mint the root's children, divide the envelope, start n durable runs | `convex/dispatchRun.ts` |
| `dispatchTeam` — the executive's tool | `convex/llm.ts` |
| `insertPlan` gains `parentPlanId` / `kind` / `subject` **at birth** | `convex/plans.ts` |
| `landSpecialistResult` branches on `parentPlanId`; a child lands `approved` | `convex/evaluations.ts` |
| `flipParentWhenSiblingsDone` — the one finish check, shared by two callers | `convex/lib/planRow.ts` |
| The sweep's child terminal and parent exemption | `convex/reliabilitySweep.ts` |
| `fanOutMemoBody` — the deterministic parent artifact | `packages/core/src/specialists.ts` |
| `workerCount` on the `subagent.dispatched` allowlist | `packages/contracts/src/auditProjection.ts` |
| The `cockpit-agent` body section teaching `dispatchTeam` (**gated candidate**) | `packages/contracts/skills/` |

## The two defects the adversarial pass found before implementation

**1. THE FATAL — a child minted without `kind`.** Both adversaries found it independently. The
plan's mint used a bare `insertPlan`, which writes no `kind` because every previous caller set it in
a *second* transaction via `patchPlan`. A fan-out minting n children in one mutation has no second
transaction. A child without `kind: "memo"` is discarded by **three** independent fail-closed
gates — `landSpecialistResult`'s CAS, the sibling flip that reads it, and `reliabilitySweep`'s
`collectingPlane` — so every worker's paid memo would vanish, the parent would sit at `collecting`
for ever (invisible to approvals, blocking every future dispatch on the thread through
`isOpenRoot`), and the join tests would still have passed if their fixtures seeded children by hand.
Fixed by widening `insertPlan`; pinned by a test that reads a minted child back; the mutation that
removes the field **reddens four tests**.

**2. ADR-037 Decision 6 was arithmetically wrong**, and it is a money bug. It claimed a child handed
a divided envelope of `0` is refused `budget_exhausted`. It is not: `governedDispatch` reads
`args.envelopeCents > 0 ? args.envelopeCents : derive`, so a zero child takes the **derive** branch
and receives the *full* rail share. And `Math.floor(root / n)` is `0` across the whole interval
`root < n`, not only at `root === 0` — so on a rail down to 19¢, five workers would each have been
granted 4¢ instead of none. ADR-038 supersedes it: cap the **worker count** by the envelope rather
than flooring the share, which makes `share ≥ 1` a theorem.

## Four things the model does not decide

`dispatchTeam` takes a `question` and `routes`, and that is all it supplies. Code owns everything
else, per ADR-008:

1. **How many run.** `min(routes, MAX_FAN_OUT, rootEnvelope)`.
2. **Duplicates.** `SPECIALIST_ROUTES` is a closed six-member set, so `["research"×5]` would
   otherwise buy five identical paid turns — and `wouldCycle` cannot catch it, because it runs per
   child against an empty ancestry and never fires between siblings. Deduped before the cap.
3. **`media` is refused at the door.** A media dispatch runs `groundMediaBrief`, a paid turn with no
   envelope check, so N media children would be N full-price passes outside every ceiling.
   This is ADR-037's open item (b), answered by exclusion rather than left open.
4. **Which entry point a route runs on.** `research` runs on `kind: "research"`; the generic
   specialist path would lose `persistResearchFindings` and land `LOST_CONTEXT_MEMO`'s "the
   evaluation it was based on is no longer on file" — false for a run never based on one.

## Verification

- **Backend 4060** (shards 2093 + 1967), **core 1522**, **web 899 + 2 skipped**, **contracts 123**.
  `tsc --noEmit` clean in all three packages. Biome clean.
- **16 new tests** — 12 in `fanOut.test.ts` (the arithmetic across `rootEnvelope ∈ [0,40] ×
  routeCount ∈ [1,8]`, the mint shape, dedupe, route validation, the join, the sweep) and 4 in
  `packages/core/src/specialists.test.ts` for `fanOutMemoBody`.
- **Four mutations verified RED and `cmp`-restored:** dropping the rail from the worker cap (3 red),
  minting children without `kind` (4 red), removing the dedupe (1 red), removing the sweep's child
  branch (1 red).

## Open — and one of these gates the feature

- **The tool is invisible until the owner activates the body.** `cockpit-agent` is in
  `GATED_SKILLS`, so the section teaching `dispatchTeam` is a **candidate**; `activateSkillVersion`
  throws without recorded passing eval evidence, and the gate is per deployment. Until that runs,
  `dispatchTeam` is registered, tested and unreachable — a tool the body does not teach is a tool
  that does not exist. This rides with the `cockpit-agent` v3 candidate already pending from Phase 40.
- **`RELIABILITY_SWEEP_ARMED=1` on production.** Un-armed, a fan-out with one dead worker has no
  watchdog at all. The code path is built and tested; the env var is owner work.
- **No fan-out spend report.** Cost is answerable only by summing `spendEvents` by `planId` across
  children, and only if `recordSpend`'s optional `planId` is threaded — it still is not, by any of
  its callers. Named in ADR-038 rather than claimed as done.
- **`agentSteps` still has no worker index.** One trace step covers the whole team. Deliberate: the
  `turnId` that keys the trace also keys every spend row through `recordMovement`, which de-dupes on
  `(tenantId, correlationId, phase)` and returns the existing row — so making N workers share a
  turnId would silently collapse N spend-ledger rows into one.
