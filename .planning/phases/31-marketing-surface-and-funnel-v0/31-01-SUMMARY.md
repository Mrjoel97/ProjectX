---
phase: 31-marketing-surface-and-funnel-v0
plan: "01"
subsystem: marketing
tags: [core, convex-schema, privacy, tenant-erasure]
requires:
  - phase: 31-00
    provides: Explicit PROCEED_COMPATIBLE A1/B1/C1 decision
provides:
  - Tested six-channel availability and aggregate counter contracts
  - Tenant-owned fixed-source funnel schema with hash-only token field
  - Export and erasure classification including retained artifact bytes
  - Watched Marketing playbook and downstream evidence matrix
affects: [31-02, 31-03, 31-04, 31-05, 31-06, 31-07]
tech-stack:
  added: []
  patterns: [pure TypeScript contracts, aggregate-only schema, native tenant lifecycle reuse]
key-files:
  created:
    - packages/core/src/marketing.ts
    - packages/core/src/marketing.test.ts
    - packages/backend/convex/funnels.test.ts
    - docs/playbooks/marketing.md
  modified:
    - packages/core/src/index.ts
    - packages/core/src/tenantData.ts
    - packages/core/src/tenantData.test.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/isolation.test.ts
    - docs/playbooks/watch.json
    - docs/playbooks/audit-dead-letter.md
key-decisions:
  - Fixed source accepts at most 64 input characters and normalizes lowercase ASCII words to a bounded slug
  - User-facing social blockers state legal-entity and provider-review facts without internal phase numbers
  - Funnel storage references participate in existing tenant erasure and export
requirements-addressed: [MKTG-01, MKTG-02, MKTG-03]
requirements-completed: []
completed: 2026-09-12
---

# Phase 31 Plan 01: Shared contracts and aggregate storage

The six-channel catalog, safe-integer counter parsing and minimal funnel table are implemented and qualified. Backend link behavior, lead recording, UI and live acceptance remain downstream work; this summary does not close the three product requirements.

## Tasks completed

1. Added pure core contracts and a barrel export. Gmail derives connected/connectable/blocked only from actual flags; unresolved data remains null. Each of five social channels names both current blockers. Source and stage parsing are bounded and deterministic, and missing/unsafe counters cannot become zero.
2. Added the `funnels` schema with tenant, fixed Vault/storage references, title/source, token hash, active/deactivated state, lifecycle timestamps and exactly three counters. Registered its tenant export/erasure and storage-byte ownership. Updated the schema header count and narrow bearer-hash isolation exception.
3. Added the watched Marketing playbook with the exact approved contract, full catalog, token/route/privacy boundaries, file-revocation limitation, consent/suppression rules and requirement-to-test/live matrix.

## Verification

- Red: initial core test failed because the module did not exist; initial schema tests failed because the table did not exist.
- Green: core Marketing 9 tests and tenant-data inventory 14 tests passed.
- Backend schema 41 tests, funnels 3 tests, tenant export 5 tests, tenant deletion 35 tests and isolation 47 tests passed across focused runs.
- The new integration test invokes native export and deletion seams: A's link/counters export; A's link and retained bytes erase even after its Vault reference is deleted; B's link and bytes survive.
- Core and backend TypeScript checks passed. Biome passed on owned implementation files. Playbook checker and diff check passed (line-ending notices only).
- Graph fixup succeeded against the usable existing graph and observes 61 tables. The earlier full refresh timed out after 14 minutes; complete AST graph freshness is not claimed.
- No model/provider calls, production data mutation, new public endpoint, UI activation or deployment occurred in this plan.

## Deviations from plan

- **Required lifecycle integration:** schema inventories would reject an unclassified table, and omitting retained storage references would orphan file bytes on erasure. The coordinator explicitly authorized minimal tenant-data classification/storage-map changes and behavioral coverage in this plan. Immutable audit and evaluation-accounting policy were preserved.
- **Existing isolation inventory:** added one named hash-index exception for the planned internal bearer resolver. Tenant-facing management remains tied to its tenant-leading index. The index does not authorize a public list.
- **Current product copy:** the coordinator required plain-language provider suitability/permissions review instead of an internal Phase 32 number in user-facing text. Both blocker facts remain tested; the phase boundary remains in the runbook.
- **Commit coordination:** the coordinator owns all atomic commits and global state/roadmap updates; this worker created no concurrent commit. Task-qualified file lists were delivered separately.

## Downstream handoff

31-02 must generate native APIs after implementing `funnels.ts`, validate counter integers/overflow in the transaction, generate and hash the token, enforce tenant/artifact ownership and disclose raw URLs only once. `v.number()` alone does not enforce integer safety. No counter-mutating API exists in this plan.

31-04 can proceed in parallel using the existing contacts writer and real suppression convergence tests. 31-03 follows the funnel API; 31-05 follows the HTTP and contacts paths. Keep the Marketing navigation disabled until the later evidence and activation record.

## Self-check

All listed files exist and focused checks passed. The coordinator committed contracts and the watched runbook in `7fa4fb2`, then schema, tenant lifecycle coverage and this summary in `71950e6`. Downstream APIs and live acceptance remain separate gates.
