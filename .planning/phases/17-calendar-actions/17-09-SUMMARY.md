---
phase: 17-calendar-actions
plan: 09
subsystem: calendar-management
tags: [convex, calendar, optimistic-concurrency, tools, react, playwright]

requires:
  - phase: 17-08
    provides: managed-event registry, provider inspection, conditional management, and Approve-only execution
provides:
  - bounded tenant-safe managed-event discovery with stable refs and content-plane labels
  - inspect-then-stage update/delete proposals pinned to a fresh provider etag
  - registry-backed management review card with truthful destructive and refusal states
affects: [17-10, 17-11, ACTN-02, cockpit, calendar-live-gate]

tech-stack:
  added: []
  patterns:
    - provider inspection followed by one atomic local staging mutation
    - refreshed registry snapshot as the management card's before-state
    - stable opaque Convex refs instead of model-visible provider ids

key-files:
  created:
    - apps/web/e2e/calendar-management.spec.ts
  modified:
    - packages/backend/convex/calendarEvents.ts
    - packages/backend/convex/calendarEvents.test.ts
    - packages/backend/convex/llm.ts
    - packages/backend/convex/cockpitTools.test.ts
    - packages/backend/convex/dispatchGuard.test.ts
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - docs/playbooks/cockpit.md

key-decisions:
  - "The model receives only managedEventId; provider and external event id are recovered after a tenant check."
  - "The provider inspection's attendee count and etag are revalidated in one stageChange transaction; another in-app stage changing the stored etag causes conflict."
  - "The refreshed calendarEvents row is the card's frozen before-state, avoiding unlanded duplicate snapshot fields on plans/schema.ts."

patterns-established:
  - "List cap: scan at most 100 active tenant rows, return at most 20 manageable rows sorted by start descending, and disclose truncation/omission counts."
  - "Staging order: validate input -> tenant snapshot -> inspect-only provider action -> refuse unsafe snapshot -> one atomic stageChange mutation -> return."

requirements-completed: [ACTN-02]

duration: 28 min
completed: 2026-08-20
---

# Phase 17 Plan 09: Managed-event discovery and safe staging Summary

**Tenant-safe stable-ref discovery and fresh-etag calendar update/delete proposals now stop at a truthful human review card; provider writes remain exclusively behind Approve.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-08-20T10:17:29Z
- **Completed:** 2026-08-20T10:45:00Z
- **Tasks:** 3
- **Files changed:** 8 implementation/test/playbook files, plus this summary

## Accomplishments

- Added `listManagedCalendarEvents`, a local read-only tool over `calendarEvents.listManageable`.
  It exposes only stable `managedEventId`, provider, title, start, duration, and timezone for at most
  20 manageable active tenant rows. Foreign, deleted, attendee-bearing, and etag-less rows are
  absent; omissions are counts and truncation is explicit. The tool invokes no migration, provider,
  audit, notification, or trace-content writer.
- Added `proposeCalendarChange` with a closed `update | delete` schema. The model cannot supply a
  provider id, external event id, etag, epoch, timezone, or delete comment. Natural-language time is
  parsed only from trusted `clientContext.nowMs/tz`; ambiguous, past, too-far, absent, or malformed
  proposals stop before provider inspection and write nothing.
- Added `calendarEvents.stageChange`, which rechecks tenant ownership, active/manageable state,
  stored-etag race, fresh attendees, provider support, plan tenant/status/kind, and actual changed
  fields in one mutation. It refreshes the registry snapshot and writes a `calendar_manage / proposed`
  plan with the fresh `calendarExpectedEtag` atomically.
- Replaced the reference-only management card with tenant-scoped registry readback: provider,
  current title/time/duration, operation, and only the desired fields that actually change. Delete
  uses the established destructive treatment and says the event remains until Approve without
  promising attendee notifications.
- Added static conflict/attendee/reconnect/provider-limitation refusal copy and an explicit restage
  or reconnect path, plus a 187-line offline seeded update/delete Playwright specification.

## Tool schemas and staging order

### `listManagedCalendarEvents`

Input is an empty closed object. Output rows contain:

`managedEventId · provider · title · startMs · durationMs · tz`

The tool is strictly read-only. The registry query scans at most 100 active tenant rows, applies the
shared `manageability()` gate, sorts by event start descending, returns at most 20, and reports
unsafe omissions only as a count.

### `proposeCalendarChange`

Input contains `managedEventId`, `operation`, and optional `title`, `when`, or `durationMinutes` for
updates. Delete rejects every optional content field. Execution order is:

1. validate closed operation/content and resolve natural-language time from trusted client context;
2. tenant-check the opaque managed-event ref and recover provider/external id server-side;
3. call the provider-neutral `internal.calendar.inspectEvent` read action;
4. refuse missing, reconnect-needed, attendee-bearing, or etag-less provider snapshots;
5. call `internal.calendarEvents.stageChange` exactly once and make no call afterwards.

The static dispatch guard proves the tool slice contains inspect before stage, one stage call, and no
`createEvent`, `manageEvent`, `executePlan`, calendar terminal, retrier, or direct fetch reference.

