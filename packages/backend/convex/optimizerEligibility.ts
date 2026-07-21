// IMPR-02 trigger gate — the eligibility check the CI job (and the manual kick) consults
// before it spends any minutes. A THIN adapter (CLAUDE.md §1): it only rolls the per-skill
// feedback negative-rate and reads the config, then hands both to @pikar/core's pure
// classifyBreach — the threshold/floor/cooldown math lives in exactly one unit-testable place.
//
// internalQuery from ./_generated/server is NOT banned by the import guard (optimizerConfig.ts /
// guardrails.ts precedent — an internal-only, non-tenant-facing reader). The CI job runs it via
// `npx convex run optimizerEligibility:optimizerEligibility`.
import { classifyBreach } from "@pikar/core";
import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { DEFAULT_OPTIMIZER_CONFIG } from "./optimizerConfig";

/** Roll the negative-rate over the ACTIVE skill's recent feedback and apply the breach policy.
 *  The roll is per-SKILL (all versions) — the question is "is this skill underperforming",
 *  not "which version". */
export const optimizerEligibility = internalQuery({
  args: { skillName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const skillName = args.skillName ?? "cockpit-agent";

    // ponytail: a simple full-index scan over by_skill for the beta volume. The sample floor +
    // eligibility cadence make an unbounded scan a non-issue at beta scale; a time-windowed
    // variant (filter by createdAt) is the upgrade path when feedback volume grows.
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_skill", (q) => q.eq("skillName", skillName))
      .collect();

    const total = rows.length;
    const downCount = rows.filter((r) => r.rating === "down").length;

    // Default-on-read: a missing row means DORMANT defaults and no cooldown anchor (lastRunAt
    // lives only on a persisted row, read off it directly to keep the type number | undefined).
    const row = await ctx.db.query("optimizerConfig").first();
    const cfg = row ?? DEFAULT_OPTIMIZER_CONFIG;

    const { eligible, reason, negativeRate } = classifyBreach({
      downCount,
      total,
      lastRunAt: row?.lastRunAt,
      nowMs: Date.now(),
      cfg,
    });

    // The CI job logs this; the write-back audit (Plan 05, IMPR-03) carries negativeRate +
    // sampleCount as the triggering evidence.
    return {
      eligible,
      reason,
      negativeRate,
      sampleCount: total,
      threshold: cfg.negativeRateThreshold,
      skillName,
    };
  },
});
