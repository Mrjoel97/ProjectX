# Phase 1: Foundation & Governance Substrate - Research

**Researched:** 2026-07-08
**Domain:** Convex/Next.js/pnpm+Turborepo monorepo bootstrap; Convex components (Workflow/Agent/RAG/RateLimiter/ActionRetrier); tenant-scoped custom functions; insert-only audit + WORM export; DLQ + awaitEvent-timeout patterns; graphify; Google OAuth verification; skills registry
**Confidence:** HIGH (versions verified against npm registry 2026-07-08; APIs verified against official READMEs/docs; graphify and OAuth verified against upstream sources)

## Summary

Phase 1 builds the substrate every later phase inherits. The prior stack research (`.planning/research/STACK-CONVEX.md`) already locked the shape — Convex data+orchestration plane, pure-TS `packages/*` behind a thin `convex/` adapter, tenant wrapper, insert-only audit, DLQ via `onComplete`, awaitEvent-timeout race, WORM export stub, skills registry. This research verifies the *current* specifics as of 2026-07-08 and turns them into prescriptive implementation guidance.

Three findings materially update the prior research: (1) **`@convex-dev/workflow` is now 0.4.4**, not 0.2.x — it has a first-class event API (`step.awaitEvent`, `sendEvent` helper, `defineEvent` with validators) which makes the human-gate and timeout-race patterns cleaner than the prior notes assumed; (2) **workflow issue #177 (native `awaitEvent` timeout) is still OPEN** — the scheduled-mutation race workaround remains mandatory, and the issue itself documents the exact recommended workaround shape (single event name, union validator, scheduled mutation fires the timeout variant); (3) **Google's sensitive-scope review is currently documented as "up to 10 days"** (faster than the 2–4 weeks in PITFALLS.md), submitted via the OAuth Verification Center at `console.cloud.google.com/auth/verification` — but a demo video of the consent flow is required at submission, so "paperwork submitted Week 1" needs a minimal working OAuth consent flow by end of Week 1 (branding, domain verification, privacy policy, and homepage can all be completed first without any code).

One naming gotcha that will burn time if missed: **graphify's PyPI package is `graphifyy` (two y's)** — the `graphify` name is being reclaimed; the CLI binary is still `graphify`. Install via `pip install graphifyy` (or `pipx`/`uv tool install graphifyy`), then `graphify hook install` for the post-commit hook and a stdio MCP entry in `.mcp.json` for Claude Code.

**Primary recommendation:** Scaffold the monorepo manually in the shape of Convex's official Turborepo template (`apps/web` + `packages/backend/convex/`), pin the exact component versions listed below, and build the five governance patterns (tenant wrapper, audit, DLQ, timeout race, WORM stub) as the first real code — each with a smoke test — before any feature work.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OPSG-02 | Every request, redaction, routing decision, model call, review action, and delivery is written to an insert-only audit log | §Architecture Patterns 4 (insert-only audit module — schema, single `internalMutation` insert surface, no update/delete exports, static-scan test); §Validation Architecture (audit immutability test) |
| OPSG-04 | Failed/unhandled requests are archived to a dead-letter store with payload, error details, and correlation ID | §Architecture Patterns 5 (`deadLetters` table + workflow `onComplete` handler — verified 0.4.x `vResultValidator` result shape with `kind: "error"` / `"canceled"` branches and `context` passthrough for correlation ID) |
</phase_requirements>

## Standard Stack

All versions verified against the npm registry on **2026-07-08**. Pin exactly (components are pre-1.0; STATE.md already flags API churn risk).

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex` | **1.42.1** | DB + reactive queries + functions + scheduler + file storage | The data/orchestration plane (owner decision 2026-07-09) |
| `@convex-dev/workflow` | **0.4.4** | Durable pipeline, `awaitEvent`/`sendEvent`, `onComplete` | Replaces Inngest; event API is now first-class (0.4.x) |
| `@convex-dev/agent` | **0.6.4** | Threads/memory for Executive Agent (Phase 2+) | Wired in Phase 1 config; used from Phase 2 |
| `@convex-dev/rag` | **0.7.5** | Vault retrieval w/ per-tenant namespaces (Phase 5) | Wired in Phase 1 config; used from Phase 5 |
| `@convex-dev/rate-limiter` | **0.3.2** | Per-tenant rate limits (Phase 3) | Wired in Phase 1 config |
| `@convex-dev/action-retrier` | **0.3.1** | Retrying sidecar/external `fetch` calls | Wired in Phase 1 config |
| `@convex-dev/auth` | **0.0.94** | Minimal auth so `ctx.auth.getUserIdentity()` is real | Tenant wrapper needs an identity source; invite gating deferred to Phase 9 |
| `convex-helpers` | **0.1.120** | `customQuery`/`customMutation`, RLS wrappers, zod bridge | The tenant-scoping linchpin (verified API below) |
| `next` | **16.2.10** | Web app (`apps/web`) | KEPT from stack research |
| `turbo` | **2.10.4** | Task orchestration | KEPT |
| pnpm | 10.x | Workspaces | KEPT |
| `zod` | 4.x | Contract source of truth in `packages/contracts` | KEPT; `convex-helpers/server/zod4` bridges to Convex validators |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex-test` | **0.0.54** | In-memory unit tests of Convex functions | Tenant wrapper + audit + skills loader tests (needs `@edge-runtime/vm`) |
| `vitest` | 3.x | Test runner | All unit tests |
| `@edge-runtime/vm` | latest | Vitest environment for convex-test | Dev dependency of `packages/backend` |
| `@aws-sdk/client-s3` | 3.x | WORM export action (`"use node"`) | Phase 1 cron stub; real export Phase 7 (OPSG-03) |
| `@biomejs/biome` | latest | Lint/format | KEPT |
| graphify (PyPI: **`graphifyy`**) | latest | Repo knowledge graph + git hook + MCP | Dev-machine tool, not a dependency of the app |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual monorepo scaffold | `npm create convex@latest -- -t nextjs-shadcn` | Scaffolder produces a single-app layout with `convex/` at root — wrong shape for the `packages/backend` monorepo discipline. Use it only as a reference, not the starting point |
| Convex Auth (0.0.94) | `@convex-dev/better-auth` | Pre-1.0 org/invite plugins not needed until Phase 9; Convex Auth is smaller surface now |
| Fly.io for Python sidecars | Railway / Render / Cloud Run | See §Sidecar Host Decision — Fly.io recommended for always-on low-latency Presidio; Railway if variable/scale-to-zero is preferred |

