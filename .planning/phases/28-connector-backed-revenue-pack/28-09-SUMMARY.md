---
phase: 28-connector-backed-revenue-pack
plan: 09
subsystem: revenue-connectors
tags: [oauth-callbacks, provider-gates, connections-ui, tenant-isolation, revocation]
requires:
  - phase: 28-05..08
    provides: independent HubSpot, QuickBooks, Stripe and PayPal provider helpers
  - phase: 28-22..25
    provides: independent live-evidence judgments, currently parked for all four providers
  - phase: 28-26
    provides: server-owned admission and passed-lane eligibility rules
provides:
  - Three admission-gated OAuth callback routes with no PayPal callback surface
  - One passed-only, tenant-scoped connection projection and connect-start choke point
  - A truthful Connections UI with checking, connect, ready, reauth, failed, disconnected and partial-revoke states
  - Per-provider rollback and lifecycle operations recorded in the connector and onboarding playbooks
affects: [28-10, 28-12, 28-13, 28-14, 28-27, revenue-workflows, profile-connections]
tech-stack:
  added: []
  patterns:
    - Admission permits owner evidence collection; only a passed lane permits tenant discovery and use
    - Provider discovery is derived from passed gates before tenant connection rows are read
    - Loading, local disconnect and residual upstream grants are separate user-visible states
key-files:
  created:
    - packages/backend/convex/connectorConnections.ts
    - packages/backend/convex/connectorConnections.test.ts
    - apps/web/app/(app)/dashboard/profile/connectorRows.ts
    - apps/web/app/(app)/dashboard/profile/connectorRows.test.ts
    - apps/web/app/(app)/dashboard/profile/connections.test.ts
  modified:
    - packages/backend/convex/http.ts
    - packages/backend/convex/providerGates.ts
    - packages/backend/convex/connectorOAuth.ts
    - apps/web/app/(app)/dashboard/profile/ConnectionsPanel.tsx
    - apps/web/app/(app)/dashboard/profile/connections.ts
    - docs/playbooks/revenue-connectors.md
    - docs/playbooks/connector-quickbooks.md
    - docs/playbooks/onboarding.md
key-decisions:
  - Callback admission and tenant capability remain separate axes; a parked admitted lane can collect owner evidence but is invisible to tenants
  - PayPal has no callback route because its connect flow deliberately mints no OAuth state
  - Connect-start authorization is centralized at mintConnectState so a provider cannot bypass it
  - Requirements remain pending until live provider evidence passes; code-only integration does not complete REVN-01..03
patterns-established:
  - Gate before provider configuration so unauthorized callers cannot infer deployment configuration
  - Render only server-projected providers; never duplicate provider eligibility rules in the client
  - State partial revocation before and after disconnect whenever the upstream grant may remain live
requirements-completed: []
duration: continuation 14min; implementation spanned 2026-08-30..2026-08-31
completed: 2026-09-01
---

# Phase 28 Plan 09: Eligible-Provider Callback, Status and Connection Integration Summary

**Admission-gated callbacks, passed-only tenant connection discovery and a lifecycle-complete Connections UI without collapsing four independent provider gates.**

## Performance

- **Continuation duration:** 14 min
- **Verification started:** 2026-08-31T20:54:00Z
- **Completed:** 2026-08-31T21:06:41Z (2026-09-01 local)
- **Tasks:** 3/3
- **Key implementation files:** 13

## Accomplishments

- Registered serialized HubSpot, QuickBooks and Stripe callback routes that gate on admission before provider handling, always sanitize the redirect, and preserve one-time state on a refused route. PayPal correctly exposes no callback.
- Centralized connect-start authorization at the state-minting choke point and made connection discovery a function of passed gates, so parked, failed, expired and missing lanes are absent even when a tenant still has a stored row.
- Wired the server projection into the profile Connections surface with explicit checking, in-flight, ready, reauth, failure, clean-disconnect and residual-upstream-grant states.
- Recorded callback, gate, rollback and partial-revoke semantics in the committed connector/onboarding playbook history without performing any live provider or deployment mutation.

