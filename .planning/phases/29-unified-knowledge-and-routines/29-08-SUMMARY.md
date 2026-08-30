---
phase: 29-unified-knowledge-and-routines
plan: 08
subsystem: workflow-packs
tags: [routines, pinned-workflows, honesty, freshness, mutation-testing, accessibility]

requires:
  - phase: 29-unified-knowledge-and-routines (plan 01)
    provides: "the five pin-lineage columns on `savedPrompts` + the `by_tenant_template` index — the storage decision this plan inherits rather than remakes"
  - phase: 29-unified-knowledge-and-routines (plan 07)
    provides: "`WorkflowPin`/`pinIdentity`/`freshRunCorrelation` in @pikar/core, the `/dashboard/workflows` route, and the jsdom container-test idiom"
  - phase: 27-workflow-packs
    provides: "`cockpit.startWorkflowPack` (the sendCockpitMessage twin), `listPacks`, `packPreflight`, `WorkflowPackPreflight`, and `runPackTurn`'s pre-model `preCall` gate"
  - phase: 21-user-skill-authoring
    provides: "`tenantSkills` + the `PACK_GATE` refusal that makes `customization_not_applied` true"
provides:
  - "packages/backend/convex/pinnedWorkflows.ts — tenant pin CRUD, readiness and the fresh-rerun adapter"
  - "apps/web/app/(app)/dashboard/workflows/PinnedWorkflowButton.tsx — Pin / Run again / Remove pin, with honest states"
affects: [29-10 authenticated browser gate, 29-11 recurrence decision (unchanged by this plan)]

tech-stack:
  added: []
  patterns:
    - "Drive a governed action END TO END for $0 by exhausting the daily budget first — `preCall` stops it before the model and returns the stop as DATA"
    - "Derive a repeat ordinal from the insert-only audit plane via a `by_correlation` PREFIX RANGE, so no run-history table is needed"
    - "Assert the no-recurrence ban against the RENDERED text of every state, not against the source, so the comment explaining the ban cannot fail its own scan"

key-files:
  created:
    - packages/backend/convex/pinnedWorkflows.ts
    - packages/backend/convex/pinnedWorkflows.test.ts
    - apps/web/app/(app)/dashboard/workflows/PinnedWorkflowButton.tsx
    - apps/web/app/(app)/dashboard/workflows/PinnedWorkflowButton.test.ts
  modified:
    - packages/backend/convex/savedPrompts.ts
    - packages/backend/convex/_generated/api.d.ts
    - apps/web/app/(app)/dashboard/workflows/page.tsx
    - docs/playbooks/watch.json
    - docs/playbooks/knowledge-search-routines.md
    - docs/playbooks/workflow-packs.md
    - docs/playbooks/cockpit.md

key-decisions:
  - "EXTEND `savedPrompts` (the table), ADD `pinnedWorkflows` (the module). 29-01 already decided the storage question; savedPrompts.ts is deliberately inert and its own test scans it for every recurrence word."
  - "`cockpit.ts` was NOT modified, though the plan names it. `startWorkflowPack` already is the twin; the correct diff there is zero lines, and two facts about it are pinned instead by tests that read it."
  - "The daily BUDGET is not a readiness state. `preCall` is the authoritative gate one hop in, it costs $0 to hit, and a Convex query cannot call a mutation — a reactive copy would be a weaker question wearing the same name."
  - "The test file is `.test.ts`, not the plan's `.test.tsx`: apps/web's runner includes `app/**/*.test.ts` only, so a `.tsx` would never have executed."
  - "No `CUSTOMIZATION_CAPS.maxValuesPerField` clamp on `sourcePreferences`. The membership filter starts from the pack's readable list (≤3 entries), which is a strictly tighter bound; a cap that can never bind is not a guard."

requirements-completed: [ROUT-02]

duration: ~4h
completed: 2026-08-29
---

# Phase 29 Plan 08: Version-Pinned Manual Reruns — Summary

**A tenant can pin an approved workflow and run it again by hand, and every press is
structurally a new run. The surface says the uncomfortable true thing — a pinned customization
is not what runs — instead of the comfortable false one.**

## Task commits

1. **Task 1 — tenant pins and fresh reruns** — `64468c0`
2. **Task 2 — the Pin / Run again controls** — `f434650`

## THE PONYTAIL RUNG-2 DECISION, WITH REASONS

**(a) and (b), split along the seam that actually matters: the TABLE is extended, the MODULE is
new.**

