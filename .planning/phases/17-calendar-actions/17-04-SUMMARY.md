---
phase: 17-calendar-actions
plan: 04
subsystem: calendar-approval-enforcement
tags: [convex, google-calendar, action-retrier, approval-gate, tenant-isolation, static-analysis]

requires:
  - phase: 17-calendar-actions
    plan: 01
    provides: calendar_event action type, externalAction arm, staged fields, run-id index, and UI card
  - phase: 17-calendar-actions
    plan: 02
    provides: Google Calendar actions, idempotent event id, and non-Node completion terminal
  - phase: 17-calendar-actions
    plan: 03
    provides: content-free availability and proposed-only Calendar staging tools
provides:
  - Approve-only Calendar event execution through the action retrier
  - Static proof that the model tool surface cannot reach Calendar writes or the Gmail fan-out
  - Same-input two-tenant approval, fixture, plan-read, and terminal isolation evidence
affects: [ACTN-02, phase-18-documents, phase-19-crm, cockpit-execution]

tech-stack:
  added: []
  patterns:
    - Human tenantMutation starts one governed external action through ActionRetrier
    - Node action and non-Node completion mutation remain structurally separate
    - Every absence scan carries a positive non-vacuity anchor and a mutation proof

key-files:
  created:
    - .planning/phases/17-calendar-actions/17-04-SUMMARY.md
  modified:
    - packages/backend/convex/cockpit.ts
    - packages/backend/convex/cockpit.test.ts
    - packages/backend/convex/dispatchGuard.test.ts
    - packages/backend/convex/calendar.test.ts
    - docs/playbooks/cockpit.md
    - .planning/phases/17-calendar-actions/deferred-items.md

key-decisions:
  - "Calendar Approve starts internal.calendar.createEvent through retrier.run and completes only through internal.calendarComplete.onCreateComplete."
  - "deliverApprovedPlan.ts remains email-only and byte-unchanged; Calendar never enters the Gmail request fan-out."
  - "ACTN-02 is Google-only and create-only in Phase 17; Outlook plus update/cancel remain deferred and REQUIREMENTS stays pending until verify-work."

patterns-established:
  - "Approve CAS: proposed Calendar plans receive one correlationId and calendarRunId; every later executePlan call no-ops."
  - "Static ownership: events.insert has one module owner, exactly two named Calendar POST targets exist, and guest-delivery fields are absent."

requirements-completed: []

duration: 12h 1m
completed: 2026-07-30
---

# Phase 17 Plan 04: Approve-Only Calendar Enforcement Summary

**A human-approved Calendar plan now starts exactly one retried Google event action, while static and two-tenant proofs keep the write unreachable from the model loop and Gmail fan-out.**

## Performance

- **Duration:** 12h 1m
- **Started:** 2026-07-29T23:16:31Z
- **Completed:** 2026-07-30T11:17:31Z
- **Tasks:** 3/3
- **Plan files changed:** 5 implementation/test/playbook files, plus the phase deferred-items log

## Accomplishments

- Replaced the frozen `externalAction` stub with `retrier.run(ctx, internal.calendar.createEvent, ...)`
  behind the existing human `tenantMutation`, persisting the server correlation id and retrier run id
  before the terminal can resolve.
- Registered the shipped `@convex-dev/action-retrier/test` helper and drained scheduled functions;
  proposed Calendar plans start one run without a Gmail mailbox, while non-proposed, duplicate, and
  escalated attempts start none.
- Added six enforcement scans covering model-loop reachability, POST target ownership, the sole
  events URL owner, guest-field absence, scope-before-refresh order, and the two-module arm wiring.
- Added five SC#3 tests with explicit anti-vacuity floors: same-input approvals, tenant-scoped plan
  reads, cross-tenant create refusal, distinct fixture reads, and run-id terminal resolution.
- Closed the Phase 17 playbook with the full Google-only/create-only operational contract.

## Task Commits

1. **Task 1 RED — Calendar approve-arm behavior** — `803f79e`
2. **Task 1 GREEN — governed externalAction retrier arm** — `2ceed42`
3. **Task 2 — mutation-verified static enforcement** — `5b47ae3`
4. **Task 3 RED — integrated tenant-isolation evidence** — `d8b666d`
5. **Task 3 GREEN — retrier-backed isolation and playbook closure** — `7348280`

