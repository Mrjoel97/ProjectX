// The optimizer kill switch + tunable thresholds (IMPR-02). Mirrors guardrails.ts:
// a SINGLE-row config read with default-on-read, upserted by an owner mutation.
//
// The optimizer ships DORMANT — a missing row reads enabled=false (the locked CONTEXT
// decision). Plan 03 eligibility and Plan 07 CI read DEFAULT_OPTIMIZER_CONFIG for the
// same threshold floor. internalMutation/internalQuery from ./_generated/server are NOT
// banned by the import guard (guardrails.ts / telemetry.ts precedent — no allowlist entry).
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { ownerMutation, ownerQuery } from "./lib/functions";

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

type ConfigPatch = {
  enabled?: boolean;
  negativeRateThreshold?: number;
  minSampleFloor?: number;
  cooldownMs?: number;
  lastRunAt?: number;
};

/** The single upsert, defined ONCE (CLAUDE.md §8): both the internal CI mutation and the
 *  owner-facing ops toggle write through here. Drops undefined args so a partial write
 *  never clobbers a set field; patches the one row or inserts DEFAULT⊕patch; stamps updatedAt. */
async function writeConfig(ctx: MutationCtx, args: ConfigPatch): Promise<void> {
  const patch = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
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
  handler: (ctx, args) => writeConfig(ctx, args),
});

/** Read the optimizer config from the ops page (IMPR-02). OWNER-ONLY (GOVN-01): this row is
 *  GLOBAL, not tenant-scoped, so a tenant wrapper would have disclosed one tenant's view of
 *  every tenant's optimizer state. Default-on-read: a missing row reads DORMANT
 *  (enabled=false), so the kill switch ships OFF. */
export const getOptimizerStatus = ownerQuery({
  args: {},
  handler: (ctx) => getConfig(ctx),
});

/** Flip the optimizer kill switch from the ops page (IMPR-02). OWNER-ONLY (GOVN-01) wrapper
 *  over the shared upsert — maps to the SAME single-row optimizerConfig.enabled the CI job
 *  and eligibility check read, so before this gate any signed-in tenant could disable
 *  self-improvement for the whole deployment. Ships dormant until an owner turns it on. */
export const setOptimizerEnabled = ownerMutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    await writeConfig(ctx, { enabled });
    return { ok: true as const, enabled };
  },
});
