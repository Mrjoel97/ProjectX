# Playbook: CI gate (typecheck / lint / test / build)

> Last verified: 2026-08-16 (25-01 — **`biome.json` `overrides[].includes` gained a SECOND entry,
> `packages/backend/convex/invites.ts`**, and that exposed a trap worth naming here because it fails
> in CI and nowhere else.)
>
> **TWO INDEPENDENT ALLOWLISTS GUARD THE RAW-BUILDER RULE (CLAUDE.md §2), AND THEY DO NOT KNOW
> ABOUT EACH OTHER.** `RAW_BUILDER_ALLOWLIST` (`packages/backend/convex/lib/allowlist.ts`) exempts
> a module from the *runtime* scan in `importGuard.test.ts`. Biome's `style/noRestrictedImports` is
> exempted by the *separate* `overrides[].includes` array in `biome.json`, which until 25-01
> contained exactly one path. **A module added to the first list only will pass `pnpm test` and then
> fail `biome ci --diagnostic-level=error` — and because `deploy-production.yml` is `workflow_run`-
> gated on a green CI run, a lint-red merge silently means production is never redeployed.** This
> was hit for real while writing `invites.ts`.
>
> Guarded now: `importGuard.test.ts` reads `biome.json` and asserts that every module actually
> importing a raw lowercase `query`/`mutation` appears in BOTH places. It also asserts the config
> was read at all, so the check cannot pass vacuously if the glob ever stops resolving.
>
> **Unrelated local-noise reminder, re-measured today: `biome ci` over the repo reports 46 red
> files that CI does not see.** They are CRLF-vs-LF formatting differences on files nobody touched
> (the working tree is CRLF; CI checks out LF). When triaging a red lint locally, filter to the
> files your change actually touched before believing any of it — that noise has hidden real errors
> in this repo before.
>
> Prior entry — 2026-08-15 (phase 14→25 gap audit — **`biome.json` `files.includes` gained
> `!.tmp` and `!.worktrees`**, and `.gitignore` gained `.tmp/`. MEASURED, not diff-reviewed.)
>
> **The local lint gate was hard-broken and this is what fixed it.** `pnpm lint` did not report
> lint results at all — it aborted before checking anything with *"Found a nested root
> configuration, but there's already a root configuration"*. The cause was six stray `biome.json`
> files inside scratch checkouts: `.tmp/media-release`, `.tmp/media-release-origin`, and four
> `.worktrees/*` directories. Biome treats a nested root config as a fatal configuration error, so
> **one leftover worktree anywhere under the repo root disables the entire local lint gate.**
> `.worktrees/` was already git-ignored but biome does not infer its include set from
> `.gitignore` alone for this check, and `.tmp/` was not ignored by either.
>
> **Why this is a config fix and not a cleanup.** Five stray worktrees were also deregistered in
> the same pass, which would have cleared the error on its own — but this repo spawns worktrees
> continuously (eight existed at audit time), so the next one silently re-breaks the gate. The
> exclusion is the durable fix; the pruning is not.
>
> **What was actually observed at `8b40e54`:**
> - `pnpm typecheck` — **10/10 tasks GREEN**, 2m31s. The two historically-recorded `cash.ts`
>   errors are gone.
> - `pnpm lint` — **now runs**: 597 files checked in 8s. It reports **84 errors, 268 warnings,
>   2 infos**, spread across real source (`apps/web/.../dashboard/vault/*`, `PipelineView.tsx`,
>   `packages/vault/src/ingestEstimate.test.ts`, root and `packages/backend` `package.json`).
>   **These are pre-existing and were being MASKED by the config abort — they are not caused by
>   this change.** `biome ci` checks formatting as well as lint rules, and several of the named
>   files are under concurrent in-flight edits, so formatter drift is the likely bulk.
> - `pnpm test` and `pnpm build` — **NOT RUN this pass.** They remain unqualified here.
>
> **Consequence for `22.1-03`**, whose must-have truth is *"a quiescent current tree passes pnpm
> typecheck, pnpm lint, pnpm test and pnpm build without any remembered error baseline"*: the
> blocker moved rather than cleared. The gate is now runnable, and it is red. Note the 2026-08-12
> entry below already said *"the full repository gate is currently red in unfinished feature
> work"* — that statement is now measurable instead of inferred. **Do not treat this entry as
> evidence the gate passes.** It does not.
>
> ### Triage of the red gate, 2026-08-15 — 76 of 86 are a Windows artifact, not defects
>
> **NONE of the errors are lint-rule violations.** Biome's rule table accounts for the 268 warnings
> and 2 infos only (`noNonNullAssertion` 221, `noDescendingSpecificity` 21, `useOptionalChain` 13,
> `noUnusedImports` 6, and a tail). **Every error is the FORMATTER** — *"the following files need
> to be formatted"*.
>
> **`pnpm lint` and `pnpm gate` are STRUCTURALLY UNABLE TO PASS ON A WINDOWS CHECKOUT.** This repo
> sets `.gitattributes` `* text=auto` and the machine has `core.autocrlf=true`, so tracked files
> land in the working tree as **CRLF**. `biome.json` sets no `formatter.lineEnding`, so biome
> defaults to **`lf`** and reports every CRLF file as needing formatting. **76 of the 86 errors are
> exactly this** — same bytes, different checkout. On Linux CI the identical commits are LF and
> pass. **This is not fixable by formatting files**; formatting them on Windows and committing
> would round-trip forever. The options are `core.autocrlf=false` / `core.eol=lf` plus a working-
> tree refresh (mass re-checkout — do NOT attempt while lanes hold a dirty tree), or accepting that
> the local mirror of CI cannot be green here and qualifying `22.1-03` against CI instead.
> **`*.sh text eol=lf` is already pinned in `.gitattributes` for the sandbox shebang reason — the
> same reasoning generalises, it just was never generalised.**
>
> **The other 10 are real, and CI has not seen them yet.** They are LF files that genuinely need
> formatting, and every one is a branch-only change absent from `origin/main` — which is precisely
> why CI is green (run `31883067840`, main, success) while local is red. **CI will go red on these
> when this branch merges.** They are: `packages/core/src/proposal.ts` (new on branch),
> `storyboard.ts` + `storyboard.test.ts` (differ from main), `docs/playbooks/watch.json`,
> root and `packages/backend` `package.json`, two `scripts/eval-cases/*.json`, and two
> `output/**/oracle.json` (untracked evidence, not a CI concern).
>
> **Mixed line endings inside single files is the sharper form of the same bug.** Root
> `package.json` is LF throughout except ONE CRLF line — biome's diff shows the bare `␍` on the
> `"gate:lint"` entry. `file(1)` reports such a file as LF because it reports the majority, so a
> file-type check will mis-sort it; only byte-level tooling sees it. **A Windows editor appending
> one line to an LF file is enough to redden the gate.**
>
> **NOT FIXED IN THIS PASS, deliberately.** `package.json` gained `"gate:lint"` from a concurrent
> lane *during* this session, and `proposal.ts` / `storyboard.ts` are under active edit by the
> 21-02 and 20.2 lanes. Formatting files another lane is holding is a collision, not a fix.

