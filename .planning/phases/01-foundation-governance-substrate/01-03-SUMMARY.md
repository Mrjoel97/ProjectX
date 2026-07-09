---
phase: 01-foundation-governance-substrate
plan: 03
subsystem: infra
tags: [convex, audit, immutability, convex-test, vitest, typescript, governance, opsg-02]

# Dependency graph
requires:
  - phase: 01-01
    provides: monorepo + Convex backend substrate, `audit` table in schema.ts, convex-test harness (edge-runtime), @pikar/contracts + @pikar/core source-export packages
provides:
  - Insert-only audit module (convex/audit.ts) — the sole `internalMutation log()` write surface for the audit table
  - "@pikar/audit" pure-TS audit event-type taxonomy (AUDIT_EVENT_TYPES union + isAuditEventType guard)
  - "@pikar/contracts/audit" redaction-safe AuditPayload contract (refs/hashes/ids/counts only)
  - Immutability enforcement by convention + static-scan test (no patch/replace/delete; no public audit writer)
affects: [audit call sites in all later phases, WORM export (plan 07), dead-letter (plan 06), routing/review/delivery pipeline events]

# Tech tracking
tech-stack:
  added: ["@pikar/audit (new source-export workspace package)"]
  patterns:
    - "Insert-only module: audit table has exactly one write surface, an internalMutation; immutability enforced by convention + static scan (Convex has no append-only primitive)"
    - "Static-scan test with per-file `// @vitest-environment node` override to read source off disk (edge-runtime is the suite default)"
    - "Redaction-safe payload contract: AuditPayload permits only flat scalar/id-list metadata, making nested-object PII leaks unrepresentable"

key-files:
  created:
    - packages/backend/convex/audit.ts
    - packages/backend/convex/audit.test.ts
    - packages/backend/convex/auditImmutability.test.ts
    - packages/audit/package.json
    - packages/audit/src/index.ts
    - packages/audit/src/eventTypes.ts
    - packages/contracts/src/audit.ts
  modified: []

key-decisions:
  - "audit.ts imports the AuditPayload type from @pikar/contracts/audit (already a backend dependency) rather than @pikar/audit, satisfying the taxonomy/contract key-link without editing packages/backend/package.json — respects the parallel-plan file-scope boundary"
  - "Immutability static scan lives in a `node`-environment test file (docblock override) so it can readFileSync convex/*.ts; the convex-test insert path stays in the edge-runtime default"

patterns-established:
  - "Insert-only audit: single internalMutation write surface, no mutating audit functions, enforced by convention + static-scan test"
  - "Redaction-safe-by-type payload contract (AuditPayload) to keep the audit log from becoming a PII honeypot"

requirements-completed: [OPSG-02]

# Metrics
duration: ~8min active (wall-clock spanned a transient session-limit pause)
completed: 2026-07-09
---

# Phase 1 Plan 03: Insert-Only Audit Module Summary

**Insert-only `internalMutation log()` audit write surface backed by a pure-TS `@pikar/audit` event-type taxonomy and a redaction-safe `@pikar/contracts/audit` AuditPayload contract, with immutability enforced by a static-scan test (no patch/replace/delete, no public audit writer).**

## Performance

- **Duration:** ~8 min active (wall-clock inflated by a transient session-limit pause between RED and GREEN)
- **Started:** 2026-07-09T04:54:11Z
- **Completed:** 2026-07-09T09:54:32Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 7 created

## Accomplishments
- `convex/audit.ts`: the sole audit write surface — one `internalMutation log()` that inserts `{tenantId, correlationId, eventType, actor, payload, ts}`; no patch/replace/delete exists.
- `@pikar/audit`: new pure-TS source-export package with the `AUDIT_EVENT_TYPES` taxonomy (request.received, routing.decided, model.called, review.action, delivery.sent, deadletter.written) and an `isAuditEventType` guard.
- `@pikar/contracts/audit`: redaction-safe `AuditPayload` (refs/hashes/ids/counts/flags only — Pitfall 4 comment) that makes nested-object PII leaks unrepresentable.
- Immutability enforced by convention + `auditImmutability.test.ts` static scan: asserts no `.patch/.replace/.delete` in audit.ts, no public builder in audit.ts, and no PUBLIC query/mutation/action in convex/*.ts writes the `audit` table.

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1: Failing audit insert + immutability-scan tests (RED)** - `fb947fc` (test)
2. **Task 2: Audit taxonomy package + insert-only module (GREEN)** - `1782ab3` (feat)

_Note: RED committed with the two tests failing (audit.ts absent); GREEN made all 4 tests pass._

## Files Created/Modified
- `packages/backend/convex/audit.ts` - Insert-only `internalMutation log()`, the sole audit write surface.
- `packages/backend/convex/audit.test.ts` - convex-test: `internal.audit.log` inserts exactly one round-tripping row with numeric ts.
- `packages/backend/convex/auditImmutability.test.ts` - node-env static scan enforcing insert-only + no public audit writer.
- `packages/audit/package.json` - `@pikar/audit` source-export workspace package manifest.
- `packages/audit/src/eventTypes.ts` - Audit event-type taxonomy (union + guard).
- `packages/audit/src/index.ts` - Package barrel re-exporting the taxonomy.
- `packages/contracts/src/audit.ts` - Redaction-safe `AuditPayload` contract (Pitfall 4).

## Decisions Made
- Imported `AuditPayload` from `@pikar/contracts/audit` (an existing backend dependency) instead of `@pikar/audit` for the convex module's key-link. This satisfies the `@pikar/audit|@pikar/contracts` link contract without editing `packages/backend/package.json`, honoring the parallel-plan coordination boundary (plans 01-02/04/05 run concurrently). The `@pikar/audit` taxonomy remains available for future consumers.
- Put the immutability static scan in a `node`-environment test via a `// @vitest-environment node` docblock so it can read source files with `node:fs`, while the convex-test insert path uses the suite's edge-runtime default.

## Deviations from Plan

None - plan executed exactly as written. The only judgment call (type import source) is documented under Decisions Made and stays within the plan's `files_modified` scope.

## Issues Encountered
- Execution paused between the RED and GREEN commits due to a transient session-limit API error (not a real failure). Resumed on coordinator instruction: verified RED state, committed the (previously uncommitted) RED tests, then implemented GREEN. No work was lost.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- OPSG-02 met: audit is append-only via a single insert surface; no update/delete functions exist; immutability enforced by convention + static scan.
- Ready for consumers: pipeline events (routing/review/delivery), the dead-letter writer (plan 06), and the WORM export cron (plan 07) can call `internal.audit.log` with redaction-safe payloads.
- Note for future: `@pikar/audit` is not yet declared as a dependency of `packages/backend`; when a convex module needs the taxonomy values (not just the contract type), add `@pikar/audit` to the backend package.json.

## Self-Check: PASSED

All 7 created files present on disk; both task commits (`fb947fc` RED, `1782ab3` GREEN) found in git history.

---
*Phase: 01-foundation-governance-substrate*
*Completed: 2026-07-09*
