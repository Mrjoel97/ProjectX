# Architecture Research

**Domain:** Governed agentic AI operating layer (durable orchestration + LLM guardrails + human-in-the-loop)
**Researched:** 2026-07-08
**Confidence:** HIGH (core decisions verified against current vendor docs and 2026 comparisons; MEDIUM on some voice/vault specifics)

## Verdict Up Front

- **Modular monolith, not microservices.** One repo, one (or two) deployables, ~15 services as *packages with clean contracts*. This is the only shape a solo dev ships in 4 weeks, and the package boundaries are exactly the seams you split on later.
- **Inngest for durable orchestration, not Temporal.** Inngest is step-native (no determinism constraint — the deciding factor for non-deterministic LLM calls), has no worker fleet to operate, is TypeScript-first, and gets you to a durable function in minutes. Temporal's determinism-replay model forces every LLM/tool call into carefully isolated Activities and requires you to run and manage workers — weeks of overhead a solo 4-week build cannot afford.
- **Two distinct data paths.** The **async request pipeline** (BPMN spec) runs as an Inngest workflow. The **realtime voice session** runs *outside* the durable engine over WebRTC direct to the model, and only *feeds* the pipeline once a brief is converted to a plan.
- **Shared-DB multi-tenancy with `tenantId` (= userId) scoping** for private beta. Single role, row scoping enforced in the data layer. No per-tenant infra.

## Standard Architecture

Governed agentic platforms in 2026 converge on a **three-layer** shape: an orchestration/sequencing layer, a governed-capability layer (tools, grounding, model access), and a cross-cutting governance/observability layer where controls attach (routing, approval gates, PII, cost, audit, rollback). Pikar maps cleanly onto this.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          apps/web  (Next.js)                          │
│   Intake (text/voice/files) · Review dashboard · Voice client (WebRTC)│
└───────────────┬───────────────────────────────────┬──────────────────┘
                │ HTTPS (REST)                        │ WebRTC (audio)
                ▼                                     ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│      apps/api (Node edge)      │        │  OpenAI Realtime (gpt-realtime)│
│  auth · tenant ctx · intake    │        │  ← ephemeral token minted by   │
│  endpoint · review actions ·   │        │    apps/api, browser connects  │
│  ephemeral voice token · hooks │        │    direct; transcript streamed │
└───────┬───────────────┬────────┘        └───────────────┬───────────────┘
        │ emit event    │ mint token                       │ on End-session
        ▼               │                                  ▼  (brief → vault)
