# ADR-062 — Managed services reuse the governed agent runtime

- **Status:** Implemented offline in part; release and live acceptance pending.
- **Date:** 2026-10-22
- **Context:** Owner-approved managed-services programme, with the October 22 correction permitting independent offline development while keeping release prerequisites.

## Decision

A tenant owns a service's objective, selected account references, exact skill references, operation selection and budget ceiling. A configuration revision belongs to the service adapter; an edit uses compare-and-set so an old tab cannot overwrite a newer setup. Connection credentials remain in the existing Buffer/Zernio stores. Registry bodies remain in the existing skill registry. Cost and latency remain in spendEvents and agentSteps. A configuration budget is a ceiling, not a reservation or spending authorization.

Operations are code-owned identifiers, never an agent-supplied tool list, prompt-shaped permission, HTTP target, executable code or a new workflow language. Readiness uses server-resolved connection ownership/revision, selected account availability, effective skill identity and qualified operation admission. Saving a setup does not make it ready. The initial adapter admits no operations until the preceding qualification and the service's own execution acceptance exist.

Execution will use the existing Executive or native pack boundary. Executive tools must be intersected with the approved service operation set; ordinary Executive lineage alone is insufficient. Packs remain leaf agents. A candidate instruction change still requires the existing evaluation and independent owner activation protocol. This decision neither qualifies candidates nor supplies an activation witness.

Setup and bounded status views may be developed and tested without starting a model, provider or scheduler. Trusted start, idempotent durable claims, permission snapshots, per-operation checks and terminal receipts must be implemented and tested before that boundary is wired to execution. A policy predicate is not proof that a running worker observes it.

Pause/Stop fence future local work at claim boundaries. They do not interrupt a paid provider call already in flight, release unknown-cost holds, or cancel posts already accepted by Buffer. Unknown outcomes require reconciliation before another attempt. A service edit invalidates old configuration claims; callbacks cannot revive old work.

ADR-046 continues to govern unattended authority: read and prepare only. Exact-content approval remains at the existing publishing boundary. There is no cadence, due-work scanner, recurrence import or replacement scheduler in this change. Existing reporting exceptions remain supported.

## Consequences

Users configure one service and supervise its results rather than assembling agent dispatches. The shared boundary has one owner for setup data and reuses existing execution, credential, approval and accounting ownership.

The initial local implementation does not constitute a complete engine. Phase 49 still owes trusted execution, tool-scope integration, usable setup/supervision and authenticated acceptance. The current Phase 48 and recurrence gates remain open. Offline test results must not be presented as live business outcomes or qualification evidence.
