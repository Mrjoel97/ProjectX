---
phase: 50-tenant-merchant-commerce
plan: 03
subsystem: tenant-commerce-catalogue-ui
tags: [commerce, tenant-isolation, convex, react, accessibility]
requires:
  - phase: 50-tenant-merchant-commerce
    provides: Plan 02 tenant catalogue and finite/untracked inventory adapters
provides:
  - actual-adapter two-tenant, owner and anonymous product/stock/reservation isolation proof
  - authenticated tenant catalogue create, price edit, stock adjustment, policy, pause and activation controls
  - explicit finite/untracked, partial-page, stale/refusal and closed-checkout operator states
affects: [50-04, 50-05, 50-12, 50-13, 50-15]
tech-stack:
  added: []
  patterns: [tenant-scoped Convex references, exact product/stock revision mutations, responsive card controls]
key-files:
  created:
    - apps/web/app/(app)/dashboard/sites/TenantCatalogue.tsx
    - apps/web/app/(app)/dashboard/sites/tenantCatalogue.test.tsx
    - .planning/phases/50-tenant-merchant-commerce/50-03-PREEDIT-BASELINE-2026-09-24.md
  modified:
    - packages/backend/convex/isolation.test.ts
    - apps/web/app/(app)/dashboard/sites/page.tsx
    - docs/playbooks/tenant-commerce.md
    - docs/playbooks/authorization.md
    - docs/playbooks/public-web-runtime.md
    - .planning/phases/50-tenant-merchant-commerce/50-03-PLAN.md
key-decisions:
  - "The catalogue UI mounts only on the authenticated sites route and calls tenant-scoped adapters; an active private product never implies public checkout."
  - "Owner identity does not bypass per-tenant product, stock or reservation scope."
patterns-established:
  - "Admin mutations carry exact product or stock revisions, and stale/refused outcomes preserve operator inputs for retry."
requirements-touched: [SHOP-02]
requirements-completed: []
completed: 2026-09-24
---

# Phase 50 Plan 03: Tenant catalogue isolation and operator controls

## 2026-09-29 painted-browser re-entry attempt

A fresh loopback-only disposable Convex/production-web stack built and started
successfully, but no browser inspection occurred. The prescribed Playwright CLI
wrapper could not launch Git Bash in this sandbox (`E_ACCESSDENIED`), the direct
CLI package fetch failed `EACCES`, and the available computer-use runtimes
exposed no browser or usable kernel. The stack's own teardown exited 0,
confirmed its isolated audit, removed its exact owned temporary root, and left
no listeners on ports 3112/3410/3411. This is a tooling refusal, **not**
painted desktop/mobile proof or founder acceptance. The DOM/CSS and production
build evidence below remains the narrower local claim; re-entry needs a working
browser surface or preinstalled Playwright CLI package.

The authenticated sites workspace now has live tenant-scoped product and inventory controls; a production-adapter test proves swapped A/B product, stock and reservation IDs cannot cross tenants, including through an owner identity.

## Scope and claim boundary

This is repository/local Plan 03 evidence. It does not choose or contact a merchant provider, read or change `.env`, collect cards, open a public checkout/storefront, charge a buyer, or qualify Waves 7–8. `SHOP-02` is touched but remains open for the full commerce/browser/founder gates. The Phase 49 public storefront is unchanged and dark. Painted desktop/mobile browser and nontechnical founder verdicts remain for later integrated acceptance; the current UI tests exercise DOM interaction and a responsive CSS contract, not actual pixels.

## Tasks completed

1. Added a behavioral matrix in `isolation.test.ts` against the actual Plan 02 `tenantCatalogue` query/mutations: two admitted tenants, a separate owner, and anonymous caller. A/B list results are separate; foreign edit, stock adjustment, reservation and release refuse before writes; a swapped reservation with an otherwise owned product refuses; failed attempts append no audit receipts. Existing adapter behavior was already implemented, so the new isolation assertion passed on first run rather than producing an artificial TDD RED.
2. Added `TenantCatalogue` to the authenticated sites page. A tenant can create draft/active finite or explicitly approved untracked products, edit minor-unit price, adjust finite stock, configure a draft's stock policy, pause/reactivate, inspect exact available units and product/stock revisions, and paginate. The UI names private/closed commerce, loading/empty/partial, validation, stale conflict, generic refusal/retry and success without claiming merchant eligibility. Labels, touch-size controls, keyboard focus and `auto-fit` card layout are exercised in a DOM interaction suite at desktop/mobile viewport settings. The UI TDD RED first failed on the absent component, then passed after implementation.

