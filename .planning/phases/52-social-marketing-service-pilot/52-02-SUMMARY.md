---
phase: 52-social-marketing-service-pilot
plan: "02"
status: partial
completed: false
requirements-completed: []
---

# 52-02 — Trusted draft lineage and outcome projection implemented locally

Native service staging now preserves managedServiceRunId and the selected Buffer channel's platform on the local draft. The public stage operation cannot supply lineage. Tenant-leading indexed reads join only that run's owned drafts, retaining existing approval, publication status and revision ownership.

The outcome projection distinguishes draft/review/publication/unknown states and derives a bounded next action. It does not approve, schedule, publish, cancel a provider queue item or repeat uncertain work. The native outcome test joins a stored run, Buffer publication record and Zernio history, and proves that equal cross-provider ID strings still produce unverified publisher attribution and no linked engagement evidence.

Remaining: current-source hosted acceptance and the actual prepare → exact-content human review → Buffer scheduling/recovery journey. Existing local scripted execution and pure projections do not prove a provider publication or a complete service cycle.
