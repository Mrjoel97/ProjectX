# Playbook: Agent Runtime (the Executive Agent platform)

> Last verified: 2026-07-15 against 03.6-02
> Build history: `.planning/phases/` (3.2.1 agent-driven cockpit, 3.3 attachment generation) · Related ADRs: ADR-003 (skills registry), ADR-004 (agents/humans as peer actors)

## Purpose

Defines what "an agent" is in Pikar, the governed loop every agent runs through, and
the recipe for adding a new agent or a new tool. This playbook owns the *cross-cutting
agent contract*; cockpit-specific behavior lives in `cockpit.md` and prompt-registry
procedures in `skill-registry.md`. Read this before building anything an LLM will
reason or act through.

**The agent contract.** An agent is exactly four things:

1. a **skill** — its versioned system prompt, a registry row (ADR-003; never hardcoded);
2. a **tool set** — governed wrappers over validated mutations (ADR-004);
3. a **loop config** — model, step cap (`stopWhen: stepCountIs(n)`), wall-clock timeout, fallback policy;
4. a **guardrail policy** — `guardrails.preCall` before every model call, `recordModelSpend` after.

Today that quadruple is assembled by hand once, in `runCockpitAgent`.
`ponytail: one agent, no factory — extract a defineAgent() helper when agent #2 arrives.`
(The Phase 6 voice agent is the expected agent #2; `document-drafter` is already the
mini-pattern for *sub*-agents: a separate skill + separate LLM call, orchestrated by a
parent's tool — never a free-running child loop.)

## Key files

Backend (`packages/backend/convex/`):
- `llm.ts` — the ONLY `"use node"` module. `runAgentLoop` (governed `generateText` loop on the Vercel AI SDK `ai@7`), `buildCockpitTools` (tool wrappers), `runCockpitAgent` (Executive Agent assembly), `recordModelSpend`, `resolveModel` (direct OpenAI via `@ai-sdk/openai`).
- `cockpit.ts` — thin driver `sendCockpitMessage` (save turn → preCall → loop → save reply). `@convex-dev/agent` is used **as a message store only** (`createThread`/`saveMessage`/`listMessages`); its own reasoning engine is deliberately inert.
- `guardrails.ts` — `preCall` gate (kill switch, budget, rate limit) + `recordSpend`.
- `skills.ts` — fail-closed skill loading + `activateSkill` + `seedSkills` (see `skill-registry.md`).
- `opsSignals.ts` — EVAL-02 read side: `evalSignals` tenantQuery computes the production
  eval signals (decision counts, `reviewOutcome` distribution, regenerate/`llm.fallback`/DLQ
  counts, cost per delivered send) from EXISTING telemetry/audit/deadLetters rows for the
  ops page. READ-ONLY by design (no new write path); the audit read is ALWAYS windowed via
  `by_tenant_ts` (the table is unbounded — never an un-windowed collect). Honesty caveat:
  cockpit send rows carry `costUsd: 0` / `decisionCounts: {}` / `regenerateCount: 0`, so
  decision-count sums are pipeline-only and the `reviewOutcome` distribution is the
  approve-proxy for cockpit sends — the card labels each metric accordingly. Tested by
  `opsSignals.test.ts` (rates, tenant isolation, windowing, refs-only shape).

Pure packages:
- `packages/contracts/src/skill.ts` + `packages/contracts/skills/*.md` — skill contract + canonical prompt bodies.
- `packages/core` — pure tool internals (recipient view/edit, document generation). New tool logic goes here first; `llm.ts` wrappers stay thin.

Tests:
- `packages/backend/convex/runCockpitAgent.test.ts` — mock-model loop integration (scripted tool sequences, kill switch, budget drain, fallback).
- `packages/backend/convex/cockpitTools.test.ts` — per-tool governance (validation bounce, tenant guard).
- `packages/backend/convex/llmRedaction.test.ts` — static refs-only scan.

## Dependencies & blast radius

Run `graphify query "agent runtime tool loop"` for the current subgraph. Couplings the
graph cannot see: `OPENAI_API_KEY` in the deployment env; a fresh deployment MUST seed
skills or every agent turn dead-letters; model ids (`"openai/..."`) double as pricing
and audit keys — a model absent from `@pikar/cost` records zero spend; the
`@convex-dev/agent` component owns thread/message tables outside `schema.ts`.

## Data flow (one agent turn)

1. User message → driver `tenantAction` (`sendCockpitMessage`) saves the user turn.
2. `guardrails.preCall` — a governed stop returns a "paused" assistant reply as DATA (never a throw, never a DLQ row).
3. `runAgentLoop` → `generateText({ model, system: skill body, tools, stopWhen: stepCountIs(8), abortSignal: 45s })`.
4. Each tool call validates at the boundary and patches shared state (`plans` row); the UI re-renders reactively — the human watches the agent work live.
5. On throw: `isFallbackEligible` → one retry on `CHEAP_MODEL`, else the error becomes a conversational assistant turn (non-dead-ending).
6. `recordModelSpend` prices usage; assistant reply saved.
7. Consequence (send) happens only later, via the human-only `executePlan` mutation → `deliverApprovedPlan` workflow (see `cockpit.md`).

## Invariants — what must never break

1. **Structural facts are never model-invented** — addresses/indices/times are validated or server-resolved inside the tool. Enforced: `cockpitTools.test.ts`.
2. **Irreversible/outward actions are human-only mutations, never tools** (ADR-004). `executePlan` is the sole `workflow.start(deliverApprovedPlan)` call site — grep-provable. Enforced: `cockpit.test.ts` + the single-call-site grep.
3. **Every model call is bracketed**: `preCall` before, `recordModelSpend` after — no exceptions, including sub-calls (`draftBody`, `draftDocument`). Enforced: `runCockpitAgent.test.ts` (budget-drain, kill-switch cases).
4. **Prompts load from the registry and fail closed** (ADR-003). Enforced: `skills.test.ts` (incl. the >200-char string-literal scan).
5. **Refs-only logs** — audit/DLQ/telemetry carry ids/hashes/counts, never content (raw addresses never enter model context either — index/label view). Enforced: `llmRedaction.test.ts`.
6. **The loop is bounded**: step cap + wall-clock abort + at most one fallback retry. A capped loop asks a question; it never spins. Enforced: fallback/step tests in `runCockpitAgent.test.ts`.
7. **Exactly one `"use node"` module** (`llm.ts`) — a second re-triggers the TS circular-inference cliff (see `cockpit.md`). Pure logic escapes to `packages/core`, not to new node modules.
8. **Agents act on state, never surfaces** (ADR-004) — no tool simulates UI interaction. Enforced: review discipline only (no test) — flag any tool whose description mentions clicking/navigating.
9. **No live-model eval gate exists yet** — activating a new skill version is currently unverified against real model behavior. This is a named gap, closed by Phase 3.6 (`.planning/design/agent-eval-gate.md`), not a footnote.

## How to change safely

**Adding a tool to an existing agent (checklist):**
1. Pure internals in `packages/core` (with unit tests).
2. Wrapper in `buildCockpitTools`: closes over `(ctx, tenantId, planId)`, re-reads and tenant-guards the state row, `inputSchema` via `jsonSchema` (zod stays out of the node module).
3. Validate every structural fact server-side; invalid input bounces a structured error back to the model (conversational recovery, never a throw out of the loop).
4. Refs-only audit event if the tool touches external data (pattern: `mailbox.searched`).
5. Unit test: happy path + validation bounce + tenant guard.
6. Prompt guidance for the new tool goes in the agent's skill body via the registry publish path (`seedSkills` bump) — never inline.
7. Extend the mock-model script test and the `SMOKE::` sentinel grammar if the tool participates in E2E.

**Adding a new agent (recipe):**
1. Skill doc in `packages/contracts/skills/<name>.md` + derived seed constant + registry row (drift-test kept in sync).
2. Tool set per the checklist above (tools are composable — reuse existing wrappers where scope allows).
3. Loop config through `runAgentLoop` (own maxSteps/timeout/model); guardrails/spend come free by construction.
4. Mock-model integration test + `SMOKE::` sentinel + golden-set eval entries (Phase 3.6).
5. Playbook coverage + `watch.json` registration (CLAUDE.md §9).

**Changing loop mechanics** (step cap, timeout, fallback, model resolution): re-run
`runCockpitAgent.test.ts` and `smoke:guardrails`; re-read `cockpit.md` invariants —
this is the highest-blast-radius change type in the file.

## How to verify

- `pnpm --filter backend test` — vitest: loop integration (mocked model), per-tool governance, redaction scan, skill-registry drift. Deterministic, free.
- `npm run smoke:guardrails` / `npm run smoke:fanout` — live deployment: kill switch, budget, cache isolation; per-recipient fan-out + DLQ isolation.
- Offline E2E: `SMOKE::` / `SMOKE::agent::` sentinels drive fixed tool sequences with zero model calls.
- Golden-set live-model eval: **pending Phase 3.6** (`eval:golden`).

## Operational notes

- `OPENAI_API_KEY` lives in the Convex deployment env (not `.env.local`).
- Fresh deploy → `npm run seed` (skills) or every agent turn dead-letters (fail-closed loader).
- Skill activation/rollback = `activateSkill` (auto-invalidates the LLM action cache via the version-in-key rule).
- Adding a model: add its price to `@pikar/cost` first — unknown models silently record zero spend.

## Known gaps & deferred work

- **No live-model eval gate** — Phase 3.6 closes it (`.planning/design/agent-eval-gate.md`); until then, skill activations are verified only by mock-model tests + humans.
- **`executive-agent.classifier` skill is legacy/dead** — the live route path uses `executive-router` (different route enum: hyphens vs underscores). Archive it in Phase 3.6 housekeeping.
- **`sub_agent` route has no runtime** — the routing contract admits it; `document-drafter` (skill + sub-call orchestrated by a parent tool) is the pattern to copy when one is needed.
- **`@convex-dev/rag` installed, registered, zero usage** until Phase 5 — when adopted, wrap it behind our own retrieval function (pinned pre-1.0; keep the replaceable-surface small, as done with `@convex-dev/agent`).
- **No external agent interop (MCP server / A2A) — deliberate v2 shelf (EXPN-07).** Internal agents never get a free-form messaging protocol: they coordinate through shared governed state, workflows, and parent-tool sub-calls (unauditable inter-agent chat defeats the tool boundary, escapes the step/cost caps, and degrades audit to "two models talked"). When external interop is validated post-beta, it arrives as an *adapter over the existing tool boundary*: MCP server exposure of governed tools first (Approve gate, tenancy, refs-only audit apply automatically), inbound external agents as a third principal class with their own auth + scoped grants (deferred capabilities #2/#3). Never a second door around the boundary.
- **watch.json registration covers only Phase 3.6 eval paths** for this playbook (`opsSignals.ts` + its test so far) — the runtime files are already owned by `cockpit.md`/`skill-registry.md` (single-owner avoids double-update on every `llm.ts` edit). Remaining eval-harness paths register here as they land.
