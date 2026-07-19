// Versioned skill/prompt registry adapter (SkillOpt readiness).
//
// Thin adapter over the `skills` table: pure contract lives in @pikar/contracts.
// This module is on plan 02's internal-builder allow-list (it intentionally uses
// internalMutation directly). Skill bodies are IMMUTABLE per version — a change
// is a new version row plus an activateSkill flip; body/name/version are never
// patched (only `status` and `evidence` may change).

import {
  ATTACHMENT_EXTRACTOR_SKILL,
  COCKPIT_AGENT_SKILL,
  DOCUMENT_DRAFTER_SKILL,
  EMAIL_DRAFTER_SKILL,
  EXECUTIVE_ROUTER_SKILL,
  GRAPH_EXTRACTOR_SKILL,
  hasPassingEvidence,
  INBOX_DIGEST_SKILL,
  isGatedSkill,
  type LoadedSkill,
  NO_ACTIVE_SKILL_ERROR,
  NO_SUCH_SKILL_VERSION_ERROR,
  REPLY_DRAFTER_SKILL,
  VOICE_SESSION_SKILL,
} from "@pikar/contracts/skill";
import { attachmentExtractorSkillBody } from "@pikar/contracts/skills/attachmentExtractor";
import { cockpitAgentSkillBody } from "@pikar/contracts/skills/cockpitAgent";
import { documentDrafterSkillBody } from "@pikar/contracts/skills/documentDrafter";
import { emailDrafterSkillBody } from "@pikar/contracts/skills/emailDrafter";
import { graphExtractorSkillBody } from "@pikar/contracts/skills/graphExtractor";
import { inboxDigestSkillBody } from "@pikar/contracts/skills/inboxDigest";
import { replyDrafterSkillBody } from "@pikar/contracts/skills/replyDrafter";
import { voiceSessionSkillBody } from "@pikar/contracts/skills/voiceSession";
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

    // EVAL_GATE (EVAL-01): a never-before-active version of a gated skill may only
    // activate with recorded passing evidence pinning EXACTLY this version. The
    // candidate-vs-rollback distinction is PURELY the target row's status —
    // archived/rolled_back were active before and are exempt BY STATUS (rollback
    // must always work mid-incident, never blocked by a broken eval harness).
    if (
      isGatedSkill(name) &&
      target.status === "candidate" &&
      !hasPassingEvidence(target.evidence, name, version)
    ) {
      throw new Error(
        `EVAL_GATE: ${name} v${version} has no recorded passing eval run (run pnpm eval:golden --skill ${name}@${version})`,
      );
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
 * Record eval-run evidence on the exact (name, version) row (EVAL-01). Written
 * by the eval runner after a run; the activateSkill gate reads it. Evidence is
 * one of the two sanctioned patchable fields (with status) — patches NOTHING
 * else. Payload is refs/counts-only JSON (CLAUDE.md §4), never raw content.
 */
export const recordEvalEvidence = internalMutation({
  args: { name: v.string(), version: v.number(), evidence: v.string() },
  handler: async (ctx, { name, version, evidence }) => {
    const row = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();

    if (row === null) {
      throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: ${name} v${version}`);
    }

    await ctx.db.patch(row._id, { evidence });
  },
});

/**
 * Load a skill body pinned to an EXACT version, regardless of status — the
 * version-pin read the eval runner threads into the agent loop so a candidate
 * evaluates as itself. Same LoadedSkill shape as getActiveSkill.
 */
export const getSkillVersion = internalQuery({
  args: { name: v.string(), version: v.number() },
  handler: async (ctx, { name, version }): Promise<LoadedSkill> => {
    const row = await ctx.db
      .query("skills")
      .withIndex("by_name_version", (q) => q.eq("name", name).eq("version", version))
      .unique();

    if (row === null) {
      throw new Error(`${NO_SUCH_SKILL_VERSION_ERROR}: ${name} v${version}`);
    }

    return { body: row.body, version: row.version, skillId: row._id };
  },
});

/**
 * Seed + PUBLISH the agent skills from the registry-bound markdown sources (via
 * the derived constants) — no agent prompt is hardcoded here. First run inserts
 * each as v1/active (bootstrap — a fresh clone must never fail closed). Re-running
 * is idempotent when a body is UNCHANGED vs the NEWEST row. An edited body
 * publishes a NEW version (maxVersion+1), never mutating a prior row
 * (immutable-per-version, CLAUDE.md §5): GATED skills publish as CANDIDATE (the
 * active row stays active; activation flows through activateSkill's EVAL_GATE
 * after a green eval run — EVAL-01), non-gated skills publish-and-activate as
 * before. Rollback stays activateSkill on a prior version.
 */
export const seedSkills = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seeds = [
      { name: EXECUTIVE_ROUTER_SKILL, body: executiveRouterSkillBody },
      { name: EMAIL_DRAFTER_SKILL, body: emailDrafterSkillBody },
      { name: COCKPIT_AGENT_SKILL, body: cockpitAgentSkillBody },
      { name: DOCUMENT_DRAFTER_SKILL, body: documentDrafterSkillBody },
      { name: ATTACHMENT_EXTRACTOR_SKILL, body: attachmentExtractorSkillBody },
      { name: GRAPH_EXTRACTOR_SKILL, body: graphExtractorSkillBody },
      { name: INBOX_DIGEST_SKILL, body: inboxDigestSkillBody },
      { name: REPLY_DRAFTER_SKILL, body: replyDrafterSkillBody },
      // UNGATED (RESEARCH OQ3): a free-form voice persona the eval gate cannot meaningfully assert.
      { name: VOICE_SESSION_SKILL, body: voiceSessionSkillBody },
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

      // Idempotence vs the NEWEST row (not just the active one): covers
      // active-unchanged AND an already-published gated candidate, so repeated
      // dev boots after one edit never mint candidate N+1, N+2 (Pitfall 1).
      const newest = rows.reduce((a, b) => (b.version > a.version ? b : a));
      if (newest.body === body) continue;

      const maxVersion = Math.max(...rows.map((r) => r.version));
      if (isGatedSkill(name)) {
        // Gated: publish as CANDIDATE; the active row stays active. Activation
        // flows through activateSkill (the EVAL_GATE choke point) after a green
        // eval run — a gated edit can never auto-activate through a dev boot.
        await ctx.db.insert("skills", {
          name,
          version: maxVersion + 1,
          body,
          status: "candidate",
          createdAt: Date.now(),
        });
        continue;
      }

      // Non-gated: publish-and-activate, unchanged behavior.
      const active = rows.find((r) => r.status === "active");
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

/**
 * One-off retirement flip: archive the single active row of a skill (no-op when
 * none is active). Used to retire the dead executive-agent.classifier live via
 * `npx convex run skills:archiveSkill '{"name":"executive-agent.classifier"}'` —
 * with its seeds entry removed above, a re-seed cannot resurrect it (Pitfall 5).
 * Status is one of the two sanctioned patchable fields; nothing else is touched.
 */
export const archiveSkill = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const active = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) => q.eq("name", name).eq("status", "active"))
      .unique();

    if (active === null) return { archived: false };

    await ctx.db.patch(active._id, { status: "archived" });
    return { archived: true };
  },
});
