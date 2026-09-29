---
phase: 50-tenant-merchant-commerce
plan: 18
subsystem: tenant-commerce-goods-policy
tags: [commerce, physical-goods, digital-goods, merchant-policy, inventory, convex]
requires:
  - phase: 50-tenant-merchant-commerce
    provides: Plans 02–05 private catalogue, stock, authenticated operator and local order intent
provides:
  - server-owned physical/digital goods kind with legacy unclassified refusal
  - versioned merchant policy branches for physical shipping/returns and digital delivery/revocation, each with tax/refund/retention refs
  - deterministic physical, digital and mixed local quotes with immutable branch and line facts
affects: [50-19, 50-06, 50-07, 50-08, 50-15, 50-16]
tech-stack:
  added: []
  patterns: [kind-specific pure quote, authenticated policy CAS, optional legacy schema fields with fail-closed conversion]
key-files:
  created: []
  modified:
    - packages/core/src/tenantInventory.ts
    - packages/core/src/tenantInventory.test.ts
    - packages/core/src/tenantOrder.ts
    - packages/core/src/tenantOrder.test.ts
    - packages/backend/convex/schema.ts
    - packages/backend/convex/tenantCatalogue.ts
    - packages/backend/convex/tenantCatalogue.test.ts
    - packages/backend/convex/tenantOrders.ts
    - packages/backend/convex/tenantOrders.test.ts
    - docs/playbooks/tenant-commerce.md
    - docs/playbooks/skill-registry.md
key-decisions:
  - "A local cart needs only the merchant-policy branches for the goods it contains; a mixed cart needs both."
  - "Tax is rounded half-up per goods kind, while physical shipping is charged once and digital no-shipping is explicit."
  - "Existing unclassified products and branchless policies remain schema-readable but cannot quote; a merchant classifies products by revisioned edit."
requirements-touched: [SHOP-02, SHOP-03, SHOP-04, SHOP-05]
requirements-completed: []
duration: approximately 65 minutes
completed: 2026-09-24
---

# Phase 50 Plan 18: Physical and digital goods policy summary

The private local order contract now quotes physical, digital and mixed carts from server-owned goods kinds and exact merchant-authored policy branches, pinning every used kind and policy fact into an immutable snapshot.

## Performance and scope

- Tasks: 2/2 implemented and locally verified.
- Plan-owned source, test and playbook files: 11.
- No provider call, public checkout, buyer fulfilment dispatch, live selling, accepted ADR-049 or legal/tax determination occurred.
- Plan 19 still owns export/delete classification for the new goods and policy fields before a dependent adapter can proceed.

## What changed

1. The pure catalogue requires `physical` or `digital` when creating a product. A legacy row without kind remains representable but refuses quote; an authenticated operator can supply kind through a product-revision CAS edit. The private list returns an explicit `null` for unclassified rows.
2. The pure quote requires policy identity to match the tenant and project, an explicit half-up rounding rule, and complete physical or digital branches for the kinds in the cart. Physical policy pins shipping, returns, tax, refund and buyer-retention refs. Digital policy pins delivery, revocation, explicit no-shipping, tax, refund and buyer-retention refs. Tax is computed separately per kind using checked integer arithmetic. Physical shipping is added once when a physical line exists. A digital-only cart has zero shipping only with an explicit digital no-shipping fact.
3. The Convex adapter accepts only authenticated tenant product and policy writes, persists each policy revision and the full immutable quote/hash with the existing order, attempt and stock holds in one transaction, and preserves same-key retry behavior. Optional schema fields allow old rows to remain readable without inferring missing kind or policy facts.

## Verification

| Check | Result |
| --- | --- |
| Core inventory/order focused tests | 12/12, exit 0 |
| Backend catalogue/order focused tests | 18/18, exit 0 |
| Core, backend and web typechecks | each exit 0 |
| Tenant commerce boundary self-test | exit 0; 12 positive controls, 8 sources scanned |
| Tenant commerce boundary normal scan | exit 0; 8 sources scanned |
| Strict playbook check | exit 0; `{"status":"passed"}` |
| Strict planning check after this summary/Phase 50 metadata update | exit 0 |
| Scoped tracked-file `git diff --check` | exit 0; pre-existing CRLF normalization warning only |
| Full Graphify refresh | exit 0; extraction of 3,179 files, 65,697 nodes, 163,534 edges, 2,932 communities before fixup; graph HTML skipped for size |
| Convex graph edge fixup | exit 0; 798 Convex edges and 126 table edges added, 52,136 noise nodes removed |
| Graph manifest source freshness | 9/9 Plan 18 source/test/schema paths present with nonempty AST hashes and exact filesystem mtimes |

