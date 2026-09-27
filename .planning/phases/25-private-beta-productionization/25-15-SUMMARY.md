---
phase: 25-private-beta-productionization
plan: 15
status: complete
completed: 2026-09-21
requirements: [BETA-03]
---

# 25-15 — Journey measurement and result history

## Delivered

- Added the tenant-owned, refs-only `betaJourneyEvents` table with tenant-leading chronological
  and idempotency indexes.
- Added one idempotent append path and wired successful admission, onboarding completion, first
  offer shown/started, postal prerequisite recovery, plan/evaluation decisions, all delivery
  terminal classes, browser session start, and return observation.
- Added bounded chronological result history to Approvals. Its DTO contains only typed status and
  approval/plan/request/audit references; recipient, subject, body, URLs, prompts, and browser
  metadata are structurally absent.
- Added pure core reducers for admission-to-first-result, post-onboarding latency, completion,
  week-two return, and cost per active user. Denominators and unavailable states are explicit.
- Added a 90-day-bounded tenant metrics query joined to settled spend coverage. Missing coverage or
  active users remains unavailable; a row-limit overflow fails to a labelled unavailable state.
- Classified journey rows as tenant-owned so the existing export and erasure walkers include them.

## Verification

- Backend journey/cockpit tests: **89/89 passed**.
- Admission/isolation/export/erasure set: **132/132 passed**.
- Core metric/claim/classification set: **45/45 passed**.
- Web result-history/first-send set: **10/10 passed**.
- Web production build and TypeScript: **passed**.
- Complete offline registry: **23/23 gates green**.

## Evidence ceiling

This closes the repository-controlled implementation in Plan 25-15. It does not substitute local
metrics for the five controlled internal journeys, hosted observation, owner acceptance, provider
consent, or Wave 8 exact-release qualification.
