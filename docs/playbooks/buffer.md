# Playbook: Buffer social marketing

> Last verified: 2026-10-19 against the local Buffer implementation; hosted Pikar acceptance remains pending.
> Authority: owner request to add Buffer OAuth/MCP publishing and engagement reporting; [ADR-058](../decisions/058-buffer-mcp-social-marketing.md).

## Purpose

Users connect their own Buffer account, choose an organization and channels, prepare campaign posts, approve scheduling, and retrieve real engagement data. Buffer remains an optional provider alongside future direct social integrations. Existing direct-provider blockers are unchanged.

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

Requires Convex Auth, `SITE_URL` (canonical HTTPS app origin), automatic `CONVEX_SITE_URL` (HTTPS Convex HTTP origin), and existing `CONNECTOR_CREDENTIAL_KEY_V1`. Optional V2 envelopes use the existing credential-key resolver. No Buffer personal API key, client secret or frontend token is required. Credentials reuse the existing AES-256-GCM envelope with Buffer provider, tenant and connection bound as authenticated data; PKCE material uses a separate purpose suffix.

The callback is `${CONVEX_SITE_URL}/buffer/callback`. Buffer's public dynamic registration registers this exact redirect with PKCE S256 and token endpoint authentication `none`. Scopes are `account:read posts:read posts:write insights:read offline_access`; no account write/delete scope is requested.

## Data flow

1. Authenticated `startConnect` registers the public client and stores an encrypted PKCE verifier with a domain-separated state hash, tenant and ten-minute expiry.
2. The Convex HTTP callback claims the request into `exchanging` before token exchange. It cannot replay. The request remains a cancellation fence: disconnect or a new connection removes it, so an in-flight exchange cannot restore access.
3. Tokens are encrypted into a ten-minute pending grant. Only its opaque one-use receipt crosses back to the app. Authenticated `completeConnect` requires the initiating tenant and atomically activates the grant. A different signed-in Pikar account cannot activate it. The frontend immediately removes the receipt from browser history.
4. The user loads their organizations; `get_account` verifies membership before a fixed channels query. Only selected available channels may be used. Switching organizations clears selection; locked/disconnected channels cannot be selected.
5. Manual entry or executive `stageBufferPost` saves a local draft. Neither calls the publishing API. Tenant `approvePost` checks ownership, revision, selection and schedule and schedules the outbound action atomically.
6. Publishing claims the approved draft once, rechecks the current connection/selection and calls `create_post`. Provider post ID and status are recorded. Replays cannot write twice. Ambiguous responses/crashes remain held as unknown/submitting and require checking Buffer before replacement; there is no automatic publication retry.
7. Report refresh calls `get_aggregated_post_metrics` for exactly the selected channels over the last thirty days. Normalized values, source refresh timestamp, period and channel scope are stored. Missing metrics remain unavailable; returned zero remains zero. Old-selection reports are labeled.
8. Opt-in daily reports are claimed in batches of 25 by a fifteen-minute cron; each tenant is checked against the erasure fence. Status reads run even if the metric read fails. The same cron deletes up to 100 expired OAuth records. Manual status refresh checks up to 20 pending posts among the latest 100 local posts, matching native ID and channel before updating status.

## Invariants

- Public database functions use tenant wrappers; internal callbacks/schedulers have explicit bounded index exceptions. Tokens, verifiers and raw provider error text never enter UI, audit, tool results or application logs.
- Refresh uses a revision and single-use lease. Only one caller can exchange a rotating refresh token. An abandoned lease or failed exchange requires reconnection; stale completion cannot resurrect a disconnected/replaced grant.
- The model cannot supply provider URLs, arbitrary GraphQL, OAuth identity, organization selection, credentials, approval or publish operations. `execute_query` strings are code-owned. Buffer tools are added only to the executive grant with request lineage and outside eval contexts.
- Exact content, media URL, destination and schedule are visible for human approval. Draft content is not editable after approval. Duplicate approval is rejected. Due times are validated again before outbound submission.
- A successful queue submission is not delivery. `scheduled`, `sent`, `buffer_review`, `failed` and uncertain outcomes remain distinct.
- Media is one public HTTPS image or video; Pikar does not fetch it. Instagram/TikTok/Pinterest require media; YouTube requires video, title/category and explicit public visibility; Pinterest board must belong to the loaded channel. Advanced formats, carousels and threaded posts are deliberately deferred.
- Buffer connection/OAuth rows are tenant credentials and export only credential summaries; posts/reports are tenant-owned export/erasure data. Existing tenant deletion removes all four tables. Local disconnect removes credentials and pending callbacks but does not cancel posts already scheduled at Buffer or claim upstream grant revocation.

## Verification

Run `pnpm --filter @pikar/core exec vitest run src/buffer.test.ts`, backend `buffer`, `isolation`, `importGuard`, `toolRegistrySnapshot`, `tenantDelete`, `tenantExport` and `privacyLifecycle` tests, and frontend `bufferPanel`, `marketingView` and `marketingPrefill` tests. Run repository typecheck, lint, free gates, unit suite and build before release.

Native CLI codegen requires an authenticated development deployment. This environment's CLI received `MissingAccessToken`; production was not used for codegen. API module declarations were generated by the installed official Convex component template against the current module inventory, preserving committed component declarations and existing quoted-property formatting. Regenerate with normal development credentials when available.

Live evidence is narrower than release acceptance: the separately consented read-only OAuth/MCP probe returned 3 posts, 18 reactions, 0 comments, 349 views and a 5.16% engagement rate for its thirty-day period. It used no personal API key and wrote no provider posts. This confirms that the tested MCP OAuth grant can read insights; it does not establish Buffer's commercial embedding policy, every plan/platform's metric availability, production Pikar callback acceptance, rotating refresh success or publishing acceptance.

For hosted acceptance, connect a disposable tenant through Pikar, choose channels, verify a report, test reconnect/refresh/disconnect, and approve one explicitly authorized disposable scheduled post. Check the actual Buffer queue and platform result. Do not auto-publish a live post merely to qualify the connector. Do not capture tokens, OAuth codes or account response bodies in screenshots/traces/files.

## Operations and ceilings

Disconnect stops future local access/daily reads. Remove the Pikar app in Buffer API settings to revoke upstream access; already scheduled posts must be managed in Buffer. Lost/expired consent requires reconnecting, never editing stored credentials. Provider or quota errors surface a fixed UI failure and retain the previous report with its old timestamp; background action failures are visible in Convex logs without raw provider bodies.

`ponytail:` use Buffer's existing queue for publication timing and the existing executive agent for campaign planning. No second agent loop, scheduler, media hosting service or direct social OAuth stack is introduced. Reports are rolling thirty-day snapshots, not real-time monitoring, comments management, campaign attribution or a complete analytics warehouse. Current bounded post lists/status reconciliation cover the latest 100 local posts; a larger operating volume requires indexed pagination. Buffer's embedding/commercial suitability and hosted full-consent/write acceptance remain independent release checks.
