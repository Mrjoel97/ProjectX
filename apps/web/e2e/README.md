# apps/web E2E (Playwright)

The repo's **first UI E2E harness** (added in plan 03.1-02). Config lives in
`../playwright.config.ts` (testDir `./e2e`, one `chromium` project, baseURL
`http://127.0.0.1:3111`).

## Running

```bash
pnpm --filter @pikar/web test:e2e   # or, from repo root: pnpm test:e2e
```

## Auth (storageState)

Cockpit pages live behind the `(app)` auth gate, so specs run signed-in. The `setup`
project (`auth.setup.ts`) signs in ONCE via the real `/signin` password form and saves the
session to `e2e/.auth/user.json` (git-ignored — it holds a live token); the `chromium`
project reuses it via `storageState`.

Set the credentials of a **seeded test user** that exists in the live local Convex
deployment:

```bash
export E2E_USER_EMAIL="e2e@pikar.test"
export E2E_USER_PASSWORD="…"
```

The setup throws with a clear message if these are unset. To seed the user, sign up once at
`/signup` (or via a Convex mutation) against the running deployment.

## Prerequisite: the local dev backend must be running

Specs drive the **offline `SMOKE::` delivery path**, which needs the live local
backend. Before running specs, both must be up (per STATE.md):

- `convex dev` (NOT `--once` — `--once` pushes then stops the workpool, so async
  `onComplete`/scheduler steps never advance)
- `next dev` (serving on :3111)

Playwright does **not** auto-start them: `playwright.config.ts` uses
`reuseExistingServer` semantics (no `webServer` block), mirroring the
`scripts/smokeRun.mjs` live-deployment convention. A blank page at :3111 or a
"local backend isn't running" error means the process died, not that a spec broke.

## `convex run` ENDS THE BROWSER SESSION on a local deployment (measured 2026-08-14)

A spec that stages fixtures through `npx convex run` against the **local (anonymous)** backend on
`:3210` signs the browser out. Measured, not inferred: a context restored from `storageState`
reaches `/dashboard`, one `convex run` lands (CLI exit 0), and the very next navigation is
`/signin`. The saved `storageState` is dead from that moment, and so is any session the `setup`
project just minted.

So a spec that needs internal-mutation fixtures must **stage first and authenticate after** —
`media-canvas.spec.ts` signs in once to learn its tenant id (the JWT subject, which is what
`requireTenant` uses), stages, then signs in again. Its `signIn()` helper carries the note. Specs
that only read public data are unaffected.

## Provisioning an owner (27-11)

The pack candidate preview is owner-only, so the browser evidence plane needs a signed-in OWNER —
and `auth.setup.ts` only signs an EXISTING user in. `provision-owner.setup.ts` creates one:



It seeds an invite, signs up through the real form, grants owner by id, and seeds the onboarding
profile. Idempotent: it checks for the account FIRST, because the first successful signup redeems
the invite and a second attempt leaves Create Account disabled forever.

**Do not reuse `e2e@pikar.test` for this.** It pre-exists with a password nobody has, so the signup
silently no-ops, the owner grant lands on the old row, and sign-in then fails "Wrong email or
password" while every step looks like it worked.

## The onboarding gate

A tenant with no committed business profile is force-redirected to `/dashboard/onboarding` by the
`(app)` layout and cannot reach any other route. `onboarding:__seedOnboardedTenant` is the
sanctioned way past it: idempotent, offline, no credits.

## Specs

- **Plan 05** (SC1) — `cockpit-render` (two panes render under the auth gate) +
  `cockpit-split` (divider drags, clamps ≥20%, keyboard-nudges, persists across reload).
- **Plan 09** — cockpit-report / connect-gmail (SC5) — pending.
