---
phase: 50-tenant-merchant-commerce
plan: 02
subsystem: tenant-commerce-inventory
tags: [commerce, inventory, convex, tenant-isolation, export, erasure]
requires:
  - phase: 50-tenant-merchant-commerce
    provides: Plan 01 provider-independent commerce contract and dark public boundary
provides:
  - pure finite/untracked SKU and reservation transitions with checked CAS revision, bounded TTL and late-paid exception
  - authenticated tenant catalogue and atomic stock adapter with refs/counts-only audit
  - three tenant-owned commerce tables included in existing export and erasure walkers
affects: [50-03, 50-04, 50-05, 50-07, 50-09, 50-12, 50-15]
tech-stack:
  added: []
  patterns: [pure TypeScript stock transitions, Convex tenant wrappers, revision CAS, generic lifecycle classification]
key-files:
  created:
    - packages/core/src/tenantInventory.ts
    - packages/core/src/tenantInventory.test.ts
    - packages/backend/convex/tenantCatalogue.ts
    - packages/backend/convex/tenantCatalogue.test.ts
  modified:
    - packages/backend/convex/schema.ts
    - packages/core/src/tenantData.ts
    - packages/core/src/tenantData.test.ts
    - packages/backend/convex/tenantExport.test.ts
    - packages/backend/convex/tenantDelete.test.ts
    - docs/playbooks/tenant-commerce.md
    - docs/playbooks/audit-dead-letter.md
    - docs/playbooks/skill-registry.md
key-decisions:
  - "Finite onHand minus reserved is authoritative; a missing 1m–24h TTL blocks active sale, while untracked stock requires explicit approval."
  - "A draft may CAS-configure its stock policy before activation, but finite/untracked kind conversion refuses review-free mutation."
  - "Buyer-free catalogue, stock and reservation rows are tenant-owned; future financial-record retention remains an owner-policy gate."
  - "Every stock-writing transition refuses MAX_SAFE_INTEGER revision overflow; a late-paid exception remains read-only."
patterns-established:
  - "All stock-changing operations compare exact revision inside one tenant mutation and emit refs/counts-only audit."
requirements-touched: [SHOP-02, SHOP-05]
requirements-completed: []
duration: 50 min
completed: 2026-09-24
---

# Phase 50 Plan 02: Tenant catalogue and finite stock

Tenant-owned products, finite stock and reservations now have atomic revision-controlled writes, explicit untracked approval, bounded expiry and buyer-free export/erasure coverage; the public storefront remains dark.

## Scope and claim boundary

This is repository/local qualification of Plan 02 only. It does not select or contact a provider, read or change the app `.env`, collect card data, open checkout, publish a storefront, establish financial-record retention, or close SHOP-02/SHOP-05 at the full-flow level. Plan 03 still owns operator UI and extended foreign-tenant/public boundary checks. Waves 7 and 8 remain open.

## Tasks completed

1. Pure SKU/variant/status, integer-minor price, finite/untracked inventory, CAS restock/reserve/release/expiry and late-paid exception. TDD RED first failed on the absent module. Root review then found that stock revisions could increment beyond `Number.MAX_SAFE_INTEGER`; an overflow test went red and a shared checked-next-revision helper made all 6/6 focused inventory tests pass.
2. Three tenant-leading schema tables, thin authenticated tenant adapter, finite-stock adjustment and reservation mutations, paginated catalogue read, refs/counts-only audit, generic export/erase classification and two-tenant behavior tests. Backend TDD RED first failed on the absent adapter. Existing generic `tenantExport.ts` and `tenantDelete.ts` needed no product branches; their tests now demonstrate actual row traversal.

## Verification

