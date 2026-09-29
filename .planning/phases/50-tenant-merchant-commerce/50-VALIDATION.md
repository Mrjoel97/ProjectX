---
phase: 50
slug: tenant-merchant-commerce
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-24
---

# Phase 50 — Validation Strategy

This is a planning validation contract, not passing commerce-release evidence. Plans 01–05 and 18–20 have separate repository/local summaries; Plan 06 has a prepared decision packet but no accepted ADR, and Plans 07–17 remain subject to their own execution/evidence. The owner's first test-mode release requires BOTH independently qualified Stripe and PayPal integrations, each merchant's own direct receiving account, and per-provider/account/country/currency refusal for unsupported or unverified combinations. A merchant need not connect both providers. Test-mode fixtures cannot satisfy Wave 7 merchant enablement or Wave 8 production acceptance.

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
- Before technical verification: run a serialized exact-source aggregate with two tenants, an anonymous buyer, fresh local browser stack, independent Stripe and PayPal positive/refusal/recovery lifecycles, cross-provider negative controls and cleanup proof.
- Before any Wave 7/8 claim: obtain separate provider/legal and exact-production evidence; local tests are insufficient.

## Per-Task Verification Map

Plan IDs and planned commands below map the revised 20-plan sequence. Plan 18 is the goods/policy delta in Wave 6; Plan 19 follows in Wave 7 to classify export, erasure and retention. Plan 20 implements the owner-selected finite hold and review boundary locally. The already-started Plan 06 decision packet is serialized after Plan 20 for its remaining acceptance and playbook work before either provider adapter. The implementation runner must replace any provisional test count with exact existing test files and non-vacuous counts before marking this strategy compliant; no pending row is a pass.

