// Integration assertions for the smoke workflows, runnable via `npx convex run`.
// Each throws on failure so `npx convex run` surfaces a failure banner (the node
// smoke scripts poll these, since workflow completion is asynchronous).
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { migrations } from "./migrations";

/** OPSG-04: a failing pipeline produced a deadLetters row + a deadletter.written audit. */
export const assertDeadLetter = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const news = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    const row = news.find((r) => r.correlationId === correlationId);
    if (!row) throw new Error(`no deadLetters row for ${correlationId}`);
    if (!row.error.includes("SMOKE_FAILURE")) {
      throw new Error(`deadLetters error missing SMOKE_FAILURE: ${row.error}`);
    }

    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    if (!audits.some((a) => a.eventType === "deadletter.written")) {
      throw new Error(`no deadletter.written audit event for ${correlationId}`);
    }
    return { ok: true, error: row.error };
  },
});

/** Criterion 4: the review gate took the expected branch (and canceled the timeout). */
export const assertReviewOutcome = internalQuery({
  args: {
    correlationId: v.string(),
    expected: v.union(v.literal("decision"), v.literal("timeout")),
  },
  handler: async (ctx, { correlationId, expected }) => {
    const audits = await ctx.db
      .query("audit")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .collect();
    const seen = audits.map((a) => a.eventType);
    if (!seen.includes(`smoke.reviewgate.${expected}`)) {
      throw new Error(
        `review outcome for ${correlationId}: expected smoke.reviewgate.${expected}, saw [${seen.join(", ")}]`,
      );
    }

    // Decision path must have canceled + cleared the scheduled timeout.
    if (expected === "decision") {
      const pending = await ctx.db.query("pendingTimeouts").collect();
      if (pending.some((r) => r.correlationId === correlationId)) {
        throw new Error(`pendingTimeouts row for ${correlationId} survived — timeout not canceled`);
      }
    }
    return { ok: true };
  },
});

/**
 * 02-06 full spine: the pipeline reached a delivery outcome. No Gmail token for
 * tenant "smoke" → `awaiting_reauth` (the automatable half of DLVR-01/03); a token
 * present → `sent` with exactly one `sent` telemetry row.
 */
export const assertPipelineDelivered = internalQuery({
  args: { correlationId: v.string() },
  handler: async (ctx, { correlationId }) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "awaiting_reauth" && req.status !== "sent") {
      throw new Error(`pipeline ${correlationId} at "${req.status}", expected awaiting_reauth|sent`);
    }
    if (req.status === "sent") {
      const tel = await ctx.db
        .query("telemetry")
        .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
        .first();
      if (!tel || tel.reviewOutcome !== "sent") {
        throw new Error(`no sent telemetry row for ${correlationId}`);
      }
    }
    return { ok: true, status: req.status };
  },
});

/**
 * AGNT-03 + OPSG-01: a mis-route dead-lettered under the DISTINCT reason AND the
 * request reached the `failed` terminal (status=failed + one failed telemetry row) —
 * proving it no longer hangs at "routing".
 */
export const assertDeadLetterReason = internalQuery({
  args: { correlationId: v.string(), reason: v.string() },
  handler: async (ctx, { correlationId, reason }) => {
    const news = await ctx.db
      .query("deadLetters")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    const row = news.find((r) => r.correlationId === correlationId);
    if (!row) throw new Error(`no new deadLetters row for ${correlationId}`);
    if (!row.error.includes(reason)) {
      throw new Error(`deadLetters reason for ${correlationId}: "${row.error}" !~ "${reason}"`);
    }

    const req = await ctx.db
      .query("requests")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!req) throw new Error(`no request for ${correlationId}`);
    if (req.status !== "failed") {
      throw new Error(`request ${correlationId} at "${req.status}", expected failed (no-stuck-status)`);
    }

    const tel = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (!tel || tel.reviewOutcome !== "failed") {
      throw new Error(`no failed telemetry row for ${correlationId}`);
    }
    return { ok: true, reason: row.error };
  },
});

/** OPSG-06: the first migration ran and recorded a completed (success) state. */
export const assertMigrationRan = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [status] = await migrations.getStatus(ctx, {
      migrations: ["migrations:backfillRequestDefaults"],
      limit: 1,
    });
    if (!status) {
      throw new Error("backfillRequestDefaults has no recorded state — the migration never ran");
    }
    if (status.state !== "success" || !status.isDone) {
      throw new Error(
        `migration not complete: state=${status.state} isDone=${status.isDone} processed=${status.processed}`,
      );
    }
    return { ok: true, name: status.name, processed: status.processed, state: status.state };
  },
});
