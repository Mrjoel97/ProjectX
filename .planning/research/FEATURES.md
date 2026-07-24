# Feature Research

**Domain:** AI chief-of-staff platform for solopreneurs / startups / SMEs (v2.0 platform milestone — NEW capabilities only)
**Researched:** 2026-07-24
**Confidence:** MEDIUM-HIGH (domain patterns HIGH; credibility/anti-pattern framing verified via web; exact scope calls are opinionated recommendations)

> Scope: this file covers ONLY the six NEW v2.0 capability areas. The shipped v1 email cockpit, inbox, live voice (plan→send), knowledge vault storage+retrieval, attachment extraction, and feedback/prompt-optimization are treated as **existing dependencies**, not researched here. (v1-milestone feature research preserved in `FEATURES-v1.md`.)

---

## Capability 1 — Persona-Aware Business/Idea Evaluation Engine

Detect solopreneur / startup / SME, produce an assessment (strengths / risks / gaps / opportunities) that **drives actions**, plus scheduled proactive in-app review.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Structured business profile intake (persona + stage + industry + model) | Advice is generic without it — the #1 cause of "hollow AI advice" is missing context | MEDIUM | Persona onboarding already scoped in Foundation; profile lives in vault. Detect via classify, then **confirm with user** (never silently assume) |
| Named-framework assessment (SWOT + at least one model canvas) | Users recognize and trust known frameworks; unstructured prose reads as filler | LOW-MEDIUM | SWOT for internal/external; Business Model Canvas or Lean Canvas by stage (Lean for pre-revenue/startup, BMC for operating SME) |
| Grounded-in-*their*-data assessment | Advice must cite the user's own vault (their numbers, docs, prior briefs), not textbook boilerplate | MEDIUM | Hard dependency on **vault→agent wiring** (Cap 4/Foundation). The single biggest credibility lever |
| Gap detection with severity | An "assessment" that only praises is worthless; users expect honest risk/gap surfacing | MEDIUM | Each gap = {what, why it matters to *this* business, severity} |
| Re-run / refresh assessment on demand | Business changes; a one-shot report goes stale | LOW | Re-runs against updated vault state |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Advice that drives action** (each finding → a concrete proposed next step routed through the governed plan→approve→execute spine) | The moat: competitors output a static PDF; Pikar turns a gap into a scheduled, approvable action | MEDIUM-HIGH | Each gap emits a candidate action (draft outreach, book review, research task) the user approves. Reuses per-plan approval gate — no new governance |
| Persona-tuned framework selection + benchmarks | Solopreneur gets time/cash-runway lens; SME gets process/ops lens. Same input, different rubric = feels bespoke | MEDIUM | Persona selects frameworks + questions. Store rubrics as **skills** (Cap 6), not hardcoded — satisfies CLAUDE.md §5 |
| Scheduled proactive in-app review ("your quarterly check-in is ready") | Chief-of-staff *initiates*; most tools are purely reactive. Retention driver | MEDIUM | Convex scheduler already in stack. **In-app only** (not email) per PROJECT scope. Delta-focused: what changed since last review |
| Unit-economics / metric-aware findings (CAC, LTV, runway, margin) | Numbers make advice credible and specific; separates "advisor" from "chatbot" | MEDIUM | Only when the user supplied the numbers; else flag a data gap rather than invent figures |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Generic "AI business coach" free-form chat | Feels flexible/impressive | Produces exactly the hollow one-size-fits-all advice this engine exists to beat; unfalsifiable, un-actionable | Framework-structured output grounded in vault data with explicit findings |
| Fabricated metrics / made-up benchmarks to fill a template | Makes the report look complete | Destroys trust the moment the user spots one wrong number; a compliance/credibility hazard | Honest **data-gap flags** ("I can't assess CAC — you haven't provided acquisition-cost data") |
| Numeric "viability score" (e.g. 78/100) | Looks decisive, shareable | False precision; users over-index on a number with no defensible basis, and it invites gaming | Qualitative severity + the *reasoning*; let the user judge |
| Auto-executing recommended actions without approval | "Just handle it" | Violates the single-approval-gate promise and the chief-of-staff trust model | Every action goes through the existing plan→approve gate |

---

## Capability 2 — Flagship: Upload a Report → Discuss by Voice → Surface Insights/Gaps → Memo or Gap-Bridging Plan

