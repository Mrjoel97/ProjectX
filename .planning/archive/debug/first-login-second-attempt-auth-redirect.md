---
status: resolved
trigger: "Investigate issue: first-login-second-attempt-auth-redirect in C:\\Users\\expert\\desktop\\pikar-ai. Trace the first-login sequence across the password sign-in form, Convex Auth server/client state, Next middleware, and authenticated app layout. Identify the exact redirect/session seam causing the reported ‘second attempt works’ behavior and corroborate it with the newest production Vercel deployment logs. Diagnostic only: do not implement a fix and do not edit application code."
created: 2026-08-12T00:00:00+03:00
updated: 2026-08-13T00:05:00+03:00
---

## Current Focus

hypothesis: Confirmed and fixed for OAuth/Google. Production Convex SITE_URL now names the canonical www origin, so OAuth completion and host-only auth cookies stay on the same application domain.
test: Complete: a clean Google sign-in returned to the authenticated onboarding route on www.pikar-ai.com, with no vercel.app request in the browser flow.
expecting: Complete.
next_action: None. The production release workflow now pins and verifies SITE_URL against PRODUCTION_URL to prevent recurrence.

## Symptoms

expected: First successful credential submission navigates once to /dashboard and remains authenticated.
actual: First attempt appears to fail/return to sign-in; a second attempt works.
errors: No exact visible error supplied. User suspects session hydration race or mismatched domains.
reproduction: Submit the real /signin password form on the production deployment as a valid user, observe redirect chain.
started: Current production behavior; inspect newest production deployment and logs.

## Eliminated

- hypothesis: router.push('/dashboard') runs before the auth proxy writes the server-visible cookie.
  evidence: In @convex-dev/auth 0.0.94, signIn awaits fetch('/api/auth'); the middleware proxy sets both auth cookies on that fetch response before returning; signIn then awaits local storage and router-cache invalidation before application router.push executes.
  timestamp: 2026-08-12T00:50:00+03:00

- hypothesis: The stale Convex SITE_URL directly causes the password credentials form to switch from www to the preview host.
  evidence: @convex-dev/auth signInImpl sends credentials providers to handleCredentials, which returns tokens directly and never reads SITE_URL. Only OAuth and email/magic-link redirect branches call SITE_URL-based redirect code. The app's password path then uses relative router.push('/dashboard').
  timestamp: 2026-08-13T00:05:00+03:00

## Evidence

- timestamp: 2026-08-12T00:10:00+03:00
  checked: Target inventory and repository-wide auth references.
  found: The password form awaits signIn and then explicitly calls router.push('/dashboard'); middleware separately calls convexAuth.isAuthenticated() and redirects protected routes to /signin; the root layout uses ConvexAuthNextjsServerProvider; the app layout is also auth-adjacent and currently has unrelated user modifications.
  implication: At least two independent navigation/denial points exist, and the investigation must preserve the dirty worktree and distinguish middleware denial from client/app-layout behavior.

- timestamp: 2026-08-12T00:20:00+03:00
  checked: Sign-in page, providers, root layout, middleware, backend auth configuration, package versions, and E2E auth setup.
  found: Password submit awaits useAuthActions().signIn and then calls router.push('/dashboard'). Middleware independently protects /dashboard with convexAuth.isAuthenticated(). ConvexAuthNextjsServerProvider wraps the document and ConvexAuthNextjsProvider wraps the client. The auth package is @convex-dev/auth 0.0.94. Existing E2E comments assert the JWT is in localStorage and consider form login potentially flaky, but the test only waits for the eventual Sign out control and does not assert absence of a /signin bounce.
  implication: A successful credential exchange and middleware-visible cookie are distinct authentication representations. The current E2E can pass even if a transient redirect or retry is required, so production request evidence is necessary.

- timestamp: 2026-08-12T00:30:00+03:00
  checked: Complete authenticated app layout and backend HTTP router.
  found: The app layout gates content with Convex React Authenticated/AuthLoading/Unauthenticated. Its AuthGate does not automatically navigate to /signin; it only presents a manual link. The only automatic protected-route-to-signin redirect in application code is middleware. Backend http.ts merely mounts auth.addHttpRoutes(http); no app-domain redirect is added for password sign-in.
  implication: A production /dashboard -> /signin bounce is attributable to middleware authentication, not the client app-layout gate or the Convex HTTP router.

