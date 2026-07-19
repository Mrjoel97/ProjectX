# Deferred items — Phase 03.11 Inbox Reply

Out-of-scope discoveries logged during execution (not fixed here — the scope boundary
rule: only auto-fix issues DIRECTLY caused by the current task's changes).

## From 03.11-02 (reply-drafter skill + toolless draftReply)

- **`llmRedaction.test.ts` › "cockpit content-plane modules emit NO audit/DLQ/telemetry write"
  is RED (pre-existing).** The scan asserts `cockpit.ts` has exactly ONE `audit.log` call
  site but finds TWO (`expected [...] to have a length of 1 but got 2`). Reproduces on the
  tree with all of this plan's changes stashed — 03.11-02 touched neither `cockpit.ts` nor
  the scan. Almost certainly landed with 03.10's `reschedulePlan` (which writes a
  `plan.rescheduled` audit — a second content-plane audit site the count-1 scan predates).
  Fix owner: whoever revisits the cockpit content-plane redaction scans — update the
  expected count to 2 (and confirm the second payload is refs-only) OR reconcile the two
  audit sites. The other 26 llmRedaction scans (including all the toolless-ingestion ones)
  are green.
