# ADR-065: Stripe-first sandbox shops require exact native setup approval

Date: 2026-10-24
Status: accepted for isolated implementation under the user's request to finish checkout and shop operations. Provider qualification and release remain separate, unearned gates.

## Context

ADR-062 recovered immutable website presentation; ADR-064 added a separate private shop-preparation document pack. Neither establishes merchant payment authority. The user now requests an agent-prepared shop with working checkout and bounded operations, initially Stripe, with PayPal later. GBP is the requested currency; Tanzania is the supplied location. Currency never implies seller country or provider eligibility.

## Decision

Keep three authorities separate: the website/catalogue presentation, a tenant-owned operating package, and a verified merchant provider account. The specialist may prepare sourced catalogue, prices, stock, policies and automation as a proposal through its existing narrow tools. It gains no payment, refund, shipment, approval or publication tool.

Approve an operating package only through the authenticated tenant UI/API, bound to the exact project, immutable version/content hash, source identities, package hash and current revisions. Create or update products, mappings, policy and automation atomically. A presentation-only revision can rebind the same products while preserving actual stock after sales; it must not restore the proposal's original quantity. Explicit stock changes are visible in the review. Website publication and provider data-sharing consent remain separate actions. Test-operator clicks are not human production approval.

Implement test-mode merchant-direct checkout with Stripe as the release provider. PayPal remains independently gated and optional for this cut. Pikar subscription billing and read-only invoice connectors supply no merchant authority. Hosted onboarding and server-read account capabilities determine the actual seller account, country and supported currency. Missing configuration, expired/unknown capability, unsupported policy, absent exact mappings or missing verified test-payment proof refuse public checkout.

The buyer explicitly chooses quantities, country and provider. The server recomputes the mapped prices, currency, tax, shipping and stock reservation; browser totals are not authority. Signed webhook admission and a provider readback must bind the exact merchant account, environment, order, amount and currency. Unknown payment/refund outcomes remain held for reconciliation, never a fresh automatic money retry. Buyer status/download access uses bounded opaque capabilities without publishing buyer identity.

Verified payment can issue the exact approved digital file's bounded access inside the product under the reviewed operating policy. This fixed payment handler is not a general standing routine send permission under ADR-046. Refunds require native authenticated authorization; physical shipment records require actual merchant handoff evidence. No carrier dispatch or external customer email sender is implemented. Notices are prepared records and buyer-portal presentation only.

Fixed maintenance refreshes stale capabilities through bounded provider reads and performs bounded buyer-data/digital-access expiry cleanup. It does not create onboarding, charges, refunds or shipment retries. Lifecycle deletion excludes erased tenants and removes merchant-owned data and digital copies through the existing privacy registry; audit remains refs, hashes, counts and closed states.

## Consequences and evidence limits

Private shop drafts and the three illustrative examples are useful without pretending checkout is ready. Exact native setup approval, verified merchant readiness and exact website publication cannot replace one another. Existing immutable site artifacts remain unchanged; dynamic checkout controls are a separate server-owned capability shown only after readiness passes.

Focused pure, native database and UI tests establish local behavior, not live payment qualification. No provider onboarding, sandbox charge, refund, carrier action or customer send was executed for this implementation cut. Renderer/compiler v6 changes retire prior source-bound recipe evidence; current native three-width visual verification and fresh recipe qualification remain pending. Historical v3 website lifecycle observations and older failed model receipts retain their original scope and verdicts.
