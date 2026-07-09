---
phase: 01-foundation-governance-substrate
plan: 02
subsystem: infra
tags: [convex, convex-helpers, multi-tenant, biome, vitest, convex-test, tdd]

# Dependency graph
requires:
  - phase: 01-foundation-governance-substrate (plan 01)
    provides: monorepo + Convex backend substrate, schema.ts (demoItems table), Convex Auth identity source
provides:
  - tenantQuery/tenantMutation custom builders injecting tenantId from the authenticated identity
  - fail-closed UNAUTHENTICATED rejection on unidentified calls
  - unavoidable tenant scoping via biome noRestrictedImports ban + static importGuard test
  - explicit raw-builder allow-list for sanctioned internal modules
  - TenantCtx type (@pikar/core/tenant) and TenantId brand (@pikar/contracts/tenant)
  - demo.ts scoped module proving cross-tenant isolation with convex-test
affects: [audit, deadLetter, skills, review, worm, smoke, all future tenant-owned modules, BETA-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tenant-scoping wrapper: customQuery/customMutation + customCtx injects tenantId; handlers query via leading-tenantId index"
    - "Unavoidable scoping = wrapper + biome lint ban + static grep test (belt and suspenders)"
    - "Fail-closed auth: requireTenant throws UNAUTHENTICATED before any handler runs"
    - "edge-runtime-safe static scan via import.meta.glob raw loader (no node:fs)"

key-files:
  created:
    - packages/backend/convex/lib/functions.ts
    - packages/backend/convex/lib/allowlist.ts
    - packages/backend/convex/demo.ts
    - packages/backend/convex/tenant.test.ts
    - packages/backend/convex/importGuard.test.ts
    - packages/core/src/tenant.ts
    - packages/contracts/src/tenant.ts
  modified:
    - biome.json

key-decisions:
  - "tenantId === identity.subject (userId) for the single-owner beta"
  - "Static import-guard reads sources via import.meta.glob raw loader (edge-runtime has no node:fs)"
  - "biome noRestrictedImports lives in the style group; a per-file override exempts lib/functions.ts (sole raw-builder site)"
  - "Skipped optional RLS wrapDatabaseReader/Writer defense-in-depth; index-scoped handlers + lint ban + tests already prove isolation"

patterns-established:
  - "Every tenant-owned write flows through tenantMutation; every read through tenantQuery"
  - "Raw query/mutation are banned outside lib/functions.ts + the explicit internal allow-list"

requirements-completed: [SC-2]

# Metrics
duration: 18min
completed: 2026-07-09
---

# Phase 1 Plan 2: Tenant-Scoping Substrate Summary

**Unavoidable multi-tenant isolation via convex-helpers customQuery/customMutation wrappers that inject tenantId from the authenticated identity, enforced by a biome import ban + a static grep test and proven by convex-test cross-tenant negative tests.**

## Performance

- **Duration:** ~18 min active execution (wall clock spanned a transient session-limit pause)
- **Started:** 2026-07-09T04:53:08Z
- **Completed:** 2026-07-09T09:56:53Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- `tenantQuery`/`tenantMutation` builders inject `tenantId` from `ctx.auth.getUserIdentity()` and fail closed with `UNAUTHENTICATED` when no identity is present.
- Scoping made unavoidable two ways: a biome `noRestrictedImports` ban on raw `query`/`mutation` from `_generated/server`, plus a static `importGuard.test.ts` grep scan honoring an explicit internal allow-list.
- Cross-tenant isolation proven: convex-test shows User A's write is invisible to User B, a tenant reads only its own rows, and unauthenticated calls throw.
- Shared tenant contract exported: `TenantCtx` (`@pikar/core/tenant`) and `TenantId` brand + `TENANT_FIELD` (`@pikar/contracts/tenant`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Failing tenant-isolation + import-guard tests (RED)** - `0385176` (test)
2. **Task 2: Tenant wrapper + allow-list + demo scoped module (GREEN)** - `3f8c1ba` (feat)
3. **Task 3: Lint ban on raw builders + import-guard green** - `270c06d` (chore)

_TDD tasks 1-2 form the RED -> GREEN pair; no refactor commit was needed (implementation matched the verified interface exactly)._

## Files Created/Modified
- `packages/backend/convex/lib/functions.ts` - tenantQuery/tenantMutation via customQuery/customMutation + customCtx; sole sanctioned raw-builder import site.
- `packages/backend/convex/lib/allowlist.ts` - basenames of internal modules exempt from the raw-builder ban.
- `packages/backend/convex/demo.ts` - addItem/listItems scoped by the `by_tenant` index (isolation proof target).
- `packages/backend/convex/tenant.test.ts` - cross-tenant, own-item, and unauthenticated (mutation + query) tests via convex-test.
- `packages/backend/convex/importGuard.test.ts` - static scan banning raw query/mutation imports outside the allow-list.
- `packages/core/src/tenant.ts` - `TenantCtx` type + `UNAUTHENTICATED` sentinel.
- `packages/contracts/src/tenant.ts` - `TenantId` brand, `TENANT_FIELD`, `asTenantId`.
- `biome.json` - noRestrictedImports rule (style group) + override exempting lib/functions.ts.

## Decisions Made
- **tenantId === userId** for the beta (`identity.subject`); a real tenant table is deferred to later phases.
- **import.meta.glob raw loader** for the static scan instead of `node:fs`, because the vitest `edge-runtime` environment has no filesystem.
- **biome override** (not a suppression comment) exempts `lib/functions.ts`, keeping the wrapper clean and the ban authoritative.
- **Skipped optional RLS defense-in-depth** (`wrapDatabaseReader/Writer`): index-scoped handlers + lint ban + grep test + negative tests already satisfy SC-2; RLS can be layered later without changing the wrapper's public shape.

## Deviations from Plan

None - plan executed exactly as written. (Two test cases were added beyond the literal spec: an unauthenticated *query* rejection alongside the mutation one, and an "at least one module scanned" guard so the static test can never pass vacuously. Both strengthen the same success criterion and required no implementation change.)

## Issues Encountered
- A transient session-limit API error interrupted execution after the Task 1 RED commit. It was not a real failure; the coordinator confirmed the RED commit landed and execution resumed from Task 2. No rework was needed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The tenant wrapper is the isolation linchpin every later tenant-owned module (audit, deadLetter, skills, review, worm) now builds on; those modules are already pre-listed in the allow-list so the guard test stays green as they land.
- CLAUDE.md convention #2 (raw builders banned outside the wrapper) is now machine-enforced.
- Precondition for BETA-02 (Phase 9) delivered early.

## Self-Check: PASSED

All 8 declared files exist on disk; all 3 task commits (0385176, 3f8c1ba, 270c06d) present in history.

---
*Phase: 01-foundation-governance-substrate*
*Completed: 2026-07-09*