┌──────────────────────────────────────────────────────────────────────┐
│           apps/worker — Inngest durable pipeline (event-driven)        │
│  validate → enrich attachments → executive-agent route → ground →      │
│  PII/safeText → cost/downgrade → cache → LLM gen(+fallback) →          │
│  waitForEvent: human review → deliver(email) → feedback → optimize     │
│  (each step: typed contract · ret/timeout · dead-letter on failure)    │
└───────┬──────────────────────────────────────────────────┬────────────┘
        │ direct in-process calls (typed service interfaces) │ events
        ▼                                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    packages/*  (domain service modules)               │
│  validation · attachments · executive-agent · tools · sub-agents ·    │
│  grounding · pii · cost · llm-gateway(+cache) · delivery ·            │
│  feedback · prompt-optimizer · notifications · audit(+telemetry)      │
└───────────────────────────────┬──────────────────────────────────────┘
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Postgres (tenant-scoped: requests, briefs, vault, audit, dead-letter)│
│  Redis (LLM cache by safeTextHash · rate/session state)               │
│  Blob store (attachments, audio) · Compliance archive (append-only)   │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component (package) | Responsibility (owns) | Talks to | Sync in-pipeline / Event / Realtime |
|---|---|---|---|
| `validation` | Schema + auth + business-rule validation of intake; produces validated request | contracts, db | Sync |
| `attachments` | Classify → OCR / PDF extraction / audio transcription → `attachmentRefs`; merge into context | blob store, transcription API | Sync (long-running step) |
| `executive-agent` | Classify + plan; emit `routingDecision` (tool / sub-agent / direct-LLM / invalid) | llm-gateway, tools, sub-agents | Sync (decision) |
| `tools` | Execute browser/API tool calls with scoped permissions | external APIs, audit | Sync per route |
| `sub-agents` | Run bounded specialist agent loops | llm-gateway, tools | Sync per route |
| `grounding` | Retrieve/embed knowledge-vault context; ground the request | db (vault), embeddings | Sync |
| `pii` | Scan + redact → `safeText` + `safeTextHash`; explicit null/unknown failure branch | (pure + model optional) | Sync (gate) |
| `cost` | Estimate cost, budget check, model downgrade → `costEstimateResult` | llm-gateway config | Sync (gate) |
| `llm-gateway` | Cache check (safeTextHash) → primary gen → fallback; `llmResponse` | Redis, LLM APIs | Sync |
| `delivery` | Provider-agnostic email send (Gmail API + MS Graph) | Gmail/Graph | Sync (post-approval) |
| `feedback` | Capture feedback → `feedbackResult`; threshold detection | db | Event |
| `prompt-optimizer` | Self-improvement loop triggered on feedback threshold | llm-gateway, db | Event (async) |
| `notifications` | Rejection / escalation / retry-breach / timeout / dead-letter alerts | email/push | Event |
| `audit` | Reusable logging, `telemetryPayload`, `auditLogPayload`, compliance archival | Postgres, archive | Cross-cutting (every step) |

## Recommended Project Structure

pnpm workspaces + Turborepo is the settled 2026 TypeScript-monorepo stack: `apps/` for deployables, `packages/` for domain modules and shared libs. Cross-package access is by *import of the installed package only* — never relative `../` across boundaries. That rule is what makes each service ownable from its own README/contract/runbook (the user's strict separation-of-concerns mandate) and later extractable.

```
pikar-ai/
├── apps/
│   ├── web/                 # Next.js: intake UI, review dashboard, WebRTC voice client
│   ├── api/                 # Node edge: auth, tenant ctx, intake endpoint, review actions,
│   │                        #   ephemeral voice-token minting, provider webhooks; emits Inngest events
│   └── worker/              # Inngest functions host = the durable BPMN pipeline
├── packages/
│   ├── contracts/           # Zod schemas + inferred TS types for EVERY data contract
│   │                        #   (attachmentRefs, routingDecision, piiScanResult, costEstimateResult,
│   │                        #    llmResponse, reviewDecision, feedbackResult, telemetryPayload,
│   │                        #    notificationPayload, auditLogPayload). Single source of truth.
│   ├── core/                # config, Result/error types, tenant context, Inngest client wrapper,
│   │                        #   logger factory — the only package everyone may depend on
│   ├── db/                  # Prisma/Drizzle schema + tenant-scoped client + migrations
│   ├── validation/          # each domain package below exposes: index.ts (typed service iface),
│   ├── attachments/         #   README.md, CONTRACT.md (its input/output contract ref),
│   ├── executive-agent/     #   RUNBOOK.md (ops/failure modes). No cross-imports except core/contracts/db.
│   ├── tools/
│   ├── sub-agents/
│   ├── grounding/
│   ├── pii/
│   ├── cost/
│   ├── llm-gateway/         # includes cache adapter (Redis) + fallback chain
│   ├── delivery/            # email adapter interface + Gmail + Graph implementations
│   ├── feedback/
│   ├── prompt-optimizer/
│   ├── notifications/
│   └── audit/               # logging + telemetry + compliance archival
└── turbo.json / pnpm-workspace.yaml / tsconfig.base.json
```

### Structure Rationale

- **`packages/*` = the ~15 BPMN child services.** Each is a library with a single exported typed interface (e.g. `piiScan(input): Promise<PiiScanResult>`), no HTTP surface of its own. This gives microservice-grade isolation of *contract and ownership* without microservice operational cost. To split one out later, wrap its `index.ts` in an HTTP/queue handler — the callers already speak its contract.
- **`contracts/` is separate and depended-on by everyone.** All the named payloads live here as Zod schemas so validation is runtime + compile-time and identical on both sides of every boundary. This is the linchpin of "any engineer owns one service from its docs."
- **`apps/api` is a thin edge, `apps/worker` holds the pipeline.** The edge only authenticates, scopes tenant, persists the request, and *emits an event*. All orchestration lives in Inngest functions in `worker` so the durable logic is in one auditable place.
- **`apps/web` owns the WebRTC voice client directly** — realtime audio does not traverse your backend (see Data Flow).

## Architectural Patterns

### Pattern 1: Durable pipeline as steps (Inngest)

**What:** The BPMN flow is one Inngest function; each service call is a `step.run(...)`. Steps are individually retried, memoized, and observable. Human review is a durable pause via `step.waitForEvent(...)` with a timeout that fires escalation.
**When to use:** Any multi-stage flow that must survive crashes, wait for humans, or fan out — i.e. the whole request pipeline.
**Trade-offs:** + No determinism constraint (LLM calls are just steps), no worker fleet, free-tier friendly. − Vendor coupling; mitigate by keeping business logic in `packages/*` and using `worker` only as thin orchestration.

```typescript
// apps/worker/functions/process-request.ts
export const processRequest = inngest.createFunction(
  { id: "process-request", concurrency: { key: "event.data.tenantId", limit: 5 } },
  { event: "request/received" },
  async ({ event, step }) => {
    const valid   = await step.run("validate",   () => validation.check(event.data));
    const enriched= await step.run("enrich",     () => attachments.process(valid));
    const route   = await step.run("route",      () => executiveAgent.classify(enriched));
    if (route.kind === "invalid") return step.run("dead-letter", () => audit.deadLetter(route));
    const grounded= await step.run("ground",     () => grounding.apply(enriched, route));
    const safe    = await step.run("pii",        () => pii.redact(grounded));      // → safeText
    const cost    = await step.run("cost",       () => costSvc.estimate(safe));    // → downgrade
    const out     = await step.run("generate",   () => llmGateway.generate(safe, cost)); // cache+fallback
    const review  = await step.waitForEvent("review", {                            // durable HITL
      event: "review/decided", timeout: "24h", match: "data.requestId",
    });
    if (!review) return step.run("escalate", () => notifications.escalate(event.data));
    if (review.data.decision === "approve")
      await step.run("deliver", () => delivery.sendEmail(out, event.data));
    await step.sendEvent("feedback", { name: "feedback/capture", data: { /*...*/ } });
  }
);
```

### Pattern 2: Direct calls inside a request, events across lifecycles

**What:** Within a single request's synchronous path, stages call each other as typed in-process functions (fast, easy to trace, transactional). Across lifecycle boundaries — feedback→optimization, any failure→dead-letter, everything→audit/telemetry, all→notifications — use Inngest events (decoupled, retried, fan-out).
**When to use:** Default to direct calls; reach for an event whenever the receiver's timing is independent of the sender's success or the work should not block the user's response.
**Trade-offs:** Events add eventual-consistency reasoning; keep the *user-visible* path synchronous and push self-improvement/telemetry/archival off the hot path.

### Pattern 3: Adapter (ports) for every external dependency

**What:** `delivery` exposes an `EmailProvider` port with `GmailProvider` and `GraphProvider` implementations chosen per user's connected account. `llm-gateway` exposes a `ModelProvider` port so downgrade/fallback swaps models behind one interface. `attachments` does the same for OCR/transcription.
**When to use:** Any third-party surface that has an alternative or changes fast (the Realtime API surface explicitly changes faster than text APIs).
**Trade-offs:** Slight indirection; huge payoff for the "provider-agnostic from day one" mandate and testability.

### Pattern 4: Guardrail gates with explicit null/unknown branches

**What:** `pii` and `cost` are *gates*, not decorations. Each returns a discriminated result (`ok` / `null` / `unknown`) and the pipeline branches explicitly on failure rather than assuming success — matching the spec's explicit failure handling and the 2026 lesson that skipping guardrails is the most expensive omission.
**Trade-offs:** More branches to test (the 20-scenario matrix exists for exactly this); non-negotiable for a "governed" product.

## Data Flow

### Async request pipeline (text / file / dictation intake)

```
User submits (web) → apps/api: authN + tenant scope + persist request → emit "request/received"
    ↓ (Inngest picks up in apps/worker)
