# Technology Stack

## Repository Shape

- Pikar AI is a private ESM monorepo rooted at `package.json`, with application workspaces in
  `apps/*` and reusable packages in `packages/*` as declared by `pnpm-workspace.yaml`.
- The main product is `apps/web`, while `packages/backend` is the single Convex deployment.
- Framework-independent domain logic is source-exported directly from packages such as
  `packages/core`, `packages/contracts`, `packages/cost`, `packages/pii`, `packages/extraction`,
  `packages/vault`, and `packages/voice`; these packages generally have no compilation output.
- `packages/audit` is a small source-export package for audit event types.
- Agent prompt contracts live as Markdown plus generated TypeScript constants under
  `packages/contracts/skills` and `packages/contracts/src/skills`.

## Languages and Runtimes

- TypeScript is the primary language for frontend, backend, contracts, domain logic, and tests.
  The shared strict baseline is `tsconfig.base.json` (`ES2022`, ESM, bundler resolution,
  `noUncheckedIndexedAccess`, `noEmit`).
- TSX is used by the React UI under `apps/web/app`; application styling is plain CSS in
  `apps/web/app/globals.css` and `apps/web/app/(auth)/auth.css`, with no CSS framework dependency.
- Node.js `>=20` is required by the root `package.json`. Node powers Next.js, build/test scripts,
  `.mjs` operational utilities, and Convex files marked with `"use node"`.
- Convex queries, mutations, and most actions execute in Convex's default runtime; Node-only
  actions are isolated in files such as `packages/backend/convex/llm.ts`,
  `packages/backend/convex/gmail.ts`, `packages/backend/convex/vaultExtract.ts`, and
  `packages/backend/convex/worm.ts`.
- Python 3.11 is used by the dormant SkillOpt job in `.github/workflows/skillopt.yml` and by
  optimization code under `skillopt/envs/pikar_cockpit`; `skillopt/requirements.txt` pins
  `skillopt==0.2.0`.
- Additional standalone Python calculators live under `Skills/*/scripts`; they are skill assets,
  not part of the deployed Next.js or Convex runtime.

## Frontend Framework

- `apps/web/package.json` pins Next.js `16.2.10`, React `19.2.7`, and React DOM `19.2.7`.
- The frontend uses the Next.js App Router (`apps/web/app`) with route groups for authenticated
  application pages and sign-in/sign-up pages.
- Client components use Convex React hooks for live queries, mutations, and actions; the shared
  client is created in `apps/web/app/providers.tsx`.
- Authentication is bridged into Next.js with `@convex-dev/auth` providers in
  `apps/web/app/layout.tsx` and `apps/web/app/providers.tsx`.
- `apps/web/middleware.ts` provides route gating, while Next metadata, robots, and sitemap handlers
  live in `apps/web/app/layout.tsx`, `apps/web/app/robots.ts`, and `apps/web/app/sitemap.ts`.
- `apps/web/next.config.ts` transpiles source-export workspace packages rather than consuming
  prebuilt package artifacts.
- Google-hosted Bricolage Grotesque, JetBrains Mono, and Public Sans are loaded through
  `next/font/google` in `apps/web/app/layout.tsx`.

## Backend and Data Framework

- Convex `1.42.1` is the database, server-function, realtime subscription, scheduler, HTTP route,
  and file-storage platform; its schema is `packages/backend/convex/schema.ts`.
- Convex Auth is provided by `@convex-dev/auth@0.0.94`; configuration is split between
  `packages/backend/convex/auth.config.ts`, `packages/backend/convex/auth.ts`, and HTTP routes in
  `packages/backend/convex/http.ts`.
- The backend exports generated function references through `@pikar/backend/api`, mapped by
  `packages/backend/package.json` to `packages/backend/convex/_generated/api.js`.
- Convex components are registered centrally in `packages/backend/convex/convex.config.ts`:
  Workflow `0.4.4`, Agent `0.6.4`, RAG `0.7.5`, Rate Limiter `0.3.2`, Action Retrier `0.3.1`,
  Migrations `0.3.5`, Aggregate `0.2.2`, and Action Cache `0.3.1`.
