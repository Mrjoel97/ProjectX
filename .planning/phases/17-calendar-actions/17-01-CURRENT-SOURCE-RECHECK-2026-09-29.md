# Plan 17-01 current-source recheck — 2026-09-29

**Baseline:** `ee22ddd` on `step0-evidence-integrity`. This is repository/offline evidence only. The Wave 2 exit gate has not passed, so this note does not close the Wave 3 ledger row or certify a deployment, provider call, live observation, owner acceptance, or external enablement.

The historical [17-01 summary](17-01-SUMMARY.md) records the four mutation checks, including the `checkAvailability` VERB deletion observed RED and restored. Current source retains the Stage-1 contract:

- `packages/backend/convex/schema.ts` contains both `agentSteps.tool` literals, six staged-event fields (`eventTitle`, `eventStartMs`, `eventDurationMs`, `eventTz`, `calendarEventId`, `calendarRunId`), `plans.by_calendar_run`, and `calendarFixtures`.
- `packages/backend/convex/plans.ts` permits the four model-staged fields in `patchPlan`, excludes the provider event/run refs, and clears all six in `resetPlan`.
- `packages/core/src/actionType.ts` retains `calendar_event` and maps it to `externalAction`; `packages/backend/convex/cockpit.ts` independently binds the same arm. The pure calendar domain remains in `packages/core/src/calendar.ts`.
- `apps/web/app/(app)/dashboard/workspace/cards.tsx` has an early `calendar_event` PlanCard branch before email chrome and human VERB entries for `checkAvailability`, `proposeCalendarEvent`, and the pre-existing `replyToMessage` gap. `packages/backend/convex/traceParity.test.ts` tests literal/VERB parity both ways.

The plan's **“two-member `plans.kind` union”** was correct at Stage 1 (`memo | calendar_event`) but is not a current cardinality requirement. Subsequent phases deliberately added `media`, `crm_write`, `finance_write`, and `calendar_manage` while retaining `calendar_event`; reducing the union to two now would break later accepted work.

Current commands, exit 0:

```text
pnpm --filter @pikar/core test calendar actionType emailIntent
  4 files, 113 tests passed
pnpm --filter @pikar/backend test traceParity
  1 file, 7 tests passed
```

**Disposition:** Current implementation and offline test evidence for Plan 17-01's repository objective is present. Keep the closure row open until its Wave 2 entry gate and the broader Wave 3 closure conditions are met. Do not project this local check onto ACTN-02 as a whole.