The signature workflow. Honest "no gaps" when there are none; the user decides what happens next.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Ingest an uploaded report (PDF/doc/spreadsheet) into groundable context | The workflow's premise | LOW | **Attachment extraction already shipped**; wire its output into vault retrieval |
| Voice discussion grounded in the document | "Discuss it by voice" — the identity feature | MEDIUM | **Live voice already shipped (plan→send)**; new work is grounding the session on a *specific document*, not the whole vault |
| Insight / pattern / gap surfacing with citations | Analysis users trust must point at the source passage | MEDIUM | Every claim cites a document location; no ungrounded assertions |
| Produce a memo OR a gap-bridging plan as output | The tangible takeaway | MEDIUM | Memo = doc-creation tool (Cap 4); plan = existing plan engine. User picks |
| **Honest "no gaps found"** | Credibility gate — a tool that always "finds problems" is selling, not analyzing | MEDIUM | Explicit no-gap path; do NOT manufacture findings to seem useful. A *feature* and a hard anti-hallucination requirement |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Voice-native back-and-forth over a document (interrupt, drill in, redirect) | No competitor lets a solopreneur *talk through* their board deck / financials and get grounded pushback | MEDIUM-HIGH | Builds on shipped bidirectional voice; add doc-scoped retrieval + turn context |
| Cross-document pattern detection (this report vs. prior vault reports) | "Your churn narrative contradicts last quarter's brief" — memory a human COS would have | HIGH | Depends on vault holding prior docs indexed; retrieval across documents |
| Session → memo → routed action in one flow | Discussion doesn't die as a transcript; it becomes a deliverable and optionally an executed plan | MEDIUM | Transcript→brief already exists; extend to memo/plan artifact |
| User-decides branch point | Respects the approval/agency model; the analysis proposes, the human disposes | LOW | Present options (memo / plan / nothing / dig deeper); never auto-proceed |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Always surface "3-5 key gaps" (fixed quota) | Feels thorough | Forces fabrication when the doc is clean; trains users to distrust | Variable-length findings incl. zero; honest no-gap |
| Unbounded voice session | "Let me keep talking" | Cost + the shipped 15-min cap exists for a reason | Reuse the existing 15-min cap + End-session control |
| Summarize-only (no discussion, no action) | Easy to build | It's just a summarizer — commodity, no moat, no follow-through | Value is discussion + grounded gaps + routed action |
| Silently analyzing documents the agent can't actually parse (scanned images w/o OCR, huge spreadsheets) | Looks capable | Silent degradation → confidently wrong analysis | Detect extraction quality; tell the user what couldn't be read |

---

## Capability 3 — Real Multi-Agent / Sub-Agent Chief-of-Staff (Dispatcher → Specialized Sub-Agents)

