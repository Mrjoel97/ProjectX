# Phase 42 — durable specialist runs + governed fan-out (G6). Research.

Measured 2026-09-07 at tree `3ca34e9`. Every `file:line` below was opened at that tree.
Consumes **ADR-037** (accepted 2026-09-07); nothing in ADR-037 has landed as code — this phase is
where its schema and its reads become real.

## 0. What G6 actually asks for, and which third of it is already true

The merged audit's G6 row (`system-audit-2026-09-03-merged.md:85`) names three things:
*durable specialist runs*, *parallel threads*, *governed fan-out (≤5 workers, depth 1)*.

- **Parallel threads is ALREADY TRUE and needs no code.** Every in-flight interlock is read through
  `by_thread` scoped to one thread (`plans.ts:185, 277, 554`), so two threads already dispatch
  concurrently. What is *not* true is parallelism **within** one thread, and that is the fan-out,
  not a separate deliverable. Recorded here so the phase does not build a thing that exists.
- **Durable runs is a real gap**, but a narrower one than "30-min work survives only as `runAfter`
  links" suggests — see §2.
- **Governed fan-out is the whole build.** No code in this repository fans out a *specialist*;
  `deliverApprovedPlan` fans out a *send*, sequentially, and is the shape to copy (§3).

## 1. How a specialist run works today (the thing being made durable)

Three entry points, all `internalAction`, all reached by a bare `scheduler.runAfter(0, …)`:

| Entry point | Scheduled from | Terminal |
|---|---|---|
| `dispatch.runSpecialist` (`dispatch.ts:698`) | `evaluations.ts:992` (a weekly-review gap) | `landSpecialistResult` |
| `dispatch.runResearch` (`dispatch.ts:1257`) | `llm.ts:2004` (a cockpit tool) | + `persistResearchFindings` |
| `dispatch.runMedia` (`dispatch.ts:1414`) | `llm.ts:2066` (a cockpit tool) | + `persistStoryboard` |

All three funnel through **one** spine, `dispatchAndLand` (`dispatch.ts:617`) → `governedDispatch`
(`dispatch.ts:438`), whose guard order is load-bearing: resolve → depth (`MAX_DEPTH = 1`,
`dispatch.ts:58`) → cycle → envelope (`ENVELOPE_FRACTION = 0.25`, `dispatch.ts:67`) → run. The
landing sits in a `finally` (`dispatch.ts:684-694`), so *"the plan always leaves `collecting`"* is
today as unconditional as the language allows **within one action invocation**.

**The clock is per model call, not per run.** `CALL_TIMEOUT_MS = 45_000` (`llm.ts:152`),
`MEDIA_CALL_TIMEOUT_MS = 90_000` (`:184`), `RESEARCH_CALL_TIMEOUT_MS = 180_000` (`:167`), selected
by skill name at `llm.ts:220-223` and applied as `AbortSignal.timeout(budgetMs)` (`llm.ts:4871`).
A run may make several such calls; the outer bound is Convex's own action limit, and
`dispatch.ts:1204` names the working figure — `DISPATCH_TIMEOUT_MS (210s)`.

## 2. What "durable" buys, and the one thing that makes it dangerous

The precedent is fully built: `WorkflowManager` (`index.ts:8-13`) on `@convex-dev/workflow@0.4.4`,
used by five modules — `deliverApprovedPlan`, `requests.ts`, `vaultIngest.ts`, `smoke.ts`,
`pipeline.ts`. `workflow.define` gives a journaled handler that survives a deploy, a crash and a
container eviction, replaying completed steps from the journal instead of re-running them.

**The trap, and it is a money trap.** The shared manager sets
`defaultRetryBehavior: { maxAttempts: 3, … }` **and `retryActionsByDefault: true`**
(`index.ts:10-11`). A `step.runAction` that throws is therefore retried up to three times. A
specialist turn is **not idempotent with respect to spend**: `runSpecialistTurn` bills the model
and `recordSpend` draws the rail down before any throw can be caught. Putting today's dispatch on
the default manager converts one failed $0.02 turn into three.

This repository already knows the shape of that bug and already refused it once, one level down:
`vaultIngestPool` deliberately leaves `retryActionsByDefault` at `false` because *"`extractDoc`
charges OCR pages via `recordSpend` before it reaches the ingest seam, so it is not idempotent with
respect to spend, and a silent retry would double-charge a reservation"* (`index.ts:35-39`). The
same sentence is true of a specialist turn, word for word.

