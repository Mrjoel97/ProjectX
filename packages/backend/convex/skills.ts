// Versioned skill/prompt registry adapter (SkillOpt readiness).
//
// Thin adapter over the `skills` table: pure contract lives in @pikar/contracts.
// This module is on plan 02's internal-builder allow-list (it intentionally uses
// internalMutation directly). Skill bodies are IMMUTABLE per version — a change
// is a new version row plus an activateSkill flip; body/name/version are never
// patched (only `status` and `evidence` may change).

import {
  COCKPIT_AGENT_SKILL,
  DOCUMENT_DRAFTER_SKILL,
  EMAIL_DRAFTER_SKILL,
  EXECUTIVE_AGENT_CLASSIFIER_SKILL,
  EXECUTIVE_ROUTER_SKILL,
  type LoadedSkill,
  NO_ACTIVE_SKILL_ERROR,
  NO_SUCH_SKILL_VERSION_ERROR,
} from "@pikar/contracts/skill";
import { cockpitAgentSkillBody } from "@pikar/contracts/skills/cockpitAgent";
import { documentDrafterSkillBody } from "@pikar/contracts/skills/documentDrafter";
import { emailDrafterSkillBody } from "@pikar/contracts/skills/emailDrafter";
import { executiveAgentClassifierSkillBody } from "@pikar/contracts/skills/executiveAgentClassifier";
import { executiveRouterSkillBody } from "@pikar/contracts/skills/executiveRouter";
import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";

/**
 * Load the currently active skill by name. Reads the single status==="active"
 * row via by_name_status and FAILS CLOSED (throws) when none exists. Callers
 * must record { name, version } in telemetry/audit for every use (Phase 8).
 */
export async function loadSkill(ctx: QueryCtx, name: string): Promise<LoadedSkill> {
  const row = await ctx.db
    .query("skills")
    .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
    .unique();

  if (row === null) {
    throw new Error(`${NO_ACTIVE_SKILL_ERROR}: ${name}`);
  }

  return { body: row.body, version: row.version, skillId: row._id };
}

/**
 * internalQuery wrapper over loadSkill so "use node" actions (which cannot touch
 * ctx.db) reach the active skill body via ctx.runQuery. Fails closed like loadSkill.
 */
export const getActiveSkill = internalQuery({
  args: { name: v.string() },
  handler: (ctx, { name }) => loadSkill(ctx, name),
});

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
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();

    if (target === null) {
      throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: ${name} v${version}`);
    }

    const current = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
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
 * Seed + PUBLISH the agent skills from the registry-bound markdown sources (via
 * the derived constants) — no agent prompt is hardcoded here. First run inserts
 * each as v1/active. Re-running is idempotent when a body is UNCHANGED, and when
 * a body has been edited it publishes a NEW version (maxVersion+1) and activates
 * it — never mutating a prior row (immutable-per-version, CLAUDE.md §5). This is
 * the path a skill-prompt edit takes to production; rollback stays activateSkill.
 */
export const seedSkills = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seeds = [
      { name: EXECUTIVE_AGENT_CLASSIFIER_SKILL, body: executiveAgentClassifierSkillBody },
      { name: EXECUTIVE_ROUTER_SKILL, body: executiveRouterSkillBody },
      { name: EMAIL_DRAFTER_SKILL, body: emailDrafterSkillBody },
      { name: COCKPIT_AGENT_SKILL, body: cockpitAgentSkillBody },
      { name: DOCUMENT_DRAFTER_SKILL, body: documentDrafterSkillBody },
    ];

    for (const { name, body } of seeds) {
      const rows = await ctx.db
        .query("skills")
        .withIndex("by_name_status", (q) => q.eq("name", name))
        .collect();

      if (rows.length === 0) {
        await ctx.db.insert("skills", {
          name,
          version: 1,
          body,
          status: "active",
          createdAt: Date.now(),
        });
        continue;
      }

      const active = rows.find((r) => r.status === "active");
      if (active && active.body === body) continue; // unchanged → nothing to publish (idempotent)

      // Body changed (a skill edit): publish a NEW immutable version and activate it — never mutate
      // the old row (immutable-per-version, CLAUDE.md §5). This is the "publish a skill edit" path;
      // rollback stays activateSkill on a prior version. Version = max existing + 1 (dedup-safe).
      const maxVersion = Math.max(...rows.map((r) => r.version));
      if (active) await ctx.db.patch(active._id, { status: "archived" });
      await ctx.db.insert("skills", {
        name,
        version: maxVersion + 1,
        body,
        status: "active",
        createdAt: Date.now(),
      });
    }
  },
});
