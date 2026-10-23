> Last verified: 2026-10-23 — Native service draft staging persists its trusted managedServiceRunId and the selected channel's native platform alongside the existing draft. Public draft input cannot supply service lineage. Outcome reads join that tenant-leading run reference to actual publication state; a Buffer post ID equal to a Zernio native ID still establishes no publisher mapping. The native outcome join test returns unverified attribution and no linked engagement evidence; no provider publication was performed.

> Last verified: 2026-10-23 — The attended service keeps Buffer grantRevision separate from credential revision: ordinary refresh preserves service pins; changed permissions, selected channels or grant failure invalidate them. Scoped reads filter selected channels and stageAgentPost atomically checks the native service run before saving a draft. Existing exact-content approval and publishing remain unchanged. Buffer15 and managedServices14 local tests pass, including refresh stability; no hosted publication is claimed.

> Last verified: 2026-10-19 — The Zernio cached-read tool uses a concise tool contract with structured report scope and sampling metadata; Buffer publishing and its insights restriction are unchanged.

> Last verified: 2026-10-19 — the executive tool builder also exposes cached Zernio report reads, with separate provider attribution and no provider refresh or publishing capability. Buffer third-party insights remain unavailable; Zernio reports do not imply Buffer publisher provenance.

# Playbook: Buffer social marketing

> Last verified: 2026-10-19 — registered app OAuth replaces rejected hosted MCP registration; regression tests cover callback, API reads, refresh and approved writes. Full hosted account consent/publication remains a separate acceptance check.
> Authority: owner request to repair production; [ADR-059](../decisions/059-buffer-registered-app-oauth.md) supersedes ADR-058's hosted MCP/report path.

## Purpose

Users connect their own Buffer account, choose an organization and channels, prepare campaign posts and approve scheduling. Engagement reports are unavailable for registered third-party app connections. Buffer remains an optional publishing provider alongside future direct social integrations. Existing direct-provider blockers are unchanged.

## Key files

- `packages/core/src/buffer.ts`: fixed OAuth/MCP endpoints, scopes, response normalization, media and scheduling contracts.
- `packages/backend/convex/buffer.ts`: tenant records, one-use OAuth lifecycle, channel selection, draft approval and background report claims.
- `packages/backend/convex/bufferActions.ts`: OAuth exchange/refresh, fixed provider queries, publishing and status reconciliation.
- `packages/backend/convex/lib/bufferMcp.ts`: fixed-origin, bounded-time JSON/SSE MCP transport.
- `packages/backend/convex/bufferTools.ts`: executive read and draft tools, with no approval or publish tool.
- `apps/web/app/(app)/connect-buffer/page.tsx`: account authorization and explicit channel/report selection.
- `apps/web/app/(app)/dashboard/marketing/BufferPanel.tsx`: campaign drafts, approval, status and metrics.
- Core/backend Buffer tests, marketing `bufferPanel.test.tsx`, executive tool registry snapshots and tenant isolation/privacy tests cover the boundaries below.

## Dependencies and configuration

Use `graphify query "Buffer OAuth marketing"` when graphify is installed. This environment has the graph artifact but no graphify executable.

Requires Convex Auth, `SITE_URL`, automatic `CONVEX_SITE_URL`, existing `CONNECTOR_CREDENTIAL_KEY_V1`, and `BUFFER_OAUTH_CLIENT_ID` from a registered **public** Buffer app client. The production release pins its public app ID using the existing protected Convex deployment step. Other deployments need their own registered callback/client configuration. Optional V2 envelopes use the existing credential-key resolver. No personal API key, client secret or frontend token is used. Credentials reuse AES-256-GCM with Buffer provider, tenant and connection bound as authenticated data; PKCE material uses a separate purpose suffix.

Register `${CONVEX_SITE_URL}/buffer/callback` exactly in Buffer Settings → API → App Clients. PKCE S256 authenticates the public client. Scopes are `account:read posts:read posts:write offline_access`; no MCP resource, insights or account-write scope is requested. Missing app identity fails readiness before starting OAuth. Never register a fresh client for each connection attempt.

## Data flow

