---
phase: 25-private-beta-productionization
plan: 17
status: complete
completed: 2026-09-21
requirements: [BETA-01, BETA-03]
---

# 25-17 — Capability-backed product claims

## Delivered

- Added a closed typed capability vocabulary and 15 source-anchored claims covering invitation,
  human approval, append-only audit, Gmail/Outlook posture, onboarding, legal readiness, and every
  marketing channel state.
- Added a source checker over 10 named product, legal, onboarding/backend, marketing, and playbook
  sources. Non-vacuity floors make deleted inventory fail rather than silently reduce coverage.
- Added mutation tests that reject removed invite language, positive social-publishing language,
  false legal-completion wording, and deleted claim entries.
- Registered the checker in the hand-maintained free-gate allowlist, exposed the same command in
  `package.json`, and made normal CI call it.
- Preserved legal placeholders and the exact provisional entity name `pikar-ai`; registered entity
  facts remain pending and therefore cannot produce a readiness claim.

## Verification

- Claim checker: **15 claims across 10 sources passed**.
- Claim mutation suite: **passed**.
- Core capability/marketing tests are included in the **45/45** passing core set.
- Complete offline registry: **23/23 gates green**.
- Web production build and TypeScript: **passed**.

## Evidence ceiling

This checker enforces repository copy against named code/config contracts. It does not prove a
deployment, provider approval, legal formation, owner acceptance, live delivery, or Wave 8 release.
