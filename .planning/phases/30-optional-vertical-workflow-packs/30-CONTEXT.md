# Phase 30: Optional Vertical Workflow Packs - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning
**Source:** Owner-approved knowledge-work plugin rollout; Anthropic vertical plugin patterns

<domain>
## Phase Boundary

Offer optional Legal, HR, Product, Design, Engineering and Data packs through the native pack
substrate. Relevance is derived from confirmed tenant tier, business profile and connected
capabilities. Every vertical is independently versioned, gated, measurable and disable-able.

Bio Research is explicitly outside this phase and the general product until real behavioral demand
and a separate scientific/regulatory plan exist.

</domain>

<decisions>
## Implementation Decisions

### Relevance and product shape
- Do not present a flat marketplace. Recommend at most contextually relevant packs and explain why a
  pack is available, unavailable or blocked.
- Tier/profile selection changes guidance, templates and discovery only. It never changes
  code-owned capability grants.
- Packs share the Business Blueprint, Vault, Content artifacts, approval executor and source
  adapters; no vertical gets a second tenant memory or output store.
- Each pack can be disabled or rolled back independently without deleting its prior artifacts.

### Vertical gates
- Each pack pins its upstream source/provenance and receives its own method review, output contract,
  disclaimers, missing-source behavior, adversarial/outcome evals and authenticated responsive UAT.
- Legal outputs are issue spotting and playbook comparison, not legal advice; qualified counsel must
  review consequential decisions.
- HR outputs avoid protected-attribute inference and autonomous employment decisions; compensation
  and performance outputs require qualified human review and explicit data provenance.
- Data starts with uploaded CSV/XLSX and deterministic validation. Warehouse queries are read-only
  and unavailable until a dedicated adapter/security/terms gate passes.
- Product, Design and Engineering packs initially produce artifacts/reviews from user/Vault inputs;
  external project, design, source-control and monitoring connectors are separate opt-in adapters.
- High-stakes results never auto-send, file, sign, change employment state or execute production
  changes.

### Evidence and measurement
- Do not use install count. Measure first useful artifact, accepted recommendation, repeat workflow
  use, completion, evidence/citation quality, review/edit rate, cost and latency.
- A vertical with no behavioral use stays hidden/deprecated rather than expanding connector scope.

### Bio Research exclusion
- Require a named life-sciences persona, behavioral demand, scientific validation owner, data and
  literature licensing review, compute/sandbox model, regulated-risk assessment and a dedicated
  roadmap phase before reconsideration.

### Claude's Discretion
- Which one or two verticals enter the first wave, based on Phase 27-29 behavioral evidence.
- Whether a vertical begins as one composite pack or several narrow templates, provided each has an
  independently testable outcome.
- Exact discovery presentation within Pikar's existing profile/workspace/Command Center surfaces.

</decisions>

<specifics>
## Specific Ideas

- Source roots:
  `https://github.com/anthropics/knowledge-work-plugins/tree/main/legal`,
  `human-resources`, `product-management`, `design`, `engineering`, and `data`.
- Candidate file-first workflows include contract review, hiring/onboarding pack, PRD/roadmap brief,
  design/accessibility critique, architecture/incident runbook and dataset validation/reporting.
- Connector-backed variants must reuse Phase 29 native search/source adapters where possible and
  cannot bypass the provider suitability gate established in Phase 28.

</specifics>

<deferred>
## Deferred Ideas

- Bio Research and scientific tool integrations.
- Certified legal signatures, autonomous employment decisions, production deployment execution,
  write-capable data warehouse access and regulated filings.
- New connectors without behavioral demand and independent suitability review.

</deferred>

---

*Phase: 30-optional-vertical-workflow-packs*
*Context gathered: 2026-08-05 from owner-approved rollout*
