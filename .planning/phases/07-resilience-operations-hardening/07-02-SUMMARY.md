---
phase: 07-resilience-operations-hardening
plan: 02
subsystem: infra
tags: [worm, s3, object-lock, audit, compliance, aws-sdk, convex, indexing]

# Dependency graph
requires:
  - phase: 07-01
    provides: "@pikar/core retention.ts (serializeAuditNdjson, wormObjectKey, retainUntilDate, RETENTION_MS); @aws-sdk/client-s3 installed; audit by_ts index"
provides:
  - "Real S3 PutObject WORM export replacing the Phase-1 throw (COMPLIANCE Object Lock + SHA256 checksum)"
  - "Cursor advances only after a confirmed durable PutObject; throw/empty never advances"
  - "auditSince rewritten onto the by_ts index (no full audit-table scan)"
  - "smoke:worm bucket-set mode; audit-dead-letter playbook documents the real export + deferred sweep"
affects: [operations, audit, compliance, phase-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Advance-only-after-durable-write: side-effecting cursor advance is unreachable unless the external write promise resolves"
    - "Explicit handler return type annotation to break Convex circular type inference (Pitfall 1)"
    - "Index range read (withIndex + take) replaces .collect()+filter+sort for cross-tenant windows"

key-files:
  created: []
  modified:
    - packages/backend/convex/worm.ts
    - packages/backend/convex/wormCursor.ts
    - packages/backend/convex/worm.test.ts
    - packages/backend/scripts/run-smoke-worm.mjs
    - docs/playbooks/audit-dead-letter.md

key-decisions:
  - "EXPORT ONLY per owner ruling — no delete/sweep of the hot audit table (SC#4 sweep DEFERRED)"
  - "Empty window returns { exported: 0 } with no PutObject and no advance"
  - "Explicit Promise<...> return type on exportAudit handler to break circular inference"

patterns-established:
  - "Advance-only-after-durable-write: cursor advance placed strictly after await s3.send(...), never in a catch"
  - "Mocked S3 send (vi.hoisted) proves durable→advance / throw→no-advance / empty→skip offline"

requirements-completed: [OPSG-03]

# Metrics
duration: 9min
completed: 2026-07-20
---

# Phase 7 Plan 02: Real WORM S3 Export Summary

**Daily audit export now PutObjects the incremental by_ts window to S3 as NDJSON under COMPLIANCE Object Lock with a SHA256 checksum, advancing the WORM cursor only after a confirmed durable write.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-20T23:11:27Z
- **Completed:** 2026-07-20T23:20:16Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Replaced the Phase-1 `throw` in `worm.exportAudit` with a real `@aws-sdk/client-s3` PutObject (COMPLIANCE mode + `ObjectLockRetainUntilDate` + `ChecksumAlgorithm: "SHA256"`), advancing the cursor only after the PutObject promise resolves.
- Rewrote `auditSince` onto the `by_ts` index (`withIndex("by_ts", q => q.gt("ts", since)).take(limit)`) — no more `.collect()` full scan of the unbounded audit table; rows come back ts-ascending so the manual sort is gone.
- Extended `worm.test.ts` with a mocked S3 send proving durable-write→advance, PutObject-throw→no-advance, and empty-window→skip, plus an index-window test (cross-tenant, exclusive boundary, limit-bounded).
- Added a `WORM_BUCKET`-set mode to `smoke:worm` and documented the real export path, invariants, bucket precondition, Convex-env creds, retention, and the deferred sweep in the audit-dead-letter playbook.

## Task Commits

1. **Task 1: Rewrite auditSince onto the by_ts index** - `81cc800` (refactor)
2. **Task 2: Real S3 PutObject export (advance only after durable write)** - `7356827` (feat)
3. **Task 3: Extend the live smoke + playbook** - `6304076` (chore)

## Files Created/Modified
- `packages/backend/convex/worm.ts` - Real S3 PutObject export; empty-window short-circuit; advance only after durable write; explicit handler return type
- `packages/backend/convex/wormCursor.ts` - `auditSince` index range read on `by_ts` (dropped full scan + manual sort + stale ponytail note)
- `packages/backend/convex/worm.test.ts` - Index-window test + mocked-S3 real-export tests (durable/throw/empty)
- `packages/backend/scripts/run-smoke-worm.mjs` - Bucket-set mode asserting an export count (S3 durability stays the manual console check)
- `docs/playbooks/audit-dead-letter.md` - Real export path + invariants + SC#4-partial record; Last verified bumped to 07-02

## Decisions Made
- **Export only, no sweep** (owner ruling, 07-CONTEXT): the hot Convex `audit` table is never deleted/swept — SC#4's sweep clause is deferred this phase. Documented as SC#4 partial, not a gap.
- **Empty window skips the S3 round-trip**: `{ exported: 0 }` returned without a PutObject (and without advancing).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Explicit handler return type to break Convex circular inference**
- **Found during:** Task 2 (real S3 export in worm.ts)
- **Issue:** The union return type (`{skipped,reason}` | `{exported,...}`) fed back through `internal` into the handler's own type, producing `TS7022/7023` circular-inference errors that cascaded `rows`/`m`/`r` to `any` (Convex Pitfall 1).
- **Fix:** Annotated the `exportAudit` handler with an explicit `Promise<...>` return type; the whole cascade resolved.
- **Files modified:** packages/backend/convex/worm.ts
- **Verification:** `pnpm typecheck` shows no worm.ts errors (only the two pre-existing Vite `import.meta.glob` errors in worm.test.ts, present at baseline).
- **Committed in:** `7356827` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for the plan's own code to typecheck. No scope creep.

## Issues Encountered
- Backend `pnpm typecheck` is not green at baseline (pre-existing `vault.ts`/`vaultGround.ts` implicit-any errors and the Vite `import.meta.glob` errors in test files). Confirmed the only worm-related errors were caused by (and fixed within) this plan's changes; the fixed access on the new mock-inspection line (`calls[0]?.[0]`) removed the one new error I introduced.

## User Setup Required

**External services require manual configuration** to exercise the real export path (the code takes the clean stub-skip path with `WORM_BUCKET` unset, so nothing breaks without it). Per the plan `user_setup`:
- Create an S3 bucket with **Object Lock ENABLED at creation** (cannot be enabled later) + a default COMPLIANCE retention.
- Set in the **Convex deployment env** (`npx convex env set`, NEVER Vercel): `WORM_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`.
- Verify: `WORM_BUCKET=<bucket> npm run smoke:worm` against the live deployment, then confirm ONE object in the S3 console carries `ObjectLockMode` + `RetainUntilDate` + checksum, and that a delete attempt is refused (07-VALIDATION Manual-Only — Node cannot assert S3 durability).

## Next Phase Readiness
- OPSG-03 export half met: audit rows export on schedule to WORM S3 under COMPLIANCE Object Lock with a checksum; the cursor advances only after a durable write; `auditSince` no longer full-scans.
- SC#4 is partially met by owner ruling — export implemented, hot-copy sweep DEFERRED (recorded, not a gap).
- Live S3 verification (bucket-set smoke + console inspection) is the phase-gate manual step; unit coverage is complete offline.

## Self-Check: PASSED

All 5 modified files present; all 3 task commits (`81cc800`, `7356827`, `6304076`) exist.

---
*Phase: 07-resilience-operations-hardening*
*Completed: 2026-07-20*
