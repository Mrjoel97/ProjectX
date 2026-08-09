"use node";

// WORM (S3 Object Lock) audit export action — OPSG-03 (SC-4, WORM half).
//
// The audit table is insert-only inside Convex (CLAUDE.md #3), but Convex has no
// append-only / retention primitive: true immutability lives OUTSIDE Convex as a
// scheduled export of audit rows into an S3 bucket under COMPLIANCE-mode Object
// Lock. Phase 1 shipped the schedule (crons.ts), the cursor mechanics (wormCursor.ts),
// and a clean no-op when `WORM_BUCKET` is unset. Phase 7 makes the export REAL.
//
// This module is "use node" so it can import @aws-sdk/client-s3 (a node-only SDK).
// A "use node" module may contain ONLY actions, so the DB-touching cursor
// query/mutation live in wormCursor.ts and are reached here via ctx.runQuery /
// ctx.runMutation (actions cannot touch ctx.db). The pure serialization/key/retention
// math lives in @pikar/core (CLAUDE.md §1).
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { retainUntilDate, serializeAuditNdjson, wormObjectKey } from "@pikar/core";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const SKIP_MSG = "worm export skipped (stub)";

// One client per module instance, region from the Convex deployment env (NEVER Vercel).
// Credentials are picked up from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in the env.
const s3 = new S3Client({ region: process.env.AWS_REGION });

/**
 * Daily WORM export action (scheduled by crons.ts).
 *
 * When `WORM_BUCKET` is unset it takes the STUB-SKIP path: logs the skip line and
 * returns WITHOUT advancing the cursor. When set, it exports the incremental audit
 * window (rows past the cursor) to S3 as NDJSON under COMPLIANCE-mode Object Lock
 * with a SHA256 checksum, then — ONLY after a confirmed durable PutObject — advances
 * the cursor. On ANY throw the cursor stays put and the next cron retries the SAME
 * window (deterministic key ⇒ byte-identical body ⇒ idempotent overwrite).
 *
 * Advancing before a durable write would mark audit rows as exported when nothing
 * reached S3 — a permanent, unrecoverable hole in the compliance log. That is the
 * single most important invariant in this module (covered by worm.test.ts).
 *
 * EXPORT ONLY (owner ruling, 07-CONTEXT): the hot Convex `audit` table is never
 * deleted/swept here — SC#4's sweep clause is deferred.
 */
export const exportAudit = internalAction({
  args: {},
  // Explicit return type breaks Convex's circular type inference (the handler's
  // inferred return would flow back through `internal` into itself — Pitfall 1).
  handler: async (
    ctx,
  ): Promise<
    { skipped: true; reason: string } | { exported: number; maxTs?: number; key?: string }
  > => {
    const since = await ctx.runQuery(internal.wormCursor.getCursor, {});

    if (!process.env.WORM_BUCKET) {
      // STUB PATH — deliberately DOES NOT call advanceCursor. See the doc comment.
      console.log(SKIP_MSG);
      return { skipped: true, reason: SKIP_MSG };
    }

    const rows = await ctx.runQuery(internal.wormCursor.auditSince, { since });
    if (rows.length === 0) {
      // Empty window — nothing to archive. No PutObject, no advance (advancing on an
      // empty window is a no-op here, but skipping the S3 round-trip is the point).
      return { exported: 0 };
    }

    const ndjson = serializeAuditNdjson(rows);
    const maxTs = rows.reduce((m, r) => Math.max(m, r.ts), since);

    // Durable, immutable write. Object Lock retention REQUIRES a content checksum
    // (AWS SDK v3 flexible checksums), and COMPLIANCE mode MUST be paired with a
    // retain-until date. If this rejects, the error propagates and the cursor is
    // NOT advanced below — the cron owns retry/logging.
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.WORM_BUCKET,
        Key: wormObjectKey(since, maxTs),
        Body: ndjson,
        ChecksumAlgorithm: "SHA256",
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: retainUntilDate(Date.now()),
      }),
    );

    // Reached ONLY after the PutObject promise resolves (a confirmed durable write).
    await ctx.runMutation(internal.wormCursor.advanceCursor, { ts: maxTs });
    return { exported: rows.length, maxTs, key: wormObjectKey(since, maxTs) };
  },
});
