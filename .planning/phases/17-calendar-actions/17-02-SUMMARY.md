---
phase: 17-calendar-actions
plan: 02
subsystem: calendar
tags: [convex, google-calendar, oauth, action-retrier, audit, dead-letter, vitest]

requires:
  - phase: 17-calendar-actions
    plan: 01
    provides: externalAction arm, calendar plan fields/indexes, fixture table, and pure calendar helpers
provides:
  - Fixture-first Google Calendar availability reads with refs/counts-only audit
  - Idempotent event creation using deterministic Google event IDs and 409-as-success
  - Non-Node action-retrier terminal for plan status, audit, reconnect notification, and dead letters
affects: [17-03, 17-04, calendar-tools, cockpit-execution]

tech-stack:
  added: []
  patterns:
    - Node action adapter paired with a non-Node mutation terminal
    - Stored-scope check before shared Google token refresh
    - Provider error bodies discarded; only validated reason codes cross the terminal boundary

key-files:
  created:
    - packages/backend/convex/calendar.ts
    - packages/backend/convex/calendarComplete.ts
    - .planning/phases/17-calendar-actions/deferred-items.md
  modified:
    - packages/backend/convex/calendar.test.ts
    - packages/backend/convex/smoke.ts
    - packages/backend/convex/gmailAuth.ts
    - packages/backend/convex/http.ts
    - apps/web/app/(app)/connect-gmail/page.tsx
    - docs/playbooks/cockpit.md

key-decisions:
  - "Calendar keeps one widened Google grant and checks the persisted scope before refresh or provider calls."
  - "calendar.ts remains a Node actions-only adapter; calendarComplete.ts is the non-Node sole terminal writer."
  - "A deterministic client event ID makes Google 409 duplicate an idempotent success, not an error."
  - "ACTN-02 remains pending until the later Phase 17 plans wire and verify the complete action surface."

patterns-established:
  - "Fixture-first read: offline fixtures precede token lookup, refresh, and network."
  - "Calendar terminal payloads carry only refs, IDs, counts, status values, and reason codes."

requirements-completed: []

duration: 35 min
completed: 2026-07-29
---

# Phase 17 Plan 02: Google Calendar Adapter and Terminal Summary

**Fixture-first availability plus idempotent, retried event creation with a separate non-Node terminal that keeps Calendar content out of audit and dead letters**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-29T21:31:25Z
- **Completed:** 2026-07-29T22:06:52Z
- **Tasks:** 3
- **Plan files changed:** 8 implementation/playbook files, plus tests and one deferred-items log

## Accomplishments

- Widened the one existing Google OAuth grant for Gmail modify, Calendar free/busy, and Calendar event creation; existing users reconnect through the shipped banner and single connect page.
- Added deterministic offline Calendar fixtures and a fixture-first `freeBusy` action that succeeds without a token or network and audits exactly `{range, busyCount}`.
- Added `createEvent` with scope-before-refresh ordering, deterministic event IDs, 409 duplicate success, permanent/transient status separation, and an incomplete-stage terminal before network work.
- Added `calendarComplete.ts`, a non-Node `internalMutation` that is the Calendar arm's sole writer of plan status, created-event audit, reconnect notification, and dead letters.
- Regenerated local Convex API types and successfully deployed the two-module split to the configured local deployment.

## Task Commits

Each task/TDD phase was committed atomically:

1. **Task 1: fixture seam and widened Google grant** — `03e8b18` (`feat`)
2. **Task 2 RED: governed availability behavior** — `69cd1af` (`test`)
3. **Task 2 GREEN: fixture-first availability adapter** — `2d7cd10` (`feat`)
4. **Task 3 RED: governed event-create and terminal behavior** — `e659653` (`test`)
5. **Task 3 GREEN: event action and non-Node terminal** — `71ace75` (`feat`)

## TDD and Mutation Evidence

- **Task 1:** the non-vacuous authorize-URL scan names the planted second OAuth builder as its mutation; the completed pre-checkpoint task recorded RED before restoration.
- **Task 2:** moving the stored-scope check below `freshAccessToken` made the SC#2e network-call assertion RED; restored before `2d7cd10`.
- **Task 3:** removing the `status === "delivering"` terminal guard made both stale-plan cases RED (`collecting` and `proposed` were incorrectly patched to `done`); restored before `71ace75`.
- The plan's additional Task 3 mutation that deliberately routes `error.message` into the terminal was not applied: the environment's data-safety reviewer rejected creating a raw provider-content leak, even temporarily. The production boundary remains stronger: reason codes are character/length validated, the fixture 400 echoes `ZZQX-secret-offsite`, and the final audit/dead-letter absence assertion is green.

## Verified Action-Retrier Contract

`@convex-dev/action-retrier` 0.3.1 exports `onCompleteValidator` for exactly
`{runId, result}`. There is no workflow-style context passthrough. This differs from the original
research assumption and is why `calendarComplete.ts` resolves failed/canceled runs through
`plans.by_calendar_run`. Before Phase 17 there were zero live `retrier.run(...)` call sites in this
repository; Plan 17-04 will wire the first one.

## Verification