The Graphify extractor warned that 457 files outside the Plan 18 set produced zero nodes; all nine Plan 18 source/test/schema paths have nonempty AST hashes. Graph generation and edge fixup are source-navigation evidence, not runtime or provider acceptance.

Tests cover physical, digital and mixed arithmetic; both policy branches and named missing facts; explicit digital zero shipping and physical shipping once; stale product/policy revisions; foreign tenant/project policy; legacy product/policy rows; forged kind labels; unsupported country/currency; overflow; stock holds; retries; immutable snapshots and zero provider calls.

## Deviations and limitations

No architectural deviation or new provider capability was added. The initial broad Graphify refresh spent approximately 45 minutes in extraction/clustering post-processing but completed successfully; no fallback or duplicate run was used.

The plan requested TDD task commits. The eight source/test modules were already untracked before this plan and the shared worktree contains unrelated edits (see `50-18-PREEDIT-BASELINE-2026-09-24.md`). Tests were added during implementation and verified, but separate RED/GREEN commits were not made. The code and metadata remain in the shared worktree for root's scoped Git integration; no unrelated file was staged or reverted. This is a commit-process limitation, not a claim of atomic commit proof.

## Next work

Plan 19 must classify these new fields for export/deletion and repeat its gates. Plan 06's preparatory provider packet is still a pending decision, not an accepted ADR; provider adapters, anonymous checkout and public selling remain closed.

## Self-Check: PASSED for local worktree evidence

All eleven plan-owned files and this summary exist. Focused tests, typechecks, boundary, strict playbook/planning checks, Graphify refresh, edge fixup and exact manifest freshness passed. Atomic task and metadata commits remain pending shared-worktree integration and are not claimed.

## 2026-09-27 policy-reference integrity addendum

The pure quote and authenticated policy-write guards previously accepted whitespace-only seller and branch references, allowing a policy that looked filled to be revisioned and quoted. New seller, physical-retention/refund and digital-delivery controls failed first on the old validators. Both guards now require at least one non-whitespace character while preserving accepted reference bytes unchanged; old blank-looking rows refuse at quote time. Focused core inventory/order tests pass **14/14** and the five-file backend catalogue/order/closed-HTTP/export/erasure selection passes **80/80**. Core/backend TypeScript and tenant-commerce boundary checks exit 0. Full Graphify refresh and Convex-edge fixup exited 0. These are local validation facts, not a legal/provider determination, public checkout or accepted ADR-049.

SHA-256: `tenantOrder.ts` `0e267f8834f7e9cf80744e6b326cdbf26cac25b0b42b0bdf451f3fe7660ba1a9`; `tenantOrder.test.ts` `608579423dd1eacf456b660546a9b1d2b795c60d6a4d74b6bde5c982842976da`; `tenantOrders.ts` `fb2e4d6b4c95c3cf87af86964bda940de40f63c05bbf69cb0f6ce6dbf5fd4952`; `tenantOrders.test.ts` `d5c863e93755edfb247a0478fd85f7438c3f1d545e2183fd3fafedb35108ed99`.

## 2026-09-29 private policy-readback continuation

The existing authenticated `configurePolicy` mutation could write a versioned
physical/digital shop policy, but no merchant-facing query could read its
latest revision back. A fail-first Convex test now covers the new
`getLatestPolicy` query: it returns the newest version after CAS, `null` for
an unconfigured storefront, and refuses both non-storefront and foreign
projects while keeping another tenant's revision separate. The full local
order-adapter suite passes **31/31** and backend typecheck exits 0. This is
only an authenticated data seam for later private policy controls. It does
not complete Plan 14's editor/readiness UI, accept ADR-049, contact Stripe or
PayPal, enable checkout, or satisfy Wave 7/8 evidence.
