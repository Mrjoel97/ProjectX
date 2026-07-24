# Project Research Summary

**Project:** Pikar AI — v2.0 Platform (chief-of-staff breadth + private beta)
**Domain:** Governed multi-tenant agentic operating layer, expanding a shipped Convex/TS email cockpit into a broad AI chief-of-staff, then opening a private beta
**Researched:** 2026-07-24
**Confidence:** HIGH

## Executive Summary

This is breadth-on-an-existing-spine, not a greenfield build. All four studies converge on the same conclusion: the governed tool-loop, the plan→approve→execute gate, the skills registry, the audit spine, and the vault/RAG machinery already exist and are load-bearing — the milestone's job is to wire new capabilities through the same seams, not invent new ones. The stack delta is near-zero (two genuinely new runtime deps: `@modelcontextprotocol/sdk` for the media MCP client, `@azure/msal-node` for Microsoft Graph auth, plus optionally `@tavily/core` for web research); everything else is a new pure-TS `packages/*` module plus a thin `convex/` adapter over already-installed dependencies. The single highest-leverage piece of work is wiring the already-built vault retrieval (`vaultGround.ts`, currently zero callers) into the agent as a `searchVault` tool — almost every other capability (evaluation, the flagship voice-doc workflow, credible sub-agent output) is boilerplate without it.

The recommended approach is the four-stage staircase all four studies independently arrive at: S1 Foundation & Intelligence (vault wiring, business evaluation, flagship voice-doc workflow) → S2 Breadth of Action (real sub-agent dispatch via one exemplar, non-email action tools) → S3 Creation & Self-Extension (media canvas, dynamic skills) → S4 Governance & Productionization (owner-gating, cross-tenant isolation, invite/OAuth reconciliation, ISO 9001 formalization). Each capability is architecturally a variation on two existing mechanisms: a read-only tool that returns content to the model (mirrors `listInbox`/`briefInbox`), or a staged write that proposes into a plan and only executes via the human-triggered `executePlan` mutation. No new capability may create a third mechanism.

The key risks are governance regressions, not build risk: (1) sub-agent dispatch fanning out into runaway cost/loops with no lineage; (2) grounded/retrieved content leaking into the insert-only audit or becoming injected instructions; (3) a self-authored skill finding a path to `active` status without the eval gate; (4) the evaluation engine fabricating gaps or generic advice to look useful; (5) the three known un-gated Phase-8 owner-only functions remaining live authorization holes when the beta opens a second user. All five are addressed below as explicit phase success criteria, not follow-up work — they are cheap to prevent at each phase and expensive (in one case, WORM-immutable) to fix after.

## Key Findings

### Recommended Stack

Six of seven new capabilities need zero or one new dependency, because the codebase already has the exact seam every external integration needs: `gmail.ts`'s pattern of a `"use node"` action, raw `fetch`, one shared OAuth-refresh root, a discriminated result, and retrier-driven retries. New capabilities extend `buildCockpitTools`/`runAgentLoop`, they don't reinvent orchestration. The two genuine new-dependency decisions are an MCP client for the connected Pikar-Ai media service and MSAL for Microsoft Graph's auth model (different enough from Google's to hand-roll safely). `docx` output is explicitly deferred (PDF via existing `pdf-lib` already covers delivery) and `@convex-dev/workpool` needs only a devDep→dep promotion, not a new install.

