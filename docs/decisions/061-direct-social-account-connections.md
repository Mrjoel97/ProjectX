# ADR-061: Direct social account connections

Date: 2026-10-20
Status: proposed implementation; live provider qualification pending.
Authority: owner request to connect existing Pikar developer apps for X, Meta, TikTok and YouTube directly, preserve concurrent beta work, and verify live OAuth/webhooks without publishing unapproved content.

Use separate tenant-bound OAuth records and independent callback/webhook paths alongside existing Buffer publishing and Zernio reporting. Reuse the credential envelope with explicit native-provider authenticated data. Bind one-use state and activation receipts to the initiating tenant, protect rotating refresh grants with revision leases, and preserve erasure/disconnect fences. Start with minimum identity/channel read scopes; connection success grants no publication or analytics capability by itself.

Meta login-product suitability, provider app review/scopes, business verification, quota/tier and signed webhook delivery are separate acceptance gates. Do not replace existing app callbacks or share another chat's mutable deployment. Webhook receivers authenticate delivery and record only app-level health; business-event processing, direct publishing, analytics and unattended subscription renewal require subsequent scoped work. Local disconnect/export/erasure are implemented; automated upstream revocation is not.

See [social connection playbook](../playbooks/social-connections.md) for configuration, verification and limits.
