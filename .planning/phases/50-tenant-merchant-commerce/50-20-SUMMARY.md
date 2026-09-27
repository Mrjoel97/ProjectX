---
phase: 50-tenant-merchant-commerce
plan: 20
subsystem: tenant-commerce
tags: [inventory, merchant-policy, decision-gate, catalogue]
requires: [50-19]
provides:
  - owner-selected whole-minute 1–60-minute finite-stock hold guard across local catalogue, quote and authenticated form
  - exact merchant-admin late-paid/unavailable review choices in the pending decision packet and checker
affects: [tenant-commerce, future merchant adapters]
requirements-completed: []
requirements-addressed: [SHOP-02, SHOP-03, SHOP-04, SHOP-05]
completed: 2026-09-26
---

# Phase 50 Plan 20: Owner merchant-policy boundary

The first test-mode finite-stock hold is merchant-configured for exactly 1–60 whole minutes. Local catalogue activation/configuration, order quoting and the authenticated catalogue form refuse a longer hold. The internal 24-hour fallback for explicitly approved untracked stock is unchanged; it is not a finite merchant hold. Existing wider finite policies must be reconfigured before checkout.

The pending decision packet now records the owner's late-paid/unavailable choice: merchant review, with no automatic refund or fulfilment; a merchant admin chooses refund or a documented fulfilment alternative and the buyer gets a status notice. The checker requires exact sourced values and rejects changed range, authority, outcome or notice in synthetic negative controls. The real decision remains **pending**: no ADR-049, provider approval or operating-policy proof is inferred.

## Subsequent integrated order-clock correction — 2026-09-26

A broader current-tree regression found that local `placeOrder` used the cart's remaining 30-minute TTL as an upper bound on the newly merchant-configured stock hold. A cart placed at minute 29 turned a chosen 60-minute hold into one minute. The new backend test failed on that exact discrepancy before the source edit. Cart expiry now gates only pre-order admission; the placed order, reservation and scheduled expiry use the earliest actual stock hold measured from placement. A second backend test inserts a legacy active 24-hour finite policy, proves refusal before any order/attempt/reservation write, reconfigures it through stock CAS, then places successfully. The focused order adapter now passes **14/14** and backend TypeScript exits 0. This remains local test evidence, not provider checkout or public activation.

The post-correction integrated run passed **40/40 core**, **72/72 backend** across catalogue, orders, closed HTTP, export and erasure, and **7/7 web** catalogue tests. The commerce-boundary synthetic and real checks passed; the merchant-decision synthetic controls passed 34/34 while the actual entry remained `pending`/exit 1. Playbook, strict planning and diff checks exited 0. Full Graphify refresh and subsequent Convex-edge fixup exited 0; the final graph has 13,896 nodes, 24,494 links and zero ignored browser-profile manifest keys. Final SHA-256: `tenantOrders.ts` `cfc95c6e6648be8d3be089f74748e48d79e82b0f5b716ac7f82ba256dfe50c74`, `tenantOrders.test.ts` `a877f0c39c6db4008650826d49a49b2b211c798ca62666341932c3fb1e21d0ae`.

An additional mixed-cart regression now proves that a 1-minute physical hold and 60-minute digital hold yield one order deadline and both linked reservation deadlines at the earlier minute. The focused backend order suite passes **15/15**, and the broader backend catalogue/order/closed-HTTP/export/erasure matrix passes **73/73** with backend TypeScript exit 0. This is a test-only addition; `tenantOrders.test.ts` SHA-256 is now `786c8e6cbe56f4391498d5361496729dfaed3dada55997a5fd784bc40adf5f07`. A further Graphify refresh and Convex-edge fixup both exited 0. No new provider, refund or notification behavior is certified by this test.

## Subsequent reservation-link integrity correction — 2026-09-26

A current-tree backend test replaced a pending order's linked hold product with a different same-tenant stocked product while leaving the reservation count unchanged. Before the fix, `cancelOrder` incorrectly succeeded and released the wrong stock. The shared cancel/expiry close path now validates the full held-reservation set against the immutable order snapshot—distinct product identity and exact quantity—before any release or status write. Separate wrong-product cancellation and wrong-quantity expiry tests assert refusal and unchanged order, attempt, reservation and stock rows. The focused order suite passes **17/17**; catalogue/order/closed-HTTP/export/erasure tests pass **75/75**; backend TypeScript exits 0. This is local integrity proof only, not merchant-payment or refund activation.

Final SHA-256 for this correction: `tenantOrders.ts` `d4cee302e3e2afa2a96a343b77ca32251501dfe71bfd1ced9d5f3c5506b24de6`; `tenantOrders.test.ts` `858ee750be39b7f5c6b1b8229e23027d0e65484ae78eeba26f2d64795d54fbb4`. The commerce-boundary, strict planning, playbook and diff checks exited 0, as did full Graphify refresh and Convex-edge fixup. A whole-file Biome check still reports formatting and existing non-null-assertion findings in these previously unformatted files; no unrelated bulk formatting was applied.

The later Plan 06 decision-checker extension for PayPal buyer-SDK generation and seller binding passes **39/39** synthetic controls on 2026-09-26. The earlier 34-control count below is the Plan 20 verification checkpoint, not a current checker count. The real merchant entry remains pending and no provider approval is inferred.

## Subsequent payment-attempt link integrity correction — 2026-09-26