- Durable workflows and retry defaults are instantiated once in `packages/backend/convex/index.ts`.
- Scheduled jobs are declared in `packages/backend/convex/crons.ts`.
- Convex-generated code under `packages/backend/convex/_generated` is ignored and must be recreated
  with `convex dev` or `convex codegen` before a clean-clone typecheck.

## AI, Validation, and Content Processing

- Vercel AI SDK `ai@7.0.20` plus `@ai-sdk/openai@4.0.11` drive text generation, structured output,
  transcription, provider-executed web search, and model test doubles in backend actions.
- The Convex RAG component currently brings an `ai@6` model contract; the compatibility adapter in
  `packages/backend/convex/vaultRag.ts` calls the OpenAI embeddings REST API with a v2-shaped model.
- Zod `4.4.3` defines runtime contracts in `packages/contracts/src/drafting.ts` and
  `packages/contracts/src/routing.ts`.
- `pdf-lib@1.17.1` generates PDFs and manipulates PDF inputs in backend Node actions.
- `unpdf@1.6.2` extracts PDF text, `fflate@0.8.3` reads zipped Office containers, and the vendor
  SheetJS `xlsx@0.20.3` tarball parses spreadsheets; see `packages/backend/package.json` and
  `packages/vault/package.json`.
- `@aws-sdk/client-s3` supplies the S3 Object Lock audit-export client in
  `packages/backend/convex/worm.ts`.
- Pure redaction, extraction, cost, vault-fusion, and voice-domain behavior belongs in the
  corresponding `packages/*/src` package and is imported by thin Convex adapters.

## Build and Configuration

- pnpm `10.28.1` is the pinned package manager; the lockfile format and exact dependency graph are
  recorded in `pnpm-lock.yaml`.
- Turborepo `2.10.4` coordinates `dev`, `build`, `typecheck`, and `test` from `turbo.json`.
- Root build output caching covers `.next/**` and `dist/**`; development tasks are persistent and
  uncached.
- `turbo.json` promotes `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_DEPLOYMENT` as global task environment
  inputs.
- TypeScript is intentionally split: root tooling declares `^7.0.2`, while `apps/web` pins
  `^5.9.3`; both versions are present in `pnpm-lock.yaml`.
- The required clean-clone order and deployment seeding sequence are documented in `README.md`;
  `scripts/boot-check.mjs` automates install, Convex codegen, and typecheck checks.
- `packages/backend/package.json` runs `convex dev --run skills:seedSkills`, so local backend startup
  also seeds the fail-closed prompt registry.
- There is no root Dockerfile or committed Vercel configuration; runtime deployment conventions are
  documented rather than encoded as infrastructure-as-code.

## Developer and Test Tooling

- Biome `2.5.3` supplies formatting and lint rules in `biome.json`, including a backend rule that
  bans raw public Convex function builders outside the tenant wrapper.
- Vitest `3.2.7` is used across pure packages; backend tests use `convex-test@0.0.54` and
  `@edge-runtime/vm` through `packages/backend/vitest.config.mts`.
- Playwright `1.61.1` provides browser E2E tests under `apps/web/e2e`; the harness configuration is
  `apps/web/playwright.config.ts` and expects an already-running web/Convex stack.
- Backend live-deployment smoke and golden-evaluation scripts are under `packages/backend/scripts`
  and exposed through `packages/backend/package.json`.
- `scripts/check-playbooks.mjs` enforces documentation freshness, while
  `scripts/extract-convex-edges.mjs` enriches the repository graph with Convex call edges.
- Graphify is configured as a local MCP server in `.mcp.json` using
  `graphify-out/graph.json`; `.claude/settings.json` also wires graph and playbook hooks.
- GitHub Actions currently contains one specialized workflow, `.github/workflows/skillopt.yml`,
  which installs the pnpm workspace, conditionally provisions Python, runs SkillOpt, and records
  evaluation evidence.

