# Repository Structure

## Top-level map

```text
pikar-ai/
├── apps/web/                 Next.js App Router product and Playwright E2E suite
├── packages/backend/        Convex deployment, tests, seeds, evals, and live smokes
├── packages/contracts/      Zod/data contracts plus canonical skill prompt Markdown
├── packages/core/           Framework-neutral product and governance rules
├── packages/{cost,pii}/     Model pricing and PII redaction domains
├── packages/extraction/     Intake classification and conversation framing
├── packages/vault/          Document recognition, parsing, fusion, and graph traversal
├── packages/voice/          Realtime, session, brief, and voice-document rules
├── packages/audit/          Standalone audit event taxonomy package
├── docs/                    ADRs, operating playbooks, and UI/design references
├── scripts/                 Repository boot/playbook/graph maintenance scripts
├── skillopt/                Offline Python prompt-optimization environment
├── sidecars/                Container architecture notes; service code is not present yet
├── graphify-out/            Committed repository knowledge graph and report
└── .planning/               GSD project state, roadmap, research, and phase history
```

## Workspace and build ownership

- `package.json` is the root command surface. Add cross-workspace orchestration commands here only when they genuinely span packages.
- `pnpm-workspace.yaml` includes `apps/*` and `packages/*`; `sidecars` and `skillopt` are not JavaScript workspaces.
- `turbo.json` defines the shared task graph and cache outputs. Package-specific script behavior belongs in each package’s own `package.json`.
- `tsconfig.base.json` holds common TypeScript compiler settings; package/application `tsconfig.json` files extend or specialize them.
- `biome.json` holds repository formatting/lint policy, including the backend raw-builder restriction and its narrow wrapper override.
- `pnpm-lock.yaml` is the single dependency lock. Pre-1.0 Convex components and AI runtime packages are intentionally pinned in `packages/backend/package.json`.

## Web application: `apps/web`

- `apps/web/app/layout.tsx` is the root server layout, metadata/font owner, and Convex Auth server-provider seam.
- `apps/web/app/providers.tsx` creates the browser `ConvexReactClient` and attaches Convex Auth tokens to client calls.
- `apps/web/middleware.ts` owns route-level authentication. Add or remove public routes in its explicit matcher rather than scattering auth redirects through pages.
- `apps/web/app/page.tsx`, `privacy`, `terms`, `robots.ts`, `sitemap.ts`, and `public/llms.txt` own the public/SEO surface.
- `apps/web/app/(auth)` owns sign-in, sign-up, their layout, and authentication-specific visual primitives.
- `apps/web/app/(app)/layout.tsx` owns the persistent authenticated rail, auth-state gate, onboarding gate, and global banners.
- `apps/web/app/(app)/dashboard/workspace` owns the cockpit UI: chat, intake controls, split-pane layout, cards, error boundary, and page composition.
- `apps/web/app/(app)/dashboard/vault` owns vault browsing/upload UI. Page-local components such as `Dropzone.tsx`, `DocGrid.tsx`, and `PreviewModal.tsx` stay beside the route because they are not shared globally.
- `apps/web/app/(app)/dashboard/voice` owns voice preflight/live/post-call UI and the browser Realtime controller `useVoiceSession.ts`.
- `apps/web/app/(app)/dashboard/onboarding` and `dashboard/profile` own initial profile capture and later profile editing; backend facts and validation remain in shared/core/backend layers.
- `apps/web/app/(app)/ops` is the operational review surface for dead letters and prompt candidates; `connect-gmail` owns the OAuth launch/result UI.
- Legacy/direct workflow pages remain in `submit`, `requests`, and `review`, but the current primary navigation favors the cockpit.
- `apps/web/app/globals.css` is the global token/component-style sheet. UI changes must also follow `docs/design/BRAND.md`; there is intentionally no component-library directory.
- `apps/web/e2e` holds Playwright specifications named by user flow (`cockpit-*.spec.ts`, `vault.spec.ts`, `voice*.spec.ts`) plus shared authenticated setup in `auth.setup.ts`.

## Convex backend: `packages/backend`

