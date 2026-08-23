# Phase 27: Curated Knowledge-Work Pack Pilot - Context

**Gathered:** 2026-08-05
**Corrected:** 2026-08-23 — against `27-READINESS.md` (file:line evidence there) and two binding owner
decisions of the same date. Where this file previously asserted a capability the agent cannot reach,
or a composition the runtime structurally forbids, it now says so.
**Status:** Ready for planning
**Source:** Owner-approved knowledge-work plugin rollout; Anthropic knowledge-work-plugins repository

<domain>
## Phase Boundary

Adapt six workflow patterns into native Pikar packs: Business Pulse, Campaign Plan, Customer
Complaint Response, Sales Call Prep, Process/SOP Builder and Brand Review. This phase proves the
pack model using capabilities Pikar already owns. It also establishes the shared upstream
provenance, operation-to-tool mapping, eval, exposure and outcome-measurement contract inherited by
all later packs.

This phase does not install Claude plugins, load `.mcp.json`, add external business-data connectors,
create a second router, introduce a new memory plane, or allow users to grant tools.

</domain>

<decisions>
## Implementation Decisions

### Owner decisions — 2026-08-23 (binding; do not re-litigate)

**A. All six packs ship in the pilot.** Business Pulse, Campaign Plan, Customer Complaint Response,
Sales Call Prep, Process/SOP Builder and Brand Review all stay in. Three of them are specified
against inputs the agent genuinely cannot reach today (see `<specifics>`). Those inputs are
classified **MISSING** in 27-02's operation matrix and carried by this phase's honest-partial-state
contract — the pack runs, names the missing source to the user in its own output, and names the
unlock. **Do NOT add new read tools to make a pack look complete.** That is scope no plan in this
phase owns, and every new tool inflates the eval corpus this phase already has to pay for.
The honest-partial state is a **product feature of this phase, not a shortfall of it**: a pack that
tells the user "I could not see your Phase 26 revenue summary, here is what I could see, here is
what would unlock it" is the deliverable. A pack that quietly omits the gap is a defect.

**B. Packs are LEAF AGENTS.** A pack runs with a code-owned tool allow-list, and passing `toolNames`
is not side-effect-free: `packages/backend/convex/llm.ts:4337` sets `grantDispatch: toolNames ===
undefined` and `:4342` sets `grantSkillAuthoring: toolNames === undefined`. An allow-list is a
REQUEST from the caller, so an agent that carries one **structurally cannot dispatch a specialist
and cannot author a skill** — there is no prompt or grant that reverses this, and no plan may try.
Consequences every downstream plan inherits:
- A pack calls tools. It never calls another agent.
- Cross-workflow and cross-agent composition stays with the **Executive Agent**, which runs with
  `toolNames === undefined` and keeps both grants.
- A pack whose job is "plan X" **produces a plan**. It does not orchestrate the work in the plan.

### Native adaptation
- Anthropic files are upstream reference material, not runtime dependencies.
- Pin an exact upstream commit and source file set. Store hashes, Apache-2.0 attribution and
  prominent modification notices. Updates are manual reviewed diffs that publish new candidates;
  nothing auto-syncs or auto-activates.
- **A skill body is two files plus a test entry.** The canonical body is a `.md` under
  `packages/contracts/skills/` (30 files today). `packages/contracts/src/skills/` holds the
  **auto-derived `.ts`** constant, and `skillBodies.test.ts` asserts the pair is byte-identical.
  Any plan that authors a pack body must edit BOTH files and add the sync-test entry, and the
  provenance manifest hash must pin the **`.md`**, not the derived `.ts`.
- Rewrite Claude/Cowork-specific language into provider-neutral Pikar instructions. Reuse the
  Executive Agent, Business Blueprint, Vault, cards, Content artifacts and approved-plan executor.
  **Not the specialist dispatcher** — per owner decision B a pack carries a tool allow-list and
  therefore cannot dispatch (`llm.ts:4337`). Dispatch stays with the Executive Agent.
- Each workflow is atomic enough to evaluate independently, while cross-workflow routing remains the
  existing Executive Agent's job. This is now structural, not stylistic: a leaf agent has no other
  option.

### Tool and trust boundary
- Produce a complete matrix of every operation each workflow requests: existing Pikar tool,
  explicitly missing capability, or forbidden operation.