| Proposed plan | Requirement | Test type and mandatory outcome | Automated command (to be finalized in plan) | Exists now | Status |
| --- | --- | --- | --- | --- | --- |
| 50-01 contract/boundary | SHOP-02..05 | Closed merchant types and billing/connector separation | `pnpm --filter @pikar/core test -- src/tenantCommerce.test.ts` plus boundary self-test | See `50-01-SUMMARY.md` | Separate local summary |
| 50-02 catalogue/inventory | SHOP-02, SHOP-05 | Stock CAS, no oversell, tenant-data classification | Focused core/backend/export/delete tests in Plan 02 | See `50-02-SUMMARY.md` | Separate local summary |
| 50-03 isolation/operator UI | SHOP-02 | Two-tenant foreign-id refusal and accessible catalogue controls | Focused isolation and web component tests in Plan 03 | See `50-03-SUMMARY.md` | Separate local summary |
| 50-04 quote/order | SHOP-03..05 | Server quote, one order/attempt per cart revision, expiry/stock repair | Focused core/backend/data tests in Plan 04 | See `50-04-SUMMARY.md` | Separate local summary |
| 50-05 closed host preflight | SHOP-03, SHOP-05 | A/B ordinary-site host binding, storefront `invalid_host`/zero writes; no fake published pointer | `pnpm --filter @pikar/backend test -- convex/tenantCommerceHttp.test.ts convex/isolation.test.ts` | See `50-05-SUMMARY.md` | Separate local summary |
| 50-06 decision packet | SHOP-02..05 | Dual-provider/direct-account owner scope, per-provider eligibility, pending factual gates; synthetic checker negatives and real pending refusal | `node scripts/check-phase50-merchant-decision.mjs --self-test` then real checker | No accepted ADR yet | Pending |
| 50-18 goods/policy delta | SHOP-02..05 | Physical, digital and mixed-cart merchant-policy quote/order branches; legacy/missing-policy refusal and two-tenant isolation | Core `tenantInventory.test.ts` + `tenantOrder.test.ts`; backend `tenantCatalogue.test.ts` + `tenantOrders.test.ts`; boundary guard and typechecks | `50-18-SUMMARY.md`; 30/30 focused tests freshly green 2026-09-25 | Repository/local only; provider/public gates open |
| 50-19 export/erasure classification | SHOP-02..05 | Classify every Plan 18 field; buyer redaction, two-tenant export, bounded deletion and explicit unresolved-retention refusal | Core `tenantData.test.ts`; backend `tenantExport.test.ts` + `tenantDelete.test.ts`; combined Plan 18/19 guard, typechecks and strict playbooks | `50-19-SUMMARY.md`; 68/68 focused tests freshly green 2026-09-25 | Repository/local only; legal retention gate open |
| 50-20 finite hold and late-paid review boundary | SHOP-02..05 | Merchant-configured 1–60 whole-minute finite hold; expired hold releases; late paid/unavailable stops for merchant-admin review without automatic refund/fulfilment; no runtime notice claim | Core `tenantCommerce.test.ts`, `tenantInventory.test.ts`, `tenantOrder.test.ts`; backend `tenantCatalogue.test.ts`, `tenantOrders.test.ts`, `tenantCommerceHttp.test.ts`; decision checker | `50-20-SUMMARY.md`; six-file current-tree subset 65/65 on 2026-09-29 | Repository/local only; review resolution, buyer notice and provider gates open |
| 50-07 Stripe adapter | SHOP-03, SHOP-04 | Delegated merchant-owned hosted/signature/fetch/refund, two-account/country/currency refusal and credential/retention lifecycle | Backend merchantStripe/tenantMerchant/tenantExport/tenantDelete tests | No | Pending |
| 50-08 PayPal adapter | SHOP-03, SHOP-04 | Independent PayPal contract, two-account/country/currency refusal and credential/retention lifecycle | Backend merchantPayPal/tenantMerchant/tenantExport/tenantDelete tests | No | Pending |
| 50-09 dual routing/callback | SHOP-03, SHOP-04 | Explicit per-order provider/account, two distinct signed callbacks, no cross-provider fallback or anonymous public write | Backend tenantOrders/tenantMerchant/tenantCommerceHttp tests | No | Pending |
| 50-10 both-provider payment/outbound | SHOP-02, SHOP-04 | Each provider's signed/fetched convergence, stock/refund/notices/fulfilment; wrong-provider refusal and export/delete retention | Core tenantPayment plus backend tenantPayments/tenantExport/tenantDelete tests | No | Pending |
| 50-11 candidate readiness | SHOP-02, SHOP-03, SHOP-05 | Global both-adapter release proof versus per-merchant eligible selected account; USD/EUR/GBP quote policy versus actual settlement; all public doors closed | Core readiness and backend webProjects/webRecipes/webRuntime tests | No | Pending |
| 50-12 HTTP darkness | SHOP-03, SHOP-05 | Candidate-true direct GET/POST/status still refuse with zero anonymous writes | Backend webRuntimeHttp/tenantCommerceHttp tests | No | Pending |
| 50-13 buyer handlers | SHOP-02..05 | Rendered offer and private dual-provider handler contract, no published-pointer bypass or public write | Core renderer and backend tenantCommerceHttp/tenantOrders tests | No | Pending |
| 50-14 operator mapping UI | SHOP-02, SHOP-03, SHOP-05 | Exact mapping, provider eligibility/currency refusal, keyboard/mobile and honest preview | Web siteEditor/previewCanvas tests | No | Pending |
| 50-15 pure buyer-flow capability | SHOP-02..05 | Versioned BOTH-provider plus actual evidence conjunction and per-merchant eligible selected account, no public opening | Core storefrontReadiness tests and backend darkness regressions | No | Pending |
| 50-16 guarded opening | SHOP-02..05 | First genuine approved host→anonymous order→Stripe/PayPal hosted/status paths; both-provider actual evidence and owner activation gate | Backend webRecipes/webProjects/webRuntime/webRuntimeHttp tests and negative guard mutations | No | Pending |
| 50-17 exact qualification | SHOP-02..05 | Separate provider browser journeys, cross-provider negatives, exact counts/digest/cleanup and Wave 7/8 open packets | `node scripts/check-phase50-qualification.mjs --self-test` and serialized aggregate | No | Pending |

## Wave 0 Requirements