validate → enrich(attachments) → executive-agent(route) ──invalid──▶ dead-letter + notify
    ↓ (valid route)
ground → pii(safeText, safeTextHash) → cost(estimate+downgrade) → llm-gateway(cache→gen→fallback)
    ↓
waitForEvent(review)  ──timeout──▶ escalate/notify;  ──reject/edit(retry++)──▶ regenerate or escalate
    ↓ (approve)
delivery(email via Gmail/Graph) → emit "feedback/capture"
    ↓ (independent lifecycle)
feedback → (threshold breach) → prompt-optimizer
Throughout: audit.log + telemetry at EVERY step; compliance archive is append-only.
```

### Realtime voice session path (live Executive Agent, 15-min cap)

This path deliberately **bypasses the durable pipeline** for the live audio, because sub-second bidirectional audio cannot flow through a workflow engine.

```
web voice client ──"start session"──▶ apps/api: mint ephemeral client secret (API key stays server-side)
web client ──WebRTC SDP offer──▶ OpenAI Realtime (gpt-realtime); direct audio channel opens
   live turns, interruptions, function-calls happen browser↔model for ≤15 min (hard cap timer)
User clicks End-session (or cap hit):
   transcript → step: build structured markdown brief → store in knowledge vault (tenant-scoped)
   OPTIONAL (explicit user permission): brief → convert to executable plan
       ↓
   plan enters the ASYNC pipeline as a normal "request/received" event
