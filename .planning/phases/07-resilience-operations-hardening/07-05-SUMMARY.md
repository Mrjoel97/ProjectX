---
phase: 07-resilience-operations-hardening
plan: 05
subsystem: notifications
tags: [OPSG-05, notifications, dead-letter, gmail, redaction, §4]
requires:
  - "@pikar/core notificationMessage / NotificationKind (07-01)"
  - "gmail.ts freshAccessToken / buildMime / base64Url / SEND_ENDPOINT (governed send seam)"
  - "review-gate + timeout + agent.timeout notify sites (07-03 / 07-04)"
provides:
  - "notify choke point: in-app insert + best-effort scheduled external email"
  - "notifyExternal.dispatch: fail-closed, loop-guarded external channel"
  - "deadletter user notification at BOTH DLQ terminals"
  - "§4 static scan over every notify/external site"
affects:
  - "packages/backend/convex/notifications.ts"
  - "packages/backend/convex/notifyExternal.ts"
  - "packages/backend/convex/deadLetter.ts"
  - "packages/backend/convex/gmail.ts"
tech-stack:
  added: []
  patterns:
    - "schedule an action from a mutation (runAfter 0) to isolate a slow/failing external send from the in-app write"
    - "fail-closed-to-in-app + loop-guarded external channel (swallow-all try/catch, never notify/dead-letter)"
    - "§4 static-label firewall extended to notify call-sites (mutation-checked RED-then-revert)"
key-files:
  created:
    - "packages/backend/convex/notifyExternal.ts"
    - "packages/backend/convex/notifications.test.ts"
  modified:
    - "packages/backend/convex/notifications.ts"
    - "packages/backend/convex/deadLetter.ts"
    - "packages/backend/convex/gmail.ts"
    - "packages/backend/convex/smokeAssert.ts"
    - "packages/backend/scripts/run-smoke-dlq.mjs"
    - "packages/backend/convex/llmRedaction.test.ts"
    - "docs/playbooks/audit-dead-letter.md"
    - "docs/playbooks/cockpit.md"
decisions:
  - "External notification = send-to-self: notifyExternal resolves the user's OWN mailbox via a read-only users/me/profile GET and emails a STATIC kind label — no new recipient plane, no content."
  - "The external send reuses gmail.ts's governed SEND_ENDPOINT (exported, not duplicated) so llmRedaction's POST-target scan stays the single source of truth — no second send fetch was added to gmail.ts (that would have broken the exact-two-POSTs scan)."
  - "The deadletter notify fires only when a requestId ref is present in context.payload — synthetic smokes (runFailingPipeline) skip it; the AGNT-03 seedPipeline path (has a requestId) proves it."
metrics:
  duration_min: 17
  tasks: 3
  files_changed: 10
  tests: "39 passing (notifications 2, deadLetters 4, llmRedaction 33)"
  completed: 2026-07-20
---

# Phase 7 Plan 05: User-Facing Notification Matrix Summary

One wiring layer so every failure terminal in the phase surfaces to the user in-app AND by email: `notify`
became the single choke point (in-app insert then a best-effort, fail-closed, loop-guarded external email),
the DLQ now notifies at both terminals, and the §4 static scan grew to cover every notify/external site.

## What shipped

**Task 1 — notify choke point + external channel (TDD).** `notifications.notify` now inserts the in-app row
(the fail-closed floor) and then `ctx.scheduler.runAfter(0, internal.notifyExternal.dispatch, { tenantId, kind })`.
`notifyExternal.dispatch` (new, "use node") resolves the user's own mailbox address (read-only `users/me/profile`
GET), builds a STATIC `Pikar: <kind>` subject + `notificationMessage(kind)` body via the governed Gmail send seam,
and swallows every failure — no connected mailbox / refresh fail / send error returns silently, and the whole send
is wrapped so a failure NEVER throws, NEVER re-notifies, NEVER dead-letters (the loop guard). `gmail.ts` exports
`freshAccessToken` / `base64Url` / `SEND_ENDPOINT` for the reuse (no second send fetch added — that would have
tripped the exact-two-POSTs scan). RED→GREEN: 2 tests (notify inserts + schedules; dispatch fails closed with no
token, inserts nothing).

