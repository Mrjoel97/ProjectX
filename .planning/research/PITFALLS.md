# Pitfalls Research — v2.0 Platform → Private Beta

**Domain:** Expanding a governed, single-owner multi-tenant AI agent into a broad chief-of-staff platform + opening a multi-user private beta
**Researched:** 2026-07-24
**Confidence:** HIGH (grounded in this repo's shipped governance + verified external sources for injection/OAuth/ISO claims)

> Prior-milestone pitfalls (voice/OAuth/realtime/timeline) live in `PITFALLS-v1.md`. This file covers the pitfalls of *adding* the v2.0 capabilities on top of governance that already exists — tenant isolation (`tenantId=userId`), insert-only audit with redact-then-write (refs/counts only), `packages/pii` fail-closed scan, eval-gated skill registry with rollback, cost kill-switch + per-request budget, DLQ, WORM export. The recurring theme: the existing spine is **a gate the new work must route through**, and every pitfall below is a way the new work bypasses or overwhelms that gate.

Milestone-stage vocabulary (from `PROJECT.md`): **S1 Foundation & Intelligence** · **S2 Breadth of Action** · **S3 Creation & Self-Extension** · **S4 Governance & Open the Beta**.

---

## Critical Pitfalls

### Pitfall 1: Agent-authored skill self-activates live (self-modification bypasses the eval gate)

**What goes wrong:**
The dynamic-skill feature lets skills be authored at runtime (user-first, then agent-authored). The agent writes a new skill *body* and — because `skills.activateCandidate` already exists and is only `tenantMutation`-gated — activates it into `status:"active"` and serves it to itself (and, post-beta, all users) on the next request. A self-written prompt that games its own reward, or embeds "ignore prior guardrails," goes live with no human between authoring and activation. The eval gate is real for the *optimizer* path, but the *authoring* path is a second door into the same `skills` table.

**Why it happens:**
The registry was built for human-published, optimizer-refined skills; "who may transition draft→active" was answered for those two flows, not for an agent that can both write a candidate and call activate in one trajectory. Reward-hacking is the documented, owner-accepted risk of the autonomous SkillOpt loop (Key Decisions) — dynamic authoring *widens* that surface from "optimize existing skills" to "invent new ones."

**How to avoid:**
- **Two-key rule for activation, structurally.** Authoring (agent or user) may only ever produce `status:"candidate"`. Only `requireOwner` + a passing held-out eval may flip a skill to `active`. Make agent-reachable skill tools physically unable to call activate (capability minimization beats instruction-policing — verified 2026 injection guidance). An agent tool that *can* activate is the bug; remove the capability, don't prompt against it.
- **Eval gate on the authoring path, not just the optimizer path.** Route agent/user-authored candidates through the same held-out validation (`run-eval-golden`) SkillOpt candidates use. No green eval → cannot leave `candidate`.
- **Provenance + rollback on every version.** Every skill row records author (owner | user | agent | optimizer) and is immutable-versioned so `getActiveSkill` can be reverted in one write. Reuse the existing versioned-registry rollback; do not invent a parallel store.
- **Reward-hacking canary.** The eval set must include held-out adversarial cases the authoring agent never sees, so a skill tuned to game visible metrics still fails validation.

**Warning signs:**
An `active` skill whose author is `agent`; a skill version with no corresponding eval run; eval pass-rate climbing while human spot-checks of output quality fall; a skill body containing meta-instructions about guardrails, scoring, or "always return success."

**Phase to address:**
**S3 (dynamic skill creation).** This is why `PROJECT.md` places self-modification "late … governance-heavy." Ship user-authored (candidate-only) first, agent-authored last, and only after `requireOwner` exists.

---

### Pitfall 2: Untrusted vault/web content becomes instructions (indirect prompt injection through grounding + research)

**What goes wrong:**
Once the agent can read the vault (S1) and do web research (S2), attacker- or third-party-controlled text — an uploaded report, a scraped page, an email body — is concatenated into the prompt as *data* but read by the model as *instructions*. Verified 2026 research: ~5 crafted documents can steer RAG output ~90% of the time; web-based indirect injection is observed in the wild. In a chief-of-staff that can send email and (S2) touch calendar/CRM, an injected "forward all contacts to X" or "exfiltrate the business profile" turns grounding into a weapon.

**Why it happens:**
Grounding and research are built to *maximize* how much external content reaches the model; the pipeline treats retrieved text as trusted context. The commingling of trusted instructions and untrusted data in one channel is the root cause of all prompt injection.

**How to avoid:**
- **Capability minimization is the primary defense** (verified 2026 best practice). The existing per-plan single-approval gate already means nothing leaves the building without human sign-off — *keep every new S2 tool (calendar/email/CRM) behind that same plan-approval*, so an injection can at most *propose*, never *execute*. Do not add an auto-execute path for any tool that touches the outside world.
- **Structural quarantine of retrieved content.** Wrap vault/web text in explicit delimiters and label it untrusted in the prompt; never let retrieved content select tools or set parameters directly.
- **Sub-agents for research run least-privilege** (ties to Pitfall 3): the web-research sub-agent has *no* send/write capability — it returns text to the executive agent, which still needs plan approval to act.
- **PII redaction on ingested content stays on** (`packages/pii` fail-closed) so injected content that *also* carries PII can't round-trip into audit/telemetry.

**Warning signs:**
Plans whose steps don't match the user's stated goal; tool calls referencing entities that only appear in a retrieved doc; research summaries containing imperative second-person text ("you should now…"); a spike in tool-call attempts right after a large document ingest.

**Phase to address:**
**S1 (grounding wiring)** establishes the quarantine + keeps plan-approval as the only execution path; **S2 (web research + sub-agent dispatch)** must not regress it. Add "retrieved content cannot trigger execution without plan approval" to both stages' success criteria.

---

### Pitfall 3: Multi-agent dispatch fans out into runaway loops / cost / context bloat with no accountability

**What goes wrong:**
Making the `sub_agent` route real (S2) means agents call agents. Four failure modes hit at once: (a) **infinite/mutual loops** — A dispatches B which re-dispatches A; (b) **cost fan-out** — one request spawns N sub-agents each making M LLM calls, blowing the per-request budget the single-agent kill-switch was sized for; (c) **context bloat** — each sub-agent re-pays full context and results are stuffed back into the parent prompt until it degrades; (d) **accountability gaps** — audit rows and cost attribution point at "the agent," not *which* sub-agent on whose behalf, so the insert-only audit loses the causal chain.

**Why it happens:**
The single-agent cost/audit model assumes one request = one bounded trajectory. Dispatch breaks that: budget, depth, and audit lineage were never parameterized by a call tree. The `sub_agent` route shipped as "a hollow enum" (PROJECT.md), so no depth/budget/lineage scaffolding exists yet.

**How to avoid:**
- **Hard recursion depth cap + call-tree budget, enforced in the dispatch wrapper** (not left to the model). Reuse the existing per-request budget kill-switch but make budget a property of the *root* request shared across the whole sub-agent tree — a sub-agent draws down the same envelope, and hitting zero halts the tree. `ponytail:` the cap as a constant with the upgrade path to per-role budgets.
- **Fan-out limit + no cycles.** Cap children per node and total nodes; carry a visited/parent chain so A→B→A is refused. Whitelist which agents may dispatch which sub-agents (a DAG, not a free graph).
- **Lineage in every audit/telemetry row.** Add `rootRequestId` + `parentAgentId` (refs/ids only — CLAUDE.md §4) so the insert-only audit reconstructs the tree. Cost/tokens attribute to the root.
- **Least-privilege sub-agents** (see Pitfall 2): a sub-agent gets only the tools its job needs.
- **Summarize, don't concatenate**, when returning sub-agent output to the parent, to bound context growth.

**Warning signs:**
Per-request token/cost 3–10× the single-agent baseline; latency growing super-linearly with task complexity; audit rows for one request with no clear parent; the same skill invoked many times in one trajectory; budget kill-switch firing far more often after dispatch ships.

**Phase to address:**
**S2 (real sub-agent dispatch).** Depth cap, shared-envelope budget, cycle refusal, and lineage fields are non-negotiable success criteria — before the "first exemplar" sub-agent, not after.

---

### Pitfall 4: Business-evaluation engine emits generic / hallucinated / fabricated-gap advice with false confidence

**What goes wrong:**
The evaluation engine assesses the business, detects gaps, and gives advice that drives action. Four credibility failures: (a) **generic advice** indistinguishable from a horoscope ("improve your marketing"); (b) **hallucinated specifics** — invented competitors, market sizes, benchmarks stated as fact; (c) **fabricated gaps** — the model *manufactures* problems because it's prompted to "find gaps," so it always finds some even when the honest answer is "none"; (d) **over-confidence on stale evidence** — training-data facts presented as current market truth. For a product whose value is "knows your business and evaluates it," non-credible advice is an existential trust failure, not a cosmetic bug.

**Why it happens:**
"Detect gaps and advise" prompts reward finding problems and sounding authoritative; LLMs comply by inventing both. Training data is 6–18 months stale, so "current" market claims are hypotheses, not facts. Nothing forces the model to ground a claim in either the user's vault or fresh web research.

**How to avoid:**
- **Ground every gap/claim in a citation — vault ref or web-research result — or don't surface it.** No evidence → not a finding. This mirrors the research discipline in this very task: verify before asserting, flag confidence. Web-research grounding (S2) is a *hard dependency* for credible market claims; on-demand eval that predates it must scope itself to vault-grounded findings only and say so.
- **First-class "no gaps found" output.** PROJECT.md already demands the honest "no gaps too" path; make it a real, rewarded outcome so the engine isn't forced to fabricate. Eval fixtures must include a healthy-business case that MUST return zero gaps.
- **Confidence + provenance on every finding** (HIGH/MEDIUM/LOW + source), so the user sees "grounded in your Q3 doc" vs "general pattern." Over-confidence is a labeled, testable failure.
- **Evidence freshness stamp.** Web-research findings carry a retrieval date; the engine flags advice built on model-memory as needing validation.
- **Skill-registry + eval gate** governs the evaluation prompts (they are skills, CLAUDE.md §5) — so advice quality is regression-tested, not vibes.

**Warning signs:**
Every evaluation returns a similar number of gaps regardless of input; findings with no citation; named competitors/numbers absent from the vault and from any research call; advice that doesn't change when the business profile changes; users disputing "facts" in the output.

**Phase to address:**
**S1 (business-evaluation engine)** for the vault-grounded core, the "no gaps" path, and confidence/provenance. Market-fact credibility **depends on S2 web research** — sequence the *market-claim* capability after research lands, and constrain S1's engine to vault-grounded findings until then.

---

### Pitfall 5: Vault grounding leaks PII / business content into audit, telemetry, or step rows

**What goes wrong:**
Wiring the vault into the agent (S1) means business-profile text, uploaded-report contents, and session briefs now flow through the request pipeline — the same pipeline that writes audit rows, telemetry, DLQ payloads, and (new for a visible chief-of-staff) agent-step rows the UI renders. The moment a grounded snippet, a retrieved chunk, or a sub-agent step-row carries raw vault prose, the audit log becomes the PII honeypot CLAUDE.md §4 exists to prevent — and the WORM export makes that leak permanent and immutable.

**Why it happens:**
The audit/telemetry redact-then-write contract was authored when the agent handled *email* content that already passed `packages/pii`. Grounding introduces *new* content channels (retrieved chunks, agent-step traces, evaluation findings) that weren't in the original redaction path. Known open ceiling: `packages/pii` scrubs *structured* PII only — **names-in-prose survive** (Phase-8 memo), and a business profile is dense with names in prose.

**How to avoid:**
- **Redact-then-write applies to the new channels too.** Agent-step rows, evaluation findings, and sub-agent traces are structured-log fields under CLAUDE.md §4 — refs/hashes/ids/counts ONLY. A step row says "grounded on doc#123 chunk#4," never the chunk text. Grounded *content* stays in the request working set and the vault; it must not land in any insert-only/exported table.
- **Close the names-in-prose ceiling before it reaches exportable rows.** The structured-only scrub is "fine for solo owner, blocker before multi-user export" (Phase-8 memo). Grounding raises the stakes now because business profiles are name-dense. At minimum keep grounded prose out of audit/telemetry entirely (ref-only) so the prose-PII gap can't reach WORM; upgrade `packages/pii` (or the named Presidio path) before grounded content is *ever* written to an exported table.
- **Test the boundary.** A grounding regression test asserts no audit/telemetry/step/DLQ row for a grounded request contains any substring of the source document.

**Warning signs:**
An audit or telemetry row whose payload length scales with document size; step-row text a human can read as business content; DLQ payloads containing report snippets; WORM export diffs showing prose.

**Phase to address:**
**S1 (vault→agent wiring)** — the redaction boundary must be extended in the same phase that opens the vault to the agent; do not let grounding ship before the step/audit/telemetry channels are proven ref-only. Names-in-prose closure is a shared dependency with **S4** (multi-user export).

---

### Pitfall 6: Media generation — uncapped cost, abuse, latency, and unmoderated output

**What goes wrong:**
The media canvas (S3, images + video ≤3 min via the connected Pikar-Ai service) introduces a cost/latency/abuse profile unlike text. Video generation is expensive and slow (tens of seconds to minutes), so: (a) an unbounded or agent-triggered generation blows the per-request budget the text kill-switch was tuned for; (b) a synchronous call hangs the request/UI past timeout; (c) an agent (or injected content, Pitfall 2) can drive generation in a loop; (d) generated media can be NSFW/infringing/deepfake — a moderation and liability surface text didn't have; (e) generated assets are large binaries needing storage + lifecycle.

**Why it happens:**
The cost model prices *tokens*; media is priced per image / per second-of-video and doesn't fit `packages/cost`. The pipeline is request/response-synchronous; multi-minute video doesn't. "Leverage the connected service, don't rebuild" (PROJECT.md) means abuse/moderation controls live partly outside our code and are easy to assume-away.

**How to avoid:**
- **Media generation is always plan-gated and human-initiated in beta** — never an autonomous agent tool that fires without the single approval. Capability minimization again: injected content cannot spend the media budget if generation requires human approval.
- **Separate media budget line in the cost guardrail**, priced per-asset / per-second, with its own kill-switch — don't fold it into the token budget. Extend `packages/cost` with a media pricing path; `ponytail:` a flat per-asset cap first, refine later.
- **Async by construction.** Generation runs as a Convex scheduled/background action with a job row the UI polls; the request never blocks on it. (Reuses the existing scheduling/deferred-send machinery rather than a new queue.)
- **Rely on the provider's moderation but verify it exists**, log a moderation-result ref (not the asset) to audit, and keep a takedown/delete path for stored assets. Audit stays ref-only (asset hash/id, moderation verdict — never the asset).

**Warning signs:**
A single request's cost dominated by one media call; requests timing out on generation; generation jobs with no human-initiation record; storage growth outpacing users; any generation triggered inside a sub-agent trajectory without approval.

**Phase to address:**
**S3 (media canvas).** Media budget line, async job model, plan-gating, and moderation-ref logging are the phase's success criteria. Because it leverages an external service, a "verify the provider's abuse/moderation guarantees" checklist item belongs in the phase.

---

### Pitfall 7: Scheduled proactive review silently dies on the Google 7-day testing-mode token — or drifts back into email

**What goes wrong:**
The evaluation engine's scheduled proactive review (S1) is a *recurring* background job. Two traps: (a) recurring email was **already deferred** precisely because Google testing-mode refresh tokens expire after exactly 7 days (verified current, 2026) — any proactive feature that sends email (or touches any restricted-scope Google API) on a weekly+ cadence will `invalid_grant` and fail silently after day 7; (b) scope creep — "proactive review" quietly becomes "proactive *email*," re-importing the exact constraint that got recurring sends scoped out.

**Why it happens:**
The 7-day cap is invisible in dev (tokens are fresh) and only bites in production after a week — the worst possible feedback delay. The obvious delivery channel for "proactive" is email, and the OAuth constraint isn't top-of-mind when designing the *review* feature vs the *delivery* feature.

**How to avoid:**
- **Proactive review is IN-APP, not email.** PROJECT.md already specifies "scheduled proactive **in-app** review" — hold that line. In-app delivery (a Convex-scheduled job writing a notification/review row the UI shows) touches no Google token and sidesteps 7-day expiry entirely. This is the laziest correct design: reuse the existing scheduler + notifications table, add no OAuth dependency.
- **Anything that must touch Google on a schedule waits for verified/production OAuth** (S4 productionization: "In Production" or "Internal" removes the 7-day cap — verified). Gate any scheduled *email* proactivity behind that, exactly as recurring sends are gated.
- **Token-expiry is a monitored, alerting condition** once any scheduled Google call exists: detect `invalid_grant`, DLQ it, notify — never fail silent.

**Warning signs:**
A scheduled feature that works in demo and stops ~7 days post-deploy; `invalid_grant` in logs; a "proactive review" design doc that mentions sending email; scheduled jobs with no dead-letter on auth failure.

**Phase to address:**
**S1 (scheduled proactive review)** — enforce in-app delivery, zero Google-token dependency. **S4 (productionization)** flips OAuth to production and only then may schedule anything Google-bound. Add "proactive review touches no OAuth token" to S1 success criteria.

---

### Pitfall 8a: Multi-user beta ships cross-tenant isolation regressions

**What goes wrong:**
Everything above (grounding, sub-agents, media jobs, evaluation findings, dynamic skills) adds new tables, new background jobs, and new payloads. Each is a fresh chance to read/write without the `tenantId` scope — a background job or sub-agent that queries by `rootRequestId` but forgets `tenantId`, a skills/optimizer table read that crosses tenants (the Phase-8 IDOR review caught, fixed with `SKILLOPT_OWNER_TENANT`). With one owner, cross-tenant bugs are invisible; the day a second user exists they become data breaches, and the WORM export makes any leaked write permanent.

**Why it happens:**
`tenantId=userId` isolation is enforced by the `convex/lib/functions.ts` wrappers (CLAUDE.md §2) — but only for code that *uses* them. New background/scheduled/sub-agent code paths are exactly where devs reach for raw `internal`/`_generated/server` (the allow-list) and lose the injected scope. Single-owner testing never exercises the cross-tenant path.

**How to avoid:**
- **The cross-user isolation test is a phase gate, not a nicety.** PROJECT.md S4 already names it (SC-2). It must assert: user A's grounding, sub-agent runs, media jobs, evaluation findings, skills candidates, and audit rows are all unreachable by user B. Seed two tenants; every new S1–S3 surface gets an isolation assertion.
- **Keep the wrapper discipline (CLAUDE.md §2) and the Biome import rule** covering all new files; audit the internal allow-list before beta — any raw `query`/`mutation`/`action` in a background/sub-agent path is guilty until proven scoped.
- **Every new query is `tenantId`-scoped by index**, including jobs keyed on `rootRequestId`/document ids.

**Warning signs:**
A query filtering by an id but not `tenantId`; raw server imports outside the allow-list; background jobs with no tenant in scope; the isolation test not covering a table added this milestone.

**Phase to address:**
**S4 (`requireOwner` + cross-user isolation test)**, but the isolation *assertions* must be written *as each surface ships* in S1–S3, not retrofitted at the end.

---

### Pitfall 8b: Owner-gating gap — three known un-gated functions become live authorization holes

**What goes wrong:**
Phase 8 shipped three self-improvement controls callable by **any** authenticated user because no owner/admin role primitive exists (`tenantId=userId`, every user is just a tenant). The moment a second user joins the beta, these are live vulnerabilities:
- `optimizerConfig.setOptimizerEnabled` (tenantMutation) — any user flips the **global** optimizer kill-switch → broken-authorization.
- `skills.activateCandidate` (tenantMutation) — any user activates a self-modified skill version live for **all** users → broken-authorization (and the Pitfall 1 self-activation door).
- `skills.candidatesForReview` (tenantQuery) — any user reads candidate skill **bodies** (the optimized prompts) → information-disclosure.

**Why it happens:**
Owner-gating was an owner-approved deferral: nil risk with one user, hard blocker before the second. The primitive was skipped because single-owner made every function's caller trivially the owner.

**How to avoid:**
- **Introduce `requireOwner(ctx)` as a real primitive** — owner identity from `betaInvites`/roles, **not** an env hack (`SKILLOPT_OWNER_TENANT` was the interim) — and gate all three functions. This is the named Phase-9/S4 fix path.
- **Any new S3 dynamic-skill or S2 optimizer-adjacent control gets `requireOwner` from birth**, so the list of three doesn't grow silently.
- **The isolation test (8a) asserts a non-owner cannot reach any of the three** (or their successors).

**Warning signs:**
A `tenantMutation`/`tenantQuery` that mutates global config or skill activation; skill candidate bodies readable by a non-owner; new admin-ish controls added without `requireOwner`; the three functions still tenant-only after S4 opens.

**Phase to address:**
**S4 (Governance & Open the Beta)** — `requireOwner` + gating all three is a hard blocker before *any* second user. Must land before invite-flow goes live.

---

### Pitfall 8c: Invite-flow OAuth reconciliation — identity mismatch between invite, auth subject, and tenant

**What goes wrong:**
Opening the beta adds an invite/waitlist flow feeding into Convex Auth + Google/Microsoft OAuth. The trap is identity reconciliation: an invite is issued to an email, but the tenant key is derived from the OAuth subject (`requireTenant` returns the stable userId = subject-before-`|`, per the tenant-scope fix). If the invited email and the account the user actually signs in with differ (personal vs workspace Google, alias, MS vs Google), the invite either fails to bind or — worse — binds the wrong subject to the invite, creating an orphaned or mis-attributed tenant. The prior milestone already hit an orphaned-rows migration when tenant derivation changed; a sloppy invite→subject binding repeats that at multi-user scale.

**Why it happens:**
Invites are email-keyed (human-legible); tenancy is subject-keyed (stable, OAuth-issued). These two identifiers are assumed equal but aren't guaranteed to match. MS Graph/Outlook (added in S4) is a *second* identity provider with its own subject format, doubling the reconciliation surface.

**How to avoid:**
- **Bind invite→tenant on first authenticated sign-in, on the OAuth subject, not the typed email.** Verify the authenticated email matches the invited email before binding; on mismatch, refuse and surface a clear error rather than silently creating a tenant.
- **One invite = one subject, recorded immutably.** Store the resolved subject on the invite row at redemption; reject re-redemption by a different subject.
- **Test both providers.** Cross-user isolation test (8a) plus an invite-redemption test for Google *and* Microsoft subjects; assert no orphaned tenant on email/subject mismatch.

**Warning signs:**
A tenant with no redeemed invite, or an invite marked redeemed with no matching signed-in subject; users reporting "my invite didn't work" after signing in with a different Google account; duplicate tenants for one human.

**Phase to address:**
**S4 (Private Beta Productionization).** The `09-CONTEXT.md` spec (now this milestone's final phase) owns invite/waitlist + MS Graph; invite→subject reconciliation is a success criterion there.

---

### Pitfall 9: ISO 9001:2015 becomes process-theater / over-documentation instead of formalizing existing bones

**What goes wrong:**
The QMS phase (S4) is meant to *formalize the bones that already exist* — insert-only audit, skill versioning, GSD playbooks/ADRs as change control (PROJECT.md). The pitfall is treating ISO as a paperwork project: authoring a quality manual, procedure documents, and forms that describe an idealized process nobody follows, duplicating what the audit spine + playbooks + ADRs already enforce in code. Result: documents drift from reality (the fastest way to *fail* an ISO audit is records that don't match practice), and a solo builder burns beta runway on binders.

**Why it happens:**
ISO 9001 templates assume a large org with roles the product doesn't have (cargo-culting enterprise QMS onto a solo operation). "Document your processes" reads as "write new documents" rather than "point the standard's clauses at the controls you already run."

**How to avoid:**
- **Map, don't manufacture.** Produce one thin conformance map: ISO clause → the existing artifact that satisfies it (audit spine = 7.5 documented info + 8.5.1 control; skill registry versioning/rollback = 8.5.6 change control; GSD playbooks/ADRs = 7.5 + 8.3 design control; eval gate = 8.6 release; DLQ/notifications = 10.2 nonconformity). New docs only where a genuine gap exists.
- **Records must reflect reality.** ISO auditors check records match practice; the audit log and immutable ADRs already *are* the records — lean on them rather than parallel paperwork that drifts.
- **Right-size to a solo operation.** Skip roles/procedures the product doesn't have; a QMS you can't sustain is a nonconformity waiting to happen.
- **`ponytail:` the QMS.** Formalize the minimum that makes the compliance/trust moat real (a stated benefit — moat-strategy), no clause-by-clause binder.

**Warning signs:**
New procedure docs describing steps no one performs; a quality manual duplicating what playbooks already say; documentation effort crowding out shippable beta work; records that contradict the audit trail.

**Phase to address:**
**S4 (ISO 9001 QMS foundation).** Success criterion: a clause→existing-artifact conformance map + only-gap-filling new docs, not a from-scratch QMS.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Agent tool can call `skills.activateCandidate` | Dynamic skills "work" end-to-end fast | Self-modification bypasses eval gate; reward-hacked prompt goes live | **Never** — authoring produces candidates only, activation is owner+eval gated |
| Sub-agent budget as a fresh per-call envelope | Simpler than shared accounting | Fan-out multiplies spend past kill-switch; one request drains N budgets | **Never** — budget is a property of the root request, shared across the tree |
| Grounded content in step/audit rows for debuggability | Rich traces, easy debugging | Audit becomes PII honeypot; WORM makes it permanent | Only refs/ids/hashes — raw grounded prose **never** in insert-only/exported rows |
| Proactive review via email now | Reuses the shipped delivery spine | Dies at day 7 on testing-mode token; silent failure | Only after OAuth is In-Production/Internal (S4); in-app until then |
| Media generation synchronous in the request | Fewer moving parts | Multi-minute video hangs UI/timeouts; blocks pipeline | Never for video; images only if sub-second and capped |
| Ship multi-user before `requireOwner` | Faster to a second user | Three live auth holes + any un-scoped new query = breach | **Never** — `requireOwner` + isolation test gate the beta open |
| Invite bound to typed email, not OAuth subject | Simplest redemption | Orphaned/mis-attributed tenants; repeat of prior orphaned-rows migration | **Never** — bind on subject at first sign-in, verify email match |
| ISO as new procedure documents | Looks like compliance progress | Docs drift from practice → audit failure; runway burned | Never — map clauses to existing audit/playbook/registry artifacts |
| Evaluation engine "always find gaps" prompt | Feels valuable, always says something | Fabricated gaps destroy credibility/trust moat | Never — "no gaps" is a first-class, eval-tested outcome |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Google OAuth (restricted `gmail.modify`) | Scheduling any Google call in testing mode | Testing-mode refresh tokens die at 7 days (verified 2026) — in-app proactivity; Google-bound schedules wait for In-Production/Internal |
| Connected Pikar-Ai media service | Assuming provider handles all abuse/moderation | Verify + log moderation verdict ref to audit; keep a takedown/delete path; own the cost cap on our side |
| Microsoft Graph/Outlook (S4) | Treating it as identical to Gmail adapter | Separate token lifecycle/scopes + distinct OAuth subject format; the provider-agnostic adapter must not leak provider assumptions |
| Convex Auth invite redemption | Binding invite to email, not stable subject | Resolve + store OAuth subject at redemption; reject cross-subject re-redemption |
| Web-research fetch (S2) | Trusting retrieved page text as instructions | Quarantine as untrusted data (Pitfall 2); research sub-agent has no send/write capability |
| SkillOpt writeback/export | Cross-tenant writeback IDOR (already caught) | `SKILLOPT_OWNER_TENANT` + `SKILLOPT_TOKEN` must be set; writeback audits/notifies the trusted owner tenant only |

## Performance / Cost Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sub-agent fan-out | Per-request cost 3–10× baseline; super-linear latency | Depth cap + shared root budget + fan-out limit in dispatch wrapper | First real multi-agent task with a branchy plan |
| Context bloat from stuffed sub-agent results | Prompt near model limit; quality drops mid-trajectory | Summarize sub-agent output before returning to parent | Deep or wide call trees |
| Video generation in request path | Timeouts; UI hangs on generation | Async job + poll; never block the request | First >30s generation |
| RAG poisoning via many docs | Injected instructions dominate grounding | Quarantine + capability minimization; plan-gate all execution | ~5 crafted docs (verified) |
| Unbounded media/asset storage | Storage outpaces users | Asset lifecycle + takedown path | Steady media use over weeks |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Agent-reachable skill activation | Self-modified/reward-hacked prompt live for all users | Capability minimization: no activate capability on agent tools; owner+eval gate |
| Retrieved content treated as instructions | Indirect prompt injection → unauthorized actions | Untrusted-data quarantine; execution only via plan approval |
| Un-gated Phase-8 controls with 2nd user | Broken-authorization + prompt-body disclosure | `requireOwner` on the three functions before beta opens |
| New query without `tenantId` scope | Cross-tenant read/write; permanent via WORM | Wrapper discipline (CLAUDE.md §2) + isolation test on every new surface |
| Invite bound to unverified email | Wrong-subject tenant hijack / orphan | Bind on OAuth subject at first sign-in; verify invited email matches |
| Grounded PII into audit/telemetry/WORM | Immutable, permanent PII honeypot | Redact-then-write extends to step/eval/sub-agent rows (refs only); close names-in-prose before export |
| Sub-agent over-privilege | One injected step → send/exfiltrate | Least-privilege per sub-agent; research agent has no write/send |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Evaluation always "finds gaps" | User loses trust when a gap is obviously fabricated | First-class, visible "no gaps found — here's why" |
| Advice with no source shown | Can't tell insight from hallucination | Confidence + provenance (vault ref / research date) on every finding |
| Proactive review that stops after a week | User thinks the product is dead | In-app scheduling with no token dependency; monitor + alert on any auth failure |
| Silent sub-agent spend | Bill/kill-switch surprises | Show plan cost estimate including sub-agent fan-out before the single approval |
| "My invite didn't work" | Locked out at the front door | Verify email↔subject and give a clear mismatch error, not a silent orphan |

## "Looks Done But Isn't" Checklist

- [ ] **Dynamic skills:** Often missing the two-key gate — verify an agent tool *cannot* reach `activateCandidate` and candidates can't leave `candidate` without owner + passing eval.
- [ ] **Sub-agent dispatch:** Often missing loop/budget bounds — verify depth cap, shared root budget, cycle refusal, and `rootRequestId`/`parentAgentId` in every audit row.
- [ ] **Evaluation engine:** Often missing the honest-negative path — verify a healthy-business fixture returns zero gaps and every finding carries a source.
- [ ] **Vault grounding:** Often missing redaction on new channels — verify no audit/telemetry/step/DLQ row contains any substring of a grounded document.
- [ ] **Media generation:** Often missing async + budget line — verify video runs as a background job and draws a separate capped media budget.
- [ ] **Proactive review:** Often missing the OAuth check — verify it touches no Google token and survives past 7 days.
- [ ] **Multi-user owner-gating:** Often missing — verify the three Phase-8 functions reject a non-owner and every new admin control has `requireOwner`.
- [ ] **Invite flow:** Often missing subject reconciliation — verify redemption binds the OAuth subject, matches the invited email, and leaves no orphaned tenant on mismatch (both Google + MS).
- [ ] **Cross-tenant isolation:** Often missing coverage — verify the two-tenant test covers every table added this milestone.
- [ ] **ISO 9001:** Often missing reality-matching — verify records reflect actual practice and new docs only fill genuine clause gaps.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Bad skill activated live | LOW | Roll back via versioned registry to prior `active`; revoke agent activate capability; add adversarial eval case |
| Sub-agent loop/cost blowout | MEDIUM | Kill-switch halts tree; add/lower depth+fan-out caps; backfill lineage fields; replay from DLQ |
| Grounded PII in WORM export | HIGH | WORM is immutable — cannot delete; mitigate forward (stop writing prose), disclose, close names-in-prose before more exports accrue |
| Cross-tenant leak found in beta | HIGH | Halt beta; scope the query; audit blast radius via per-table `db_read`/`db_write` edges; notify affected |
| Un-gated function abused | MEDIUM | Ship `requireOwner`; revoke; audit who called it (insert-only log has the trail) |
| Orphaned/mis-bound tenant from invite | MEDIUM | Reconcile subject↔invite; migrate/merge orphan rows (prior milestone precedent); add redemption test |
| Fabricated-advice trust hit | MEDIUM | Add provenance-required gate + "no gaps" path; re-run eval; communicate the fix |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1 Self-activating agent skill | S3 (dynamic skills) | Agent tool cannot call activate; candidate→active needs owner + green eval |
| 2 Indirect prompt injection | S1 grounding / S2 research | Retrieved content cannot trigger execution without plan approval; injection eval case |
| 3 Multi-agent runaway | S2 (sub-agent dispatch) | Depth cap + shared budget + cycle refusal + lineage in audit rows |
| 4 Non-credible evaluation | S1 engine (+ S2 for market facts) | Healthy-business fixture → zero gaps; every finding has a source + confidence |
| 5 PII in grounding→audit | S1 (vault wiring) | No audit/telemetry/step/DLQ row contains grounded-doc substrings |
| 6 Media cost/abuse/latency | S3 (media canvas) | Async job model; separate capped media budget; moderation verdict logged as ref |
| 7 7-day token / proactive drift | S1 in-app; S4 for Google-bound | Proactive review uses no OAuth token; survives >7 days |
| 8a Cross-tenant regression | S4 gate, assertions in S1–S3 | Two-tenant isolation test covers every new table/surface |
| 8b Owner-gating holes | S4 (requireOwner) | Three Phase-8 functions reject non-owner; new admin controls gated at birth |
| 8c Invite/OAuth reconciliation | S4 (productionization) | Redemption binds OAuth subject, verifies email, no orphan on mismatch (Google+MS) |
| 9 ISO process-theater | S4 (QMS) | Clause→existing-artifact map; records match practice; no drift docs |

## Sources

- This repo: `CLAUDE.md` (§2 wrapper/tenant scope, §3 insert-only audit, §4 redaction-safe payloads, §5 skills-from-registry, §6 pinned versions); `.planning/PROJECT.md` (v2.0 staircase, Key Decisions, restricted-scope constraints); MEMORY `phase8-owner-auth-blockers` (three un-gated functions, names-in-prose ceiling, SKILLOPT env, cross-tenant IDOR fix), `tenant-scope-is-per-session` (subject-derived tenant, prior orphaned-rows migration), `llm-use-vercel-ai-gateway`. HIGH.
- graphify subgraphs: skill registry / eval (`skills.ts:getActiveSkill/activateCandidate`, `skilloptExport.ts`, `run-eval-golden.mjs`), grounding (`vaultGround.ts`, `vaultRag.ts`), guardrails (`guardrails.ts:preCall/recordSpend`), audit (`audit.ts:log`), `optimizerConfig`/`opsSignals`, `09-CONTEXT.md`. HIGH.
- [Google OAuth Refresh Token: 7-Day Limit (2026) — Unipile](https://www.unipile.com/google-oauth-refresh-token/) and [Manage App Audience — Google Cloud Help](https://support.google.com/cloud/answer/15549945?hl=en): testing-mode refresh tokens expire at 7 days; Internal/In-Production removes the cap. Verified current 2026. HIGH.
- [Prompt Injection Defense for Production AI Agents — A Complete 2026 Guide (Maxim)](https://www.getmaxim.ai/articles/prompt-injection-defense-for-production-ai-agents-a-complete-2026-guide/) and [Web-Based Indirect Prompt Injection in the Wild — Palo Alto Unit 42](https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/): capability minimization over instruction-policing; ~5 crafted docs → ~90% RAG steer; retrieved web content as attack vector. MEDIUM–HIGH (multi-source, current).
- ISO 9001:2015 clauses referenced from the standard's structure (7.5 documented info, 8.3 design/dev, 8.5.6 change control, 8.6 release, 10.2 nonconformity) mapped to existing artifacts. MEDIUM (clause mapping is interpretive).

---
*Pitfalls research for: governed multi-tenant AI chief-of-staff platform expansion + multi-user beta (v2.0)*
*Researched: 2026-07-24 · prior milestone pitfalls preserved in PITFALLS-v1.md*