Two further measured constraints on any workflow shape here:

- **The journal caps at 8 MiB and steps pass ≤1 MB total** (`index.ts:41`). A fan-out must **not**
  return five memo bodies through the journal; each child writes its own plan row and returns
  nothing but a status. This falls out of ADR-037 Decision 4 anyway.
- **A journaled step validates its args on replay**, so *adding* a field to a step's args throws
  `"Journal entry mismatch"` on an in-flight workflow across a deploy (`vaultIngest.ts:224`).
- **`DEFAULT_MAX_PARALLELISM = 25` is shared by every workflow in the app** (`index.ts:26-31`), and
  the comment there forbids widening it because the delivery spine rides the same manager. Five
  concurrent children per fan-out is 20 % of that pool per run.

**The watchdog that would catch a stall is dormant on production.** `reliabilitySweep` returns early
unless `process.env.RELIABILITY_SWEEP_ARMED === "1"` (`reliabilitySweep.ts:353`), and the arming is
still on the owner's list. `sweepStuckPlans` (`:312-317`) is what ADR-037 Decision 4 requires to
take the child terminal and re-run the sibling check. **Un-armed, a fan-out with one dead worker
leaves its parent at `collecting` forever** — the phase is not honestly done until that env var is
set on prod.

## 3. The fan-out shape that already exists, and what it does not cover

`deliverApprovedPlan` (`deliverApprovedPlan.ts:23`) is a fan-out: one workflow, a loop over
recipients, `step.runAction` per item, **per-item try/catch isolation** so one terminal failure
dead-letters its own row and the loop continues. It is sequential, not parallel, and the isolation
is hand-written rather than inherited.

What a specialist fan-out adds beyond it:

1. **N is model-chosen, not row-derived.** Recipients come from a table; specialist routes would
   come from the executive agent. ADR-008 says the model must never supply the limits — so the cap
   (≤5) and the routes (the closed `SPECIALISTS` set) are validated in code, and
   `resolveSpecialist`'s runtime branch (`dispatch.ts:460`) already exists for exactly that reason.
2. **The envelope must divide at the mint site** (ADR-037 Decision 6): `governedDispatch` stays
   byte-identical, every child is scheduled with `envelopeCents: Math.floor(root / N)` and never
   `0`, because `dispatch.ts:475` cannot tell "no envelope yet" from "a divided envelope of zero".
3. **One approval.** Children land at `approved` and only the parent flips to `proposed`
   (ADR-037 Decision 4), so `paginatePlans` (`approvals.ts:120-135`) — which pages by status with
   no other predicate — shows one card.
4. **`agentSteps` cannot currently tell five workers apart.** `stepKey` is
   `dispatch:<rootRequestId>` (`dispatch.ts:492`), so five same-root workers collide on one key and
   the chat trace shows one step. ADR-037 named this and left it to G6; it is a one-field change
   plus the closed `tool` union in `schema.ts` — a union that has been the trap **three times**
   already by its own comments, so a new literal ships in the same commit as its writer.

**ADR-037 open item (b) is now measured and it is real.** `groundMediaBrief`
(`dispatch.ts:1354-1412`) runs a paid specialist turn with **no envelope check and no `spentCents`
accounting**; its only cost control is the reuse query at `:1372-1377`, keyed on
`contentHash(brief)` within `FINDINGS_REUSE_MS`. For a media fan-out, N children sharing one brief
would hit that cache and cost once; N children with *different* briefs would be N full-price passes
outside every ceiling. **Decide before any media fan-out ships**; the cheapest correct answer is to
run grounding once on the root, since the cache already makes that the effective behaviour.

## 4. The migration ADR-037 requires, sized honestly

This is the larger half of the work and it is not optional — Decisions 2, 3 and 7 ship together or
none of them does (ADR-037 Decision 8).

- **Schema**: `parentPlanId: v.optional(v.id("plans"))` + `by_parent: ["tenantId","parentPlanId"]`.
  No backfill. Neither schema tripwire is touched (verified: `parentPlanId` is on none of
  `schema.test.ts`'s 20 `BANNED_FIELDS`; the index leads with `tenantId` so `isolation.test.ts`
  needs no new exception).
- **Six `.unique()` reads on `plans.by_thread`**, confirmed by grep at this tree: `plans.ts:186,
  278, 555, 622`, `cockpit.ts:605`, `evaluations.ts:937`, plus `plans.byThread` itself
  (`plans.ts:1102`) and the two helper call sites ADR-037 lists (`cockpit.ts:203, 486`). Four other
  tables have their own `by_thread` (`briefings.ts:58`, `calendarViews.ts:57`, `intakeDb.ts:70`,
  `knowledgeSearch.ts:282`) and are **out of scope** — none is `.unique()` and none is `plans`.