Make the currently-hollow `sub_agent` route real: a supervisor/dispatcher routes to specialized sub-agents.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Supervisor/dispatcher that routes an intake to the right specialist | The defining shape; the Executive Agent already classifies routes | MEDIUM | Extend existing classifier; route enum becomes real handlers. **One real exemplar first** (per PROJECT), not a full team on day one |
| Context handoff (supervisor → sub-agent → back) | Sub-agent needs the request + relevant vault context; result must return to the spine | MEDIUM | One-way handoff w/ context payload; results re-enter the governed plan |
| Per-sub-agent skill/prompt from the registry | Specialization = a different skill doc, not different code | LOW-MEDIUM | Reuses skills registry (§5); a sub-agent ≈ a skill + tool subset |
| Audit trail across the agent hop | Every model call/tool already logged; multi-agent must not create blind spots | LOW | Existing audit spine covers it — enforce it extends across hops |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Sensible agent-team decomposition (by *function*, not by tool) | Maps to how a real office splits work: Research, Comms, Analysis, Ops. Legible to the user | MEDIUM | Recommended split below. Decompose by **skill domain**, never one-agent-per-API-call |
| Governed sub-agent tool scoping | Each sub-agent reaches only its own tools (research agent can't send email) — safety + clarity | MEDIUM | Tool allow-list per sub-agent; smaller blast radius |
| Transparent "who did what" in the plan card | User sees "Research agent gathered X, Comms agent drafted Y" — builds trust in delegation | LOW-MEDIUM | Surface the hop chain in the existing plan/notification UI |

**Recommended decomposition (function-based, start with ONE):**
- **Research** — web/vault gathering, synthesis (first exemplar candidate)
- **Analysis/Evaluation** — powers Capability 1 & 2
- **Comms** — email/memo/content drafting (wraps the shipped cockpit)
- **Ops/Scheduling** — calendar, contacts, follow-ups

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Full agent swarm on day one** | Looks impressive, "agentic" | Verified pitfall: the supervisor becomes a bottleneck, latency + cost multiply, debugging is brutal, handoffs lose context. Over-engineering for a solo user's workloads | Single agent handles most tasks; add a sub-agent only when a task needs a *distinct skill+tool set*. Start with one exemplar |
| One agent per tool/API | Seems clean/modular | Explodes agent count, multiplies hops for trivial calls; a tool is not an agent | Tools are functions the Executive Agent calls directly; sub-agents are for multi-step specialized *reasoning* |
| Agents autonomously spawning agents | "Self-organizing" | Unbounded cost/recursion, un-auditable, ungovernable — hostile to the compliance moat | Fixed, declared roster; supervisor routes only to known sub-agents |
| Free inter-agent chatter / negotiation loops | Mimics human teams | Token burn with little marginal quality; nondeterministic | One-way handoff with explicit context payload; deterministic return to spine |
| Multi-agent where a single prompt suffices | "More agents = smarter" | Verified: single agents are correct for tasks accepting a general answer; multi-agent adds cost/latency with no gain | Route to `direct_llm` / `direct_tool`; reserve `sub_agent` for genuinely complex, multi-skill tasks |

---

## Capability 4 — Non-Email Action Tools (Calendar, Web Research, Document/Content Creation, Contacts/CRM)

Break the "every tool is a mailbox primitive" ceiling.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Vault read tool for the agent** | The most urgent gap: vault retrieval exists but has *zero agent callers*. Everything credible depends on it | LOW-MEDIUM | Foundation phase. Highest-leverage single wire in the milestone |
| Calendar read/create (Google + MS Graph) | A COS that can't see/book time isn't a COS | MEDIUM | OAuth already established for Gmail/Graph; extend scopes. Create-events go through the approval gate |
| Web research tool | Grounding evaluations/memos in current external facts | MEDIUM | Fetch + synthesize with citations; feeds the Research sub-agent |
| Document/content creation (memo, brief, one-pager) | Output artifacts for Cap 1 & 2 | MEDIUM | Generate structured docs into the vault; reuse the deterministic renderer pattern from shipped PDF attachments |
| Contacts read/lookup | Personalization + follow-ups need a contact model; cockpit already resolves contacts | LOW-MEDIUM | Extend existing contact-resolution (never substitute an unmatched name — shipped invariant) |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Lightweight CRM / follow-up tracking | "Nudge me to follow up with X in a week" — the ops memory a solopreneur lacks | MEDIUM | Contacts + scheduled reminders (Convex scheduler) + vault notes. NOT a Salesforce clone |
| Tools composed inside one approved plan | "Research the market, draft a memo, book a review" as one governed plan | MEDIUM-HIGH | The multi-tool payoff; per-plan approval already supports multi-step |
| Provider-agnostic tool adapters | Google + MS Graph parity, same as the email adapter | MEDIUM | Mirror the shipped provider-agnostic email adapter pattern |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full CRM (pipelines, deal stages, reporting) | "We need a CRM" | Massive scope, competes with Hubspot/Pipedrive, not the COS job | Contacts + follow-up reminders only; integrate real CRMs later |
| Autonomous calendar invites without approval | "Just schedule it" | Invites leave the building — must hit the approval gate like email | Draft the event/invite → approve → book |
| Generic web browsing / unrestricted fetch | "Let it browse anything" | Prompt-injection + SSRF + cost surface; PII/compliance exposure | Scoped research tool with allow-listed behavior, citations, redact-then-store |
| Building each tool bespoke | Fast locally | Explodes surface; ignores shipped adapter/governance patterns | Every new tool reuses PII scan, cost check, audit, approval — no tool bypasses the spine |

---

## Capability 5 — AI Media-Creation Canvas (Images + Video ≤3 min)

PROJECT explicitly says **leverage the connected Pikar-Ai service — do not rebuild.**

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Image generation | Baseline of any media canvas | LOW (integration) | Connected Pikar-Ai MCP service provides `generate_image` + `models_explore(recommend)`. **Wrap, don't build** |
| Video generation ≤3 min | Explicit target | LOW-MEDIUM (integration) | `generate_video` on the same service; enforce the ≤3-min cap at the wrapper |
| Prompt-from-context (use business profile/brand) | On-brand assets, not random stock | LOW-MEDIUM | Feed brand/profile from vault into the generation prompt |
| Asset stored + governed | Generated media is an artifact like any other | LOW | Store refs in vault; audit the generation call (refs/hashes only, per §4) |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Edit/refine tools (upscale, outpaint, remove-bg, reframe) | Iteration without regeneration = cheaper, faster, better | LOW (integration) | Service exposes `upscale_image/video`, `outpaint_image`, `remove_background`, `reframe`, `motion_control` — prefer dedicated edit over re-generate |
| Templated made-to-brief video workflows (explainer, ad, UGC) | Solopreneur gets agency-grade video without an agency | MEDIUM (integration) | Service exposes `get_workflow_instructions` catalog — route brief→workflow |
| Media as a routed action ("make a launch graphic for this campaign") | Canvas isn't a silo — the agent invokes it as a tool inside a plan | MEDIUM | Media generation becomes a tool the Comms sub-agent can call |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Building a generation pipeline / hosting models** | "Own the stack" | Directly contradicts PROJECT ("do not rebuild"); enormous cost/scope | Thin MCP integration with the connected service |
| Full timeline/NLE video editor UI | "Real creators need it" | Months of frontend for a COS side-feature; app has no component library | Brief→generate→edit-tool loop; no timeline |
| Unbounded video length / resolution | "Longer is better" | Cost blowup; ≤3-min cap is the stated scope | Enforce ≤3 min + sane resolution defaults at wrapper |
| Auto-publishing generated media to social | "Close the loop" | Publishing = content leaving the building without a channel/governance story | Generate + store; user downloads/routes manually in v2 |

---

## Capability 6 — Dynamic Skills (User-Authored, then Agent-Authored)

Adapt the assistant to a specific business. **Governance-heavy; placed LATE per PROJECT.**

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| User-authored skill (create/edit a versioned skill row) | The whole point of adaptability; registry already exists | MEDIUM | Skills registry + versioning already live (§5). Add authoring UI + validation |
| Skill lifecycle (draft → publish → rollback) | Change control on prompts is a shipped invariant | LOW-MEDIUM | Reuse existing status/version + rollback; SkillOpt machinery exists |
| Skill scoping to this tenant/business | A user's custom skill must not leak across tenants | LOW-MEDIUM | Tenant-scoped wrapper (§2) + per-session tenant (shipped) |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Agent-authored skills (assistant proposes a new skill from repeated patterns) | Self-extension — the assistant learns *this* business and codifies it | HIGH | **Self-modification** — must be governed: propose → human approve → versioned publish → eval gate. Ties to shipped prompt-optimization loop |
| Skill-backed rubrics for evaluation/personas | Cap 1's persona rubrics *are* skills → users can tune how they're advised | MEDIUM | Unifies Cap 1 + Cap 6; no separate config plane |
| Eval-gated agent-authored publish | New/changed skills pass held-out validation before going live | HIGH | SkillOpt's held-out-validation loop is the existing gate; reuse it |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Agent self-publishing skills without human approval | "Fully autonomous learning" | Un-governed self-modification = reward-hacking + drift + audit gap; hostile to the compliance moat | Agent *proposes*; human approves; eval gate before live |
| Arbitrary code execution in skills | "Skills should do anything" | Skills are prompts/rubrics (versioned docs), not code — executing code is an RCE/security surface | Skills = versioned prompt/rubric bodies loaded at runtime, per §5 |
| Third-party / marketplace skill sharing | "Let users share skills" | PROJECT lists this Out of Scope (enterprise tier); cross-tenant governance is unsolved | Per-tenant skills only in v2 |
| Unbounded skill count / no eval | "More skills = smarter" | Skill sprawl, conflicting prompts, no quality gate | Eval-gated publish + rollback; keep the roster curated |

---

## Feature Dependencies

```
[Vault→Agent read tool]  ◄── the linchpin; almost everything depends on it
    ├──requires──> (vault retrieval — SHIPPED, currently 0 callers)
    │
    ├──enables──> [Business Evaluation Engine (Cap 1)]
    │                   └──requires──> [Business profile intake / persona onboarding]
    │                   └──emits──────> actions into [Plan→Approve→Execute spine — SHIPPED]
    │
    ├──enables──> [Flagship voice-doc workflow (Cap 2)]
    │                   ├──requires──> [Attachment extraction — SHIPPED]
    │                   ├──requires──> [Live voice — SHIPPED]
    │                   └──produces──> [Doc/memo creation tool (Cap 4)] OR [Plan spine]
    │
    └──enables──> [Sub-agent dispatch (Cap 3)]
                        ├──requires──> [Executive Agent classifier — SHIPPED (route enum hollow)]
                        ├──requires──> [Skills registry — SHIPPED]
                        └──routes-to──> [Action tools (Cap 4)] + [Media canvas (Cap 5)]

[Action tools (Cap 4)] ──requires──> [OAuth Google/MS Graph — SHIPPED for email, extend scopes]
[Media canvas (Cap 5)] ──requires──> [Connected Pikar-Ai MCP service — CONNECTED]
[Dynamic skills (Cap 6)] ──requires──> [Skills registry + SkillOpt eval — SHIPPED/pending]
                          ──enhances──> [Evaluation rubrics (Cap 1)]  ──(rubrics ARE skills)
[Agent-authored skills (Cap 6)] ──requires──> [Prompt-optimization loop — SHIPPED]
```

### Dependency Notes

- **Vault→agent wiring gates the whole milestone:** every "credible, grounded, not-generic" claim (Cap 1, 2, much of 3/4) collapses to boilerplate without it. LOW-MEDIUM effort, highest leverage — must be Phase 1.
- **Cap 2 is mostly integration of shipped parts:** extraction + voice + brief→artifact all exist; the new work is *document-scoped grounding* + the honest-no-gap discipline. Lower risk than it looks; strong flagship ROI.
- **Cap 3 must land after Cap 4 tools exist** (or with one exemplar) — a dispatcher with nothing specialized to dispatch to is the current hollow state. Build one sub-agent + its tools together.
- **Cap 6 depends on almost everything and is self-modifying** — correctly placed last. Agent-authored skills reuse the shipped optimization/eval loop; do not build a parallel governance plane.
- **Media canvas (Cap 5) is nearly dependency-free** (external service connected) — can slot in parallel; low risk, high demo value.
- **Cap 1 rubrics = Cap 6 skills:** unify them. Don't build a second config system for evaluation rubrics.

---

## MVP Definition (for this v2.0 milestone)

### Launch With (Foundation + first breadth)

- [ ] **Vault→agent read tool** — unblocks everything; the one non-negotiable
- [ ] **Persona onboarding + structured business profile** — the anti-generic prerequisite
- [ ] **Business evaluation engine** (SWOT + stage-appropriate canvas, grounded in vault, action-emitting, honest gaps) — the intelligence payoff
- [ ] **Flagship voice-doc workflow** (upload → discuss by voice → grounded gaps → memo/plan → honest no-gap) — the signature differentiator, mostly shipped parts
- [ ] **One real sub-agent** (Research exemplar) via the now-real dispatcher — proves the pattern without a swarm

### Add After Validation (mid-milestone)

- [ ] **Action tools** — calendar, web research, doc creation, contacts/CRM — [trigger: dispatcher + one sub-agent proven]
- [ ] **Media canvas** (wrap connected Pikar-Ai service; images + video ≤3 min + edit tools) — [trigger: parallel-safe, add when Comms sub-agent exists to call it]
- [ ] **User-authored dynamic skills** — [trigger: authoring UI + tenant scoping ready]
- [ ] Scheduled proactive in-app review — [trigger: evaluation engine stable]

### Future Consideration (late / next milestone)

- [ ] **Agent-authored skills** — [defer: self-modification, governance-heavy; needs eval gate + human-approve hardened]
- [ ] Full agent team (Analysis + Comms + Ops sub-agents) — [defer: add roles only as workloads prove the need]
- [ ] Lightweight CRM follow-up automation — [defer: after contacts + reminders validate]
- [ ] Cross-document pattern detection — [defer: needs rich vault history]

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|-----------|---------------------|----------|
| Vault→agent read tool | HIGH | LOW | P1 |
| Persona onboarding + business profile | HIGH | MEDIUM | P1 |
| Business evaluation engine (grounded, action-driving) | HIGH | MEDIUM-HIGH | P1 |
| Flagship voice-doc workflow | HIGH | MEDIUM | P1 |
| Real dispatcher + one Research sub-agent | HIGH | MEDIUM | P1 |
| Calendar tool | HIGH | MEDIUM | P2 |
| Web research tool | HIGH | MEDIUM | P2 |
| Document/content creation tool | HIGH | MEDIUM | P2 |
| Contacts / follow-up (light CRM) | MEDIUM | MEDIUM | P2 |
| Media canvas (wrap Pikar-Ai service) | MEDIUM | LOW | P2 |
| Scheduled proactive in-app review | MEDIUM | MEDIUM | P2 |
| User-authored skills | MEDIUM | MEDIUM | P2 |
| Agent-authored skills | MEDIUM | HIGH | P3 |
| Full multi-agent team | MEDIUM | HIGH | P3 |
| Cross-document pattern detection | MEDIUM | HIGH | P3 |

---

## Competitor Feature Analysis

| Feature | Generic AI chatbots (ChatGPT/Copilot) | Vertical AI advisors / "AI cofounder" tools | Our Approach |
|---------|----------------------------------------|---------------------------------------------|--------------|
| Business advice | Generic, ungrounded, forgets context | Better prompts, still often static reports | **Grounded in the user's vault + persona rubric + drives governed action** |
| Document analysis | Summarize/chat, no voice, invents findings | Upload + analyze, text only | **Voice discussion + grounded citations + honest no-gap + routed output** |
| Multi-agent | Emerging (Assistants/Agents), swarm-y | Varies, often over-engineered | **Function-based, one exemplar first, tool-scoped, fully audited** |
| Action tools | Growing (Copilot/Gemini in-suite) | Point tools | **Governed spine: every action through PII+cost+audit+approve** |
| Media | Separate products (DALL·E, Sora, etc.) | Rare | **Thin wrap of connected Pikar-Ai service, invoked as an agent tool** |
| Custom skills | Custom GPTs (no eval/governance) | Rare | **Versioned, tenant-scoped, eval-gated, rollback-able** |
| Trust/compliance | Weak, no audit trail | Weak | **Audit spine + approval gate + PII redaction = the differentiator** |

The recurring competitive theme: rivals do the *capability*; Pikar's edge is doing it **grounded, governed, and action-connected** — leaning on the two structural moats (per-tenant learning vault + compliance/audit spine) already in the codebase.

---

## Sources

- Multi-agent supervisor/handoff patterns & when NOT to use multi-agent — [Microsoft: Agent system design patterns](https://learn.microsoft.com/azure/databricks/generative-ai/guide/agent-system-design-patterns), [Supervisor pattern (TeeTracker/Medium)](https://teetracker.medium.com/multi-agents-with-supervisor-pattern-4013d2cd8c49), [DEV: Supervisor pattern](https://dev.to/ravidasari/day-3-multi-agent-systems-the-supervisor-pattern-20ba), [Educative: agent orchestration patterns](https://www.educative.io/courses/agentic-ai-systems/np/structuring-agent-behavior-agent-orchestration-patterns) — MEDIUM confidence
- Business evaluation frameworks (SWOT / Lean Canvas / BMC / unit economics) — [FasterCapital: Entrepreneurship Evaluation Framework](https://fastercapital.com/content/Entrepreneurship-Evaluation-Framework--The-Essential-Guide-to-Assessing-Startup-Viability.html), [PESTEL/SWOT/Lean Canvas (Medium)](https://medium.com/@isaiahballah/understanding-pestel-swot-and-lean-canvas-strategic-tools-for-entrepreneurs-636424ebd52b), [BMC vs SWOT (FourWeekMBA)](https://fourweekmba.com/business-model-canvas-vs-swot-analysis/) — MEDIUM confidence
- Why AI business advice is generic & how to make it credible — [Why ChatGPT Gives Generic Business Advice (Medium)](https://medium.com/@ninadthestrategist/why-chatgpt-gives-you-generic-business-advice-and-how-founders-actually-fix-it-25cdc6e179bd), [Entrepreneur: filtering generic advice](https://www.entrepreneur.com/growing-a-business/dont-fall-prey-to-generic-marketing-advice-heres-how/478422), [What Works Growth: business advice evidence](https://whatworksgrowth.org/resource-library/business-advice/) — MEDIUM confidence
- Connected media service capabilities — Pikar-Ai MCP tool catalog (generate_image/video, upscale, outpaint, reframe, remove_background, motion_control, workflow instructions) — HIGH confidence (connected server)
- Existing-feature dependencies — `.planning/PROJECT.md`, CLAUDE.md repository conventions, project memory — HIGH confidence

---
*Feature research for: AI chief-of-staff platform (v2.0 NEW capabilities)*
*Researched: 2026-07-24*
