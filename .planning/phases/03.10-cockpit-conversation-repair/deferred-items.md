# Deferred items — Phase 03.10

Out-of-scope discoveries logged during execution. Not fixed here (scope boundary).

## Pre-existing test reds found during 03.10-01 (2026-07-19)

1. **`llmRedaction.test.ts` > "cockpit content-plane modules emit NO audit/DLQ/telemetry write"**
   — the static scan pins cockpit.ts to EXACTLY 1 `audit.log` call site, but 03.5-05's
   `reschedulePlan` added a second (`plan.rescheduled`, itself refs-only and deliberate).
   The scan's expected count was never bumped from 1 → 2. Fails identically on base
   (cockpit.ts and llmRedaction.test.ts untouched by 03.10-01; failure reproduced in the
   pre-change run). Fix: update the count assertion (and ideally assert the `plan.rescheduled`
   payload shape like the `plan.canceled` block below it) in whichever 03.10/next plan next
   touches llmRedaction.test.ts, or as a standalone chore.
2. **`audit.test.ts` auditCounts red** — long-documented non-regression (STATE.md), unchanged.
3. **`vaultGround.test.ts` / `runCockpitAgent.test.ts` 5000ms timeouts** — the documented
   machine-load flake class; both passed in the post-GREEN full run.
