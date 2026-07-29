---
phase: 17-calendar-actions
plan: 03
subsystem: calendar-cockpit-tools
tags: [convex, calendar, ai-tools, approval-gate, trusted-clock, vitest]

requires:
  - phase: 17-calendar-actions
    plan: 01
    provides: calendar action type, staged plan fields, trace literals, and calendar plan card
  - phase: 17-calendar-actions
    plan: 02
    provides: fixture-first freeBusy adapter and event-creation terminal
  - phase: 17.1-business-blueprint-corpus-synthesis-and-agent-spine
    plan: 06
    provides: integrated Blueprint cockpit prompt spine in llm.ts
provides:
  - In-loop checkAvailability reads busy ranges from the trusted client clock without event content
  - proposeCalendarEvent atomically stages four event fields at proposed and stops before Approve
  - Tool-level no-network, no-write-on-refusal, horizon, timezone, and reconnect coverage
affects: [17-04, ACTN-02, cockpit-agent, calendar-approval]

tech-stack:
  added: []
  patterns:
    - Trusted client nowMs and tz are mandatory for both Calendar tools
    - Calendar content is staged on the plan row; model-reachable tools cannot perform the external write

key-files:
  created: []
  modified:
    - packages/backend/convex/llm.ts
    - packages/backend/convex/cockpitTools.test.ts
    - docs/playbooks/cockpit.md

key-decisions:
  - "Pass clientContext.nowMs into internal.calendar.freeBusy because the integrated adapter requires the same trusted clock as its tool caller."
  - "Stage eventTitle, eventStartMs, eventDurationMs, and eventTz in one proposed-only patch; Approve remains the sole side-effect gate."
  - "Keep ACTN-02 pending for 17-04 and the recorded create-only versus manage traceability decision."

patterns-established:
  - "Calendar read failures notify through the existing gmail_reconnect banner and return conversationally."
  - "Natural-language event times use parseSendTime with CALENDAR_HORIZON_MS and an exhaustive no-default switch."

requirements-completed: []

duration: 37 min
completed: 2026-07-29
---

# Phase 17 Plan 03: Governed Calendar Tool Surface Summary

**The one governed cockpit loop can now read content-free busy ranges and stage a timed Calendar event for human approval without reaching the external write arm.**

## Performance

- **Duration:** 37 min
- **Started:** 2026-07-29T22:25:52Z
- **Completed:** 2026-07-29T23:03:23Z
- **Tasks:** 2/2, both TDD
- **Files modified:** 3 implementation/test/playbook files

## Accomplishments

- Added `checkAvailability` with a closed range enum, fixture/live adapter call, trusted clock and
  timezone, five-block render cap, content-free output, free-window response, and conversational
  reconnect recovery.
- Added `proposeCalendarEvent` with natural-language parsing against `CALENDAR_HORIZON_MS`, a
  15–480 minute clamp, exhaustive refusal branches, and one atomic patch of all four staged event
  fields at `status: "proposed"`.
- Proved the tool surface performs no network call, does not set a Calendar event id/run id, does
  not cross the Approve gate, and leaves the row untouched for ambiguous, past, absent, or
  clockless requests.
- Re-verified the integrated Business Blueprint cockpit spine on the final `llm.ts`.

## Task Commits

Each TDD phase was committed atomically:

1. **Task 1 RED: availability behavior contract** — `a2b97bd`
2. **Task 1 GREEN: governed availability read tool** — `36c87d1`
3. **Task 2 RED: Calendar staging boundary contract** — `66c8bc3`
4. **Task 2 GREEN: proposed-only event staging and playbook invariant** — `480e5ac`
5. **Task 2 REFACTOR: preserve the additive hot-file diff** — `ad98aff`

## TDD and Mutation Evidence

- Task 1 RED produced exactly four failures, all `unknown cockpit tool: checkAvailability`; the
  existing 59 cockpit tests stayed green.
- Task 2 RED produced exactly five failures, all `unknown cockpit tool: proposeCalendarEvent`;
  Task 1 and the existing cockpit suite stayed green.
- Required mutation check: changing the staging patch from `status: "proposed"` to
  `status: "approved"` made the named no-Approve test RED with
  `expected 'approved' to be 'proposed'`. Restoring `proposed` returned it GREEN.

## Verification

- Plan gate (`cockpitTools` + `dispatchGuard` + `calendar`): **3 files, 98/98 passed**.
- Integrated Calendar + Blueprint gate (`cockpitTools`, `dispatchGuard`, `calendar`,
  `cockpitBlueprint`, `llmRedaction`, `runCockpitAgent`): **6 files, 170/170 passed**.
- Blueprint spine specifically: `cockpitBlueprint` **5/5**, `llmRedaction` **43/43**, and
  `runCockpitAgent` **24/24**.
- `pnpm typecheck` was run and held the documented baseline exactly: **59 backend test-file
  diagnostics, zero production diagnostics, zero in `llm.ts`, zero in `cockpitTools.test.ts`**.
- `pnpm --filter @pikar/web typecheck`: **passed**.
- `node scripts/check-playbooks.mjs`: **passed**.
- `llm.ts`: **115 additions, zero deletions** from integration commit `08ee242`.
- Tool-record keys: integration baseline **21**, final **23**, delta **+2**. The plan's
  “20 → 22” note predated the integrated `dispatchResearch` key; the asserted floor remains green.
- `llm.ts` has **zero `createEvent` occurrences** and the plan diff adds **zero global `fetch(...)`
  calls**.
- `plans.ts` and `cards.tsx` are byte-unchanged from `08ee242`.
- Local graph refresh and Convex edge fixup completed; graphify output remains uncommitted noise.

## Plan-Card and Live Trace Verification

