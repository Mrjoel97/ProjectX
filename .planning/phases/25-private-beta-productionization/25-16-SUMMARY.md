---
phase: 25-private-beta-productionization
plan: 16
status: complete
completed: 2026-09-21
requirements: [BETA-01, BETA-02, BETA-05]
---

# 25-16 — Admission and isolation proof

## Delivered

- Extended the behavioral A/B isolation matrix through production tenant APIs and bounded export.
- Added direct HTTP-router capability tests without weakening public bearer semantics: a valid
  funnel or unsubscribe bearer works for its intended anonymous/other-tenant holder while changing
  only the token-owning tenant's bounded state.
- Added explicit unsupported-method guards for unsubscribe routes and retained the internal bearer
  boundary for SkillOpt.
- Added the opt-in owner/non-owner Admin browser spec and updated authorization/admission playbooks.

## Verification

- Invites + isolation + HTTP boundary + export + erasure: **132/132 passed**.
- Controlled local Admin browser run: **2/2 passed** (dual-identity setup and the owner/non-owner
  boundary, including invite minting and cleanup).
- Admin presentation regression tests: **12/12 passed**.
- Playwright discovery: **3 tests in 3 files** (setup, Admin boundary, first-send journey).
- Web production build/TypeScript: **passed**.
- Complete offline registry: **23/23 gates green**.

## Scope boundary

The controlled local admission/isolation plan is complete. Hosted identity, provider, deployment,
paid, legal, founder, and Wave 8 qualification remain separate gates and are not inferred here.
