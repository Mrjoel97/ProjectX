# Architecture Research

**Domain:** Governed agentic platform — integrating v2.0 breadth-of-action features into an existing Convex tool-loop without breaking governance invariants
**Researched:** 2026-07-24
**Confidence:** HIGH (every integration point below is a verified `file:function` in the current tree, located via graphify then read at the span)

> Supersedes the 2026-07-08 v1.0 greenfield architecture study. This is a **subsequent-milestone
> integration study**: the "standard architecture" already exists and ships. The job is: where does
> each v2.0 feature **plug in**, what is **NEW vs MODIFIED**, and what **build order** keeps the five
> governance invariants intact. The invariants (CLAUDE.md + PROJECT.md) that must survive every feature:
>
> 1. **Tenant isolation** — every read/write scoped by `tenantId` (the `tenantQuery/Mutation/Action` wrappers; `namespace = tenantId` in RAG).
> 2. **Redact-then-write audit** — `audit.payload` / `deadLetters.payload` carry refs/hashes/counts only, never raw content/PII.
> 3. **The human Approve gate is a mutation, never an LLM tool** — the model can *propose*; only `cockpit.executePlan` (a `tenantMutation`, human-triggered) *sends*.
> 4. **Skills load from the registry** — no hardcoded prompts; bodies are versioned rows, gated by EVAL_GATE.
> 5. **Domain logic in `packages/*`; `convex/` is a thin adapter.**

## Standard Architecture (what exists today)

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                    ONE GOVERNED TOOL-LOOP (per turn)                   │
│                                                                        │
│  runCockpitAgent (llm.ts:1749, internalAction)                         │
│    1. guardrails.preCall  ── kill-switch / daily-budget → PAUSED_REPLY │
│    2. load COCKPIT_AGENT_SKILL body  ── skills.getActiveSkill (system) │
│    3. plan context  ── plans.getById (index+label recipients, §2-D)    │
│    4. SMOKE:: offline sentinel  ── one op → one governed tool call     │
│    5. runAgentLoop (llm.ts:1478)                                       │
│         generateText({ system, prompt, tools, stopWhen:stepCountIs(8), │
│                        abortSignal: timeout, maxRetries })             │
│         primary → CHEAP_MODEL fallback ; recordModelSpend accumulates  │
│         onToolExecutionStart/End → agentSteps.record/finish (trace)    │
│                          │                                             │
│                          ▼                                             │
│  buildCockpitTools (llm.ts:607)  ── ~15 MAILBOX-ONLY tools, closures   │
│    over (ctx, tenantId, planId): addRecipients/setRecipients/          │
│    removeRecipient/resolveContacts/setSendTime/draftBody/              │
│    generate|regenerate|removeAttachment/proposePlan/listInbox/         │
│    briefInbox …   every tool: tool({description, inputSchema, execute})│
└──────────────────────────────────────────────────────────────────────┘
        │ proposePlan (tool) flips status→"proposed" ONLY
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  HUMAN APPROVE GATE — cockpit.executePlan (cockpit.ts:494)             │
│    tenantMutation, NOT a tool.  CAS status proposed→approved →         │
│    deliverApprovedPlan fan-out (email send)                            │
└──────────────────────────────────────────────────────────────────────┘

  UNWIRED / HOLLOW today (the v2.0 seams):
  • vaultGround (vaultGround.ts:25)  ── hybrid RAG+graph retrieval, tenantAction, ZERO callers
  • routing sub_agent route (contracts/routing.ts:13)  ── valid enum, unimplemented → dead-letters
  • skills insertCandidate / activateCandidate (skills.ts:317/139)  ── candidate→EVAL_GATE→active
  • crons.ts (cronJobs)  ── worm-export + gmail-token-scan (the proactive-schedule pattern)
  • briefings.insert/byThread (briefings.ts)  ── append-only content row + live card (in-app digest)
  • Pikar-Ai MCP service  ── generate_image/video/audio/3d (external, media generation)
