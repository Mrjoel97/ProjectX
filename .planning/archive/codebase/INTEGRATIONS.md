# External Integrations

## Convex Platform

- Convex is the system's active data and orchestration plane, not merely an API dependency.
  `packages/backend/convex/schema.ts` defines application tables and includes Convex Auth tables.
- The web app connects with `ConvexReactClient` in `apps/web/app/providers.tsx` and consumes live
  queries, mutations, actions, and Agent messages through `convex/react` and
  `@convex-dev/agent/react`.
- Convex file storage is used for request attachments, vault uploads, generated PDFs, previews,
  and Gmail attachments. Upload URLs originate in `packages/backend/convex/requests.ts` and
  `packages/backend/convex/intakeDb.ts`; binary reads and signed download URLs are handled in the
  `intake`, `vault`, `plans`, `llm`, and `gmail` backend modules.
- Durable orchestration uses Workflow and Action Retrier instances from
  `packages/backend/convex/index.ts`; Agent, RAG, rate limiting, migrations, aggregates, and action
  caching are registered in `packages/backend/convex/convex.config.ts`.
- Convex HTTP routes are assembled in `packages/backend/convex/http.ts`, and scheduled jobs are
  registered in `packages/backend/convex/crons.ts`.
- Deployment configuration uses `CONVEX_DEPLOYMENT`, `CONVEX_URL`, `CONVEX_SITE_URL`, and
  `CONVEX_DEPLOY_KEY`; the browser-safe URL is separately exposed as `NEXT_PUBLIC_CONVEX_URL`.

## Authentication and Identity

- Convex Auth is the active application-auth provider. `packages/backend/convex/auth.ts` enables
  Google sign-in with `openid email profile` plus an email/password provider with an eight-character
  minimum.
- `packages/backend/convex/auth.config.ts` configures the Convex deployment's site URL as JWT issuer,
  and `apps/web/app/layout.tsx` installs the Next.js server auth provider.
- Application tenant functions derive identity server-side through wrappers in
  `packages/backend/convex/lib/functions.ts`; browser-supplied tenant identifiers are not the
  authorization source.
- The Google login grant is deliberately separate from Gmail mailbox consent. Connecting Gmail
  occurs through the dedicated flow in `packages/backend/convex/gmailAuth.ts`.
- E2E authentication uses `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` in
  `apps/web/e2e/auth.setup.ts`, then stores Playwright session state in an ignored local path.

## Google OAuth and Gmail

- Gmail is a live integration for mailbox search, inbox retrieval, reply lookup, approved delivery,
  and best-effort notification email; the adapter is `packages/backend/convex/gmail.ts`.
- `packages/backend/convex/gmailAuth.ts` creates a tamper-evident Google authorize URL requesting
  offline access and the `https://www.googleapis.com/auth/gmail.modify` scope.
- Google redirects to the inbound `GET /gmail/callback` Convex HTTP action in
  `packages/backend/convex/http.ts`; that action exchanges the authorization code and redirects the
  browser back to `SITE_URL`.
