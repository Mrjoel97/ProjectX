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
crons.daily("gmail-token-expiry-scan", { hourUTC: 4, minuteUTC: 0 }, internal.gmailAuth.flagExpiringTokens, {});
export default crons;
