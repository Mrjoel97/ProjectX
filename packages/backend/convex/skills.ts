// Versioned skill/prompt registry adapter (SkillOpt readiness).
//
// Thin adapter over the `skills` table: pure contract lives in @pikar/contracts.
// This module is on plan 02's internal-builder allow-list (it intentionally uses
// internalMutation directly). Skill bodies are IMMUTABLE per version — a change
// is a new version row plus an activateSkill flip; body/name/version are never
// patched (only `status` and `evidence` may change).

import { v } from "convex/values";
import {
  EXECUTIVE_AGENT_CLASSIFIER_SKILL,
  NO_ACTIVE_SKILL_ERROR,
  NO_SUCH_SKILL_VERSION_ERROR,
  type LoadedSkill,
} from "@pikar/contracts/skill";
import { executiveAgentClassifierSkillBody } from "@pikar/contracts/skills/executiveAgentClassifier";
import { internalMutation, type QueryCtx } from "./_generated/server";

/**
 * Load the currently active skill by name. Reads the single status==="active"
 * row via by_name_status and FAILS CLOSED (throws) when none exists. Callers
 * must record { name, version } in telemetry/audit for every use (Phase 8).
 */
export async function loadSkill(
  ctx: QueryCtx,
  name: string,
): Promise<LoadedSkill> {
  const row = await ctx.db
    .query("skills")
    .withIndex("by_name_status", (q) =>
      q.eq("name", name).eq("status", "active"),
    )
    .unique();

  if (row === null) {
    throw new Error(`${NO_ACTIVE_SKILL_ERROR}: ${name}`);
  }

  return { body: row.body, version: row.version, skillId: row._id };
}

/**
 * The ONE permitted status mutation. Within a single mutation it archives the
 * current active row and activates the target version — never patching
 * body/name/version. Re-activating a prior version is the rollback path.
 */
export const activateSkill = internalMutation({
  args: { name: v.string(), version: v.number() },
  handler: async (ctx, { name, version }) => {
    const target = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) =>
        q.eq("name", name).eq("version", version),
      )
      .unique();

    if (target === null) {
      throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: ${name} v${version}`);
    }

    const current = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) =>
        q.eq("name", name).eq("status", "active"),
      )
      .unique();

    if (current !== null && current._id !== target._id) {
      await ctx.db.patch(current._id, { status: "archived" });
    }

    if (target.status !== "active") {
      await ctx.db.patch(target._id, { status: "active" });
    }
  },
});

/**
 * Idempotent seed of the Executive Agent classifier skill (v1, active). The
 * body originates from the registry-bound markdown source (via the derived
 * constant) — no agent prompt is hardcoded here. Skips if the name already
 * exists.
 */
export const seedSkills = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) =>
        q.eq("name", EXECUTIVE_AGENT_CLASSIFIER_SKILL),
      )
      .first();

    if (existing !== null) {
      return;
    }

    await ctx.db.insert("skills", {
      name: EXECUTIVE_AGENT_CLASSIFIER_SKILL,
      version: 1,
      body: executiveAgentClassifierSkillBody,
      status: "active",
      createdAt: Date.now(),
    });
  },
});
