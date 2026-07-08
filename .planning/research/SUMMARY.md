# Project Research Summary

**Project:** Pikar-AI
**Domain:** Governed agentic AI operating layer (AI chief-of-staff web platform) — voice/text intake, durable multi-step orchestration, RAG, guardrails, human review, email delivery
**Researched:** 2026-07-08
**Confidence:** HIGH

## Executive Summary

Pikar-AI is a governed agentic AI platform: a solopreneur "chief of staff" that takes voice/text/attachment input, plans and executes multi-step work behind cost/PII/quality guardrails, requires human approve/edit/reject before anything leaves the building, and follows through with real delivery (email) under a full audit trail. Experts building this class of system in 2026 converge on a **modular monolith** (one repo, ~15 packages with strict typed contracts) run by a **step-native durable orchestrator** (Inngest, not Temporal) — because LLM/tool calls are inherently non-deterministic and a solo 4-week build cannot afford Temporal's worker-fleet and determinism-replay overhead. The realtime voice session is architected as a deliberate exception: it bypasses the durable pipeline entirely (browser-direct WebRTC to OpenAI Realtime with a server-minted ephemeral token) and only re-enters the governed pipeline after the session ends and produces a brief.

The recommended stack is TypeScript end-to-end: pnpm+Turborepo monorepo, Next.js 16.2 (App Router), Postgres+pgvector (single datastore for relational, vector, and audit data), Redis for caching/rate-limiting, Drizzle ORM, Vercel AI SDK v6 + AI Gateway for LLM access, Better Auth (self-hosted, org/invite-native) for auth, Presidio (as a Dockerized microservice) + regex prefilter for PII, and Langfuse + OpenTelemetry for observability. Zod is the single source of truth for every data contract (attachmentRefs, routingDecision, piiScanResult, costEstimateResult, llmResponse, etc.), enforced at every package boundary. Feature-wise, the market (Lindy, Dust, Zapier Agents, Relevance AI, Motion) has normalized multi-step agents, human-in-the-loop approval, and knowledge grounding as table stakes, but nobody combines solopreneur-accessible governance (PII, cost caps, audit) with a live bidirectional voice strategy session that produces a durable, groundable brief — that intersection is Pikar's defensible position, and the roadmap should protect it rather than chase competitor integration breadth.

The dominant risk to the 4-week timeline is **not** the AI/agent engineering — it's external, uncontrollable verification processes: Google's OAuth sensitive-scope review for `gmail.send` (2–4 weeks, cannot be rushed) and Microsoft Graph's `Mail.Send` permission model. The mitigation is well-understood (use Google's Testing-mode 100-user cap for beta, accept and handle 7-day token expiry, prefer delegated Graph permissions, sequence one email provider before the second) but it must be decided at roadmap/foundation time, not discovered in week 3. The other clustered risks are guardrail-integrity bugs that are easy to miss because they fail silently: cache keys not namespaced by tenant (cross-user data leak), audit logs storing raw PII instead of `safeText` (compliance honeypot), `safeText` being treated as guaranteed-clean rather than best-effort, and agent/voice loops with no hard cost kill-switch. All of these must be designed in from the foundation phase — none of them are safely deferrable or retrofittable.

## Key Findings

### Recommended Stack

The stack is a single TypeScript monorepo (pnpm + Turborepo) deploying to Next.js 16.2, with Postgres as the one durable datastore (relational + pgvector for embeddings + audit/dead-letter tables) and Redis for cache/rate-limiting. Inngest is the deciding architectural choice: it provides event-driven durable steps, `waitForEvent` for the human-review gate, and built-in flow control for cost guardrails, with no worker fleet to operate and no determinism constraint on LLM calls — the opposite trade-off of Temporal, which was explicitly rejected as wrong for a solo 4-week build. Full source: `.planning/research/STACK.md`.

