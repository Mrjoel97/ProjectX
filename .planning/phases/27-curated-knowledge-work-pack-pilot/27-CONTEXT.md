# Phase 27: Curated Knowledge-Work Pack Pilot - Context

**Gathered:** 2026-08-05
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

### Native adaptation
- Anthropic files are upstream reference material, not runtime dependencies.
- Pin an exact upstream commit and source file set. Store hashes, Apache-2.0 attribution and
  prominent modification notices. Updates are manual reviewed diffs that publish new candidates;
  nothing auto-syncs or auto-activates.
- Rewrite Claude/Cowork-specific language into provider-neutral Pikar instructions. Reuse the
  Executive Agent, Business Blueprint, Vault, specialist dispatcher, cards, Content artifacts and
  approved-plan executor.
- Each workflow is atomic enough to evaluate independently, while cross-workflow routing remains the
  existing Executive Agent's job.

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

### Candidate and exposure gate
- Every imported body lands as a candidate with immutable provenance.
- Evals assert output/tool/artifact/plan state, evidence quality and refusals — never brittle prose.
- Add injection, missing-source, sparse-profile, cross-tenant and prohibited-tool cases.
- A workflow is not discoverable until the candidate gate and authenticated responsive browser UAT
  pass. Rollback returns to the previous active version without changing capability grants.

### Outcome measurement
- Shared refs/counts-only events cover: onboarding-to-first-useful-outcome, recommendation shown and
  accepted, plan approve/edit/reject, missing-connector surprise, citation coverage,
  unsupported-claim signal, completion outcome, cost and latency.
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

- Business Pulse should compose Phase 26 source summaries rather than reread raw tables.
- Campaign Plan should compose Growth OS/lead-engine, research, content and media preparation; it
  must not imply connector-backed execution that belongs to Phase 28.
- Customer Complaint Response works from pasted text or existing inbox context and drafts only.
- Sales Call Prep works from user/Vault/web context before CRM data exists.
- Process/SOP Builder should accept voice briefs and files and save a durable Vault/Content artifact.
- Brand Review should apply confirmed tenant brand guidance when present and name generic-review
  limitations when it is absent.
- Upstream roots:
  `https://github.com/anthropics/knowledge-work-plugins` and
  `https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business`.

</specifics>

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
