---
phase: 50-tenant-merchant-commerce
plan: 19
subsystem: tenant-data
tags: [commerce, export, erasure, retention, convex, graphify]
requires:
  - phase: 50-18
    provides: physical/digital product, branch-policy and immutable order-snapshot schema
provides:
  - closed merchant-safe projection for all eight Plan 18 commerce tables and nested policy/order fields
  - named, bounded erasure refusals for orders, attempts and linked reservations
  - two-tenant, legacy, unknown-field and direct-page regression controls
affects: [tenant-commerce, tenant-data, future merchant adapters]
tech-stack:
  added: []
  patterns: [closed nested-field projection, indexed retention preflight, fail-closed bounded scan]
key-files:
  created: [50-19-PREEDIT-BASELINE-2026-09-24.md, 50-19-GRAPH-CHECKPOINT-2026-09-24.md]
  modified: [packages/core/src/tenantData.ts, packages/core/src/tenantData.test.ts, packages/backend/convex/tenantExport.ts, packages/backend/convex/tenantExport.test.ts, packages/backend/convex/tenantDelete.ts, packages/backend/convex/tenantDelete.test.ts, docs/playbooks/tenant-commerce.md, docs/playbooks/audit-dead-letter.md, docs/playbooks/skill-registry.md]
key-decisions:
  - "Unconsumed buyer-free catalogue and policy revisions erase; an actual order, attempt or linked reservation refuses before deletion until retention authority is accepted."
  - "Unknown top-level or nested commerce fields refuse export and erasure; attempt retry-key hashes are omitted from merchant export."
  - "Attempt-only reservation linkage has no index, so preflight refuses above 256 tenant reservations rather than scanning without bound."
requirements-completed: []
requirements-addressed: [SHOP-02, SHOP-03, SHOP-04, SHOP-05]
duration: 49min
completed: 2026-09-24
---

# Phase 50 Plan 19: Tenant commerce export and erasure summary

**A closed merchant-safe commerce projection now exports Plan 18 goods and policy facts without retry secrets, while bounded deletion refuses unresolved order and linked-hold retention before removing tenant data.** This is repository/local evidence, not an accepted retention law, provider approval, public checkout or Phase 50 completion.

## Performance

- **Started:** approximately 2026-09-24 15:53 Africa/Dar_es_Salaam
- **Completed:** approximately 2026-09-24 16:42 Africa/Dar_es_Salaam
- **Tasks:** 3/3 local tasks, subject to root-owned planning metadata integration
- **Files modified:** 9 owned source/test/playbook files, plus this summary and two evidence files
- **Commits:** none. Git was unavailable on this shell PATH, `.git` was read-only, and all nine owned files were already dirty before this plan. No broad staging or unrelated edit was made.

## Accomplishments

1. `tenantData.ts` now enumerates the eight existing commerce tables and their exact top-level and nested policy, snapshot and line fields. Values inherit row-atomic erasure disposition: unused buyer-free rows erase; orders and attempts refuse; linked reservations refuse. Export preserves system metadata, goods kind, revision, minor-unit amount/currency and policy provenance. It omits attempt `retryKeyHash`, marks legacy missing kind/policy branches explicitly, and throws `COMMERCE_FIELD_UNCLASSIFIED:<path>` or `COMMERCE_TABLE_UNCLASSIFIED:<table>` on unknown commerce shape. Thus an added buyer field cannot silently enter merchant export or refs-only metadata.
2. `tenantExport.ts` applies that projection only after the authenticated tenant-index query; a future unclassified commerce table refuses even when empty. `tenantDelete.ts` runs retention preflight on authorization **and every direct/replayed deletion page**, so a cursor jump cannot bypass an order/attempt hold or delete earlier tables first. Order-linked reservations use `by_tenant_order`; attempt-only linkage uses a bounded 256-row tenant probe with a named `RESERVATION_SCAN_CAP` refusal above the bound. The existing two-row deletion pages and storage/blob cleanup remain intact.
3. All three affected playbooks distinguish merchant declarations from legal/provider authority and document the exact export omissions and erasure refusal. No credentials, provider call, payment, public checkout, live commerce or application routing change was introduced.

## Verification