Audit: session metadata, transcript, and brief creation are logged like any request.
```

Key isolation points: the browser holds the WebRTC connection; `apps/api` only mints a short-lived token and never proxies audio; post-session brief-building *is* durable (runs as an Inngest function) so it survives failures.

### Multi-tenancy / per-user isolation (private beta)

- **Single Postgres, `tenantId` (= userId) column on every row**; the `db` package exposes a tenant-scoped client so no query can omit the filter. Optionally enable Postgres Row-Level Security as defense-in-depth.
- **Tenant context flows through `core`** and is stamped onto every Inngest event, audit log, and cache key (`safeTextHash` is namespaced by tenant to prevent cross-tenant cache hits).
- **Single role** (spec defers RBAC). Invite/signup flow + onboarding are app-layer only.
- No per-tenant infra, schemas, or workers — appropriate for private beta; the `tenantId` discipline is what lets you graduate to schema-per-tenant or RLS-hardened later without rewrites.

## Suggested Build Order

Dependency-driven; the first shippable target is one thin end-to-end slice (the constraint), then guardrails, then enrichment, then voice, then self-improvement, then beta.

| Step | Build | Why here (dependency) |
|---|---|---|
| **0. Foundation** | monorepo (pnpm+Turbo), `contracts`, `core`, `db`, auth + `tenantId`, Inngest wired, `audit` skeleton | Everything imports these; audit must exist day one (no retrofitting) |
| **1. Thin E2E slice** | text intake → `executive-agent` (direct-LLM route) → `llm-gateway` (no cache yet) → `waitForEvent` review → `delivery` (one provider) → audit | Proves the pipeline + HITL + delivery + trail; the MVP spine |
| **2. Guardrails** | `pii` (safeText), `cost` (estimate+downgrade), `llm-gateway` cache (safeTextHash) + fallback | Governance is a product feature and build constraint; slot into existing steps |
| **3. Enrichment** | `attachments` (OCR/PDF/transcription), `grounding` + knowledge vault | Adds input richness; depends on pipeline + vault schema |
| **4. Routing depth** | `tools` execution + `sub-agents` routes + invalid-route/dead-letter hardening | Extends executive-agent's other branches once spine is stable |
| **5. Voice** | dictation (record→transcribe→pipeline) first, then live WebRTC session → brief → vault → optional plan | Reuses attachments/transcription + pipeline; realtime is highest-risk, isolate it |
| **6. Self-improvement + ops** | `feedback` → `prompt-optimizer`, `notifications`, compliance archival hardening | Event-driven, off hot path; safe to add last |
| **7. Private beta** | invite/signup flow, per-user isolation hardening, onboarding, second email provider | Productionization once features exist |

## Scaling Considerations

| Scale | Architecture adjustments |
|---|---|
| 0–1k users (beta) | Modular monolith as-is. Single Postgres + Redis + managed Inngest. `tenantId` scoping. No changes needed. |
| 1k–100k users | Add Inngest concurrency keys per tenant (already patterned); read replicas for vault/audit; move compliance archive to object storage; consider extracting `attachments` (CPU-heavy OCR) and `llm-gateway` to their own deployables using their existing package contracts. |
| 100k+ users | Split the heaviest packages into services (the seams already exist), partition Postgres or move audit/archive to a columnar/append-only store, dedicated embedding infra for `grounding`. |

### Scaling priorities

1. **First bottleneck: attachment/OCR + transcription CPU** — extract `attachments` to its own worker first.
2. **Second bottleneck: LLM cost/latency** — the cache + downgrade you build in Step 2 *is* the mitigation; tune cache hit rate before scaling compute.

## Anti-Patterns

### Anti-Pattern 1: Reaching for microservices on day one
**What people do:** Deploy each of the 15 services separately "for separation of concerns."
**Why it's wrong:** A solo dev drowns in inter-service contracts, network failure modes, and deploy pipelines — you will not reach beta in 4 weeks.
**Do this instead:** Package-per-service in a modular monolith with strict contracts; split only when a specific package proves a real scaling need.

### Anti-Pattern 2: Putting LLM/tool calls in a determinism-constrained workflow engine
**What people do:** Adopt Temporal and then fight replay non-determinism by wrapping every model call in an Activity.
**Why it's wrong:** Enormous cognitive + ops overhead for a non-deterministic-by-nature agent system.
**Do this instead:** Use a step-native engine (Inngest) where each LLM/tool call is naturally a step; no replay model to design around.

### Anti-Pattern 3: Proxying realtime audio through your backend
**What people do:** Route WebRTC/audio through `apps/api`.
**Why it's wrong:** Latency, cost, and needless complexity; the Realtime pattern is browser-direct with an ephemeral token.
**Do this instead:** Mint an ephemeral client secret server-side; let the browser hold the WebRTC session; only persist the resulting transcript/brief.

### Anti-Pattern 4: Bolting on audit/PII/cost after the pipeline works
**What people do:** Ship the happy path, add governance later.
**Why it's wrong:** The spec and constraints make audit + guardrails core; retrofitting means re-plumbing every step.
**Do this instead:** `audit` and the gate contracts exist from Step 0/2; each step logs as it runs.

### Anti-Pattern 5: Cross-tenant cache/state leakage
**What people do:** Key the LLM cache purely by `safeTextHash`.
**Why it's wrong:** Two tenants with identical redacted text share responses — a data-isolation breach.
**Do this instead:** Namespace cache keys and all state by `tenantId`.

## Integration Points

### External Services

| Service | Integration pattern | Notes |
|---|---|---|
| LLM text APIs | `ModelProvider` port in `llm-gateway`; primary + fallback chain | Keep keys server-side; downgrade swaps model behind port |
| OpenAI Realtime (voice) | Ephemeral token minted by `apps/api`; browser WebRTC direct | Surface changes fast — confirm model/voice/pricing before launch; keep behind adapter |
| OCR / PDF / transcription | Ports in `attachments` | Long-running → own Inngest step with generous timeout |
| Gmail API + MS Graph | `EmailProvider` port in `delivery` | Chosen per user's connected account; OAuth token storage tenant-scoped |
| Inngest | `core` client wrapper; functions in `apps/worker` | Managed, no worker fleet; free tier covers beta |
| Postgres / Redis / blob | `db` package + cache adapter | tenant-scoped client; Redis keys namespaced by tenant |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| `apps/api` ↔ `apps/worker` | Inngest event (`request/received`, `review/decided`) | Edge stays thin; orchestration decoupled |
| pipeline step ↔ `packages/*` | Direct typed in-process call | Fast, traceable, transactional within a step |
| pipeline ↔ `feedback`/`notifications`/`audit`/`prompt-optimizer` | Inngest events | Independent lifecycles, off hot path |
| any package ↔ any package | Import installed package only (never `../`) | Enforces ownership + later extractability |
| all ↔ `contracts` | Zod schema import | Runtime + compile-time contract parity on both sides |

## Sources

- [Temporal vs Inngest (2026): Durable Execution for AI Agents — wetheflywheel](https://wetheflywheel.com/en/comparisons/temporal-vs-inngest/) — HIGH
- [Inngest vs Temporal (official comparison)](https://www.inngest.com/compare-to-temporal) — MEDIUM (vendor, cross-checked)
- [The Ultimate Guide to TypeScript Orchestration: Temporal vs Trigger.dev vs Inngest — Medium](https://medium.com/@matthieumordrel/the-ultimate-guide-to-typescript-orchestration-temporal-vs-trigger-dev-vs-inngest-and-beyond-29e1147c8f2d) — MEDIUM
- [Agentic AI Architecture: 2026 Production Patterns + Stack — Internative](https://internative.net/insights/blog/agentic-ai-architecture-2026) — MEDIUM
- [Agentic Orchestration Design Patterns for Enterprise AI — Put It Forward](https://www.putitforward.com/agentic-ai/agentic-orchestration-design-patterns) — MEDIUM
- [The Three Layers of an Agentic AI Platform — Bain & Company](https://www.bain.com/insights/the-three-layers-of-an-agentic-ai-platform/) — MEDIUM
- [15 Agentic Design Patterns for Production AI (2026) — vdf.ai](https://vdf.ai/blog/agentic-design-patterns-practical-guide/) — MEDIUM
- [Realtime API with WebRTC — OpenAI (official docs)](https://developers.openai.com/api/docs/guides/realtime-webrtc) — HIGH
- [Voice agents — OpenAI (official docs)](https://developers.openai.com/api/docs/guides/voice-agents) — HIGH
- [OpenAI Realtime API Voice Apps: WebRTC Guide (2026) — APIScout](https://apiscout.dev/guides/openai-realtime-api-building-voice-applications-2026) — MEDIUM
- [Structuring a repository — Turborepo (official docs)](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository) — HIGH
- [Monorepos with TypeScript in 2026: Turborepo, pnpm Workspaces & Project References — Medium](https://medium.com/@mernstackdevbykevin/monorepos-with-typescript-93c9233f6df8) — MEDIUM

---
*Architecture research for: governed agentic AI operating layer (Pikar-AI)*
*Researched: 2026-07-08*