## Verification

| Check | Result |
| --- | --- |
| `pnpm --filter @pikar/backend test -- convex/isolation.test.ts convex/tenantCatalogue.test.ts` | exit 0; 65/65 tests in 2 files |
| `pnpm --filter @pikar/web test -- tenantCatalogue` | exit 0; 6/6 tests in 1 file |
| `pnpm --filter @pikar/backend typecheck` | exit 0 |
| `pnpm --filter @pikar/web typecheck` | exit 0 on final UI/test source |
| `node scripts/check-tenant-commerce-boundary.mjs --self-test` and normal guard | exit 0; 11 positive controls; 5 sources scanned |
| `node scripts/check-playbooks.mjs check --exit-code` with portable Git on PATH | exit 0 on final owned files |
| `node scripts/check-planning.mjs . --exit-code` before summary | exit 0; root may need to advance the roadmap count after this summary |
| Seven-path scoped Graphify `_rebuild_code` with `GRAPHIFY_MAX_WORKERS=1` | terminal exit 0; 12,818 nodes, 22,522 edges, 715 communities |
| Exact graph manifest/source check | 7/7 paths match current source mtime and have nonempty AST hash |
| `node scripts/extract-convex-edges.mjs` after refresh | exit 0 |
| Scoped tracked-file `git diff --check` | exit 0 |

`pnpm exec biome check` could not run because `biome` is not resolvable in this checkout; it is not a Plan 03 gate. No formatter or bulk rewrite touched pre-existing edits.

## Deviations and root review handoff

- **[Rule 2 — missing critical]** The plan named a catalogue component but no route mount. Root approved the exact `sites/page.tsx` ownership expansion; without it the component would be inaccessible. The plan's files list and task files were updated. The UI test checks the authenticated page mount and absence of a checkout link.
- The responsive test validates labelled DOM controls, keyboard focus and the `auto-fit/minmax` layout contract at desktop/mobile width settings. It is not a painted browser screenshot or a founder usability verdict; those remain open.
- Exact pre-edit SHA-256 and owned-hunk map for five overlapping files are in `50-03-PREEDIT-BASELINE-2026-09-24.md`. In particular, `isolation.test.ts` and `authorization.md` already contained unrelated work; Plan 02's `tenant-commerce.md` changes are preserved. The two new UI files were absent. Do not stage these shared files wholesale as Plan 03-owned content without hunk review.
- No task/metadata commit was made per root's one-batched-review instruction. Root owns scoped acceptance, any roadmap/state/requirement update and commits. Unrelated staged and untracked user files were not modified.

## Next phase readiness

Plan 04 can use the authenticated catalogue and isolated stock adapter for provider-independent order data. Public commerce, provider decisions, Wave 7 external enablement and Wave 8 exact-production acceptance remain closed.

## Self-Check: PASSED

The two new UI files, route mount, isolation matrix, three playbook updates, plan-file scope correction and pre-edit note exist. All named Plan 03 focused tests, typechecks, boundary/playbook checks, terminal scoped graph refresh, seven manifest matches and post-refresh Convex edge extraction passed. Summary and work remain uncommitted for root's batched review.

## Current owner-scope continuation — 2026-09-25

The merchant-configured finite-stock hold choice exposed a local operator gap: `listProducts`
omitted the stored reservation TTL and an existing card initialized its editable window to an
unverified 15 minutes. The authenticated list now returns that stored TTL (or null for an
unconfigured/untracked product). The card shows the actual current minutes and permits a bounded
1–1,440-minute stock-revision-CAS edit on an active finite product. Existing reservation rows keep
their recorded expiry; this edit does not open checkout or approve the final public hold range.

Focused backend `tenantCatalogue` tests passed 6/6; web `tenantCatalogue` DOM tests passed 7/7,
including current-value display, active edit, invalid-value refusal and stale-revision input
preservation. Backend and web typechecks, the commerce boundary self-test (12 controls over eight
files), strict planning/playbook checks and the tracked-file diff check exited 0. Full `graphify update .`
exited 0, Convex edge fixup exited 0, and the four changed code/test paths have current, nonempty
AST hashes in its manifest. Painted browser/founder acceptance, provider eligibility, ADR-049,
public checkout and Wave 7/8 evidence remain open. No provider call, charge or send occurred.