- TDD red controls: the new core classification cases initially failed without the new exports; the backend export case initially exposed `retryKeyHash`; the deletion case initially found only the old unnamed preflight refusal. The green implementation was then verified.
- Core focused `tenantData.test.ts`: **21/21**; combined `tenantInventory`, `tenantOrder`, `tenantData`: **33/33**.
- Backend focused `tenantExport`, `tenantDelete`: **47/47** (8 + 39); combined `tenantCatalogue`, `tenantOrders`, `tenantExport`, `tenantDelete`: **65/65** (6 + 12 + 8 + 39).
- Core and backend typechecks: **exit 0** each. Tenant-commerce boundary guard: **exit 0**, eight scanned sources. Strict playbook and planning checks: **exit 0** each before summary creation; the post-summary planning rerun is recorded in Self-Check below.
- `graphify update .` session 84937: **exit 0**, 65,803 nodes, 163,574 edges, 2,978 communities. It warned that 457 source files produced zero nodes and will be retried on future runs; none of the six changed source/test files lacked an AST hash. `node scripts/extract-convex-edges.mjs`: **exit 0**, removed 52,151 noise nodes and added 798 Convex plus 128 table edges across 76 tables. Exact file mtime matches a nonempty manifest AST hash for **6/6** Plan 19 source/test files.

| Fresh source/test file | Manifest AST hash |
| --- | --- |
| `packages/core/src/tenantData.ts` | `51d512030a77a2ae53e1edc3e31619f0` |
| `packages/core/src/tenantData.test.ts` | `2cd6d13177dd1ee31ded47629bdc3771` |
| `packages/backend/convex/tenantExport.ts` | `09266d43b9c60983feaaec9e3ffc97f2` |
| `packages/backend/convex/tenantExport.test.ts` | `6cf0cfe483c5caa612bb0d20a4b70875` |
| `packages/backend/convex/tenantDelete.ts` | `56a6664d72cceac64d4a4c6275274450` |
| `packages/backend/convex/tenantDelete.test.ts` | `56058189d8a677627c23653e6d146683` |

### Root post-review correction — 2026-09-24

The root review found that `commerceDeletionBlocker` recognized an `orderId`-linked reservation but
returned `null` for an `attemptId`-linked one, although the indexed/bounded preflight already refused
both. A new pure regression assertion failed RED (`null` versus `LINKED_RESERVATION`); the shared
blocker now checks either linkage. Combined core **33/33** and backend **65/65** tests passed again,
both typechecks exited 0, and the commerce boundary self-test, strict playbook and planning guards
passed. A scoped two-file Graphify rebuild exited 0 (13,652 nodes, 24,051 edges, 761 communities),
then Convex edge fixup exited 0; current manifest mtimes and nonempty AST hashes match **6/6**
Plan 19 source/test files. The two updated hashes are shown above. This does not change the legal,
provider or Git-integration claim boundary.

## Decisions and limits

- A policy revision or product is not itself a financial hold. Buyer-free, unconsumed rows erase when no order, attempt or linked reservation blocks them. No jurisdictional retention period was guessed.
- A real order or attempt blocks erasure with a durable named reason before provider revocation or any deletion page. The same guard runs on a direct page invocation, including a forged cursor jump. An orphan linked reservation is also detected before earlier tables are deleted.
- The Plan 18 schema has an index for `tenantReservations.orderId`, but not for `attemptId`; the 256-row cap is intentionally fail-closed. A tenant above that cap needs a later indexed disposition or reviewed resolution, not a false claim of complete erasure. This plan does not define the eventual retention law or unblock provider/account/Wave 7/8 gates.
- No root-owned `STATE.md`, `ROADMAP.md` or `REQUIREMENTS.md` was edited. Proposed integration: advance Phase 50 local summaries from **6/19 to 7/19**, add Plan 19's closed export/erasure contract and the 256-row attempt-link cap to state decisions, and keep SHOP-02/03/04/05 and ADR-049/provider/public-commerce gates open for remaining plans.

## Deviations from plan

- **Rule 2 — direct-page retention safety:** The old order check lived only in `authorizeTenantDeletion`; an internal direct page could bypass it. Running the indexed preflight on every page was necessary to meet the stated no-partial-erasure outcome.
- **Rule 2 — orphan attempt-link cap:** No attemptId index exists on reservations. A bounded 256-row scan and named over-cap refusal close the otherwise silent gap without editing Plan 18 schema or making an unbounded mutation query.
- **Rule 1 — recursive TypeScript map:** The first recursive alias did not typecheck; an interface plus a narrowed cast fixed it. Both package typechecks pass.

No checkpoint, authentication gate or external provider action was required. Pre-edit hashes and the live-graph checkpoint remain as separate durable evidence.

## Self-Check: PASSED — root metadata integrated

All nine source/test/playbook files, this summary and both evidence files exist (12/12). Strict
playbook rerun exits 0. The root integrator recorded Phase 50 as **7/19** in `ROADMAP.md` and
updated the canonical plan-disposition count in `STATE.md`; the post-integration
`node scripts/check-planning.mjs . --exit-code` returned `{"status":"passed"}`. No source or
graph gate remains for this plan. Shared-file Git integration, ADR-049, provider eligibility,
public commerce and closure Waves 7–8 remain open.