The storage half was not mine to decide — 29-01 already made it. `schema.ts` carries all five
lineage columns (`templateId`, `templateVersion`, `tenantSkillId`, `customizationHash`,
`sourcePreferences`) on `savedPrompts`, under a comment stating that a parallel `pinnedWorkflows`
table "would duplicate all of that AND put a second pin menu in the workspace". Everything a pack
pin needs is there, plus the `by_tenant_template` index added for exactly this read. Building a
second table would have been re-deciding a decision on worse information, and `schema.ts` is not
in this plan's blast radius anyway.

The MODULE is separate for a reason that is not tidiness. `savedPrompts.ts` is deliberately tiny
and inert; its header says "THERE IS DELIBERATELY NO AUTOMATION SUBSTRATE HERE", and
`savedPrompts.test.ts` scans that file for `cron`, `scheduler`, `nextRunAt` and the rest. A
readiness resolver that reads `skills`, `tenantSkills` and the source probe, plus an action that
fires a governed run, does not belong behind that scan — putting it there would have meant
loosening the scan that protects it. So `pinnedWorkflows.ts` owns the five verbs and carries the
same banned-word scan over itself.

**One consequence had to be fixed rather than ignored.** `savedPrompts.list` returned every row,
so a pinned workflow would have appeared in the workspace's PROMPT menu — where Run is an ordinary
Executive-Agent turn through `sendCockpitMessage`. That menu would have offered "Brand review" and
then run something that is not the Brand review pack. One filter (`templateId === undefined`)
closes it, applied after the existing `take` because re-taking to refill the menu would turn a
bounded read into a scan. `savedPrompts.ts` was not in the plan's `files_modified`; the leak was
real, so the file list grew and `cockpit.md` was bumped with it.

## What Task 1 built

`packages/backend/convex/pinnedWorkflows.ts` — `pinWorkflow`, `unpinWorkflow`, `listPins`,
`checkReadiness`, `runAgain`.

**Lineage the caller cannot choose.** `pinWorkflow` takes ONE argument, `templateId`. The version
comes from the live ACTIVE `skills` row; the candidate row id, hash and source preferences come
from the tenant's own newest `tenantSkills` row; the text is the pack's code-owned `opener`. There
is no field a browser could use to pin someone else's row or a version that was never approved.

**`textHash` folds `pinIdentity`, not the text.** The opener is a constant, so every pin of one
pack has byte-identical text — a text-only hash would collapse every customization of a pack onto
the first pin ever taken of it. That is precisely the collision `schema.ts` warned the first
lineage-bearing writer about, and it is now a test.

**`sourcePreferences` is filtered through `packReadableSources`.** A probe value of
`["finance-inputs","crm","http://evil.example","vault"]` is stored as `["vault","finance-inputs"]`
— the pack's own manifest order, membership derived from its operation matrix. No length clamp: the
readable list is at most three entries, which bounds it more tightly than the cap would.

**Readiness is two lists.** `blockers` refuse (`paused`, `template_not_active`); `notices` describe
a run that still happens (`template_republished`, `customization_not_applied`,
`customization_missing`, `sources_unavailable` + a count). Collapsing them is how a UI turns "you
should know" into "you cannot".

**Freshness is structural, not promised.** `runAgain` declares one argument, so no caller can name
a thread, plan, correlation or approval to resume — the arg validator refuses before the handler
runs, and that is a test. It calls `cockpit.startWorkflowPack` with no `threadId`, so
`ensureThreadAndPlan` mints a new thread and a new `plans` row per press.

**The repeat ordinal comes from the audit plane.** There is no run-history table and none was
added. Each run writes one insert-only audit row whose `correlationId` is
`freshRunCorrelation(pinRowId, uuid)`, so the count is a `by_correlation` PREFIX RANGE over that
pin's own rows. The prefix is derived from the same function that mints the correlation, so the
counter and the minter cannot drift.

## What Task 2 built

`PinnedWorkflowButton.tsx` on `/dashboard/workflows`, above the customizer. Five functions
reached, and the test asserts that set is complete in the shipped source. No activation, approval
or rollback control — both mutations are `ownerMutation`s, and a disabled button implying "not yet"
would be the same lie in a different shape.

A run that starts navigates to `/dashboard/workspace?thread=<new>`. A run stopped at the governed
gate does **not** navigate: there is a thread, but sending the user to a conversation whose only
reply is "I've paused for a moment" hides the fact that matters — nothing ran and nothing was
spent.