**Core technologies:**
- `@modelcontextprotocol/sdk@1.29.0` — MCP client for the connected Pikar-Ai media service (image/video/audio/3D generation) — `ai@7.0.20` ships no MCP client, so this is a genuine addition; `StreamableHTTPClientTransport` + built-in OAuth fits the remote OAuth-gated connector
- `@azure/msal-node@5.4.2` — Microsoft Graph delegated auth-code + refresh + token cache — Graph's auth model differs enough from Google's that hand-rolling it at the security boundary is the wrong place to be lazy
- `@tavily/core@0.7.6` (or raw-fetch its REST API, skipping the SDK) — web research tool returning ranked results plus cleaned page content in one call, avoiding a bespoke fetch+strip pipeline
- `@convex-dev/workpool@0.4.7→0.4.8` (promote existing devDep to dep) — bounded parallel fan-out for sub-agent dispatch and async media jobs
- Everything else (evaluation engine, sub-agent dispatch, calendar, contacts/CRM, self-authored skills, QMS tables) — no new package; pure-TS `packages/*` + thin `convex/` adapters over `ai@7.0.20`, `zod@4`, Convex cron/scheduler, and the existing `skills`/`audit`/`vaultRag` tables

**Explicitly avoid:** LangChain/LangGraph/CrewAI/AutoGen (duplicate `generateText` + `@convex-dev/workflow`, bypass tenant wrappers), any model-hosting/inference SDK for media (rebuilds what the Pikar-Ai MCP already provides), Playwright/Puppeteer at runtime (dev-only e2e tool; SSRF/security surface in product), `@microsoft/microsoft-graph-client` (stale thin wrapper; repo precedent is raw fetch), a rules-engine/BPMN runtime for evaluation, and any external prompt-management SaaS (duplicates the skills registry + audit).

### Expected Features

Full detail in FEATURES.md by capability (evaluation engine, flagship voice-doc workflow, sub-agent dispatch, non-email action tools, media canvas, dynamic skills). The unifying theme across all six: Pikar's moat is doing what generic AI tools already do, but grounded (the user's own vault data, not textbook boilerplate), governed (every external effect through the single approval gate), and action-connected (findings become approvable next steps, not static reports).

**Must have (table stakes):**
- Vault→agent read tool — the linchpin; retrieval is shipped but has zero agent callers today
- Business profile intake + persona-tuned, framework-structured (SWOT + stage-appropriate canvas) evaluation, grounded in the user's own vault data, with severity-rated gaps
- Flagship: upload a report → discuss by voice → surface insights/gaps with citations → memo or gap-bridging plan, including an honest "no gaps found" path
- One real sub-agent (Research exemplar) behind a now-real dispatcher, with context handoff and audit continuity across the hop
- Calendar read/create, web research, document/content creation, contacts read/lookup — each reusing the shipped adapter/governance pattern
- Image + video (≤3 min) generation as a thin wrap of the connected Pikar-Ai MCP service, with assets stored/governed like any other artifact
- User-authored skills with the existing draft→publish→rollback lifecycle, tenant-scoped

**Should have (competitive differentiators):**
- Evaluation advice that emits a concrete, approvable next action per gap (not a static report)
- Voice-native back-and-forth over a specific document (interrupt, drill in, redirect), plus cross-document pattern detection once vault history is rich
- Scheduled proactive in-app review (chief-of-staff initiates, not purely reactive)
- Governed sub-agent tool scoping (each specialist reaches only its own tools) with a transparent "who did what" hop chain in the plan card
- Media edit tools (upscale/outpaint/remove-bg/reframe) preferred over regenerate; media invoked as a routed tool inside a plan, not a silo
- Agent-authored skills (LATE — self-modification, eval-gated, human-approved)

**Defer / anti-features (explicitly do not build):**
- Free-form "AI business coach" chat, fabricated metrics/benchmarks, a numeric viability score, or auto-executing recommended actions
- Fixed-quota "always find 3-5 gaps," unbounded voice sessions, summarize-only document analysis
- A full agent swarm on day one, one-agent-per-tool, agents autonomously spawning agents, free inter-agent negotiation loops
- Full CRM (pipelines/deal stages), autonomous calendar invites without approval, unrestricted/unscoped web browsing
- Building a generation pipeline or hosting models, a full timeline/NLE video editor, unbounded video length, auto-publishing generated media to social
- Agent self-publishing skills without human approval, arbitrary code execution in skills, third-party/marketplace skill sharing