1. Authenticated `startConnect` uses the configured public app client and stores an encrypted PKCE verifier with a domain-separated state hash, tenant and ten-minute expiry. No network registration occurs.
2. The Convex HTTP callback claims the request into `exchanging` before token exchange. It cannot replay. The request remains a cancellation fence: disconnect or a new connection removes it, so an in-flight exchange cannot restore access.
3. Tokens are encrypted into a ten-minute pending grant. Only its opaque one-use receipt crosses back to the app. Authenticated `completeConnect` requires the initiating tenant and atomically activates the grant. A different signed-in Pikar account cannot activate it. The frontend immediately removes the receipt from browser history.
4. Fixed GraphQL queries read organizations and verify membership before loading channels. Only selected available channels may be used. Switching organizations clears selection; locked/disconnected channels cannot be selected.
5. Manual entry or executive `stageBufferPost` saves a local draft. Neither calls the publishing API. Tenant `approvePost` checks ownership, revision, selection and schedule and schedules the outbound action atomically.
6. Publishing claims the approved draft once, rechecks connection/selection and calls GraphQL `createPost`. Typed success records the provider ID/status. Typed rejection fails; partial GraphQL errors and ambiguous responses remain unknown and require checking Buffer before replacement. There is no automatic publication retry.
7. Engagement actions and agent tools return a specific unavailable result without provider calls. UI controls are disabled and new daily-report opt-ins are rejected. Existing saved reports remain historical data; this connection grants no analytics access.
8. The fifteen-minute cron retains bounded cleanup (100 expired OAuth records) and checks publishing status for any legacy daily opt-ins in batches of 25. Manual status refresh checks up to 20 pending posts among the latest 100 local posts, matching native ID and channel before updating status.

## Invariants

- Public database functions use tenant wrappers; internal callbacks/schedulers have explicit bounded index exceptions. Tokens, verifiers and raw provider error text never enter UI, audit, tool results or application logs.
- Refresh uses a revision and single-use lease. Only one caller can exchange a rotating refresh token. An abandoned lease or failed exchange requires reconnection; stale completion cannot resurrect a disconnected/replaced grant.
- The model cannot supply provider URLs, arbitrary GraphQL, OAuth identity, organization selection, credentials, approval or publish operations. Queries are code-owned and use the fixed API origin. Buffer tools are added only to the executive grant with request lineage and outside eval contexts.
- Exact content, media URL, destination and schedule are visible for human approval. Draft content is not editable after approval. Duplicate approval is rejected. Due times are validated again before outbound submission.
- A successful queue submission is not delivery. `scheduled`, `sent`, `buffer_review`, `failed` and uncertain outcomes remain distinct.
- Media is one public HTTPS image or video; Pikar does not fetch it. Instagram/TikTok/Pinterest require media; YouTube requires video, title/category and explicit public visibility; Pinterest board must belong to the loaded channel. Advanced formats, carousels and threaded posts are deliberately deferred.
- Buffer connection/OAuth rows are tenant credentials and export only credential summaries; posts/reports are tenant-owned export/erasure data. Existing tenant deletion removes all four tables. Local disconnect removes credentials and pending callbacks but does not cancel posts already scheduled at Buffer or claim upstream grant revocation.

## Verification

Run `pnpm --filter @pikar/core exec vitest run src/buffer.test.ts`, backend `buffer`, `isolation`, `importGuard`, `toolRegistrySnapshot`, `tenantDelete`, `tenantExport` and `privacyLifecycle` tests, and frontend `bufferPanel`, `marketingView` and `marketingPrefill` tests. Run repository typecheck, lint, free gates, unit suite and build before release.

Native CLI codegen requires an authenticated development deployment. This environment's CLI received `MissingAccessToken`; production was not used for codegen. API module declarations were generated by the installed official Convex component template against the current module inventory, preserving committed component declarations and existing quoted-property formatting. Regenerate with normal development credentials when available.

Live evidence is narrower than release acceptance: the separately consented read-only OAuth/MCP probe returned 3 posts, 18 reactions, 0 comments, 349 views and a 5.16% engagement rate for its thirty-day period. It used no personal API key and wrote no provider posts. This confirms that the tested MCP OAuth grant can read insights; it does not establish Buffer's commercial embedding policy, every plan/platform's metric availability, production Pikar callback acceptance, rotating refresh success or publishing acceptance.

Production diagnosis additionally proved registered clients reject insights (`invalid_scope`) and MCP resources (`invalid_target`), while the corrected request reaches Buffer authorization. The standalone MCP transport remains a historical probe seam, unused by hosted actions.

For hosted acceptance, connect a disposable tenant through Pikar, choose channels, verify the reporting restriction, test reconnect/refresh/disconnect, and approve a disposable scheduled post only with explicit publication authorization. Check the actual Buffer queue/platform result. Do not auto-publish merely to qualify the connector. Do not capture tokens, OAuth codes or account response bodies in screenshots/traces/files.

## Operations and ceilings

Disconnect stops future local access/daily reads. Remove the Pikar app in Buffer API settings to revoke upstream access; already scheduled posts must be managed in Buffer. Lost/expired consent requires reconnecting, never editing stored credentials. Provider or quota errors surface a fixed UI failure and retain the previous report with its old timestamp; background action failures are visible in Convex logs without raw provider bodies.

`ponytail:` use Buffer's existing queue for timing and existing executive agent for planning. No second agent loop, media host or direct social OAuth stack is introduced. Reporting remains unavailable until Buffer supports it for third-party app clients; do not substitute privileged MCP credentials. Current bounded post lists/status reconciliation cover the latest 100 local posts; larger volumes require pagination. Hosted consent/write acceptance and commercial suitability remain independent checks.
