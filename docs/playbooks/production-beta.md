# Playbook: Production Beta Readiness (25-10)

> Last verified: 2026-08-18 (17-08 Task 2 added ONE `feature`-tier manifest name,
> `PHASE17_GRAPH_PROBE` — the Graph concurrency-probe artifact as JSON. **Unset is the normal,
> healthy state**: Microsoft calendar UPDATE simply refuses with `provider_unsupported`, and nothing
> else changes. Setting it does not enable anything by itself either — the deployment and tenant
> hashes inside the artifact must match the ones recomputed at call time, so a probe measured on
> another deployment or against another account binds to nothing. Microsoft calendar DELETE is
> unaffected in every case; it is forbidden outright, not gated (ADR-023). No `required`-tier name
> was added, so the readiness surface is unchanged for a healthy deployment.)
>
> Last verified: 2026-08-17 (25-10 Tasks 1 **and 3** — the environment manifest, the drift scan, the
> owner readiness surface, and durable-origin enforcement. **Task 2's ADR-022 was ACCEPTED by the
> owner on 2026-08-17; Gate 2 is closed.**)
>
> **ADR-022 is the durable-domain posture, and it is numbered 022 because 017 COLLIDES** with the
> Accepted `017-direct-wan-visuals-openai-audio.md`; ADRs are immutable (§9). It also drops the
> plan's "custom" requirement: `*.convex.site` is durable but not custom, and a literal reading
> would have blocked the phase on a hostname property nothing consumes.
>
> **What Task 3 enforces, and the failure it exists for:** `envCheck` now also returns
> `nonDurableOrigins`, and `ready` requires it to be empty. A **set but ephemeral** origin is
> invisible to every other check — the name is present, so `missingRequired` is empty and the
> screen reads green, while the unsubscribe link in an already-sent email points at a preview build
> that stopped resolving on the next push. `ORIGIN_ENV` covers `CONVEX_SITE_URL`, `SITE_URL` and
> both OAuth redirect URIs. An UNSET origin is reported as missing and NOT as non-durable — one
> fault, one message.
>
> **This widened `ready`, and it caught a stale test doing so:** the existing "ready turns on
> REQUIRED only" case stubbed every required name to the literal `"set"`, which is not a URL, so
> `ready` correctly went false. The test's premise had changed and it was updated rather than
> worked around.
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
4. **`ready` turns on REQUIRED names AND durable origins — never on features.** A dark feature is a
   product decision; a missing required name, or an origin that will stop resolving, is a broken
   deployment. Collapsing features in with those makes the screen unactionable.
5. **A SET but EPHEMERAL origin must fail.** This is the one fault no other check can see: the name
   is present, so `missingRequired` is empty and everything reads green, while the unsubscribe link
   in an already-sent email points at a preview build that died on the next push. An UNSET origin
   is reported as missing and NOT as non-durable — one fault, one message.
6. **An ACTIVE fixture seam is reported as a warning.** `FAL_FIXTURE`, `MEDIA_*_FIXTURE` and the
   Graph-probe flag FAKE real providers — a failure that looks like success, which is the worst
   kind to leave undetectable in production.
7. **The manifest is drift-checked in BOTH directions.** `env.test.ts` scans source for
   `process.env.NAME` and fails on a consumed-but-unclassified name AND on a classified-but-dead
   entry. A manifest maintained by remembering to update it goes stale silently, and in the
   direction that matters: a new required key nobody classified reads as "ready".
8. **The scan follows `requireEnvMedia("X")` as well as `process.env.X`** (25.1-06, D12). That
   helper is a `process.env[name]` lookup, so a literal-only scan was blind to every media name it
   reads — `MEDIA_RENDER_URL`, `WAN_API_BASE_URL` and `Video_and_image_API_Key` were unclassified
   for their whole lives. `MEDIA_RENDER_URL` is the sharp one: it is read inside the scheduled
   `renderReel` action, so unset it throws where no user is waiting and the plan sits at
   `rendering` forever while this screen reports ready. **A THIRD indirection would be invisible
   again** — add its regex in the same commit that adds the helper. The test asserts those names
   are NOT reachable as literals, so deleting the extension reds instead of quietly narrowing the
   guard.

## How to verify

| Command | Proves |
| --- | --- |
| `pnpm --filter @pikar/backend exec vitest run convex/env.test.ts` | The manifest matches source, reports names only, and `envCheck` refuses a non-owner, and no origin is ephemeral. 19 tests. |
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
- **`MEDIA_SANDBOX_SNAPSHOT_ID` is the same class and is deliberately NOT here either** (25.1-06
  re-checked it: the only reader in the repo is `apps/web/app/api/media/render/route.ts`, a Vercel
  variable no Convex process can see). Listing it would make `envCheck` report a name missing on
  every healthy deployment — a readiness screen that cries wolf is worse than one blind spot.
  `deploy-production.yml` already asserts it alongside `NEXT_PUBLIC_CONVEX_URL` and
  `MEDIA_RENDER_SECRET`, and that check is the coverage. **Its absence bites in a different
  place**: unset, the render route returns `not_configured`, which is not in
  `TRANSIENT_RENDER_CODES` and so goes straight to a dead letter — visible on `/ops` (see
  `docs/playbooks/audit-dead-letter.md`), not here.

## Known gaps & deferred work

1. **Task 2 shipped as ADR-022, ACCEPTED by the owner 2026-08-17 — this gap is CLOSED.** The plan's framing is stale and the ADR says why: 25-10 poses
   an A/B decision where Branch B is "no user-shareable URL ships". The 25-00 baseline found that
   decision **already made and shipped**: `docs/decisions/020-production-opened-without-an-admission-gate.md`
   is Accepted and records `https://www.pikar-ai.com` live with the full platform.
   **Branch B is not "decline to ship" — it is "take down a live promoted deployment."** The ADR
   should RATIFY or SUPERSEDE ADR-020, not re-litigate it.
   **Also: the plan's `docs/decisions/017-…` filename COLLIDES** — 017 is
   `017-direct-wan-visuals-openai-audio.md`, Accepted. ADRs are immutable (CLAUDE.md §9), so two
   files numbered 017 is permanent. **The next free number is 022.**
2. **Task 3 IS WIRED** — `ops.envCheck` returns `nonDurableOrigins`, `ready` requires it empty, and
   `/admin` names any offender. **It deliberately does NOT implement the plan's "custom" wording:**
   the Convex HTTP-action origin is `*.convex.site`, fixed by Convex domain configuration and never
   set by this repo, so requiring custom would block the phase on a property nothing consumes.
   Enforcement is scoped to what the repo controls — `SITE_URL` and the two OAuth redirect URIs —
   plus a read-only assertion that `CONVEX_SITE_URL` is a non-empty https origin. **It cannot
   validate DNS, TLS chains, or that a provider's registered redirect actually matches**; those are
   observed at the live gates (25-11/25-12).
3. **This manifest covers the CONVEX deployment only.** The web build's variables are the
   pipeline's business and are not visible to `envCheck`.
