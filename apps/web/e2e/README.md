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

## Specs

- **Plan 05** (SC1) — `cockpit-render` (two panes render under the auth gate) +
  `cockpit-split` (divider drags, clamps ≥20%, keyboard-nudges, persists across reload).
- **Plan 09** — cockpit-report / connect-gmail (SC5) — pending.