- Token exchange and refresh use Google's OAuth token endpoint. Required server variables are
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GMAIL_OAUTH_REDIRECT_URI`.
- Refresh and access tokens are stored only in the indexed `gmailTokens` table declared by
  `packages/backend/convex/schema.ts`; client queries expose status and expiry metadata, not tokens.
- Gmail API calls cover `users/me/messages` list/read, `users/me/messages/send`, and
  `users/me/profile`; `packages/backend/convex/notifyExternal.ts` uses the profile address to send
  static, content-free notices to the user's own mailbox.
- A daily token-expiry scan is scheduled from `packages/backend/convex/crons.ts`, and reconnect
  state is surfaced by `apps/web/app/(app)/_components/ReconnectBanner.tsx`.
- Google Calendar is not yet a live external adapter. `packages/core/src/calendar.ts` defines
  scopes/contracts and cockpit code contains a frozen stub, but there is no Calendar API endpoint
  module in `packages/backend/convex`; do not configure or advertise it as operational yet.

## OpenAI APIs

- Backend model calls use the Vercel AI SDK with the direct OpenAI provider in
  `packages/backend/convex/llm.ts`, `intake.ts`, `onboarding.ts`, `vaultExtract.ts`, `vaultLlm.ts`,
  `vaultTranscribe.ts`, and `voiceDoc.ts`.
- These paths require the server-side `OPENAI_API_KEY` in the Convex deployment environment.
- The runtime uses OpenAI for text/structured generation, the provider-executed web-search tool,
  attachment/document analysis, audio/video transcription, graph extraction, and business/profile
  generation.
- Knowledge-vault embeddings use `text-embedding-3-small` at 1536 dimensions through the explicit
  REST compatibility adapter in `packages/backend/convex/vaultRag.ts`, then persist/search via the
  Convex RAG component.
- Live voice follows the browser-direct design in `packages/voice/src/realtime.ts` and
  `apps/web/app/(app)/dashboard/voice/useVoiceSession.ts`: Convex mints a short-lived client secret,
  then the browser performs the SDP handshake directly with OpenAI Realtime.
- `packages/backend/convex/voiceToken.ts` also performs server-side Realtime client-secret minting
  and forced call hangup; the long-lived `OPENAI_API_KEY` is never returned to the browser.
- Usage and cost are normalized by `packages/cost/src/cost.ts` and written into internal telemetry
  rather than sent to a third-party analytics service.

## Database, Search, and Storage

- Convex's document database stores audit events, dead letters, requests, plans, briefings, vault
  documents, graph nodes/edges, voice sessions, feedback, notifications, telemetry, OAuth tokens,
  tenant profiles, and optimizer configuration; see `packages/backend/convex/schema.ts`.
- Tenant isolation is primarily index-driven, with tenant-aware function wrappers and compound
  indexes such as `by_tenant_status`, `by_tenant_thread`, and `by_tenant_contentHash`.
- Hybrid knowledge retrieval combines the Convex RAG component's vector/search entries with the
  application-owned graph tables via `packages/backend/convex/vaultGround.ts` and
  `packages/backend/convex/vaultGraph.ts`.
- Convex's `_storage` system holds raw uploaded bytes; application rows retain typed storage IDs and
  metadata.
- AWS S3 is a separate compliance store, not the primary application database or upload store.
  `packages/backend/convex/worm.ts` exports audit windows as NDJSON using S3 Object Lock in
  COMPLIANCE mode.
- The S3 export uses `WORM_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and
  `AWS_SECRET_ACCESS_KEY` via the AWS SDK credential chain; when `WORM_BUCKET` is absent, the daily
  export safely skips without advancing its cursor.
- The daily WORM schedule is in `packages/backend/convex/crons.ts`, and cursor persistence is in
  `packages/backend/convex/wormCursor.ts`.

## HTTP Endpoints, Callbacks, and Webhooks

- `packages/backend/convex/http.ts` registers Convex Auth's generated HTTP routes plus the custom
  Gmail OAuth callback and SkillOpt export/writeback routes.
- `GET /gmail/callback` is an OAuth callback, not a general webhook; state is HMAC-verified before
  tokens are stored.
- `GET /skillopt/export` returns scrubbed training trajectories, and
  `POST /skillopt/writeback` inserts an evaluation-gated skill candidate.
- Both SkillOpt routes fail closed behind `SKILLOPT_TOKEN`; writeback attribution optionally uses
  trusted server configuration `SKILLOPT_OWNER_TENANT`.
- No Stripe-style event receiver, generic outbound webhook dispatcher, or webhook-signature
  framework exists in the current source tree.
- External failure notification is implemented as an in-app row plus best-effort Gmail email in
  `packages/backend/convex/notifications.ts` and `packages/backend/convex/notifyExternal.ts`, not as
  a third-party webhook.

