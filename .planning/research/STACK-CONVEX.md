# Stack Research — Convex Revision

**Domain:** Governed agentic AI operating layer (AI chief-of-staff) — voice/text intake, durable multi-step orchestration, hybrid GraphRAG, guardrails, human review, email delivery
**Researched:** 2026-07-09
**Supersedes:** `.planning/research/STACK.md` where they conflict (data + orchestration plane only)
**Confidence:** HIGH on Convex platform limits/components (verified against official docs + GitHub, 2026); MEDIUM on the Better Auth-component maturity and the awaitEvent-timeout workaround (community/issue-tracker sources)

> **Scope of this revision.** The owner decided (2026-07-09) to move the data + orchestration plane from **Postgres + pgvector + Redis + Inngest** to **Convex**. This document re-derives only what that switch touches. Voice (OpenAI Realtime/WebRTC), PII (Presidio sidecar), transcription (gpt-4o-transcribe), the AI SDK, and email providers are **unchanged in principle** — but their *integration points* move onto Convex actions, and those changes are documented below.

---

## TL;DR — Direct Answers to the 10 Questions

1. **Convex components:** Use **Agent** (threads/memory), **RAG** (vault retrieval w/ per-user namespaces), **Workflow** (the BPMN pipeline), **Action Retrier**, **Rate Limiter**, plus built-in **crons/scheduled functions**. The **Workflow component replaces Inngest** for steps + retries + durable state + `awaitEvent` human gates — **with one real gap**: `awaitEvent` has **no built-in timeout** (needed for review-timeout→escalation) and there is **no built-in dead-letter queue**. Both have clean, verified workarounds (scheduled "timeout" event + `onComplete` failure handler → dead-letter table). **Do NOT keep Inngest alongside Convex** — running both doubles orchestration surface for zero benefit at this scale; 2026 Convex practitioners use the Workflow component. (Confidence: HIGH on capability, HIGH on the timeout gap — it's a tracked GitHub issue.)
2. **Auth:** Recommend **Convex Auth** for the beta (official, zero external sync, data stays in your Convex DB — preserves the exact data-ownership rationale that drove the original Better Auth pick) with a **manual invite-code table**. If you want native organization/invitation/admin plugins now, use the **`@convex-dev/better-auth` component** (also keeps data in Convex) — but it is **pre-1.0 (~0.10.x)**, so accept that risk. **Avoid Clerk** (hosts user data externally, conflicts with the compliance posture). (Confidence: HIGH on Convex Auth; MEDIUM on better-auth-component version.)
3. **Vector search:** Built-in vector search is **sufficient for the beta vault** but has hard ceilings: **2–2048 dimensions**, **≤256 results/query**, **only the first 100,000 docs per table are indexed**, **16 filter fields**, **equality/OR filters only** (no range/post-filter). Use the **RAG component** (namespaces = per-tenant isolation, chunking, hybrid via the Agent component). **Model graph nodes/edges as two Convex tables** with compound indexes; traversal = bounded iterative indexed lookups (NOT a graph query language). (Confidence: HIGH.)
4. **Realtime UX:** Convex **queries are reactive subscriptions by default** — `useQuery` auto-pushes updates. This is a straight upgrade over the Postgres-poll model for live pipeline status + the review queue. (Confidence: HIGH.)
5. **Python sidecars:** Presidio + graphify run as **containers off Convex** (Fly.io/Railway/Cloud Run). Convex **actions call them via `fetch`** (10-min action limit, `AbortController` timeout, wrapped in **Action Retrier**). Attachments: **Convex file storage** (no size cap, but 2-min upload timeout → use client **upload URLs**, not httpActions which cap at 20MB). (Confidence: HIGH.)
6. **Audit/compliance:** Convex is **SOC 2 Type II**, offers a **HIPAA BAA**, AES-256 at rest. BUT Convex has **no cryptographically-enforced append-only/immutable table** — any mutation can patch/delete. Mitigate with a write-only audit module (no update/delete functions exposed) + **scheduled export to WORM storage (S3 Object Lock)** for true immutability/retention. (Confidence: HIGH on certs; HIGH on the immutability gap.)
7. **Scheduled functions:** Use `scheduler.runAfter(15*60*1000, ...)` at session start as the **voice watchdog**; use **crons** for Gmail 7-day token refresh. Native, durable, no extra infra. (Confidence: HIGH.)
8. **Deployment topology:** **Next.js on Vercel + Convex Cloud.** The `packages/*` modular-monolith **survives as pure-TS domain libraries**; the Convex `convex/` directory becomes the single "worker," organized into module folders that import those packages. `apps/api` mostly **dissolves** into Convex functions (queries/mutations/actions + httpActions for OAuth callbacks/webhooks). Convex **preview deployments** pair with Vercel preview envs. (Confidence: HIGH.)
9. **LLM cache:** A **Convex table** keyed on `(tenantId, safeTextHash, model, promptVersion)` with an `expiresAt` field; **lazy eviction on read + a cron sweep**. No Redis. (Confidence: HIGH.)
10. **Rate limiting / kill-switch:** **Rate Limiter component** (transactional token-bucket/fixed-window, per-tenant) for request + spend budgets; the cost kill-switch is a spend-ledger check inside workflow steps that aborts + dead-letters when exceeded. (Confidence: HIGH.)

---

## Recommended Stack (Convex-based)

### Core Technologies

| Technology | Version (mid-2026) | Purpose | Why Recommended |
|------------|--------------------|---------|-----------------|
| Convex | latest cloud (client `convex` ~1.2x+ line) | Database + reactive queries + serverless functions + vector search + file storage + scheduling — the whole data/orchestration plane | Single backend replaces Postgres+pgvector+Redis+Inngest; reactive subscriptions built-in; TypeScript end-to-end; owner decision |
| Convex Workflow component | `@convex-dev/workflow` 0.2.x | Durable BPMN pipeline (steps, retries, delays, `awaitEvent` human gates, `onComplete`) | Step-native durable execution with exactly-once mutations + configurable action retries; survives restarts; replaces Inngest |
| Convex Agent component | `@convex-dev/agent` (0.x, actively developed) | Thread/message persistence, per-user memory, hybrid vector+text search over thread history, tool loops | Persistent chat history + built-in hybrid retrieval for the executive-agent and voice-brief threads; wraps AI SDK |
| Convex RAG component | `@convex-dev/rag` (0.x) | Knowledge-vault ingestion + retrieval (chunking, namespaces, custom filtered vector search) | Per-user **namespaces** = tenant isolation for free; configurable chunking; sits on Convex vector search |
| Convex Action Retrier | `@convex-dev/action-retrier` (0.x) | Reliable calls to Presidio/graphify/LLM/email sidecars | Exponential backoff + jitter for flaky external HTTP; the durable wrapper around every `fetch` to a sidecar |
| Convex Rate Limiter | `@convex-dev/rate-limiter` (0.x) | Per-tenant request + cost-budget enforcement; kill-switch primitive | Transactional, fair, sharded application-layer rate limits — the budget guardrail |
| Next.js | 16.2.x | Web app (App Router, RSC) | **KEPT** — unchanged; `ConvexProvider` + `convex/react` for reactive data |
| pnpm | 10.x | Package manager / workspaces | **KEPT** |
| Turborepo | 2.x | Build/task orchestration + caching | **KEPT** — Convex ships an official Turborepo+Next.js+Convex monorepo template |
| Vercel AI SDK | v6 | LLM calls, tool loops, structured outputs | **KEPT** — runs inside Convex actions; the Agent component builds on it |
| Vercel AI Gateway | current | Provider-agnostic routing, primary/fallback | **KEPT** — called from Convex actions; still the model-routing layer |
| Convex Auth | `@convex-dev/auth` (0.x, official) | Auth for invite-only beta (magic-link/OTP + custom invite table) | **REPLACES Better Auth** for the beta; data stays in Convex (preserves data-ownership rationale); simplest for solo 4-week build |
| Presidio | 2.2.x (containers) | PII detection/anonymization sidecar | **KEPT** — containerized, called from Convex actions via `fetch` |
| graphify (Python) | project sidecar | Ingestion-time node/edge extraction for GraphRAG | **NEW** — containerized Python sidecar; output stored in Convex `graphNodes`/`graphEdges` tables |
| OpenAI Realtime (`gpt-realtime`) over WebRTC | GA | Live 15-min voice session | **KEPT** — ephemeral token minted by a Convex action/httpAction; watchdog = scheduled Convex function |
| gpt-4o-transcribe | GA | Async dictation/audio transcription | **KEPT** |
| Zod | 4.x | Contract source of truth | **KEPT** — bridge to Convex validators via `convex-helpers` (`zodToConvex`) |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `convex/react` | with `convex` | `useQuery`/`useMutation`/`useAction` reactive hooks | All client data binding; the live pipeline-status + review-queue UI |
| `convex-helpers` | latest | Zod↔Convex validator bridge, relationship/pagination helpers, custom functions (auth/tenant wrappers) | Enforce `tenantId` scoping in a `customQuery`/`customMutation` wrapper (the multi-tenancy linchpin) |
| `@convex-dev/better-auth` | ~0.10.x (pre-1.0) | Org/invitation/admin/magic-link plugins on Convex | ONLY if you need Better Auth's organization/invitation plugins now and accept pre-1.0 risk |
| `convex-test` | latest | Unit-test Convex functions in-memory | Testing queries/mutations/actions/workflows |
| `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` | v6-compatible | Provider adapters | Primary/fallback behind the AI Gateway, inside actions |
| Langfuse SDK (JS) | v4 | LLM tracing/prompt-mgmt/evals/feedback | **KEPT** — emit from Convex actions; feeds prompt-optimization loop |
| `googleapis` | latest | Gmail send adapter | **KEPT** — runs in a Convex action |
| `@microsoft/microsoft-graph-client` + `@azure/identity` | latest | MS Graph send adapter | **KEPT** — second `EmailProvider` impl |
| `unpdf` / `pdf-parse`, `tesseract.js` OR cloud OCR | latest | PDF/OCR extraction | Prefer offloading heavy OCR to the Python sidecar (Convex Node actions cap args at 5 MiB) |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Convex CLI (`npx convex dev`) | Local dev + codegen + schema push | Runs against a cloud dev deployment; hot-reloads functions |
| Convex Dashboard | Data browser, logs, function runner, cron/scheduler inspector | Replaces much of what Drizzle Studio + Inngest Dev Server did |
| Convex preview deployments | Per-branch isolated backends | Pair with Vercel preview envs (`--cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`) |
| Convex log streaming | Export logs to Axiom/Datadog | Complements Langfuse for infra-level observability |
| Biome | Lint/format | **KEPT** |
| Vitest + Playwright + convex-test | Unit/integration/e2e | **KEPT**, add `convex-test` |

---

## Installation

```bash
# Core Convex + components
pnpm add convex
pnpm add @convex-dev/workflow @convex-dev/agent @convex-dev/rag \
         @convex-dev/action-retrier @convex-dev/rate-limiter
pnpm add convex-helpers

# Auth (choose ONE)
pnpm add @convex-dev/auth            # recommended for beta
# pnpm add @convex-dev/better-auth better-auth   # if org/invite plugins needed now

# Web + AI (unchanged)
pnpm add next@^16.2 react react-dom ai@^6 @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google zod@^4

# Email adapters (unchanged)
pnpm add googleapis @microsoft/microsoft-graph-client @azure/identity

# Observability (unchanged)
pnpm add @langfuse/tracing @langfuse/otel

# Attachments (prefer sidecar for heavy OCR)
pnpm add unpdf

# Dev / test
pnpm add -D convex-test vitest @playwright/test @biomejs/biome typescript turbo

# NO LONGER NEEDED: drizzle-orm, drizzle-kit, drizzle-zod, postgres, ioredis, inngest
# Python sidecars (Presidio, graphify) run as containers, not npm packages
```

---

## Component Disposition (every original-stack item explicitly dispositioned)

| Original (STACK.md) | Disposition | Convex replacement / note |
|---------------------|-------------|---------------------------|
| pnpm + Turborepo | **KEPT** | Official Convex monorepo template uses both |
| Next.js 16.2 | **KEPT** | `ConvexProvider` + reactive hooks |
| **Inngest** (orchestration) | **REPLACED** | **Convex Workflow component** (+ Action Retrier + crons). Human gate via `awaitEvent`; timeout + dead-letter via workarounds (see limitations) |
| **PostgreSQL** | **DROPPED** | Convex is the database (document store + indexes) |
| **pgvector** | **REPLACED** | Convex built-in vector search + RAG component (ceilings apply — see limitations) |
| **Redis** | **DROPPED** | Cache → Convex table (§ LLM cache); rate-limit → Rate Limiter component; ephemeral state → Convex tables |
| **Drizzle ORM** | **DROPPED** | Convex schema (`defineSchema`/`v`) + query API; Zod↔Convex via `convex-helpers` |
| Vercel AI SDK v6 | **KEPT** | Runs inside Convex actions; Agent component builds on it |
| Vercel AI Gateway | **KEPT** | Called from actions |
| **Better Auth** | **REPLACED (recommendation change)** | **Convex Auth** for the beta (data still in your DB). `@convex-dev/better-auth` is the pre-1.0 alternative if org/invite plugins are wanted now |
| OpenAI Realtime / WebRTC | **KEPT** | Ephemeral token via Convex action; watchdog via scheduled function |
| gpt-4o-transcribe | **KEPT** | Called from actions |
| Presidio (Docker) | **KEPT** | Called from actions via `fetch` + Action Retrier |
| Email (googleapis + Graph) | **KEPT** | Adapters run in actions; OAuth callbacks via httpActions |
| Langfuse + OpenTelemetry | **KEPT** | Emit traces from actions; add Convex log streaming for infra |
| Zod v4 | **KEPT** | Contract SoT; bridge to Convex validators |
| Vitest + Playwright | **KEPT** | Add `convex-test` |
| Biome | **KEPT** | — |
| unpdf / tesseract | **KEPT (relocated)** | Prefer Python sidecar for heavy OCR (Node action 5 MiB arg cap) |
| — | **NEW** | Convex Workflow / Agent / RAG / Action Retrier / Rate Limiter components; graphify Python sidecar |

---

## Detailed Rationale for Contested Decisions

### 1. Orchestration: Convex Workflow component (replaces Inngest)

The BPMN pipeline (validate → enrich → route → ground → PII → cost → cache → LLM → review → deliver → feedback) maps directly onto the Workflow component:

- **Steps** are regular Convex queries/mutations/actions; results are journaled. If the server crashes mid-workflow it resumes from the last completed step. Mutations run **exactly-once**; actions have **configurable retries** (`maxAttempts`, `initialBackoffMs`, exponential backoff + jitter).
- **Human review gate** = `step.awaitEvent(...)`; the browser/edge fires `sendEvent` on approve/edit/reject. The workflow can pause **indefinitely without consuming resources**.
- **`onComplete`** runs exactly-once on success OR failure — the natural hook for dead-letter + audit finalization.
- **No worker fleet, no determinism constraint** — same advantages that made Inngest the original pick, now native to the backend.

**Two gaps you must design around (both verified):**
- **`awaitEvent` has NO built-in timeout** ([tracked issue #177](https://github.com/get-convex/workflow/issues/177)). Your review-timeout→escalation requirement needs a workaround: at the point you enter the review gate, `scheduler.runAfter(timeoutMs, sendTimeoutEvent)` a mutation that fires a `review-timeout` event; the workflow races the real decision vs. the timeout event and branches to escalation. Cancel the scheduled timeout on a real decision.
- **No built-in dead-letter queue.** Implement DLQ in `onComplete`: on failure, insert the failed context into a `deadLetter` table + notify. (The separate `convex-mq` component offers visibility-timeout + DLQ semantics if you want a queue abstraction, but for a linear pipeline the `onComplete` pattern is simpler.)

**Do NOT keep Inngest alongside Convex.** Running an external orchestrator against a Convex data plane means two state stores, two retry models, and event round-trips between them — pure overhead at beta scale. 2026 Convex practitioners consolidate on the Workflow component (see the Convex "Agents Need Durable Workflows" and "reimplementing Mastra" posts).

**Concurrency ceiling to respect:** `maxParallelism` limits concurrent steps per workpool; **on Pro, keep total concurrent steps across all workflows/workpools under ~100.** Any number of workflows can be *in-flight* (paused/awaiting); the cap is on simultaneously-*executing* functions. Fine for beta; note it for scale.

### 2. Auth: Convex Auth (replaces Better Auth for the beta)

The original chose Better Auth specifically to keep credentials in *your own* DB (a compliance/data-ownership win) with native invite/org support. On Convex:

- **Convex Auth** keeps all user data **in your Convex DB** — it preserves the exact data-ownership rationale, is the official library, requires zero external sync, and supports magic-link/OTP. For an **invite-only beta**, add a `betaInvites` table (email + code + status); gate sign-up on a valid invite. This is ~30 lines and avoids a pre-1.0 dependency.
- **`@convex-dev/better-auth` (~0.10.x)** is the alternative if you want the **organization / invitation / admin** plugins *now* (they map to the deferred RBAC roadmap) — it also stores data in Convex. Cost: it is **pre-1.0** and moving fast; acceptable for a solo dev tracking releases, riskier for "any engineer owns it."
- **Clerk** remains the most featureful (SSO/MFA out of the box) but **hosts user data externally** — it contradicts the compliance/data-sovereignty posture that PROJECT.md and PITFALLS.md lean on. Use only if auth features become a bottleneck.

**Recommendation:** Convex Auth + custom invite table for v1; migrate to the better-auth component when org/RBAC lands (next milestone).

### 3. Vector search + GraphRAG modeling

**Built-in vector search limits (verified against docs):**
- Dimensions **2–2048**. **Consequence:** OpenAI `text-embedding-3-large` (3072) **exceeds the cap** — either use `text-embedding-3-small` (**1536**, recommended for the vault) or request `text-embedding-3-large` with `dimensions ≤ 2048`.
- **≤256 results per query**; **only the first 100,000 documents per table are vector-indexed**; **16 filter fields**; filters are **equality/OR only** (`q.eq`, `q.or`) — **no range filters, no arbitrary post-filtering** in the index.
- **4 vector indexes per table.**

For the beta (single user's briefs + docs, well under 100k chunks) this is **sufficient**. Use the **RAG component**: its **namespaces** give per-tenant isolation directly (each user = a namespace), it handles chunking (fixed/semantic/custom) and chunk-context expansion, and the **Agent component** layers hybrid vector+text search over thread messages. Beyond ~100k chunks/table you must **shard by tenant into separate tables/namespaces** or move that corpus to a dedicated engine — flag this as the vault's scale ceiling.

**Graph nodes/edges in Convex documents (no native graph DB):**
- `graphNodes` table: `{ tenantId, nodeId, type, label, embedding?, sourceRef, ... }` — index `by_tenant_type`, and a vector index for seed retrieval.
- `graphEdges` table: `{ tenantId, from, to, relation, weight, sourceRef }` — indexes `by_tenant_from` and `by_tenant_to` for forward/backward traversal.
- **Traversal = bounded iterative indexed lookups** inside a query/action (not a Cypher-style query). Hybrid GraphRAG at query time: (1) vector-search seed nodes via RAG/built-in, (2) expand 1–2 hops via the edge indexes, (3) combine + rank. **Respect the 4,096 index-reads and 32,000-docs-scanned per-transaction limits** — deep/unbounded traversal must be **hop-capped** and, if large, split across scheduled steps rather than one query. This mirrors the agent-loop "hard iteration cap" discipline from PITFALLS.md.

### 4. Realtime UX (subscriptions)

Convex **queries are live subscriptions by default**: any `useQuery` re-renders automatically when underlying data changes, with end-to-end reactivity and no polling. The **live pipeline-status view** (workflow writes step progress to a `requestStatus` doc → client subscribes) and the **review queue** (subscribe to `reviews where tenantId = me and status = pending`) are trivial and real-time. This is a genuine upgrade over the Postgres+poll model in the original stack. (Confidence: HIGH.)

### 5. Python sidecars + file storage

- **Presidio and graphify cannot run on Convex** (no Python runtime). Host them as **containers** (Fly.io / Railway / Cloud Run). Convex **actions call them with `fetch`** — actions allow outbound fetch, run up to **10 minutes**, and support up to 1000 concurrent ops. Wrap each call in the **Action Retrier** (backoff + jitter) and use an `AbortController` for per-call timeouts. **httpActions are for inbound** (OAuth callbacks, provider webhooks, minting ephemeral voice tokens), capped at **20 MB request/response**.
- **Attachment file storage:** Convex file storage has **no hard file-size limit**, but the upload POST has a **2-minute timeout**, and httpAction bodies cap at 20 MB. **For OCR/PDF/audio, upload directly from the client via a generated upload URL** (bypasses the 20 MB httpAction limit), store the `storageId`, and have the sidecar fetch the file via a signed `getUrl`. Do NOT stream large files through an httpAction.
- **Redaction ordering (PITFALLS #6/#8 preserved):** the PII action calls Presidio, and only `safeText` + refs are written to durable tables — redact-then-write stays a workflow-step ordering contract.

### 6. Audit / compliance

- **Certs (verified):** Convex is **SOC 2 Type II**, provides a **HIPAA BAA** (sign it before processing PHI), GDPR-compliant, **AES-256 at rest**, hosted on AWS. This *meets or exceeds* the self-hosted-Postgres posture for the beta.
- **The real gap: no cryptographically-enforced immutability.** Convex tables are mutable — any mutation with access can `patch`/`delete`. There is no WORM/append-only table primitive. **Mitigations:**
  1. Isolate audit writes in an `audit` module that **exposes only insert functions** (no update/delete) — enforced by code review + the "any engineer owns one module" doc discipline.
  2. **Scheduled export to external immutable storage** (S3 **Object Lock** / compliance-mode WORM bucket) via a cron/action — this is where true immutability + long retention lives; Convex holds the hot copy.
  3. Use **Convex snapshot export** for portability/DR and periodic archival.
- **Retention:** implement via `expiresAt` + a cron sweep on hot audit rows once exported to WORM; keep the WORM copy per the compliance retention policy.

### 7. Scheduled functions (watchdog + token refresh)

- **Voice 15-min watchdog (PITFALLS #4):** at session start, `scheduler.runAfter(15*60*1000, forceCloseSession)`. The scheduled function marks the session ended, triggers the idempotent finalize-brief step, and bill-stops — **server-authoritative, survives tab-close/disconnect**, exactly what the pitfall demands. Store `scheduledFnId` so a clean End-session can cancel it.
- **Gmail 7-day test-token refresh (PITFALLS #1):** a **cron** scans tokens nearing expiry, attempts refresh, and on `invalid_grant` writes a notification + flags the user for re-consent. Native scheduling, no external cron infra.
- Limits: up to **1,000,000 outstanding scheduled functions**; a single mutation can schedule up to **1000**. Ample.

### 8. Deployment topology + monorepo layout

- **Topology:** Next.js on **Vercel** + **Convex Cloud**. Vercel serves the UI/route handlers; Convex hosts data + all backend functions. Build via `convex deploy --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` from the backend package (official monorepo pattern).
- **Env/secrets:** Convex has its **own environment variables** (dashboard/CLI) for server-side secrets (LLM keys, Presidio URL, OAuth client secrets, Graph creds) — **secrets live in Convex, not Vercel**, for anything a Convex function touches. Vercel holds only `NEXT_PUBLIC_CONVEX_URL` + client-safe vars. Declare env in `turbo.json` for cache-correctness.
- **Preview envs:** Convex **preview deployments** create isolated backends per branch, paired with Vercel preview deploys.
- **Does `packages/*` survive? YES, re-shaped.** Convex requires all deployed functions in one `convex/` directory per deployment, so the "one worker holds the pipeline" idea becomes **the `convex/` directory**. Keep the **~15 domain services as pure-TS `packages/*` libraries** (validation, executive-agent, pii, cost, llm-gateway, delivery, grounding, feedback, prompt-optimizer, audit, notifications, contracts, core) — the Convex functions are **thin adapters that import them**. This preserves strict separation-of-concerns + per-module README/CONTRACT/RUNBOOK, AND is the **lock-in mitigation** (domain logic stays portable; only the thin `convex/` adapter is Convex-specific).

```
pikar-ai/
├── apps/
│   └── web/                    # Next.js (intake UI, review dashboard, WebRTC voice client)
├── packages/
│   ├── backend/                # THE Convex project: convex/ dir + schema + components config
│   │   └── convex/
│   │       ├── schema.ts        # tables incl. graphNodes/graphEdges, llmCache, audit, deadLetter
│   │       ├── convex.config.ts # app.use(workflow/agent/rag/rateLimiter/actionRetrier)
│   │       ├── pipeline/         # the Workflow definition + step functions (the old apps/worker)
│   │       ├── voice/            # ephemeral token httpAction + watchdog scheduled fn
│   │       ├── http.ts           # OAuth callbacks, provider webhooks
│   │       └── crons.ts          # token refresh, cache/audit sweeps
│   ├── contracts/  core/        # Zod SoT + shared (import into convex functions)
│   ├── validation/ attachments/ executive-agent/ grounding/ pii/ cost/
│   ├── llm-gateway/ delivery/ feedback/ prompt-optimizer/ notifications/ audit/
│   └── (each = pure-TS lib, no Convex import, imported BY convex functions)
├── sidecars/
│   ├── presidio/               # Dockerized Presidio analyzer+anonymizer
│   └── graphify/               # Dockerized Python extraction service
└── turbo.json / pnpm-workspace.yaml
```

- **`apps/api` mostly dissolves:** intake, review actions, and token minting become Convex mutations/actions/httpActions. What remains on Next.js is UI + any OAuth redirect route handlers.

### 9. LLM cache (no Redis)

A `llmCache` table: `{ tenantId, cacheKey, model, promptVersion, response, tokens, createdAt, expiresAt }` with a compound index `by_tenant_key`. **`cacheKey = hash(tenantId + safeText + modelParams + promptVersion)`** — the tenant namespace is baked in (PITFALLS #7 preserved). **Eviction:** lazy (on read, ignore/delete rows past `expiresAt`) + a **cron sweep** for cold rows. Grounded/context-injected responses remain **not shared-cached** per the pitfall. Convex's transactional reads make check-then-store race-free without Redis.

### 10. Rate limiting / cost kill-switch

- **Rate Limiter component** for per-tenant request throttling (token-bucket/fixed-window, transactional, sharded, fair queuing) — the request-rate guardrail.
- **Cost kill-switch:** a `spendLedger` table per tenant/day; each LLM step reads the running total *before* generating and **aborts + dead-letters** if the budget is exceeded (the "budget as kill-switch, not advisory" mandate from PITFALLS #5). Combine with the agent-loop hard iteration cap + tool-repetition detector implemented in the `executive-agent` package. Because ledger reads/writes are transactional in Convex, the check is race-free across concurrent steps.

---

## Convex Limitations & Mitigations

| Limitation | Impact on Pikar | Mitigation | Confidence |
|------------|-----------------|------------|------------|
| **`awaitEvent` has no timeout** | Review-timeout→escalation can't be expressed directly | `scheduler.runAfter` a `review-timeout` event; workflow races decision vs timeout; cancel on real decision | HIGH (tracked issue) |
| **No built-in dead-letter queue** | DLQ requirement (spec) has no native primitive | Insert failures into a `deadLetter` table in `onComplete`; or adopt `convex-mq` for queue semantics | HIGH |
| **No enforced append-only/immutable table** | Audit-immutability mandate not cryptographically guaranteed | Insert-only audit module (no update/delete fns) + scheduled export to S3 Object Lock (WORM) for true immutability/retention | HIGH |
| **Vector: 2048-dim cap** | `text-embedding-3-large` (3072) unusable at full dim | Use `text-embedding-3-small` (1536) or set `dimensions ≤ 2048` | HIGH |
| **Vector: only first 100k docs/table indexed; ≤256 results; equality-only filters** | Vault scale ceiling; no range/complex filtering in-index | Fine for beta; shard by tenant table/namespace as corpus grows; do complex filtering in app code post-fetch | HIGH |
| **No graph query language** | GraphRAG traversal is manual | Model nodes/edges as tables + compound indexes; hop-capped iterative traversal; split large traversals across steps | HIGH |
| **Transaction limits** (32k docs scanned, 4,096 index reads, 16 MiB read, 16k writes) | Deep graph traversal / bulk ops can hit ceilings | Hop-cap + paginate + move heavy work to actions/scheduled steps | HIGH |
| **Action 10-min limit; Node action args 5 MiB** | Long OCR / big-file processing | Offload heavy OCR to Python sidecar; chunk work; client upload URLs for big files | HIGH |
| **httpAction 20 MB body cap; upload 2-min timeout** | Large PDF/audio ingestion | Client-generated upload URLs (bypass httpAction); sidecar fetches via signed getUrl | HIGH |
| **~100 concurrent executing steps (Pro)** across workflows/workpools | Fan-out ceiling at scale | Fine for beta; tune `maxParallelism`; queue/shard at scale | MEDIUM (Pro-tier guidance) |
| **Vendor lock-in (proprietary backend)** | Migration away = function rewrite | Keep ALL domain logic in pure-TS `packages/*`; `convex/` stays a thin adapter; use snapshot export for data portability; self-hostable `convex-backend` exists as an escape hatch | MEDIUM |
| **Key components are pre-1.0** (Workflow 0.2.x, Agent/RAG/better-auth 0.x) | API churn risk during the build | Pin versions; track changelogs; the solo+Claude-Code model absorbs churn better than a team; core Convex (DB/functions/vector/scheduling) is stable/GA | MEDIUM |

---

## Mapping Original Pitfalls onto Convex

| Pitfall (PITFALLS.md) | Convex disposition |
|-----------------------|--------------------|
| #1 Google OAuth 7-day token | **Unchanged risk**; refresh handled by a Convex **cron** + notification (better than before) |
| #2 Graph `.default`/over-permission | **Unchanged**; adapter logic runs in a Convex action |
| #3 Realtime cost blowout | **Unchanged**; metering/pruning in the voice action; watchdog via scheduled fn |
| #4 Orphaned voice sessions | **Improved**; `scheduler.runAfter` watchdog is server-authoritative and durable |
| #5 Agent loop runaway | **Improved**; transactional `spendLedger` kill-switch + iteration caps in `executive-agent` |
| #6 PII false confidence | **Unchanged**; redact-then-write is a workflow-step contract |
| #7 Cross-tenant cache leak | **Improved**; RAG namespaces + tenant-scoped `cacheKey` + a `customQuery` tenant wrapper make omitting `tenantId` hard |
| #8 Audit PII honeypot | **Unchanged ordering**; PLUS new immutability gap (see limitations) → WORM export |
| #9 Prompt-opt reward hacking | **Unchanged**; loop is app logic; version prompts in a Convex table with rollback |
| #10 Orchestration learning curve | **Reduced**; Workflow component is simpler than Inngest+Temporal class, but its **pre-1.0 API + the timeout/DLQ workarounds are the new learning cost** |
| #11 Email provider scope creep | **Unchanged**; sequence Gmail before Graph |
| #12 Multi-tenant isolation | **Improved**; enforce via a `convex-helpers` `customQuery`/`customMutation` that injects `tenantId`; RAG namespaces |

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Convex Workflow component | Keep Inngest alongside Convex | Never at this scale — only if you already had massive Inngest investment to preserve |
| Convex Workflow component | `convex-mq` for pipeline | If you want explicit queue + visibility-timeout + native DLQ semantics over a linear workflow |
| Convex Auth | `@convex-dev/better-auth` (0.10.x) | Need org/invitation/admin plugins now; accept pre-1.0 |
| Convex Auth | Clerk | Need SSO/MFA out-of-box and can accept externally-hosted user data |
| Built-in vector + RAG component | Dedicated vector DB (Qdrant/Pinecone) | Vault exceeds ~100k chunks/table or needs advanced filtered/hybrid at scale |
| Convex file storage | S3/R2 direct | Very large media pipelines or existing object-store tooling |
| Convex Auth data-in-DB | — | — |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Inngest **and** Convex together | Two orchestrators/state stores; round-trip overhead; no benefit at beta scale | Convex Workflow component alone |
| Postgres/pgvector/Redis/Drizzle | Superseded by the Convex decision; running them defeats the consolidation | Convex DB + vector search + RAG + tables |
| `text-embedding-3-large` at 3072 dims | Exceeds Convex's 2048 vector-dim cap | `text-embedding-3-small` (1536) or 3-large @ ≤2048 dims |
| Streaming large files through httpActions | 20 MB body cap; 2-min upload timeout | Client-generated upload URLs; sidecar fetches via signed getUrl |
| Treating a Convex table as an immutable audit log | No enforced WORM; mutations can delete/patch | Insert-only audit module + export to S3 Object Lock |
| Deep/unbounded graph traversal in one query | Hits 4,096 index-read / 32k-scan transaction limits | Hop-capped traversal split across scheduled steps |
| Clerk (for this product) | External user-data hosting conflicts with data-sovereignty posture | Convex Auth |
| Python OCR inside a Convex Node action | 10-min + 5 MiB arg limits; no Python runtime | Containerized sidecar called via fetch + Action Retrier |

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `convex` client ~1.2x line | Next.js 16.2 / React 19 | `convex/react` reactive hooks; App Router OK |
| `@convex-dev/workflow` 0.2.x | `@convex-dev/workpool` (transitive) | Respect Pro ~100 concurrent-step guidance |
| `@convex-dev/agent` 0.x | AI SDK v6 | Agent builds on the AI SDK; keep providers at v6 |
| `@convex-dev/rag` 0.x | Convex vector search | Namespaces = per-tenant; embeddings ≤2048 dims |
| `@convex-dev/auth` 0.x | Next.js middleware | Official; data in Convex |
| `@convex-dev/better-auth` ~0.10.x | `better-auth` core | Pre-1.0; pin exact versions |
| `convex-helpers` latest | `zod` 4.x | `zodToConvex` bridges contracts↔validators |
| OpenAI `text-embedding-3-small` | Convex vector index | 1536 dims — safely under the 2048 cap |

---

## Revised Build-Order Implications

The original 7-phase order (Foundation → Thin Slice → Guardrails → Enrichment → Voice → Self-Improvement → Beta) **still holds**. Convex changes *what* gets built in the early phases, not the sequence:

- **Phase 1 (Foundation) now includes:** Convex project + schema (`tenantId` on every table), `convex.config.ts` wiring the Workflow/Agent/RAG/RateLimiter/ActionRetrier components, Convex Auth + `betaInvites` table, the `customQuery`/`customMutation` **tenant-scoping wrapper** (isolation linchpin), the insert-only `audit` module, and the **WORM export cron stub**. The pipeline skeleton is a Workflow with the `awaitEvent`-timeout and `onComplete`-DLQ patterns established up front (they are the new "learning cost" — do them once, early).
- **Phase 2 (Thin Slice):** the Workflow with real steps; live status via reactive `useQuery`; review queue as a subscription. Cheaper than before (no Inngest wiring, no separate API app).
- **Phase 3 (Guardrails):** LLM cache table, Rate Limiter, `spendLedger` kill-switch, Presidio sidecar call via Action Retrier. Redact-then-write enforced as step order.
- **Phase 4 (Enrichment):** RAG component ingestion (namespaced per tenant), `graphNodes`/`graphEdges` tables + graphify sidecar; hop-capped GraphRAG retrieval. **Watch the 100k-chunk/table and 2048-dim ceilings here.**
- **Phase 5 (Voice):** ephemeral token via httpAction; watchdog via `scheduler.runAfter`; big-audio upload via client upload URLs.
- **Phase 6–7:** unchanged in intent; Gmail token refresh becomes a cron.

**New foundational decisions to lock at roadmap time (Convex-specific):**
1. `awaitEvent`-timeout pattern (scheduled event race) — adopt in Phase 1, reused by every human gate.
2. Audit immutability = insert-only module + WORM export — decided Phase 1 (the immutability guarantee lives *outside* Convex).
3. Embedding model/dimension (`text-embedding-3-small` @1536) — fixed before vault build.
4. Domain-logic-stays-in-`packages/*` discipline — the lock-in mitigation; enforce from commit one.

---

## Sources

Official Convex docs (HIGH):
- [Vector Search — limits: 2–2048 dims, ≤256 results, first 100k docs, 16 filters](https://docs.convex.dev/search/vector-search)
- [Platform Limits — action 10 min, doc 1 MiB, 4 vector indexes/table, 16 filters, tx read/write caps, scheduling caps](https://docs.convex.dev/production/state/limits)
- [Actions — 10-min limit, fetch, 1000 concurrent ops, Node 5 MiB args](https://docs.convex.dev/functions/actions)
- [HTTP Actions — 20 MB request/response cap](https://docs.convex.dev/functions/http-actions)
- [File Storage — no size limit, 2-min upload timeout, upload URLs](https://docs.convex.dev/file-storage/upload-files)
- [Cron Jobs / Scheduling](https://docs.convex.dev/scheduling) · [Cron Jobs](https://docs.convex.dev/scheduling/cron-jobs)
- [AI Agents](https://docs.convex.dev/agents) · [Agent Workflows](https://docs.convex.dev/agents/workflows) · [Authentication](https://docs.convex.dev/auth)
- [Platform Security — SOC 2 Type II, HIPAA BAA, AES-256 at rest, GDPR](https://www.convex.dev/security)

Convex components (HIGH on capability):
- [Workflow component](https://www.convex.dev/components/workflow) · [Workflow README](https://github.com/get-convex/workflow/blob/main/README.md) · [`awaitEvent` timeout gap — issue #177](https://github.com/get-convex/workflow/issues/177)
- [RAG component — namespaces, chunking, filtered vector search](https://www.convex.dev/components/rag)
- [Agent component — threads/memory/hybrid search](https://www.npmjs.com/package/@convex-dev/agent) · [get-convex/agent](https://github.com/get-convex/agent)
- [Rate Limiter component](https://www.convex.dev/components/rate-limiter) · [Action Retrier component](https://www.convex.dev/components/retrier) · [Workpool](https://www.convex.dev/components/workpool)
- [Better Auth component](https://labs.convex.dev/better-auth) · [get-convex/better-auth](https://github.com/get-convex/better-auth) (~0.10.x, pre-1.0 — MEDIUM)
- [Convex Auth](https://www.convex.dev/auth) · [Convex + Clerk](https://docs.convex.dev/auth/clerk)

Monorepo/deploy (HIGH/MEDIUM):
- [Convex + Turborepo + Next.js monorepo template](https://github.com/get-convex/turbo-expo-nextjs-clerk-convex-monorepo) · [Web Deployment (DeepWiki)](https://deepwiki.com/get-convex/turbo-expo-nextjs-clerk-convex-monorepo/7.1-web-deployment)
- [Convex monorepo template](https://www.convex.dev/templates/monorepo)

Practitioner (MEDIUM, cross-checked):
- [Agents Need Durable Workflows and Strong Guarantees — Convex Stack](https://stack.convex.dev/durable-workflows-and-strong-guarantees)
- [I reimplemented Mastra workflows and I regret it — Convex Stack](https://stack.convex.dev/reimplementing-mastra-regrets)
- [Automatically Retry Actions — Convex Stack](https://stack.convex.dev/retry-actions)

---
*Convex stack revision for: governed agentic AI operating layer (Pikar-AI)*
*Researched: 2026-07-09 · Supersedes the data/orchestration plane of STACK.md (2026-07-08)*
