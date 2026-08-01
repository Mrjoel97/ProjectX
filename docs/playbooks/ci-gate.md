# Playbook: CI gate (typecheck / lint / test / build)

> Last verified: 2026-08-01 against cc05d21
> Build history: `.planning/phases/22.1-beta-admission-readiness-legal-deployment-ci-typechecking-and-identity-boundary-hardening/` · Related ADRs: none

## Purpose

Everything this repo claims about its own health — "typecheck at the exact 150 baseline", "backend
865/866" — was, until Phase 22.1-03, a number a human re-established by hand and compared by eye.
This gate moves that burden onto the machine. Every push to `main` and every pull request installs
the workspace, regenerates the Convex types, and runs typecheck, lint, unit tests and the production
build. Red blocks. Nobody has to remember to run anything.

## Key files

- `.github/workflows/ci.yml` — the gate itself; the only workflow that verifies the codebase.
- `.github/workflows/skillopt.yml` — unrelated; the dormant skill optimizer (IMPR-02). Do not
  merge the two: it is schedule/dispatch-driven and gated on a kill switch.
- `package.json` — `typecheck` / `lint` / `format` / `test` / `build` scripts. **CI runs these
  exact scripts**, so `pnpm lint` locally and `pnpm lint` in CI cannot disagree.
- `turbo.json` — task graph; `typecheck` and `test` both `dependsOn: ["^build"]`.
- `biome.json` — formatter + linter + the CLAUDE.md §2 raw-`query`/`mutation`/`action` import ban.
- `tsconfig.base.json` — shared `compilerOptions` every package extends. **Changing this re-types
  every package at once**; see "How to change safely".

## Dependencies & blast radius

Couplings that are not visible in the graph:

- **`CONVEX_DEPLOY_KEY`** (repository *secret*) — without it `convex codegen` cannot resolve the
  deployment and every subsequent step fails with
  `✖ No CONVEX_DEPLOYMENT set, run 'npx convex dev' to configure a Convex project`.
  **Verified ABSENT 2026-08-01** on the gate's first run (30702168095): `skillopt.yml` declares the
  same secret but it has never been set. Set it with
  `gh secret set CONVEX_DEPLOY_KEY` (value from the Convex dashboard → Settings → Deploy keys —
  a deploy key, NOT the `CONVEX_DEPLOYMENT` string in `packages/backend/.env.local`).
- **`NEXT_PUBLIC_CONVEX_URL`** (repository *variable*) — consumed by `next build` and declared in
  `turbo.json`'s `globalEnv`. Also verified absent; `gh variable set NEXT_PUBLIC_CONVEX_URL`
  (value = `CONVEX_URL` from `packages/backend/.env.local`).
- **`convex/_generated/`** is gitignored (`.gitignore:11`, CLAUDE.md §7). It does not exist in a
  fresh checkout and must be generated inside the job.
- **The Convex deployment is a live dependency of CI.** `convex codegen` prints
  `Downloading current deployment state... Uploading functions to Convex` even with the deployment
  env stripped — it reads `packages/backend/.env.local` locally, and `CONVEX_DEPLOY_KEY` in CI. A
  deployment outage therefore reads as a CI failure. This is precedent, not new exposure:
  `skillopt.yml` already drives `convex run` against the same deployment.

## Data flow

1. `push` to `main` or any `pull_request` triggers `verify`. `concurrency` cancels a superseded run
   for the same ref.
2. `corepack enable` — pins pnpm from `packageManager` *before* `setup-node`, so `cache: pnpm` can
   find the binary.
3. `pnpm install --frozen-lockfile` — a drifted lockfile fails here, deliberately.
4. `convex codegen --typecheck disable` in `packages/backend` — writes `convex/_generated/`.
   `--typecheck disable` because codegen's own bundled `tsc` would run a second, differently
   configured check and mask which step really failed.
5. `pnpm typecheck` → `turbo run typecheck` → `tsc --noEmit` per package.
6. `pnpm lint` → `biome ci .` — formatter, `organizeImports` and linter, no writes.
7. `pnpm test` → `turbo run test` → `vitest run` per package.
8. `pnpm build` → `turbo run build` → `next build`.

## Invariants — what must never break

- **Codegen precedes typecheck.** Enforced by step order in `ci.yml`. Without it every Convex
  import fails. That failure is loud, not silent — but the tempting fix is to exclude `convex/**`
  from typecheck, and *that* is silent. Never do it.
- **The typecheck baseline is ZERO.** Any nonzero count is a regression to fix, not a number to
  update in a summary. Historically the backend carried 150 test-file errors; 100 were a single
  dead `@ts-expect-error` and 50 were `noUncheckedIndexedAccess` fallout. Enforced by CI exit code.
- **Test files stay inside the typecheck.** Dropping `convex/**/*.test.ts` from
  `packages/backend/tsconfig.json`'s `include` takes the count to zero in one line and is banned:
  a test that does not typecheck can silently assert nothing. **Not enforced by anything but this
  line** — a reviewer has to catch it.
- **`biome ci` runs without `--error-on-warnings`.** 134 `noNonNullAssertion` warnings exist by
  design; making them blocking would create pressure to weaken the rule set. Enforced in `ci.yml`.
