---
phase: 50-tenant-merchant-commerce
plan: 04
subsystem: tenant-commerce-local-order
tags: [commerce, cart, quote, inventory, convex, tenant-isolation]
requires:
  - phase: 50-tenant-merchant-commerce
    provides: Plan 02 live tenant catalogue and finite-stock transitions; Plan 03 authenticated operator access
provides:
  - explicit policy and live mapped-product server quote with exact minor-unit tax/shipping and immutable hash
  - tenant-scoped local cart, one order/attempt per cart revision, atomic stock holds and durable expiry
  - tenant-owned export and conservative order-retention erasure refusal
affects: [50-05, 50-06, 50-07, 50-08, 50-09, 50-10, 50-15]
tech-stack:
  added: []
  patterns: [pure provider-neutral quote, tenant-scoped Convex transaction, scheduled order expiry, content-plane order snapshot]
key-files:
  created:
    - packages/core/src/tenantOrder.ts
    - packages/core/src/tenantOrder.test.ts
    - packages/backend/convex/tenantOrders.ts
    - packages/backend/convex/tenantOrders.test.ts
    - .planning/phases/50-tenant-merchant-commerce/50-04-PREEDIT-BASELINE-2026-09-24.md
  modified:
    - packages/backend/convex/schema.ts
    - packages/core/src/tenantData.ts
    - packages/core/src/tenantData.test.ts
    - packages/backend/convex/tenantExport.ts
    - packages/backend/convex/tenantDelete.ts
    - docs/playbooks/tenant-commerce.md
    - docs/playbooks/audit-dead-letter.md
    - docs/playbooks/skill-registry.md
key-decisions:
  - "A cart revision can create at most one local order and attempt; a different retry key on that revision refuses."
  - "Order creation schedules exact-expiry stock release; checkout also reconciles a bounded expired backlog on demand."
  - "Any tenant order blocks tenant erasure until accounting-retention policy is decided; export remains available."
patterns-established:
  - "Operator-declared seller, geography, currency, tax, shipping and refund source refs are required local policy inputs, never inferred legal/provider eligibility."
requirements-touched: [SHOP-03, SHOP-04, SHOP-05]
requirements-completed: []
duration: approximately 50 minutes
completed: 2026-09-24
---

# Phase 50 Plan 04: Local cart, quote and order intent

An authenticated tenant can bind a private storefront cart to live mapped products, obtain an exact server quote, and persist one immutable local order, attempt and stock reservation transaction without selecting or calling a merchant provider.

## Performance

- Duration: approximately 50 minutes (2026-09-24 07:55–08:45 UTC)
- Tasks: 2/2
- Plan-owned source, test and playbook files: 12; handoff artifacts: 2

## Scope and claim boundary

This is repository/local contract evidence. There is no anonymous host-derived checkout entry, hosted session, card collection, provider call, buyer charge or public storefront activation. Phase 49 public storefront darkness remains. The operator-entered policy refs are explicit declarations, not verified merchant account, tax/legal, shipping, refund or country eligibility. No app key or `.env` was accessed.

## Tasks completed

1. `tenantOrder.ts` quotes only live mapped active products and explicit seller/tax/shipping/refund policy facts. It checks product price/revision, stock posture, address country, currency, quantities and safe integer arithmetic. A versioned SHA-256 snapshot pins product/stock/policy source identities and totals; cancellation after payment is a distinct request, and late payment after expiry is a review state. The Task 1 test first failed on the absent module, then passed after implementation.
2. `tenantOrders.ts` adds authenticated policy/mapping/cart commands, a private cart revision CAS, one attempt per cart revision, and a single Convex transaction that inserts order and local attempt, reserves every line, schedules expiry and appends refs/hash-only audit. Identical retries return the same attempt; a changed cart needs a new key; another key on the same revision refuses. Checkout reconciles up to five expired reservations for requested products before quote; a larger backlog refuses and a tenant-scoped paged repair command drains it. A scheduled internal expiry releases idle holds once. Five new tables and reservation linkage have tenant-leading indexes. Order content uses the tenant-owned export plane; deletion preflight refuses any order until an accounting-retention decision. Task 2 adapter tests were written alongside implementation; an initial test run caught and corrected an unexpected schema field.

## Verification

| Check | Result |
| --- | --- |
| Core order/inventory/data tests | exit 0; 27/27 in 3 files |
| Backend order/export/delete/schema tests | exit 0; 94/94 in 4 files, including 9 order adapter cases |
| Core and backend typechecks | exit 0 on final source |
| Commerce boundary self-test and normal scan | exit 0; 11 positive controls, 7 sources scanned |
| Strict playbook gate | exit 0 with portable Git on PATH |
| Phase 48/49 public project and HTTP regression | exit 0; 8/8 in 2 files |
| Strict planning checker | exit 0 before this summary; after it, correctly reports ROADMAP Phase 50 row 3/15 versus canonical 4/15, for root's metadata reconciliation |
| Scoped tracked-file `git diff --check` | exit 0; pre-existing CRLF normalization warnings only |
| Scoped Graphify and Convex edge fixup | one-worker scoped rebuilds exited 0; final graph 12,810 nodes/22,383 edges/717 communities; 12/12 owned paths match manifest source mtime and nonempty AST hash; edge fixup exited 0 |

The scheduled-expiry test checks one pending durable scheduler row at the exact order deadline, the exact internal function name, foreign-tenant no-op, repeated timer landing, and single stock release. It invokes the internal landing directly under an advanced test clock; actual scheduler dispatch timing is not an external runtime acceptance claim.

## Deviations from Plan

- **[Rule 1 — bug]** A new retry key on an unchanged cart revision could create another order and hold. Added a tenant/cart/revision index and refusal, with a regression for same-key retry and different-key conflict.
- **[Rule 2 — missing critical]** Manual expiry alone could leave finite availability stale when a catalogue was idle. Added a transactional scheduled expiry and bounded on-demand repair, with timer/journal, idle release, backlog and idempotence tests.

No provider/account/secret infrastructure was added. The explicit table and index additions are the persistence called for by this plan.

## Shared-worktree and commit handoff

Exact pre-edit hashes and owned-hunk boundaries for overlapping files are in `50-04-PREEDIT-BASELINE-2026-09-24.md`. Existing unrelated staged, modified and untracked files were preserved. No task or metadata commit was made because root owns one batched acceptance review and roadmap/state/commit reconciliation.

## Next phase readiness

Plan 50-05 can add the host-derived anonymous entry to this server-bound cart/order core. The owner requires **both Stripe and PayPal in the first test-mode release, with each merchant owning direct provider accounts**; Plans 50-06 through 50-15 need revision around those choices. Current policy supports an explicit country list and one currency per project policy version; simultaneous multi-currency eligibility, provider country coverage, exact delegated account flows, real tax/shipping/refund authority and production selling remain open. `SHOP-03`, `SHOP-04` and `SHOP-05` are touched, not marked complete from Plan 04 local tests.

## Self-Check: PASSED

All four created source/test files, the summary and baseline note exist. Focused tests, typechecks, boundary, playbook, Graphify manifest and edge fixup passed. No commits exist for this plan by root's explicit shared-worktree instruction. ROADMAP/STATE/REQUIREMENTS and planning-corpus reconciliation remain root-owned metadata work.
