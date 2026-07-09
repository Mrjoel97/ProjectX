---
phase: 01-foundation-governance-substrate
plan: 07
subsystem: infra
tags: [convex, crons, worm, s3-object-lock, audit, cursor, "use-node", action]

# Dependency graph
requires:
  - phase: 01-01
    provides: Convex backend + schema (audit table, exportCursors {name, lastExportedTs} + by_name index)
  - phase: 01-03
    provides: insert-only audit surface (the rows the WORM export will ship)
  - phase: 01-06
    provides: smokeRun.mjs (output-based pass/fail helper) + dev-deployment smoke harness reused here
provides:
  - "Daily worm-export cron (03:00 UTC) -> internal.worm.exportAudit (SC-4, WORM half)"
  - "'use node' internalAction stub that reads the export cursor and no-ops cleanly (logs 'worm export skipped (stub)') when WORM_BUCKET is unset, WITHOUT advancing the cursor"
  - "WORM cursor mechanics (getCursor/auditSince/advanceCursor) ready for Phase 7 incremental S3 export (OPSG-03)"
  - "Documented Phase-7 Object-Lock gotchas in code: bucket-lock-at-creation, PutObject checksum, Convex-env creds"
affects: [phase-07, worm-export, compliance-log, audit-retention]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "'use node' action modules may contain ONLY actions — DB-touching query/mutation helpers live in a sibling normal module (wormCursor.ts), reached via ctx.runQuery/ctx.runMutation"
    - "Export cursor as never-advance-on-stub: the cursor advances ONLY after a confirmed durable write, so an un-exported audit row is never marked exported (no compliance-log hole)"

key-files:
  created:
    - packages/backend/convex/crons.ts
    - packages/backend/convex/worm.ts
    - packages/backend/convex/wormCursor.ts
    - packages/backend/convex/worm.test.ts
    - packages/backend/scripts/run-smoke-worm.mjs
  modified:
    - packages/backend/convex/lib/allowlist.ts
    - packages/backend/package.json

key-decisions:
  - "Split cursor query/mutation helpers into wormCursor.ts: a 'use node' module rejects non-action functions (Convex push error), so getCursor/auditSince/advanceCursor cannot live in worm.ts"
  - "exportAudit returns { skipped: true, reason } on the stub path (in addition to console.log) so the live smoke can assert the skip via stdout regardless of where the CLI streams logs"
  - "auditSince is a bounded full-scan (no global by-ts index on audit); ponytail-marked, Phase 7 adds a by_ts index only if the incremental export needs to scale"

patterns-established:
  - "Never-advance-on-stub cursor: advance only after confirmed durable export — protects the compliance log from permanent holes"
  - "'use node' action + sibling helper module for DB access via ctx.runQuery/ctx.runMutation"

requirements-completed: [SC-4]

# Metrics
duration: ~20min
completed: 2026-07-09
---

# Phase 01 Plan 07: WORM Export Cron Stub Summary

**Daily worm-export cron + a 'use node' `exportAudit` action stub that reads the export cursor and no-ops cleanly ("worm export skipped (stub)") when WORM_BUCKET is unset, never advancing the cursor — the future home of the outside-Convex immutability guarantee (SC-4, WORM half).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-09T23:28Z
- **Completed:** 2026-07-09T23:34Z
- **Tasks:** 1 (TDD: RED test → GREEN implementation)
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments
- `crons.ts` registers a daily `worm-export` at 03:00 UTC targeting `internal.worm.exportAudit`; pushed to the live dev deployment via codegen.
- `worm.ts` (`"use node"`) `exportAudit`: reads the cursor and, when `WORM_BUCKET` is unset, logs the exact stub-skip line and returns `{ skipped: true }` WITHOUT advancing the cursor. The Phase-7 S3 PutObject + Object-Lock path is a clearly-marked TODO with the three documented gotchas.
- `wormCursor.ts` holds the DB-touching helpers (`getCursor` 0-baseline, `auditSince` window, `advanceCursor` upsert) that the action reaches via `ctx.runQuery`/`ctx.runMutation`.
- `worm.test.ts` (written first, observed RED) covers the shape (use-node directive, cron registration), the cursor mechanics, and — critically — that the stub path does NOT advance the cursor.
- Verified: `pnpm vitest run` → 28/28 green (importGuard now scans the 3 new modules, all exempt via allow-list); `pnpm smoke:worm` green against the live dev deployment, logging "worm export skipped (stub)". No `@aws-sdk/client-s3` added.

