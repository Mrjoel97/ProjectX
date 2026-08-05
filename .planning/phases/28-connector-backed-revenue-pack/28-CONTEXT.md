# Phase 28: Connector-Backed Revenue Pack - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning
**Source:** Owner-approved knowledge-work plugin rollout; Small Business MCP configuration

<domain>
## Phase Boundary

Add server-side, read-only HubSpot, QuickBooks, Stripe and PayPal data rails, then enable lead
triage/call lists, pipeline reviews, customer pulse, cash-flow/payroll-confidence reporting and
invoice-reminder drafts. This phase begins only after Phase 19's contacts, consent, suppression and
follow-up substrate exists and Phase 27 has proven the native pack contract.

This phase does not treat vendor MCP URLs as pre-approved, does not add an arbitrary MCP client,
does not add accounting/CRM writes, and does not allow an LLM to calculate financial results.

Execution has a hard readiness gate: Phase 19 must have landed ACTN-05 and PIPE-01 terminal
contracts, Phase 25 must have a production-safe secret/OAuth posture, and Phase 27 must have landed
the manifest, static grant, eval, discovery and shared-event contracts. No Phase 28 dependent plan
may substitute an assumed interface when that gate is red.

</domain>

<decisions>
## Implementation Decisions

### Provider suitability gate
- Review each provider independently for server-side endpoint availability, OAuth grant type and
  refresh/revocation behavior, requested scopes, data-processing terms, commercial terms, rate
  limits, webhook/replay behavior, sandbox access and production verification requirements.
- The upstream `.mcp.json` is a lead list only. A URL working in Claude/Cowork does not prove it is
  suitable for Pikar's Convex backend or multi-tenant SaaS.
- No connector appears in the product before encrypted credential storage, per-tenant revocation,
  honest re-auth/failure states and two-tenant isolation tests exist.
- Begin read-only. Adding a write scope or action requires a later explicit plan and new approval-
  path analysis.
- Provider lanes complete independently with a machine-readable `passed` or `parked` result. One
  parked provider cannot prevent an already-proven provider/workflow subset from being released.
- A partial subset release is not Phase 28 completion. REVN-01, REVN-02 and REVN-03—and therefore
  the phase—remain incomplete until every provider named by those requirements has a current
  production-suitability decision and controlled production/live read/revoke gate marked `passed`.

### One business-data model
- HubSpot consumes Phase 19 contacts/consent/suppression and may attach provider references; it must
  not create another person or pipeline store.
- Provider adapters normalize bounded projections needed by workflows instead of leaking arbitrary
  vendor response shapes into prompts or React.
- Every projection identifies provider, coverage window, retrieval time, partial/capped state and
  source references without storing raw third-party payloads in audit/telemetry.

### Deterministic finance
- Normalize money as integer minor units plus explicit currency; reject or separate mixed currency.
- Cash-flow, AR aging, payment-lag statistics, confidence semantics and payroll-gap calculations
  live in pure TypeScript with fixtures and property/boundary tests.
- LLMs explain already-computed results and may not create, modify or silently repair numbers.
- State the data coverage and missing sources; missing history is unknown, never zero.
- Outputs are decision support, not financial/tax/accounting advice, and call for qualified review.

### Governed actions
- Lead/call/pipeline/customer-pulse workflows are read-only analyses.
- Invoice reminders are generated as drafts and stage a normal plan. No send occurs before approval.
- Refund, credit, dispute resolution, CRM mutation, journal entry and accounting write tools are
  absent from revenue specialists.
- Suppression and consent checks remain Phase 19's terminal trust boundary for any approved outreach.

### Success measurement
- Reuse Phase 27 telemetry and add refs/counts/status outcomes for follow-ups completed, overdue-item
  recovery when observable, customer-response handling time, forecast coverage and connector
  availability. Do not store amounts, names, messages or raw provider data in telemetry.

### Claude's Discretion
- Adapter order after the independent suitability reviews; prefer the provider with the highest
  beta-user coverage and least risky auth surface.
- Exact normalized read models and cache windows, provided reads are bounded and freshness is shown.
- Whether connectors share a token envelope only after two concrete implementations justify it.

</decisions>

<specifics>
## Specific Ideas

- Upstream connector lead list:
  `https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/small-business/.mcp.json`.
- Preserve Pikar's existing distinction: Phase 26 Finance reports Pikar usage/spend; this phase's
  Business Finance workflows report the tenant's business cash/receivables and need separate naming.
- Live verification must use provider sandboxes or controlled owner data and prove reads only; no
  production write scope should be requested “for later.”

</specifics>

<deferred>
## Deferred Ideas

- Refunds, credits, PayPal invoice sends, CRM cleanup, journal entries and any accounting mutation.
- Canva, DocuSign, Slack, Square and other upstream connector candidates until separate demand and
  suitability reviews justify them.
- Warehouse/data-analysis connectors belong to Phase 30's Data pack.

</deferred>

---

*Phase: 28-connector-backed-revenue-pack*
*Context gathered: 2026-08-05 from owner-approved rollout*
