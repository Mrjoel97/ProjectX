# Stack Research

**Domain:** Governed agentic AI operating layer (AI chief-of-staff web platform) — voice/text intake, durable multi-step orchestration, RAG, guardrails, human review, email delivery
**Researched:** 2026-07-08
**Confidence:** HIGH (most core choices verified against official docs/releases; a few integration-layer choices MEDIUM)

---

## Executive Recommendation (one-liner per decision)

| Decision | Recommendation | Confidence |
|----------|---------------|------------|
| Monorepo | pnpm workspaces + Turborepo | HIGH |
| Web framework | Next.js 16.2 (App Router, Node 20+) | HIGH |
| Orchestration | **Inngest** (event-driven durable steps) | HIGH |
| AI SDK | Vercel AI SDK v6 | HIGH |
| LLM gateway | Vercel AI Gateway + thin custom budget/cache layer | MEDIUM-HIGH |
| Realtime voice | OpenAI Realtime API (gpt-realtime) over **WebRTC** (browser), ephemeral tokens minted server-side | HIGH |
| Async transcription | gpt-4o-transcribe | HIGH |
| Vector store | **pgvector** (HNSW + halfvec) in the primary Postgres | HIGH |
| PII detection | Microsoft Presidio as a Dockerized microservice + regex prefilter (hybrid) | MEDIUM-HIGH |
| Auth | **Better Auth** (self-hosted, magic-link/invite, org plugin) | HIGH |
| Email | Own adapter: `googleapis` (Gmail) + `@microsoft/microsoft-graph-client` (Graph). **Not** Nylas | HIGH |
| Observability | **Langfuse** (LLM traces/prompts/evals) + OpenTelemetry (infra) — both | HIGH |
| Validation/contracts | Zod v4 as single source of truth → OpenAPI generation | MEDIUM-HIGH |
| Testing | Vitest (unit/integration) + Playwright (e2e) | HIGH |
| CI | GitHub Actions + Turborepo remote cache | HIGH |
| ORM | **Drizzle** (code-first, SQL-close, pgvector-friendly) | HIGH |

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 20 LTS (or 22 LTS) | Runtime for all services | Next.js 16 requires Node 20+; 22 LTS is the safer long-horizon target |
| TypeScript | 5.7+ | Language across monorepo | Mandated; ecosystem baseline |
| pnpm | 10.x | Package manager / workspaces | Strict dep isolation catches phantom deps; disk-efficient; `workspace:*` protocol is the monorepo standard |
| Turborepo | 2.x | Build/task orchestration + caching | Incremental task graph + remote cache turns 30s builds into 0.2s; pairs natively with pnpm and Vercel |
| Next.js | 16.2.x (latest stable 16.2.9, June 2026) | Web app (App Router, RSC, route handlers) | Turbopack default (2-5x faster builds), React Compiler stable, Cache Components; the platform's flagship framework and deploy target |
| PostgreSQL | 16/17 | Primary datastore + vector + audit + queue-of-record | Single source of truth; pgvector, JSONB, and strong transactional guarantees satisfy audit/compliance mandate |
| pgvector | 0.8.x (halfvec, HNSW) | Vector search over briefs/documents | Removes a moving part; comfortably handles up to ~10M 1536-dim vectors on one instance with HNSW + halfvec |
| Redis | 7.x | LLM response cache (safeTextHash), rate limiting, ephemeral state | Fast exact-hash cache lookup/store; standard for token/cost caching and rate limits |
| Drizzle ORM | latest (0.4x → 1.0 track) | Type-safe DB access + migrations | Code-first TS schemas (matches mandate), thin SQL wrapper lets you drop to raw SQL for pgvector ops, tiny bundle, serverless-friendly |
| Inngest | latest SDK (`inngest` 3.x) | Durable orchestration engine (the BPMN runtime) | Event-driven step functions with retries, `waitForEvent` (human review loop), flow control (concurrency/throttle/rate-limit/debounce for cost guardrails), no worker fleet to run, no determinism constraint (critical for LLM steps), self-hostable later |
| Vercel AI SDK | v6 | LLM calls, tool loops, agents, structured outputs, streaming | Unified provider interface, `Agent`/`ToolLoopAgent` abstractions, native human-in-the-loop tool approval, MCP support, type-safe structured outputs |
| Better Auth | 1.x | Auth, invite/magic-link, per-user isolation | Self-hosted (credentials in your Postgres — compliance win), invitations + organization plugin built-in, no per-user pricing, integrates with Drizzle |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod | 4.x | Runtime validation + contract source of truth | All boundary validation (intake, tool I/O, data contracts). Generate OpenAPI + infer TS types from one schema |
| drizzle-zod | latest | Derive Zod schemas from Drizzle tables | Keep DB schema and validation contracts in sync |
| @hono/zod-openapi *or* zod-to-openapi | latest | Generate OpenAPI from Zod | Per-service contract docs (satisfies "every service gets a contract" mandate) |
| @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google | v6-compatible | Provider adapters for primary/fallback | Wire primary + fallback models behind AI SDK |
| Langfuse SDK (JS/TS) | v4 (needs Langfuse platform ≥3.95) | LLM tracing, prompt mgmt, evals, feedback capture | Trace every model call/cost/token; prompt management feeds the prompt-optimization loop; feedback scores drive threshold breach |
| @opentelemetry/* | latest | Infra/service tracing + metrics | App-level spans, DB/HTTP instrumentation; Langfuse consumes OTel spans so they interoperate |
| googleapis | latest | Gmail API delivery adapter | Concrete implementation behind your email port |
| @microsoft/microsoft-graph-client + @azure/identity | latest | Microsoft Graph email delivery adapter | Second implementation behind the same email port |
| ioredis (or node-redis) | latest | Redis client | Cache + rate-limit + ephemeral state access |
| Playwright | latest | E2E / browser tests | Voice UI, review loop, auth flows |
| Vitest | 3.x | Unit + integration tests | Fast, ESM-native, Vite-powered; pairs with Turborepo |
| pdf-parse / unpdf, tesseract.js (or a cloud OCR) | latest | Attachment extraction (PDF/OCR) | Attachment classify → extract → merge into context |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Turborepo remote cache | Speed CI + local builds | Enable on Vercel or self-hosted cache server |
| Biome (or ESLint + Prettier) | Lint/format | Biome is faster and single-binary; ESLint if you need niche plugins |
| Drizzle Kit | Migrations | `drizzle-kit generate` + `migrate`; check migrations into git for audit |
| GitHub Actions | CI/CD | Matrix: typecheck, lint, `vitest`, `playwright`, `turbo build`; use Turbo cache to skip unchanged packages |
| Inngest Dev Server | Local orchestration testing | `npx inngest-cli dev` mirrors production step behavior locally |
| Inngest Agent Skills | Claude Code guidance | Pre-built skills (inngest-setup/steps/flow-control) keep Claude Code current on Inngest APIs — relevant given solo+Claude Code build |

---

## Installation

```bash
# Monorepo scaffold
pnpm dlx create-turbo@latest

# Core web + AI
pnpm add next@^16.2 react react-dom ai@^6 @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google zod@^4

# Orchestration
pnpm add inngest

# Data layer
pnpm add drizzle-orm postgres ioredis
pnpm add -D drizzle-kit drizzle-zod

# Auth
pnpm add better-auth

# Email adapters
pnpm add googleapis @microsoft/microsoft-graph-client @azure/identity

# Observability
pnpm add @langfuse/otel @langfuse/tracing @opentelemetry/api @opentelemetry/sdk-node

# Contracts / OpenAPI
pnpm add @hono/zod-openapi   # or: pnpm add zod-to-openapi

# Attachments
pnpm add unpdf tesseract.js

# Dev / test
pnpm add -D vitest @playwright/test @biomejs/biome typescript turbo

# PII: run Microsoft Presidio as containers (not an npm package) — see Architecture notes
# docker run microsoft/presidio-analyzer ; docker run microsoft/presidio-anonymizer
```

---

## Detailed Rationale for Contested Decisions

### Orchestration: Inngest (over Temporal / Trigger.dev / Vercel Workflows)

The BPMN spec is a long chain of retryable, human-gated steps (intake → validate → enrich → plan → ground → PII → cost → cache → LLM → review → deliver → archive) with dead-letter and escalation. That is exactly Inngest's sweet spot.

- **Solo dev + 4 weeks:** Inngest has *no worker fleet* to operate. Functions run as ordinary serverless handlers; the Inngest service handles scheduling/retries/state. Temporal requires you to run and manage a worker fleet and learn workflows/activities/signals (weeks of ramp) — wrong for this timeline.
- **LLM-friendly:** Temporal demands strictly deterministic workflow code, which fights non-deterministic LLM calls. Inngest has no determinism requirement on the orchestration layer.
- **Human review loop:** `step.waitForEvent` cleanly models approve/edit/reject with timeouts — directly maps to the review + escalation + timeout requirements.
- **Cost guardrails as infra:** Built-in flow control (concurrency, throttling, rate limiting, debounce, prioritization) supports budget enforcement and protects against runaway spend with one line per function.
- **Dead-letter + audit:** Failure handling and run history give you a dead-letter path and a durable execution trail that complements the audit tables.
- **Deploy fit:** Runs great on Vercel-compatible serverless; self-hostable later via official Helm/OCI chart if you outgrow the cloud tier (note: earlier "cannot self-host" claims are outdated as of 2026).

**When Trigger.dev would win instead:** if you needed very long single-task compute (minutes–hours of uninterrupted execution) or Apache-2.0 self-hosting from day one. **When Temporal would win:** true enterprise, multi-language, mission-critical determinism at scale — overkill here. **Vercel Queues/Workflows:** too young/limited for a 15-step governed pipeline with human gates; revisit later.

### LLM gateway: Vercel AI Gateway + thin custom layer (over LiteLLM / pure custom)

AI SDK v6 speaks to the Vercel AI Gateway natively, giving provider-agnostic routing, primary/fallback, and zero-markup access to OpenAI/Anthropic/Google/etc. That covers "provider-agnostic + fallback" with almost no code. The product-specific pieces the gateway does *not* give you — **budget-based model downgrade** and **safeTextHash response caching** — you implement as a thin wrapper in your `llm` package (pre-call cost estimate → budget check → choose tier → cache lookup in Redis → call via AI SDK → cache store). **LiteLLM** is the alternative if you want a self-hosted, language-agnostic proxy with built-in budget/virtual-key controls, but it adds a Python service to operate; given a TS-only solo build, keep the gateway + your own guardrail layer.

### Realtime voice: OpenAI Realtime API over WebRTC

`gpt-realtime` (and `gpt-realtime-2.1` / `-mini`) is GA and production-stable with GPT-5-class reasoning. Use **WebRTC** for the browser session (OpenAI's recommended browser transport; lowest latency, handles audio directly), with your Node service minting **ephemeral session tokens** so the API key never reaches the client. Inline `input_audio_transcription` produces the live transcript you convert to a structured markdown brief. Use WebSocket transport only if you later need the server to sit directly in the media path for compliance interception. The 15-min cap is enforced server-side by session config + a client End-session action.

### Transcription (async): gpt-4o-transcribe

For dictation recordings and audio attachments (non-live), gpt-4o-transcribe gives ~4.1% WER at $0.006/min (mini at $0.003/min) and stays within the OpenAI stack you already use. Deepgram Nova-3 is a strong alternative if you later need sub-150ms streaming STT independent of the Realtime API, but it is unnecessary now since the Realtime API handles live transcription.

### Vector store: pgvector (over Qdrant/Pinecone/etc.)

At this scale (single-user briefs + docs, well under 1M vectors in beta) pgvector with a tuned HNSW index performs comparably to dedicated engines while eliminating an entire piece of infrastructure. halfvec quantization + HNSW scale to ~10M vectors on one managed Postgres. Per-user isolation is a simple `WHERE user_id = ?` filter co-located with your relational data. Move to a dedicated engine only when you can name the bottleneck (billions of vectors, massive write throughput, or advanced filtered/hybrid search at scale).

### PII detection: Presidio microservice + regex prefilter (hybrid)

Presidio is the mature open-source standard (v2.2.362, March 2026): hybrid NER + regex + context rules + checksums, plus a dedicated Anonymizer. It is **Python** with no first-class Node library, so run `presidio-analyzer` and `presidio-anonymizer` as Docker microservices and call them over REST from your Node `pii` package. Add a fast **regex prefilter** for developer/structured secrets (API keys, IPs, account numbers) Presidio's NLP wasn't trained for. Keep a pure-LLM pass optional and only for edge cases — LLM redaction alone is non-deterministic and can hallucinate/miss entities, which is unacceptable for a guardrail that must produce a reliable `safeText` with explicit null/unknown failure handling. This yields deterministic, testable redaction with LLM as fallback, not primary.

### Auth: Better Auth (over Auth.js / Clerk)

Beta requires invited users, per-user data isolation, and (soon) org/RBAC. Better Auth stores users in *your* Postgres (no third party holds credentials — a compliance advantage for this product), ships invitations + magic-link + the organization plugin natively, charges nothing per user, and integrates with Drizzle. Clerk is faster to drop in but puts user/org data in Clerk's DB and gates Organizations behind paid tiers — conflicts with the "own your data / per-user isolation / no vendor lock-in" posture. Auth.js (NextAuth v5) has no native multi-tenancy, invitations, or RBAC and would mean building those by hand.

### Email: own adapter, not Nylas

You explicitly want your own abstraction and both Gmail + Graph accounts are in hand. Define an `EmailProvider` port and implement it twice: `googleapis` (Gmail API) and `@microsoft/microsoft-graph-client` + `@azure/identity` (Graph). Nylas/unified APIs add per-message cost and a dependency you don't need for two providers — reserve for when you must support many arbitrary mailboxes.

### Observability: Langfuse *and* OpenTelemetry

They are complementary, not competing. Langfuse's JS/TS SDK v4 is built *on* OpenTelemetry, so use OTel for general service/infra spans and let Langfuse ingest the LLM-specific traces (per-request tokens/cost/latency/decision counts — your telemetry payload) plus prompt management and evals. Langfuse prompt management + feedback scores are the natural home for the feedback-capture → prompt-optimization loop and threshold-breach detection. Self-hostable via Docker if you want telemetry in your own perimeter.

### ORM: Drizzle (over Prisma)

Code-first TS schemas match the mandate, the thin SQL-like API lets you write raw pgvector queries and complex audit joins without fighting an abstraction, the bundle is tiny for serverless cold starts, and it pairs with Better Auth and drizzle-zod. Prisma 7 (TS/WASM engine) closed much of the gap and is the pick if you want maximum abstraction + Prisma Studio, but the trend is Prisma→Drizzle and Drizzle's SQL-closeness wins for a pgvector-heavy, audit-heavy schema.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Inngest | Trigger.dev v4 | Long single-task compute (minutes–hours), Apache-2.0 self-host from day one |
| Inngest | Temporal | Enterprise, multi-language, strict-determinism, mission-critical at scale |
| Vercel AI Gateway | LiteLLM proxy | Want self-hosted virtual keys + per-key budgets in one box, OK running a Python service |
| pgvector | Qdrant / Pinecone | Billions of vectors, high write throughput, advanced filtered/hybrid search at scale |
| Presidio (self-host) | Cloud PII API (e.g. AWS Comprehend, Google DLP) | Don't want to run a container; accept per-call cost + data leaving perimeter |
| Better Auth | Clerk | Want zero-effort polished drop-in UI and don't mind hosted user data / per-user cost |
| gpt-4o-transcribe | Deepgram Nova-3 / ElevenLabs Scribe v2 | Need independent low-latency streaming STT outside OpenAI |
| Drizzle | Prisma 7 | Prefer high-level abstraction + Prisma Studio; team less comfortable with SQL |
| OpenAI Realtime | Pipecat/LiveKit + composable STT/LLM/TTS | Need fine-grained control of each pipeline stage or multi-vendor voice |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Temporal (for this milestone) | Steep learning curve + worker fleet ops; determinism fights LLM calls; wrong for solo 4-week build | Inngest |
| Prisma-style pure LLM PII redaction as the primary guard | Non-deterministic, can hallucinate/miss entities; can't guarantee `safeText` | Presidio microservice + regex prefilter, LLM only as fallback |
| Nylas / unified email API | Per-message cost + dependency you don't need for two known providers; conflicts with "own abstraction" | Own `EmailProvider` port over googleapis + Graph SDK |
| Auth.js (NextAuth v5) for multi-tenant beta | No native invitations, multi-tenancy, or RBAC — you'd rebuild them | Better Auth |
| Clerk for the data-sovereignty requirement | User/org data lives in Clerk; Organizations is paid | Better Auth (data in your Postgres) |
| Separate dedicated vector DB now | Extra infra + ops for sub-1M vectors; premature | pgvector in the primary Postgres |
| WebSocket-only voice from the browser | Higher latency, you manage media path unnecessarily | WebRTC browser↔OpenAI with server-minted ephemeral tokens |
| BullMQ/raw Redis queues as the orchestrator | You'd hand-build retries, state, human gates, DLQ, flow control | Inngest (Redis stays for caching/rate-limit only) |
| Next.js Pages Router | Legacy; misses RSC/streaming/route handlers that this app relies on | App Router (Next 16.2) |

---

## Stack Patterns by Variant

**If you must keep all infra inside your own perimeter (compliance-driven):**
- Self-host Inngest (Helm/OCI), Langfuse (Docker), and Presidio containers; keep Better Auth (already self-hosted) and pgvector in your Postgres.
- Because it removes third-party data processors from the request path.

**If the 4-week clock slips and you must cut scope:**
- Keep Realtime voice, orchestration, PII, cost guardrails, review loop, and one email provider (Gmail) — defer Graph, self-improvement loop, and dedicated evals.
- Because the governed pipeline + voice is the product's identity; email provider #2 and the optimization loop are additive.

**If voice needs server-side media interception later (call recording/compliance):**
- Switch the voice transport to WebSocket with the server in the media path, or introduce LiveKit/Pipecat.
- Because WebRTC browser-direct keeps media off your servers by design.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Next.js 16.2 | Node 20+ (22 LTS recommended) | Node 20 is the hard floor; Turbopack default |
| AI SDK v6 | @ai-sdk/* provider packages @ v6 | v5→v6 has a wire-format change; use v6 providers, not v5 |
| Langfuse TS SDK v4 | Langfuse platform ≥ 3.95.0 | Self-hosted platform must meet minimum for all features |
| Drizzle ORM | postgres.js / node-postgres | Use one driver consistently; drizzle-kit for migrations |
| pgvector 0.8.x | PostgreSQL 16/17 | Enable `halfvec` + HNSW; raise dim cap to 4,000 with halfvec |
| Better Auth 1.x | Drizzle adapter | Point Better Auth at the same Postgres/Drizzle instance |
| Inngest SDK 3.x | Next.js route handler / any Node server | Serve functions via `/api/inngest`; use Dev Server locally |

---

## Sources

- nextjs.org/blog/next-16-2, endoflife.date/nextjs — Next.js 16.2.x current stable (June 2026), Node 20+ (HIGH)
- vercel.com/blog/ai-sdk-6, github.com/vercel/ai/releases — AI SDK v6 features, Agent/ToolLoopAgent, HITL, AI Gateway (HIGH)
- inngest.com (docs, changelog, /ai), github.com/inngest/inngest — steps, flow control, self-host Helm/OCI, Agent Skills, checkpointing (HIGH)
- medium/@matthieumordrel orchestration guide; trybuildpilot.com; hookdeck.com; zenml.io temporal-alternatives — Temporal vs Trigger.dev vs Inngest tradeoffs (MEDIUM, cross-checked)
- openai.com/index/introducing-gpt-realtime, developers.openai.com/api/docs/guides/realtime, marktechpost (gpt-realtime-2.1, Jul 2026) — Realtime API GA, WebRTC/WS/SIP, pricing (HIGH)
- tokenmix.ai, deepgram.com/learn/best-speech-to-text-apis-2026, artificialanalysis.ai — gpt-4o-transcribe WER/pricing vs Whisper/Nova-3 (MEDIUM-HIGH)
- clickhouse.com scale-vector-search-postgres, cruxdigits.nl, encore.dev pgvector guide — pgvector scale limits, halfvec, HNSW (HIGH)
- github.com/microsoft/presidio, microsoft.github.io/presidio, grepture.com, cleanmyprompt.io — Presidio v2.2.362, hybrid detection, Python/microservice, LLM-vs-Presidio tradeoffs (MEDIUM-HIGH; Node = run as service)
- makerkit.dev better-auth-vs-clerk, buildmvpfast.com, logrocket.com best-auth-library-nextjs-2026 — Better Auth org/invitations, self-host, data ownership (HIGH)
- langfuse.com/docs (observability, OTel, SDK overview), github.com/langfuse/langfuse — Langfuse on OTel, TS SDK v4, self-host, prompt mgmt/evals (HIGH)
- makerkit.dev drizzle-vs-prisma, encore.dev, prisma.io/docs comparisons — Drizzle vs Prisma 2026, edge/serverless, Prisma 7 WASM engine (HIGH)
- turborepo.dev/docs, github.com/vercel/turborepo skills, medium TS monorepo 2026 — pnpm + Turborepo structure, caching (HIGH)

---
*Stack research for: governed agentic AI operating layer (AI chief-of-staff)*
*Researched: 2026-07-08*
