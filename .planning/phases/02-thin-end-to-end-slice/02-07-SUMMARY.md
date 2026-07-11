---
phase: 02-thin-end-to-end-slice
plan: 07
subsystem: auth
tags: [convex-auth, google-oauth, nextjs, middleware, app-shell, opsg-07, privacy]

# Dependency graph
requires:
  - phase: 02-thin-end-to-end-slice (02-05)
    provides: Google Cloud OAuth client + gmail.modify connect flow (reused for sign-in)
  - phase: 02-thin-end-to-end-slice (02-06)
    provides: deadLetters.newCount tenant query (drives the badge)
provides:
  - Google sign-in via Convex Auth (openid email profile only)
  - Next.js auth wiring — ConvexAuthNextjsServerProvider + client provider + route-gating middleware
  - Authenticated (app) shell with nav + persistent OPSG-07 dead-letter badge
  - /signin page and /dashboard authenticated landing
  - @pikar/backend/api export — first Convex client surface for the web app
  - Privacy policy names Vercel AI Gateway + OpenAI as active processors
affects: [02-08, 02-09, ui, review-queue, ops-console]

# Tech tracking
tech-stack:
  added: ["@convex-dev/auth (web, 0.0.94)", "@auth/core (0.41.2)"]
  patterns:
    - "Web imports Convex api via @pikar/backend/api package export (source-export, transpilePackages)"
    - "Route group (app) gated by default-deny middleware; public routes are the explicit allow-list"
    - "OPSG-07 badge = live useQuery, unread-mail semantics (never auto-clears), not a toast"

key-files:
  created:
    - apps/web/middleware.ts
    - apps/web/app/signin/page.tsx
    - apps/web/app/(app)/layout.tsx
    - apps/web/app/(app)/dashboard/page.tsx
  modified:
    - packages/backend/convex/auth.ts
    - packages/backend/convex/smoke.ts
    - packages/backend/package.json
    - apps/web/package.json
    - apps/web/next.config.ts
    - apps/web/app/layout.tsx
    - apps/web/app/providers.tsx
    - apps/web/app/privacy/page.tsx

key-decisions:
  - "Google provider from @auth/core/providers/google (Convex Auth ships no Google provider); front door scope is openid email profile only — gmail.modify stays in the separate /connect-gmail flow"
  - "Authenticated dashboard routed at /dashboard, not the (app) group root — (app)/page.tsx would collide with the public / marketing page (parallel-page build error)"
  - "smoke.ts handlers got explicit return types: web is the first typechecked consumer of the generated api, which surfaced the deferred workflow.start self-reference (TS7022)"
  - "middleware.ts kept despite Next 16 proxy-rename deprecation — plan + @convex-dev/auth 0.0.94 both mandate middleware.ts"

patterns-established:
  - "Default-deny routing: a new route is private until added to the public allow-list in middleware.ts"
  - "Persistent live-query badge for operator-visible failures (OPSG-07)"

requirements-completed: [OPSG-07, BETA-04]

# Metrics
duration: 35min
completed: 2026-07-11
---

# Phase 2 Plan 07: Authenticated Surface Summary

**Google sign-in via Convex Auth with Next.js route-gating middleware, an authenticated app shell carrying a live OPSG-07 dead-letter badge, and a privacy policy that names Vercel AI Gateway + OpenAI as active processors.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-11
- **Tasks:** 3
- **Files modified:** 13 (4 created, 9 modified)

## Accomplishments
- Swapped the Convex Auth Password provider for Google (`openid email profile` only), reusing the Gmail flow's Google Cloud client
- Wired the full Next.js auth stack: server provider in layout, client provider in providers.tsx, and a default-deny middleware redirecting unauthenticated app routes to `/signin`
- Built the authenticated `(app)` shell with nav (Submit/Requests/Review/Ops/Connect Gmail — targets land in 02-08/09) and a persistent red dead-letter badge bound to a live `deadLetters.newCount` query
- Exposed `@pikar/backend/api` as a package export — the web app's first Convex client surface
- Named OpenAI (via Vercel AI Gateway) as active processors in the privacy policy, replacing the `[LLM PROVIDER — TBD]` placeholder

## Task Commits

1. **Task 1: Google sign-in + Next.js auth wiring** - `5091931` (feat)
2. **Task 2: App shell + persistent dead-letter badge** - `0563707` (feat)
3. **Task 3: Privacy processor list edit** - `a422486` (feat)

