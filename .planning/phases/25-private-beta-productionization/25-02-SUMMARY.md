---
phase: 25-private-beta-productionization
plan: 02
subsystem: beta-admission-ui
tags: [BETA-01, auth, invites, owner-admin, nextjs]
requires:
  - phase: 25-01
    provides: invite admission, waitlist, preflight, and owner-gated approval APIs
provides:
  - signup invite/preflight and waitlist UI on the existing public route
  - owner-mounted invite approval surface with a link to the existing operations page
  - component/source-level proof that owner controls do not mount for loading or non-owner states
affects: [beta-admission, authorization, hosted-oauth]
tech-stack:
  added: []
  patterns:
    - owner authorization controls whether the client view mounts, not merely whether it is visible
    - provider buttons follow deployment runtime capability instead of a duplicated public build flag
key-files:
  created:
    - apps/web/app/(app)/admin/AdminView.tsx
    - apps/web/app/(app)/admin/adminPresentation.test.ts
    - apps/web/app/(app)/admin/page.tsx
  modified:
    - apps/web/app/(auth)/signup/page.tsx
    - apps/web/app/(auth)/auth.css
    - packages/backend/convex/invites.ts
    - docs/playbooks/beta-admission.md
    - docs/playbooks/authorization.md
key-decisions:
  - "Link to the existing /ops surface rather than copying its eleven backend integrations into /admin."
  - "Record component/source proof honestly; the planned two-identity Playwright proof did not land."
patterns-established:
  - "Owner mount gate: AdminView owns protected hooks and is never mounted until owner.viewer confirms authority."
requirements-completed: []
duration: not-recovered
completed: 2026-08-16
---

# Phase 25 Plan 02: Beta Admission UI Summary

**One public signup route now serves invite redemption and waitlist entry, while `/admin` mounts invite controls only for a confirmed owner.**

## Performance

- **Duration:** Not recoverable from the historical commit
- **Completed:** 2026-08-16T23:23:42+03:00
- **Tasks:** Task 1 and Task 3 landed; Task 2 landed with component-level proof but not its browser criterion
- **Files modified:** 9 in the implementing commit

## Accomplishments

- `/signup` accepts a visible, editable invite code, performs preflight, and falls back to the waitlist on the same public route.
- `/admin` lets a confirmed owner approve a pending request, copy the signup link, and navigate to the existing `/ops` controls.
- The deployment reports which OAuth providers are actually configured, avoiding a Microsoft button on deployments that cannot finish the flow.

## Task Commits

1. **Signup, owner admin, presentation proof, and playbooks** — [ec32285](https://github.com/Mrjoel97/ProjectX/commit/ec32285db37bea6f0b0b2db08e91e9bc557c7f56)
2. **Follow-up: surface OAuth start failures on signup/signin** — [c2dac7d](https://github.com/Mrjoel97/ProjectX/commit/c2dac7dcc702f19f38da4932af81e22b60d557f1)

No separate plan-metadata completion commit or original summary was found; this summary is reconstructed from the commits and current tree.

## Files Created/Modified

- [`signup/page.tsx`](../../../apps/web/app/(auth)/signup/page.tsx) — invite, waitlist, provider availability, and OAuth-start error UI.
- [`admin/page.tsx`](../../../apps/web/app/(app)/admin/page.tsx) — owner/loading/non-owner mount gate.
- [`AdminView.tsx`](../../../apps/web/app/(app)/admin/AdminView.tsx) — invite review/approval and copied-link state.
- [`adminPresentation.test.ts`](../../../apps/web/app/(app)/admin/adminPresentation.test.ts) — component/source assertions for the protected mount boundary.
- [`invites.ts`](../../../packages/backend/convex/invites.ts) — public provider-capability projection consumed by signup.
- [`beta-admission.md`](../../../docs/playbooks/beta-admission.md) and [`authorization.md`](../../../docs/playbooks/authorization.md) — shipped semantics and evidence ceiling.

## Decisions Made

- Microsoft signup is rendered only when the corresponding hosted credentials exist.
- `/ops` remains canonical because it is materially larger than the three-control description in the plan; `/admin` links to it.
- The owner check is a mount gate so protected client hooks do not subscribe before authority is known.

## Deviations from Plan

### Presentation evidence substituted for the planned e2e

The planned `apps/web/e2e/admin.spec.ts` does not exist. The repository's Playwright setup had one authenticated storage state and no controlled non-owner identity, and the onboarding redirect could have produced a false-positive absence result. The landed substitute, `adminPresentation.test.ts`, was recorded by the commit as 7/7 and mutation-checked, but it is not browser evidence.

### Admin links to `/ops` rather than consolidating it

The existing operations view owns eleven integrations, so copying only the three optimizer controls would have fragmented the compliance surface.

### Follow-up error handling has a narrower ceiling

`c2dac7d` reports errors raised while starting OAuth. Callback failures that return a server-side 500 still do not return to this page and remain a hosted-log investigation.

## Verification Evidence

The implementing commit records `adminPresentation` 7/7, `isolation + invites` 62/62, web typecheck, Next build, Biome, and playbook checks as passing. Those commands were **not rerun** during this reconstruction.

## Requirements and Live Gates

- `requirements-completed` is deliberately empty. This summary does not certify BETA-01.
- The two-identity browser gate and real hosted OAuth round trip were not established by this plan.

## Next Phase Readiness

The UI consumes the Plan 01 trust boundary and is ready for hosted-provider verification. Browser-level owner/non-owner evidence remains open.

---
*Phase: 25-private-beta-productionization · Plan 02*
*Reconstructed: 2026-08-20*