**Installation (packages/backend):**
```bash
pnpm add convex@1.42.1 @convex-dev/workflow@0.4.4 @convex-dev/agent@0.6.4 \
  @convex-dev/rag@0.7.5 @convex-dev/rate-limiter@0.3.2 @convex-dev/action-retrier@0.3.1 \
  @convex-dev/auth@0.0.94 convex-helpers@0.1.120
pnpm add -D convex-test@0.0.54 vitest @edge-runtime/vm typescript
# apps/web
pnpm add next@16.2.10 react react-dom convex@1.42.1 zod@^4
# repo root
pnpm add -D turbo@2.10.4 @biomejs/biome
```

## Architecture Patterns

### Recommended Project Structure

Matches Convex's official Turborepo monorepo template shape (`packages/backend` owns the Convex deployment) and STACK-CONVEX.md §8:

```
pikar-ai/
├── apps/
│   └── web/                      # Next.js 16.2 (ConvexProvider; NEXT_PUBLIC_CONVEX_URL)
├── packages/
│   ├── backend/                  # THE Convex project
│   │   ├── convex/
│   │   │   ├── convex.config.ts  # app.use() all five components
│   │   │   ├── schema.ts         # audit, deadLetters, skills, tenants/users
│   │   │   ├── lib/functions.ts  # tenantQuery/tenantMutation custom builders
│   │   │   ├── audit.ts          # insert-only module (internalMutation only)
│   │   │   ├── deadLetter.ts     # onComplete handler + DLQ insert
│   │   │   ├── skills.ts         # registry loader + seed
│   │   │   ├── smoke.ts          # smoke-test workflows (fail→DLQ; awaitEvent race)
│   │   │   ├── crons.ts          # WORM export stub schedule
│   │   │   └── worm.ts           # "use node" S3 Object Lock export action (stub)
│   │   ├── vitest.config.mts
│   │   └── package.json
│   ├── contracts/                # Zod SoT (audit event types, skill doc shape, ...)
│   ├── core/                     # Result types, tenant ctx type, logger factory
│   └── audit/ (+ future domain packages)  # pure TS, NO convex imports
├── sidecars/                     # empty dirs + README pointing at host target (Phase 3+)
├── turbo.json / pnpm-workspace.yaml / tsconfig.base.json / .mcp.json
```

**Workspace-package import rule for Convex:** the Convex bundler (esbuild) resolves workspace packages via normal node resolution. Ship internal packages as **source exports** (`"exports": { ".": "./src/index.ts" }` in each `packages/*/package.json`) — no build step, works with both the Convex bundler and Next 16 (`transpilePackages` in `next.config` for `apps/web`). Do NOT set up compiled project references for v1; just-in-time source packages are the standard Turborepo pattern and remove a whole class of stale-build bugs. (Confidence: MEDIUM-HIGH — established community pattern; verify once in Wave 0 smoke boot.)

**Scaffold sequence (clean-clone bootable):**
```bash
pnpm init && git init                      # root; pnpm-workspace.yaml: ["apps/*","packages/*"]
pnpm dlx create-next-app@latest apps/web --ts --app --no-eslint
mkdir -p packages/backend && cd packages/backend && pnpm init
pnpm add convex@1.42.1 ...                 # as above
npx convex dev --configure                 # creates dev deployment, writes .env.local
```
`npx convex dev` performs codegen (`_generated/`, `components.*`) — it must run once before typecheck passes. README must state this ("clean clone → pnpm install → npx convex dev in packages/backend → pnpm dev").

### Pattern 1: Component wiring (`convex.config.ts`)