```

### Component Responsibilities (existing, load-bearing for integration)

| Component | Responsibility | File:function |
|-----------|----------------|---------------|
| `runCockpitAgent` | Governed per-turn entry: gate → skill → context → loop | `llm.ts:1749` |
| `runAgentLoop` | The `generateText` loop: tools, step cap, timeout, fallback, spend, trace | `llm.ts:1478` |
| `buildCockpitTools` | Builds the tool record the loop hands the model (closures over ctx/tenant/plan) | `llm.ts:607` |
| Approve gate | Human-triggered CAS send; the one place proposed→approved | `cockpit.executePlan` `cockpit.ts:494` |
| Delivery fan-out | Materialize attachments, one request per recipient, send | `deliverApprovedPlan.ts:23` |
| Vault grounding | Hybrid `rag.search`(namespace=tenantId) → graph `expand` → `fuse` → `{docIds,context[]}` | `vaultGround.ts:25` (unwired) |
| Routing contract | `direct_llm / direct_tool / sub_agent`; unknown → `{ok:false,"unknown_route"}` | `contracts/routing.ts:36` |
| Skills registry | `getActiveSkill`/`getSkillVersion` load; `activateSkillVersion` = the ONE EVAL_GATE flip | `skills.ts:51/208/80` |
| Candidate write-back | External/optimized body → new **candidate** (never active) | `skills.insertCandidate` `skills.ts:317` |
| Owner activation | One-click candidate→active through the same EVAL_GATE | `skills.activateCandidate` `skills.ts:139` |
| Cron schedule | `cronJobs()` daily → internal action (the proactive-review template) | `crons.ts` |
| In-app digest | Append-only content row + `tenantQuery` live card, writes NO audit row | `briefings.ts` |
| Cost/gate primitives | `guardrails.preCall` (kill-switch/budget), `recordModelSpend` | `guardrails.ts` / `llm.ts:1454` |

## Integration Map — the six features

For each: **exact integration point**, **NEW vs MODIFIED**, **data-flow change**, **invariants preserved**.

### (1) vault→agent wiring — the immediate root

**Decision: add a `searchVault` TOOL, not an always-on grounding step.** The `briefInbox`/`listInbox`
tools already establish the pattern: a read-only tool the model calls *when it decides it needs it*,
returning content to the model but writing only refs/counts to audit. A grounding *step* (inject
top-K into every prompt) burns retrieval cost on every turn and can't be query-shaped by the model.
Ponytail rung 2: reuse the tool pattern that's already here.

| | |
|---|---|
| **Integration point** | New `searchVault` entry in `buildCockpitTools` (`llm.ts:607`); executes `ctx.runAction` into vault grounding |
| **NEW** | An **internal** grounding action. `vaultGround` (`vaultGround.ts:25`) is a `tenantAction` (identity-derived tenant); a tool already runs inside an action ctx with `tenantId` in its closure. Extract the handler body into `internal.vaultGround.groundInternal({tenantId, query})` so the tool calls it directly (no auth double-derive). Thin — the pure logic (`fuse`, `expand`, `rag.search`) is untouched. |
| **MODIFIED** | `buildCockpitTools` (+1 tool). `COCKPIT_AGENT_SKILL` body → a NEW version teaching the agent when to ground (registry flip, not code — §5). |
| **Data flow** | model → `searchVault(query)` → `groundInternal` → `rag.search(namespace=tenantId)` → `vaultGraph.expand` (hop-capped, tenant-filtered) → `fuse` → `{docIds, context[]}` returned to the model as context (content plane, like `briefInbox`'s digest). |
| **Invariants** | Tenant isolation: `namespace = tenantId` + `expand` filters by tenantId (already enforced in `vaultGround`). §4: the tool RETURN is content-plane (goes to the model); any audit row logs `docIds`+counts only — mirror `briefInbox`'s refs-only `mailbox.listed` pattern. Cost: the loop's `preCall`+`recordModelSpend` already govern the embedding/search spend. |

This is the **root dependency**: business evaluation, non-email sub-agents, and the flagship
"upload a report → discuss by voice → grounded insights" flow all consume grounded context.

### (2) real sub_agent dispatch — one governed loop, swappable (skill, toolset)

**Decision: a sub-agent is a `(skill body, tool-set builder)` pair the SAME loop runs — NOT a new
loop, NOT a recursive agent.** The hollow `sub_agent` enum collapses to email today because there is
exactly one `buildCockpitTools`. Make the tool-set a *parameter*: the router names a specialist, the
loop loads that specialist's skill as `system` and that specialist's tool record. `runAgentLoop`'s
governance (`stopWhen: stepCountIs(8)`, `preCall`, `recordModelSpend`, timeout, fallback) is written
once and applies to every specialist unchanged.

| | |
|---|---|
| **Integration point** | `runCockpitAgent`/`runAgentLoop` (`llm.ts:1749/1478`) parameterized by a skill name + a tool-set builder; `contracts/routing.ts` `sub_agent` carries a specialist id |
| **NEW** | A **tool-set registry**: `{ specialistId → (skillName, buildToolset(ctx,tenantId,planId,...)) }`. `buildCockpitTools` becomes one entry (the "email" specialist). One exemplar second specialist (per PROJECT.md — calendar or research) proves the seam. New gated specialist skills in the registry. |
| **MODIFIED** | `routingSchema` (`contracts/routing.ts:12`) — add the specialist identifier to the `sub_agent` branch (still fail-closed: an unknown specialist is `unknown_route`, never a default). `runCockpitAgent` step 2 (load specialist skill, not always `COCKPIT_AGENT_SKILL`) and step 5 (build specialist toolset). `runAgentLoop`'s hardcoded `buildCockpitTools(...)` (`llm.ts:1513`) → the injected builder. |
| **Data flow** | classify → `sub_agent{specialist}` → loop loads `(specialistSkill, specialistTools)` → same governed `generateText` → specialist proposes a plan via the same `proposePlan` → human `executePlan`. |
| **Invariants** | Loops: `stepCountIs(8)` unchanged, shared across specialists. Cost: single `preCall` at entry + single `recordModelSpend` accumulator — no per-specialist budget leak; a nested-loop design would fragment cost accounting, which is exactly why we **avoid** it. **Approve gate untouched**: every specialist proposes; only `executePlan` (mutation) acts. Skills: specialist prompts are gated registry rows. |

Anti-pattern to avoid: a `dispatchSubAgent` tool that spins a *nested* `generateText` — it
double-counts steps, forks the cost accumulator, and tempts a specialist to "execute" inside a tool.
Keep it one loop with a swapped `(skill, tools)`.

### (3) business-evaluation engine + scheduled proactive in-app review

**Decision: profile is a groundable vault document; the engine is pure `packages/*`; on-demand runs
as a tool/specialist; the proactive schedule reuses `crons.ts` → an internal action → `briefings`-style
in-app card + `notifications.notify`. No mailbox token — the digest is in-app.**

| | |
|---|---|
| **Integration point** | Onboarding intake → `vaultDocuments` (`schema.ts:482`, `kind:"business_profile"`) via the existing ingest path (so it's embedded + groundable). Evaluation engine = new `packages/evaluation` (pure). On-demand = an `evaluateBusiness` tool inside an "analyst" specialist (feature 2). Proactive = new `crons.daily` entry (`crons.ts`) → internal action → per-tenant eval → in-app card + notify. |
| **NEW** | `packages/evaluation` (assessment + gap-detection + advice-to-action, pure TS). Business-profile intake surface. A `businessEvaluations` content table (or reuse the `briefings` append-only shape) + a live `tenantQuery` card. The cron action. |
| **MODIFIED** | `crons.ts` (+1 daily job — mirrors `worm-export`/`gmail-token-scan`). `notifications` (a new kind). Schema (+ profile doc kind is just a string; + evaluations table). |
| **Data flow** | onboarding → profile doc ingested → (on-demand) analyst specialist grounds via `searchVault` + runs `packages/evaluation` → advice; (scheduled) cron → internal action per tenant → grounds → evaluates → `briefings.insert`-style row → live card + `notifications.notify`. **Advice that drives action still routes back through a plan + `executePlan`** — the review is read-only, the *acting* is gated. |
| **Invariants** | §1 domain logic in `packages/evaluation`; Convex adapter thin. §4 the eval card is content-plane (writes NO audit row, exactly like `briefings.ts`); any audit logs counts only. Tenant isolation: cron iterates tenants, every read/write scoped. **Depends on feature 1** (grounding) and reuses feature 2 (specialist). |

### (4) non-email tools (calendar · web research · doc/content creation · contacts/CRM)

**Decision: each is a tool inside a specialist tool-set (feature 2). Read tools mirror `listInbox`
(read-only, safe to execute in-loop). WRITE/side-effecting tools must NOT fire on a tool call — they
*stage into the plan* and the human `executePlan` mutation performs the external write.**

| | |
|---|---|
| **Integration point** | New tools in specialist tool-sets (feature 2 registry). External calls via new action adapters (`calendar.ts`, `research.ts`, `contacts.ts`) with secrets in Convex env. |
| **NEW** | Per-domain adapter modules (thin Convex actions over Google Calendar API, a web-search provider, CRM). A **generalized approved-action executor**: today `executePlan`/`deliverApprovedPlan` only fan out email; a calendar-event/CRM-write needs the same propose→approve→execute spine generalized beyond `gmail.send`. |
| **MODIFIED** | `deliverApprovedPlan.ts:23` (or a sibling executor) to dispatch by action type, not email-only. `plans` schema may carry a typed pending-action beyond email fields. |
| **Data flow** | read tool (calendar list / web search) executes in-loop like `listInbox`; write tool (create event / add contact) stages a pending action on the plan → `proposePlan` → human `executePlan` → typed executor performs the write. |
| **Invariants** | **Approve gate**: the critical one here — a "createCalendarEvent" that fired inside a tool would breach invariant 3 (LLM causing an external side effect without human approval). Route every external *write* through the mutation. Cost/loop: same governance. §4: adapters log refs/counts. |

### (5) media canvas over the Pikar-Ai MCP service

**Decision: a `generateMedia` tool in a "media" specialist that calls the connected Pikar-Ai MCP
service (`generate_image/video/audio/3d`) from an action. Do NOT rebuild generation (PROJECT.md
mandate). Output is an asset ref on the plan, like a generated attachment; delivery is Approve-gated.**

| | |
|---|---|
| **Integration point** | New media specialist tool-set (feature 2). New MCP client adapter action (`mcp.ts` / `media.ts`) calling the Pikar-Ai service. Reuse the attachment/plan asset pattern from `renderAndStore` (`llm.ts:652`) + `plans.recordAttachments`. |
| **NEW** | MCP client adapter (auth + call to `generate_image/video/...`, `models_explore(action:'recommend')` for model choice). Media-asset handling on the plan (ref/storageId, never raw bytes to the model). |
| **MODIFIED** | Plan/attachment schema to carry media refs; the Approve-gate executor if media is *delivered* externally. |
| **Data flow** | model → `generateMedia(brief)` → MCP `generate_*` → store asset under tenant → ref on plan → (if it leaves the building) `proposePlan` → `executePlan`. |
| **Invariants** | Cost: media generation is expensive and external — it MUST `recordModelSpend`/a per-turn media cap so `preCall`+budget still bound the turn (video ≤3 min is a real cost ceiling). Tenant isolation: assets stored under `tenantId`. §4: refs only, never asset bytes/URLs in audit/model return. Approve gate before external delivery. |

### (6) dynamic / agent-authored skills over the eval-gated registry

**Decision: the registry ALREADY has the seam — `insertCandidate` (`skills.ts:317`) writes a NEW
CANDIDATE (never active), and `activateSkillVersion` (`skills.ts:80`) is the ONE EVAL_GATE flip that
requires passing evidence + owner action. User-authored first, agent-authored later. Placed LAST:
self-modification, governance-heavy, and it depends on an eval harness for brand-new skills.**

| | |
|---|---|
| **Integration point** | `skills.insertCandidate` (already exists, gated-only, idempotent). Owner activation via `skills.activateCandidate` (already exists, `tenantMutation` = owner gate + EVAL_GATE). Candidate review via `skills.candidatesForReview` (`skills.ts:154`). |
| **NEW** | A skill-authoring surface (user first): compose body → `insertCandidate`. For agent-authored: a tool that lets the agent *propose* a skill body → same `insertCandidate` path (candidate ONLY). The genuinely hard NEW piece: an **eval harness for a brand-new gated skill** — the golden eval is per-skill with fixtures; a never-before-seen skill has none, so EVAL_GATE (`hasPassingEvidence`) can't pass without new fixtures. This is the gating complexity, not the write path. |
| **MODIFIED** | Minimal in `skills.ts` — the write/gate/review seams exist. Possibly `GATED_SKILLS` registration for a new skill family. |
| **Data flow** | author (user or agent) → `insertCandidate` (candidate) → eval run records evidence (`recordEvalEvidence`) → owner reviews (`candidatesForReview`) → `activateCandidate` (EVAL_GATE) → active. |
| **Invariants** | Self-modification is safe by construction: the agent can only ever write a **candidate**; `insertCandidate` NEVER sets `status:"active"` and NEVER patches a prior row (immutable-per-version, §5). Activation is a separate owner mutation behind EVAL_GATE. This is precisely why it can ship last without new governance primitives. |

## Suggested Build Order (dependency-aware)

Matches PROJECT.md's staircase; the ordering rationale is the dependency arrows, not preference.

```
0. vault→agent wiring (searchVault tool)          ── ROOT: unblocks all grounding
        │
        ├─► 1. business profile intake + evaluation engine (on-demand)   [needs grounding]
        │        │
        │        └─► 3. scheduled proactive in-app review                [needs engine + cron pattern]
        │
        └─► 2. real sub_agent dispatch (one exemplar specialist)         [the framework for breadth]
                 │
                 ├─► 4. non-email tools (calendar/research/docs/CRM)     [needs dispatch + gated writes]
                 │
                 └─► 5. media canvas over Pikar-Ai MCP                   [needs dispatch + cost/asset handling]

6. dynamic skills: user-authored → agent-authored                        [self-mod, governance-heavy, LATE]
7. Governance & beta: requireOwner + cross-user isolation test +         [multi-user comes LAST]
   ISO 9001 formalization + productionization
```

- **0 is non-negotiably first** — it's the "root" the launch-readiness review named; every intelligent feature grounds against the vault.
- **2 before 4 and 5** — non-email tools and media are *specialists*; the dispatch framework must exist first, or each capability re-forks the loop.
- **1 before 3** — the proactive schedule runs the on-demand engine; build the engine, then schedule it.
- **6 late** — self-authored skills are self-modification; ship the registry-consumer features first so there's something worth authoring skills *for*, and so the EVAL_GATE has real fixtures to reason about.
- **7 last** — multi-user isolation + `requireOwner` gate the beta; per the phase-8 owner-auth blocker (memory), the ops/optimizer controls are currently tenant-callable with no owner-role primitive, so `requireOwner` + the cross-user isolation test must land before real users, i.e. at the very end.

## Anti-Patterns (specific to this integration)

### Anti-Pattern 1: Making an external side-effect an LLM tool
**What people do:** `sendEmail` / `createCalendarEvent` / `deliverMedia` as a tool the model calls.
**Why it's wrong:** breaks invariant 3 — the human Approve gate. The model must never cause an
irreversible external effect.
**Instead:** tools *stage* into the plan; a human-triggered `executePlan` mutation performs the
effect. `proposePlan` (`llm.ts:1083`) is the template — it only flips status, it does not send.

### Anti-Pattern 2: A sub-agent as a nested `generateText` loop
**What people do:** a `dispatchSubAgent` tool that runs its own inner agent loop.
**Why it's wrong:** forks the cost accumulator and step budget; the outer `preCall`/`stepCountIs(8)`
no longer bound the turn; tempts the inner loop to "execute."
**Instead:** one loop, a swapped `(skill body, tool-set)` pair selected by the router. Governance
written once in `runAgentLoop`.

### Anti-Pattern 3: Grounding/eval/media content leaking into audit
**What people do:** log the retrieved vault text, the evaluation prose, or a media URL "for debugging."
**Why it's wrong:** breaks invariant 2 — the audit becomes a PII/content honeypot. `llmRedaction.test.ts`
statically scans these blocks.
**Instead:** content-plane returns to the model; audit/deadLetter payloads carry `docIds`/counts/hashes
only. Follow `briefings.ts` (writes NO audit row) and the refs-only `mailbox.listed` payload.

### Anti-Pattern 4: Bypassing EVAL_GATE for a "quick" skill activation
**What people do:** let a user/agent-authored skill go active directly.
**Why it's wrong:** breaks invariant 4 and the moat's held-out-validation guarantee.
**Instead:** `insertCandidate` (candidate only) → evidence → owner `activateCandidate` (the ONE gated
flip in `activateSkillVersion`). Rollback stays exempt-by-status.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Pikar-Ai MCP (media) | MCP client from a Convex action; `models_explore(recommend)` then `generate_*` | Do NOT rebuild generation (PROJECT.md); store asset refs under tenantId; cost-gate the turn |
| Google Calendar / web-search / CRM | Thin Convex action adapters, secrets in Convex env | Read tools execute in-loop; writes route through the Approve mutation |
| OpenAI embeddings (RAG) | `vaultRag.ts` single `rag` instance, `text-embedding-3-small`@1536 | Already wired; grounding just needs a caller (feature 1) |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| tool ↔ vault grounding | `ctx.runAction(internal.vaultGround.groundInternal)` | Extract internal entry from the `tenantAction` so the tool passes its closure `tenantId` |
| router ↔ specialist | `routingSchema.sub_agent{specialist}` → `(skill, toolset)` registry | Fail-closed: unknown specialist → `unknown_route`, never a default |
| loop ↔ Approve gate | `proposePlan` flips status; `executePlan` (mutation) sends | The one-way boundary the whole governance story rests on |
| cron ↔ in-app digest | `crons.daily` → internal action → `briefings`-style row + `notify` | No mailbox token; content-plane row writes no audit |
| author ↔ registry | `insertCandidate` (candidate) → `activateCandidate` (EVAL_GATE) | Agent can only write candidates; owner + evidence activate |

## Sources

- `packages/backend/convex/llm.ts` — `runCockpitAgent:1749`, `runAgentLoop:1478`, `buildCockpitTools:607`, `proposePlan:1083`, `briefInbox:1181`, `renderAndStore:652` (read at span; HIGH)
- `packages/backend/convex/cockpit.ts:494` — `executePlan` Approve gate (HIGH)
- `packages/backend/convex/vaultGround.ts:25` — grounding action, zero callers (HIGH)
- `packages/contracts/src/routing.ts` — `sub_agent` enum + fail-closed `parseRouting` (HIGH)
- `packages/backend/convex/skills.ts` — `insertCandidate:317`, `activateSkillVersion:80`, `activateCandidate:139`, `candidatesForReview:154`, `seedSkills:235` (HIGH)
- `packages/backend/convex/briefings.ts`, `crons.ts`, `vaultRag.ts`, `schema.ts` — in-app digest / schedule / RAG / tables patterns (HIGH)
- `.planning/PROJECT.md` — v2.0 milestone target features + staircase (HIGH)
- MCP server instructions (Pikar-Ai) — media generation tool surface (HIGH)

---
*Architecture research for: governed agentic platform — v2.0 breadth-of-action integration*
*Researched: 2026-07-24*