- Local Convex sync: `Convex functions ready`; `_generated/api.d.ts` exports both `calendar` and `calendarComplete`.
- `calendar.test.ts`: **25/25 passed**.
- Plan quick gate (`calendar.test.ts` + `dispatchGuard.test.ts`): **30/30 passed**.
- Targeted Biome check for all three Calendar TypeScript files: **passed**.
- `node scripts/check-playbooks.mjs`: **passed**.
- Static module checks: `calendar.ts` has exactly two `internalAction` declarations, zero `internalMutation`/`internalQuery` declarations, exactly two endpoint constants, and neither forbidden guest-send key.
- `deliverApprovedPlan.ts`, `llm.ts`, and `plans.ts`: **byte-unchanged in this plan**.
- `pnpm typecheck`: workspace remains red on the shared pre-existing backend test baseline. One Task 3 helper error was fixed; the final backend run reported **59 diagnostics and zero in `convex/calendar*`**. See `deferred-items.md`.

## Files Created/Modified

- `packages/backend/convex/calendar.ts` — Node-only availability and event-create actions.
- `packages/backend/convex/calendarComplete.ts` — non-Node retrier terminal and sole Calendar write-plane terminal.
- `packages/backend/convex/calendar.test.ts` — 25 offline tests covering SC#1d/1e, SC#2a-e, and two-tenant isolation.
- `packages/backend/convex/smoke.ts` — deterministic Calendar fixture seed/read seam.
- `packages/backend/convex/gmailAuth.ts` — shared Google scope set on the one authorize URL.
- `packages/backend/convex/http.ts` — widened fallback scope persistence.
- `apps/web/app/(app)/connect-gmail/page.tsx` — one Google Mail + Calendar consent surface.
- `docs/playbooks/cockpit.md` — Phase 17 two-module terminal invariant.

## Decisions Made

- Reused the single Google token row, callback, reconnect banner, and `freshAccessToken`; no second OAuth flow or token table.
- Kept provider content on the plan row. Audit and dead letters receive refs/status/reason-code shapes only.
- Kept guest invitation fields absent so Google cannot send outbound invitations outside the governed plan/audit/DLQ spine.
- Left ACTN-02 pending. This plan supplies the adapter and terminal, while 17-03/17-04 still stage and wire the governed action; the requirement text also includes deferred “manage” behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Used the existing direct Vitest shim**
- **Found during:** Task 2 verification
- **Issue:** `pnpm exec vitest` did not resolve the executable in this worktree even though the installed shim existed.
- **Fix:** Ran the same pinned Vitest binary directly from `packages/backend/node_modules/.bin`.
- **Files modified:** None
- **Verification:** Task 2 passed 10/10; final plan gate passed 30/30.
- **Committed in:** No code change

**2. [Rule 1 - Bug] Narrowed the Calendar test fixture field types**
- **Found during:** Task 3 typecheck
- **Issue:** A generic helper widened numeric event fields to `string | number`, creating the only new Calendar type error.
- **Fix:** Added a precise optional field shape and removed one unsafe indexed-call access.
- **Files modified:** `packages/backend/convex/calendar.test.ts`
- **Verification:** Final backend typecheck reported zero `convex/calendar*` diagnostics; 25/25 Calendar tests passed.
- **Committed in:** `71ace75`

**3. [Rule 3 - Blocking] Re-ran non-interactive Convex sync after adding the terminal module**
- **Found during:** Task 3
- **Issue:** The pre-checkpoint API generation could not include a file that did not yet exist.
- **Fix:** Ran one non-interactive local `convex dev --once` sync after creating `calendarComplete.ts`.
- **Files modified:** Git-ignored local deployment metadata and generated API types only
- **Verification:** Convex reported functions ready and `_generated/api.d.ts` now exports `calendarComplete`.
- **Committed in:** No tracked code change

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug).
**Impact on plan:** All fixes were limited to verification correctness and required local generation; no product scope was added.

## Issues Encountered

- The full workspace typecheck is not green because of a documented shared-lane baseline in unrelated backend tests. No Calendar production or test file remains in its diagnostics.
- The deliberate provider-message leak mutation was blocked by the environment safety gate. Positive sanitization, exact reason-code behavior, and seeded secret-absence coverage remain green.

## Owner Checklist (manual, not a plan blocker)

| # | Owner action | Expected result |
|---|---|---|
| M1 | Reconnect Google from `/connect-gmail`, then run an availability read | The widened grant can call Calendar. |
| M2 | Compare returned busy ranges with the real calendar | Busy intervals match without exposing event content. |
| M3 | Use a token issued before the scope widening, then call Calendar without reconnecting | The reconnect banner appears; no 403 escapes the governed loop. |

## User Setup Required

No new service or secret is required. Existing users must grant the widened Google consent through
the one `/connect-gmail` flow before live Calendar calls.

## Next Phase Readiness

- Ready for 17-03 to add the in-loop read/staging tool surface.
- 17-04 must wire the first `retrier.run(...)` call, complete the approve-path integration, and preserve the `calendarComplete.onCreateComplete` terminal.
- ACTN-02 remains pending until those later plans and the requirement traceability decision are complete.

## Self-Check: PASSED

- All created implementation, test, summary, and deferred-item files exist.
- All five Task 1/Task 2/Task 3 commits exist.
- STATE and ROADMAP both report Phase 17 at 2/4 with 17-03 next.
- ACTN-02 remains explicitly pending rather than being closed before the full action surface is wired.

---
*Phase: 17-calendar-actions*
*Completed: 2026-07-29*