```typescript
// Source: @convex-dev/workflow README (verified 0.4.4); identical app.use() pattern for all components
import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import actionRetrier from "@convex-dev/action-retrier/convex.config.js";

const app = defineApp();
app.use(workflow);
app.use(agent);
app.use(rag);
app.use(rateLimiter);
app.use(actionRetrier);
export default app;
```

Instantiate the WorkflowManager once with retry defaults:

```typescript
// convex/index.ts — Source: workflow README (verified)
import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";

export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 100, base: 2 },
    retryActionsByDefault: true,
  },
});
```

"Wired" for Phase 1 = all five in `convex.config.ts`, codegen green, WorkflowManager + ActionRetrier instantiated, and a smoke workflow runs. Agent/RAG/RateLimiter need only compile-level instantiation (their real configuration lands in Phases 2/3/5).

### Pattern 2: Tenant-scoping wrapper (`customQuery`/`customMutation`)

Verified against convex-helpers README (0.1.120). Import path: `convex-helpers/server/customFunctions`.

```typescript
// convex/lib/functions.ts
import { customQuery, customMutation, customCtx } from "convex-helpers/server/customFunctions";
import { query, mutation } from "../_generated/server";

async function requireTenant(ctx: { auth: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("UNAUTHENTICATED");
  return identity.subject as string; // tenantId = userId for beta
}

export const tenantQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ tenantId: await requireTenant(ctx) })),
);

export const tenantMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ tenantId: await requireTenant(ctx) })),
);
```

