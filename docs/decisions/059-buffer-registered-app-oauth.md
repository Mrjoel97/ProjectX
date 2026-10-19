# ADR-059 — Registered Buffer app OAuth for hosted Pikar

- **Status:** Accepted under the owner's explicit request to repair and deploy the production connection.
- **Date:** 2026-10-19
- **Supersedes:** ADR-058's hosted dynamic-registration/MCP transport and engagement-report direction. Its tenant isolation, credential lifecycle and human publishing approval remain binding.

## Evidence

Production dynamic registration returned `invalid_client_metadata` for the Convex HTTPS callback and for Pikar's own HTTPS callback. The same read-only metadata accepted a loopback callback. A registered public app client with Pikar's exact production callback rejected `insights:read` with `invalid_scope`, then rejected the MCP resource with `invalid_target` and “This client is not allowed to request MCP resources”. Removing both reached Buffer authorization. The earlier loopback MCP insights proof did not establish hosted app eligibility.

Buffer's [Building Apps](https://developers.buffer.com/guides/building-apps.html) guide specifies registered app clients for apps used by other people. Its [API index](https://developers.buffer.com/llms.txt) labels aggregate and per-post metrics as personal-workflow functionality.

## Decision

Use one registered public PKCE app identity, configured server-side as `BUFFER_OAUTH_CLIENT_ID`, with the exact existing Convex HTTPS callback. Request only account read, post read/write and offline access; omit the MCP resource from authorization, exchange and refresh. Use the fixed GraphQL API for organization/channel reads, approved creation and status reconciliation. Preserve one-use state/receipts, encrypted per-tenant tokens, refresh leases and human publishing approval.

The production release pins the public client ID beside the existing durable-origin configuration using the protected deployment credential. The ID grants no account access and is not a client secret. Other deployments must register their own callback and configure an appropriate public client; there is no development fallback.

Engagement refresh and daily reporting fail closed with a specific unavailable reason. UI controls explain Buffer's third-party restriction rather than recommending reconnect. Previously saved reports remain historical data. No personal API key or privileged MCP identity is substituted for a user's grant. The standalone MCP transport/probe test remains historical evidence only and is not called by hosted app actions.

## Consequences

Hosted users can authorize the supported publishing integration. Engagement reporting needs a separately supported provider route or explicit Buffer enablement; a successful connection must never be presented as analytics acceptance. Live posting is not performed merely to test this repair. Offline regression tests exercise start, callback, activation, API reads, rotating refresh and approved publishing with synthetic credentials; account consent and real publication remain separate acceptance steps.
