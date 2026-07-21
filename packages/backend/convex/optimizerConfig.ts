// The optimizer kill switch + tunable thresholds (IMPR-02). Mirrors guardrails.ts:
// a SINGLE-row config read with default-on-read, upserted by an owner mutation.
//
// The optimizer ships DORMANT — a missing row reads enabled=false (the locked CONTEXT
// decision). Plan 03 eligibility and Plan 07 CI read DEFAULT_OPTIMIZER_CONFIG for the
// same threshold floor. internalMutation/internalQuery from ./_generated/server are NOT
// banned by the import guard (guardrails.ts / telemetry.ts precedent — no allowlist entry).
import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";

// Default-on-read: a missing/false optimizerConfig row means the optimizer is DORMANT
// (enabled=false, zero seed, no migration). Exported — Plan 03 eligibility and Plan 07 CI
// read the same starting thresholds. Values per 08-CONTEXT (Claude's discretion floor).
export const DEFAULT_OPTIMIZER_CONFIG = {
  enabled: false, // DORMANT at ship — the kill switch is OFF until an owner flips it
  negativeRateThreshold: 0.3, // rolling negative-rate breach point
  minSampleFloor: 20, // one bad rating can't trigger the loop
  cooldownMs: 604800000, // 7d between runs
};

async function getConfig(ctx: QueryCtx) {
  return (await ctx.db.query("optimizerConfig").first()) ?? DEFAULT_OPTIMIZER_CONFIG;
}

/** Read the optimizer config (IMPR-02). Default-on-read: a missing row reads DORMANT
 *  (enabled=false). The CI job and the eligibility check both read through here. */
export const getOptimizerConfig = internalQuery({
  args: {},
  handler: async (ctx) => getConfig(ctx),
});

/** Flip/tune the single-row optimizer config (IMPR-02). Operator/ops-page:
 *  `npx convex run optimizerConfig:setOptimizerConfig '{"enabled":true}'`. Upsert — patch
 *  the one row (merging provided fields over current) if present, else insert the defaults
 *  merged with args. All args optional so the CI job can set only lastRunAt (the cooldown
 *  anchor) without touching the switch. Always stamps updatedAt. */
export const setOptimizerConfig = internalMutation({
  args: {
    enabled: v.optional(v.boolean()),
    negativeRateThreshold: v.optional(v.number()),
    minSampleFloor: v.optional(v.number()),
    cooldownMs: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Drop undefined args so a partial write never clobbers a set field with undefined.
    const patch = Object.fromEntries(
      Object.entries(args).filter(([, value]) => value !== undefined),
    );
    const row = await ctx.db.query("optimizerConfig").first();
    if (row) {
      await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("optimizerConfig", {
        ...DEFAULT_OPTIMIZER_CONFIG,
        ...patch,
        updatedAt: Date.now(),
      });
    }
  },
});