## Mutation evidence

Named tests cover the plan's seven failure mutations:

| Mutation | Failing evidence added |
|---|---|
| skip provider inspection | dispatch guard requires `internal.calendar.inspectEvent` before stage |
| accept external provider event id | schema exposes only `managedEventId`; foreign/missing tool replies are identical |
| stage without fresh etag | `stageChange` returns `needs_inspection` and leaves the plan collecting |
| write approved/delivering status | success assertion pins `status: proposed`; no run id exists |
| default ambiguous time | tool test asserts no fetch and no plan write |
| accept delete content | tool and mutation tests reject desired delete fields before proposal |
| remove tenant/active/race recheck | foreign, missing, deleted, superseded-plan, and stored-etag conflict tests pin no write |

Fresh provider attendees are also refused before either the registry or plan is patched.

## Card and browser evidence

The offline browser spec seeds a managed registry row and provider snapshot, reads the bounded list,
stages an update, checks the CURRENT EVENT and PROPOSED CHANGES blocks, then stages a delete and
checks the destructive button and remains-until-Approve copy. It also seeds both code-owned trace
verbs and asserts the card contains no recipient/subject/email-preview chrome.

**Execution ceiling:** Playwright was not available in this checkout, so the spec did not run and no
screenshots were produced. This summary makes no visual or browser-runtime pass claim.

## Verification

### Passed

- `node --experimental-strip-types --check` on all six changed `.ts`/`.spec.ts` files — exit 0.
- Source invariant script — PASS: inspection precedes the single stage mutation; no provider writer,
  approval, terminal, retrier, or direct fetch is named; cap/race/attendee/card anchors are present.
- `git diff --check` on every tracked plan-owned file — clean.
- Trace parity source readback — both tool literals remain in `schema.ts` and both code-owned verbs
  remain in `cards.tsx`.

### Blocked by the checkout

- Backend Vitest gate: `vitest` not found.
- Web typecheck: `tsc` not found.
- Playwright gate: `playwright` not found.
- Biome gate: `biome` not found.
- `node scripts/check-playbooks.mjs` evaluated this plan's `cockpit.md` update, then returned `block`
  only for concurrent, out-of-scope changes requiring `authorization.md` and `skill-registry.md`.
  Those files were not touched or falsely re-verified here.

No dependencies were installed and no live or paid provider/model call was made.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Integrated inherited partial Task 1/2 edits instead of restarting TDD**
- **Found during:** initial dirty-tree review
- **Issue:** `calendarEvents.ts` and its tests already carried uncommitted partial discovery/staging
  work; discarding it would violate the handoff and lose useful coverage.
- **Fix:** Preserved, reviewed, and completed the inherited edits. Tasks 1 and 2 share one scoped
  implementation commit because their inherited hunks were already interleaved.
- **Files modified:** `calendarEvents.ts`, `calendarEvents.test.ts`, `llm.ts`, tool/guard tests
- **Verification:** TypeScript syntax and source-invariant checks pass.
- **Committed in:** `19b3594`

**2. [Rule 3 - Blocking] Used registry readback instead of nonexistent plan snapshot columns**
- **Found during:** Task 3 card integration
- **Issue:** the partial staging mutation referenced `calendarOriginal*` fields that do not exist in
  the landed schema, while `schema.ts` is concurrently owned and explicitly outside this plan.
- **Fix:** Removed those invalid patches. `stageChange` refreshes the registry in the same transaction
  as proposal staging, and tenant-scoped `calendarEvents.forCard` reads that exact before-state.
- **Files modified:** `calendarEvents.ts`, `cards.tsx`
- **Verification:** no `calendarOriginal*` reference remains; static card/source checks pass.
- **Committed in:** `19b3594`, `85f578f`

---

**Total deviations:** 2 auto-fixed blocking issues. **Impact:** no scope expansion, no schema edit,
and no weakening of the provider-write or human-approval boundary.

## Issues Encountered

- The dependency installation is incomplete, so the requested Vitest, TypeScript, Playwright, and
  Biome executables are unavailable. Runtime/browser verification transfers to a dependency-complete
  checkout; source checks are not presented as substitutes.
- The shared tree contains unrelated concurrent edits. Commits used explicit plan-owned path lists;
  no README, schema, generated API, graphify, gap-ledger, superpower-doc, or other lane file was staged.

## Next Phase Readiness

- 17-10 and 17-11 remain. Do not run phase-completion or malformed `STATE.md` update commands yet.
- Before the live owner gate, restore dependencies and run the exact backend, web typecheck,
  Playwright, Biome, and playbook gates recorded above.
- 17-11 may now exercise list -> stage -> Approve against both providers, retaining ADR-023's
  Microsoft-delete refusal.

## Self-Check: PASSED

All eight implementation/test/playbook files and this summary exist. Commits `19b3594` and
`85f578f` resolve as commits in repository history.

---
*Phase: 17-calendar-actions*
*Completed: 2026-08-20*