- **Plan card, offline contract: verified.** The tool test leaves a real plan row with title,
  start, duration, timezone, and `status: "proposed"`. The frozen `cards.tsx` branch reads those
  fields and renders title, absolute time, duration, and **“Approve & add to calendar”**. No
  17-01 defect was found, and `cards.tsx` was not edited.
- **Live visual render: outstanding.** No web/Convex deployment was started in this worktree, so the
  staged card was not eyeballed in a browser.
- **Live trace rows: outstanding.** The activity transition “Checking your calendar…” →
  “Checked your calendar” still requires the plan's live deployment check. Offline trace-literal
  parity and the exact tool keys are green, but the silently-swallowed production insert failure
  mode cannot be closed offline by construction.

## Decisions Made

- Reused the one Calendar adapter, one notification kind, one formatter, and one
  `parseSendTime` implementation; no new clock, parser, fetch path, loop, or notification surface.
- Passed `clientContext.nowMs` to `internal.calendar.freeBusy`. The plan's extracted call snippet
  omitted it, but the integrated 17-02 adapter requires it and explicitly forbids inventing another
  clock.
- Left ACTN-02 pending. Plan 17-04 still owns the Approve arm, and 17-01 already recorded that
  update/cancel “manage” behavior is deferred rather than falsely complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed the lockfile-pinned workspace dependencies**
- **Found during:** Preflight verification
- **Issue:** The dedicated worktree had no `node_modules`, so Vitest was unavailable.
- **Fix:** Ran `pnpm install --frozen-lockfile`; manifests and lockfile remained unchanged.
- **Files modified:** Git-ignored dependency directories only
- **Verification:** All required Vitest and typecheck commands executed.
- **Committed in:** No tracked change

**2. [Rule 3 - Blocking] Restored integrated local Convex generated types**
- **Found during:** Preflight verification
- **Issue:** Git-ignored `_generated` files were absent. External Convex codegen was not permitted,
  and the first local artifact lacked Calendar modules.
- **Fix:** Copied the already-local generated artifact from the integrated Calendar worktree after
  verifying it contained `calendar`, `calendarComplete`, `blueprint`, and `llm`.
- **Files modified:** Git-ignored `packages/backend/convex/_generated/*`
- **Verification:** Runtime suites collected successfully; the Calendar/Blueprint API modules
  resolved; typecheck returned to the 59-diagnostic baseline.
- **Committed in:** No tracked change

**3. [Rule 3 - Blocking] Used the installed Vitest command shim directly**
- **Found during:** Preflight and task verification
- **Issue:** `pnpm exec vitest` did not resolve the package-local executable in this worktree.
- **Fix:** Invoked `packages/backend/node_modules/.bin/vitest.CMD` with the plan's exact arguments.
- **Files modified:** None
- **Verification:** Final plan gate passed 98/98; integrated gate passed 170/170.
- **Committed in:** No code change

**4. [Rule 3 - Blocking] Passed the integrated adapter's required trusted nowMs**
- **Found during:** Task 1 implementation
- **Issue:** The PLAN interface snippet omitted `nowMs`, while the shipped
  `internal.calendar.freeBusy` validator requires it and derives the range from that trusted clock.
- **Fix:** Passed `clientContext.nowMs` alongside `clientContext.tz`.
- **Files modified:** `packages/backend/convex/llm.ts`
- **Verification:** Availability tests, Calendar adapter tests, and typecheck delta all passed.
- **Committed in:** `36c87d1`

**5. [Rule 1 - Bug] Repaired multi-lane tracking helper writes**
- **Found during:** Phase tracking updates
- **Issue:** The single-lane tracking helpers prepended a second STATE frontmatter block and wrote
  Phase 17's 3/4 count into the Phase 17.1 roadmap section.
- **Fix:** Restored one authoritative STATE frontmatter block, preserved every foreign lane's
  position, and applied the 3/4 count only to Phase 17's lane, checklist, and progress row.
- **Files modified:** `.planning/STATE.md`, `.planning/ROADMAP.md`
- **Verification:** The final diff contains one STATE frontmatter block, Phase 17 is 3/4 with
  17-04 next, Phase 17.1 remains 6/10, and REQUIREMENTS.md is unchanged.
- **Committed in:** Final metadata commit

---

**Total deviations:** 5 auto-fixed issues (1 bug, 4 blocking issues).
**Impact on plan:** No feature scope was added. The fixes supplied local execution infrastructure
aligned the tool call with the already-integrated trusted-clock contract, and kept multi-lane
tracking authoritative.

## Authentication Gates

None.

## Issues Encountered

- Full typecheck remains red only on the documented 59 backend test-file diagnostics. The count and
  file class are unchanged from preflight; no production or touched-file diagnostic was introduced.
- A first graph refresh timed out after AST extraction; the warm-cache rerun completed, followed by
  the required Convex edge fixup.
- A targeted Biome check still reports the repository's CRLF formatting baseline, pre-existing
  non-null assertions, and the pre-existing aggregate-import placement in `cockpitTools.test.ts`.
  No unrelated formatting sweep was performed.

## User Setup Required

None for this plan. Existing users still need the widened Google consent described by 17-02 before
live Calendar reads.

## Next Phase Readiness

- Ready for 17-04 to replace the inert external-action arm with the human-approved retrier start.
- 17-04 must preserve the staging-only tool boundary and record ACTN-02's create-only versus
  deferred-manage traceability honestly.
- Live trace-row and browser card observations remain explicit UAT items.

## Self-Check: PASSED

All four required files exist, and commits `a2b97bd`, `36c87d1`, `66c8bc3`, `480e5ac`, and
`ad98aff` resolve on this branch.

---
*Phase: 17-calendar-actions*
*Completed: 2026-07-29*
