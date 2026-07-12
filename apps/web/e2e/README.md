# apps/web E2E (Playwright)

The repo's **first UI E2E harness** (added in plan 03.1-02). Config lives in
`../playwright.config.ts` (testDir `./e2e`, one `chromium` project, baseURL
`http://127.0.0.1:3111`).

## Running

```bash
pnpm --filter @pikar/web test:e2e   # or, from repo root: pnpm test:e2e
```

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

No feature specs yet. They land in later cockpit plans:

- **Plan 05** — cockpit-render / cockpit-split (SC1)
- **Plan 09** — cockpit-report / connect-gmail (SC5)