### Architecture Approach

The existing system is one governed tool-loop per turn (`runCockpitAgent` → `runAgentLoop`'s `generateText({tools, stopWhen: stepCountIs(8)})` → `buildCockpitTools`) gated by a human-triggered `executePlan` mutation that is structurally separate from any LLM tool. Every v2.0 feature is a variation on two integration shapes: a read-only tool that returns content in-loop (the `searchVault`/`listInbox` shape), or a tool that stages a pending action onto the plan for the human approve-gate to execute (the `proposePlan`/`executePlan` shape). The architecture research is explicit that a sub-agent must be a swappable `(skill body, tool-set)` pair the SAME loop runs — never a nested `generateText` call — because a nested loop forks the cost accumulator and the step budget, and tempts a specialist to "execute" from inside a tool.

**Major components:**
1. `runAgentLoop` (`llm.ts:1478`) — the one governed loop; parameterized by skill + tool-set so sub-agents reuse it rather than forking it
2. `buildCockpitTools` (`llm.ts:607`) — becomes one entry in a new tool-set registry keyed by specialist; new tools (`searchVault`, `evaluateBusiness`, calendar/research/contacts/media) are added here or in specialist variants, never as a parallel mechanism
3. `cockpit.executePlan` (`cockpit.ts:494`) — the sole Approve gate; must be generalized beyond email so calendar/CRM/media writes route through the same mutation instead of a second bespoke executor
4. `vaultGround.ts` (unwired) — hybrid RAG+graph retrieval; needs an internal entry point (`groundInternal`) callable from a tool closure, not a redesign
5. Skills registry (`skills.ts`) — `insertCandidate` (candidate-only write) / `activateCandidate` (the one EVAL_GATE flip) already provide the safe self-authoring seam; dynamic skills reuse it verbatim
6. Crons + `briefings.ts` — the in-app-digest pattern (no audit row, no OAuth token) that the scheduled proactive review must follow exactly

### Critical Pitfalls

1. **Agent-authored skill self-activates, bypassing the eval gate** — capability-minimize: agent-reachable skill tools must be physically unable to call `activateCandidate`; authoring can only ever produce a `candidate`; activation requires `requireOwner` + a passing held-out eval.
2. **Indirect prompt injection via vault/web content** — grounded and researched text is data, never instructions; quarantine it with delimiters, give research sub-agents no send/write capability, and keep every external-effect tool behind the plan-approval gate so an injection can at most propose, never execute.
3. **Sub-agent dispatch fans out into runaway cost/loops with no accountability** — enforce a hard depth cap, a shared root-request budget envelope (not a fresh envelope per sub-agent), cycle refusal, and `rootRequestId`/`parentAgentId` lineage in every audit row, as non-negotiable success criteria of the dispatch phase itself.
4. **Evaluation engine fabricates gaps or gives generic/hallucinated advice** — ground every finding in a citation (vault ref or web-research result) or don't surface it; make "no gaps found" a first-class, eval-tested outcome; a healthy-business fixture must return zero gaps.
5. **Grounded vault/business content leaks into audit, telemetry, or step rows** — redact-then-write must extend to the new content channels grounding introduces (step traces, evaluation findings, sub-agent traces); a regression test must assert no audit/telemetry/step/DLQ row contains any substring of a source document.

## Implications for Roadmap

Based on combined research, the four-stage staircase is dependency-forced, not a preference — all four studies independently converge on it.

### Phase Group S1: Foundation & Intelligence
**Rationale:** Vault→agent wiring is the root every other capability depends on (evaluation, flagship workflow, and credible sub-agent output all collapse to boilerplate without it) — architecturally and dependency-wise it must ship first.
**Delivers:** `searchVault` tool wired into `buildCockpitTools`; business profile intake + evaluation engine (SWOT/canvas, grounded, action-emitting, honest "no gaps"); the flagship upload→discuss-by-voice→gaps→memo/plan workflow (mostly integration of shipped extraction + voice); scheduled proactive in-app-only review.
**Addresses (FEATURES.md):** Vault→agent read tool, business profile intake, business evaluation engine, flagship voice-doc workflow, scheduled proactive review.
**Avoids (PITFALLS.md):** Pitfall 5 (grounded PII into audit/telemetry — redaction boundary must extend in this same phase, not after); Pitfall 4 (non-credible evaluation — healthy-business fixture returns zero gaps, every finding sourced); Pitfall 7 (proactive review must touch no OAuth token, in-app only); Pitfall 2 partially (quarantine established here, must not regress in S2).

### Phase Group S2: Breadth of Action
**Rationale:** Non-email tools and future specialists are architecturally sub-agents; the dispatch framework (one loop, swappable skill+tool-set) must exist before any specialist tool is added, or each capability re-forks the loop.
**Delivers:** Real `sub_agent` dispatch via one Research exemplar (not a swarm); non-email action tools (calendar read/create, web research, document/content creation, contacts/CRM) as specialist tools, with writes staged into the plan and executed only via a generalized `executePlan`/`deliverApprovedPlan`.
**Uses (STACK.md):** `@tavily/core` (web research), existing Google/MS OAuth roots extended with new scopes, `@convex-dev/workpool` (promoted dep) for bounded fan-out.
**Implements (ARCHITECTURE.md):** Tool-set registry `{specialistId → (skillName, buildToolset)}`; `deliverApprovedPlan.ts` generalized to dispatch by action type, not email-only.
**Avoids:** Pitfall 3 (multi-agent runaway — depth cap, shared root budget, cycle refusal, lineage fields are phase success criteria, present before the first exemplar ships); Pitfall 2 must not regress (web research content stays untrusted data; research sub-agent has no send/write capability); Anti-Pattern 1 (no external side-effect ever becomes a tool call — every write stages into the plan).

### Phase Group S3: Creation & Self-Extension
**Rationale:** Both media canvas and dynamic skills are lower-risk / higher-optionality once the dispatch framework and gated write path exist; dynamic skills specifically depend on there being real specialist capability worth authoring skills for, and on the eval harness having real fixtures to validate against.
**Delivers:** Media canvas (`generateMedia` tool in a media specialist calling the connected Pikar-Ai MCP, async job model, separate capped media budget, moderation-verdict logging); user-authored dynamic skills first, agent-authored (self-modification) skills last, both routed through the existing `insertCandidate`→eval→`activateCandidate` seam.
**Uses:** `@modelcontextprotocol/sdk`, `@convex-dev/workpool`/action-retrier for async media jobs.
**Avoids:** Pitfall 6 (media must never be synchronous or agent-fired without approval — async by construction, own budget line, moderation ref only in audit); Pitfall 1 (agent tools must be structurally incapable of calling `activateCandidate`; every agent-authored skill is a candidate only, gated by owner + passing eval).

### Phase Group S4: Governance & Productionization (opens the beta)
**Rationale:** Multi-user comes last by design — per the phase-8 owner-auth blocker (project memory), three self-improvement functions are currently callable by any authenticated user because no owner-role primitive exists; this is a hard authorization/information-disclosure blocker that must close before a second user ever exists. `requireOwner` is a shared dependency multiple earlier findings point back to — pull it in EARLY within this phase group so it can gate everything, not just the invite flow.
**Delivers:** `requireOwner(ctx)` primitive gating the three known Phase-8 functions (`optimizerConfig.setOptimizerEnabled`, `skills.activateCandidate`, `skills.candidatesForReview`) and every new admin-ish control at birth; a cross-tenant isolation test covering every table/surface added across S1–S3; invite/waitlist flow binding to the OAuth subject (not typed email) with mismatch rejection, tested against both Google and Microsoft subject formats; Microsoft Graph/Outlook as a second delivery provider behind a `packages/delivery` abstraction (MSAL + raw fetch); ISO 9001:2015 formalization as a clause→existing-artifact conformance map, not new procedure documents.
**Uses:** `@azure/msal-node`, existing `betaInvites`/roles concept, existing audit/playbook/ADR spine for the QMS map.
**Avoids:** Pitfall 8a (cross-tenant isolation regressions — assertions written as each S1-S3 surface ships, not retrofitted); Pitfall 8b (owner-gating holes — three functions + any new admin control); Pitfall 8c (invite/OAuth identity mismatch — bind on subject at first sign-in, reject cross-subject re-redemption); Pitfall 9 (ISO process-theater — map clauses to existing artifacts, only fill genuine gaps).

### Phase Ordering Rationale

- Vault wiring is non-negotiably first (S1) — every "grounded, not generic" claim across the whole milestone depends on it; it is low effort and the single highest-leverage item in the research.
- Dispatch (S2) must precede specialist tools and media — a dispatcher with nothing specialized to dispatch to is the current hollow state; build one sub-agent and its tools together as the proof, then let calendar/research/contacts/media ride the same seam.
- The evaluation engine (S1) precedes market-fact credibility, which depends on web research (S2) — sequence any "current market claim" capability after S2 lands; S1's engine must scope itself to vault-grounded findings only until then.
- Self-modification (S3, agent-authored skills) is correctly last among the capability phases — it needs a real eval harness with real fixtures, which only exists once there's something worth authoring skills for.
- Governance (S4) is last overall — `requireOwner` and the isolation test gate the beta open; shipping multi-user before them converts three latent bugs into live authorization/disclosure holes on day one of a second user.
- Two invariants must be checked as a gate at the end of every phase in this roadmap, not just S4: (a) the Approve gate stays a mutation, never a tool, for any new external effect; (b) no new content channel (grounding, evaluation, sub-agent trace, media) writes anything but refs/hashes/counts into audit, telemetry, or DLQ.

### Research Flags

Needs phase-specific research (`/gsd:research-phase`) before or during planning:
- **Media canvas phase (S3):** Pikar-Ai MCP's OAuth/token-exchange flow for backend (non-Claude) callers is unverified from the repo (STACK.md flags MEDIUM confidence) — a spike to confirm the transport + token exchange is the first task. Also unresolved: the connector's pricing units (per-image/per-second-of-video) needed to build the separate media cost-guardrail line.
- **S4 productionization phase:** Microsoft Graph OAuth subject format for invite reconciliation needs verification against the actual delegated-flow response shape before the invite-binding logic is built; this determines whether the "one invite = one subject" rule can be implemented identically to Google or needs a provider-specific adapter.
- **S1/S4 shared dependency:** whether `packages/pii`'s structured-only scrub (names-in-prose ceiling, flagged in Phase-8 memory) must be upgraded (e.g., toward a Presidio-backed path) before grounded business-profile content is ever written to an exportable table — this is a genuine open design question, not just an implementation detail, and should get a short spike before S1's redaction-boundary work is finalized.
- **S1 evaluation engine:** the confidence-threshold for persona detection (solopreneur vs. startup vs. SME) — FEATURES.md specifies "confirm with user, never silently assume" but the auto-classify confidence bar itself isn't researched.

Phases with standard, well-documented patterns (research-phase can likely be skipped):
- **Non-email action tools (S2):** calendar/contacts/doc-creation all mirror the shipped `gmail.ts` adapter pattern exactly; no new pattern to discover.
- **Dynamic skills — user-authored (S3):** the write/gate/review seam (`insertCandidate`/`activateCandidate`/`candidatesForReview`) already exists and is fully specified in ARCHITECTURE.md.
- **Sub-agent dispatch mechanism (S2):** the `(skill, tool-set)`-swap-in-one-loop design is fully specified with file:function references; the open question is the specialist roster, not the mechanism.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified live against npm registry 2026-07-24; integration patterns read from actual code (`gmail.ts`, `llm.ts`); only the Pikar-Ai MCP's backend OAuth specifics are MEDIUM (remote connector, not inspectable from the repo) |
| Features | MEDIUM-HIGH | Domain/dependency patterns HIGH (grounded in shipped code + PROJECT.md); credibility/anti-pattern framing verified via multiple web sources (MEDIUM); exact scope calls (what's P1 vs P2) are opinionated recommendations, not externally validated |
| Architecture | HIGH | Every integration point is a verified `file:function` read at the span in the current tree; supersedes and is consistent with the prior v1.0 architecture study |
| Pitfalls | HIGH | Grounded in this repo's shipped governance mechanisms plus verified 2026 external sources for injection/OAuth/ISO claims; ISO clause-mapping specifically flagged MEDIUM (interpretive) |

**Overall confidence:** HIGH

### Gaps to Address

- Pikar-Ai MCP backend auth mechanism (media, S3) — unverified from the repo; requires a spike before the media specialist's adapter action can be written.
- Media pricing units (S3) — needed to size the new media cost-guardrail line; not discoverable without querying the connector or its docs directly.
- Names-in-prose PII scrub ceiling (shared S1/S4 dependency) — `packages/pii` covers structured PII only; whether this must be closed before grounded content reaches any exportable/WORM table is a real open design decision, not just a task, and should be resolved before S1's redaction-boundary work is called done.
- Microsoft Graph OAuth subject format (S4, invite reconciliation) — needs confirmation against the actual delegated-flow token response before the invite→subject binding logic assumes parity with Google's subject format.
- Persona-detection confidence threshold (S1, evaluation engine) — the requirement to "confirm with user, never silently assume" is set; the auto-classify confidence bar that triggers confirmation vs. auto-proceed is not yet specified.

## Sources

### Primary (HIGH confidence)
- Live npm registry checks (2026-07-24) for all new/candidate dependency versions
- Repo code read via graphify + direct file reads: `gmail.ts`, `llm.ts` (`runCockpitAgent`, `runAgentLoop`, `buildCockpitTools`, `proposePlan`, `briefInbox`, `renderAndStore`), `cockpit.ts:executePlan`, `vaultGround.ts`, `contracts/routing.ts`, `skills.ts` (`insertCandidate`, `activateSkillVersion`, `activateCandidate`, `candidatesForReview`, `seedSkills`), `briefings.ts`, `crons.ts`, `vaultRag.ts`, `schema.ts`
- `.planning/PROJECT.md` — v2.0 milestone target features, staircase, Key Decisions
- `.planning/phases/09-private-beta-productionization/09-CONTEXT.md` — DLVR-02 Microsoft Graph scope
- Connected Pikar-Ai MCP server instructions and tool catalog (this session's connector)
- CLAUDE.md repository conventions; project memory (`phase8-owner-auth-blockers`, `tenant-scope-is-per-session`, `llm-use-vercel-ai-gateway`)

### Secondary (MEDIUM confidence)
- Multi-agent supervisor/handoff pattern sources (Microsoft Azure Databricks guide, Medium/DEV.to supervisor-pattern writeups, Educative agent-orchestration course)
- Business evaluation framework sources (FasterCapital, Medium PESTEL/SWOT/Lean Canvas, FourWeekMBA BMC-vs-SWOT)
- "Why AI business advice is generic" sources (Medium, Entrepreneur, What Works Growth)
- Prompt injection defense guidance (Maxim AI 2026 guide; Palo Alto Unit 42 web-based indirect injection research)
- Google OAuth 7-day testing-mode refresh token expiry (Unipile; Google Cloud Help — verified current 2026)

### Tertiary (LOW confidence)
- ISO 9001:2015 clause-to-artifact mapping — interpretive, needs validation against the actual standard text during S4 planning

---
*Research completed: 2026-07-24*
*Ready for roadmap: yes*