- Skill bodies describe behavior only. Tool grants stay code-owned and withheld tools are
  structurally absent per ADR-007.
- Existing connected data is untrusted input. It is fenced/summarized before tool-bearing loops and
  cannot steer a write, send, paid generation or plan-state mutation.
- Read-only analysis may run without an extra approval. Anything that leaves Pikar or changes
  external/user state stages through the existing single plan approval.
- Missing capabilities produce honest blocked/partial states and named unlocks; no silent degradation.
  Per owner decision A this is the **primary deliverable** for the three starved packs, not a fallback
  path — the eval fixtures must assert the missing-source statement is present and specific, exactly
  as they assert a refusal.
- Playbook obligations travel with the code (CLAUDE.md §9, enforced by a Stop hook): touching the
  skills registry / candidates / seeding forces `docs/playbooks/skill-registry.md`; touching `llm.ts`
  or `dispatch.ts` forces `docs/playbooks/cockpit.md`; adding a table or touching `tenantData.ts`
  forces `docs/playbooks/audit-dead-letter.md`. Every plan lists the playbook it forces in
  `files_modified` and bumps that playbook's `Last verified` line in the same commit. New code under
  `packages/*` or `apps/*` that no playbook covers registers its path prefix in
  `docs/playbooks/watch.json`.

### Candidate and exposure gate
- Every imported body lands as a candidate with immutable provenance.
- Evals assert output/tool/artifact/plan state, evidence quality and refusals — never brittle prose.
- Add injection, missing-source, sparse-profile, cross-tenant and prohibited-tool cases.
- A workflow is not discoverable until the candidate gate and authenticated responsive browser UAT
  pass. Rollback returns to the previous active version without changing capability grants.

### Outcome measurement
- Shared refs/counts-only events cover: onboarding-to-first-useful-outcome, recommendation shown and
  accepted, plan approve/edit/reject, missing-connector surprise, citation coverage,
  unsupported-claim signal and completion outcome. **Cost and latency are read from their existing
  owners, never re-emitted** — `spendEvents` owns cost (rail `reasoning`, by_correlation) and
  `telemetry.durationMs` / `agentSteps` own latency. A duplicate cost number that can disagree with
  the billing plane is worse than no number.
- Workflow-specific outcome events may add ids/counts/statuses, never raw prompts, connector content,
  generated prose, customer names or financial details.
- Install count is not a success metric.

### Claude's Discretion
- Exact number of registry rows versus reusable reference files.
- Whether workflow discovery is a small workspace quick-start surface, Command Center suggestion, or
  both, provided no new catalogue-like navigation is introduced.
- Exact telemetry event names and bounded read model, consistent with existing audit/telemetry
  conventions.

</decisions>

<specifics>
## Specific Ideas

Corrected 2026-08-23. Each brief now states which of its inputs are agent-reachable and which are
MISSING, and names the real seam. Where a brief previously implied composition, it has been rewritten
per owner decision B.

- **Business Pulse.** The Phase 26 source summaries are **MISSING** — `reportsBusiness.ts`
  business / operations / sentMail are `tenantQuery`, i.e. UI reads, not agent tools, and this pack
  cannot reach them. Do not add a read tool for them (decision A). Build the pack on what the loop
  can actually see and have it name the unseen summary explicitly. Note also that
  `HOME_PRIORITY_ORDER` was reordered on 2026-08-23 (85daa4b) and five files re-declare that order as
  a literal without importing it — do not build a pulse claim on top of a "stable" Command Center
  priority.
