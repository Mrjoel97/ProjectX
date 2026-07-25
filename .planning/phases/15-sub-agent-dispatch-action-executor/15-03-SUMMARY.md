---
phase: 15-sub-agent-dispatch-action-executor
plan: 03
subsystem: agent-runtime
tags: [dispatch, sub-agent, governance, cost-envelope, lineage, audit, adr, convex, vitest]

# Dependency graph
requires:
  - phase: 15-sub-agent-dispatch-action-executor
    plan: 01
    provides: "the three dispatch* agentSteps.tool literals, internal.guardrails.remainingDailyCents (clamped >= 0), the fail-closed resolveSpecialist, and the convex/dispatch.ts lane-owned stub"
  - phase: 15-sub-agent-dispatch-action-executor
    plan: 02
    provides: "runSpecialistTurn (THE one exported specialist entry into the governed loop, returning skillVersion), SPECIALISTS/SPECIALIST_ROUTES, wouldCycle, and ADR-007's code-owned tool grant"
  - phase: 12-business-evaluation-engine
    provides: "internal.evaluations.lastForThread — the persisted snapshot the specialist prompt is built from (evaluateBusiness is deliberately not granted)"
  - phase: 03-cockpit
    provides: "the insert-only audit.log + by_correlation index, the agentSteps record/finish trace, and the PAUSED_REPLY governed-stop copy precedent"
provides:
  - "governedDispatch — THE governance function: resolve -> depth -> cycle -> envelope -> run, shared by both Convex entry points"
  - "internal.dispatch.runSpecialist — the production internalAction (explicit Promise<DispatchResult>)"
  - "internal.dispatch.__runSpecialistWithScript — the offline twin driving the REAL loop with a mock script"
  - "DispatchResult / DispatchRefusal — the discriminated governed-stop contract (4 refusals, all conversational, never a throw, never a DLQ)"
  - "ENVELOPE_FRACTION = 0.25 — one tree-local cost ceiling derived from the live daily rail, carried unchanged across hops"
  - "subagent.dispatched / subagent.completed / subagent.refused — refs-only lineage on correlationId := rootRequestId"
  - "ADR-008 — dispatch lineage + limit state travel as validator-checked call args, never DB state"
