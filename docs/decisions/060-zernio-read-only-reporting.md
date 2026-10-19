# ADR-060: Tenant-owned Zernio reporting

Date: 2026-10-19
Status: accepted
Authority: owner request to finish the production Zernio reporting connector.

## Context

Buffer's registered third-party app grant cannot read engagement insights. The read-only Zernio pilot returned real Instagram and TikTok metrics, including an exact native post also shown in Buffer. That comparison did not establish Buffer as the publisher. Production reports must not imply that provenance or substitute missing metrics with zeros.

## Decision

Offer an optional customer-owned Zernio profile connection beside Buffer publishing. Customers create a profile-scoped read-only Accounts/Analytics key in their own Zernio account. Pikar does not provision accounts, purchase plans, request publishing access, or reuse the operator's personal credentials for other tenants. The initial supported surface is Instagram/TikTok, two selected accounts and up to 500 posts per account over ninety inclusive UTC publication dates. Broader onboarding, centrally managed profiles and other platforms require separate work.

An authenticated mutation binds tenant/profile/generation to a ten-minute one-use capability. A same-origin, bounded HTTP POST receives the key. Only its AES-GCM envelope crosses into Convex function arguments; authenticated data binds provider=zernio, tenant and server-minted connection ID. Server-side fixed-origin GETs verify the key and profile/account membership. Read-only behavior is enforced by the transport; the verify endpoint does not attest all API-key permission settings, so the UI explicitly requests least-privilege keys.

Account selection and optional daily refresh are explicit. Generation/revision leases fence disconnected/replaced connections and changed selections; refreshes are bounded and throttled. The last complete snapshot survives read failures and is labeled as older data. Empty publication windows, missing metrics and errors are distinct. Metrics are per-post lifetime snapshots, not period activity. Reach and engagement rates are not aggregated. External means published outside Zernio, not necessarily through Buffer. Retrieval time is distinct from upstream update timestamps, which retain the supplied timezone semantics.

The executive agent reads the cached report only, through the existing lineage-bound executive tool grant. It cannot connect, select accounts, change consent, trigger provider reads, or publish through this tool. Zernio tools remain absent from evaluator contexts.

Connections are tenant credentials and export as summaries; the latest cached report is tenant-owned export/erasure data. Local disconnect removes both. Tenant deletion reports local removal with upstream revocation unsupported: customers revoke the key in Zernio. No raw key, provider error body, post content or media enters application logs, audit or agent evidence.

## Verification and limits

Offline tests cover HTTP intake, one-use and cancellation fences, tenant/profile/account isolation, encryption, empty/missing/zero metrics, cached failure retention, throttling, daily opt-in scheduling and privacy classification. Production rollout and customer account activation are separate live checks. The revoked pilot key must never be restored or reused. Buffer-published provenance, all-platform metric coverage and centrally managed multi-customer Zernio billing remain unqualified.

References: [Zernio multi-tenant model](https://docs.zernio.com/multi-tenant), [analytics API](https://docs.zernio.com/analytics/get-analytics), [key verification](https://docs.zernio.com/api-keys/verify-credential).