## TDD and Runtime Evidence

### Task 1

- RED: four proposed-plan cases failed on `calendar arm not wired (17-04)`; non-proposed and
  escalated guards stayed green.
- GREEN: `cockpit.test.ts` plus the then-current dispatch guards passed 37/37.
- The retrier component **did run under `convex-test`** using
  `@convex-dev/action-retrier/test` and `finishInProgressScheduledFunctions()`. Its completion
  handler executed on the offline no-token path; no plan-row/source-scan fallback was needed.
- Required ordering mutation: adding the mailbox pre-check before the Calendar arm made
  `calendar approval does not require a connected mailbox` RED, then restoration returned it GREEN.

### Task 3

- RED: 29/30 Calendar tests passed; the same-input approve test failed only because
  `actionRetrier` was not registered.
- GREEN: the shipped helper was registered, two retrier runs completed, and all 30/30 Calendar tests
  passed.
- The scheduled component action runs in an isolate that does not inherit Vitest's `fetch` stub.
  The integrated two-tenant approve test therefore uses the governed no-token path and seeds
  distinct fixture reads first, giving both tenants non-vacuous plan and audit rows without network.
  Direct adapter tests still prove successful create plus deterministic 409-as-success behavior.
- Required tenant mutation: removing `plan.tenantId !== tenantId` changed the cross-tenant result
  from `tenant_mismatch` to `reauth`, making the named SC#3 assertion RED; restoration returned it
  GREEN.

## Enforcement Mutation Ledger

The plan calls these “six scans”; Scan F has two independently mutated halves, so the complete
evidence ledger necessarily contains seven observations.

| Scan | Applied mutation | RED observation |
|---|---|---|
| A — model write reachability | Added `ctx.runAction(internal.calendar.createEvent, ...)` inside `proposeCalendarEvent` | Calendar-write reference count became 1 |
| B — named POST targets | Added a third `fetch(..., {method: "POST"})` in `calendar.ts` | POST target list contained three entries |
| C — sole events URL owner | Pasted the events.insert URL into `cockpit.ts` | Owners became `calendar.ts` + `cockpit.ts` |
| D — no guest delivery | Added `sendUpdates: "none"` to the event body | Forbidden guest-delivery surface was detected |
| E — scope ordering | Moved `createEvent`'s `hasScope` check below `freshAccessToken` | Per-function ordering comparison failed |
| F1 — terminal module | Changed onComplete to `internal.calendar.onCreateComplete` | Required non-Node terminal reference was absent |
| F2 — no Gmail fan-out | Added `await workflow.start(...)` inside `externalAction` | Forbidden workflow/fan-out reference was detected |

Every mutation was restored. Final `dispatchGuard.test.ts`: **11/11 passed**.

## Verification

- Required Calendar/cockpit/enforcement gate: **3 files, 73/73 passed**.
- `calendar.test.ts`: **30/30 passed**.
- `cockpit.test.ts`: **32/32 passed**.
- `dispatchGuard.test.ts`: **11/11 passed**.
- Workspace `pnpm test` ran twice: each run passed **815/816 backend tests** and failed a different,
  unrelated `onboarding.test.ts` assertion. The first failure passed alone, confirming
  nondeterministic onboarding isolation; no Calendar/cockpit/guard/retrier/audit test failed.
- `pnpm typecheck`: **145 test-file diagnostics, zero non-test diagnostics**. The seven touched-test
  diagnostics are the pre-existing unused `@ts-expect-error` import-meta guards.
- `node scripts/check-playbooks.mjs`: **passed**.
- `deliverApprovedPlan.ts` and `llm.ts`: **zero diff across 17-04** and zero working-tree diff.
- `executePlan` remains a `tenantMutation`; the tool-key floor remains `>=20`. The integrated
  Blueprint branch has **23** tool keys, not the plan's stale pre-integration estimate of 22.
- Graph refresh completed on the warm-cache retry; Convex/table edge fixup completed.

## Google-Only / Create-Only Traceability Note

When `/gsd:verify-work` eventually updates the ACTN-02 traceability row, it must say:

> Phase 17 ships **Google only, create only**. Microsoft/Outlook is deferred (17-01 Q7), and
> update/cancel are deferred (17-01 Q3); ACTN-02's literal “schedule and manage” text must not imply
> that provider parity or event management shipped.

`.planning/REQUIREMENTS.md` remains unchanged until that verification step, as required by the plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used the installed Vitest shim**
- **Found during:** Task 1 RED
- **Issue:** `pnpm exec vitest` still did not resolve the package-local executable in this worktree.
- **Fix:** Used `packages/backend/node_modules/.bin/vitest.CMD`, the same pinned shim as 17-02/17-03.
- **Files modified:** None
- **Verification:** Final targeted gate passed 73/73.
- **Commit:** No code change

**2. [Rule 3 - Blocking] Kept scheduled retrier tests network-free**
- **Found during:** Task 3 GREEN
- **Issue:** The action-retrier component isolate did not inherit Vitest's global `fetch` stub and
  attempted a real provider call.
- **Fix:** Exercised the integrated approval/retrier/terminal path with no token, and generated
  non-vacuous tenant audit rows through distinct fixture reads. Direct action tests retain provider
  create/409 coverage.
- **Files modified:** `packages/backend/convex/calendar.test.ts`
- **Verification:** Calendar 30/30 and targeted phase gate 73/73.
- **Commit:** `7348280`

**3. [Rule 3 - Blocking] Re-ran graph refresh after the cold pass timed out**
- **Found during:** Final verification
- **Issue:** The first graph refresh completed AST extraction but timed out before writing output.
- **Fix:** Re-ran on the warm cache, then ran the Convex edge fixup.
- **Files modified:** Ignored graphify output only
- **Verification:** 9,847 graph nodes rebuilt; Convex/table fixup completed.
- **Commit:** No tracked change

---

**Total deviations:** 3 auto-fixed blocking issues.
**Impact on plan:** No feature scope or architecture changed.

## Authentication Gates

None.

## Issues Encountered

- The full workspace suite has an unrelated nondeterministic onboarding isolation failure; details
  are recorded in `deferred-items.md`. All 17-04-owned gates are green.
- Workspace typecheck remains red only in test files. There are zero production diagnostics.

## Owner Checklist — Live UAT Still Required

**OWNER-GRANTED OAUTH CONSENT REQUIRED. No agent can self-serve these. They are not executor tasks
and do not make this plan incomplete. Carry all five into `/gsd:verify-work`.**

| # | Behavior | Why it cannot be automated | Owner instructions |
|---|---|---|---|
| M1 | The widened scope returns a token that can call Calendar | Real Google OAuth consent; the Testing-status 100-test-user list is owner-controlled | Reconnect Google from `/connect-gmail`, then run an availability read |
| M2 | `freeBusy` against a real calendar | Needs an account with real busy blocks | Compare returned ranges against the actual calendar |
| M3 | ONE real event created on Approve, visible in Google Calendar | The end-to-end claim | Approve a staged event; confirm it appears exactly once |
| M4 | A pre-widening token lights the reconnect banner instead of crashing | Depends on a token issued BEFORE the change — cannot be synthesised after the fact | Connect once on the pre-widening build, deploy this build, call calendar **without** reconnecting. Expected: reconnect banner, not a 403 crash. **Worth scripting as the one live negative test.** |
| M5 | Trace step rows appear in the workspace, and the calendar plan card renders | The silently-swallowed-insert failure mode passes every offline test by construction | Live deployment only — no Google account needed. Carried from Plan 03 if still open |

## User Setup Required

No new secret or service. Existing users must grant the widened Google consent through the existing
`/connect-gmail` flow before live Calendar calls.

## Next Phase Readiness

- Phase 17 implementation is complete at 4/4 plans.
- Ready for `/gsd:verify-work 17` with M1–M5 and the Google-only/create-only traceability note.
- Phases 18/19 can reuse `externalAction`; they must not add a fourth arm or route through Gmail.

## Self-Check: PASSED

- All six required implementation/test/playbook/summary files exist.
- All five Task 1–3 commits resolve on this branch.

---
*Phase: 17-calendar-actions*
*Completed: 2026-07-30*
