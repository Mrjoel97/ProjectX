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

## Deferred at phase close (2026-07-19 human sign-off)

1. **`llmRedaction.test.ts` cockpit.ts audit-tally 1 → 2** — (restating item 1 above for the
   close-out ledger) the scan pins 1 `audit.log` call site in cockpit.ts but 2 exist since
   03.5-05's `reschedulePlan`. Pre-existing red; fold the 1 → 2 bump (ideally + a
   `plan.rescheduled` payload-shape assertion) into the next plan touching that file.
2. **Reply-grounding rebuild (structured/reconciled reply)** — owner-deferred ceiling
   (decision 2026-07-19, plans 05/06). The agent's reply narration is still ungrounded prose,
   not a reconciled/structured reply; plans 05-07 fixed tools + wording + history + structure
   instead. ESCALATE to the full rebuild if narration drift recurs in live use.
3. **`listedCount` saturates at `INBOX_LIST_CAP=50`** — both surfaces (agent sentence + card
   masthead) are consistent today by the shared predicate (03.10-07), but a mailbox with >50
   window messages reads "50 messages". A "50+" display treatment on both surfaces is future
   polish, someday.
4. **Workspace page OOMs the Next DEV server (~4GB heap)** — dev-mode only (Turbopack dev
   memory behavior on the 8GB machine); the prod build is unaffected. Known environment
   ceiling, not a product defect; recycle the dev server when it degrades.
