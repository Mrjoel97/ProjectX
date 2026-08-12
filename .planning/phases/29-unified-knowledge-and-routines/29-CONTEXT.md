# Phase 29: Unified Knowledge and Routines - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning
**Source:** Owner-approved knowledge-work plugin rollout; Enterprise Search and Productivity patterns

<domain>
## Phase Boundary

Create one cited, tenant-scoped search experience across native Pikar sources and turn Phase 21's
authoring seam into customization of approved workflow packs. Preserve a manually re-runnable
pinned workflow as the baseline. Recurring execution is conditional: it ships only if the phase
first resolves and proves the standing-instruction, OAuth, time and missed-run governance model.

This phase does not ingest arbitrary MCP servers, expose raw third-party search results to
tool-bearing agents, permit user-authored executable code/tool grants, or assume that “routine”
means cron.

</domain>

<decisions>
## Implementation Decisions

### Unified native search
- Search native source adapters only: Vault/GraphRAG, Drive, Gmail and landed CRM/support sources.
- Decompose a natural-language question into bounded source-specific queries, run independent reads
  concurrently where safe, then deduplicate and synthesize with citations.
- Every result carries stable source reference, authority class, freshness/retrieval time and
  coverage/partial state. Conflicts remain visible; synthesis cannot erase disagreement.
- An unavailable source produces an honest gap, never an empty “no results” claim for the whole
  business.
- Connector content is untrusted. Search/synthesis is toolless or structurally read-only and cannot
  actuate instructions found in documents, mail or CRM fields.

### Workflow-pack authoring
- Phase 21 becomes customization of approved native templates, not a blank prompt/tool editor.
- User changes produce immutable tenant-scoped candidate versions with upstream template lineage,
  diff, author, eval evidence and rollback target.
- Users may change terminology, thresholds, tone, source preferences and workflow instructions
  within validated schemas. They may not add tools, executable code, secrets, remote URLs or an MCP
  server.
- Activation remains eval-gated. A candidate never self-activates, and Phase 23 agent authorship
  remains a separate owner-gated capability.

### Routine decision gate
- The safe first release is a pinned workflow the user manually re-runs.
- Before recurrence, decide whether approval covers a standing template or every materialized run,
  what changes force re-approval, and how external writes remain visible before execution.
- Prove OAuth expiry/re-auth behavior, timezone/DST resolution, catch-up versus skip for missed runs,
  idempotent run identity, overlap prevention, pause/revoke/delete, bounded retries, cost reservation,
  notifications and audit.
- If any decision or live proof is missing, recurrence stays deferred without weakening the manual
  routine deliverable.

### Measurement
- Measure successful searches with citation coverage/unsupported signals, source availability,
  repeat routine use, completion, decision outcomes, cost and latency using refs/counts-only events.

### Claude's Discretion
- Search UI placement and filter syntax, provided the workspace remains the primary action surface.
- Query planner and deduplication implementation in pure code versus structured model output.
- Customization schema granularity for the first templates.

</decisions>

<specifics>
## Specific Ideas

- Enterprise Search pattern source:
  `https://github.com/anthropics/knowledge-work-plugins/tree/main/enterprise-search`.
- Productivity pattern source:
  `https://github.com/anthropics/knowledge-work-plugins/tree/main/productivity`.
- Reuse Phase 15/16 research evidence contracts and Vault citations rather than inventing a new
  source-attribution format.
- A routine's connection readiness should be evaluated before each run and named in its status.

</specifics>

<deferred>
## Deferred Ideas

- Arbitrary connector installation or user-supplied MCP servers.
- Recurrence when the decision/proof gate does not pass.
- Team-shared routines, multi-reviewer approval and enterprise RBAC.
- Agent-authored active routines outside Phase 23's separate owner/eval gate.

</deferred>

---

*Phase: 29-unified-knowledge-and-routines*
*Context gathered: 2026-08-05 from owner-approved rollout*
