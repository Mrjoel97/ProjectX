# Pikar AI

Governed agentic AI operating layer (AI chief-of-staff): voice/text intake, durable
multi-step orchestration, hybrid GraphRAG, guardrails (cost/PII/quality), human review,
and audited email delivery.

**Stack:** pnpm + Turborepo monorepo · Next.js (web) · Convex (data + orchestration plane)
with the Workflow / Agent / RAG / Rate-Limiter / Action-Retrier components · Convex Auth.

---

## Repository layout

```
pikar-ai/
├── apps/web/                 # Next.js App Router UI (ConvexProvider wired)
├── packages/
│   ├── backend/convex/       # THE Convex deployment: schema, component wiring, auth, functions
│   ├── contracts/            # Zod contract source-of-truth (source-export TS package)
│   └── core/                 # Shared pure-TS helpers: Result, createLogger (source-export)
├── sidecars/                 # Future Python containers (Presidio, graphify, SkillOpt)
└── scripts/boot-check.mjs    # install -> codegen -> typecheck gate
```

Domain logic lives in pure-TS `packages/*`; `convex/` is a thin adapter that imports them.
See `CLAUDE.md` for the full conventions.

---

## Clean-clone boot order (run verbatim)

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Create the Convex dev deployment + generate convex/_generated/
#    (first run does --configure and requires a free Convex login: `npx convex login`)
cd packages/backend
npx convex dev            # leave running; writes CONVEX_DEPLOYMENT and CONVEX_URL
                          #  to packages/backend/.env.local

# 2b. The web app needs that URL under its own name, in its own .env.local.
#     `convex dev` does NOT do this for you in a monorepo. Without it,
#     `pnpm build` fails at prerender: "No address provided to ConvexReactClient".
cd ../../apps/web
echo "NEXT_PUBLIC_CONVEX_URL=$(grep '^CONVEX_URL=' ../../packages/backend/.env.local | cut -d= -f2-)" > .env.local

# 3. In a second terminal, from the repo root, start everything
pnpm dev
```

Once per clone, opt in to the tracked git hooks (they keep `graphify-out/` current and
re-apply the graph fixup that a rebuild would otherwise drop):

```bash
git config core.hooksPath .githooks    # see .githooks/README.md for the one-line
                                       # graphify-out/.graphify_python it also needs
