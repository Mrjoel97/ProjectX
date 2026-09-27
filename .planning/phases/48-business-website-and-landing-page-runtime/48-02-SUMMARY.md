---
phase: 48-business-website-and-landing-page-runtime
plan: 02
subsystem: backend-persistence
tags: [convex, tenant-isolation, immutable-versions, CAS, audit, export, erasure]

requires:
  - phase: 48-business-website-and-landing-page-runtime
    provides: closed web AST, deterministic renderer bytes, renderer identity and content hashes
provides:
  - additive tenant-owned web project, immutable version, metric and short-lived submission schema
  - tenant classification and rendered-artifact storage ownership maps used by export/erasure
  - tenant-wrapped draft, approval, platform-runtime publication, unpublish and exact rollback lifecycle
  - refs-only publication receipts and two-tenant export/erasure artifact coverage
affects: [48-03, 48-04, 48-05, 48-06, phase-49]

tech-stack:
  added: []
  patterns: [tenant-leading-indexes, append-only-version-artifacts, exact-revision-CAS, insert-only-publication-receipts]

key-files:
  created:
    - packages/backend/convex/webProjects.ts
    - packages/backend/convex/webProjects.test.ts
    - .planning/phases/48-business-website-and-landing-page-runtime/48-02-SUMMARY.md
  modified:
    - packages/backend/convex/schema.ts
    - packages/core/src/tenantData.ts
    - packages/core/src/tenantData.test.ts
    - packages/contracts/src/audit.ts
    - packages/backend/convex/tenantExport.test.ts
    - packages/backend/convex/tenantDelete.test.ts
    - packages/backend/convex/isolation.test.ts

key-decisions:
  - "All four Phase 48 persistence tables are tenant-owned and carry a tenant-leading by_tenant index; rendered version artifacts are reached through STORAGE_ID_FIELDS." 
  - "Publication readiness is closed to Pikar's platform-path runtime and tenant structured content; pending or unverified custom-domain posture cannot publish." 
  - "Publication attempts use the existing insert-only audit path with a closed refs/hashes/ids/counts payload; project pointers remain the lifecycle authority." 

patterns-established:
  - "Validated AST is canonicalized, rendered and stored before immutable version append; append failure cleans only the unreferenced artifact." 
  - "Save invalidates exact approval, and publish/update/unpublish/rollback require exact version/hash plus revision CAS." 

requirements-completed: [SITE-01, SITE-02, LAND-01, LAND-02]

duration: 35min
completed: 2026-09-21
---

# Phase 48 Plan 02: Tenant web persistence and lifecycle summary

Tenant-safe site and landing persistence now has one mutable project pointer, immutable rendered
versions, exact approval/publication CAS, refs-only lifecycle receipts, and map-driven export/
erasure coverage for project rows, metrics, idempotency state and rendered artifact blobs.

## Tasks completed

1. Added `webProjects`, `webProjectVersions`, `webMetrics`, and `webSubmissions` with closed
   hosting/source posture, artifact metadata, expiry timestamps and tenant-leading indexes.
2. Extended tenant classification and storage-field maps; export and erasure tests now cover a
   Phase 48 artifact and preserve a neighboring tenant's rows and blob.
3. Implemented tenant-wrapped create/save/approve/publish/update/unpublish/rollback operations,
   deterministic artifact storage/cleanup, exact approval/hash binding, revision CAS and an internal
   server-owned published resolver.
4. Added a closed publication audit payload contract plus isolation/redaction/source regression
   checks.

## Verification

- Passed Node 24 syntax checks for modified TypeScript sources.
- Passed direct schema/privacy self-check: 68 explicit schema tables, all four Phase 48 tables,
  no raw email/IP/user-agent/form-body fields on submissions.
- Passed direct lifecycle source self-check for tenant wrappers, storage cleanup and audit receipts.
- Passed `node scripts/check-audit-payloads.mjs --self-test`.
- Required `pnpm --filter @pikar/core test -- tenantData`, backend focused Vitest suites and backend
  typecheck could not execute because the pre-existing `node_modules` install lacks the `vitest`
  and `tsc` workspace binaries. No dependency or provider call was added.
- Git is unavailable in this environment; no per-task or metadata commit hashes are claimed.
- Graphify rebuild was intentionally not repeated; parent phase reconciliation can perform the
  consolidated source graph update.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Made both submission expiry indexes tenant-leading**
- **Found during:** Task 1 schema review
- **Issue:** A global expiry index would permit an unnecessary cross-tenant cleanup range.
- **Fix:** Kept both `by_tenant_expires_at` and `by_expires_at` tenant-leading so expiry cleanup
  remains tenant bounded and cannot affect a neighboring tenant.
- **Files modified:** `packages/backend/convex/schema.ts`, `packages/backend/convex/isolation.test.ts`
- **Verification:** direct schema/privacy self-check passed.
- **Commit:** unavailable (git executable is not installed).

**2. [Rule 3 - Blocking] Used direct Node checks for the incomplete workspace install**
- **Found during:** Task 1 verification
- **Issue:** pnpm could not find Vitest or TypeScript workspace binaries.
- **Fix:** Ran Node syntax, schema/privacy, lifecycle-source and audit-payload checks that do not
  require the missing binaries; recorded the normal gate as blocked.
- **Files modified:** none
- **Verification:** all direct checks passed.
- **Commit:** unavailable (git executable is not installed).

**Total deviations:** 2 auto-fixed (one isolation hardening, one verification fallback).
**Impact:** Persistence remains additive and tenant bounded; normal pnpm/Vitest/typecheck gates
remain pending a healthy dependency install.

## Authentication Gates

None.

## Issues Encountered

- Git is not installed, so task and metadata commits cannot be created or truthfully reported.
- `node_modules` is incomplete; pnpm Vitest and typecheck commands are blocked as documented above.

## Self-Check: PASSED

- All planned 48-02 source/test files exist.
- Schema and privacy maps include all four Phase 48 tables and the rendered artifact storage path.
- Direct syntax, schema/privacy, lifecycle source and audit self-checks passed.
- Commit-hash verification is not applicable because `git` is unavailable.
