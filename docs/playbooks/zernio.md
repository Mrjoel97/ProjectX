# Playbook: Zernio analytics pilot

> Last verified: 2026-10-19 — live read-only pilot returned Instagram and TikTok metrics and matched a native TikTok post also shown in Buffer. Buffer-published provenance remains unqualified; this is not a deployed Pikar reporting connector.
> Authority: owner's approval of a two-account analytics pilot for Buffer-published posts.

## Scope

Qualify Zernio before adding a hosted reporting integration. Existing Pikar publishing remains on Buffer. The pilot reads only the existing Instagram/TikTok profile, at most two accounts, and post analytics over ninety inclusive UTC dates (source=all). It cannot publish, connect new accounts, buy a plan, use X or change Pikar production data.

## Files and operation

- `packages/core/src/zernioPilot.ts`: strict account/metric/page boundaries; missing values are not zeros.
- `packages/backend/scripts/zernioPilot.mjs`: fixed-origin GET reader and one-use loopback credential intake.
- `packages/backend/scripts/zernioPilot.test.mjs`: runnable `node --test` checks of scope, read-only calls, errors and credential intake.

Run `node packages/backend/scripts/zernioPilot.mjs serve <profile-id> [known-buffer-platform-post-id ...]`. It binds only 127.0.0.1 and prints a random local URL that expires after thirty minutes. Use the password field to submit a profile-scoped, read-only key limited to Analytics and Accounts. Do not put a key in chat, command arguments, source, environment files, screenshots, logs or reports. The intake validates host/origin, body size and one-use submission; credentials remain in process memory. Stop the process after checking its safe result. Revoke only the pilot key after the test, keeping pre-existing keys untouched.

The reader uses only `/api/v1/auth/verify`, `/api/v1/accounts?profileId=...` and bounded pages of `/api/v1/analytics` with explicit profile/account/date/source filters. It rejects foreign accounts, unexpected platforms, post rows without the selected account and pagination exceeding five pages. No raw vendor errors, account identifiers, post contents, media or keys enter its result. Combined posts use per-account analytics, never the aggregate across accounts. Source timestamps without a timezone are preserved verbatim and must not be presented as UTC freshness. Individual post metrics and source timestamps remain distinct; no sum of overlapping reach or invented engagement rate is produced.

## Acceptance

Check both accounts' connection health. Buffer Sent history includes native-platform posts; require an explicit Published via Buffer label or equivalent publishing receipt before supplying a known Buffer-published platform ID. A Sent-history match alone does not establish the publisher. Compare returned counts/metrics with Zernio's dashboard, record source freshness, and match at least one platform post ID to a known post published through Buffer. `complete` requires both channels returning metrics without reconnection and an exact Buffer-post match. Empty/failed analytics is incomplete, not a successful zero report.

The [multi-tenant model](https://docs.zernio.com/multi-tenant) supports one profile per Pikar tenant for a later hosted integration. Build that only after this live proof, with server-side credentials, tenant-bound profile ownership, erasure/export classification, consent and budget controls. The [external-post guide](https://docs.zernio.com/analytics/sync-external-posts) describes explicit LinkedIn personal-post imports, while its analytics overview retains a conflicting older restriction; no LinkedIn guarantee follows from an Instagram/TikTok pilot. Current pricing has two free connected accounts across a team, not per Pikar customer. No new paid connection is authorized by this pilot.

## Live qualification (2026-10-19)

Both existing accounts were active without reconnection. The 2026-07-22 through 2026-10-19 window returned 174 TikTok and 189 Instagram external posts. One TikTok platform ID taken from Buffer’s Sent history matched exactly, returning 7 likes and 99 views, matching Buffer’s displayed counts. Buffer labels it Published via Tiktok, so that run’s supplied-ID completion flag is not accepted as proof of Buffer publishing. No new post was published. Both account reads and cross-provider native-post metrics are verified; Buffer-published provenance, Instagram publisher provenance, all-platform coverage, background refresh, and a hosted Pikar connection remain unqualified. The temporary profile-scoped key is for this pilot only and must be revoked afterward.
