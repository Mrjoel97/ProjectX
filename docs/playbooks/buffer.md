> Last verified: 2026-10-29 — Explicitly saving an owned, exact-revision draft after Buffer reconnect can adopt the current grant only for the same organization, channel and platform. The destination must still be selected and available. The save creates a new unapproved revision; old review revisions fail, and reconnect itself never approves or schedules a post. Approved, submitting and uncertain rows remain fenced. Native regression cases cover same-destination recovery, destination/grant failures, stale review, ownership and zero scheduled publication jobs. All 37 native Buffer tests pass locally. Hosted reconnect acceptance and publication remain unverified.

> Last verified: 2026-10-24 — Draft editing and rejection use visible revision checks; explicit recovery creates a new unapproved draft only for a known failed submission without a provider ID. Accepted Buffer publication/status responses can now retain a strictly validated native permalink receipt for the exact approved revision. The outcome projection joins that receipt to one current, owned, selected Zernio account/post with the same platform and canonical provider URL; equal cross-provider ID strings never establish attribution. Unsupported URLs, ambiguous native rows or missing receipts stay unverified. Local Buffer core/backend checks passed (15 core checks across Buffer/Zernio and 24 native Buffer checks); full integration CI and the live social pilot are still pending. No provider publication was performed by these checks.

> Last verified: 2026-10-23 — Native service draft staging persists its trusted managedServiceRunId and the selected channel's native platform alongside the existing draft. Public draft input cannot supply service lineage. The then-current outcome join returned unverified attribution without a native receipt; this historical check did not establish publisher provenance.

> Last verified: 2026-10-23 — The attended service keeps Buffer grantRevision separate from credential revision: ordinary refresh preserves service pins; changed permissions, selected channels or grant failure invalidate them. Scoped reads filter selected channels and stageAgentPost atomically checks the native service run before saving a draft. Existing exact-content approval and publishing remain unchanged. Buffer15 and managedServices14 local tests pass, including refresh stability; no hosted publication is claimed.

> Last verified: 2026-10-19 — The Zernio cached-read tool uses a concise tool contract with structured report scope and sampling metadata; Buffer publishing and its insights restriction are unchanged.

> Last verified: 2026-10-19 — the executive tool builder also exposes cached Zernio report reads, with separate provider attribution and no provider refresh or publishing capability. Buffer third-party insights remain unavailable; Zernio reports do not imply Buffer publisher provenance.

# Playbook: Buffer social marketing

> Last verified: 2026-10-19 — registered app OAuth replaces rejected hosted MCP registration; regression tests cover callback, API reads, refresh and approved writes. Full hosted account consent/publication remains a separate acceptance check.
> Authority: owner request to repair production; [ADR-059](../decisions/059-buffer-registered-app-oauth.md) supersedes ADR-058's hosted MCP/report path.

> Last verified: 2026-10-24 — Incomplete platform drafts retain their local text and media details. The marketing panel uses the shared platform requirements to explain missing media, video, title, category or board, and disables approval until those details and the current selected account are ready. Edit and reject remain available. Native approval and publication enforce the same requirements before queueing or provider work; local UI checks do not establish live publication.

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
5. Manual entry or executive `stageBufferPost` saves a local draft. Neither calls the publishing API. `editPost` replaces a draft's full content/media/destination/schedule after exact revision and current connection checks, increments its revision and clears any approval. `discardPost` rejects a draft while retaining its history; the UI supplies its visible revision. Tenant `approvePost` checks ownership, exact reviewed revision, selection and schedule and schedules the outbound action atomically.
6. Publishing claims the approved draft once, rechecks connection/selection and calls GraphQL `createPost`. Typed success records the provider ID/status. Typed rejection fails; partial GraphQL errors and ambiguous responses remain unknown and require checking Buffer before replacement. There is no automatic publication retry.
7. Engagement actions and agent tools return a specific unavailable result without provider calls. UI controls are disabled and new daily-report opt-ins are rejected. Existing saved reports remain historical data; this connection grants no analytics access.
8. The fifteen-minute cron retains bounded cleanup (100 expired OAuth records) and checks publishing status for any legacy daily opt-ins in batches of 25. Manual status refresh checks up to 20 eligible posts among the latest 100 local posts, matching Buffer ID and channel before updating status. Known sent posts without a publication receipt remain eligible for this read-only reconciliation; unknown submissions without an accepted provider ID never become a publication retry.
9. `restageFailedPost` accepts only the exact failed revision with `connection_changed`, `schedule_expired` or `provider_rejected`, no provider post ID and no prior replacement. It atomically retains the old failure and records its new draft pointer. The replacement needs a separate content review and approval. Provider-owned failures and uncertain submissions require checking Buffer rather than restaging automatically.