- **CI runs the same scripts a developer runs.** No inlined `npx biome ...` in the workflow that
  could drift from `package.json`. Enforced by `ci.yml` calling `pnpm <script>` only.
- **Playwright stays out.** `apps/web`'s `test:e2e` needs a live deployment and a seeded tenant; it
  is not part of this gate. Enforced by `turbo run test` matching only the `test` script.

## How to change safely

- **Adding a check** — add the script to `package.json` first, run it locally, then add a step to
  `ci.yml` that calls the script. Never inline the command in the workflow.
- **Changing `tsconfig.base.json`** — this is the highest-blast-radius change in the repo and an
  owner call taken BETWEEN lanes (`.planning/PARALLELIZATION.md:12-17`: lanes share ONE working
  tree). It conflicts with nothing textually and re-types everything semantically, so a lane that
  was green can go red without editing a line, and the failure surfaces in the *other* lane's build.
  Quiesce first, then re-run the full gate.
- **Changing `biome.json`** — run `pnpm lint` before committing. Rule additions will surface across
  files no one is working on; either fix them in the same commit or do not add the rule.
- **Bumping a pinned Convex component** — CLAUDE.md §6. The gate does not exempt you from the boot
  check.

## How to verify

| Command | Proves |
|---|---|
| `pnpm typecheck` | every package's `tsc --noEmit` is clean. Requires `convex/_generated/` locally (`npx convex dev` once). |
| `pnpm lint` | `biome ci .` — format, imports, lint rules. Exit 0 required. |
| `pnpm format` | rewrites files to satisfy the formatter. **Never in the same commit as a semantic change.** |
| `pnpm test` | vitest across all packages. |
| `pnpm build` | `next build` produces the deployable artifact. |
| `node scripts/boot-check.mjs` | fresh-clone boot order (CLAUDE.md §7) — separate concern, not in the gate. |

**Anti-vacuous check.** A gate nobody has watched fail is not a gate. To re-prove it, push a scratch
branch carrying (a) a deliberate type error, (b) a deliberate format violation, (c) a broken test
assertion, and confirm CI goes red on each for the expected reason.

## Operational notes

- Runner is `ubuntu-latest`; local development is Windows. Path-case bugs surface in CI first —
  `forceConsistentCasingInFileNames` is on in `tsconfig.base.json`, which catches most of them.
- `convex codegen` is invoked as `node node_modules/convex/bin/main.js` rather than via `npx`,
  matching `skillopt.yml`.
- If CI fails only at the codegen step, check the deployment is up before suspecting the code.

## `skillopt.yml` has been passing vacuously — do not copy its pattern

Found by this gate's first run and worth its own section, because it is the exact failure mode the
gate exists to eliminate.

`skillopt.yml`'s kill-switch step runs
`OUT=$(node node_modules/convex/bin/main.js run optimizerConfig:getOptimizerConfig '{}' 2>/dev/null || true)`
and then decides on `ENABLED=$(printf '%s' "$OUT" | jq -r '.enabled // false')`. With
`CONVEX_DEPLOY_KEY` unset the `convex run` fails, `2>/dev/null || true` swallows both the message and
the exit code, `$OUT` is empty, and `jq` on empty yields nothing — so the step logs
`optimizer dormant (enabled=) — skipping` and the workflow reports **success**. Verified in run
30247905384 (2026-07-27): the logged value is `enabled=` — empty, not `false`.

It has therefore never distinguished *"the optimizer is switched off"* from *"the call did not
happen"*, and it would report the same green if the optimizer were armed. Two consequences:

- The green checkmark on `skillopt` is not evidence of anything. Do not cite it.
- **`|| true` on a gate query converts a failure into a pass.** If a step's output decides whether
  later steps run, that step must fail loudly. Fix (not yet applied — see gaps): drop `|| true`,
  or branch on the empty case explicitly and exit non-zero.

## Known gaps & deferred work

- **Deployment is not automated.** The gate proves the artifact *builds*; it does not deploy.
  Vercel deployment, the custom-domain decision and the deploy pipeline belong to Phase 25.
- **`convex deploy` is not run in CI.** Only `codegen`. Pushing functions from CI would need a
  separate environment-gated job and is out of scope for the gate.
- **No caching of turbo's task outputs across runs** — every run is cold. Acceptable at this repo
  size; revisit if the job crosses ~10 minutes.
- **The e2e suite has no gate at all.** It needs a live seeded deployment; wiring it is Phase 25's
  problem alongside the deploy pipeline.
- **`skillopt.yml`'s swallowed-failure gates are NOT fixed.** Diagnosed above, left alone
  deliberately: `.github/workflows/skillopt.yml` is `skill-registry.md`'s watched path and belongs to
  a different subsystem. Fix it there, not here.
- **The gate has not yet been proven green.** As of 2026-08-01 it fails at the codegen step for want
  of `CONVEX_DEPLOY_KEY`, and the typecheck/lint debt behind that (150 backend type errors, 323 biome
  errors, one red `onboarding.test.ts §4.2`) is Tasks 2-7 of `22.1-03-PLAN.md`, blocked on a
  quiescent tree. Until a run goes green end to end, the steps after codegen are unproven.
