# Phase 01-10 Google OAuth Readiness Evidence

**Recorded:** 2026-09-19  
**Implementation revision:** `c6b4127`  
**Backend integration commit:** `81b4482` (mixed-attribution shared-index commit; contains the
`http.ts` and `httpAuth.test.ts` 01-10 changes alongside the 17.1 lane)  
**Browser/readiness commit:** `c6b4127`  
**Requirement:** SC-5 remains OPEN. This record authorizes no provider or production action.

## Six evidence layers

| Layer | Status | Evidence |
|---|---|---|
| implemented | PASS (repository-controlled) | `gmailAuth.ts` builds the shared `GOOGLE_SCOPES` authorize URL; `http.ts` verifies signed state before exchange, stores tokens through internal `gmailAuth.store`, and redirects only closed failure codes; the connect and disconnect surfaces render bounded copy. Commits `81b4482`, `c6b4127`. |
| offline-tested | PASS (code/test only) | Backend OAuth/lifecycle: 95/95 tests passed. Browser copy: 13/13 tests passed. Playwright readiness spec listed four Chromium cases plus setup. Backend and web typechecks passed. No Google request was made. |
| deployed | OPEN | No deployment was authorized or performed in Wave 1A. |
| live-observed | OPEN | No Google consent screen, token exchange, live grant, or revocation round-trip was observed. |
| owner-accepted | OPEN | No founder browser verdict was requested or recorded; the Playwright spec was discovered, not executed against an authenticated candidate. |
| externally-enabled | OPEN | Consent-screen configuration, provider test users, Google formal verification, approval receipt, and production enablement remain Wave 7 work. |

Offline green does not advance deployed, live-observed, owner-accepted, or externally-enabled.

## Current repository contract

### Scope source

`packages/core/src/calendar.ts` is the canonical source. `GOOGLE_SCOPES` is the space-separated
union of:

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/calendar.freebusy`
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/drive.readonly`

This supersedes 01-09's obsolete `gmail.send`-only assumption. No test in 01-10 narrows the grant.

### Authorize URL and state

`gmailAuth.buildAuthorizeUrl` uses Google's v2 authorize endpoint, the configured
`GMAIL_OAUTH_REDIRECT_URI`, `response_type=code`, `access_type=offline`, `prompt=consent`,
`include_granted_scopes=true`, canonical `GOOGLE_SCOPES`, and a tenant-bound HMAC state signed with
the server-only client secret. The state contains no secret value.

### Callback and secret plane

The callback route is `GET /gmail/callback` in `packages/backend/convex/http.ts`. It verifies state
before the credentialed token POST, exchanges at `https://oauth2.googleapis.com/token`, and invokes
internal-only `gmailAuth.store`. Token rows are exposed to clients only through booleans/timestamps
from `gmailStatus`; audit payloads contain no token material.

Secret-plane names, never values:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GMAIL_OAUTH_REDIRECT_URI`
- `SITE_URL`

Redirect URI derivation is configuration-owned: the exact `GMAIL_OAUTH_REDIRECT_URI` is used in
both authorize and exchange requests and must equal the deployed Convex site callback URL ending
in `/gmail/callback`. No environment value was read, printed, or changed during 01-10.

### Refusal, replay, reconnect, and rollback

- Provider refusal, missing callback fields, and tampered state produce closed browser codes.
- Missing/tampered state refuses before token exchange and before token storage.
- A replayed/already-redeemed authorization code is represented by Google's `invalid_grant` token
  response; the repository collapses it to `exchange_failed`, stores nothing, and leaks no provider
  detail. One-time authorization-code enforcement remains a provider property and was not live-tested.
- A token response without both refresh and access tokens stores nothing.
- Reconnect replaces the prior row and marks an unread `gmail_reconnect` notification read.
- Disconnect submits the refresh token to Google's revocation endpoint, then deletes the local row;
  a partial upstream revoke is reported honestly and audit contains only `{revoked, status}`.
- User rollback/revocation path: Disconnect Google. If Google does not confirm revocation, the UI
  directs the user to `myaccount.google.com/permissions`. The Wave 7 live revocation re-test is OPEN.

## Exact offline commands and results

Executed from the repository workspace on 2026-09-19:

```text
node node_modules/vitest/vitest.mjs run convex/gmail.test.ts convex/httpAuth.test.ts
cwd: packages/backend
result: PASS — 2 files, 95 tests

pnpm --filter @pikar/backend typecheck
result: PASS

node node_modules/vitest/vitest.mjs run "app/(app)/_components/reconnectBanner.test.ts"
cwd: apps/web
result: PASS — 1 file, 13 tests

node node_modules/@playwright/test/cli.js test e2e/google-oauth-readiness.spec.ts --list
cwd: apps/web
result: PASS — 5 listed tests in 2 files (setup plus 4 readiness cases)

pnpm --filter @pikar/web typecheck
result: PASS
```

The plan's `pnpm --filter ... exec` wrappers did not resolve Windows `.bin` shims in this shared
checkout, so the same locked package CLIs were invoked directly. No browser/provider test ran.

## Browser readiness result

The repository now has observable loading, unavailable, connected, reconnect, callback-error, and
disconnect-result states. `google-oauth-readiness.spec.ts` asserts that the configured authorize URL
has the shared grant and explicitly stops before navigation to `accounts.google.com`; when
unconfigured it asserts the bounded administrator message. Hostile callback input maps to generic
copy. Runtime browser observation and founder acceptance remain OPEN.

## Wave 7 re-entry packet — all items OPEN

No item below is authorized by this packet. Obtain a fresh, exact authorization before acting.

- [ ] **OPEN — Candidate identity:** record exact source revision, deployment identity, site URL,
  Convex callback URL, OAuth client identity (identifier only), and evidence tenant.
- [ ] **OPEN — Consent-screen configuration:** verify app name, support email, authorized domains,
  homepage, privacy policy, terms URL, and the exact four-scope `GOOGLE_SCOPES` union.
- [ ] **OPEN — Provider test users:** add or confirm the exact bounded test accounts; record changes.
- [ ] **OPEN — Domain/policy URLs:** verify public ownership and byte-current homepage/privacy/terms.
- [ ] **OPEN — Demo evidence:** capture the full English consent flow on the exact candidate without
  exposing secrets or tokens; retain URL/screenshot references under the evidence policy.
- [ ] **OPEN — Formal submission:** submit the exact scope justifications and demo in Google's
  verification surface only under explicit provider-write authorization.
- [ ] **OPEN — Approval receipt:** record provider status, timestamps, correspondence, and exact
  approved scope set; a submission alone is not approval.
- [ ] **OPEN — Live round-trip:** on the named non-production/evidence tenant, observe authorize,
  consent, callback, stored refs-only readiness, reconnect, and token-secret non-disclosure.
- [ ] **OPEN — Revocation re-test:** disconnect, confirm upstream revocation and local deletion,
  then verify honest partial/error copy and successful reconnect.
- [ ] **OPEN — Founder verdict:** run the authenticated `/connect-gmail` path on the exact candidate
  and record the founder's acceptance or rejection verbatim.
- [ ] **OPEN — Cleanup:** remove test grants/users/data allowed by the authorization and reconcile
  zero unexpected production writes, provider actions, or secret changes.

## Boundary attestation

Wave 1A made no provider console change, consent-screen edit, test-user edit, live authorization,
deployment, production write, paid call, or secret mutation. No environment value was printed.