> Last verified: 2026-08-15 (origin/main merged into feature/cash-business-finance for the
> production release: package.json gained main's `pnpm gate` script (bc9c4f1), which mirrors this
> playbook's CI sequence as one local command. No gate semantics changed on this branch.)
>
> Last verified: 2026-08-12 (isolated Vercel project packaging — `.vercelignore` now limits direct
> deploy uploads to application/workspace sources and excludes local caches, evidence, environment
> files, and credentials. Repository-only directory patterns are root-anchored so the root `Skills`
> directory cannot accidentally exclude application `src/skills` modules on case-insensitive hosts.)

> Last verified: 2026-08-12 (hosted release compatibility — the deployment job uses Node 24 to
> match Vercel's supported production runtime. Convex deploy skips its package-local tsc lookup
> because the exact SHA has already passed the repository-wide TypeScript gate before this job.)

> Last verified: 2026-08-12 (production release automation — `ci` now uses least-privilege read
> permissions and a bounded timeout; a separate `deploy-production` workflow consumes only a
> successful same-repository `main` CI SHA, stages Vercel without moving domains, dry-runs and
> deploys Convex, requires committed generated types, seeds/read-backs the skill registry, then
> promotes and probes the durable URL. The workflow is protected by GitHub's `production`
> environment and serialized concurrency. Workflow YAML and embedded shell syntax were validated;
> the full repository gate is currently red in unfinished feature work and therefore correctly
> prevents this workflow from releasing. `CONVEX_DEPLOY_KEY` remains GitHub-only; Vercel receives
> only the public Convex client URL plus web-runtime secrets that its own routes require.)
>
> PREVIOUS:
>
> Last verified: 2026-08-07 (turbo env surface — **`globalPassThroughEnv` now carries
> `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS`.** DIFF-REVIEWED ONLY: the four gate commands were
> NOT re-run in this pass, so 2026-08-04 remains the last date they were observed to exit 0. The
> change does not touch `ci.yml`, the scripts CI calls, or the task graph.)
> PREVIOUSLY (gate actually executed): 2026-08-04 (`pnpm typecheck`, `pnpm lint`, `pnpm test`, and
> `pnpm build` all exit 0) · 2026-08-01 against cc05d21
> Build history: `.planning/phases/22.1-beta-admission-readiness-legal-deployment-ci-typechecking-and-identity-boundary-hardening/` · Related ADRs: none

## Purpose

Everything this repo claims about its own health — "typecheck at the exact 150 baseline", "backend
865/866" — was, until Phase 22.1-03, a number a human re-established by hand and compared by eye.
This gate moves that burden onto the machine. Every push to `main` and every pull request installs
the workspace and runs typecheck, lint, unit tests and the production build. Convex's generated
application API types are committed, so a clean checkout can verify the code without credentials
for a live deployment. Red blocks. Nobody has to remember to run anything.

## Key files

- `.github/workflows/ci.yml` — the gate itself; the only workflow that verifies the codebase.
- `.github/workflows/deploy-production.yml` — the protected promotion pipeline. It consumes the
  exact SHA verified by `ci`, stages Vercel first, deploys/seeds Convex, and only then promotes the
  web artifact to durable production domains.
- `.github/workflows/skillopt.yml` — unrelated; the dormant skill optimizer (IMPR-02). Do not
  merge the two: it is schedule/dispatch-driven and gated on a kill switch.
- The retired `.github/workflows/fal-catalog.yml` monitored the former fal integration; Alibaba Wan
  and OpenAI pricing is now pinned in `packages/cost/src/media.fixtures.json`.
- `package.json` — `typecheck` / `lint` / `format` / `test` / `build` scripts. **CI runs these
  exact scripts**, so `pnpm lint` locally and `pnpm lint` in CI cannot disagree.
- `turbo.json` — task graph; `typecheck` and `test` both `dependsOn: ["^build"]`.
- `biome.json` — formatter + linter + the CLAUDE.md §2 raw-`query`/`mutation`/`action` import ban.
- `tsconfig.base.json` — shared `compilerOptions` every package extends. **Changing this re-types
  every package at once**; see "How to change safely".

## Dependencies & blast radius

Couplings that are not visible in the graph:

- **`packages/backend/convex/_generated/`** — the five application API/DataModel files are committed.
  Convex's generated AI guidance directory remains ignored. When a Convex function or schema change
  alters these files, regenerate them locally and commit the resulting diff with the source change.
- **`NEXT_PUBLIC_CONVEX_URL`** (repository *variable*) — consumed by the deployed client when set and
  declared in `turbo.json`'s `globalEnv`. The current production build succeeds without it, so an
  unset variable does not prevent pull requests or forks from verifying the repository.
- **`CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS`** — declared in `turbo.json`'s
  `globalPassThroughEnv`. Turbo filters the environment it hands to a task, so an env var set in the
  shell does NOT reach a turbo-run task unless it is declared. The repo's local sqlite backend is
  ~464 MB and exceeds Convex's 30 s default startup timeout, which is why `=180` appears in the
  local-dev instructions (`docs/superpowers/plans/2026-08-02-connections-tab.md`, `22-03-SUMMARY.md`,
  `15.3-01-SUMMARY.md`); the declaration is what makes that documented workaround actually take
  effect through `pnpm dev`. It is `globalPassThroughEnv`, **not `globalEnv`, on purpose**: a startup
  timeout changes no task output, so it must not enter the cache fingerprint and invalidate every
  cached task when a developer changes it. **It is not a CI concern** — nothing in `ci.yml` sets it
  and the gate contacts no Convex backend; do not add it to the workflow to "make CI match".
- **No live Convex deployment is contacted by this gate.** Deployment credentials and availability
  must not decide whether typecheck, lint, unit tests, or the web production build can run.

## Data flow

1. `push` to `main` or any `pull_request` triggers `verify`. `concurrency` cancels a superseded run
   for the same ref.
2. `corepack enable` — pins pnpm from `packageManager` *before* `setup-node`, so `cache: pnpm` can
   find the binary.
3. `pnpm install --frozen-lockfile` — a drifted lockfile fails here, deliberately.
4. `pnpm typecheck` → `turbo run typecheck` → `tsc --noEmit` per package.
5. `pnpm lint` → `biome ci .` — formatter, `organizeImports` and linter, no writes.
6. `pnpm test` → `turbo run test` → `vitest run` per package.
7. `pnpm build` → `turbo run build` → `next build`.

## Invariants — what must never break

- **Generated Convex application types stay committed.** Enforced by the `.gitignore` exceptions
  for the five application files. Never restore a CI codegen step that requires deployment secrets,
  and never exclude `convex/**` from typecheck to hide missing generated types.
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
| `pnpm typecheck` | every package's `tsc --noEmit` is clean, including the committed Convex generated types. |
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
- If a Convex API/schema change makes generated types stale, regenerate them in a configured local
  development environment and commit all five application files with the source change.

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

## Retired: `fal-catalog.yml` (plan 20-19, 2026-08-02)

> Retired 2026-08-13 with the fal provider migration. The section below is historical evidence,
> not an active command or workflow.

The repo's second workflow, and the first one written **after** the `skillopt.yml` lesson above —
which is why it carries no `|| true`, no `continue-on-error` and no `if: always()`, and why a grep
asserting their absence is part of its plan's verification.

**It is NOT a merge gate.** It runs on `schedule` + `workflow_dispatch`, never on `pull_request`: a
vendor price change is a task for a human, not a reason to block someone's unrelated PR. Red here
means *go look*, not *you broke the build*.

It needs **no secrets** — fal's catalog endpoint is unauthenticated — so unlike `ci.yml` it cannot
fail for want of a `CONVEX_DEPLOY_KEY`.

| Exit | Meaning | What the operator does |
|---|---|---|
| `0` | AGREE — every pinned id live, public, priced as the fixture records | nothing |
| `1` | DRIFT — a price string changed, a flag flipped, or a pinned id vanished | the printed diff IS the patch: update `packages/cost/src/media.ts` **and** `media.fixtures.json` together, re-run |
| `2` | UNREACHABLE — the catalog could not be read | **not a price verdict.** Re-run. Never treat as green |

The three-way split is the point. A monitor that reports green when it could not reach the thing it
monitors manufactures confidence — the same defect as `skillopt.yml`, arrived at by a different
route. All three outcomes were observed on 2026-08-02 before the workflow was trusted; the
observations are recorded in `docs/playbooks/media.md § Reconciliation`.

Run it by hand any time: `cd packages/backend && pnpm check:fal-catalog`.

## Known gaps & deferred work

- **Deployment is not automated.** The gate proves the artifact *builds*; it does not deploy.
  Vercel deployment, the custom-domain decision and the deploy pipeline belong to Phase 25.
- **`convex deploy` and `convex codegen` are not run in CI.** Pushing functions from CI would need a
  separate environment-gated job and is out of scope for the gate.
- **No caching of turbo's task outputs across runs** — every run is cold. Acceptable at this repo
  size; revisit if the job crosses ~10 minutes.
- **The e2e suite has no gate at all.** It needs a live seeded deployment; wiring it is Phase 25's
  problem alongside the deploy pipeline.
- **`skillopt.yml`'s swallowed-failure gates are NOT fixed.** Diagnosed above, left alone
  deliberately: `.github/workflows/skillopt.yml` is `skill-registry.md`'s watched path and belongs to
  a different subsystem. Fix it there, not here.
- **A local pass is not the merge verdict.** The four gate commands were verified locally on
  2026-08-04, but every pushed change still requires its own successful GitHub Actions run before
  the gate can be called green for that commit.