## Files Created/Modified
- `packages/backend/convex/auth.ts` - Google provider replaces Password (identity scope only)
- `packages/backend/convex/smoke.ts` - explicit handler return types (unblocks web api typecheck)
- `packages/backend/package.json` - `@auth/core` dep + `./api` export map
- `apps/web/middleware.ts` - Convex Auth route gating, default-deny to `/signin`
- `apps/web/app/layout.tsx` - wrapped in `ConvexAuthNextjsServerProvider`
- `apps/web/app/providers.tsx` - `ConvexProvider` → `ConvexAuthNextjsProvider`
- `apps/web/app/signin/page.tsx` - Sign in with Google → `/dashboard`
- `apps/web/app/(app)/layout.tsx` - authenticated shell + live OPSG-07 badge
- `apps/web/app/(app)/dashboard/page.tsx` - authenticated landing
- `apps/web/app/privacy/page.tsx` - Vercel AI Gateway + OpenAI named as processors
- `apps/web/package.json` - `@convex-dev/auth`, `@auth/core`, `@pikar/backend` deps
- `apps/web/next.config.ts` - `@pikar/backend` added to transpilePackages

## Decisions Made
- **Google provider source:** `@auth/core/providers/google` — Convex Auth ships no Google provider of its own; front-door scope deliberately limited to `openid email profile`.
- **Dashboard at /dashboard:** the `(app)` route group root maps to `/`, colliding with the public marketing page; the authenticated landing lives at `/dashboard`.
- **middleware.ts retained:** Next 16 deprecates the name in favour of `proxy`, but `@convex-dev/auth` 0.0.94 and the plan both require `middleware.ts`; the rename is deferred.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Explicit return types on smoke.ts workflow entry-point handlers**
- **Found during:** Task 1 (web typecheck, after adding the `@pikar/backend/api` import)
- **Issue:** The web app is the first typechecked consumer of the generated Convex `api`. Importing it pulls every backend module's source, surfacing the deferred `smoke.ts` self-reference: `runFailingPipeline`/`startReviewGate` return `workflow.start(...)`'s result, which references `internal.smoke.*`, making the module's api type circular (TS7022/TS7023). This is the exact latent pattern STATE.md flagged as "still-deferred".
- **Fix:** Added explicit `Promise<{ correlationId: string; workflowId: string }>` return annotations to both handlers (the documented remedy — Convex guidelines §96, WorkflowId widens to string).
- **Files modified:** packages/backend/convex/smoke.ts
- **Verification:** `pnpm --filter @pikar/web typecheck` green; `build` green.
- **Committed in:** `5091931` (Task 1 commit)

**2. [Rule 3 - Blocking] Dashboard routed at /dashboard instead of (app)/page.tsx**
- **Found during:** Task 2 (app shell)
- **Issue:** The plan named `apps/web/app/(app)/page.tsx`, but route groups don't add a path segment, so it resolves to `/` and collides with the existing public marketing page — a Next.js parallel-page build error.
- **Fix:** Placed the authenticated landing at `apps/web/app/(app)/dashboard/page.tsx` (`/dashboard`); sign-in redirects there.
- **Files modified:** apps/web/app/(app)/dashboard/page.tsx, apps/web/app/signin/page.tsx
- **Verification:** `build` green; `/dashboard` and `/` both present in route table.
- **Committed in:** `0563707` (Task 2 commit) / `5091931` (redirect)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both were required to build. No scope creep — the smoke.ts fix is the documented remedy, the route move preserves the plan's intent (an authenticated landing under the gated shell).

## Issues Encountered
- Next.js 16 emits a deprecation warning for the `middleware` file convention (prefers `proxy`). Left as-is — build passes and the auth library mandates `middleware.ts`. Logged for a future migration.
- `@pikar/backend` and its own typecheck script still fail on pre-existing test-file errors (`import.meta.glob` under plain tsc) and other unrelated files — out of scope, not touched.

## Deferred Issues
- Rename `middleware.ts` → `proxy.ts` once `@convex-dev/auth` supports the Next 16 convention (currently a warning only).
- Auth env vars (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) and the Google redirect URI are deployment/human setup — sign-in cannot be exercised end-to-end until they are set on the Convex deployment.

## User Setup Required
Sign-in requires `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` (the Gmail flow's Google Cloud OAuth client) set on the Convex deployment, plus the Convex Auth redirect URI registered in Google Cloud. No new external service — reuses the existing Google project.

## Next Phase Readiness
- Authenticated shell + nav are live; 02-08/09 can drop `/submit`, `/requests`, `/review`, `/ops`, `/connect-gmail` pages into the `(app)` group and they are gated automatically.
- `@pikar/backend/api` is the established client import path for further Convex queries/mutations.

---
*Phase: 02-thin-end-to-end-slice*
*Completed: 2026-07-11*

## Self-Check: PASSED

All 4 created files present; all 3 task commits (5091931, 0563707, a422486) exist in history.