affects: [15-04, 15-06, 15.1, 16, 17, 18, 19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ONE governance function + two thin Convex entry points — a guard cannot be true in tests and absent in production"
    - "Governed stop = a discriminated RETURN with a conversational reply; zero deadLetters, zero model spend, zero agentSteps rows"
    - "Lineage by correlationId reuse — an existing index reconstructs a call tree with no new table and no schema change"
    - "§4 asserted TWICE: over every payload VALUE a run writes, and statically over the source (payloads + the object they spread)"
    - "Cross-tenant isolation asserted under a deliberate id COLLISION with non-empty partitions on both sides"

key-files:
  created:
    - docs/decisions/008-dispatch-state-travels-as-call-args.md
  modified:
    - packages/backend/convex/dispatch.ts
    - packages/backend/convex/dispatch.test.ts
    - packages/backend/convex/llmRedaction.test.ts
    - docs/playbooks/cockpit.md

key-decisions:
  - "The guard ORDER (resolve -> depth -> cycle -> envelope -> run) is load-bearing: the envelope check is LAST so a refusal that costs nothing is never charged against the tree, and resolve is FIRST because gaps[].route persists as v.string() including diagnose()'s deliberate \"\""
  - "All four refusals RETURN a conversational reply and write NO deadLetters row — the PAUSED_REPLY precedent; none names its internal reason code to the user"
  - "The envelope is a TREE-LOCAL SECOND ceiling over the deployment-wide dailySpendCents rail, derived only at the root and carried unchanged across hops — NOT guardrails.preCall, which asks 'is there ANY budget left'"
  - "An overrunning hop KEEPS its output and is labelled incomplete: true — stop AFTER the call that overran, never discard work already paid for"
  - "Lineage is audit-ONLY with correlationId := rootRequestId: no subAgentRuns table, no telemetry mirror, nothing on agentSteps — three deliberate NON-decisions pinned as source comments"
  - "ADR-008: depth/ancestry/envelope/spend are internalAction args, never DB state — a Convex action has no ambient ctx, and a row is a lost-update race on the one field whose job is to be a ceiling"
  - "rootRequestId is minted fresh and is NOT planId (recycled per thread, 12-05) nor plans.correlationId (only set at executePlan, i.e. after Approve)"

patterns-established:
  - "Mutation-check every new static/structural scan before claiming it (both §4 scans and the envelope-carry assertion were driven RED, then reverted)"
  - "A cross-tenant isolation test must assert NON-EMPTY partitions on both sides — a zero-size partition passes a naive no-leakage check vacuously"
  - "Read the audit table DIRECTLY when the invariant is about lineage rows: audit has no public tenant-scoped reader, so a plan-level assertion would prove the wrong thing"

requirements-completed: [DISP-01]

# Metrics
duration: ~35min
completed: 2026-07-26
---

# Phase 15 Plan 03: The Governed Dispatcher Summary

**A named specialist now runs in THE governed loop behind four conversational refusals, one
tree-local cost envelope drawn down across the whole sub-agent tree, and a refs-only call tree that
reconstructs from an index that already existed — no new table, no new index, no schema change.**

## Performance

- **Duration:** ~35 min (Task 1 ~20 min; Tasks 2-3 ~16 min after an infrastructure restart)
- **Tasks:** 3 of 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- **ONE governance function, two thin entry points.** `governedDispatch(ctx, args, run)` holds
  every guard; `runSpecialist` (production, closing `run` over `llm.runSpecialistTurn`) and
  `__runSpecialistWithScript` (the offline twin, same function with a mock script) both call it. A
  guard therefore cannot be true in tests and absent in production — the whole 22-test suite drives
  the REAL loop through the REAL guards with zero model spend.
- **The guard order is load-bearing and now documented as such:** resolve → depth → cycle →
  envelope → run. `resolveSpecialist` is FIRST because `gaps[].route` persists as `v.string()`
  (`schema.ts:350`), so rows written before 15-02 closed the union — including `diagnose()`'s
  deliberate `""` — reach here un-narrowed; the runtime branch is the real guard. The envelope check
  is LAST so a refusal that costs nothing is never charged against the tree.
- **Four refusals, every one a paused conversation.** `unknown_route` / `depth_exceeded` /
  `cycle_refused` / `budget_exhausted` each RETURN a discriminated result with a calm sentence that
  never names its internal reason code, write **zero `deadLetters` rows**, spend **zero model
  budget** (asserted on the untouched daily rail, not inferred), and paint **zero `agentSteps`
  rows** — a refused dispatch never started. The cockpit still has never DLQ'd a user-facing turn.
- **Cycle refusal ships at a depth where it is structurally unreachable.** `MAX_DEPTH = 1` already
  makes A→B→A impossible, but `wouldCycle` (the SHARED `@pikar/core` predicate, not a re-derived
  inline `includes`) runs anyway and is tested in both shapes — a repeated specialist and a genuine
  A→B→A chain. The guarantee is tested the day the cap rises, not written that day.
- **ONE envelope for the whole tree.** Derived at the root only —
  `floor(remainingDailyCents × 0.25)` — and a non-zero incoming value is carried through
  **unchanged**, which is what makes it a tree ceiling instead of a fresh allowance per hop. The
  drawdown is asserted **on the `subagent.completed` rows' `spentCents`**, so it is observable
  rather than inferred. Mutation-checked: making the derivation unconditional turns three tests red.
- **A drained rail cannot produce a negative ceiling.** `recordSpend` consumes with `reserve: true`
  and drives the window negative on purpose; `remainingDailyCents` clamps to 0, so an underwater day
  yields a zero envelope and a `budget_exhausted` refusal — never a negative number that would
  refuse everything by arithmetic accident. Driven with a real 2000-cent overspend against a
  500-cent rail.
- **An overrunning hop keeps its output.** Stop AFTER the call that overran; the body comes back
  with `incomplete: true`. Paired with a non-vacuity companion (a hop well inside its envelope is
  NOT labelled incomplete), so the flag means something. Same honesty posture as Phase 12's
  not-enough-data verdict.
- **SC #3 with zero new persistence.** Three `internal.audit.log` inserts per hop, all with
  `correlationId: rootRequestId`. `audit.by_correlation` already existed, so a two-hop run
  reconstructs as four ordered rows, `parentAgentId` rebuilds the **edges**
  (`executive → offer-architect → lead-engine`), and the tree's cost is a SUM over the completed
  rows that matches the hops' returned `costUsd`. No `subAgentRuns` table, no telemetry mirror,
  nothing on `agentSteps` — all three are deliberate NON-decisions pinned as source comments so a
  reviewer does not read them as oversights.
- **§4 asserted twice, both mutation-checked.** At runtime: every payload VALUE of every audit row
  written during a run is scanned against the scripted reply and each of its distinctive words, so a
  future field addition cannot leak quietly. At the source: `llmRedaction.test.ts` pins
  `dispatch.ts` to exactly three `payload:` expressions and scans them **plus the shared `refs`
  object they spread** for `reply`/`body`/`text`/`output`. Adding `leak: turn.reply` trips both.
- **SC #5 under a deliberate collision.** Tenant B dispatches with tenant A's `rootRequestId`
  *verbatim* on the same `threadId`, both hops really run and really write, and the lineage
  partitions cleanly with **non-empty partitions on both sides**. The audit table is read directly
  and the reason is in a comment: `audit` has no public tenant-scoped reader, so the `plans.byThread`
  form (also shipped) would prove isolation of the PLAN, not of the lineage rows SC #5 names.
- **The specialist's context rides the PROMPT.** `buildSpecialistPrompt` reads
  `internal.evaluations.lastForThread` and caps it (8 findings, 160 chars a label) the way
  `evaluateBusiness` caps its synopsis. That is why `evaluateBusiness` is not in the grant and must
  not be added — it WRITES a row and re-enters the engine mid-dispatch (ADR-007).
- **ADR-008** records why six pieces of state travel as validator-checked `internalAction` args: a
  Convex action has no ambient context and a `ctx` cannot be extended across `runAction`, so the
  only alternative was a DB row — a lost-update race on the one field whose entire job is to be a
  ceiling, plus a row to clean up, for zero benefit at depth 1. It also records that
  `rootRequestId` is minted fresh and is neither `planId` (recycled per thread, 12-05) nor
  `plans.correlationId` (only written at `executePlan`, i.e. after Approve).

## Task Commits

1. **Task 1** — `4065571` (feat): `dispatch.ts` + the resolve/depth/cycle/refusal-shape suite
2. **Task 2** — `20ccdcd` (test): the shared envelope, the drawdown, the SC#3 lineage, both §4 scans
3. **Task 3** — `bbcf33d` (test): SC#5 two-tenant isolation + ADR-008 + the cockpit playbook

## Files Created/Modified

- `packages/backend/convex/dispatch.ts` (356 lines) — `MAX_DEPTH`, `ENVELOPE_FRACTION`, the four
  refusal reply constants, `buildSpecialistPrompt`, the shared `dispatchArgs` validators, the
  `_stepTools` compile-time bind, `governedDispatch`, `runSpecialist`,
  `__runSpecialistWithScript`. No `generateText` — dispatch is a SEQUENTIAL second call into the
  one loop, and `dispatchGuard.test.ts` pins that.
- `packages/backend/convex/dispatch.test.ts` (593 lines, 22 tests) — SC#1 happy path + tool-grant
  withholding + its non-vacuity companion, the five-case refusal table, the envelope suite
  (derivation / drawdown / exhaustion / overrun / negative clamp), the SC#3 lineage +
  §4 value scan, the SC#5 isolation pair, and the trace-terminalizes pair.
- `packages/backend/convex/llmRedaction.test.ts` — the source-level `dispatch.ts` §4 scan.
- `docs/decisions/008-dispatch-state-travels-as-call-args.md` — new ADR.
- `docs/playbooks/cockpit.md` — the Lane-A subsection gained the dispatcher's operating rules
  (guard order, the four refusals, the envelope's two traps, audit-only lineage and its three
  NON-decisions, the §4 payload shape, the no-`generateText` rule); `Last verified` bumped.

## Decisions Made

- **The envelope check is guard 4, after cycle.** A refusal that never reaches a model must not be
  charged against — or blocked by — the tree's budget. The reverse order would make a drained
  envelope mask an unknown-route bug.
- **`skillVersion` rides the `subagent.completed` rows only.** `subagent.dispatched` is written
  BEFORE the loop and the §5 loader resolves the active version *inside* `runSpecialistTurn`, so a
  version on the dispatched row would be a second, drift-prone lookup. The lineage test asserts the
  refs on every row and `skillVersion` on the completed ones, and binds it to `getActiveSkill`.
- **The §4 runtime scan reads the WHOLE `audit` table, not just `by_correlation(rootRequestId)`.**
  A leak into a row written under a different correlation key during the same run would otherwise
  pass. Word-level scanning (≥5 chars) with a floor assertion on the word count keeps it non-vacuous.
- **The static §4 scan pins the payload COUNT at 3 and scans the spread source.** All three
  payloads spread a shared `refs` object, so scanning only the `payload:` expressions would miss a
  leak added one line above them; and a fourth lineage write is a new §4 surface that should have to
  visit this test, exactly as `cockpit.ts`'s two `audit.log` sites are pinned.
- **The SC#5 collision reuses the same `threadId` as well as the same `rootRequestId`.**
  `plans.by_thread` is `(tenantId, threadId)`, so tenant B's row is legitimate — which makes it the
  maximal collision rather than two unrelated runs that would partition trivially.

## Deviations from Plan

### Scope shift between Task 1 and Task 2 (not a deviation in substance)

The Task-1 agent implemented **all** of `dispatch.ts` in its commit, including the envelope
derivation and the three lineage inserts the plan assigned to Task 2. That is a better commit
boundary than the plan's (splitting a 15-line ternary and three `audit.log` calls out of the
function they live inside would have produced an intermediate state where `governedDispatch` had a
`budget_exhausted` member in its type union and no code path reaching it). Task 2 therefore landed
as its behavioural test surface plus the source-level scan — the file's Task-2 content was verified
against the plan line by line and matched it, and every Task-2 `<behavior>` bullet is now a real
assertion. Task 2's commit is typed `test` rather than `feat` to say so honestly.