- Always read `packages/backend/AGENTS.md` and the generated guidance it references before changing `packages/backend/convex`; Convex patterns are version-specific.
- `packages/backend/convex/schema.ts` is the sole application schema location. New tables, fields, indexes, and validators belong here, followed by codegen.
- `packages/backend/convex/convex.config.ts` registers Convex components; add component wiring here, not in feature files.
- `packages/backend/convex/auth.config.ts`, `auth.ts`, and `http.ts` own authentication provider configuration, Convex Auth, and HTTP routes.
- `packages/backend/convex/lib/functions.ts` is the tenant-scoped public-function wrapper. Do not create another raw public builder seam; tenant-owned feature functions use these wrappers.
- `packages/backend/convex/lib/allowlist.ts` documents narrow exceptions to raw builder policy, and `lib/hash.ts` is the shared content-hash helper.
- `packages/backend/convex/index.ts` owns shared Workflow Manager and Action Retrier instances; durable workflows import them from here.
- `packages/backend/convex/cockpit.ts`, `plans.ts`, `llm.ts`, `dispatch.ts`, `agentSteps.ts`, and `evaluations.ts` form the interactive agent/cockpit subsystem.
- `packages/backend/convex/pipeline.ts`, `deliverApprovedPlan.ts`, `requests.ts`, `review.ts`, `gmail.ts`, and `gmailAuth.ts` form the governed approval and email-delivery subsystem.
- `packages/backend/convex/intake.ts` owns external extraction/transcription actions, while `intakeDb.ts` owns the transactional artifact rows. Preserve this action-versus-database split for Node/external work.
- `packages/backend/convex/vault.ts` is the vault client API and metadata surface; `vaultIngest.ts` owns the durable workflow; `vaultExtract.ts`/`vaultTranscribe.ts` own byte-to-text actions; `vaultRag.ts`, `vaultGraph.ts`, and `vaultGround.ts` own retrieval; `vaultSweep.ts` owns repair/watchdog work.
- `packages/backend/convex/voice.ts`, `voiceToken.ts`, and `voiceDoc.ts` own persisted voice sessions, OpenAI Realtime credential/hangup calls, and document-grounded voice review.
- Governance modules are purpose-named: `audit.ts`, `deadLetter.ts`, `deadLetters.ts`, `guardrails.ts`, `telemetry.ts`, `notifications.ts`, `notifyExternal.ts`, `worm.ts`, `wormCursor.ts`, and `skills.ts`.
- Scheduled jobs are registered only in `packages/backend/convex/crons.ts`; keep cron entry definitions thin and delegate behavior to the owning feature module.
- Migration definitions live in `migrations.ts` or a narrowly owned migration-bearing feature such as `tenantProfile.ts`, `vaultSweep.ts`; component runners make them invocable.
- Files ending `.test.ts` are colocated Convex/Vitest tests. Cross-module invariant tests such as `importGuard.test.ts`, `auditImmutability.test.ts`, and `traceParity.test.ts` intentionally scan architecture, not one function.
- `packages/backend/scripts/eval-cases` contains JSON golden cases; `run-eval-golden.mjs` is their runner.
- `packages/backend/scripts/run-smoke-*.mjs` exercise live component/workflow paths that `convex-test` cannot execute. Shared smoke script mechanics belong in `smokeRun.mjs`; deployment-side fixtures/assertions belong in `convex/smoke*.ts`.
- `packages/backend/.agents/skills` and `.claude/skills` are installed Convex assistant guidance, not product runtime code. Avoid treating their examples as deployed feature modules.

## Pure TypeScript packages

- `packages/contracts/src` owns boundary schemas and types such as audit payloads, routing, drafting, tenant shapes, and skill metadata. Add externally shared validation contracts here.
- `packages/contracts/skills/*.md` are human-editable canonical prompt bodies. Corresponding generated/derived seed modules live in `packages/contracts/src/skills`; drift is test-enforced.
- `packages/core/src` owns deterministic product decisions reused across UI/backend: validation, action kinds, business-profile rules, scorecards, generated document shaping, fallbacks, review thresholds, retention, and notification templates.
- Growth-specific core rules are grouped under `packages/core/src/growth`; extend that directory for additional pure Growth OS calculations rather than putting them in Convex actions.
- `packages/core/src/specialists.ts` is the code-owned specialist capability registry. Capability changes belong here and require code review/tests; prompt wording belongs in the skill registry source.
- `packages/cost/src/cost.ts` owns model/transcription/realtime prices, token estimates, model selection, and usage pricing. Do not duplicate price arithmetic in action files.
- `packages/pii/src/scan.ts` owns fail-closed PII scanning and safe-text types. Redaction behavior changes belong here, while callers own ordering it before writes or model calls.
- `packages/extraction/src/classify.ts` and `frame.ts` own framework-free intake decisions and prompt-safe framing.
- `packages/vault/src` owns document-format logic. `sniff.ts`, `extractKind.ts`, and `categories.ts` decide rails; `rawText.ts`, `officeText.ts`, and `xlsText.ts` parse formats; `fusion.ts` and `traversal.ts` own retrieval math.
- Heavy Node/bundle-sensitive vault modules are intentionally imported via subpaths and not from `packages/vault/src/index.ts`; keep that barrel V8-safe.
- `packages/voice/src` owns Realtime constants/event parsing, session transitions/caps, metering, brief composition, and document-session shaping.
- Tests in these packages are colocated `*.test.ts` files and should remain framework-independent. Public package barrels are `src/index.ts`; feature subpath exports work through the wildcard export in package manifests.
- `packages/audit` contains a small pure event-type taxonomy, but the deployed audit writer currently consumes `@pikar/contracts/audit`; check current imports before extending the standalone package.

