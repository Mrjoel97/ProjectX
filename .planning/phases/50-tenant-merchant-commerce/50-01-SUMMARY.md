---
phase: 50-tenant-merchant-commerce
plan: 01
subsystem: tenant-commerce-contract
tags: [commerce, typescript, money, boundary-guard]
requires:
  - phase: 49-qualified-public-web-and-storefront-recipes
    provides: dark presentation-only storefront and public-web ownership boundary
provides:
  - provider-independent commerce identities, checked integer-minor quote arithmetic and closed refusal outcomes
  - positive-control source guard separating tenant commerce from Pikar billing and read-only finance connectors
  - dedicated commerce playbook and watched Phase 50 source paths
affects: [50-02, 50-03, 50-04, 50-05, 50-06, 50-07, 50-08, 50-09, 50-10, 50-11, 50-12, 50-13, 50-14, 50-15]
tech-stack:
  added: []
  patterns: [pure TypeScript commerce core, typed fail-closed outcomes, exact scoped source-boundary scan]
key-files:
  created:
    - packages/contracts/src/tenantCommerce.ts
    - packages/core/src/tenantCommerce.ts
    - packages/core/src/tenantCommerce.test.ts
    - scripts/check-tenant-commerce-boundary.mjs
    - docs/playbooks/tenant-commerce.md
  modified:
    - packages/core/src/index.ts
    - docs/playbooks/watch.json
key-decisions:
  - "No merchant provider, account topology, card collection, public checkout or live charge is selected or opened by Plan 01."
  - "The shared HTTP source is scanned only within explicit tenant-commerce spans so existing Pikar billing routes remain separate."
patterns-established:
  - "Commerce minor amounts use checked safe integers; caller totals and display catalogue text have no payment authority."
requirements-touched: [SHOP-02, SHOP-03, SHOP-04, SHOP-05]
requirements-completed: []
completed: 2026-09-24
---

# Phase 50 Plan 01: Provider-independent tenant commerce contract

Pure commerce identities and quote arithmetic now refuse missing configuration, foreign/stale lines, unsafe money and client-supplied totals; an executable source guard enforces separation from Pikar billing and read-only connectors.

## Scope and claim boundary

This is repository/local contract evidence only. It does not select a merchant provider or account topology, configure a credential, collect card data, create checkout, enable a public storefront, charge a buyer, qualify Wave 7, or satisfy Wave 8 founder acceptance. ADR-049's owner decisions and Plans 50-02 through 50-15 remain open. The four SHOP requirements are touched by the contract but remain unchecked until their full flows and evidence close.

## Tasks completed

1. Registered `tenant-commerce.md` and Phase 50 watch paths before the first commerce source edit; documented intentional overlap with public-web ownership on shared files.
2. Added distinct branded commerce refs, versioned policy refs, safe integer-minor arithmetic, bounded quote quantities, deterministic refs-only idempotency input, and closed refusal outcomes. Core tests cover positive arithmetic plus overflow, mixed currency, invalid amounts/quantities, client total override, absent configuration, stale and foreign facts.
3. Added an exact declared source inventory and positive-control boundary guard for forbidden billing/connector imports, secrets, ledger references, card-entry fields and reused Stripe webhook routes. Shared HTTP inspection is limited to explicit tenant-commerce spans.

No new dependency, provider request, app `.env` edit, merchant choice, public route, or live commerce action occurred. Implementation files remain uncommitted for root's batched review; pre-existing edits in `packages/core/src/index.ts` and `docs/playbooks/watch.json`, plus unrelated staged user files, were preserved.

## Verification

| Check | Result |
|---|---|
| `pnpm --filter @pikar/core test -- src/tenantCommerce.test.ts` | exit 0; 5/5 tests |
| `pnpm --filter @pikar/core typecheck` | exit 0 |
| `node scripts/check-tenant-commerce-boundary.mjs --self-test` | exit 0; 11 positive controls, 2 current sources scanned |
| `node scripts/check-tenant-commerce-boundary.mjs` | exit 0; 2 current sources scanned |
| `node scripts/check-playbooks.mjs check --exit-code` | exit 0 with restored portable Git on PATH |
| `node scripts/check-planning.mjs . --exit-code` | exit 0 before summary creation; post-summary check reports Phase 50 ROADMAP 0/15 versus canonical 1/15, pending root-owned row update |
| Scoped Graphify `_rebuild_code(Path('.'), changed_paths=[seven Plan 01 paths], force=False)` with one worker | terminal exit 0; no remaining code-graph topology changes |
| Graph manifest and graph check | all seven scoped entries match current source mtimes and have nonempty AST hashes; 36 `tenantCommerce` graph nodes |
| `node scripts/extract-convex-edges.mjs` after successful rebuild | exit 0 |

The Graphify run warned that `docs/playbooks/watch.json` produced zero graph nodes; it is a watcher mapping, not source code. Earlier full and interrupted incremental rebuilds did **not** prove freshness. The terminal successful scoped run and exact manifest/source check above supersede that narrow Plan 01 verification gap; they do not repair the historical Phase 49 Graphify claim or certify a full-repository rebuild.

## Deviations and review handoff

The original `graphify update .` did not finish under Windows resource pressure. The repository hook exposed a scoped incremental path; after a competing hook writer exited, a one-worker seven-path run reached exit 0. Portable Git briefly disappeared from PATH between attempts and was restored from a verified local archive before the final strict playbook pass. These were verification-environment issues, not product behavior changes.

The root's batched review independently confirmed the seven source/manifest matches and 36 graph nodes, updated the Phase 50 roadmap row to 1/15, and reran strict planning, playbook, focused core tests, typecheck and boundary self-test at exit 0. Only Plan 01-owned additions are included in its scoped commit; unrelated pre-existing staged and shared-file edits are excluded. This summary is not release acceptance.

## Self-Check: PASSED

All five new implementation/documentation files and both intentionally appended shared-file additions exist. The focused checks and post-rebuild edge fixup passed, and the post-summary planning count now reconciles at 1/15. The Plan 01 commit includes only these owned additions and evidence.