### Auto-fixed Issues

**None.** No Rule 1/2/3 fix was needed: the plan's premises held, the seams 15-01 and 15-02 left
were the ones described, and every new assertion passed on first run against the existing
implementation.

### Verification-driven work beyond the plan's letter

**Mutation-checking, unprompted.** Three of this plan's new assertions are structural scans, and a
structural scan that has never been driven red is a comment. Two mutations were injected and
reverted: `leak: turn.reply` on the completed payload (trips BOTH §4 scans — the source scan and
the runtime value scan) and an unconditional envelope re-derivation (trips the drawdown, the
drained-envelope and the overrun tests). Recorded in the source comments so the claim is
attributable.

## Out-of-scope discoveries (logged, NOT fixed)

- **Two full-suite timeout flakes, load-induced, pre-existing.** On a busy machine
  `cockpitDraft.test.ts > draftCockpit loads the email-drafter body` (5.4s) and
  `voice.test.ts > storeBrief drafts via the SMOKE transcript` (9.0s) cross vitest's 5s default
  `testTimeout` during the parallel full run. Both pass in isolation and both passed on the
  immediately-following full run (528/529). They are cold-module-load costs on the `"use node"`
  `llm.ts` import — the same wall `dispatch.test.ts` and `runCockpitAgent.test.ts` already
  side-step with an explicit `vi.setConfig({ testTimeout: 30_000 })`. The one-line fix belongs to
  whoever owns those files; Lane A does not own them this phase. Logged to `deferred-items.md`.