## Task Commits

1. **Task 1: Register sanitized OAuth callbacks and lifecycle projections**
   - `ad12c4e` — callback slice and admission gate, landed early to break the wave-7 dependency deadlock
   - `514a19a` — connect-start choke point and passed-only connection projection
2. **Task 2: Connect the Connections panel without false-ready states**
   - `2b60d89` — initial server-backed connector rows and truthful revoke caveats
   - `acefe1c` — RED tests exposing missing lifecycle distinctions
   - `3bb7546` — GREEN implementation of checking, disconnected and partial-revoke states
3. **Task 3: Update callback and UI operations**
   - `63b4096` — shared/QuickBooks gate operations and owner evidence-window guidance
   - UI lifecycle operations were updated with `2b60d89` and `3bb7546`; callback operations were updated with `ad12c4e`

`417e018` documented the connector-row contract while the row helper was still an island; `2b60d89` superseded that status by wiring the helper into the panel and correcting the playbook in the same commit.

## Files Created/Modified

- `packages/backend/convex/http.ts` — three known-provider callback routes with admission gating and sanitized redirects.
- `packages/backend/convex/connectorConnections.ts` — passed-only tenant projection plus gated connect and disconnect actions.
- `packages/backend/convex/connectorOAuth.ts` — the single connect-start authorization choke point.
- `packages/backend/convex/providerGates.ts` — distinct callback-admission and tenant-capability queries.
- `apps/web/app/(app)/dashboard/profile/ConnectionsPanel.tsx` — server-backed provider rows and accessible operation status.
- `apps/web/app/(app)/dashboard/profile/connectorRows.ts` — pure lifecycle/copy derivation for every rendered row.
- `apps/web/app/(app)/dashboard/profile/connections.test.ts` — plan-named loading and interactive lifecycle guard.
- `docs/playbooks/revenue-connectors.md`, `docs/playbooks/connector-quickbooks.md`, `docs/playbooks/onboarding.md` — committed callback, connect-start, evidence-window, UI and revoke semantics.

## Decisions Made

- Callback admission is deliberately broader than tenant capability. An admitted parked lane must remain reachable to the owner for evidence collection, while ordinary tenants see and use only passed lanes.
- The provider gate is evaluated before provider configuration to avoid exposing whether credentials exist on a deployment.
- PayPal receives no empty or speculative callback route because its deliberately blocked connect flow cannot mint state.
- REVN-01..03 remain pending. All four provider judgments are parked, so this plan completes the unified surface but does not claim live provider capability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Landed the callback slice before wave 7**
- **Found during:** Task 1 dependency analysis
- **Issue:** Wave 7 needed live OAuth evidence to judge each lane, but the callback routes were scheduled only after those judgments.
- **Fix:** Landed the admission-gated callback slice early while retaining passed-only tenant visibility.
- **Files modified:** `http.ts`, `providerGates.ts`, callback tests and connector playbooks.
- **Verification:** Refused callbacks preserve unburned state; admitted parked callbacks reach only the evidence path.
- **Committed in:** `ad12c4e`

**2. [Rule 2 - Missing critical] Closed the ungated connect-start path**
- **Found during:** Task 1 lifecycle integration
- **Issue:** A tenant could call a provider begin-connect action directly after an owner sealed an evidence-gathering row, even though the lane had not passed.
- **Fix:** Centralized three-way start authorization in `mintConnectState`: passed for tenants, admitted/unproven for the owner only, and refused otherwise.
- **Files modified:** `connectorOAuth.ts`, provider auth actions, gate fixtures and tests.
- **Verification:** Connector-plane suites prove refusal before config and owner-only access to admitted unproven lanes.
- **Committed in:** `514a19a`