**Making scoping *unavoidable* (success criterion #2) takes two more mechanisms**, because a wrapper alone can be bypassed by importing raw `query`/`mutation`:
1. **Ban raw builders outside `lib/functions.ts`** — Biome/ESLint `no-restricted-imports` on `./_generated/server`'s `query`/`mutation` in all other files, plus a repo test that greps `convex/` for violations (belt and suspenders; internal functions used by the scheduler/onComplete are the allowed exceptions, listed explicitly).
2. **Defense-in-depth (optional, Claude's discretion):** wrap `ctx.db` with `wrapDatabaseReader`/`wrapDatabaseWriter` from `convex-helpers/server/rowLevelSecurity` inside the custom builders so even a query that forgets an index filter cannot read cross-tenant rows. Verified API: rules object keyed by table with `read`/`modify` async predicates.

Every tenant-owned table gets `tenantId: v.string()` and a leading-`tenantId` index (e.g. `.index("by_tenant", ["tenantId", ...])`); handlers must query via those indexes with `q.eq("tenantId", ctx.tenantId)`.

### Pattern 3: Convex Auth minimal setup

Phase 1 needs real identities for the wrapper and tests — install `@convex-dev/auth` with the Password provider only (one user: the owner). Invite codes, OAuth sign-in, and onboarding are Phase 9 (BETA-01). `convex-test` supports `t.withIdentity({ subject: "user_a" })` so tenant tests don't depend on the auth UI.

### Pattern 4: Insert-only audit module (OPSG-02)

```typescript
// convex/schema.ts (excerpt)
audit: defineTable({
  tenantId: v.string(),
  correlationId: v.string(),      // requestId / workflowId
  eventType: v.string(),          // "request.received" | "routing.decided" | ...
  actor: v.string(),              // "user" | "system" | "workflow"
  payload: v.any(),               // SAFE data only — refs/hashes, never raw content (PITFALLS #8)
  ts: v.number(),
})
  .index("by_tenant_ts", ["tenantId", "ts"])
  .index("by_correlation", ["correlationId"]),
```

```typescript
// convex/audit.ts — the ONLY write surface; no update/delete functions exist in this module
import { internalMutation } from "./_generated/server";
export const log = internalMutation({
  args: { tenantId: v.string(), correlationId: v.string(), eventType: v.string(),
          actor: v.string(), payload: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.insert("audit", { ...args, ts: Date.now() });
  },
});
```

Enforcement is **convention + verification** (Convex has no append-only primitive — known gap from STACK-CONVEX §6): (a) `audit.ts` exports insert only; (b) a static-scan test asserts `convex/audit.ts` contains no `db.patch`/`db.replace`/`db.delete`; (c) no public (client-callable) function touches the `audit` table at all — reads come later via tenant-scoped query in Phase 2. Pure formatting/typing logic lives in `packages/audit` (event-type taxonomy from `packages/contracts`); `convex/audit.ts` stays a thin adapter.

### Pattern 5: Dead-letter via `onComplete` (OPSG-04)

Verified 0.4.4 `onComplete` result shape: `kind: "success" | "error" | "canceled"`, with `result.error` on failure and a caller-supplied `context` object passed through.

```typescript
// convex/deadLetter.ts — Source: workflow README (verified)
import { vWorkflowId, vResultValidator } from "@convex-dev/workflow";
import { internalMutation } from "./_generated/server";

export const onPipelineComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ tenantId: v.string(), correlationId: v.string(), payload: v.any() }),
  },
  handler: async (ctx, { workflowId, result, context }) => {
    if (result.kind === "error" || result.kind === "canceled") {
      await ctx.db.insert("deadLetters", {
        tenantId: context.tenantId,
        correlationId: context.correlationId,
        workflowId,
        payload: context.payload,          // redacted-safe payload only
        error: result.kind === "error" ? String(result.error) : "canceled",
        status: "new",
        createdAt: Date.now(),
      });
      await ctx.runMutation(internal.audit.log, { /* dead-letter audit event */ });
    }
  },
});
```

`deadLetters` schema: `tenantId, correlationId, workflowId, payload, error, status ("new"|"replayed"|"resolved"), createdAt` with `by_tenant` and `by_status` indexes. The workflow is started with `workflow.start(ctx, internal.smoke.pipeline, args, { onComplete: internal.deadLetter.onPipelineComplete, context: {...} })`. Success criterion #3's "deliberately failed smoke-test workflow" = `convex/smoke.ts` workflow whose step throws with `retry: false`.

### Pattern 6: awaitEvent-timeout race (issue #177 workaround)

**Verified current state (2026-07-08): issue #177 is OPEN — no native timeout.** The issue documents the canonical workaround: one event name, a validator that accepts the real payload OR a timeout marker, and a scheduled mutation that fires the timeout variant. Workflows can't touch `ctx.scheduler` directly, so arming happens in a step:

```typescript
// Inside the workflow handler
const armed = await step.runMutation(internal.review.armTimeout, {
  workflowId, correlationId, timeoutMs });
const evt = await step.awaitEvent({
  name: `review:${correlationId}`,
  validator: v.union(
    v.object({ kind: v.literal("decision"), decision: v.string() }),
    v.object({ kind: v.literal("timeout") }),
  ),
});
if (evt.kind === "timeout") { /* escalation branch */ }

// convex/review.ts
export const armTimeout = internalMutation({ ... , handler: async (ctx, a) => {
  const id = await ctx.scheduler.runAfter(a.timeoutMs, internal.review.fireTimeout, a);
  await ctx.db.insert("pendingTimeouts", { workflowId: a.workflowId, scheduledId: id });
  return id;
}});
export const fireTimeout = internalMutation({ ..., handler: async (ctx, a) => {
  await sendEvent(ctx, components.workflow, {
    workflowId: a.workflowId, name: `review:${a.correlationId}`, value: { kind: "timeout" } });
}});
// The real-decision mutation sends {kind:"decision"} AND cancels the scheduled timeout:
//   ctx.scheduler.cancel(scheduledId)  — look up via pendingTimeouts
```

Two defensive rules: (a) always cancel the scheduled timeout on a real decision; (b) namespace event names with the correlationId so a late-firing stale timeout can never be consumed by a different gate. (Behavior of `sendEvent` when no step is awaiting is not documented — see Open Questions — cancellation + namespacing makes it moot.)

### Pattern 7: WORM export cron stub

```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
const crons = cronJobs();
crons.daily("worm-export", { hourUTC: 3, minuteUTC: 0 }, internal.worm.exportAudit, {});
export default crons;

// convex/worm.ts
"use node";                      // required for @aws-sdk/client-s3
import { internalAction } from "./_generated/server";
export const exportAudit = internalAction({ args: {}, handler: async (ctx) => {
  // Phase 1 STUB: read audit rows since last export cursor, serialize to NDJSON,
  // PutObject with ObjectLockMode: "COMPLIANCE" + ObjectLockRetainUntilDate.
  // If WORM_BUCKET env unset → log "worm export skipped (stub)" and return.
}});
```

Phase 1 delivers the cron + action skeleton + an `exportCursors` table; the real export with a provisioned Object-Lock bucket is Phase 7 (OPSG-03). Gotchas to note in the stub's comments: the S3 bucket must be created with Object Lock **enabled at creation** (cannot be enabled later), and `PutObject` with lock headers requires a content checksum (AWS SDK v3 flexible checksums handle this — verify in Phase 7). AWS credentials go in **Convex env vars** (`npx convex env set`), never in Vercel.

### Pattern 8: Versioned skills registry + loader (success criterion #6)

Per SKILLOPT.md: no hardcoded agent prompts anywhere; skills are versioned rows.

```typescript
// convex/schema.ts (excerpt)
skills: defineTable({
  name: v.string(),                // "executive-agent.classifier"
  version: v.number(),             // monotonically increasing per name
  body: v.string(),                // 300–2,000-token markdown skill document
  status: v.union(v.literal("active"), v.literal("candidate"),
                  v.literal("rolled_back"), v.literal("archived")),
  evidence: v.optional(v.string()),// ref to triggering evidence (Phase 8)
  createdAt: v.number(),
})
  .index("by_name_status", ["name", "status"])
  .index("by_name_version", ["name", "version"]),
```

**Loader contract** (exported type in `packages/contracts`): `loadSkill(ctx, name) → { body, version, skillId }` — reads the single `status === "active"` row via `by_name_status`; **throws** (fails closed) if none. Callers must record `{name, version}` in telemetry/audit for every use so Phase 8 evidence tracking works. **Versioning discipline:** skill bodies are immutable per version — a change = insert new row (version+1, status `candidate`) + an `activateSkill` mutation that flips statuses atomically (the ONE permitted status mutation; body/`name`/`version` never patched). Rollback = re-activate a prior version. Seed: a `seedSkills` internalMutation (idempotent — skip if name exists) inserts `executive-agent.classifier` v1 from a markdown file in `packages/contracts/skills/`.

### Pattern 9: Deployment envs + Vercel

Verified against docs.convex.dev/production/hosting/vercel:
- Vercel build command: `npx convex deploy --cmd 'pnpm build'` (run from `packages/backend` context in the monorepo; set Vercel root dir to `apps/web` and use `--cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` if the default name differs).
- `CONVEX_DEPLOY_KEY`: **production** key (Deployment Settings → `deployment:deploy` permission) scoped to Production in Vercel; a **separate preview key** scoped to Preview. `convex deploy` reads the key, sets the URL var, builds, then pushes functions to prod or a fresh per-branch preview backend accordingly.
- Env var split (STACK-CONVEX §8 confirmed): all server secrets (AWS keys, OAuth client secrets, sidecar URLs) live in **Convex env vars** per deployment (dev/preview/prod); Vercel holds only `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOY_KEY`. Declare env names in `turbo.json` `env` for cache correctness.
- Phase 1 scope: dev deployment working + Vercel project connected with prod deploy key; preview keys are a fast follow.

### Pattern 10: graphify on the repo (Windows 11)

Verified against the Graphify-Labs README + community setup guide:
```bash
# install (PyPI name is graphifyy — two y's; CLI is `graphify`; Python 3.10+)
uv tool install graphifyy        # or: pipx install graphifyy / pip install graphifyy
graphify .                       # build the graph for the repo
graphify hook install            # post-commit auto-update hook (embeds interpreter path)
```
`.mcp.json` at repo root for Claude Code (stdio):
```json
{ "mcpServers": { "graphify": {
    "command": "python", "args": ["-m", "graphify.serve", "graphify-out/graph.json"],
    "type": "stdio" } } }
```
Windows notes: if `graphify` isn't found after `uv tool install`, run `uv tool update-shell` and open a new terminal (uv bin dir PATH); for pip installs add `%APPDATA%\Python\Python3xx\Scripts` to PATH; set `PYTHONUTF8=1` to avoid `UnicodeEncodeError`. Add `graphify-out/` to the repo (committed or ignored — Claude's discretion; committing lets MCP work from clean clone).

### Pattern 11: Google OAuth verification paperwork (Week 1)

Verified against Google's sensitive-scope verification docs (submission at **console.cloud.google.com/auth/verification**, "OAuth Verification Center"):

Week-1 checklist, in dependency order:
1. GCP project + OAuth consent screen (Google Auth Platform → Branding): app name, support email, authorized domain. Scope: **`gmail.send` only** (sensitive, NOT restricted — never request `https://mail.google.com/`, which triggers CASA Tier 2).
2. **Domain verification** in Google Search Console (Owner/Editor account).
3. **Homepage**: publicly accessible (not login-walled), clearly describes the app, on the verified domain.
4. **Privacy policy**: hosted on the **same domain** as the homepage; must disclose how the app accesses/uses/stores/shares Google user data; linked from the consent screen config.
5. Publishing status: **Testing** with test users added (beta runs on this — 100-user cap, 7-day refresh-token expiry handled in Phase 2 per DLVR-03).
6. **Submission** requires: per-scope justification (why `gmail.send`, why nothing narrower), up to 3 documentation links, and an **unlisted YouTube demo video in English** showing the full OAuth grant flow (consent screen with the real app name + client ID visible in the URL bar) and the scope in use. → **Planner note:** items 1–5 are pure paperwork doable day 1–2; item 6 needs a minimal consent flow + a stub send, so schedule "record demo video + submit" as the last Week-1 task. Current documented review time: **up to 10 days** (bounce-backs reset the clock — keep scope list minimal and stable).

### Sidecar Host Decision (document in Phase 1 README; no deployment yet)

Requirement: container host for Python sidecars (Presidio Phase 3, graphify-service Phase 5, SkillOpt Phase 8). 2026 pricing/positioning (multiple sources, MEDIUM):
- **Fly.io** — cheapest always-on raw compute (~$5–11/mo shared-1x/2GB class), per-second billing, no seat fee. Best for **Presidio**, which sits in the request hot path (Phase 3) and must not cold-start.
- **Railway** — best DX, usage-metered, cheap for variable/scale-to-zero workloads; ~3–4× Fly for always-on.
- **Render** — fixed $7+/mo instances, predictable; free tier sleeps.
- **Cloud Run** — scale-to-zero, but cold starts + GCP setup overhead for a solo dev.

**Recommendation: Fly.io** as the documented target for all three sidecars (always-on Presidio; SkillOpt nightly can scale-to-zero via Fly machines). Railway is the acceptable fallback if the owner's existing cloud account makes it easier. Phase 1 deliverable = one paragraph in the README + `sidecars/README.md` naming the target and the env-var convention (`PRESIDIO_URL` etc. in Convex env).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Durable pipeline / human gates | Custom state machine over Convex tables | `@convex-dev/workflow` 0.4.4 (`awaitEvent`/`sendEvent`/`onComplete`) | Journaling, exactly-once mutations, retries, event delivery already solved |
| Tenant injection | Per-handler `getUserIdentity()` boilerplate | `convex-helpers` `customQuery`/`customMutation` + `customCtx` | One enforced wrapper > 50 copies of auth code; RLS wrappers available for depth |
| External-call retries | try/catch + setTimeout loops | `@convex-dev/action-retrier` | Backoff + jitter + durability across restarts |
| Zod↔Convex validators | Dual schema definitions | `convex-helpers/server/zod4` (`zCustomQuery`, `zid`) | Contracts stay single-source in `packages/contracts` |
| Convex unit testing | Live-deployment-only testing | `convex-test` + Vitest | In-memory, `t.withIdentity()` for tenant tests |
| Rate limiting | Counter tables | `@convex-dev/rate-limiter` | Transactional token-bucket, sharded (Phase 3 consumer) |
| True immutability | "Trust the module" alone | S3 Object Lock (COMPLIANCE mode) export | Convex has no WORM primitive; immutability guarantee must live outside |

**Key insight:** every governance pattern in this phase is a thin composition of an official component plus a small Convex adapter — the custom code is the *discipline* (what's banned, what's insert-only), not the machinery.

## Common Pitfalls

### Pitfall 1: Component version drift vs. prior research
**What goes wrong:** Plans written against STACK-CONVEX.md's "workflow 0.2.x" notes use stale API shapes; 0.4.x has the builder-style `define({...}).handler(...)` and first-class event API.
**How to avoid:** Pin the exact versions in this doc; treat the 0.4.4 README snippets here as the API source; re-verify snippets compile in the first task that touches each component.
**Warning signs:** TypeScript errors on `workflow.define` shape or missing `vResultValidator`.

### Pitfall 2: Tenant wrapper that's advisory, not unavoidable
**What goes wrong:** Wrapper exists but handlers keep importing raw `query`/`mutation` from `_generated/server` — success criterion #2 fails on inspection.
**How to avoid:** Lint ban + grep test from the same commit that introduces the wrapper; explicit allow-list for internal functions.
**Warning signs:** Any `from "./_generated/server"` import outside `lib/functions.ts`/internal modules.

### Pitfall 3: Codegen-before-typecheck ordering breaks clean-clone boot
**What goes wrong:** Fresh clone → `pnpm typecheck` fails because `_generated/` and `components.*` don't exist until `npx convex dev` runs once.
**How to avoid:** README boot order: install → `npx convex dev` (or `npx convex codegen`) → typecheck/dev. Wire `turbo` so backend typecheck depends on a codegen script. Commit or generate — pick one and document it.
**Warning signs:** CI/typecheck failing only on fresh environments.

### Pitfall 4: Raw payloads in audit/DLQ from day one (PITFALLS.md #8)
**What goes wrong:** Smoke tests write full request bodies into `audit.payload`/`deadLetters.payload`; the PII honeypot is baked in before Presidio exists (Phase 3).
**How to avoid:** `packages/contracts` defines the audit payload as refs/hashes/metadata only; the smoke tests use synthetic data; add a comment-level contract "payload must be redaction-safe" now.

### Pitfall 5: Stale timeout events firing into later gates
**What goes wrong:** Timeout mutation fires after the real decision already resumed the workflow; if event names are shared, a later `awaitEvent` on the same name swallows the stale timeout.
**How to avoid:** Cancel the scheduled timeout on real decision AND namespace event names by correlationId (Pattern 6). Both, not either.

### Pitfall 6: `graphifyy` vs `graphify` package confusion
**What goes wrong:** `uv tool install graphify` installs nothing/the wrong package; time lost.
**How to avoid:** PyPI name is `graphifyy` (two y's, temporary while the name is reclaimed); CLI is `graphify`. On Windows: `uv tool update-shell` + new terminal; `PYTHONUTF8=1`.

### Pitfall 7: OAuth submission blocked on the demo video
**What goes wrong:** Team treats "submit paperwork Week 1" as branding-only, then discovers submission requires a demo video of a working consent flow — submission slips to Week 3.
**How to avoid:** Sequence a minimal `gmail.send` consent flow (even a throwaway script/route) into Week 1 solely to record the video; everything else (domain, homepage, privacy policy, branding) is code-free and done first.

### Pitfall 8: Secrets in the wrong plane
**What goes wrong:** AWS/OAuth secrets put in Vercel env; Convex actions can't see them; or worse, secrets duplicated in both.
**How to avoid:** Rule: anything a Convex function reads → `npx convex env set` per deployment. Vercel gets only `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOY_KEY`.

## Code Examples

Core verified snippets are embedded in the patterns above (all from official READMEs/docs fetched 2026-07-08):
- Component wiring + WorkflowManager retry config — Pattern 1 (workflow README)
- `customQuery`/`customCtx` + RLS wrappers — Pattern 2 (convex-helpers README)
- `onComplete` with `vResultValidator` result kinds — Pattern 5 (workflow README)
- `awaitEvent` with union validator + `sendEvent(ctx, components.workflow, {...})` — Pattern 6 (workflow README + issue #177)
- Vercel build command + deploy keys — Pattern 9 (docs.convex.dev)
- graphify install/hook/MCP — Pattern 10 (Graphify-Labs README + setup guide)

Additional verified 0.4.4 event API detail:
```typescript
// Source: workflow README — predefined typed events
import { defineEvent } from "@convex-dev/workflow";
const approvalEvent = defineEvent({
  name: "approval",
  validator: v.object({ approved: v.boolean() }),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Workflow 0.2.x, event API immature | 0.4.4 with `step.awaitEvent`/`sendEvent`/`defineEvent` + validators | Between 2025 and mid-2026 | Human-gate + timeout-race code is cleaner than prior research assumed; pin 0.4.4 |
| "awaitEvent timeout coming soon" | Issue #177 still OPEN (opened 2025-12-15) | — | Scheduled-mutation race workaround is mandatory, not optional |
| Google sensitive review "2–4 weeks" (PITFALLS.md) | Officially "up to 10 days" for sensitive scopes | Current docs | Week-1 submission → likely verified before beta; still uncontrollable, still submit Week 1 |
| Inngest for orchestration (ARCHITECTURE.md) | Convex Workflow component | Owner decision 2026-07-09 | ARCHITECTURE.md's Inngest sections are superseded; its packages/* discipline stands |

**Deprecated/outdated:** ARCHITECTURE.md's `apps/api` + `apps/worker` + Postgres/Redis topology (superseded by STACK-CONVEX.md); `graphify-mcp-tools` third-party wrapper (deprecated upstream — use graphify's own MCP serve).

## Open Questions

1. **`sendEvent` behavior when no step is awaiting (buffered vs. dropped vs. error)**
   - What we know: 0.4.4 delivers events to awaiting `awaitEvent` steps; the README doesn't specify non-awaiting behavior.
   - What's unclear: whether a stale timeout event could be buffered and consumed by a later gate.
   - Recommendation: don't depend on either behavior — cancel-on-decision + correlationId-namespaced event names (Pattern 6) make it irrelevant. Verify empirically in the smoke test.
2. **convex-test coverage of component-backed workflows**
   - What we know: convex-test excels at plain queries/mutations; components require registration and workflow execution semantics are only partially emulated.
   - Recommendation: unit-test wrapper/audit/skills with convex-test; run DLQ + timeout-race smoke tests against the real dev deployment via `npx convex run` scripts (see Validation Architecture).
3. **Convex bundler + source-exports workspace packages edge cases**
   - What we know: esbuild resolves `exports: "./src/index.ts"`; standard community pattern.
   - Recommendation: prove it in the very first backend task (import `packages/contracts` from `convex/schema.ts`); if it fails, fall back to a tsc build step for internal packages.
4. **Exact Vercel monorepo root-dir + `convex deploy` interplay for `packages/backend`**
   - What we know: official docs cover single-app; STACK-CONVEX cites the Turborepo template pattern.
   - Recommendation: connect Vercel late in the phase; budget one iteration on build-command wiring.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x + convex-test 0.0.54 (`@edge-runtime/vm` environment) |
| Config file | none yet — Wave 0: `packages/backend/vitest.config.mts` (`environment: "edge-runtime"`) |
| Quick run command | `pnpm --filter backend vitest run <file>` |
| Full suite command | `pnpm turbo test` (runs backend vitest + any web tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPSG-02 | `audit.log` inserts a row with tenantId/correlationId/eventType | unit (convex-test) | `pnpm --filter backend vitest run convex/audit.test.ts` | ❌ Wave 0 |
| OPSG-02 | Audit module is insert-only: no patch/replace/delete in `convex/audit.ts`; no public function writes `audit` | static-scan unit test | `pnpm --filter backend vitest run convex/auditImmutability.test.ts` | ❌ Wave 0 |
| OPSG-04 | Deliberately failing smoke workflow lands in `deadLetters` with payload+error+correlationId via `onComplete` | integration (dev deployment) | `pnpm --filter backend smoke:dlq` → `npx convex run smoke:runFailingPipeline && npx convex run smoke:assertDeadLetter` | ❌ Wave 0 |

### Phase Success Criteria → Validation
| Criterion | Validation |
|-----------|-----------|
| 1. Clean-clone boot; components wired; logic in packages/* | **Clean-clone boot test:** fresh `git clone` → follow README verbatim (`pnpm install` → `npx convex dev` → `pnpm dev`) → app loads, codegen green, `convex.config.ts` shows 5 components. Manual once + scripted `pnpm boot:check` (install+codegen+typecheck) |
| 2. Tenant scoping unavoidable | **Negative tests:** (a) convex-test — `t.withIdentity(A)` writes, `t.withIdentity(B)` reads empty; (b) unauthenticated call throws `UNAUTHENTICATED`; (c) grep test — no raw `query`/`mutation` imports outside allow-list |
| 3. Insert-only audit + DLQ smoke | OPSG-02 + OPSG-04 rows above |
| 4. awaitEvent race + WORM stub demonstrated | Integration: `npx convex run smoke:runReviewGate` twice — once sending a decision (workflow takes decision branch; scheduled timeout canceled), once letting timeout fire (escalation branch). WORM: `npx convex run worm:exportAudit` runs, logs stub message, cron visible in dashboard |
| 5. OAuth paperwork + graphify active | Checklist evidence: Verification Center shows submitted status (screenshot/URL in phase notes); `git log --show-signature`-style check replaced by: `.git/hooks/post-commit` exists + `graphify-out/graph.json` fresh + `.mcp.json` present |
| 6. Skills registry + seed skill | convex-test: `loadSkill("executive-agent.classifier")` returns v1 body; no-active-skill throws; `activateSkill` flips statuses atomically; grep test: no hardcoded prompt strings in `convex/` agent paths |

### Sampling Rate
- **Per task commit:** `pnpm --filter backend vitest run` (unit suite, <30s)
- **Per wave merge:** `pnpm turbo test` + `npx convex run` smoke scripts against dev deployment
- **Phase gate:** full suite green + clean-clone boot test + both smoke workflows demonstrated before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/backend/vitest.config.mts` + `@edge-runtime/vm` install — framework bootstrap
- [ ] `convex/audit.test.ts` — covers OPSG-02 (insert path)
- [ ] `convex/auditImmutability.test.ts` — covers OPSG-02 (insert-only static scan)
- [ ] `convex/tenant.test.ts` — covers success criterion 2 (cross-tenant negative + unauthenticated)
- [ ] `convex/skills.test.ts` — covers success criterion 6
- [ ] `convex/smoke.ts` + `smoke:assert*` scripts — covers OPSG-04 + criterion 4 (dev-deployment integration)
- [ ] `scripts/boot-check` (install→codegen→typecheck) — covers criterion 1

## Sources

### Primary (HIGH confidence)
- npm registry via `npm view` (2026-07-08) — exact versions: convex 1.42.1, workflow 0.4.4, agent 0.6.4, rag 0.7.5, rate-limiter 0.3.2, action-retrier 0.3.1, auth 0.0.94, convex-helpers 0.1.120, convex-test 0.0.54, next 16.2.10, turbo 2.10.4
- [get-convex/workflow README](https://github.com/get-convex/workflow) — convex.config wiring, define/handler, onComplete + vResultValidator, awaitEvent/sendEvent/defineEvent, retry config
- [workflow issue #177](https://github.com/get-convex/workflow/issues/177) — OPEN; no native awaitEvent timeout; canonical workaround shape
- [convex-helpers package README](https://github.com/get-convex/convex-helpers/blob/main/packages/convex-helpers/README.md) — customFunctions import path + customCtx examples, RLS wrappers, zod4 bridge
- [Convex Vercel hosting docs](https://docs.convex.dev/production/hosting/vercel) — build command, prod/preview deploy keys, --cmd-url-env-var-name
- [Google sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) — checklist, Verification Center location, demo-video requirement, "up to 10 days"
- [Graphify-Labs/graphify README](https://github.com/safishamsi/graphify) — `graphifyy` PyPI name, `graphify hook install`, MCP serve, Windows PATH notes

### Secondary (MEDIUM confidence)
- [graphify + MCP setup guide (community gist)](https://gist.github.com/ashokvarmamatta/344a642e8b5bd286be605a8f439c3848) — `.mcp.json` stdio config, PYTHONUTF8=1 — cross-checked with README
- [create-convex templates](https://github.com/get-convex/templates/blob/main/create-convex/README.md) — scaffolder template list (used as reference, not adopted)
- Sidecar host pricing 2026 — [hostim.dev comparison](https://hostim.dev/blog/render-vs-railway-vs-fly-pricing/), [Railway docs vs Fly](https://docs.railway.com/platform/compare-to-fly), dev.to/thesoftwarescout comparisons — directionally consistent across sources
- `.planning/research/STACK-CONVEX.md` (2026-07-09) — platform limits, monorepo layout, component roles (its own sources are official docs)

### Tertiary (LOW confidence — flagged for validation)
- Source-exports workspace packages through the Convex bundler (Open Question 3)
- `sendEvent`-with-no-awaiter semantics (Open Question 1)
- S3 checksum requirements for Object Lock PutObject via SDK v3 (verify in Phase 7)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions from npm registry same-day; APIs from official READMEs
- Architecture: HIGH on patterns 1,2,4,5,6,9 (verified snippets); MEDIUM on monorepo bundler specifics and Vercel monorepo wiring (Open Questions 3–4)
- Pitfalls: HIGH — grounded in verified gaps (issue #177 open, no WORM primitive, graphifyy naming, demo-video requirement)
- OAuth/graphify/sidecar host: HIGH / HIGH / MEDIUM

**Research date:** 2026-07-08
**Valid until:** ~2026-07-22 (pre-1.0 components move fast — re-run `npm view` at plan time; 7-day freshness for component versions, 30 days for platform docs)