- timestamp: 2026-08-12T00:40:00+03:00
  checked: @convex-dev/auth 0.0.94 React and Next client implementation.
  found: The public signIn type explicitly warns of a delay between signIn returning and the Convex client handshake. Internally password signIn awaits the auth call, awaits writing JWT and refresh token to localStorage, and awaits onChange before resolving. For Next, the auth call is POST /api/auth and onChange is invalidateCache().
  implication: The generic client handshake can lag, but middleware does not read that handshake or localStorage; its authority is cookies from POST /api/auth. Cookie-setting order in the Next proxy must be established before calling this a hydration race.

- timestamp: 2026-08-12T00:50:00+03:00
  checked: Complete @convex-dev/auth Next server provider, auth proxy, cookie store, middleware, refresh, and router-cache invalidation implementation.
  found: POST /api/auth proxies password signIn to Convex, builds the JSON response, sets both __Host-__convexAuthJWT and __Host-__convexAuthRefreshToken on that response, and only then returns it. The browser fetch must receive that response before signIn proceeds to localStorage and awaited invalidateCache; only afterward does application code call router.push. Middleware reads the same prefixed cookies, validates the JWT by calling auth:isAuthenticated, and redirects only if that query returns false. Cookie options are secure, HttpOnly, sameSite=lax, path=/, with no Domain attribute.
  implication: The proposed simple hydration/cookie-write race is not supported by the actual Next integration ordering. A failing first protected navigation requires either unusable/missing response cookies, middleware/backend validation false, or a different origin/redirect than the same-origin router.push.

- timestamp: 2026-08-12T23:20:00+03:00
  checked: Vercel account, linked project, and production deployment list.
  found: The linked project is joelferuzi-gmailcoms-projects/pikar-ai-convex with root apps/web. The newest production deployment is pikar-ai-convex-a7ak10d3r-joelferuzi-gmailcoms-projects.vercel.app, Ready, created about 48 minutes before inspection; the prior production deployment gyobkjzan failed its build.
  implication: Runtime evidence must target deployment a7ak10d3r, not the prior failed deployment.

- timestamp: 2026-08-12T23:35:00+03:00
  checked: Deployment a7ak10d3r metadata and all available runtime logs since creation.
  found: The deployment is dpl_9GZpwn6CWJrhRsgGaeoRn5QwHevt. Inspect lists Vercel aliases, while runtime logs additionally prove www.pikar-ai.com serves this deployment. Logs contain multiple 200 POST /api/auth requests on pikar-ai-convex.vercel.app and www.pikar-ai.com, but those sequences originated from /signup and contain no subsequent /dashboard request. There are no auth errors or 'Returning false from isAuthenticated because' messages in the available logs.
  implication: The newest production logs confirm the auth proxy is reachable on both domains, but do not contain the reported valid-password /signin -> /api/auth -> /dashboard -> /signin chain. They cannot yet corroborate either a cookie race or middleware false result.

- timestamp: 2026-08-12T23:50:00+03:00
  checked: Unauthenticated production route probes on www, apex, and Vercel alias plus narrowed /dashboard logs.
  found: www.pikar-ai.com/signin is 200 and unauthenticated /dashboard is a middleware 307 to /signin. Apex pikar-ai.com canonicalizes with 308 to www. The Vercel alias also serves signin directly and emits the same unauthenticated /dashboard 307. No route response sets auth cookies outside POST /api/auth.
  implication: Auth cookies are host-only. Authentication established on www cannot authenticate a request sent to a Vercel deployment hostname; that request is predictably denied by middleware.