- The two pre-existing items in `deferred-items.md` (`@pikar/audit` has no `tsconfig.json`;
  `replyToMessage` has no `VERB` entry) are unchanged.

## Verification

| Gate | Result |
|------|--------|
| `vitest run convex/dispatch.test.ts convex/dispatchGuard.test.ts` | 27/27 green (22 + 5) |
| `vitest run convex/dispatch.test.ts convex/llmRedaction.test.ts` | 56/56 green (22 + 34) |
| `pnpm --filter @pikar/backend exec vitest run` | 528/529 — sole red is the documented pre-existing `audit.test.ts` `auditCounts` row |
| `pnpm --filter @pikar/core exec vitest run` | 223/223 green (this plan touched no core file) |
| backend `tsc --noEmit` | 52 errors — the exact pre-existing baseline, ZERO in any non-test file |
| `apps/web` `tsc --noEmit` (Pitfall 4 tripwire) | exit 0 — `runSpecialist`'s explicit `Promise<DispatchResult>` held the generated API |
| `npx turbo run typecheck --continue` | 8 successful / 10 — the documented baseline |
| `node scripts/check-playbooks.mjs check` | exit 0 |
| Files changed by `4065571^..HEAD` | exactly the 5 the plan authorizes — `schema.ts`, `guardrails.ts`, `apps/`, `cockpit.ts`, `deliverApprovedPlan.ts` and `actionType.ts` all absent |
| Mutation checks | `leak: turn.reply` → both §4 scans RED; unconditional envelope derivation → 3 envelope tests RED; both reverted |

