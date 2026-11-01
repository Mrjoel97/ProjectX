import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

const keys = ["stitch", "layout", "vision", "requiredStitch", "requiredNative"] as const;
type Prompts = Record<(typeof keys)[number], string>;

/** Provider instructions use the same immutable, versioned registry as agent prompts. */
export async function loadPresencePolicy(ctx: Pick<ActionCtx, "runQuery">) {
  const skill = await ctx.runQuery(internal.skills.getActiveSkill, {
    name: "presence-design-policy",
  });
  let prompts: unknown;
  try {
    prompts = JSON.parse(skill.body);
  } catch {
    throw Error("PRESENCE_POLICY_INVALID");
  }
  if (
    !prompts ||
    typeof prompts !== "object" ||
    Array.isArray(prompts) ||
    Object.keys(prompts).length !== keys.length ||
    keys.some((key) => {
      const value = (prompts as Record<string, unknown>)[key];
      return typeof value !== "string" || !value.trim() || value.length > 12000;
    })
  )
    throw Error("PRESENCE_POLICY_INVALID");
  return { prompts: prompts as Prompts, version: skill.version, skillId: skill.skillId };
}
