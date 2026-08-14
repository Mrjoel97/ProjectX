---
status: awaiting_human_verify
trigger: "User A cannot log into the local app for the authorized Phase 21 $0 browser gate. Find and fix if root cause is within local project configuration/code; do not mutate Phase 21 candidate/prompt state."
created: 2026-08-12T17:11:14.9177256+03:00
updated: 2026-08-12T17:55:38.7161128+03:00
---

## Current Focus

hypothesis: Confirmed — the currently running local Convex backend cannot make outbound HTTPS requests to Google, so Convex Auth returns HTTP 500 before session creation or final redirect.
test: Human replaces this restricted backend process with plain `convex dev` launched from a normal network-enabled terminal, then retries one fresh Google sign-in.
expecting: The callback's Google fetch succeeds and the browser leaves the callback endpoint for /dashboard. If it then redirects to the wrong app host, normalize the browser/runtime SITE_URL host as the next distinct issue.
next_action: Stop the currently running restricted local Convex process, relaunch `.\\node_modules\\.bin\\convex.cmd dev` from packages/backend in a normal terminal, keep it running, and retry from http://localhost:3111/signin using a fresh Google attempt.

## Symptoms

expected: Google-only User A authenticates at http://127.0.0.1:3111/signin and returns to the authenticated local app, producing a reusable browser session.
actual: User reports the user cannot log in. Prior automated password setup cannot work because User A has only a Google auth account and no password account. A controllable Chrome session is unavailable. Local Next listens on 3111 and local Convex on 3210/3211; current Phase 21 functions were pushed locally.
errors: No exact visible user error supplied. Historical STATE documents a prior failure where Google sign-in succeeded but final redirect went to dead http://localhost:3000/dashboard?... because local deployment SITE_URL was wrong; it says SITE_URL was corrected to http://localhost:3111. Current reality must be verified.
reproduction: Visit http://127.0.0.1:3111/signin, choose Google, attempt to complete OAuth as User A.
started: Current Phase 21 live gate; local auth has worked in prior UAT but environment is known to drift between cloud .env.local and local :3210 target.

## Eliminated

- hypothesis: The first runtime-env probe showed SITE_URL and Google credentials were absent.
  evidence: The underlying command failed because pnpm exec could not resolve the convex executable from packages/backend; all three false/exit results were command-resolution failures, not deployment responses.
  timestamp: 2026-08-12T17:22:50.3729850+03:00

- hypothesis: The Convex CLI can provide local runtime environment values directly during this investigation.
  evidence: The installed Convex 1.42.1 CLI resolves when invoked explicitly, but `env get SITE_URL --deployment local` hangs past 15 seconds while its help command returns immediately.
  timestamp: 2026-08-12T17:25:06.1283779+03:00

## Evidence

- timestamp: 2026-08-12T17:14:29.8994257+03:00
  checked: Repository worktree before investigation.
  found: The worktree already contains numerous unrelated modified and untracked files; the only file created by this investigation is this debug session record.
  implication: All investigation and any repair must avoid overlapping, staging, committing, or reverting unrelated work.

- timestamp: 2026-08-12T17:16:15.0386542+03:00
  checked: Convex auth provider configuration.
  found: auth.config.ts derives the issuer solely from CONVEX_SITE_URL; auth.ts enables Google OAuth plus Password, so Google-only accounts must use the Google path.
  implication: The reported inability to use password automation is expected; the investigation should focus on issuer/origin configuration and the Google OAuth redirect chain.

- timestamp: 2026-08-12T17:19:50.3976186+03:00
  checked: Frontend routing and test conventions.
  found: Middleware exposes /signin publicly and redirects every unauthenticated private route there. Playwright and E2E docs standardize the app at http://127.0.0.1:3111, while the historical backend callback convention uses http://localhost:3111.
  implication: Host spelling (127.0.0.1 versus localhost), not only the port, may affect OAuth return URLs and cookies; actual configured values and redirects must be compared exactly.

