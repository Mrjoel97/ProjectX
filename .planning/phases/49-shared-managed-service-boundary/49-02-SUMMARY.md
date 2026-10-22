---
phase: 49-shared-managed-service-boundary
plan: "02"
status: partial
completed: false
requirements-completed: []
---

# 49-02 — Local tenant setup and readiness

Implemented under the October22 parallel offline-development correction, on `feat/managed-service-foundation`. This is unreleased source work; the Phase48 seal is still absent.

The new tenant-owned `managedServices` table stores objective, exact account/connection and skill identity references, operation selection, budget ceiling and revisioned local control state. `setup` creates or compare-and-set updates owned configuration, caps each tenant at50 services and rejects foreign/missing references. Bounded `list`, `status` and revision-pinned `readiness` derive actual selected/connected account and effective skill status from native reads. No credential or skill body appears in the view. Business-review source readiness reads an owned ready nonempty `business_profile`, not the separate Blueprint document.

`setControl` persists pause/stop using both setup/control revisions and an atomic refs-only audit event. Editing preserves paused/stopped state; a stale control or edit refuses. These controls fence configuration for later worker integration; no worker is wired and actual running-work cancellation is not claimed. There is no resume/start, cadence, due-work scanner, provider call or new credential store.

Export/erasure classification includes the new table. The audit viewer explicitly projects only the service reference, revisions and closed control state. Its negative regression drops injected objective/key/body/nested fields. Local generated API type registration was updated without contacting a deployment.

Executed locally:13 native managed-service tests plus48 existing isolation,18 report-governance,41 schema and83 recurrence-decision tests pass.14 tenant-data and23 audit-projection tests pass. Initial backend typecheck passed; final integration checks are recorded with the development change. Independent review corrected the source-kind mistake and closed-shape setup projection after the pure contract was tightened.

All service operations remain unadmitted in the server adapter: no client flag or environment switch opens them. Pack qualification is deliberately unavailable until its existing exact acceptance adapter is connected. A saved setup is never reported as a running service. Trusted execution/tool intersection, UI, current-source acceptance and release remain pending. No MSVC requirement or phase is marked complete by these local checks; no new paid run, activation or production change occurred.
