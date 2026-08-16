# Playbook: Production Beta Readiness (25-10)

> Last verified: 2026-08-17 (25-10 Task 1 — the environment manifest, the drift scan that keeps it
> honest, and the owner readiness surface. **Tasks 2 and 3 are NOT done; see Known gaps.**)
> Build history: `.planning/phases/25-private-beta-productionization/` · Related ADRs: ADR-020
> (production opened without an admission gate)

## Purpose

Answer "is this deployment actually configured?" without having to try every feature and see which
one is broken. One manifest of every environment name the Convex deployment reads, tiered by what
its absence costs, surfaced to the owner on `/admin` as **names only**.

## Key files

- `packages/backend/convex/lib/env.ts` — `ENV_MANIFEST`, `missingEnv()`, `isDurableOrigin()`.
- `packages/backend/convex/ops.ts` — `envCheck`, an `ownerQuery`.
- `packages/backend/convex/env.test.ts` — the drift scan and the leak assertions.
- `apps/web/app/(app)/admin/AdminView.tsx` — the `EnvReadiness` section.

## Invariants

1. **Names only ever leave the manifest.** No consumer returns a value, a length, or a prefix. A
   readiness screen that echoed a secret to prove it was set would be a worse leak than the
   misconfiguration it reports. Asserted: a stubbed `UNSUBSCRIBE_SECRET` value appears nowhere in
   the serialized response.
2. **Never throw at module load.** A missing key must surface as an ANSWER, not as a deployment
   that refuses to boot and takes every working feature down with the broken one.
3. **A blank value counts as UNSET.** `convex env set X ""` is the most common way a key looks
   configured and is not.
4. **`ready` turns on REQUIRED only.** A dark feature is a product decision; a missing required
   name is a broken deployment. Collapsing them makes the screen unactionable.
5. **An ACTIVE fixture seam is reported as a warning.** `FAL_FIXTURE`, `MEDIA_*_FIXTURE` and the
   Graph-probe flag FAKE real providers — a failure that looks like success, which is the worst
   kind to leave undetectable in production.
6. **The manifest is drift-checked in BOTH directions.** `env.test.ts` scans source for
   `process.env.NAME` and fails on a consumed-but-unclassified name AND on a classified-but-dead
   entry. A manifest maintained by remembering to update it goes stale silently, and in the
   direction that matters: a new required key nobody classified reads as "ready".

## How to verify

| Command | Proves |
| --- | --- |
| `pnpm --filter @pikar/backend exec vitest run convex/env.test.ts` | The manifest matches source, reports names only, and `envCheck` refuses a non-owner. 14 tests. |
| Sign in as owner → `/admin` | The readiness section against the REAL deployment env. This is the easy path. |
| `cd packages/backend && npx convex run --prod ops:envCheck --identity '{"subject":"<ownerUserId>\|cli"}'` | The same, from the CLI. **All three parts are required** — see below. |

**Why the obvious CLI form fails, which 25-12's plan specified:** there is no `convex.json` in this
repo, so the CLI resolves the deployment from `packages/backend/.env.local` and must run from that
directory; without `--prod` it targets the local dev deployment rather than the hosted one; and
`convex run` invokes with NO identity, so `requireScope` throws `UNAUTHENTICATED` long before
`requireOwner` is reached.

## Operational notes

- **Sign-in credentials and MAILBOX credentials are different pairs** (ADR-018).
  `AUTH_GOOGLE_ID`/`_SECRET` are Convex Auth's; `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` are the Gmail
  grant's. Setting one and expecting the other to work is the easy mistake.
- **`AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET` are `feature`, not `required`**, because `/signup` hides
  the Microsoft button while they are unset (`invites.authProviders`). Absence is honest rather
  than broken. They also need an Azure app registration whose redirect URI is
  `${CONVEX_SITE_URL}/api/auth/callback/microsoft-entra-id`.
- **`UNSUBSCRIBE_SECRET` is the sharpest required name.** Absent, the CAN-SPAM footer cannot be
  built and EVERY send fails closed — by design.
- **`NEXT_PUBLIC_CONVEX_URL` and the Vercel-side names are deliberately NOT in this manifest.**
  They are web-build variables validated by `deploy-production.yml`, which is the right place.
  The dead-entry check caught `NEXT_PUBLIC_CONVEX_URL` being listed here and it was removed.

## Known gaps & deferred work

1. **Task 2 (the durable-domain ADR) is NOT written, and the plan's framing is stale.** 25-10 poses
   an A/B decision where Branch B is "no user-shareable URL ships". The 25-00 baseline found that
   decision **already made and shipped**: `docs/decisions/020-production-opened-without-an-admission-gate.md`
   is Accepted and records `https://www.pikar-ai.com` live with the full platform.
   **Branch B is not "decline to ship" — it is "take down a live promoted deployment."** The ADR
   should RATIFY or SUPERSEDE ADR-020, not re-litigate it.
   **Also: the plan's `docs/decisions/017-…` filename COLLIDES** — 017 is
   `017-direct-wan-visuals-openai-audio.md`, Accepted. ADRs are immutable (CLAUDE.md §9), so two
   files numbered 017 is permanent. **The next free number is 022.**
2. **Task 3 (origin enforcement) is NOT wired.** `isDurableOrigin()` exists and is tested, but
   nothing calls it yet. When it is wired, note that the plan's demand for durable **custom**
   origins is wrong: the Convex HTTP-action origin is `*.convex.site`, fixed by Convex domain
   configuration and never set by this repo. Durable is the requirement; custom is not, and a
   literal reading forces Branch B over a non-problem. Scope enforcement to what the repo controls
   — `SITE_URL`, `MEDIA_RENDER_URL`, the two OAuth redirect URIs — plus a read-only assertion that
   `CONVEX_SITE_URL` is non-empty https.
3. **This manifest covers the CONVEX deployment only.** The web build's variables are the
   pipeline's business and are not visible to `envCheck`.