## SkillOpt and GitHub Actions

- `.github/workflows/skillopt.yml` is a scheduled/manual optimization integration. It targets the
  owner's Convex deployment, downloads scrubbed trajectories, runs Python SkillOpt, writes back a
  candidate, and runs the golden evaluation gate.
- The workflow is dormant by default and is guarded by both `optimizerConfig.enabled` and an
  eligibility check before installing/running the Python optimizer.
- GitHub Actions secrets/config names are `CONVEX_DEPLOY_KEY`, `SKILLOPT_TOKEN`,
  `SKILLOPT_HTTP_URL`, and `OPENAI_API_KEY`; no values belong in repository documentation.
- Python rollout code in `skillopt/envs/pikar_cockpit/rollout.py` also reads
  `SKILLOPT_RUN_ID` and `SKILLOPT_TENANT`, while `dataloader.py` reads `SKILLOPT_EXPORT`.
- The workflow writes candidates only; activation remains a separate human action through the
  operations UI and backend skill registry.

## Observability and Operational Signals

- Observability is application-owned inside Convex: `audit`, `telemetry`, `agentSteps`,
  `deadLetters`, `notifications`, `feedback`, and aggregate data are defined in
  `packages/backend/convex/schema.ts`.
- `packages/backend/convex/audit.ts` writes insert-only, redaction-safe audit events, with the
  separate S3 WORM export providing durable immutable retention.
- `packages/backend/convex/telemetry.ts` writes terminal request measurements, and
  `packages/backend/convex/opsSignals.ts` computes operational/evaluation signals for
  `apps/web/app/(app)/ops/page.tsx`.
- Console logging is used for bounded operational diagnostics in backend actions and scripts.
- No configured Sentry, Datadog, PostHog, OpenTelemetry exporter, or hosted log-drain integration is
  present. A transitive OpenTelemetry package in the lockfile is not an application integration.

## Deployment and Hosting

- The backend is deployed with the Convex CLI from `packages/backend`; production deploys require a
  separate idempotent skill seed documented in `README.md`.
- The web frontend is intended for Vercel. `README.md` assigns Vercel only
  `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOY_KEY`, and `apps/web/app/legal.ts` checks
  `VERCEL_ENV`; however, no `vercel.json` or infrastructure code is committed.
- `CI` affects Playwright's `forbidOnly` behavior in `apps/web/playwright.config.ts`.
- `sidecars/README.md` names Fly.io with Railway fallback and variables `PRESIDIO_URL`,
  `GRAPHIFY_URL`, and `SKILLOPT_URL`, but `sidecars` currently contains no service code or
  Dockerfile. Treat all three sidecars and hosting targets as planned, not deployed integrations.
- Graphify in `.mcp.json` is a local developer MCP integration backed by
  `graphify-out/graph.json`; it is not part of the production request path.

## Configuration Touchpoints

- `README.md` is the canonical guide for splitting secrets between Convex deployment variables and
  browser/deploy-safe Vercel variables.
- `turbo.json` declares build-visible `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT`.
- `apps/web/app/providers.tsx` requires `NEXT_PUBLIC_CONVEX_URL`; Convex CLI local state supplies
  `CONVEX_URL` and `CONVEX_DEPLOYMENT` under `packages/backend/.env.local`.
- `packages/backend/convex/auth.config.ts`, `http.ts`, `gmailAuth.ts`, `gmail.ts`,
  `vaultRag.ts`, `voiceToken.ts`, and `worm.ts` are the authoritative server variable consumers.
- `.github/workflows/skillopt.yml` is the authoritative SkillOpt CI secret map.
- `.gitignore` excludes `.env`, `.env.local`, `.env.*.local`, generated Convex files, and local
  Convex state. There is no committed `.env.example`.
- The checked-out root `.env` is local-only; names not referenced by source should not be treated as
  canonical. In particular, application code expects the exact uppercase names documented above.

