# ADR-072 — Customer-owned specialists and manual workflows

- Date 2026-11-03
- Status Implemented for offline-qualified pilot review

## Decision

Customers admitted by `CUSTOMER_WORKFLOWS_PILOT_TENANTS` can create private named specialists and manually run private reusable workflows. The default allowlist is empty. An authenticated tenant identity controls access to configuration, versions, selected knowledge and run outputs.

A specialist records the customer's objective, audience and instructions as task configuration. Its revisions are immutable. Each workflow run captures its workflow and specialist versions together with the new product brief. Customer configuration enters the existing governed agent as user input. The system instructions come from the active registry, and the implementation selects the permitted operations.

The initial pilot produces one composite document through the existing Markdown/PDF writer and workspace artifact queries. Ordered workflow instructions describe the work to include in that document. The UI states this output scope. Manual Run captures consent to that generation. A rerun for another product creates a distinct run with its own brief.

Use the current tenant/deployment spend ledger, selected-source ownership checks and account lifecycle fencing. A request identity prevents repeated delivery of the same Run action from initiating duplicate generation. Ambiguous provider outcomes require reconciliation. Running configuration is a snapshot and subsequent edits use compare-and-set revisions.

This authorizes customer configuration within the pilot's document-generation capability. Platform instruction activation continues through the skill registry. The earlier three-name adaptation UI remains a separate compatibility surface. General recurrence and new connector operations retain their separate qualification decisions.

## Acceptance

An ordinary pilot tenant can create a specialist, select it in an authored workflow, run a product brief, open the generated file in that chat and rerun the workflow for a second product. Required checks cover another tenant, disabled admission, archived/stale versions, duplicated starts, incomplete model responses and account export/erasure. Production acceptance and model-output quality must be recorded separately from scripted offline checks.
