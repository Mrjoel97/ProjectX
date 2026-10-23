---
phase: 49-shared-managed-service-boundary
plan: "03"
status: partial
completed: false
requirements-completed: []
---

# 49-03 — Attended execution implemented locally

As of 2026-10-23, the authenticated start adapter and the ordinary Executive service tools use the same tenant start operation. Durable native claims deduplicate request keys, forbid overlapping claimed/running/unknown attempts and bind one owned conversation and plan to the existing Workflow component. Its one action disables retries and reuses the existing Executive. Setup failure, governed stop, unknown cost and missing completion receipts have explicit durable outcomes.

Each new reasoning step/tool reads current native configuration/control/account/skill state. Provider reservation and draft staging check their fences atomically. Pause/Stop invalidates future steps; explicit Resume does not start work or revive callbacks. The one-hour run lifetime closes new work. Existing provider accounting enforces a per-run ceiling including unresolved holds; settlement still records accepted usage after Stop/expiry. User goals/replies use the existing Agent store; run/audit metadata carries no prompt or reply.

Local evidence: managedServiceRuns16, managedServiceTools4, managedServiceRuntime5, managedServices14, Buffer15 and toolRegistrySnapshot23 tests pass. The actual native Workflow/component test runs the scripted SDK tool loop, stages a real local draft, saves the Agent result and proves duplicate start does not execute twice. Paid middleware/budget/guardrails/ledger56 tests pass. This is synthetic local verification with mocked future operation admission and a scripted model, not provider egress or qualification.

Remaining: current-source release/readiness admission and hosted authenticated acceptance. Operation admission remains empty. No deployment, paid test, production mutation or owner activation occurred.
