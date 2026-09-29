# Phase 25 Gmail-call and environment recheck — 2026-09-29

**Status:** pre-checkpoint source evidence at `813461a`, not Plan 25-00 Task 2 completion or owner release. No environment values, credentials, provider calls, or deployed settings were read.

## Direct `internal.gmail.*` callers

The non-test/non-generated `packages/backend/convex` scan finds ten executable direct references. Two further text matches are comments in `gmail.ts` and `deliverApprovedPlan.ts`, not calls. This is a literal-reference inventory, not a proof against computed access or future code.

| Module | Call | Role |
|---|---|---|
| `delivery.ts` | `gmail.send` | Google arm of the shared Gmail/Graph send dispatcher; mail provider is selected from the request. |
| `gmail.ts` | `gmail.listInbox` | Internal read-count probe, restricted to three results. |
| `knowledgeExternalSources.ts` | `gmail.knowledgeQuery` | Bounded inbox evidence read. |
| `llm.ts` | `gmail.search` | Header search fallback for contacts. |
| `llm.ts` | `gmail.listInbox` (three call sites) | Cockpit inbox-list reads. |
| `llm.ts` | `gmail.fetchInboxBodies` (two call sites) | Bounded body hydration after listing. |
| `llm.ts` | `gmail.getReplyTarget` | Reply-target lookup. |

Command: `rg -n 'internal\.gmail\.' packages/backend/convex --glob '!**/*.test.ts' --glob '!**/_generated/**'`. The ten executable hits are at `delivery.ts:44`, `gmail.ts:1009`, `knowledgeExternalSources.ts:107`, and `llm.ts:2928,4216,4256,4279,5019,5086,5109` at this source SHA. The later source audit must also inspect dispatcher consumers and raw HTTP paths; a direct-reference scan is not a send-safety verdict.

## Environment coverage and blind spots

`packages/backend/convex/lib/env.ts` holds the app's named environment manifest and origin checks. `packages/backend/convex/env.test.ts` scans backend source for literal `process.env.X` and indirect `requireEnvMedia("X")` calls, asserting two-way parity with the manifest. The focused `pnpm --filter @pikar/backend test env` run passed **25/25**. This suite does **not** scan `apps/web`, E2E/operator scripts, arbitrary computed `process.env[name]` reads, or installed packages; the Phase 25 final inventory must not represent it as repository-global coverage.

Installed `@convex-dev/auth` code reads additional names not visible to that backend source test:

| Key | Installed package use | Current evidence interpretation |
|---|---|---|
| `JWT_PRIVATE_KEY` | `dist/server/implementation/tokens.js` uses `requireEnv` to sign tokens. | Implicit auth requirement; no value/readiness proof here. |
| `JWKS` | `dist/server/implementation/index.js` serves `/.well-known/jwks.json` from `requireEnv`. | Implicit auth requirement; no value/readiness proof here. |
| `CONVEX_SITE_URL` | Issuer, JWKS endpoint, and default callback base. | Also classified by the app manifest; hosted origin still unverified. |
| `SITE_URL` | Allowed sign-in redirect base. | Also classified by the app manifest; hosted value still unverified. |
| `CUSTOM_AUTH_SITE_URL` | Optional override of the default OAuth sign-in/callback base in `oauth/convexAuth.js` and `implementation/signIn.js`. | **Coverage question for Plan 25-18 / hosted gate:** app manifest and origin check do not currently account for this library-level override. Its presence in a deployment has not been checked; do not assume unset or safe. |

The repository's disposable-stack runner sets synthetic `JWT_PRIVATE_KEY` and `JWKS` for its isolated test backend. That is not production configuration evidence. The full Plan 25-00 inventory still needs remaining environment references, validators, onboarding/Approve path, user-shareable URLs, playbook watch map, and final drift reconciliation. No deployment or live-send gate is released by this note.
