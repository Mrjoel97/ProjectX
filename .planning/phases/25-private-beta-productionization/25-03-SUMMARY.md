---
phase: 25-private-beta-productionization
plan: 03
subsystem: tenant-isolation-testing
tags: [BETA-02, BETA-05, convex, authorization, schema-drift]
requires:
  - phase: 22.1
    provides: TENANT_TABLE_CLASSIFICATION and table-classification drift guard
  - phase: 25-01
    provides: admission-plane tables and raw public invite builders
provides:
  - runtime-schema table and index coverage gate
  - source-derived public-function and owner-endpoint coverage gate
  - proof that SkillOpt grounded prose remains on the internal bearer-token plane
affects: [authorization, schema, owner-endpoints, skillopt]
tech-stack:
  added: []
  patterns:
    - derive inventories from runtime schema and source scans instead of duplicating static lists
    - require schema-valid harmless arguments before asserting OWNER_REQUIRED
key-files:
  created:
    - packages/backend/convex/isolation.test.ts
  modified:
    - docs/playbooks/authorization.md
    - docs/playbooks/skill-registry.md
    - .planning/phases/25-private-beta-productionization/25-03-PLAN.md
key-decisions:
  - "Keep buildTrajectoryExport internal and bearer-gated; converting it to ownerQuery would break token-authenticated CI."
  - "Apply the tenant-leading index rule to every table with a tenantId validator, including audit classifications."
patterns-established:
  - "A new table, public builder, owner endpoint, or non-tenant-leading index must be classified or make the gate red."
requirements-completed: []
duration: not-recovered
completed: 2026-08-16
---

# Phase 25 Plan 03: Isolation Gate Summary

**A schema- and source-derived regression gate now detects unclassified tables, unsafe indexes, unreviewed public functions, and owner endpoints that stop rejecting non-owners.**

## Performance

- **Duration:** Not recoverable from the historical commit
- **Completed:** 2026-08-16T23:00:35+03:00
- **Tasks:** Static coverage and owner-boundary work landed; the planned exhaustive two-user behavioral matrix did not
- **Files modified:** 4 in the implementing commit

## Accomplishments

- Runtime `schema.tables` is reconciled with the Phase 22.1 registry plus the six Convex Auth tables.
- Index inspection fails on a tenant-id-bearing table whose index does not lead with `tenantId` unless a named internal/owner-plane exception remains present.
- Public raw builders and owner wrappers are source-derived; new surfaces must be justified and owner endpoints are called with validator-valid arguments before `OWNER_REQUIRED` is asserted.
- The grounded-prose export is pinned to `internalQuery` behind the fail-closed SkillOpt bearer route.

## Task Commits

1. **Derived isolation, public-surface, owner-surface, and SkillOpt-plane gate** — [7f22a21](https://github.com/Mrjoel97/ProjectX/commit/7f22a219bd4ca52dd78211068066dda16607bdeb)

No separate plan-metadata completion commit or original summary was found; this summary is reconstructed from the implementing commit and current tree.

## Files Created/Modified

- [`isolation.test.ts`](../../../packages/backend/convex/isolation.test.ts) — runtime table/index inspection, public/owner source scans, non-owner calls, and SkillOpt boundary assertions.
- [`authorization.md`](../../../docs/playbooks/authorization.md) — derived-surface and evidence-boundary notes.
- [`skill-registry.md`](../../../docs/playbooks/skill-registry.md) — internal bearer-plane rationale and free-prose scrub ceiling.
- [`25-03-PLAN.md`](./25-03-PLAN.md) — amended with the measured corrections that changed execution.

## Decisions Made

- Reused `TENANT_TABLE_CLASSIFICATION`; a second hand-maintained table inventory was rejected as drift-prone.
- Scanned raw `query`/`mutation`/`action` exports as well as repository wrappers because the invite plane is intentionally unauthenticated.
- Kept `skilloptExport.buildTrajectoryExport` internal. Its only door is the bearer-gated HTTP route, not an owner-authenticated browser API.

## Deviations from Plan

### The planned owner-wrapped SkillOpt export was inverted

The plan's Task 3 would have converted an internal token-plane query into a public owner query. That would reject the CI exporter, which has a bearer token but no `users` identity. No `skilloptExport.ts` or `skilloptExport.test.ts` change landed; the isolation suite instead asserts the existing internal boundary.

### The planned “three” owner functions were fourteen at implementation time

The landed scan derived all owner endpoints across finance, optimizer config, skills, and invites. It has since expanded to include `ops.envCheck`; the current test documents that growth from 14 to at least 15.

### The exhaustive two-user matrix did not land

The current file contains structural/schema coverage and per-owner-endpoint non-owner rejection. It does not drive the plan's promised full cross-tenant read/write matrix across every covered tenant surface.

### HTTP routes remain outside the scan

The commit explicitly records eight `http.route` blocks with bespoke authentication as not covered by this wrapper/public-export gate.

## Verification Evidence

The implementing commit records `isolation.test.ts` 29/29, `isolation + invites` 62/62, backend typecheck, Biome, and playbook checks as passing, plus three reverted mutation checks. Those commands were **not rerun** during this reconstruction.

## Requirements and Live Gates

- `requirements-completed` is deliberately empty. This summary does not certify BETA-02 or BETA-05.
- HTTP-route coverage and the exhaustive two-identity behavioral matrix remain outside the landed proof.

## Next Phase Readiness

The structural regression gate is reusable by later schema and owner-surface work, but it is not a substitute for full tenant-behavior or live-deployment verification.

---
*Phase: 25-private-beta-productionization · Plan 03*
*Reconstructed: 2026-08-20*