## Task Commits

1. **Task 1 (RED): failing WORM cron + cursor tests** - `00dded3` (test)
2. **Task 1 (GREEN): WORM export cron stub + cursor mechanics** - `2d6ca42` (feat)

**Plan metadata:** committed with STATE.md + ROADMAP.md (docs).

## Files Created/Modified
- `packages/backend/convex/crons.ts` - daily worm-export cron -> internal.worm.exportAudit
- `packages/backend/convex/worm.ts` - "use node" exportAudit action; stub-skips without advancing cursor; Phase-7 Object-Lock TODO + gotchas
- `packages/backend/convex/wormCursor.ts` - getCursor / auditSince / advanceCursor (normal module, DB access for the action)
- `packages/backend/convex/worm.test.ts` - shape scan + cursor mechanics + never-advance-on-stub property
- `packages/backend/scripts/run-smoke-worm.mjs` - live-deployment smoke (reuses smokeRun.must)
- `packages/backend/convex/lib/allowlist.ts` - exempt worm.ts, wormCursor.ts, crons.ts from the raw-builder guard
- `packages/backend/package.json` - `smoke:worm` script

## Decisions Made
- **Cursor helpers split into `wormCursor.ts`.** A `"use node"` module may define ONLY actions — Convex rejected the query/mutation helpers in worm.ts at push time. Moved them to a normal sibling module; the action reaches them via `ctx.runQuery`/`ctx.runMutation` (actions cannot touch `ctx.db` anyway).
- **`exportAudit` returns a skip marker in addition to logging.** `{ skipped: true, reason }` on stdout makes the live smoke assertion robust no matter which stream the CLI uses for `console.log`.
- **`auditSince` is a bounded full-scan.** No global by-ts index exists on `audit` (only [tenantId, ts]); a full scan is correct and cheap for the stub. Ponytail-marked; Phase 7 adds a `by_ts` index only if needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] "use node" module cannot contain query/mutation functions**
- **Found during:** Task 1 (first `npx convex codegen` push)
- **Issue:** The plan's interface sketch put the cursor query/mutation helpers alongside the action in worm.ts. Convex rejected the push: "`advanceCursor` ... is a Mutation function. Only actions can be defined in Node.js." A "use node" module is action-only.
- **Fix:** Extracted `getCursor`/`auditSince`/`advanceCursor` into a new normal module `wormCursor.ts`; worm.ts's action calls them via `ctx.runQuery`/`ctx.runMutation`. Updated the test references and the allow-list. (The plan explicitly permitted "worm.ts or one small internal module".)
- **Files modified:** packages/backend/convex/wormCursor.ts (new), packages/backend/convex/worm.ts, packages/backend/convex/worm.test.ts, packages/backend/convex/lib/allowlist.ts
- **Verification:** `npx convex codegen` pushes cleanly; `pnpm vitest run` 28/28; `pnpm smoke:worm` green.
- **Committed in:** `2d6ca42` (Task 1 GREEN)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Necessary to deploy at all — a Convex platform constraint the plan sketch missed. No scope creep; the split is the sanctioned "small internal module" the plan named.

## Issues Encountered
- **`smoke:worm` requires the running dev backend.** As noted in 01-06, the local `convex dev` must stay running for `npx convex run` to reach the deployment; it was up throughout and the smoke passed. (Run-harness fact, not a code issue.)

## User Setup Required
None for Phase 1 — the stub needs no configuration. Phase 7 (OPSG-03) will require: an S3 bucket created WITH Object Lock enabled, and AWS creds + `WORM_BUCKET` set via `npx convex env set` (never Vercel). These are documented inline in worm.ts.

## Next Phase Readiness
- SC-4 WORM half satisfied: cron scheduled, action runs on the dev deployment logging the stub-skip, cursor mechanics in place, Phase-7 gotchas captured in code.
- Phase 7 (OPSG-03) picks this up: add `@aws-sdk/client-s3`, implement the PutObject-with-Object-Lock block, and advance the cursor only after a confirmed durable write.
- Plans 01-08 and 01-09 are human checkpoints (not touched by this execution).

---
*Phase: 01-foundation-governance-substrate*
*Completed: 2026-07-09*
