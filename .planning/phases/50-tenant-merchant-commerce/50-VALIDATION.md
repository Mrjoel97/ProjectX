---
phase: 50
slug: tenant-merchant-commerce
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-24
---

# Phase 50 — Validation Strategy

This is a pre-implementation validation contract, not passing commerce evidence. The named new tests and any provider adapter remain unimplemented until their plans execute. Test-mode and local fake-provider results cannot satisfy Wave 7 merchant enablement or Wave 8 production acceptance.

## Test Infrastructure

| Property | Value |
| --- | --- |
| Framework | Existing Vitest for pure core and Convex adapters; existing Playwright disposable-stack pattern for browser acceptance |
| Config files | `packages/core/vitest.config.ts`, `packages/backend/vitest.config.mts`, `apps/web/vitest.config.mts`, `apps/web/playwright.config.ts` |
| Quick run | Focused `pnpm --filter @pikar/core test -- <new-commerce-test>` or `pnpm --filter @pikar/backend test -- <new-commerce-test>` after each task |
| Full technical run | Exact declared commerce test files, two-tenant disposable browser matrix, core/backend/web typechecks, production web build, free gates, strict playbook/planning and claim checks |
| Feedback target | Focused tests after every task; full affected-package tests at each wave boundary; no watch mode |

## Sampling Rate

- After every task: run its exact focused automated test, or an explicit file-existence and negative-control check before the implementation exists.
- After every plan wave: run all existing Phase 50 tests and affected package typechecks, with exact file counts and non-vacuous outcomes.
- Before technical verification: run a serialized exact-source aggregate with two tenants, an anonymous buyer, a fresh local browser stack, full refusal/recovery lifecycle and cleanup proof.
- Before any Wave 7/8 claim: obtain separate provider/legal and exact-production evidence; local tests are insufficient.

## Per-Task Verification Map

Plan IDs and exact paths are provisional until checked plans are written; the planner must replace them with each task's `<automated>` command and prevent three consecutive tasks without one.

| Proposed plan | Requirement | Test type and mandatory outcome | Automated command (to be finalized in plan) | Exists now | Status |
| --- | --- | --- | --- | --- | --- |
| 50-01 contract and boundary | SHOP-02..05 | Closed merchant types, billing/connector import and secret separation, refusal on unknown provider/account | Focused core contract tests plus static boundary guard | No | Pending |
| 50-02 catalogue/inventory | SHOP-02 | Positive stock/price edit, CAS race, reservation expiry, no oversell, foreign-tenant refusal, export/erasure classification | Focused core, backend and tenant-data tests | No | Pending |
| 50-03 cart/quote/order | SHOP-03 | Server quote ignores client totals; stale price/stock refusal; one order/attempt across retries; host-derived tenant | Focused pure and backend/HTTP tests | No | Pending |
| 50-04 selected sandbox adapter | SHOP-03 | Hosted redirect only; raw-body signature, wrong account, forged/missing config, no Pikar-billing key reuse | Selected adapter contract tests; external sandbox probe only under its own gate | No | Pending |
| 50-05 reconciliation/outbound | SHOP-04 | Duplicate/out-of-order/late callbacks, refund/cancellation, one notification and fulfilment effect, approval/audit/cost | Reducer and Convex workflow tests with mutation controls | No | Pending |
| 50-06 public integration | SHOP-05 | Exact approved version/readiness, tax/shipping refusal, publish/unpublish/rollback, accessibility/SEO/analytics | Backend/web tests and fresh desktop/mobile browser matrix | No | Pending |
| 50-07 integrated gate | SHOP-02..05 | All declared files/counts, exact digest, cleanup, Wave 7/8 re-entry packet and conservative claims | One serialized aggregate and strict planning/playbook/free gates | No | Pending |

## Wave 0 Requirements

- [ ] Confirm existing package scripts and exact Phase 50 test-file selections before recording executable commands.
- [ ] Establish focused test files for the pure commerce contract, inventory, order/payment reducer, tenant adapters, and public storefront/HTTP boundaries before each corresponding implementation.
- [ ] Add positive controls for a real stock decrement, signed paid event, provider refusal, duplicate event, foreign tenant/account, stale approved hash, late payment after reservation expiry and partial refund.
- [ ] Require negative mutation controls for independent signature, account, order, reservation, dedupe, approval and publication guards.
- [ ] Pin the final integrated browser and aggregate test-file lists/counts; a listing or skipped test is not a pass.

## Manual-Only Verifications

| Behavior | Requirement | Why manual | Instructions |
| --- | --- | --- | --- |
| Tenant operator understands stock, pending payment, refusal, refund and fulfilment states on desktop/mobile | SHOP-02..05 | Founder usability judgment is not inferred from automation | Review the exact local candidate after automated gates; record observed wording/verdicts and revision. |
| Merchant, PCI, tax/shipping, privacy and production-domain readiness | SHOP-03, SHOP-05 | External legal/provider facts are not repo facts | Wave 7 owner/provider evidence packet; never mark from a fake adapter or sandbox alone. |
| Exact-production buyer-to-fulfilment acceptance | SHOP-02..05 | Requires one enabled production revision/account/configuration | Wave 8 two-tenant and anonymous buyer UAT with durable receipts and founder verdict. |

## Validation Sign-Off

- [ ] Every implementation task has a focused `<automated>` check or an explicit Wave 0 test dependency.
- [ ] No three consecutive implementation tasks lack automated feedback.
- [ ] Missing test files and commands are created and executed before their feature is accepted.
- [ ] No watch-mode flags or vacuous `--list` results count as proof.
- [ ] `nyquist_compliant: true` only after plans and tests satisfy this map.

**Approval:** pending plan-checker review and implementation.