**A real defect was found by the container test and fixed.** The focus restore after "Remove pin"
was written as an effect that looked once. The unpin mutation resolves BEFORE the live `listPins`
query pushes the removal, so at that moment no replacement button exists — focus fell to the
document body in the real app while the effect cleared its own request. It now happens in the
replacement button's ref callback, which runs when that button mounts.

## THE $0 END-TO-END DRIVE, AND WHY IT IS NOT A SOURCE SCAN

The one link that could not be driven was `runAgain → cockpit.startWorkflowPack`, because a pack
turn ends at a model. It **was** driven, all the way, at zero cost: with the agent, rate-limiter
and aggregate components registered, the test exhausts the tenant's daily budget first.
`runPackTurn` calls `guardrails.preCall` BEFORE the model and returns the governed stop as DATA
(`outcome: "blocked"`, `costUsd: 0`), so the whole production path executes — readiness,
correlation, thread, plan row, pack event log, audit — and no model is contacted.

Two presses of the same pin therefore produce, as **returned and stored values**:

| | first press | second press |
|---|---|---|
| `threadId` | distinct | distinct |
| `plans` rows | one, `collecting` | one, `collecting` |
| `correlationId` | `pin:<row>:<uuid-1>` | `pin:<row>:<uuid-2>` |
| `ordinal` | 1 | 2 |
| spend rows | none | none |

No approved-plan row is read on that path: `runAgain` has no argument that could name one, the pin
row has no `threadId`/`planId`/approval column, and a fresh pack plan row is created at
`collecting` — the assertion is on the stored status, not on a call count.

## Mutations observed RED (and reverted)

**Backend — 9:**

| # | Mutation | Test that went red |
|---|---|---|
| 1 | drop the `packReadableSources` filter in `preferredSources` | "captured BY ROW ID … readable sources" — `crm` and the URL land on the row |
| 2 | hash `spec.opener` instead of `pinIdentity(...)` | "a pin taken after the customization changed is a DIFFERENT pin" |
| 3 | delete `if (killSwitch) blockers.push("paused")` | "the all-stop kill switch is a BLOCKER, not a note" |
| 4 | delete the `customization_not_applied` push | "a pinned customization is reported as NOT applied, every time" |
| 5 | `ordinal = 1` instead of the audit count | "the repeat ordinal counts up" (second press) |
| 6 | reuse the previous run's thread on `startWorkflowPack` | "each press mints its own thread…" — identical thread ids |
| 7 | `freshRunCorrelation(id, "fixed")` | same test — identical correlations |
| 8 | delete the `templateId === undefined` filter in `savedPrompts.list` | "a workflow pin never appears in the prompt menu" |
| 9 | skip the `!check.runnable` gate in `runAgain` | "a blocked pin never reaches the cockpit: no thread, no plan, no audit, no spend" |

**UI — 9:**

| # | Mutation | Test that went red |
|---|---|---|
| 10 | `onPin` click handler → no-op | "pressing Pin sends the pack id and nothing else" |
| 11 | `onRun` click handler → no-op | "pressing Run again sends the PIN id…" |
| 12 | delete `router.push(threadHref(...))` | same test — the run happens and the user is left on a button |
| 13 | navigate on `res.ok` instead of `res.ran` | "a run stopped at the gate … does NOT navigate" |
| 14 | `disabled={busy}` (drop `!pin.runnable`) | "a BLOCKED pin cannot be run, and says why" |
| 15 | invert the `customization_not_applied` copy | "a pinned customization is announced as NOT used" |
| 16 | delete `setFocusPack(packId)` from the unpin success arm | "focus lands on the Pin control that replaced…" |
| 17 | delete the `focusPack === packId` branch from `registerPinButton` | same test |
| 18 | put "It runs automatically every day." in the intro | "no state of this surface implies anything runs by itself" |

An earlier variant of #17 (an effect keyed only on `focusPack`) is the defect this suite caught
before it shipped; see above.

## Gates — the CORRECTED commands, with real output

The plan's two gate commands are no-ops on this machine and were **not run as written**:
`pnpm --filter @pikar/<pkg> test -- <filter>` swallows the `--`, and `node
scripts/check-playbooks.mjs` run bare hangs on stdin and signals by PRINTING.

