---
phase: 25-private-beta-productionization
plan: 06
subsystem: mailbox-provider-lifecycle-ui
tags: [DLVR-02, microsoft, gmail, reauth, disconnect]
requires:
  - phase: 17-06
    provides: one shared Microsoft OAuth grant, callback, token row, and reconnect surface
  - phase: 25-05
    provides: request-level provider dispatcher and Microsoft send arm
provides:
  - per-plan mailbox selection gated on Microsoft mailReady
  - provider-correct reactive reauthentication copy
  - owner-approved honest local-only Microsoft disconnect posture and correct remote-removal links
affects: [cockpit, connections, provider-revocation, live-mail]
tech-stack:
  added: []
  patterns:
    - choose a provider per proposed plan; never store one active provider for a tenant
    - separate proactive expiry copy from reactive held-send copy
key-files:
  created:
    - apps/web/app/(app)/dashboard/workspace/mailboxPicker.test.ts
    - apps/web/app/(app)/_components/reconnectBanner.test.ts
    - .planning/phases/25-private-beta-productionization/25-MAIL-MIGRATION-EVIDENCE.md
  modified:
    - apps/web/app/(app)/dashboard/workspace/cards.tsx
    - apps/web/app/(app)/_components/ReconnectBanner.tsx
    - apps/web/app/(app)/_components/DisconnectMicrosoft.tsx
    - packages/backend/convex/plans.ts
    - packages/backend/convex/microsoftAuth.test.ts
key-decisions:
  - "Owner selected posture A: local Microsoft disconnect plus truthful instructions for separate remote consent removal."
  - "Microsoft becomes selectable only when mailReady is true, not merely when a shared grant row is connected."
patterns-established:
  - "Legacy absent mailProvider defaults to Google consistently in delivery and reconnect presentation."
requirements-completed: []
duration: not-recovered
completed: 2026-08-18
---

# Phase 25 Plan 06: Mailbox Choice and Disconnect Posture Summary

**Users can choose Google or a mail-capable Microsoft grant per proposed plan, and held sends now direct them to the provider that actually needs reauthentication.**

## Performance

- **Duration:** Not recoverable from the historical commits
- **Implementation:** 2026-08-16T23:58:19+03:00
- **Owner posture/copy correction:** 2026-08-18T02:08:33+03:00
- **Tasks:** Tasks 1 and 3 landed; Task 2 was prepared first and later owner-decided

## Accomplishments

- Added per-plan mailbox choice with Microsoft gated on `mailReady`, and a tenant-scoped setter that freezes choice after proposal.
- Partitioned held-send reconnect lines by `mailProvider`; a Microsoft hold no longer points at Gmail.
- Recorded and accepted local-only Microsoft disconnect posture A, then corrected the UI to link both personal and work/school consent-management portals.
- Added source/unit coverage proving no second Microsoft callback or consent surface was introduced.

## Task Commits

1. **Mailbox choice, reauth fix, tests, and decision packet** — [6ec1ccc](https://github.com/Mrjoel97/ProjectX/commit/6ec1ccce6b1e3751b98d57e757f2bd49b9a1dee2)
2. **Owner posture A and supported disconnect links** — [36f43b8](https://github.com/Mrjoel97/ProjectX/commit/36f43b81601aad651149e2cde34a793163f2bc44)

No separate plan-metadata completion commit or original summary was found; this summary is reconstructed from the commits and current tree.

## Files Created/Modified

- [`cards.tsx`](../../../apps/web/app/(app)/dashboard/workspace/cards.tsx) — provider options and plan choice.
- [`mailboxPicker.test.ts`](../../../apps/web/app/(app)/dashboard/workspace/mailboxPicker.test.ts) — `mailReady` selection contract.
- [`ReconnectBanner.tsx`](../../../apps/web/app/(app)/_components/ReconnectBanner.tsx) and [`reconnectBanner.test.ts`](../../../apps/web/app/(app)/_components/reconnectBanner.test.ts) — provider-correct held-send messages.
- [`plans.ts`](../../../packages/backend/convex/plans.ts) — `setPlanMailProvider` ownership/status guard.
- [`DisconnectMicrosoft.tsx`](../../../apps/web/app/(app)/_components/DisconnectMicrosoft.tsx) — explicit local-only result and both supported removal destinations.
- [`25-MAIL-MIGRATION-EVIDENCE.md`](./25-MAIL-MIGRATION-EVIDENCE.md) — evidence and owner decision record.

## Decisions Made

- No second Microsoft token row, OAuth callback, or consent page was added; Plan 17-06 remains the single connection lifecycle.
- Microsoft refresh failure semantics are distinct from Google's testing-mode seven-day warning.
- Owner accepted honest local disconnect because Entra offers no narrow client-callable per-app refresh-grant revocation equivalent; broader session invalidation would affect unrelated apps and excludes personal accounts.

## Deviations from Plan

### The mail readiness query already existed

`microsoftStatus.mailReady` had landed in Plan 17-06. This plan added proof and consumers rather than duplicating the surface.

### A provider-specific reconnect bug was fixed

Plan 25-05 made Microsoft capable of producing `awaiting_reauth`, exposing a banner that still assumed every hold was Gmail. The fix added provider-specific hold copy.

### The planned browser e2e is absent

`apps/web/e2e/mail-provider.spec.ts` does not exist. Coexistence, selection, and reconnect behavior were covered through pure/source/backend tests, not a real browser or provider account.

### Connection pages remain separate

`/connect-gmail` and `/connect-microsoft` were not merged; that UX decision stayed outside this plan.

## Verification Evidence

`6ec1ccc` records mailbox picker 7/7, reconnect banner 11/11, web 424 tests, focused backend 142/142, both typechecks, Biome, and playbook checks. `36f43b8` records connection-surface 30/30, core 1032/1032, web 432/432, web typecheck, and playbook checks. These commands were **not rerun** during this reconstruction.

## Requirements and Live Gates

- `requirements-completed` is deliberately empty. This summary does not certify DLVR-02.
- GOVN-03 provider-revocation parity remains open by design.
- No browser coexistence test or real Google/Microsoft provider lifecycle was performed by this plan.

## Next Phase Readiness

Provider-aware choice and recovery are ready for live delivery gates, with the revocation asymmetry visible rather than hidden.

---
*Phase: 25-private-beta-productionization · Plan 06*
*Reconstructed: 2026-08-20*