**2026-09-25 focused revalidation:** The existing Plan 18/19 files ran together as 33/33 core
and 65/65 backend tests (98/98, seven files; both commands exited 0). The subset counts above
are 30 for Plan 18 (6 + 6 core; 6 + 12 backend) and 68 for Plan 19's classification files
(21 core + 8 + 39 backend). These two disjoint file sets total the 98-test combined run.
Prior summaries record their typechecks, boundary and playbook gates. This fresh run proves only
the named repository/local behavior, not a payment reducer, provider signature, public checkout,
merchant eligibility, legal retention or end-to-end release qualification. The remaining Wave 0
checkboxes cover future Plans 06–17 and stay open.
The Plan 06 decision checker also passed all 18 synthetic controls on 2026-09-25; its real packet
returned `status:"pending"` and exit 1 because the accepted ADR and provider/account/policy
evidence are absent. This is the expected adapter-entry refusal, not a Plan 06 completion.
The later 2026-09-25 structural owner-choice addendum raises the checker to 29 rejecting controls
plus its synthetic positive fixture; the real packet still exits 1 for missing final stock-hold
range, review operations and provider/legal evidence. See `50-06-CHECKPOINT-2026-09-24.md`.

**2026-09-29 current-tree correction:** The preceding 2026-09-25 missing-range sentence is
historical. The owner subsequently selected a 1–60-whole-minute merchant hold and
merchant-admin refund-or-documented-alternative resolution with buyer status notice.
Plan 20 records local enforcement, not the resolution/notice runtime. The current
three core files passed 22/22 and the three backend files passed 43/43 (65/65);
the backend closed-HTTP cases still prove zero anonymous commerce writes. This
subset is not the full Plan 20 82-test matrix and does not qualify either
provider, public checkout, refund or buyer notice. The real Plan 06 decision
remains pending for external/provider/legal and operating-policy facts.

- [ ] Confirm existing package scripts and exact Phase 50 test-file selections before recording executable commands.
- [ ] Establish focused test files for the pure commerce contract, inventory, order/payment reducer, tenant adapters, and public storefront/HTTP boundaries before each corresponding implementation.
- [ ] Add positive controls for a real stock decrement and, separately for Stripe and PayPal, signed paid event, provider refusal, duplicate event, foreign tenant/account, stale approved hash, late payment after reservation expiry and partial refund.
- [ ] Require negative mutation controls for independent Stripe and PayPal signature, provider/account, order, reservation, dedupe, approval and publication guards; remove either integration and require the global test-mode release gate to fail.
- [ ] Pin the final integrated browser and aggregate test-file lists/counts; a listing or skipped test is not a pass.

## Manual-Only Verifications

| Behavior | Requirement | Why manual | Instructions |
| --- | --- | --- | --- |
| Tenant operator understands stock, pending payment, refusal, refund and fulfilment states on desktop/mobile | SHOP-02..05 | Founder usability judgment is not inferred from automation | Review the exact local candidate after automated gates; record observed wording/verdicts and revision. |
| Stripe and PayPal merchant/delegated eligibility, PCI, tax/shipping, privacy and production-domain readiness | SHOP-03, SHOP-05 | External legal/provider facts are not repo facts; all-country seller and USD/EUR/GBP settlement are targets, not established capabilities | Wave 7 owner/provider evidence packets for each provider/account/country/currency; never mark from fake adapters or sandbox alone. |
| Exact-production buyer-to-fulfilment acceptance | SHOP-02..05 | Requires one enabled production revision/account/configuration | Wave 8 two-tenant and anonymous buyer UAT with durable receipts and founder verdict. |

## Validation Sign-Off

- [ ] Every implementation task has a focused `<automated>` check or an explicit Wave 0 test dependency.
- [ ] No three consecutive implementation tasks lack automated feedback.
- [ ] Missing test files and commands are created and executed before their feature is accepted.
- [ ] No watch-mode flags or vacuous `--list` results count as proof.
- [ ] `nyquist_compliant: true` only after plans and tests satisfy this map.

**Approval:** the earlier independent pass covered Plans 06–17 before the goods/policy scope addition. The revised 19-plan sequence passed independent plan checking on 2026-09-24 after the playbook-ownership and distinct goods-path acceptance corrections; Plan 20 was added later. That historical review does not certify the later 20-plan sequence, and implementation and final Nyquist qualification remain pending.