## Invariants

- Public database functions use tenant wrappers; internal callbacks/schedulers have explicit bounded index exceptions. Tokens, verifiers and raw provider error text never enter UI, audit, tool results or application logs.
- Refresh uses a revision and single-use lease. Only one caller can exchange a rotating refresh token. An abandoned lease or failed exchange requires reconnection; stale completion cannot resurrect a disconnected/replaced grant.
- The model cannot supply provider URLs, arbitrary GraphQL, OAuth identity, organization selection, credentials, approval or publish operations. Queries are code-owned and use the fixed API origin. Buffer tools are added only to the executive grant with request lineage and outside eval contexts.
- Exact content, media URL, destination and schedule are visible for human approval. Draft content is not editable after approval. Duplicate approval is rejected. Due times are validated again before outbound submission.
- A successful queue submission is not delivery. `scheduled`, `sent`, `buffer_review`, `failed` and uncertain outcomes remain distinct.
- Publication receipts use documented Buffer `Post.externalLink`, `sentAt`, `channelService` and `Channel.serviceId`, bound to the accepted Buffer ID, exact approved text/revision and channel. Only canonical Instagram `/p/` or `/reel/` URLs and TikTok `/@…/video/…` URLs are supported. Instagram shortcodes are never converted to numeric media IDs; that ID must come from the scoped Zernio analytics row. Unsupported formats, tracking-query URLs and conflicting identities preserve the publication status but provide no verified publisher link.
- A service outcome additionally requires the current native Buffer and Zernio grants, exact selected account revisions and unique URL/native-post identity. Same native IDs under distinct analytics sources cannot substitute another row's metrics. A linked publication and post-lifetime metrics still establish neither ROI nor business improvement.
- Media is one public HTTPS image or video; Pikar does not fetch it. Instagram/TikTok/Pinterest require media; YouTube requires video, title/category and explicit public visibility; Pinterest board must belong to the loaded channel. Advanced formats, carousels and threaded posts are deliberately deferred.
- Buffer connection/OAuth rows are tenant credentials and export only credential summaries; posts/reports are tenant-owned export/erasure data. Existing tenant deletion removes all four tables. Local disconnect removes credentials and pending callbacks but does not cancel posts already scheduled at Buffer or claim upstream grant revocation.

## Verification

Run `pnpm --filter @pikar/core exec vitest run src/buffer.test.ts`, backend `buffer`, `isolation`, `importGuard`, `toolRegistrySnapshot`, `tenantDelete`, `tenantExport` and `privacyLifecycle` tests, and frontend `bufferPanel`, `marketingView` and `marketingPrefill` tests. Run repository typecheck, lint, free gates, unit suite and build before release.

Native CLI codegen requires an authenticated development deployment. This environment's CLI received `MissingAccessToken`; production was not used for codegen. API module declarations were generated by the installed official Convex component template against the current module inventory, preserving committed component declarations and existing quoted-property formatting. Regenerate with normal development credentials when available.