## Documentation and operations

- `docs/decisions` contains immutable accepted ADRs. Record a significant new architectural choice as the next ADR; supersede rather than edit an accepted decision.
- `docs/playbooks` contains subsystem operating contracts, change guidance, verification commands, and known gaps. `docs/playbooks/watch.json` maps code paths to the playbook that must be updated with them.
- `docs/design/BRAND.md` and `docs/design/brand` are the UI source of truth and reference screenshots.
- `docs/superpowers/specs` and `docs/superpowers/plans` retain focused feature design artifacts; product implementation should still follow the current playbook and ADR layer.
- `scripts/check-playbooks.mjs` enforces playbook coverage/update rules, `boot-check.mjs` enforces clean boot order, and `extract-convex-edges.mjs` enriches the repository graph with generated Convex relationships.
- `graphify-out/graph.json` and `GRAPH_REPORT.md` are committed navigation aids. Cache/HTML output under `graphify-out` is ignored and regenerated.
- `.planning/PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, and `phases` are GSD planning state, not runtime documentation. New code should not import from `.planning`.
- `.github/workflows/skillopt.yml` owns the scheduled/manual optimizer job. GitHub workflow changes belong under `.github/workflows`, while the Python training adapter/config/seed skill belong under `skillopt`.
- `sidecars/README.md` defines the future container seam. When a Python sidecar lands, create its own directory under `sidecars` with service code and a Dockerfile; do not put Python runtime code in Convex.

## Naming and organization conventions

- React component files use PascalCase (`ChatPane.tsx`, `PreviewModal.tsx`); route entry files use App Router names (`page.tsx`, `layout.tsx`); hooks use `useX.ts`.
- TypeScript feature modules use lower camel-case or domain nouns (`tenantProfile.ts`, `vaultIngest.ts`). Tests mirror the production basename with `.test.ts`.
- Convex public API names are exported functions within file-routed modules, so moving a backend file changes its generated `api.*`/`internal.*` reference path and must be treated as an API change.
- Tables and fields use lower camel-case; schema indexes use descriptive `by_...` names. Tenant-owned indexes generally lead with `tenantId`.
- Separate action files are appropriate when Node built-ins or external SDKs are required; do not mix Node runtime directives with queries/mutations.
- Pure transformations belong in a package even when first used by one Convex action if they express domain policy; database coordination and generated Convex types stay in `packages/backend/convex`.
- User-visible copy shared across channels belongs in a pure helper such as `packages/core/src/notificationTemplates.ts`; notification/audit modules should carry static labels or safe references, not arbitrary model/user prose.

## Generated, local, and build artifacts

- `node_modules`, `.turbo`, `dist`, `out`, and every `.next` directory are generated and ignored. Never edit them as source.
- `packages/backend/convex/_generated` is produced by `convex dev`/`convex codegen` and ignored. It is required for typechecking and for the web app’s `@pikar/backend/api` import.
- `.convex` holds local deployment state, SQLite data, and local storage; it may contain real tenant/PII data and is ignored.
- `.env`, `.env.local`, and environment-specific local files are secrets/config outputs and ignored. The backend and web app require distinct local environment files.
- `apps/web/e2e/.auth`, `test-results`, `playwright-report`, and `blob-report` are Playwright credentials/results and ignored.
- `Screenshots`, `.playwright-mcp`, and `.worktrees` are local tooling artifacts. Curated visual references belong in `docs/design/brand`, not the raw screenshot directory.
- Skill optimizer run outputs and exported trajectory files are CI/runtime artifacts, not committed sources; durable optimizer inputs live in `skillopt/envs`.

## Where a change belongs

- Add a page or browser interaction in `apps/web/app`; add reusable product policy in a pure package; add a database/external-service adapter in `packages/backend/convex`.
- Add a client-callable tenant operation with `tenantQuery`, `tenantMutation`, or `tenantAction`; add sensitive orchestration as `internalQuery`, `internalMutation`, or `internalAction`.
- Add or alter persisted state in `packages/backend/convex/schema.ts`, then regenerate `_generated` and update the owning playbook/tests.
- Add an agent prompt in `packages/contracts/skills` plus its derived seed module; add an agent capability in code, normally `packages/backend/convex/llm.ts` with capability grants in `packages/core/src/specialists.ts`.
- Add a durable multi-step process through the Workflow Manager and completion callback; add a one-off delay/watchdog through Convex Scheduler; register recurring cadence in `crons.ts`.
- Add external API credential handling only in server actions/Convex environment configuration. Browser code may receive only deliberately scoped ephemeral credentials or signed storage URLs after tenant checks.
- Add architecture rationale to `docs/decisions`, operational invariants to `docs/playbooks`, and UI rules/reference imagery to `docs/design`.