**Core technologies:**
- Next.js 16.2 (App Router) — flagship web framework, Turbopack default, matches Vercel deploy target
- Inngest — durable orchestration for the entire BPMN pipeline; step-native, no worker fleet, human-review-friendly via `waitForEvent`
- Postgres + pgvector (HNSW/halfvec) — single datastore for relational data, vectors, and audit trail; avoids a dedicated vector DB at this scale
- Vercel AI SDK v6 + AI Gateway — provider-agnostic LLM calls, primary/fallback, structured outputs, native human-in-the-loop tool approval
- Drizzle ORM — code-first, SQL-close, pgvector- and audit-schema-friendly
- Better Auth — self-hosted auth with native invite/magic-link/org support (credentials stay in Pikar's own Postgres, a compliance win over Clerk)
- Presidio (Dockerized microservice) + regex prefilter — hybrid PII detection; deterministic and testable, LLM redaction only as fallback
- OpenAI Realtime API over WebRTC — live voice session, ephemeral server-minted tokens, browser-direct audio (never proxied through the backend)
- Langfuse + OpenTelemetry — LLM-specific tracing/cost/prompt-management (Langfuse) plus general infra tracing (OTel); complementary, not competing
- Zod — single source of truth for every data contract, generating both runtime validation and OpenAPI/TS types

### Expected Features

The competitive landscape (Lindy, Dust, Zapier Agents, Relevance AI, Motion) has normalized multi-step agentic execution, human approval gates, and knowledge grounding, but none combine solopreneur-tier governance with a voice-native strategy session — that gap is Pikar's differentiation. Full detail: `.planning/research/FEATURES.md`.

**Must have (table stakes):**
- Text/chat intake, attachment upload + extraction, multi-step planning/execution
- Human approve/edit/reject before any action leaves the system, with plan/step visibility
- At least one real delivery channel (email) and persistent memory/grounding (knowledge vault)
- Per-user isolation, invite-based signup, fast onboarding, event notifications
- Voice dictation intake (record → transcribe → pipeline)

**Should have (differentiators):**
- Live 15-min bidirectional voice strategy session that produces a structured, groundable brief
- Governance-for-solopreneurs bundle (PII redaction + cost caps + audit) at an accessible tier
- Per-request cost visibility with automatic model downgrade and LLM response caching
- Full audit trail and compliance archival from day one
- Self-improvement loop (feedback-driven prompt optimization) — but kept human-gated, not autonomous, in v1

**Defer (v2+):**
- Broad integration breadth beyond email (Slack, docs write-back)
- Multi-agent "workforce" orchestration, Computer Use/browser RPA, calendar/scheduling engine
- Multiplayer/multi-reviewer RBAC, billing/public launch, custom skills registry
- Fully autonomous "no approval" mode — explicitly conflicts with the governance identity

### Architecture Approach

The system is a modular monolith organized as `apps/{web, api, worker}` plus ~15 `packages/*` domain modules communicating through Zod-defined contracts, with `apps/worker` hosting the entire BPMN pipeline as a single Inngest function (steps for validate → enrich → route → ground → PII → cost → generate → wait-for-review → deliver → feedback). The realtime voice session is architecturally isolated from this durable pipeline — it runs browser-to-OpenAI directly over WebRTC and only re-enters the governed pipeline once a brief is produced — because sub-second bidirectional audio cannot flow through a workflow engine. Full detail: `.planning/research/ARCHITECTURE.md`.

**Major components:**
1. `contracts` + `core` — Zod schemas (single source of truth for every payload) and shared config/tenant-context/logger, depended on by everything
2. `worker` pipeline packages (`validation`, `attachments`, `executive-agent`, `grounding`, `pii`, `cost`, `llm-gateway`, `delivery`) — the governed request pipeline, each a typed in-process service with no HTTP surface of its own
3. Cross-cutting packages (`audit`, `notifications`, `feedback`, `prompt-optimizer`) — event-driven, off the synchronous hot path, wrap every step for compliance and self-improvement

### Critical Pitfalls

Full list (12 pitfalls with mitigations) in `.planning/research/PITFALLS.md`. Top risks:

1. **Google OAuth verification timeline** — `gmail.send` sensitive-scope review takes 2–4 weeks and cannot be rushed; use Testing-mode (100-user cap) for the beta and architect for 7-day test-token expiry rather than blocking launch on full verification.
2. **Cross-tenant cache leakage** — LLM cache keyed only on `safeTextHash` (without a tenant/user namespace) silently serves one user's cached response to another; every cache key must be namespaced by `userId`/`tenantId` from day one.
3. **Audit log as a PII honeypot** — "log everything from day one" must mean logging `safeText` and references/hashes, never raw prompts/transcripts/email bodies; redact-then-log ordering is a foundational, non-negotiable pipeline contract.
4. **Realtime voice cost blowout** — the Realtime API re-bills the entire conversation history every turn; requires history pruning, prompt caching, and a server-side (not client-only) 15-minute watchdog with real-time token metering.
5. **Agent loop runaway / no kill-switch** — LLM agents cannot reliably self-terminate; requires a hard iteration cap, tool-call repetition detector, and a per-request cost budget enforced as an actual kill-switch (not just advisory) at the gateway layer.

## Implications for Roadmap

Based on combined research, suggested phase structure (dependency-driven, matching the architecture's own "Suggested Build Order" and the pitfalls' foundational-decision list):

### Phase 1: Foundation
**Rationale:** Everything else imports these packages; the audit substrate, tenant-scoping discipline, and orchestrator choice must exist before any feature work, because retrofitting them (per Pitfalls 8, 10, 12) is far more expensive than building them in.
**Delivers:** Monorepo (pnpm+Turborepo), `contracts`, `core`, `db` (Postgres+Drizzle, `tenantId` on every row), Better Auth wired, Inngest wired, `audit` skeleton (redact-then-log ordering decided now).
**Avoids:** Pitfall 10 (durable-orchestration learning curve — Inngest chosen up front, not Temporal), Pitfall 12 (multi-user isolation retrofit), Pitfall 8 (audit PII honeypot — ordering contract fixed now).

### Phase 2: Thin End-to-End Slice
**Rationale:** Proves the core value proposition (input → plan → guardrails → approve → deliver → audit) before any enrichment or voice work; this is the MVP spine per FEATURES.md's v1 definition.
**Delivers:** Text intake → `executive-agent` (direct-LLM route) → `llm-gateway` (no cache yet) → `waitForEvent` human review → `delivery` (one email provider only) → audit trail.
**Addresses:** Text/attachment intake, Executive Agent planning/routing, plan/step visibility, human review, single delivery channel (all P1 in FEATURES.md).
**Avoids:** Pitfall 11 (integration scope creep — ship one email provider fully before starting the second).

### Phase 3: Guardrails
**Rationale:** Governance is both a product differentiator and a build constraint (PROJECT.md); it must slot into the existing pipeline steps immediately after the spine works, not be bolted on later.
**Delivers:** `pii` (safeText, fail-closed on unknown), `cost` (estimate + budget check + downgrade + real kill-switch), `llm-gateway` cache (safeTextHash namespaced by tenant) + fallback chain.
**Uses:** Presidio microservice + regex prefilter, Redis cache, Vercel AI Gateway fallback routing.
**Avoids:** Pitfall 6 (PII false confidence), Pitfall 7 (cross-tenant cache leak), Pitfall 5 (agent loop runaway).

### Phase 4: Enrichment (Attachments + Grounding)
**Rationale:** Adds input richness and the knowledge-vault memory substrate; depends on the pipeline and vault schema already existing from Phase 2–3.
**Delivers:** `attachments` (classify → OCR/PDF/audio transcription), `grounding` + knowledge vault (indexed, searchable, groundable).
**Implements:** `attachments` and `grounding` packages from ARCHITECTURE.md; knowledge vault as first-class store per FEATURES.md.

### Phase 5: Voice
**Rationale:** Highest architectural risk (isolated from the durable pipeline, real-time cost exposure) and highest product-identity value; sequenced after the core pipeline and vault are stable so voice failures don't block the spine, per ARCHITECTURE.md's build order. Voice dictation (lower complexity, reuses attachments/transcription) ships before the live bidirectional session.
**Delivers:** Voice dictation intake first, then live 15-min WebRTC session with server-side watchdog, incremental transcript persistence, brief generation into the vault, and optional brief→plan conversion.
**Addresses:** Voice dictation intake (P1) and live voice strategy session (P2/differentiator) from FEATURES.md.
**Avoids:** Pitfall 3 (realtime cost blowout — history pruning, caching, server-side token metering) and Pitfall 4 (orphaned session lifecycle bugs — watchdog TTL, incremental persistence).

### Phase 6: Self-Improvement + Ops Hardening
**Rationale:** Event-driven and off the hot path; the feedback/prompt-optimization loop is meaningless until review data has accumulated from prior phases, so it is correctly sequenced last per FEATURES.md's dependency notes.
**Delivers:** `feedback` capture, `prompt-optimizer` (human-gated, held-out eval, no autonomous promotion in v1), `notifications` hardening, compliance archival hardening.
**Avoids:** Pitfall 9 (reward hacking / quality drift — keep the loop manual/assisted for v1, never autonomous).

### Phase 7: Private Beta Productionization
**Rationale:** Once features exist, this phase focuses on the specific week-4 definition of "production": invited users beyond the owner, not billing or public launch.
**Delivers:** Invite/signup flow, per-user isolation verification (User A cannot read User B's data — test explicitly), minimal onboarding, second email provider (only after the first works end-to-end), Google OAuth Testing-mode + 7-day token-expiry handling verified with a real second user.
**Avoids:** Pitfall 1 (OAuth verification timeline), Pitfall 2 (Graph over-permissioning), Pitfall 11 (integration scope creep — second provider only now).

### Phase Ordering Rationale

- Foundation-first ordering exists because Pitfalls 8, 10, and 12 are explicitly "cheap now, expensive to retrofit" — the data model, orchestrator choice, and audit ordering are irreversible-ish decisions that every later phase depends on.
- The thin-slice-before-guardrails-before-enrichment ordering follows FEATURES.md's dependency graph directly (grounding requires the vault; approval requires plan visibility; cost/PII must gate generation, not follow it) and ARCHITECTURE.md's own "Suggested Build Order" table.
- Voice is deliberately isolated to its own phase late in the sequence because it is architecturally separate from the durable pipeline (bypasses Inngest) and carries the highest cost/lifecycle risk (Pitfalls 3–4); isolating it prevents its risk from blocking the core governed pipeline that is the product's primary trust mechanism.
- Email-provider sequencing (one before two) is called out explicitly in its own step because Pitfall 11 identifies parallel OAuth work on two providers as a common way for a 4-week plan to have "neither provider sends end-to-end" by week 3.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (Voice):** OpenAI Realtime API surface changes fast (confirmed by STACK.md and PITFALLS.md); confirm current model/voice/pricing and history-pruning/caching APIs immediately before implementation, not from this research snapshot.
- **Phase 7 (Private Beta / Email):** Google OAuth Testing-mode mechanics and Microsoft Graph Application Access Policy setup are procedural/administrative (not code) and time-sensitive; verify current console UI/steps against Google's and Microsoft's docs at implementation time.
- **Phase 6 (Self-Improvement):** Prompt-optimization/reward-hacking mitigation research is MEDIUM confidence (community/research sources, not domain-specific case studies) — validate the human-gate/held-out-eval design against whatever feedback volume the beta actually produces.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** pnpm+Turborepo, Drizzle, Better Auth, Inngest setup are all HIGH-confidence, well-documented, current patterns.
- **Phase 2 (Thin Slice) and Phase 3 (Guardrails):** Inngest step patterns, AI SDK v6 tool loops, and Presidio hybrid PII are HIGH-confidence with official docs and working code samples already captured in ARCHITECTURE.md and STACK.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core choices verified against official docs/releases (Next.js, Inngest, AI SDK, pgvector, Better Auth, Langfuse); integration-layer choices (LLM gateway budget layer, PII hybrid pipeline) MEDIUM-HIGH |
| Features | MEDIUM-HIGH | Competitor feature facts are HIGH (current reviews of Lindy/Dust/Zapier/Relevance/Motion); table-stakes-vs-differentiator categorization is synthesized opinion, MEDIUM |
| Architecture | HIGH | Core decisions (modular monolith, Inngest over Temporal, WebRTC isolation) verified against current vendor docs and 2026 comparisons; voice/vault specifics MEDIUM |
| Pitfalls | HIGH | OAuth/Graph/Realtime timeline facts are HIGH (official docs + multiple sources); agent-loop and prompt-optimization mitigations MEDIUM (community/research, less domain-specific); structural traps HIGH (verified against project constraints) |

**Overall confidence:** HIGH

### Gaps to Address

- **Voice-in-4-weeks scope tradeoff:** FEATURES.md explicitly flags that the live 15-min bidirectional voice session is the highest-complexity item and competes hard with the core governed-pipeline slice for the same 4-week window. The roadmap should force an explicit decision at planning time: is live voice a true launch-blocking requirement, or does dictation-only ship first with live voice as an immediate v1.x follow-on? PROJECT.md currently lists it as an active requirement without this tradeoff resolved.
- **Email provider sequencing choice:** Research recommends picking whichever provider (Gmail vs. Microsoft Graph) has the simplest consent path for the actual beta cohort (e.g., `internal` Workspace app avoids verification entirely). This decision depends on who the actual beta invitees are and should be made explicitly during roadmap/phase planning, not left implicit.
- **PII residual-risk documentation:** Best-in-class hybrid PII pipelines still leak 2–4% of PII; the roadmap should include an explicit task to document and communicate this residual risk (and non-English-input degradation) rather than treating `safeText` as a completed compliance checkbox.
- **Self-improvement loop scope for v1:** Given tiny/noisy beta feedback volume and documented reward-hacking rates (46–74% of optimization runs), consider explicitly scoping Phase 6 as "capture feedback + propose edits for human review" only, deferring any autonomous prompt promotion past the beta — this should be confirmed as a roadmap decision, not assumed.

## Sources

### Primary (HIGH confidence)
- nextjs.org/blog/next-16-2, endoflife.date/nextjs — Next.js 16.2.x, Node 20+ requirement
- inngest.com (docs, changelog), github.com/inngest/inngest — steps, flow control, self-host, checkpointing
- developers.openai.com/api/docs/guides/realtime, guides/realtime-webrtc, guides/voice-agents — Realtime API GA, WebRTC transport, cost management
- github.com/microsoft/presidio, microsoft.github.io/presidio — hybrid NER+regex detection, microservice deployment
- langfuse.com/docs, github.com/langfuse/langfuse — OTel-based SDK v4, self-host, prompt management
- developers.google.com/identity/protocols/oauth2/production-readiness — sensitive/restricted scope verification, Testing-mode 100-user cap
- learn.microsoft.com/en-us/graph/permissions-overview — Graph Mail.Send application vs. delegated permissions
- turborepo.dev/docs — pnpm + Turborepo monorepo structuring

### Secondary (MEDIUM confidence)
- usecarly.com, aiagentslist.com, incremys.com, cybernews.com — Lindy/Dust/Relevance AI 2026 feature reviews
- wetheflywheel.com, medium.com/@matthieumordrel — Temporal vs. Inngest vs. Trigger.dev orchestration tradeoffs
- hackernoon.com, tokenmix.ai — OpenAI Realtime API real-world cost/latency data (4,000 measured sessions)
- relayplane.com, futureagi.com, arxiv.org/pdf/2606.04056 — agent loop runaway-cost incident catalogs
- lilianweng.github.io — reward hacking / self-improvement failure modes

### Tertiary (LOW confidence)
- (none flagged — all sourced findings reached at least MEDIUM confidence via cross-checking)

---
*Research completed: 2026-07-08*
*Ready for roadmap: yes*

## Convex Revision (2026-07-09)

The owner switched the data + orchestration plane from **Postgres + pgvector + Redis + Inngest** to **Convex**. Full re-derivation: `.planning/research/STACK-CONVEX.md` (supersedes STACK.md for the data/orchestration plane). Summary of what changed:

**Replaced / dropped:**
- **Inngest -> Convex Workflow component** (durable steps, exactly-once mutations, configurable action retries, `awaitEvent` human gates, `onComplete`). Do NOT keep Inngest alongside Convex.
- **Postgres + Drizzle -> Convex DB** (document store + indexes + schema); **Redis -> Convex tables** (LLM cache) + **Rate Limiter component**; **pgvector -> Convex vector search + RAG component**.
- **Better Auth -> Convex Auth** for the beta (data still in your DB, preserving the data-ownership rationale) + a manual `betaInvites` table. `@convex-dev/better-auth` (~0.10.x, pre-1.0) is the alternative if org/invitation plugins are wanted now. Clerk still rejected (external data hosting).

**Kept (integration points move onto Convex actions):** Next.js 16.2, pnpm+Turborepo, Vercel AI SDK v6 + AI Gateway, OpenAI Realtime/WebRTC + gpt-4o-transcribe, Presidio (containerized), email adapters, Langfuse + OTel, Zod (bridged via `convex-helpers`). NEW: graphify Python sidecar; Convex Agent/RAG/Action-Retrier/Rate-Limiter components.

**Wins:** reactive `useQuery` subscriptions make live pipeline status + review queue trivial (upgrade over polling); durable scheduled functions give a server-authoritative voice watchdog and Gmail token-refresh cron; RAG namespaces + a `customQuery` tenant wrapper harden multi-tenant isolation; SOC 2 Type II + HIPAA BAA + AES-256 available.

**New limitations to design around (with mitigations in STACK-CONVEX.md):**
- `awaitEvent` has **no built-in timeout** -> schedule a `review-timeout` event and race it (needed for review-timeout->escalation).
- **No built-in dead-letter queue** -> insert failures into a `deadLetter` table in `onComplete`.
- **No enforced immutable/append-only table** -> insert-only audit module + **scheduled export to S3 Object Lock (WORM)** for true audit immutability/retention.
- **Vector ceilings:** 2048-dim cap (use `text-embedding-3-small` @1536, NOT 3-large @3072), <=256 results, only first 100k docs/table indexed, equality-only filters.
- **No graph query language** -> model `graphNodes`/`graphEdges` tables with compound indexes; hop-capped iterative traversal (respect 4,096 index-read / 32k-scan tx limits).
- **Lock-in** -> keep all domain logic in pure-TS `packages/*`; `convex/` stays a thin adapter; core components are pre-1.0 (pin versions).

**Build order:** the 7-phase sequence is unchanged; Convex changes *what* Phase 1 builds (Convex project/schema, component wiring, Convex Auth + invite table, tenant-scoping wrapper, insert-only audit + WORM export stub, and the `awaitEvent`-timeout / `onComplete`-DLQ patterns established up front - the new "learning cost").
