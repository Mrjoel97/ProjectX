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
npx convex dev            # leave running; writes CONVEX_DEPLOYMENT to .env.local
                          #  and NEXT_PUBLIC_CONVEX_URL to apps/web/.env.local

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