| Command | Output |
|---|---|
| `cd packages/backend && pnpm vitest run pinnedWorkflows savedPrompts cockpit` | **11 files / 350 tests passed** |
| `cd packages/backend && pnpm vitest run` | **115 files / 3227 tests — 3225 passed, 2 failed.** Both failures are other lanes'; see below the table. |
| `cd packages/backend && pnpm typecheck` | **clean** |
| `cd apps/web && pnpm vitest run PinnedWorkflowButton` | **1 file / 28 tests passed** |
| `cd apps/web && pnpm vitest run` | **39 files / 790 tests passed** (baseline 38/762 with 29-09 landed; +1 file, +28 = exactly this plan) |
| `cd apps/web && pnpm typecheck` | **clean** |
| `cd packages/core && pnpm vitest run` | **46 files / 1477 tests passed** |
| `cd packages/contracts && pnpm vitest run` | **6 files / 99 tests passed** |
| `pnpm --filter @pikar/web build` | **exit 0.** `/dashboard/workflows` is in the route table. The known `server-only` worktree artifact did NOT reproduce on this run. |
| `echo '{}' \| node scripts/check-playbooks.mjs check` | **empty stdout — passed** |
| `npx biome check` on all four new files + `page.tsx` + `watch.json` | clean after `--write` |
| `git diff --stat HEAD -- "*.ts" "*.tsx"` after both commits | **empty** — HEAD is the tree the gates ran against |

**The full backend suite: `cd packages/backend && pnpm vitest run` → 115 files / 3227 tests,
113 files / 3225 tests PASSED, 2 failed. NEITHER FAILURE IS MINE, and both were checked rather
than assumed:**

- `convex/env.test.ts` — "every consumed name is classified" reports `QUICKBOOKS_CLIENT_ID`,
  `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI` unclassified. That is Phase 28's connector
  lane; 29-07's summary already recorded this same file as the known red on 2026-08-29, and
  `git log` on it ends at `c21b0f9`/`483d0ed` (phase 25.1). Nothing in my diff touches env.
- `convex/media.test.ts` — "a transcript with no usable words never buys a sandbox", a `fetchMock`
  call count. **It PASSES in isolation** (`pnpm vitest run media -t "never buys a sandbox"` →
  1 passed), so it is a full-suite load/order flake in the file the media lane last touched
  (`daf160c`). My diff contains no media, render or fetch code.

The pin/rerun surface itself was also run against the three files the plan names, together and
alone, and is green in both.


## A CONCURRENT LANE WAS COMMITTING INTO THIS WORKTREE

Plan **29-11** (the recurrence decision gate) was writing to the same working tree during this
session — `routineDecision.test.ts`, `routineSchedule.ts`, `check-routine-gate.mjs`, and edits to
`watch.json` and `knowledge-search-routines.md`. Two consequences, both handled:

1. A `packages/backend` typecheck taken mid-session was RED with three errors, **all** in
   `convex/routineDecision.test.ts` and none in any file of mine. It was clean before that file
   appeared and clean again after that lane fixed it.
2. `watch.json` and `knowledge-search-routines.md` carried their uncommitted edits. My commit
   stages a **HEAD + my hunks only** version of both files while the working tree keeps both
   lanes' changes, so nothing of theirs was committed under my message and nothing of theirs was
   lost. That lane has since committed (`24064ab`, `dab7330`).

## WHAT I COULD NOT DO

- **No browser has loaded the Pin or Run again controls.** There is no Playwright spec for
  `/dashboard/workflows` and the route is still absent from the nav. The plan told me not to write
  one; the orchestrator's live gates are the only thing that can close this.
- **No model has answered a pinned run.** Every backend drive is a $0 governed stop at the budget
  gate. A real run needs a live deployment and money.
- **Cost is not on the pin's audit row.** `startWorkflowPack` returns `{threadId, ok, outcome}` and
  neither the pack's `runId` nor its `costUsd`, so the pin plane records outcome and latency only.
  The money is joinable through the pack's own `workflowPackEvents`/`spendEvents` `runId`. Fixing
  it means returning the `runId` from `startWorkflowPack` — a `cockpit.ts` change this plan did not
  own. Recorded in the playbook.
- **`cockpit.ts` is in the plan's `files_modified` and my diff does not touch it.** That is
  deliberate, not an oversight: `startWorkflowPack` already was the twin the plan asked for, and
  adding a line to satisfy a file list would be a change with no reason. The two facts this plan
  DEPENDS on are pinned instead by tests in `pinnedWorkflows.test.ts` that read `cockpit.ts` — it
  still passes no `tenantSkillIds` (which is what makes "your customization is not used" true), and
  its `threadId` is still optional with `ensureThreadAndPlan` minting a new thread when absent
  (which is the freshness mechanism). If either changes, this plan's copy becomes a lie and those
  tests go red.
- **The plan's `PinnedWorkflowButton.test.tsx` does not exist.** It is `.test.ts`, because
  `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only and a `.tsx` there would never
  execute.