Live evidence is narrower than release acceptance: the separately consented read-only OAuth/MCP probe returned 3 posts, 18 reactions, 0 comments, 349 views and a 5.16% engagement rate for its thirty-day period. It used no personal API key and wrote no provider posts. This confirms that the tested MCP OAuth grant can read insights; it does not establish Buffer's commercial embedding policy, every plan/platform's metric availability, production Pikar callback acceptance, rotating refresh success or publishing acceptance.

Production diagnosis additionally proved registered clients reject insights (`invalid_scope`) and MCP resources (`invalid_target`), while the corrected request reaches Buffer authorization. The standalone MCP transport remains a historical probe seam, unused by hosted actions.

For hosted acceptance, connect a disposable tenant through Pikar, choose channels, verify the reporting restriction, test reconnect/refresh/disconnect, and approve a disposable scheduled post only with explicit publication authorization. Check the actual Buffer queue/platform result. Do not auto-publish merely to qualify the connector. Do not capture tokens, OAuth codes or account response bodies in screenshots/traces/files.

### Observe an existing native publication without publishing

1. Use the existing signed-in tenant on the exact approved deployment. Read `api.buffer.status({})`, `api.zernio.status({})` and `api.buffer.posts({})`. Verify the selected available accounts and an existing service-linked post's exact native row/revision, approval and accepted Buffer ID. Missing grants or a missing native post are prerequisites to resolve, not permission to copy credentials, seed a sent row or approve a new post.
2. If an already accepted post is within the latest 100 local rows, use Marketing's **Refresh publishing status** (`api.bufferActions.refreshPosts({})`) once. This only reads provider status and updates local status/receipts; it cannot publish. Observe `sent` and the matching persisted `publicationReceipt` through the tenant's `buffer.posts` query. A queue acknowledgement or missing permalink is incomplete publication evidence. The refresh checks at most 20 eligible posts.
3. Refresh the selected Zernio accounts using Marketing's reporting control (`api.zernioActions.refreshReport({})`). Respect its five-minute refresh interval and bounded lease; `not_due_or_connection_changed` is not a fresh report. Read `api.zernio.status({})` and `api.zernio.latestReport({})` to distinguish failure, old cached data, empty results and an accepted fresh retrieval.
4. For that exact service run, read `api.serviceOutcomes.runOutcome({runId})`. A verified link requires the supported canonical URL in both provider-native observations, the same platform, one unambiguous scoped analytics row and still-current owned grants. Record only IDs, hashes, counts and times in an acceptance receipt, with provider content and credentials kept out. Inspect supported/missing metrics and upstream freshness separately from retrieval time.
5. Do not click **Approve and schedule**, start an agent, edit content or enable recurrence during this observation. A pre-existing post without trusted service lineage can verify connector reads but cannot complete the service pilot. This checklist does not replace the separate exact-content human approval, generated-draft journey, recovery checks or two actual scheduled occurrences required by Phase 52.

`apps/web/e2e/managed-social-service.spec.ts` prepares four real draft-control journeys (edit/new review, rejection, known-failure replacement and uncertain-submission refusal). It requires explicit opt-in and hash-bound private disposable-row inputs, disables recordings and never clicks publication approval. Test discovery is not browser acceptance and the spec writes no qualification evidence.

## Operations and ceilings

Disconnect stops future local access/daily reads. Remove the Pikar app in Buffer API settings to revoke upstream access; already scheduled posts must be managed in Buffer. Lost/expired consent requires reconnecting, never editing stored credentials. Provider or quota errors surface a fixed UI failure and retain the previous report with its old timestamp; background action failures are visible in Convex logs without raw provider bodies.

`ponytail:` use Buffer's existing queue for timing and existing executive agent for planning. No second agent loop, media host or direct social OAuth stack is introduced. Reporting remains unavailable until Buffer supports it for third-party app clients; do not substitute privileged MCP credentials. Current bounded post lists/status reconciliation cover the latest 100 local posts; larger volumes require pagination. Hosted consent/write acceptance and commercial suitability remain independent checks.