```

> **Codegen ordering (important).** `convex/_generated/` is produced by Convex codegen and
> is **git-ignored** — it does not exist in a fresh clone. `pnpm typecheck` (and any import of
> `./_generated/*`) **fails until step 2 has run at least once**. Always run `npx convex dev`
> before typechecking a fresh clone.

Scripted gate (after step 2 has configured a deployment):

```bash
pnpm boot:check          # pnpm install -> npx convex codegen -> pnpm typecheck
```

---

## Skill registry seed (required — the pipeline fails closed without it)

Agent prompts are versioned rows in the `skills` table, not hardcoded (CLAUDE.md §5).
Routing calls `loadSkill("executive-router")`, which **fails closed** — an unseeded
deployment dead-letters EVERY request with `NO_ACTIVE_SKILL: executive-router`.

- **Local dev:** the `dev` script runs `convex dev --run skills:seedSkills`, so `pnpm dev`
  seeds automatically after each push. Nothing to do.
- **Production / any fresh deploy:** `npx convex deploy` does **not** run functions. After it,
  seed once (idempotent — safe to re-run):

  ```bash
  pnpm --filter @pikar/backend seed      # runs skills:seedSkills + verifies executive-router is active
  ```

---

## Secrets plane

Two separate secret stores — never mix them:

- **Convex environment variables** (`npx convex env set KEY value`) hold every server-side
  secret a Convex function touches: LLM/API keys, AWS creds, OAuth **client secrets**, and
  sidecar URLs (`PRESIDIO_URL`, etc.). Set them per deployment; never commit them.
- **Vercel environment variables** hold only client-safe / deploy values:
  `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOY_KEY`. Nothing else.

`.env.local` files are git-ignored and are written by the Convex CLI — do not commit them.

---

## Sidecars

Python workloads that cannot run on Convex (no Python runtime) run as **containers on
Fly.io** (Railway is the fallback). Convex **actions** call them via `fetch`, wrapped in the
Action Retrier. Each sidecar's URL is a Convex env var (`PRESIDIO_URL`, `GRAPHIFY_URL`,
`SKILLOPT_URL`). See `sidecars/README.md`.

---

## Common commands

| Command            | What it does                                        |
| ------------------ | --------------------------------------------------- |
| `pnpm dev`         | Run web + Convex dev together (turbo); auto-seeds skills |
| `pnpm typecheck`   | Typecheck every package                             |
| `pnpm test`        | Run tests (convex-test via vitest, no watch mode)   |
| `pnpm boot:check`  | Clean-boot gate: install -> codegen -> typecheck    |
| `pnpm gate`        | Pre-push gate: typecheck + test + build, cold       |
| `pnpm gate:lint`   | Formatter/lint gate — **LF checkouts only**, see below |
| `pnpm --filter @pikar/backend seed` | Seed the agent skill registry (post-deploy) |

### `pnpm gate` — run this before you push

It runs the same work the `ci` workflow does, in the same order, so a red gate here is a red gate
there. Two details are load-bearing:

- **`--force` on every task.** Turbo caches task results, and a cached "success" from an earlier
  commit will happily report green for code CI has never compiled. CI always runs cold; so does this.
- **`--concurrency=1` on tests.** Parallel vitest workers intermittently fail to spawn on Windows,
  and the turbo test task exits non-zero after vitest itself has already reported success.

Budget ~10 minutes on Windows (typecheck ~5m20s, tests ~3m26s, build ~1m); CI does the same work in
about three, because it runs on Linux and in parallel. The gate is slower on purpose — a fast signal
you cannot trust is worth nothing.

### Why lint is a SEPARATE script, and why it lies on Windows

`gate:lint` is deliberately not part of `pnpm gate`. Biome formats to LF, and a Windows checkout is
CRLF (`.gitattributes` normalises to LF in the index, not in your working tree) — so `biome ci`
reports a whole-file diff for **every** file in the repo. Real violations are then indistinguishable
from several hundred files of line-ending noise, and the command always exits non-zero.

Folding that into `pnpm gate` would make the gate permanently red on Windows and stop it before it
ever reached the tests, so the useful three run alone.

**The consequence, stated plainly: on Windows you cannot verify lint locally.** The PR's Linux CI run
is the only authority. This is not theoretical — eight genuinely unformatted files once reached CI
after `biome ci` had been run locally and read as clean. If you are on Linux, WSL, or an LF checkout,
`pnpm gate:lint` is trustworthy and worth running. To fix what it finds: `pnpm format`.

**WSL2 workaround (optional).** If you want trustworthy local lint on Windows, clone the repo
inside WSL2 (Ubuntu). WSL checkouts are LF-native, so `pnpm gate:lint` works correctly there.
The `.editorconfig` at the repo root also enforces LF in editors that support it (VS Code, JetBrains,
Vim) — it won't fix existing checkouts but prevents new CRLF introductions.

---

## Dev tooling — build discipline & repo knowledge graph

Two mandated build-tools keep sessions budgeted (fewer tokens in and out). Both are wired for
Claude Code and reach GSD subagents; both are **per-machine** installs, so a fresh clone re-runs
the setup below.

### ponytail — minimal-code discipline

Installed as a project-scoped Claude Code plugin (enabled in `.claude/settings.json`); the
"laziest solution that works" ladder is also restated in `CLAUDE.md` §8. Re-add on a new machine:

```bash
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail --scope project
```

Review commands: `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`.

### graphify — repo knowledge graph (query before you read)

A 600+ node AST graph of the repo lives in `graphify-out/graph.json` (committed). Agents query it
(`graphify query "<question>"`, `explain`, `path`) instead of blind-reading files — see the
`## graphify` section in `CLAUDE.md`. A `post-commit` git hook keeps the graph fresh (AST-only, no
API cost); the graph is also served to Claude Code as an MCP server via `.mcp.json`.

Install on a new machine (Windows 11; set `PYTHONUTF8=1` for the session to avoid
`UnicodeEncodeError`):

```bash
uv tool install graphifyy --with mcp   # CLI `graphify` + `graphify-mcp`; --with mcp enables the MCP server
graphify update .                       # build graphify-out/graph.json (no LLM)
graphify hook install                   # post-commit / post-checkout auto-update
graphify claude install                 # CLAUDE.md section + PreToolUse hooks
```

If `graphify` doesn't resolve after install, run `uv tool update-shell` and open a new terminal
(ensure `%USERPROFILE%\.local\bin` is on PATH). The `.mcp.json` `graphify-mcp` entry resolves via
PATH — restart Claude Code after install so the MCP server connects.
