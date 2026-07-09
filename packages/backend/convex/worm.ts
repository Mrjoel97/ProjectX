"use node";

// WORM (S3 Object Lock) audit export action — Phase 1 STUB (SC-4, WORM half).
//
// The audit table is insert-only inside Convex (CLAUDE.md #3), but Convex has no
// append-only / retention primitive: true immutability lives OUTSIDE Convex as a
// scheduled export of audit rows into an S3 bucket under COMPLIANCE-mode Object
// Lock. Phase 1 ships the schedule (crons.ts), the cursor mechanics (wormCursor.ts),
// and a clean no-op when `WORM_BUCKET` is unset. The real PutObject lands in Phase 7
// (OPSG-03).
//
// This module is "use node" so Phase 7 can import @aws-sdk/client-s3 (a node-only
// SDK). The dep is NOT added yet — ponytail discipline (CLAUDE.md #8): no dependency
// until it is actually used. A "use node" module may contain ONLY actions, so the
// DB-touching cursor query/mutation live in wormCursor.ts and are reached here via
// ctx.runQuery / ctx.runMutation (actions cannot touch ctx.db).
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const SKIP_MSG = "worm export skipped (stub)";

/**
 * Daily WORM export action (scheduled by crons.ts). Phase 1 STUB: reads the cursor
 * and, when `WORM_BUCKET` is unset, logs the skip line and returns WITHOUT advancing
 * the cursor. Advancing on the stub path would mark audit rows as exported when
 * nothing ever reached S3 — a permanent, unrecoverable hole in the compliance log
 * once Phase 7 enables the real export. This is the single most important invariant
 * in this module (covered by worm.test.ts).
 */
export const exportAudit = internalAction({
  args: {},
  handler: async (ctx) => {
    const since = await ctx.runQuery(internal.wormCursor.getCursor, {});

    if (!process.env.WORM_BUCKET) {
      // STUB PATH — deliberately DOES NOT call advanceCursor. See the doc comment.
      console.log(SKIP_MSG);
      return { skipped: true, reason: SKIP_MSG };
    }

    // ---- Phase 7 (OPSG-03): real WORM export. NOT built yet. ----
    const rows = await ctx.runQuery(internal.wormCursor.auditSince, { since });
    // Serialize `rows` to NDJSON and PutObject with COMPLIANCE-mode Object Lock,
    // then — ONLY after a confirmed durable write — advance the cursor:
    //   const maxTs = rows.reduce((m, r) => Math.max(m, r.ts), since);
    //   await ctx.runMutation(internal.wormCursor.advanceCursor, { ts: maxTs });
    // GOTCHAS to verify in Phase 7 (do not assume):
    //   1. The S3 bucket MUST be created with Object Lock ENABLED — it cannot be
    //      enabled after creation; a non-locked bucket = non-immutable exports.
    //   2. PutObject with Object-Lock headers requires a content checksum (AWS
    //      SDK v3 flexible checksums — confirm x-amz-checksum-* is actually sent).
    //   3. AWS creds live in Convex env vars (`npx convex env set`), NEVER Vercel.
    //   4. @aws-sdk/client-s3 gets ADDED in Phase 7 (no dep until used) — that is
    //      why this module carries the "use node" directive.
    void rows;
    throw new Error("WORM real export is not implemented until Phase 7 (OPSG-03)");
  },
});