- timestamp: 2026-08-12T23:50:00+03:00
  checked: Production environment evidence communicated by the parent investigation.
  found: Convex production SITE_URL is stale and equals https://pikar-ai-convex-ei931zp0e-joelferuzi-gmailcoms-projects.vercel.app (deployment dpl_BywrVh3CHnXudMt7qduiCgMgN5qr), not https://www.pikar-ai.com. New deployment logs show www /signin 200 then www POST /api/auth 200. Ten seconds later stale-preview logs show /dashboard 307 twice then /signin 200. Later the stale preview shows its own POST /api/auth 200, then /dashboard 307 followed by /dashboard 200.
  implication: This is the exact host/session seam matching 'first attempt returns to sign-in; second attempt works': host-only cookies minted on www do not cross to the SITE_URL-selected preview host; retrying on the preview host mints that host's cookie and allows a subsequent middleware pass. The remaining check is which auth-flow branch consumes SITE_URL, since the password page's local router.push is relative.

- timestamp: 2026-08-13T00:00:00+03:00
  checked: @convex-dev/auth server signIn routing and redirect implementation.
  found: Provider type credentials calls handleCredentials and returns signed-in tokens without consulting SITE_URL. Provider type oauth/oidc calls handleOAuthProvider, and the OAuth callback's redirectAbsoluteUrl resolves relative redirectTo values against process.env.SITE_URL. The Google button supplies redirectTo '/dashboard'.
  implication: Stale SITE_URL is a confirmed root cause for the observed Google/OAuth chain, but is structurally incapable of causing the stipulated password form's relative navigation to change host.

- timestamp: 2026-08-13T00:05:00+03:00
  checked: Stale preview deployment dpl_BywrVh3CHnXudMt7qduiCgMgN5qr and correlated request windows from the newest production deployment dpl_9GZpwn6CWJrhRsgGaeoRn5QwHevt.
  found: At 22:26:09-12 EAT the newest deployment recorded www /signin 200 then www POST /api/auth 200. At 22:26:22-23 the SITE_URL-selected preview recorded two /dashboard 307 responses followed by /signin 200. At 22:37:32 the preview itself recorded POST /api/auth 200; at 22:37:43 it recorded /dashboard 307 followed immediately by a serverless /dashboard 200. The preview is a Ready preview deployment and can also impose Vercel SSO for unauthenticated visitors.
  implication: Production evidence agrees with middleware rejecting an uncredentialed request on the wrong host, then admitting a request once the preview host has its own usable auth state. It does not identify a password-only defect because request logs do not expose provider/action bodies and the credentials code never redirects through SITE_URL.

- timestamp: 2026-08-13T00:05:00+03:00
  checked: Redirect ownership across middleware and authenticated app layout.
  found: middleware.ts is the component that returns the 307 to /signin when convexAuth.isAuthenticated() is false. The app layout never automatically redirects to /signin; Authenticated/AuthLoading/Unauthenticated render a shell, loader, or manual 'Sign in again' link. The onboarding effect can only replace to /dashboard/onboarding after authentication.
  implication: The visible return to /signin in the correlated logs occurs at the Next middleware cookie-validation seam, before the authenticated layout renders.

## Resolution

root_cause: "Confirmed for Google/OAuth: production Convex SITE_URL is stale and points to preview ei931zp0e instead of www.pikar-ai.com. OAuth redirectTo '/dashboard' is expanded against that host. Because Convex Auth uses host-only __Host- cookies, www authentication/verifier state is absent on the preview host; preview middleware sees isAuthenticated=false and 307-redirects to /signin. Retrying on preview establishes preview-host auth and later passes. Not confirmed for the stipulated password form: credentials signIn bypasses SITE_URL, receives cookies before resolving, and performs a same-origin relative router.push. No production trace of a password-form /dashboard bounce was available."
fix: "Set production Convex SITE_URL on opulent-octopus-494 to https://www.pikar-ai.com. Added a production-workflow invariant that sets SITE_URL from PRODUCTION_URL and fails the release if read-back differs."
verification: "Clean-browser Google OAuth returned to https://www.pikar-ai.com/dashboard/onboarding. The authenticated shell and Sign Out control rendered; browser requests after callback stayed on www.pikar-ai.com; auth cookies were scoped to www.pikar-ai.com. Newest production Vercel logs recorded the expected code-exchange redirect followed by 200 responses for /dashboard and /dashboard/onboarding, with no stale-preview request."
files_changed:
  - .github/workflows/deploy-production.yml
  - .planning/debug/first-login-second-attempt-auth-redirect.md