**Task 2 — dead-letter user notification (both terminals).** `onPipelineComplete` (when a `requestId` ref is
present) and `deadLetterRecipient` (requestId always present) each fire `notify(kind="deadletter")` beside their
existing audit — requestId ref + static §4 label only. `smokeAssert.assertDeadLetterReason` (the assertion the
smoke polls) now also asserts the `deadletter` notification; `run-smoke-dlq.mjs`'s AGNT-03 path covers it.

**Task 3 — §4 scan + playbook.** `llmRedaction.test.ts` gained two scans: no notify message across pipeline /
cockpit / deadLetter / notifications / notifyExternal interpolates a content field; the external channel sends only
the kind enum member + `notificationMessage(kind)` (no content, no requestId), and the scheduled dispatch carries
`{ tenantId, kind }` only. Both were mutation-checked (injecting `${…body}` / a content field → RED, then reverted).
`audit-dead-letter.md` documents the notification matrix; `cockpit.md` notes the reused gmail.ts exports.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended `smokeAssert.assertDeadLetterReason` (not in `files_modified`)**
- **Found during:** Task 2
- **Issue:** The plan's `run-smoke-dlq.mjs` "assert a deadletter notification" cannot live in the `.mjs` — the assertion it polls is the `internalQuery` in `smokeAssert.ts`. `runFailingPipeline` (the first smoke cid) carries no requestId, so the notify never fires there; the AGNT-03 `seedPipeline` path (has a requestId) is where it does.
- **Fix:** Added the `deadletter` notification check to `assertDeadLetterReason` (mirrors `assertReviewExpired`/`assertReviewEscalated`), and updated the `.mjs` log/comment to note the coverage.
- **Files modified:** `packages/backend/convex/smokeAssert.ts`, `packages/backend/scripts/run-smoke-dlq.mjs`
- **Commit:** f60c0ba

**2. [Rule 3 - Blocking] Bumped `cockpit.md` (not in `files_modified`)**
- **Found during:** Task 3 (check-playbooks gate)
- **Issue:** `gmail.ts` is a `cockpit.md`-watched path and I exported three helpers from it; the Stop hook blocks finishing with a watched file changed and its playbook untouched.
- **Fix:** Added a one-line note to `cockpit.md` (the gmail.ts exports are reused by `notifyExternal` for the OPSG-05 external channel, behavior unchanged) and bumped its `Last verified` to 07-05.
- **Files modified:** `docs/playbooks/cockpit.md`
- **Commit:** 6862787

## Verification

- `pnpm --filter @pikar/backend test notifications deadLetter llmRedaction` → 39/39 green.
- Backend source `tsc --noEmit` clean for all touched source files (pre-existing test-file `import.meta.glob` errors untouched, documented non-regressions).
- `node scripts/check-playbooks.mjs` → exit 0.
- §4 scans mutation-checked: both go RED on a deliberate content leak, GREEN after revert.

## NOT run (live-only, phase gate)

`npm run smoke:dlq` (workflows don't run under convex-test — needs a live dev deployment). The manual phase-gate
trigger of each failure class → one in-app notification AND one external email per event, and confirming a FAILED
external send does not recursively notify, is the human-verify owed at phase close.

## Commits

- `9396b59` test(07-05): failing test for notify choke point + external dispatch (RED)
- `894ea78` feat(07-05): notify choke point + best-effort external email dispatch (GREEN)
- `f60c0ba` feat(07-05): dead-letter fires a user notification at both DLQ terminals
- `6862787` test(07-05): extend §4 static scan to notify/external sites + document the matrix

## Self-Check: PASSED

All created files present (notifyExternal.ts, notifications.test.ts, SUMMARY.md); all four task commits (9396b59, 894ea78, f60c0ba, 6862787) exist in history.
