# Phase 50: Tenant Merchant Commerce — owner context update

**Gathered:** 2026-09-24
**Status:** Owner's physical/digital and merchant-policy ownership choices added; provider eligibility and policy bounds remain open
**Source:** Owner replies in this conversation, recorded verbatim in `50-06-OWNER-INPUTS-2026-09-24.md`

<domain>
## Phase boundary

Keep Plans 50-01–05 provider-independent and preserve their historical local proof. Add an explicit provider-independent delta for the newly locked goods and policy scope before dependent readiness and buyer flows; replan unexecuted provider-dependent work without reopening public or production selling. Phase 50 still depends on Waves 7–8 for external enablement and exact-production founder acceptance.
</domain>

<decisions>
## Locked owner choices

- Both Stripe and PayPal must be available in the **first test-mode commerce release**. A single-provider launch does not satisfy this choice.
- Each merchant owns its own direct receiving accounts. Pikar-AI does not pool funds or substitute its own subscription-billing merchant account. Exact provider-supported delegated connection/onboarding paths remain to be verified.
- The desired seller-country reach is all countries, with USD, EUR and GBP settlement targeted. This is an aspiration, not proof of universal provider eligibility. The product must version a provider/account/country/currency capability matrix and visibly refuse unsupported or unverified combinations; buyer reach and seller onboarding are distinct.
- Both physical and digital goods belong in the first test-mode shop. Each merchant authors its own tax, shipping, refund and buyer-retention policies; Pikar-AI validates and enforces the recorded merchant policy version rather than inventing platform defaults. Physical shipment/returns and digital entitlement/delivery/revocation need distinct paths. Mixed carts need an explicit supported calculation or a visible refusal, never a flat shipping assumption.
- The provisional product name is `pikar-ai`; registered legal-entity details are pending and cannot be invented.

## Not yet decided or evidenced

- Provider sandbox/partner eligibility, approved account/onboarding flow, payment methods, fee and negative-balance liability, actual receiving/settlement currencies by merchant account and jurisdiction.
- Stock expiry/oversell policy, merchant-policy schema and allowable legal/provider/platform bounds, physical shipping/returns and digital delivery/revocation mechanics, notification and fulfilment approval/destination, buyer/order retention limits/erasure exceptions, test-mode activation policy, and exact external Wave 7 facts. Merchant ownership of policies is decided; the values and enforceable bounds are not.
- No provider credentials, applications, live charges or public production selling are authorized by the scope choices above.

## Implementation discretion

The planner may choose the safest plan split, serial file ownership and test architecture so both providers are independently implemented and jointly qualified, without assuming missing business facts. Preserve completed Plans 01–05 and add a new provider-independent goods/policy delta with its own proof rather than silently rewriting their summaries.
</decisions>

<specifics>
## Evidence and guardrails

- Read `50-06-PROVIDER-PREFLIGHT-2026-09-24.md` for official-source caveats, then revalidate official provider documents at implementation time.
- Test both providers across two tenant-owned accounts, exact-account callbacks, retry/reconciliation/refund, per-provider refusal, and provider-specific disable/rollback. A green Stripe path must not stand in for PayPal or vice versa.
- Keep provider events, keys, account references, money and ledger separate from Pikar subscription billing and from Phase 28 read-only connectors; no raw card data.
</specifics>

<deferred>
## Deferred facts

Wave 7 external merchant/legal/domain enablement and Wave 8 exact-production founder acceptance remain separate and open. Unknown eligibility or operating policy blocks the dependent test-mode adapter or capability, not the provider-independent local core.
</deferred>

---

*Phase: 50-tenant-merchant-commerce*
*Context gathered: 2026-09-24 from owner replies*
