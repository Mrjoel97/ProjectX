# Phase 50 — provider-independent private policy editor

**Boundary:** This is preparatory operator work over the already-landed
`configurePolicy` / `getLatestPolicy` contract. It does not execute Plan 14,
whose exact product mapping, provider/account capability, readiness and
private preview still depend on Plan 13. Plan 06's accepted merchant/provider
decision, ADR-049, public checkout and Wave 7/8 gates remain open.

## Task shape and invariants

1. Mount the editor only for an authenticated `storefront` project inside the
   protected site editor. No anonymous route or client-controlled readiness
   switch is introduced.
2. Read the newest tenant/project-bound policy revision, show an empty state
   when none exists, and submit through the existing CAS mutation using that
   exact revision. A stale write refuses; it never silently overwrites a
   concurrent merchant change.
3. Require seller-of-record, quote currency and explicit buyer geography.
   Physical and digital branches are independently selected and require their
   own shipping/return or delivery/revocation facts, tax source/rate, refund
   source and buyer-retention reference. Digital zero shipping is an explicit
   acknowledgement. No tax rate, refund term, retention period or provider
   capability is supplied by Pikar-AI.
4. Keep the form's success copy bounded to a saved private policy version.
   It must not imply provider eligibility, verified legal compliance, public
   publication, payment, fulfilment or buyer notice.

## Local evidence

`tenantPolicyEditor.test.tsx` covers loading/empty copy, both physical and
digital branches, omitted facts, missing digital-zero-shipping acknowledgement,
duplicate countries, out-of-range tax basis points, the exact revision-zero
mutation payload, saved-version hydration and stale refusal. A separate
`siteEditor.test.tsx` control proves storefront-only mounting. The pre-existing
backend `tenantOrders.test.ts` readback control proves latest revision, empty,
non-storefront and foreign-tenant refusal. Web typecheck, commerce boundary,
strict playbooks and Phase 49 exact-source qualification are required before
repository/local acceptance.

**Observed local result:** Focused `tenantPolicyEditor`, `siteEditor` and
`tenantCatalogue` tests passed **16/16**; web typecheck, full CI-style lint,
commerce boundary, strict playbooks and planning passed. The watched
71-file Phase 49 digest `ae6d0ecf64c3d5d2d4aca7c0d6c54e8b9e329cf2fe7535b343914dbf7e1cc7c1`
passed **21/21** serialized repository/local planes with identical
initial/final identity, two fresh browser/audit stacks and production build.
Those browser stacks qualify the shared public-web runtime; they did **not**
exercise this policy form's complete merchant workflow in painted pixels.

## Remaining integration

Plan 14 must still combine exact presentation-product mapping, policy
completeness, two-provider global release status, per-merchant selected
provider/account eligibility and quote-versus-actual settlement currency in
the private editor/preview. Plans 13–17 and provider sandbox evidence must
prove the buyer path before any storefront sale can open. This editor's source
refs are merchant declarations, not a legal or provider determination.
