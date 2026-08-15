---
phase: 15-sub-agent-dispatch-action-executor
verified: 2026-07-25T22:29:52Z
status: passed
score: 5/5 must-haves verified
---

# Phase 15: Sub-Agent Dispatch & Generalized Action Executor Verification Report

**Phase Goal:** The hollow `sub_agent` route becomes real — specialists are swappable (skill
body, tool-set) pairs the ONE governed loop runs — and the approve→execute spine becomes
action-agnostic, so all breadth of action rides a single governed seam instead of re-forking
the loop or the executor.

**Verified:** 2026-07-25T22:29:52Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Router dispatches a named specialist in the SAME governed loop with a swapped (skill body, tool-set); unknown specialist fails closed to `unknown_route`, never a silent default | ✓ VERIFIED | `packages/core/src/specialists.ts:81-87` `resolveSpecialist` uses `hasOwnProperty` fail-closed lookup (guards `__proto__`/`constructor` pollution too); `packages/backend/convex/dispatch.ts:280-286` calls `run()` → `runSpecialistTurn` → `runAgentLoop` (the one loop) with a filtered tool record. `dispatch.test.ts` REFUSALS table asserts `"does-not-exist"` and `""` both → `unknown_route`; `specialists.test.ts` adds case-mismatch, path-traversal and prototype-pollution-shaped routes, all → `unknown_route`. `dispatchGuard.test.ts` proves `dispatch.ts` contains zero `generateText` call sites and `llm.ts` has exactly one tool-bearing `generateText` site. |
| 2 | Depth cap, shared root-request cost budget (one envelope drawn down across the whole tree), cycle refusal (A→B→A rejected) — no nested `generateText`, no agents spawning agents | ✓ VERIFIED | `dispatch.ts:29` `MAX_DEPTH = 1`; `governedDispatch` order is resolve→depth→cycle→envelope→run (:223-247). `wouldCycle` (`specialists.ts:97-99`) is a shared predicate, tested for direct repeat and A→B→A chains. Envelope: `dispatch.test.ts` "the shared root-request cost envelope" describe block proves the envelope derives once at the root as a FRACTION of the live daily rail (never the whole rail), is carried UNCHANGED hop-to-hop, is drawn down cumulatively across hops (test: "drawn down ACROSS hops"), clamps to 0 on a negative rail, and an overrunning hop stops after the call and is labelled `incomplete` rather than discarding output. |
| 3 | Every sub-agent audit/telemetry row carries `rootRequestId` + `parentAgentId` lineage (refs/ids only); the insert-only audit reconstructs the call tree and cost attributes to the root request | ✓ VERIFIED | `lineageRefs()` (`dispatch.ts:196-203`) writes only `rootRequestId, parentAgentId, specialist (route name), depth, ancestryDepth, planId` plus counts (`envelopeCents`, `spentCents`, `costUsd`, `skillVersion`, `incomplete`) — no reply/body/finding/citation text. `audit.by_correlation` index (`schema.ts:24/75/144/514`) is the reconstruction path. `dispatch.test.ts` "audit is redaction-safe" test scans every payload value for the scripted reply text and its distinctive words and asserts none leak. |
| 4 | An approved plan can execute a non-email action type through a generalized executor (`executePlan`/`deliverApprovedPlan` dispatches by action type); the human Approve gate stays a mutation, never a tool | ✓ VERIFIED | `packages/core/src/actionType.ts` — closed `ACTION_TYPES`, `armFor` bound `satisfies Record<ActionType, Arm>` (a ternary would silently swallow a new member), `assertNever` backstop. `cockpit.ts:517-558` `executePlan` (a `tenantMutation`) switches on `armFor(actionTypeOf(plan.kind))` with an exhaustive switch ending `default: return assertNever(armType)`. `deliverApprovedPlan.ts` is verified byte-unchanged since its original commit (`git diff <merge-base> -- deliverApprovedPlan.ts` is empty). `dispatchGuard.test.ts` statically scans `llm.ts`'s `buildCockpitTools` key list and asserts `executePlan`/`approvePlan`/`deliverApprovedPlan` are absent, plus asserts `llm.ts` holds no reference (by regex) to `internal\|api.cockpit.executePlan` or `deliverApprovedPlan` anywhere, and independently confirms `cockpit.ts` still declares `export const executePlan = tenantMutation({`. |
| 5 | A cross-tenant isolation assertion ships for the dispatch/lineage rows (a sub-agent run keyed on `rootRequestId` is still tenant-scoped) | ✓ VERIFIED | `dispatch.test.ts` "two-tenant isolation (SC #5)" describe block: two tenants dispatch under the SAME `rootRequestId` and same `threadId` (the maximal collision), then reads the `audit` table directly (not just the plan) and asserts every row's `tenantId` matches the dispatching tenant with a non-vacuity floor (`>0` rows each side) and a second test confirms the public `plans.byThread` query is scoped too. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/backend/convex/schema.ts` | 3 dispatch literals on `agentSteps.tool` | ✓ VERIFIED | `dispatchOfferArchitect`, `dispatchMoneyModelDesigner`, `dispatchLeadEngine` present (lines 435-437) |
| `packages/backend/convex/guardrails.ts` | `remainingDailyCents` internalQuery, clamped ≥ 0 | ✓ VERIFIED | Present at line 187; tested (`negative rail clamps to zero envelope`) |
| `packages/core/src/specialists.ts` | `SPECIALIST_ROUTES`, `SPECIALISTS`, `resolveSpecialist`, `wouldCycle`, `specialistMemoBody` | ✓ VERIFIED | All five exported; 125 lines; 21/21 tests pass |
| `packages/core/src/actionType.ts` | `ACTION_TYPES`, `actionTypeOf`, `Arm`, `armFor`, `assertNever` | ✓ VERIFIED | All exported; 35 lines; 7/7 tests pass |
| `packages/backend/convex/dispatch.ts` | `governedDispatch` + `runSpecialist` internalAction + `__runSpecialistWithScript` test twin | ✓ VERIFIED | 421 lines; both entry points call the same `governedDispatch`/`dispatchAndLand`; wired into `runSpecialistTurn` (`llm.ts`) |
| `packages/backend/convex/dispatch.test.ts` | SC#1/#2/#3/#5 offline assertions | ✓ VERIFIED | 31 tests, all pass, covers depth/cycle/envelope/lineage/isolation |
| `docs/decisions/007-sub-agent-capability-is-code-owned.md` | ADR: prompt registry-owned, capability code-owned | ✓ VERIFIED | Exists |
| `docs/decisions/008-dispatch-state-travels-as-call-args.md` | ADR: depth/ancestry/envelope are call args, not DB state | ✓ VERIFIED | Exists |
| `packages/backend/convex/cockpit.ts` (`executePlan`) | Exhaustive arm table replacing `plan.kind === "memo"` if-branch | ✓ VERIFIED | `satisfies Record<ActionType, Arm>` bind + exhaustive switch present |
| `packages/backend/convex/dispatchGuard.test.ts` | Static scan — `executePlan` absent from tool record; Approve gate unreachable | ✓ VERIFIED | 5/5 tests pass, includes non-vacuity floor (≥20 tool keys) |
| `packages/contracts/skills/{offer-architect,money-model-designer,lead-engine}.md` | Runnable bodies with `searchVault` grounding instruction | ✓ VERIFIED | All three contain `searchVault`; `skillBodies.test.ts` (contracts) 7/7 md↔ts byte-identity |
| `packages/backend/scripts/run-eval-golden.mjs` | Multi-pin `--skill`; `SKILL_NAMES` derived from `GATED_SKILLS` | ✓ VERIFIED | `--self-check` passes (30 fixtures, 11 gated skills derived) |
| `packages/backend/scripts/eval-cases/` | 3 new fixtures, gap→dispatch→staged output, one per specialist | ✓ VERIFIED | `29-gap-dispatch-offer-architect.json`, `30-gap-dispatch-money-model.json`, `31-gap-dispatch-lead-engine.json` present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/core/src/growth/diagnose.ts` | `packages/core/src/specialists.ts` | `Prescription.route: SpecialistRoute \| ""` | ✓ WIRED | `diagnose.ts:10,23` imports and uses the closed type |
| `packages/backend/convex/dispatch.ts` | `packages/backend/convex/llm.ts` | `runSpecialistTurn` sequential call | ✓ WIRED | `dispatch.ts:23,280` imports and calls it inside `governedDispatch`'s `try` block |
| `packages/backend/convex/evaluations.ts` (`actOnGap`) | `packages/backend/convex/dispatch.ts` | `ctx.scheduler.runAfter(0, internal.dispatch.runSpecialist, …)` | ✓ WIRED | `evaluations.ts:707` |
| `packages/backend/convex/dispatch.ts` | `packages/backend/convex/evaluations.ts` (`landSpecialistResult`) | Runs in `dispatchAndLand`'s `finally` on every outcome | ✓ WIRED | `dispatch.ts:381-390`; `evaluations.ts:763-806` flips `collecting → proposed` |
| `packages/backend/convex/cockpit.ts` (`executePlan`) | `packages/core/src/actionType.ts` | `actionTypeOf(plan.kind)` selects the arm | ✓ WIRED | `cockpit.ts:543` |
| `packages/backend/convex/cockpit.ts` (memo arm) | `packages/backend/convex/evaluations.ts` (`persistNextStepMemo`) | Inline call, unchanged | ✓ WIRED | `cockpit.ts:551` |
| `packages/contracts/skills/*.md` | `packages/contracts/src/skills/*.ts` | Byte-identity enforced by `skillBodies.test.ts` | ✓ WIRED | 7/7 tests pass |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|-------------|--------|----------|
| DISP-01 | 15-01, 15-02, 15-03, 15-04, 15-06 | Real sub-agent dispatch — swappable pairs, depth cap, shared budget, cycle refusal, lineage | ✓ SATISFIED | Truths 1-3, 5 above; all supporting tests pass |
| ACTN-01 | 15-01, 15-05 | Generalized governed action executor beyond `gmail.send` | ✓ SATISFIED | Truth 4 above; `dispatchGuard.test.ts` proves Approve stays a mutation, never a tool |

Both requirement IDs assigned to Phase 15 in `.planning/REQUIREMENTS.md` (line 127-128) are
claimed by at least one plan's frontmatter (15-01/ACTN-01+DISP-01, 15-02/DISP-01, 15-03/DISP-01,
15-04/DISP-01, 15-05/ACTN-01, 15-06/DISP-01) — no orphaned requirement.

**Documentation discrepancy (non-blocking, informational):** `.planning/REQUIREMENTS.md`'s
detail table (line 245) still reads `ACTN-01 | Phase 15 | In Progress (closed action-type union
landed 15-01; needs 15-05)` even though 15-05 landed and closed the generalized executor, and the
phase itself is marked complete on `main`'s `ROADMAP.md` (2026-07-25) and in the top summary
line (127-128, `[x] ACTN-01`). The code-level goal is fully achieved (see Truth 4); this is a
one-line tracking-table staleness that should be corrected to match DISP-01's already-updated
"Complete" entry the next time `.planning/REQUIREMENTS.md` is touched. It does not affect any
shipped behavior.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found (`TODO`/`FIXME`/`PLACEHOLDER`/`not implemented` scan across `dispatch.ts`, `specialists.ts`, `actionType.ts`, `cockpit.ts`, `evaluations.ts` returned zero matches) | — | — |

### Known, Already-Recorded Items (confirmed, not new gaps)

- **15-06 eval gate was unpaid at this verifier, then discharged by Phase 16.** The original
  ship-dark record was accurate on 2026-07-25. The later unfiltered gate `14feb4b7` passed 34/34,
  recorded evidence for offer-architect@4, money-model-designer@4, and lead-engine@4, activated
  all three, and read them back; `d17039a8` re-confirmed the full gate. The old-body production
  claim is historical, not current.
- **`convex/audit.test.ts` `auditCounts` row red.** Reproduced independently: full backend suite run here shows exactly `1 failed | 544 passed` with the same `"Component \"auditCounts\" is not registered"` error, matching the documented pre-existing Phase-2 baseline.
- **Backend `tsc --noEmit` test-file errors.** Reproduced independently at 55 errors, all in `.test.ts` files, zero in any non-test file. Note: this is 55, not 52 — but that is not a hidden regression; 15-06's own SUMMARY (line 285) and Verification table explicitly documents the baseline moved from 52→55 during the phase ("measured by stashing this plan's diff"), i.e. the increase is itself pre-existing/unrelated to Phase 15's changes and was honestly recorded at the time, not silently absorbed.
- **`@pikar/audit` has no `tsconfig.json`.** Reproduced: `npx turbo run typecheck --continue` → 8 successful / 10 total, matching the documented baseline (`@pikar/audit` and `@pikar/backend` are the two reds).

### Human Verification Required

None required to close this phase. Per `15-CONTEXT.md`'s explicit decision, "automated green is
sufficient to merge — no owner sign-off gate inside the phase," with the live human-verify
deferred to a single combined pass on integrated `main` covering Phases 14 and 15 together. All
five success criteria are proven offline in `convex-test` with real `runAgentLoop`/mock-model
execution (no LLM spend needed for SC#1/#2), which this verification independently re-ran and
confirmed green.

### Gaps Summary

No gaps block goal achievement. All five ROADMAP success criteria are independently verified
against the actual codebase (not SUMMARY claims): the specialist registry resolves fail-closed
with adversarial-shaped inputs (path traversal, prototype pollution, case variance) all falling
through to `unknown_route`; the governed dispatcher enforces depth=1, tests cycle refusal
explicitly even though depth already prevents it, and proves the shared cost envelope is a
fraction of the live daily rail carried unchanged and drawn down across hops (with a
negative-rail clamp and an overrun-keeps-partial-output path); `executePlan` is a genuine
`satisfies Record<ActionType, Arm>`-bound exhaustive dispatch with an `assertNever` backstop, not
a residual `if (kind === "memo")`; `deliverApprovedPlan.ts` is confirmed byte-unchanged via git
diff against the merge-base; all audit/lineage payloads are refs/ids/counts only, asserted by a
test that scans every payload value for leaked reply text; and cross-tenant isolation on the
lineage rows is tested with a maximal-collision scenario (same `rootRequestId`, same `threadId`,
two tenants) reading the audit table directly. The full backend suite (544/545, sole pre-existing
red) and all Phase-15-specific test files (dispatch, dispatchGuard, specialists, actionType,
gapAction, evaluations, runCockpitAgent, contracts skillBodies) were independently re-run here
and pass. The only finding is a one-line staleness in `.planning/REQUIREMENTS.md`'s ACTN-01
detail-table entry (still says "needs 15-05" after 15-05 shipped) — a tracking-doc fix, not a
functional gap.

---

*Verified: 2026-07-25T22:29:52Z*
*Verifier: Claude (gsd-verifier)*