A current-tree test cross-linked one order's held reservation to another same-tenant order's payment attempt. Before the fix, cancellation succeeded and released stock. The shared cancel/expiry close path now requires exactly one attempt for the order with the same immutable snapshot hash, and every held reservation must link to that attempt before any write. The new test failed first on the incorrect success, then passed after the guard. The focused order suite passes **18/18**, the five-file backend commerce matrix **76/76**, backend TypeScript and tenant-commerce boundary real/synthetic checks exit 0. This remains a local fail-closed integrity result; provider payment reconciliation and merchant refund operations are not implemented.

Source SHA-256: `tenantOrders.ts` `c21e6e847a38762cf6930c088f4a25baff72b2ec7f876fd6e0d003c821517697`; `tenantOrders.test.ts` `f99c8382fb3f92977bb15ad7f67edd7a0a584865fd06277df5e597dbb5acd470`.
Fresh strict planning, playbook and `git diff --check` gates exited 0 (Git emitted unrelated CRLF warnings). Full Graphify update rebuilt the graph and exited 0; Convex-edge fixup exited 0 after it. The initial TypeScript invocation used an unavailable direct `pnpm exec tsc` path and was rerun with the package's `typecheck` script, which exited 0. Neither the failed invocation nor the graph's unresolved external references is a provider-qualification verdict.

## Subsequent hold-deadline integrity correction — 2026-09-26

A new test shortened a pending order's persisted deadline while leaving its held reservation at the merchant's original expiry. Before the fix, `expireOrder` marked the order expired and released stock early. The shared close path now requires every held reservation expiry to equal the order deadline before a stock or status write. Honest synthetic expiry fixtures now advance both persisted deadlines together; the mismatch test checks unchanged order, attempt, hold and stock rows. The focused order suite passes **19/19**, the five-file backend commerce matrix **77/77**, backend TypeScript and tenant-commerce boundary real/synthetic checks exit 0. No provider payment or public checkout behavior is inferred.

Source SHA-256: `tenantOrders.ts` `6b4cd639a1098bb22ea1764af2d0469d2b7a982d3ee82a7d04e56e7223a9b728`; `tenantOrders.test.ts` `63fbefd14f93f92c095f24821f3f8cb6f36beac5a3ef95307ed36180c451bd39`. Fresh graph and documentation-gate results follow this source change below; earlier source hashes and counts above are historical checkpoints.
Full Graphify refresh rebuilt the graph and exited 0; the subsequent Convex-edge fixup exited 0. Strict planning, playbook and `git diff --check` exited 0; Git emitted unrelated CRLF warnings. The graph's unresolved external references and zero-node JSON diagnostic are tooling warnings, not commerce qualification.

## Local verification

### 2026-09-27 attempt/cart/status integrity addendum

Three new backend tamper controls changed the pending attempt's cart ID, cart revision or status while leaving the order and hold otherwise linked. Each control first observed the incorrect cancellation and stock release (3 RED). The shared cancel/expiry close path now requires the single attempt to remain `local_pending` and to match the order's cart ID and revision, in addition to its existing snapshot and reservation checks. Each refusal leaves order, attempt, hold and stock rows unchanged. The focused order suite passes **22/22**; the five-file catalogue/order/closed-HTTP/export/erasure selection passes **80/80**. Backend TypeScript, tenant-commerce boundary and strict playbook checks exit 0. Full Graphify refresh exited 0 with 28,992 nodes and 38,212 edges; subsequent Convex-edge fixup exited 0. This is a local integrity repair only: no provider payment, refund, merchant resolution, buyer notice or public checkout is proven.

Source SHA-256: `tenantOrders.ts` `fd74ee142a53c2dd50ba4dd3dfab29e927979acbfb9abb1a2e10d8b946e347fb`; `tenantOrders.test.ts` `c81a115fabd72f9d663eea9db8bdb403d7736fa3b2339a6e978cd6f97ccac498`. The historical counts and hashes above remain their dated checkpoints.

### Original Plan 20 verification checkpoint

- Core inventory/order focused tests: **14/14 passed**.
- Backend catalogue/order adapter focused tests: **19/19 passed**.
- Authenticated catalogue DOM tests, including 61-minute no-mutation refusal: **7/7 passed**.
- Core, backend and web TypeScript checks: **passed**.
- Merchant decision checker synthetic self-test: **34 controls passed**; real packet: **exit 1 pending**, with absent accepted ADR and provider/operating evidence.
- Tenant-commerce boundary synthetic and real checks: **passed** (12 positive controls, 8 scanned sources).
- Playbook, strict planning and `git diff --check`: **exit 0**; Git printed only unrelated CRLF conversion warnings.

Graphify update **exited 0** after extracting 1,145 uncached files and rebuilding the graph; Convex-edge fixup **exited 0**, removing 15,075 noise nodes and adding 798 Convex plus 127 table edges across 76 tables. The Graphify warning about source files with zero nodes and the listed unresolved external/typing references are tooling diagnostics, not provider qualification. Strict planning initially identified the expected missing ROADMAP 8/20 update; the row was corrected before final verification.

The worktree already contained modified and untracked commerce paths; the pre-edit hashes/status are in `50-20-BASELINE.md`. The authenticated catalogue form and its test were added to the scope after the stale 1,440-minute UI limit was found. No commit or production deployment is claimed. Plan 50-06's accepted decision and both provider adapters remain gated; Wave 5 and Waves 7–8 remain open.