## Issues Encountered

- The previous executor agent died to an infrastructure API error after committing Task 1. The
  working tree was clean, `4065571` was intact, and its 18 tests were confirmed green before Task 2
  started — so any red seen later was attributable to this agent's work. No rework was needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**FOR 15-04 (the memo surface):**
- Call `internal.dispatch.runSpecialist` with all eleven args. It returns
  `{ ok: true, route, body, incomplete, costUsd, spentCents, envelopeCents, skillVersion }` or
  `{ ok: false, reason, reply }`. **A refusal is a conversational reply to render, not an error to
  handle** — do not DLQ it, do not throw it, do not surface `reason` to the user.
- `body` + `incomplete` feed `specialistMemoBody({ route, body, incomplete })` (15-02) directly.
  The incomplete marker belongs in the memo BODY; do not add a `plans.status` literal.
- Mint `rootRequestId` with `crypto.randomUUID()` at the dispatch entry point. **Do not reuse
  `planId`** — `plans.byThread` is `.unique()` and the row is RECYCLED per thread (12-05), so two
  dispatches on one thread would merge into one unreconstructable tree. ADR-008 records why.
- Pass `depth: 1`, `ancestry: []`, `parentAgentId: "executive"`, `envelopeCents: 0`,
  `spentCents: 0` for a first hop. If a future caller ever runs a second hop, thread the returned
  `envelopeCents` and `spentCents` forward UNCHANGED and UPDATED respectively — forgetting to is
  what turns one tree ceiling into a fresh allowance per hop.

**FOR 15-06 / 16-19:** the dispatcher is the pattern for any future sub-agent: one governance
function, guards that RETURN, `correlationId := rootRequestId` lineage, and a tree-local envelope
over the shared rail. Raising `MAX_DEPTH` is a one-constant change; the cycle guard and its tests
already exist.

**FOR 15.1 (tier filtering):** the filter belongs on `SPECIALISTS` before `resolveSpecialist`, or
as a fifth guard returning `unknown_route`'s shape. Do not make the tool-set DB-writable (ADR-007).

**FOR ALL:** `apps/web` remains FROZEN. `docs/playbooks/cockpit.md` is append-only per-plan
`### Phase 15 — …` subsections. `dispatch.ts` must never contain `generateText`.

---
*Phase: 15-sub-agent-dispatch-action-executor*
*Completed: 2026-07-26*

## Self-Check: PASSED

All 5 claimed files exist on disk and all 3 task commits resolve in git history. Every `must_haves`
artifact assertion verified: `dispatch.ts` is 356 lines (min 120) and exports `runSpecialist`;
`dispatch.test.ts` is 593 lines (min 200); `008-dispatch-state-travels-as-call-args.md` exists. All
four `key_links` patterns present in `dispatch.ts`: `runSpecialistTurn`,
`correlationId: rootRequestId`, `remainingDailyCents` (14 combined occurrences) and
`agentSteps.(record|finish)` (2).
