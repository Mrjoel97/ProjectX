# Playbook: Tenant merchant checkout and shop operations

> Last verified: 2026-10-24 against the isolated working tree. Focused local checks passed; no live payment qualification or provider execution is claimed. See ADR-065 and online-presence.md.

## Purpose and authority

Prepare a sourced shop operating package with the existing online-presence agent, then review the exact package once in Sites. The model proposes; native authenticated approval commits actual products, prices, stock, mappings, tax/shipping/refund policy and bounded automation. Provider connection and website publication remain separate reviews. A catalogue draft is not a working checkout receipt.

Stripe is the first sandbox release provider. PayPal is independently gated and optional. GBP never defaults the seller country to Britain; the actual provider-verified country/currency and supported capabilities decide admission. Read-only finance connectors and Pikar's subscription billing are separate authorities and credentials.

## Key files

- `contracts/src/tenantCommerce.ts` and `core/tenantCommerce.ts`, `tenantInventory.ts`, `tenantOrder.ts`, `tenantMerchant.ts`: closed catalogue, exact money, quote/stock/payment/refund/fulfilment state and merchant capability rules.
- `core/merchantSetup.ts`: source-backed operating proposal, issues, exact package binding and hash. `backend/convex/onlinePresenceShop.ts`: query review and native atomic approval/update; the ordinary specialist tools cannot call its approval mutation.
- `backend/convex/tenantCatalogue.ts`, `tenantOrders.ts`: owned products, stock, mappings, policies, quotes and durable payment state.
- `backend/convex/merchantCommerce.ts`: readiness, provider/account state, automation and private order summaries. `merchantProvider.ts` and `lib/merchantProviderClient.ts`: test-only onboarding, capability reads, checkout, reconciliation and verified provider events.
- `backend/convex/merchantHttp.ts` and `core/merchantBuyer.ts`: actual same-origin sandbox cart POST, provider selection, safe status/notice portal and bounded downloads. `http.ts` registers the routes; `webHttp.ts` adds separate code-owned checkout access only when readiness passes.
- `backend/convex/merchantOperations.ts`: payment-triggered digital access, native refunds, actual handoff records and bounded privacy expiry. `crons.ts` schedules fixed maintenance, not a general merchant routine engine.
- `dashboard/sites/MerchantWorkspace.tsx`, `ShopSetupReview.tsx`, `merchantPresentation.ts`, `merchant.module.css`: agent-prepared setup review, explicit provider data-sharing consent, readiness and order exceptions. `SiteEditor.tsx` mounts it for storefront projects.
- `core/tenantCommercePrivacy.ts`, `tenantData.ts`, backend `tenantExport.ts` and `tenantDelete.ts`: merchant classifications, summary-only credential handling, buyer retention and digital-copy deletion.

## Invariants

- Bind setup approval to the exact immutable catalogue version/hash, source/package identities and expected revisions. Revalidate at commit. Title-only rebind preserves product IDs and current stock; an old proposed quantity is not automatic restocking. A stale/native update race refuses.
- A new private presentation draft does not invalidate the still-published version by itself. Public readiness selects the published head; a separately approved material financial/mapping change can deliberately invalidate an older publication's checkout until the matching version is published.
- Provider connection is ready only after server readback, never a browser return or optimistic action result. Test-mode account, currency/country, policies, actual product mappings/stock and verified test-payment proof must all pass. There is no merchant checkbox override.
- Public carts use same-origin POST and a bounded same-site cart capability. Quantities, displayed revision and unit values are validated, but actual money and availability are recomputed by the server. No country, provider or positive quantity is silently selected.
- Provider events require the configured signature check and exact account/environment/order/amount/currency binding. Duplicate events are idempotent. Unknown writes retain their reservation and require reconciliation instead of a new payment/refund attempt.
- Digital access is issued only from the approved owned file after confirmed payment and within saved policy. Downloads recheck capability, lifecycle, expiry and refund/revocation state. No raw storage URL or arbitrary external download target is accepted.
- Physical `succeeded` means merchant handoff recorded with actual evidence; it does not mean carrier dispatch or buyer delivery. Buyer notices are prepared/portal-only, with no sent-email claim. Refund execution is a native authenticated action, outside model grants.
- Five-minute capability maintenance performs bounded read-only refresh of stale accounts; missing configuration and erased tenants skip egress. Hourly privacy maintenance removes expired buyer data and digital copies in bounded batches. Neither retries uncertain money writes.

## Verification and release

Use focused `merchantSetup`, `tenantMerchant`, `merchantBuyer`, catalogue/order/merchant HTTP/provider/operations and native setup tests, plus owner UI interactions. Check actual stock preservation, price/policy update races, cross-tenant refusal, amount/account binding, unknown retries, digital source changes, buyer privacy/export/erasure and exact version publication. Mocked provider events are not live financial evidence.

The current cut has no live provider onboarding/payment/refund evidence. The initial authenticated sandbox proof path must earn a real verified test payment before public checkout can become ready; a seeded readiness flag is not admissible evidence. Carrier integration, external customer notification delivery and production commerce remain open. Renderer v6 actual native browser review and fresh source-bound recipe qualification are also pending. Keep old website/model receipts unchanged.
