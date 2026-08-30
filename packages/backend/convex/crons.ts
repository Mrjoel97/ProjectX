// WORM (S3 Object Lock) audit export schedule (SC-4).
//
// Daily at 03:00 UTC, run the export action. Phase 1 is a stub (a clean no-op when
// WORM_BUCKET is unset — see worm.ts); Phase 7 (OPSG-03) turns it into the real
// S3 PutObject with COMPLIANCE-mode Object Lock.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("worm-export", { hourUTC: 3, minuteUTC: 0 }, internal.worm.exportAudit, {});
// DLVR-03 proactive half: flag Gmail tokens within ~24h of their 7-day refresh expiry
// into an in-app "Reconnect Gmail" notification before delivery breaks. Logic lives in
// gmailAuth.ts (the gmail DB module), mirroring worm-export → worm.ts.
crons.daily(
  "gmail-token-expiry-scan",
  { hourUTC: 4, minuteUTC: 0 },
  internal.gmailAuth.flagExpiringTokens,
  {},
);
// BEVL-03: the proactive weekly business review. In-app only — no mailbox token (SC#2). Logic
// lives in proactiveReview.ts, mirroring worm-export → worm.ts.
//
// `crons.weekly` is used DELIBERATELY over `crons.cron`. _generated/ai/guidelines.md:287 bans the
// named helpers, but that file is Convex-authored codegen output, not a repo decision: this file
// already runs two `crons.daily` jobs and `weekly` is a fully-typed, non-deprecated public API in
// the pinned convex@1.42.1 (WeeklySchedule / CronJobs.weekly). Do not re-litigate.
// `dayOfWeek` MUST be lowercase — the runtime validator rejects "Monday"; the JSDoc example is wrong.
crons.weekly(
  "proactive-review",
  { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 },
  internal.proactiveReview.runWeekly,
  {},
);
// EXTR-G, the automatic half (15.3-04 repair). Since the extraction watchdog is armed at
// work-start, a row that is enqueued but whose action never reaches its handler body (a deployment
// restart, a dropped job) has no per-attempt clock — so the resumable, batched, self-gating sweep
// runs daily instead of only when an operator types `npx convex run vaultSweep:runSweep`.
// `{ reset: true }` is REQUIRED, not decorative: `sweepPendingExtraction` is a @convex-dev/
// migrations migration and a completed migration NO-OPS on a bare invocation — the 2026-07-18
// stranded-.xlsm lesson, recorded in docs/playbooks/vault.md.
// Each re-queued extraction still self-gates on the kill switch + the daily budget, so a large
// backlog throttles itself rather than draining the window.
crons.daily(
  "vault-pending-extraction-sweep",
  { hourUTC: 5, minuteUTC: 0 },
  internal.vaultSweep.runSweep,
  {
    reset: true,
  },
);
// 25.1-02 (D3 + D4): the stuck-work watchdog. A severed scheduler chain writes no terminal and
// throws nothing, so nothing else will ever notice it — this is the only thing that does. The four
// states it closes and the reasoning behind each threshold live in `reliabilitySweep.ts`.
//
// `interval`, not `daily`, and that is the whole point of the job: the promise is "no non-terminal
// state outlives one sweep interval", and a daily cron would make that promise a DAY of a canvas
// saying "assembling" over a render that died at 09:01. Thirty minutes is the shortest cadence that
// is still free — the sweep does nothing at all unless something is genuinely past its threshold.
//
// `runSweep` re-runs BOTH migrations with `{ reset: true }` internally; that reset is required, not
// decorative (a completed migration no-ops on a bare invocation — the vault-sweep lesson above).
crons.interval("reliability-sweep", { minutes: 30 }, internal.reliabilitySweep.runSweep, {});
// 28.1-07 (BILL-04): the invoice rollup. Stripe has no built-in recurrence for standalone
// invoices, so the schedule is ours.
//
// IT POINTS AT A MUTATION, AND THAT IS THE WHOLE DESIGN — do not "simplify" it to the action.
// Scheduled ACTIONS are at-most-once and are NOT auto-retried, so a cron aimed at `postInvoice`
// would drop an entire billing period in silence: no retry, no error surface, no invoice. `tick`
// is an internalMutation (exactly-once, auto-retried on an internal error) that CLAIMS each due
// period and then schedules the outbound post — atomically with the claim. The reasoning, and the
// separate reason the Stripe idempotency key cannot be the guard, live in `billingRollup.ts`.
// `billingRollup.test.ts` fails if this line ever names `postInvoice`.
//
// 07:00 UTC, after `worm-export` (03), `gmail-token-expiry-scan` (04) and
// `vault-pending-extraction-sweep` (05), so the money path is not competing with the daily sweeps.
crons.daily(
  "billing-invoice-rollup",
  { hourUTC: 7, minuteUTC: 0 },
  internal.billingRollup.tick,
  {},
);
export default crons;