- timestamp: 2026-08-12T17:21:43.4010045+03:00
  checked: Complete sign-in UI and sanitized environment-file URL values.
  found: The Google button correctly calls signIn("google", { redirectTo: "/dashboard" }). apps/web/.env.local targets http://127.0.0.1:3210; packages/backend/.env.local targets local deployment local-joel_feruzi-pikar_ai_50c69-1 at http://127.0.0.1:3210 with site origin http://127.0.0.1:3211. Root .env contains Google auth credentials, but runtime SITE_URL is not present in any inspected file.
  implication: Static code and file-level Convex URLs are internally consistent. The local deployment runtime SITE_URL remains the highest-value drift point because Convex Auth stores deployment environment separately.

- timestamp: 2026-08-12T17:27:09.0841559+03:00
  checked: Live TCP listeners and direct HTTP requests.
  found: Next responds 200 at http://127.0.0.1:3111/signin. No process listens on ports 3210 or 3211; direct requests to both fail with connection refused.
  implication: The configured Convex API and auth/OIDC service are unavailable, which deterministically prevents any Convex Auth method—including Google—from starting. This also explains why local `convex env get` hung.

- timestamp: 2026-08-12T17:30:00+03:00
  checked: Attempt to restore the existing local deployment with plain convex dev, deliberately omitting the package seed hook.
  found: The process exited before opening ports because the restricted execution environment denied its authorization fetch to 34.160.81.0:443 (EACCES). An escalated retry was not approved, so no Convex process was restored.
  implication: The remaining action is environmental and requires a normal user terminal with network access; no project code or local configuration repair is indicated by current evidence.

- timestamp: 2026-08-12T17:51:36.6786253+03:00
  checked: Human verification after restoring the local backend.
  found: Google returned the browser to the local Convex callback path on 127.0.0.1:3211, but the browser remained on that callback URL instead of reaching the app dashboard; the one-time authorization code is deliberately not recorded.
  implication: The backend-unavailable cause was real but incomplete. Initiation and provider return now work, isolating the remaining failure to callback processing or its final application redirect.

- timestamp: 2026-08-12T17:53:02.9792727+03:00
  checked: Sanitized local-backend access records correlated to the human callback attempt.
  found: Three callback requests at 14:50:03Z, 14:50:38Z, and 14:50:39Z all returned HTTP 500 in 63–146 ms. Their referrer was http://localhost:3111/ while the callback endpoint was requested through the local 127.0.0.1 site listener. No authorization code is retained in this record.
  implication: The handler threw; it did not compute an unreachable final redirect. The mixed frontend/callback host remains suspicious, but a detailed function error is required to distinguish origin validation from server-side provider exchange failure.

- timestamp: 2026-08-12T17:54:29.1459044+03:00
  checked: Complete sanitized backend records immediately preceding each callback 500.
  found: Each failed callback has an immediately preceding Convex isolate record for a fetch to https://accounts.google.com with success=false and no response. Earlier in the same backend log, its beacon requests also fail with DNS errors or Windows socket access-denied error 10013.
  implication: The callback reaches provider processing but the local backend has no usable outbound network path. This directly causes the 500 before cookie/session creation or final redirect; an origin mismatch cannot explain the failed server-side fetch.

## Resolution

root_cause: The local backend was restored, but that process is running without usable outbound HTTPS. Convex Auth's callback fetch to Google's account endpoint fails with no response, causing HTTP 500 before session creation/final redirect. The earlier stopped-backend failure was a separate prerequisite issue.
fix: Pending local environmental restart: replace the restricted backend process with plain `convex dev` launched from a normal network-enabled terminal. No code/config fix is justified because the handler/provider configuration reaches the correct callback and fails specifically on outbound fetch.
verification: Three fresh callback requests were correlated at 14:50:03Z, 14:50:38Z, and 14:50:39Z. All returned HTTP 500, and each was immediately preceded by `Fetch to origin: https://accounts.google.com, success: false` with no response. End-to-end verification awaits one fresh OAuth attempt after the unrestricted restart.
files_changed: [.planning/debug/phase21-local-google-login-failure.md, .planning/debug/phase21-local-convex.stdout.log, .planning/debug/phase21-local-convex.stderr.log]
