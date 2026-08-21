---
phase: 25-private-beta-productionization
plan: 05
subsystem: multi-provider-delivery
tags: [DLVR-02, microsoft-graph, gmail, mime, delivery]
requires:
  - phase: 17-05
    provides: tenant-keyed microsoftCalendarTokens and shared Microsoft grant
  - phase: 19-05
    provides: suppression, footer, approval, audit, and delivery terminal semantics
provides:
  - Microsoft Graph MIME send adapter
  - request-level Google/Microsoft delivery dispatcher with legacy-Google fallback
  - shared governed-message preparation used by both provider arms
affects: [delivery, cockpit, pipeline, provider-lifecycle]
tech-stack:
  added: []
  patterns:
    - optional mailProvider on plans and requests; absence means Google for historical rows
    - both provider arms share suppression, attachment, footer, and MIME preparation
key-files:
  created:
    - packages/backend/convex/delivery.ts
    - packages/backend/convex/graph.ts
    - packages/backend/convex/graph.test.ts
  modified:
    - packages/backend/convex/schema.ts
    - packages/backend/convex/gmail.ts
    - packages/backend/convex/deliverApprovedPlan.ts
    - packages/backend/convex/pipeline.ts
    - packages/backend/convex/plans.ts
    - packages/backend/convex/requests.ts
key-decisions:
  - "Do not widen gmailTokens or backfill: Google and Microsoft credentials already coexist in separate tenant-keyed tables."
  - "Centralize unbypassable governance in prepareGovernedMessage so provider arms cannot drift."
patterns-established:
  - "Provider adapters return one suppressed/reauth vocabulary to unchanged terminal callers."
requirements-completed: []
duration: not-recovered
completed: 2026-08-16
---

# Phase 25 Plan 05: Microsoft Delivery Arm Summary

**Approved email requests now route through one Google/Microsoft dispatcher, with identical governed MIME preparation and a legacy-row default to Google.**

## Performance

- **Duration:** Not recoverable from the historical commit
- **Completed:** 2026-08-16T23:42:31+03:00
- **Tasks:** The plan's single production task landed
- **Files modified:** 15 in the implementing commit

## Accomplishments

- Added a Graph `/me/sendMail` adapter that uses the existing shared Microsoft grant and `freshGraphToken` refresh root.
- Added `internal.delivery.send`; both `deliverApprovedPlan` and `pipeline` route through it.
- Added `mailProvider` to plan/request state while preserving historical Gmail behavior when the field is absent.
- Extracted `prepareGovernedMessage` so both providers share suppression, attachment, footer, and MIME rules.

## Task Commits

1. **Graph arm, dispatcher, persistence, caller rewrites, tests, and playbook** — [889a250](https://github.com/Mrjoel97/ProjectX/commit/889a250b75794025ae8fb655a9a4d287fa061d16)

No separate plan-metadata completion commit or original summary was found; this summary is reconstructed from the implementing commit and current tree.

## Files Created/Modified

- [`graph.ts`](../../../packages/backend/convex/graph.ts) — Microsoft Graph send adapter, readiness check, size cap, and failure taxonomy.
- [`delivery.ts`](../../../packages/backend/convex/delivery.ts) — provider switch over the request row.
- [`graph.test.ts`](../../../packages/backend/convex/graph.test.ts) — Graph behavior, MIME parity, legacy fallback, coexistence, and dispatcher assertions.
- [`gmail.ts`](../../../packages/backend/convex/gmail.ts) — shared `prepareGovernedMessage` governance seam.
- [`deliverApprovedPlan.ts`](../../../packages/backend/convex/deliverApprovedPlan.ts) and [`pipeline.ts`](../../../packages/backend/convex/pipeline.ts) — production callers moved to the dispatcher.
- [`schema.ts`](../../../packages/backend/convex/schema.ts) — optional `mailProvider` on plans/requests only.

## Decisions Made

- `gmailTokens` remained byte-unchanged; there is no provider discriminator, new index, or migration.
- Graph checks `microsoftMailReady(scope)` before obtaining a token and returns `mail_scope_missing` for a legacy calendar-only consent.
- An empty Graph 202 response produces `messageId: ""`; the adapter does not invent provider evidence.
- `notifyExternal` remains a Gmail/service-notice path because it is not a user-approved governed plan send.

## Deviations from Plan

### Governance moved to a shared seam

The plan described footer preparation at each provider call site. The implementation centralized the complete governance preparation so the two arms cannot diverge, while retaining byte-parity coverage.

### Token refresh is a direct module helper, not an internal API call

`freshGraphToken` was already a plain module function. `graph.ts` reuses it and never writes `microsoftCalendarTokens` itself.

### Three row writers required updates

`plans.insertPlan`, `requests.submit`, and the cockpit request fan-out all persist provider choice so the dispatcher never silently falls back after the user chose Microsoft.

### Planned `delivery.test.ts` was consolidated

`packages/backend/convex/delivery.test.ts` does not exist. Dispatcher and delivery-contract coverage landed in `graph.test.ts` instead.

## Verification Evidence

The implementing commit records `graph.test.ts` 15/15; focused Graph/Gmail/cockpit/dispatch coverage 220/220; unchanged Gmail tests 42/42; backend typecheck, Biome, and playbook checks; and two reverted mutations. Those commands were **not rerun** during this reconstruction.

## Requirements and Live Gates

- `requirements-completed` is deliberately empty. This summary does not certify DLVR-02.
- No real Outlook delivery or provider-parity live gate was performed by this plan.

## Next Phase Readiness

The provider routing spine is available to lifecycle, threading, continuity, and live-send plans. Provider choice and reconnect UX were handed to Plan 06.

---
*Phase: 25-private-beta-productionization · Plan 05*
*Reconstructed: 2026-08-20*