- **THE FINDING THE ADR UNDERSTATES: the stagers RECYCLE, they do not insert.** All three end with
  `planId = plan._id` and a `resetPlan` (`plans.ts:198-200`, `:344`, and the `stageImagePlan` twin),
  reusing the one row. ADR-037's one-open-root invariant turns "recycle the thread's row" into
  "insert a new root when none is open". That ripples through `RECYCLABLE_STATUS`,
  `hasDraftContent`, the `completedMemo` branch (`plans.ts:337-343`) and `resetPlan` itself. It is
  the real body of the migration, and it is where a wrong diff strands a user's half-composed
  draft — the exact failure ADR-037 Decision 3 was written to prevent.
- **The Approvals plane** (`ApprovalsView.tsx:26, 746, 856, 975, 1333` + the `answer` mutation at
  `:1055`) moves to `plans.byId`. Cannot be deferred: a card that displays by `threadId` and
  mutates by `planId` is safe only while `.unique()` throws.
- **Web consumers that keep reading by thread** (newest root is the right answer for all four):
  `cards.tsx:56, 3219`, `ChatPane.tsx:128`, `MediaCanvas.tsx:2455`.
- **Test surface**: ~20 backend consumers of the single-document contract, **13** `plans.byThread`
  reads across three e2e specs, and the cardinality/reason-code assertions ADR-037 enumerates.
- **The skill body is a VERSION BUMP, not a code edit** (ADR-007). `cockpit-agent` is in
  `GATED_SKILLS`, so the body edit publishes a candidate and needs an eval gate before activation —
  and the gate is per-deployment. Read the live version back from `internal.skills.getActiveSkill`
  before the cycle; the source labels conflict.

## 5. Proposed split (owner confirms in §6)

1. **42-01 — the plan-row migration.** Schema + the six reads + the recycle→insert change + the
   one-open-root interlock + `plans.byId` + the Approvals plane + the skill-body candidate. No
   fan-out; arity stays 1 in practice, but the read stops throwing. This is the risky plan.
2. **42-02 — durable runs.** The three dispatch entry points onto `workflow.define` with the
   retry question of §2 answered explicitly, plus the `agentSteps` worker key.
3. **42-03 — the governed fan-out.** ≤5 children, one approval, the divided envelope, the parent
   artifact, the grounding decision of §3.

**43 (G10, batches)** stays a separate phase and consumes the same schema.

## 6. Owner questions — ANSWERED 2026-09-07

| # | Question | Owner's call | What it settles |
|---|---|---|---|
| 1 | Sequencing of the migration vs the fan-out | **Three plans in one phase** | 42-01 migration, 42-02 durable runs, 42-03 fan-out. Each its own commit and its own deploy, so the risky change is live and watched before anything is built on it. |
| 2 | What happens when a durable run's PAID step fails | **No auto-retry on the paid step** | `workflow.define` with retry disabled on the model call. Durability comes from the journal (survives a deploy, a crash, an eviction); a failed turn lands its honest memo exactly as today. **Never re-bills.** The `vaultIngestPool` precedent (`index.ts:35-39`) is followed verbatim, not diverged from. |
| 3 | What the single approval card shows for a fan-out | **Deterministic assembly** | The parent memo is the children's memos under their route headings plus the merged sources block. No sixth model call, no extra cost, and nothing new can be introduced at the join. A synthesis pass is a later decision if reading stacked memos turns out to be the complaint. |
| 4 | Whether to raise the 45 s / 90 s / 180 s per-call clocks | **No — the fan-out is the answer** | The clocks stay. Five workers x 180 s in parallel is fifteen minutes of work in three. Raising a specialist's own clock is a lane change (reasoning budget, cost, model choice) and gets its own phase if it is ever wanted, not a flag flip inside this one. |

**Consequences carried into the plans.** (a) 42-02 must set retry off explicitly at the step, not
rely on a manager default — the shared `WorkflowManager` sets `retryActionsByDefault: true` and a
new workflow inherits it. (b) 42-03's parent memo is a pure function over the children's rows and
belongs in `@pikar/core` beside the existing memo formatter, not in `convex/`. (c) Nothing in this
phase touches `llm.ts:152/167/184`.