| Check | Result |
| --- | --- |
| `pnpm --filter @pikar/core test -- src/tenantData.test.ts src/tenantInventory.test.ts` | exit 0; 22/22 tests in 2 files |
| `pnpm --filter @pikar/backend test -- convex/tenantCatalogue.test.ts convex/tenantExport.test.ts convex/tenantDelete.test.ts` | exit 0; 49/49 tests in 3 files |
| `pnpm --filter @pikar/backend test -- convex/schema.test.ts convex/isolation.test.ts` | exit 0; 100/100 tests in 2 files, after schema/classification additions |
| `pnpm --filter @pikar/core typecheck` | exit 0 on final source/tests |
| `pnpm --filter @pikar/backend typecheck` | exit 0 on final source/tests |
| `node scripts/check-tenant-commerce-boundary.mjs --self-test` | exit 0; 11 positive controls; 4 sources scanned, including new inventory/adapter |
| `node scripts/check-playbooks.mjs check --exit-code` with portable Git on PATH | exit 0 |
| Scoped Graphify `_rebuild_code` on all 12 changed source/playbook paths, then 5-path and root-review 3-path refinements, `GRAPHIFY_MAX_WORKERS=1` | all three runs terminal exit 0; final graph 12,797 nodes/22,509 edges/726 communities |
| Exact graph manifest/source check | 12/12 paths have matching source mtime and nonempty AST hash; 25 inventory nodes, 28 catalogue nodes, product-table node present |
| `node scripts/extract-convex-edges.mjs` after final refresh | exit 0; 71 table nodes, no missing new edges in final fixup |
| Scoped `git diff --check` | exit 0; CRLF normalization warnings for two pre-existing playbooks only |

The optional `pnpm exec biome check` did not run because the repository's current binary resolution returned `biome` not recognized; it was not a Plan 02 verification gate. No formatter was run over pre-existing edits.

## Shared-file ownership for root review

Seven shared files were already dirty before this plan; their exact pre-edit SHA-256 hashes and diff counts are in `50-02-PREEDIT-BASELINE-2026-09-24.md`. Only these additions/changes belong to Plan 02:

- `schema.ts`: index header `68`→`71`, tenant-commerce index label, and the three `tenantProducts`/`tenantStock`/`tenantReservations` table blocks appended after `webSubmissions`.
- `tenantData.ts`: three Phase 50 `tenant_owned` rows after `webSubmissions`; `tenantData.test.ts`: `68`→`71` and the Phase 50 lifecycle test.
- `tenantExport.test.ts`: the Phase 50 two-tenant export test; `tenantDelete.test.ts`: the Phase 50 two-tenant erasure test.
- `audit-dead-letter.md` and `skill-registry.md`: the new first `Last verified: 2026-09-24` paragraphs only.

Do not stage those seven worktree files wholesale: their other changes predate this plan. Four new code/test files and the `tenant-commerce.md` additions are Plan 02-owned. Existing unrelated staged user files remain untouched. Implementation is deliberately uncommitted for root's one batched review and scoped commit; STATE/ROADMAP/REQUIREMENTS updates belong to root after acceptance.

## Deviations from plan

- **[Rule 2 — missing critical]** Added a CAS policy-configure mutation. Without it, a valid draft created before a reservation TTL was known could never become active under its SKU; the only alternative was an impossible duplicate SKU. Pure and adapter tests cover configuration, stale revision and forbidden stock-kind switch.
- **[Rule 2 — missing critical]** Paginated the authenticated catalogue read. A fixed first-100 result silently hid later products; a two-page test now proves complete access without an unbounded scan.
- **[Rule 1 — bug, found in root's batched review]** `Number.MAX_SAFE_INTEGER` was an accepted stock revision and five writing transitions incremented it to an unsafe number. One checked-next-revision helper now serves adjustment, policy configuration, reservation, release/expiry and consumption (as well as product edit). The overflow test proves each refusal and that late-paid exception leaves the stock unchanged. Final core/backend tests, both typechecks, boundary guard, playbook gate and scoped graph/edge refresh all passed after the fix.
- The generic export/delete walkers already derive their table set from `tenantData.ts`, so no branch was added to `tenantExport.ts` or `tenantDelete.ts`. Two-tenant tests prove the existing path handles the new tables.

## Self-Check: PASSED

All four new code/test files, eight changed existing code/doc files and the baseline note exist. The exact Plan 02 tests, types, tenant boundary, playbook gate, successful Graphify refresh, manifest match and post-refresh Convex edge fixup are recorded above. Per root instruction no task or metadata commit was made by this worker, and Plan 02 is ready for root acceptance rather than independently marked closed.
