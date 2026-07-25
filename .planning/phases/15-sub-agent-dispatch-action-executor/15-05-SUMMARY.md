---
phase: 15-sub-agent-dispatch-action-executor
plan: 05
subsystem: cockpit
tags: [action-executor, exhaustive-dispatch, typescript, satisfies, static-scan, convex-test, refactor]

# Dependency graph
requires:
  - phase: 15-sub-agent-dispatch-action-executor
    plan: 01
    provides: "the closed ACTION_TYPES = [email, memo] union + actionTypeOf (absent plans.kind ⇒ email), and dispatchGuard.test.ts's `// 15-05 adds:` marker"
  - phase: 12-business-evaluation-engine
    provides: "the MEMO TERMINAL this plan generalized — plans.kind, persistNextStepMemo, and the byte-unchanged deliverApprovedPlan.ts that made the gmail fan-out structurally unreachable from a memo"
  - phase: 03-cockpit
    provides: "executePlan as the human Approve gate (tenantMutation + CAS), startFanout as the SOLE workflow.start(deliverApprovedPlan) call site, and buildCockpitTools' 20-key tool record"
provides:
  - "packages/core/src/actionType.ts — the Arm type, armFor over a `satisfies Record<ActionType, Arm>` TABLE (not a ternary), and assertNever"
  - "executePlan as the action-type DISPATCHER: an exhaustive switch over armFor(actionTypeOf(plan.kind)) with an assertNever backstop, replacing the ad-hoc `plan.kind === \"memo\"` if"
  - "_ARM_TABLE in cockpit.ts — the dispatcher's own compile-time bind, because the `workflow` case IS the gmail fan-out"
  - "dispatchGuard.test.ts — 3 Approve-gate scans (executePlan is a tenantMutation; absent from every tool-record key; llm.ts holds no reference to it or to deliverApprovedPlan at all)"
  - "gapAction.test.ts — the arm-SELECTION-ORDER pins on both sides (no mailbox ⇒ still approves; escalated ⇒ neither arm runs)"
