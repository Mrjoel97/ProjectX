---
phase: 25-private-beta-productionization
plan: 04
subsystem: onboarding-projection
tags: [BETA-03, onboarding, first-send, convex]
requires:
  - phase: 11
    provides: conversational onboarding and committed tenant profile
  - phase: 15.1
    provides: tier-derived onboarding completion contract
provides:
  - authenticated stateless first-send eligibility and recipient projection
  - regression tests for own-address derivation, thin-profile eligibility, and zero writes
affects: [onboarding, cockpit, first-delivery]
tech-stack:
  added: []
  patterns:
    - derive onboarding follow-up eligibility from existing rows without progress state
    - accept no recipient argument; derive the address from the authenticated user
key-files:
  created: []
  modified:
    - packages/backend/convex/onboarding.ts
    - packages/backend/convex/onboarding.test.ts
    - docs/playbooks/onboarding.md
key-decisions:
  - "The first-send offer is a read-only projection, not a checklist row or completion flag."
  - "Missing users.email fails closed with no_address; emailVerified is reported rather than used as an invented requirement."
patterns-established:
  - "A self-send projection takes no client recipient or tenant argument."
requirements-completed: []
duration: not-recovered
completed: 2026-08-17
---

# Phase 25 Plan 04: First-Send Projection Summary

**The backend can now derive whether an onboarded tenant is eligible for a first self-send and returns only the authenticated user's own address, without writing onboarding progress.**

## Performance

- **Duration:** Not recoverable from the historical commit
- **Completed:** 2026-08-17T00:04:08+03:00
- **Tasks:** Backend portion of Task 1 landed; remaining Task 1 UI plus Tasks 2–3 did not
- **Files modified:** 3 in the implementing commit

## Accomplishments

- Added `onboarding.firstSendOffer` as a no-argument tenant query.
- Proved the offer remains ineligible before onboarding completion, becomes eligible afterward, derives each tenant's own email, and performs no writes.
- Preserved `missingSlots`, `canComplete`, `converse.done`, and `saveFacts → commitProfile` semantics.

## Task Commits

1. **Authenticated first-send projection and regression tests** — [e802583](https://github.com/Mrjoel97/ProjectX/commit/e802583d4ab7f2c7733955ebe391a628ed9fe92e)

No separate plan-metadata completion commit or original summary was found; this summary is reconstructed from the implementing commit and current tree.

## Files Created/Modified

- [`onboarding.ts`](../../../packages/backend/convex/onboarding.ts) — `firstSendOffer` eligibility/recipient projection.
- [`onboarding.test.ts`](../../../packages/backend/convex/onboarding.test.ts) — identity, completion, thin-profile, no-address, invalid-argument, and no-write cases.
- [`onboarding.md`](../../../docs/playbooks/onboarding.md) — projection contract and corrections to prior onboarding documentation.

## Decisions Made

- No onboarding-progress table, first-send flag, or persistent checklist was added.
- `users.email` absence returns the named `no_address` ineligibility result; no unsafe fallback is invented.
- A password user's self-asserted address is allowed for a send to that same account address, while `emailVerified` remains visible to callers.

## Deviations from Plan

### Only the backend projection landed

The implementing commit states that the cockpit opener UI and inline postal/mailbox recovery were not done. Current source still refuses `no_postal_address` at `cockpit.executePlan`; it does not expose the planned inline textarea/retry seam from this plan.

### The planned browser path is absent

`apps/web/e2e/onboarding-first-send.spec.ts` does not exist. No fixture-backed PLAN → Approve → delivered path was established by this plan.

### The plan's thin-profile vocabulary was stale

The implementation recorded that `persona` is not accepted by the profile input/runtime validator. Completion still depends on the tier row and required slots already defined by the existing onboarding contract.

## Verification Evidence

The implementing commit records `onboarding.test.ts` 32/32, backend typecheck, Biome, playbook checks, and two reverted mutation checks as passing. Those commands were **not rerun** during this reconstruction.

## Requirements and Live Gates

- `requirements-completed` is deliberately empty. This summary does not certify BETA-03.
- There is no cockpit offer, inline prerequisite recovery, browser e2e, wall-clock measurement, or real delivered self-email evidence here.

## Next Phase Readiness

The stateless projection is available for a future cockpit attach point. The user-visible first-send flow remains unfinished.

---
*Phase: 25-private-beta-productionization · Plan 04*
*Reconstructed: 2026-08-20*
