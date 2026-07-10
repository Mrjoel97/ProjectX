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

> **Codegen ordering (important).** `convex/_generated/` is produced by Convex codegen and
> is **git-ignored** — it does not exist in a fresh clone. `pnpm typecheck` (and any import of
> `./_generated/*`) **fails until step 2 has run at least once**. Always run `npx convex dev`
> before typechecking a fresh clone.

Scripted gate (after step 2 has configured a deployment):

```bash
pnpm boot:check          # pnpm install -> npx convex codegen -> pnpm typecheck
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
| `pnpm dev`         | Run web + Convex dev together (turbo)               |
| `pnpm typecheck`   | Typecheck every package                             |
| `pnpm test`        | Run tests (convex-test via vitest, no watch mode)   |
| `pnpm boot:check`  | Clean-boot gate: install -> codegen -> typecheck    |

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