affects: [15-06, 16, 17, 18, 19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "`as const satisfies Record<Union, T>` as the arm table — a ternary is total by construction and hides a widened union"
    - "Mutation-check a compile-time claim by temporarily widening the union and reading tsc's error (TS2741)"
    - "Characterization tests before a refactor: green on both sides by design, and that IS the assertion"

key-files:
  created: []
  modified:
    - packages/core/src/actionType.ts
    - packages/core/src/actionType.test.ts
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/gapAction.test.ts
    - packages/backend/convex/dispatchGuard.test.ts
    - docs/playbooks/cockpit.md

key-decisions:
  - "armFor is a TABLE lookup in @pikar/core, not the plan's ternary — a ternary is total by construction, so widening ACTION_TYPES would silently route a new member to the else-branch's arm instead of failing to compile, defeating the plan's own headline guarantee"
  - "cockpit.ts keeps its own _ARM_TABLE bind despite core's table, because the `workflow` case falls through to the GMAIL fan-out: a new type that merely classified as workflow would inherit the email terminal silently"
  - "The email arm and the pre-existing guards are NOT re-asserted in gapAction.test.ts — cockpit.test.ts already pins all of them (24 tests); the plan's own verify command runs both files, which is the proof"
  - "assertNever lives in @pikar/core beside the union, not in a shared ts-utils — one union, one backstop, no new module"

patterns-established:
  - "A compile-time claim gets mutation-checked the same way a test does: remove the @ts-expect-error / widen the union, watch tsc fail, restore"
  - "A static scan that must ignore doc prose strips BLOCK comments too, and carries a non-vacuity FLOOR (≥20 tool keys) rather than an equality that Phases 16-19 would break"

requirements-completed: [ACTN-01]

# Metrics
duration: 13min
completed: 2026-07-25
---

# Phase 15 Plan 05: The Generalized Action Executor Summary

**`executePlan` stopped branching on an ad-hoc `plan.kind === "memo"` if and became a dispatcher over a closed action-type table — and "adding an action type without an arm is a compile error" is now a verified `tsc` failure in three files rather than a comment.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-07-25T20:15:10Z
- **Completed:** 2026-07-25T20:27:49Z
- **Tasks:** 3 of 3 (2 TDD)
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments

- **The spine dispatches by ACTION TYPE.** `armFor(actionTypeOf(plan.kind))` selects the arm; the
  memo arm and the email arm are now two entries in one table instead of an `if` and everything
  after it. The arms are the EXISTING code paths — behaviour is byte-identical, which is what the
  unchanged 24-test `cockpit.test.ts` proves.
- **The compile-error claim is CHECKED, not asserted.** Adding `"calendar"` to `ACTION_TYPES` was
  temporarily done and `tsc` failed in three places at once: `actionType.ts` (armFor's table),
  `actionType.test.ts` (the fixture), and `cockpit.ts` (`_ARM_TABLE`) — all TS2741, "Property
  'calendar' is missing". The `@ts-expect-error` fixture was mutation-checked the same way
  (removing the suppression yields the error; leaving it makes the build green).
- **The branch ORDER is pinned on BOTH sides, by assertion rather than by comment.** 12-05 left a
  NOTE saying "no gmailTokens row is seeded, so a passing approve proves the memo branch runs before
  the mailbox pre-check"; that premise is now an assertion (`gmailTokens` is empty). And the other
  half is new: an ESCALATED memo refuses with `review_escalated` and runs NEITHER arm — no vault
  doc, no `requests` row, no CAS flip. Moving arm selection one line earlier would let a fail-closed
  plan execute an action, which is exactly the mistake a table-shaped refactor invites.
- **`deliverApprovedPlan.ts` is byte-unchanged** (`git diff --exit-code`, part of the gate). Two
  levels: `executePlan` picks the arm, and `deliverApprovedPlan` is the workflow-backed EMAIL arm's
  entry point — not the universal dispatcher. Routing an inline arm through it would re-expose the
  gmail fan-out as reachable-in-principle from every action type.
- **The human Approve gate is statically fenced off from the model.** Three scans: `cockpit.ts` must
  declare `export const executePlan = tenantMutation({`; `executePlan` / `approvePlan` /
  `deliverApprovedPlan` must be absent from `buildCockpitTools`' `name: tool({` keys (20 found, with
  a ≥20 non-vacuity floor so Phases 16-19 can add tools without breaking it); and `llm.ts` must
  contain no `internal.cockpit.executePlan` / `api.cockpit.executePlan` / `deliverApprovedPlan`
  reference **at all** — otherwise a tool could reach Approve under some other key. Both mutation-
  checked (an injected tool key and an injected `runMutation` reference are each caught).
- **Zero Lane-A collisions.** `git diff --exit-code` over `llm.ts`, `dispatch.ts`, `evaluations.ts`,
  `specialists.ts` and `apps/` is clean for the whole plan.

## Task Commits

1. **Task 1: the arm table's type half (TDD)** — `147d665` (feat; RED confirmed — 4 failing — before GREEN)
2. **Task 2 characterization tests** — `d5986a6` (test)
3. **Task 2: executePlan becomes the dispatcher** — `c569baa` (refactor)
4. **Task 3: the Approve-gate scans + the playbook** — `0fc3046` (test)

## Files Created/Modified

- `packages/core/src/actionType.ts` — `Arm`, the `ARMS` table (`as const satisfies Record<ActionType, Arm>`), `armFor`, `assertNever`
- `packages/core/src/actionType.test.ts` — +4 runtime assertions (per-type arm, totality over `ACTION_TYPES`, `assertNever` names the value) + the two compile-time fixtures
- `packages/backend/convex/cockpit.ts` — the exhaustive arm switch replacing the memo `if`; the module-level `_ARM_TABLE` bind; 6 new imports from `@pikar/core`
- `packages/backend/convex/gapAction.test.ts` — the no-mailbox premise turned into an assertion + the escalated-memo test (5 tests total)
- `packages/backend/convex/dispatchGuard.test.ts` — 3 Approve-gate scans below the `// 15-05 adds:` marker, with a block-comment-stripping reader (5 tests total)
- `docs/playbooks/cockpit.md` — the append-only `### Phase 15 — Lane B (generalized executor)` subsection + a bumped `Last verified`

## Decisions Made

- **`armFor` is a table, not the plan's ternary.** The plan specified
  `(t) => t === "email" ? "workflow" : "inline"`. That is total by construction: adding `"calendar"`
  to `ACTION_TYPES` would compile fine and silently classify it as `inline` — the exact opposite of
  the plan's own must_have ("adding an action type without an arm is a COMPILE error"), and the
  plan's `ACTION_TYPES.every(t => armFor(t) !== undefined)` test would pass vacuously forever. A
  `satisfies Record<ActionType, Arm>` table makes the guarantee real and makes that test meaningful.
- **`cockpit.ts` keeps a second bind anyway.** Not redundancy: the `workflow` case in the switch
  falls through to the gmail fan-out (seed `requests` → `startFanout` → `deliverApprovedPlan`), so a
  new action type that merely *classified* as `workflow` would inherit the EMAIL terminal without
  anyone deciding to. `_ARM_TABLE` fails to compile the day `ACTION_TYPES` grows, forcing that
  author into the dispatcher. The switch's `assertNever` covers a new ARM; `_ARM_TABLE` covers a new
  TYPE. Both are compiler-forced, so the two tables cannot silently drift.
  **Honest qualification recorded in the playbook:** "zero spine edits" means the spine's STRUCTURE
  never changes again — a new type still adds one compiler-demanded line to `_ARM_TABLE`.
- **The email arm and the pre-existing guards were not duplicated into `gapAction.test.ts`.**
  `cockpit.test.ts` already pins `gmail_not_connected`, `alreadyStarted`, the cross-tenant throw,
  `review_escalated`, one `requests` row per recipient, the attachment fan-out, personalization,
  reply threading, the deferred-send arm/cancel and skill-version copying. The plan's own verify
  command runs both files; re-asserting them would be a second copy to keep in sync (CLAUDE.md §8).
  What was genuinely missing — the two ORDERING properties specific to arm selection — was added.
- **A refactor has no honest RED.** The characterization tests were written and confirmed green
  against the pre-refactor `if`, then confirmed green after. That is the correct discipline here,
  and the fact is recorded in the test commit rather than dressed up as TDD.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The plan's `armFor` ternary could not deliver the plan's own compile-time guarantee**
- **Found during:** Task 1 (GREEN)
- **Issue:** The plan supplied `export const armFor = (t: ActionType): Arm => (t === "email" ? "workflow" : "inline");`. A ternary is TOTAL over any widening of the union, so `ACTION_TYPES` could gain `"calendar"` with `tsc` staying green and the new type silently executing as `inline`. The plan's must_have truth ("Adding an action type without an arm is a COMPILE error") and its own totality test (`armFor(t) !== undefined`, which can never fail against a ternary) both depended on this not being a ternary.
- **Fix:** `armFor` reads a module-private `ARMS = {...} as const satisfies Record<ActionType, Arm>` table. Same signature, same behaviour, same call sites; the guarantee is now real.
- **Verification:** temporarily added `"calendar"` to `ACTION_TYPES` → TS2741 in `actionType.ts:27`, TS7053 at the lookup, TS2741 in `actionType.test.ts` and in `cockpit.ts`. Restored, clean.
- **Files modified:** `packages/core/src/actionType.ts`
- **Commit:** `147d665`

**2. [Rule 3 - Blocking] `biome check --write` normalized 3 pre-existing format hunks in `cockpit.ts`**
- **Found during:** Task 2
- **Issue:** `cockpit.ts` was already format-dirty before this plan (verified: `biome check` on the `b9e61ae` version reports 2 format errors), so running the repo's own formatter over the file I was editing pulled in an import re-sort, a `withIndex` line join and a `ctx.db.patch` object expansion.
- **Fix:** kept — they are the formatter's own deterministic output, contain no behaviour, and leave the file lint-clean. There is no root `lint` script, so this was never a CI gate either way.
- **Files modified:** `packages/backend/convex/cockpit.ts` (cosmetic hunks only)
- **Commit:** `c569baa`

---

**Total deviations:** 2 auto-fixed (1 bug in a plan-supplied implementation that would have voided the plan's headline guarantee, 1 incidental formatter normalization).
**Impact on plan:** No scope creep, no architectural change. Deviation 1 preserves the plan's stated intent while making its premise true.

## Out-of-scope discoveries (logged, NOT fixed)

- `packages/backend/convex/cockpit.ts:617` — Biome's `lint/complexity/useOptionalChain` warning on
  `(plan.recipientBodies ?? {})[recipient] ?? body` (pre-existing, unrelated to this plan, and its
  suggested fix is marked UNSAFE). Not touched.
- The two pre-existing items in `deferred-items.md` (`@pikar/audit` has no `tsconfig.json`;
  `replyToMessage` has no `VERB` entry) are unchanged.

## Verification

| Gate | Result |
|------|--------|
| `pnpm --filter @pikar/core exec vitest run` | 223/223 green (16 files; +4 new) |
| `pnpm --filter @pikar/backend exec vitest run` | 508/509 — sole red is the documented pre-existing `audit.test.ts` `auditCounts` row (+4 new tests over 15-02's 505) |
| `convex/gapAction.test.ts` + `convex/cockpit.test.ts` | 29/29 green (5 + 24 — every pre-existing executePlan assertion untouched, which is the refactor's proof) |
| `convex/dispatchGuard.test.ts` | 5/5 green (2 Wave-0 scans + 3 new) |
| `@pikar/core` `tsc --noEmit` | exit 0, clean (and the `@ts-expect-error` fixture is load-bearing — removing it yields TS2741) |
| backend `tsc --noEmit` | 52 errors — the exact pre-existing baseline, ZERO in any non-test file |
| `apps/web` `tsc --noEmit` (Pitfall 4 tripwire) | exit 0 |
| `npx turbo run typecheck --continue` | 8 successful / 10 — the documented baseline |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| `git diff --exit-code -- packages/backend/convex/deliverApprovedPlan.ts` | exit 0 — BYTE-UNCHANGED |
| `git diff --exit-code -- llm.ts dispatch.ts evaluations.ts specialists.ts apps/` | exit 0 — no Lane-A file, no web file touched |
| Compile-error mutation check (`"calendar"` added to `ACTION_TYPES`) | TS2741 in `actionType.ts`, `actionType.test.ts` AND `cockpit.ts` |
| Static-scan mutation check | an injected `executePlan: tool({` key and an injected `internal.cockpit.executePlan` reference are both caught |

## Issues Encountered

None. The refactor landed without touching behaviour; the only surprise was the plan's ternary
(deviation 1), caught by asking what its own totality test could actually fail on.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**FOR PHASES 16-19 (each adds ONE action type):**
1. Add the literal to `ACTION_TYPES` in `packages/core/src/actionType.ts` — `tsc` will immediately
   demand its arm in `ARMS` (and in `actionType.test.ts`'s fixture) and in `cockpit.ts`'s
   `_ARM_TABLE`. Follow the compiler; there is nothing else to find.
2. Widen `plans.kind` in `schema.ts` (it is `v.optional(v.literal("memo"))` today — a closed literal
   on purpose, so widening is a deliberate schema edit).
3. Decide the arm honestly. `inline` = ONE transactional write, executed in the switch's inline case.
   `workflow` today means THE GMAIL FAN-OUT — a new durable action must start its OWN workflow, not
   fall through to `startFanout`. **Do not open `deliverApprovedPlan.ts`.**
4. Arm selection must stay where it is: after the CAS read and the `escalated` guard, before the
   mailbox pre-check. `gapAction.test.ts` asserts both sides of that position.
5. Whatever the action, it stages a write into the plan row for the human Approve gate. Do not add
   `executePlan` (or any approve/deliver function) to a tool record — `dispatchGuard.test.ts` fails
   the build if you do, and `llm.ts` may not even name it.

**FOR 15-06:** `docs/playbooks/cockpit.md`'s `## Phase 15` container is append-only per-plan
subsections; `apps/web` remains FROZEN; `docs/playbooks/watch.json` is a Wave-0 singleton.

---
*Phase: 15-sub-agent-dispatch-action-executor*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 6 modified files exist on disk and all 4 task commits resolve in git history. Every `must_haves`
artifact assertion verified: `actionType.ts` exports `ACTION_TYPES`, `actionTypeOf`, `Arm`, `armFor`
and `assertNever`; `cockpit.ts` contains `satisfies Record<ActionType` (2 occurrences — the
`_ARM_TABLE` bind and its doc comment) plus the `actionTypeOf`, `persistNextStepMemo` and
`startFanout` key-link patterns; `dispatchGuard.test.ts` scans `buildCockpitTools`' keys for
`executePlan`. `deliverApprovedPlan.ts` is byte-unchanged.
