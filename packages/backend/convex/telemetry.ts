// OPSG-01: write-once per-request telemetry.
//
// The pipeline (plan 02-06) calls `writeTerminal` exactly once, at each terminal
// transition (sent | rejected | expired | failed). The row is built FROM the
// accumulated outcome by @pikar/core's pure `buildTelemetry` — never patched
// incrementally, so it can neither contend on a hot row nor leave a half-written
// row that looks complete (CONTEXT). Domain logic stays in the package; this
// module is the thin Convex adapter (CLAUDE.md §1).
//
// Uses `internalMutation` (not a tenant wrapper): it runs from inside the durable
// workflow, which carries no client identity. `internalMutation` is not banned by
// the import guard, so this file needs no raw-builder allowlist entry.
import { v } from "convex/values";
import { buildTelemetry } from "@pikar/core";
import { internalMutation } from "./_generated/server";

/** The accumulated outcome the terminal transition hands in (mirrors TerminalOutcome). */
const terminalOutcome = v.object({
  reviewOutcome: v.union(
    v.literal("sent"),
    v.literal("rejected"),
    v.literal("expired"),
    v.literal("failed"),
  ),
  durationMs: v.number(),
  decisionCounts: v.record(v.string(), v.number()),
  regenerateCount: v.number(),
  // route + draft + each regenerate; empty when no LLM ran (reject/expire).
  usages: v.array(
    v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      costUsd: v.number(),
    }),
  ),
});

/** Insert the single OPSG-01 telemetry row for a request at its terminal state. */
export const writeTerminal = internalMutation({
  args: {
    requestId: v.id("requests"),
    correlationId: v.string(),
    outcome: terminalOutcome,
  },
  handler: async (ctx, { requestId, correlationId, outcome }) => {
    // Write-once + idempotent: a retried terminal step must not add a second row.
    const existing = await ctx.db
      .query("telemetry")
      .withIndex("by_correlation", (q) => q.eq("correlationId", correlationId))
      .first();
    if (existing) return existing._id;

    const request = await ctx.db.get(requestId);
    if (!request) throw new Error(`telemetry: no request for ${requestId}`);

    const row = buildTelemetry(outcome);
    return await ctx.db.insert("telemetry", {
      tenantId: request.tenantId,
      correlationId,
      requestId,
      // The schema stores these as v.number(); the builder's null means "no LLM ran".
      // ponytail: coalesce null -> 0 at the storage boundary; widen the columns to
      // nullable (a migration) if OPSG-01 ever needs "no LLM" distinct from "zero".
      tokensIn: row.tokensIn ?? 0,
      tokensOut: row.tokensOut ?? 0,
      costUsd: row.costUsd ?? 0,
      durationMs: row.durationMs,
      decisionCounts: row.decisionCounts,
      regenerateCount: row.regenerateCount,
      reviewOutcome: row.reviewOutcome,
      createdAt: Date.now(),
    });
  },
});