- **Campaign Plan. Produces a plan; does not orchestrate one.** The former brief ("composes
  Growth OS/lead-engine, research, content and media preparation") is **withdrawn** — it is
  structurally impossible for an allow-listed agent (`llm.ts:4337` `grantDispatch: toolNames ===
  undefined`). The pack takes the user's brief plus the tools it is granted and emits a campaign
  plan the Executive Agent (or the owner) can then act on. It must still not imply connector-backed
  execution, which belongs to Phase 28.
- **Customer Complaint Response.** Pasted text is the first-class input. Inbox context, where used,
  goes through the real seam — `llm.ts` `listInbox`:3377 and `briefInbox`:3417 (backed by `gmail.ts`,
  with `briefings.ts` for the stored brief). There is no `convex/inbox.ts` and none is to be created.
  Drafts only.
- **Sales Call Prep.** Works from user / Vault / web context. CRM reads are **MISSING**: the only
  contact-shaped tools are `resolveContacts` (returns labels, never addresses) and `stageCrmWrite`.
  Say so in the output rather than implying a CRM lookup happened.
- **Process/SOP Builder.** Accepts briefs and files and saves a durable artifact through the real
  seam: `llm.ts` `createDocument`:3715 → `internal.vault.insertCreatedDoc` (`llm.ts`:3840). The
  bounded artifact read plane is `content.ts` (`listArtifacts` / `summary` / `artifactById`). There
  is no `convex/documents.ts` and no `convex/artifacts.ts`; do not create a second artifact store.
  **MISSING for this pack:** there is no filesystem, task-system, Canva or publishing tool, and no
  org-chart/role source, so an SOP cannot be assigned, scheduled or published from here. It produces
  a durable document and says plainly what it could not wire up. (Recorded because Process/SOP was
  the only pack whose gaps were framed as absent TOOLS rather than as `missing` INPUTS in 27-02's
  matrix — the two are audited differently, and the honest-partial contract keys off the latter.)
- **Brand Review.** There is **no tenant brand store** — `brandVoice` is a per-plan optional string
  at `packages/backend/convex/schema.ts:757`, not confirmed tenant guidance. So "apply confirmed
  tenant brand guidance when present" is **MISSING** for the pilot: ship the generic review, and have
  the pack state plainly that it reviewed against general principles because no tenant brand guidance
  exists yet, and name what would unlock the stronger review.
- Upstream roots:
  `https://github.com/anthropics/knowledge-work-plugins` and
  `https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business`.

</specifics>

<sequencing>
## Sequencing and non-dependencies

### Phase 25 does NOT gate Phase 27 — recorded so it stops being re-manufactured

The ROADMAP cell reading Phase 25 `0/14 Planned` is **stale bookkeeping, not a dependency**. Seven
Phase 25 SUMMARYs exist and their code is live: `invites.ts` (`requestAccess` / `preflight` /
`approve`), the `betaWaitlist` / `betaInvites` tables, and `docs/playbooks/beta-admission.md`. More
decisively: **no Phase 27 plan references a single Phase 25 artifact** — grepping outlook / invite /
waitlist / custom-domain across all nine plans returns zero hits. Treating Phase 25 as a gate is also
a cycle, since Phase 25 is downstream of the same unfinished lanes Phase 27 consumes. Do not
reintroduce it as a prerequisite in any plan, summary or roadmap edit for this phase.

### Execution starts at 27-02, not 27-01

Both are wave 1 with `depends_on: []`, so either could run first — but the order is not arbitrary:

- **27-02 holds the load-bearing engineering every downstream plan reads**: the candidate-only first
  publication path, the code-owned tool-grant registry, and the operation→tool matrix that decides
  which inputs are MISSING under owner decision A. 27-04/05/06 cannot write a body without the
  operation vocabulary; 27-07 cannot bind without the grants; 27-08 cannot publish without the
  candidate path. It is also entirely offline and internal — no network, no credit, no owner.
- **27-01 halts on its first task as written.** Its upstream source table names
  `small-business/skills/ticket-deflector/`, which does not exist at pinned SHA `5267cf7` (the tree
  has `customer-pulse` / `customer-pulse-check`), and Sales Call Prep and Process/SOP Builder were
  never inventoried at all. Task 1 is written to fail closed on an absent path. Re-inventory the
  upstream tree at the pinned SHA **before** 27-01 runs; it also needs the one network fetch in the
  phase.

</sequencing>

<deferred>
## Deferred Ideas

- HubSpot, QuickBooks, Stripe and PayPal: Phase 28.
- Unified cross-source search and recurring routines: Phase 29.
- Legal, HR, Product, Design, Engineering, Data and Bio Research: Phase 30 or later.
- User-authored arbitrary prompts/tools and agent-authored pack activation remain governed by Phases
  21/23 and are not expanded here.

</deferred>

---

*Phase: 27-curated-knowledge-work-pack-pilot*
*Context gathered: 2026-08-05 from owner-approved rollout*