**3. [Rule 1 - Bug] Distinguished loading and disconnect outcomes in the UI**
- **Found during:** Task 2 follow-up tests
- **Issue:** Loading was rendered as absence, a revoked local row collapsed into connect, and a residual upstream grant did not have its own lifecycle state.
- **Fix:** Added list-level checking plus distinct `disconnected` and `revoke_partial` states and named in-flight operations.
- **Files modified:** `ConnectionsPanel.tsx`, `connections.ts`, `connections.test.ts`, `connectorRows.ts`, `connectorRows.test.ts`, `onboarding.md`.
- **Verification:** Focused web 21/21, core surface 30/30, full web 653/653, full core 1239/1239.
- **Committed in:** `acefe1c`, `3bb7546`

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 missing critical, 1 bug).
**Impact on plan:** The deviations were required to make the planned callback/status surface reachable, secure and truthful; no provider capability was enabled or claimed.

## Verification

| Gate | Result |
|---|---|
| `pnpm --filter @pikar/backend test -- connectorConnections connectorOAuth http` | **66/66**, 3 files, exit 0 |
| Connector-plane breadth (`connectorCallbacks`, `connectorConnections`, `connectorOAuth`, `providerGates`, HubSpot, QuickBooks, Stripe, PayPal) | **367/367**, 8 files, exit 0 |
| `pnpm --filter @pikar/web test -- connectorRows connections` | **21/21**, exit 0 |
| Full `@pikar/web` unit suite | **653/653**, 38 files, exit 0 |
| `pnpm --filter @pikar/core test -- connectionsSurface` | **30/30**, exit 0 |
| Full `@pikar/core` unit suite | **1239/1239**, 43 files, exit 0 |
| `pnpm --filter @pikar/web typecheck` | exit 0 |
| `pnpm --filter @pikar/backend typecheck` | exit 0 |
| `node scripts/check-playbooks.mjs` | silent, exit 0 |
| Biome on 5 profile route files | clean; no fixes applied |
| Biome on 7 backend callback/connection files | clean; no fixes applied |

The initial `connectionsSurface` command was sent to `@pikar/web`, whose Vitest include cannot see `packages/core`; the corrected core-package command passed 30/30. Likewise, package-local `pnpm exec biome` could not resolve the root tool. Running the root Biome executable with the `(app)` directory supplied as the process working directory avoided Windows wrapper parsing and passed. Neither command issue was a source failure.

## Issues Encountered

- Six pre-existing/concurrent dirty paths were preserved. In particular, uncommitted edits in `docs/playbooks/revenue-connectors.md` and `packages/backend/convex/schema.ts` were inspected but not staged, overwritten or claimed by this completion.
- No `gsd-tools state *` command was run because `.planning/STATE.md` explicitly records repeated corruption from those commands.
- No owner-only provider action and no `npx convex run` command was performed.

## User Setup Required

None for this code-only plan. Provider redirect registration, consent, live read/revoke evidence and gate sealing remain owner-controlled work in plans 28-22..25; every lane is still parked.

## Next Phase Readiness

- The unified callback/status/UI surface is complete and safe for downstream revenue workflows.
- Provider-backed capability remains disabled until an individual lane produces live evidence and is sealed `passed`; REVN-01..03 remain pending.
- The next incomplete Phase 28 plan is 28-10 by file order, though later plans have already landed out of order and the roadmap remains the source of truth.

## Self-Check: PASSED

- `28-09-SUMMARY.md` exists and `git diff --check` is clean.
- Task commits `ad12c4e`, `514a19a`, `63b4096`, `2b60d89`, `acefe1c` and `3bb7546` exist.
- Phase 28's section count, 28-09 checkbox and milestone table all read **20/29**.
- REVN-01..03 remain pending; neither `.planning/STATE.md` nor `.planning/REQUIREMENTS.md` was modified.
- Concurrent edits in `docs/playbooks/revenue-connectors.md`, `packages/backend/convex/schema.ts` and `graphify-out/` were not staged or overwritten.

---
*Phase: 28-connector-backed-revenue-pack*
*Completed: 2026-09-01*
