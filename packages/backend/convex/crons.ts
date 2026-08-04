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
export default crons;
