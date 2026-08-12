import { describe, expect, it } from "vitest";
import {
  COCKPIT_AGENT_SKILL,
  composeUserSkillBody,
  GATED_SKILLS,
  isUserAuthorableSkill,
  LEAD_ENGINE_SKILL,
  MONEY_MODEL_DESIGNER_SKILL,
  OFFER_ARCHITECT_SKILL,
  USER_AUTHORABLE_SKILL_METADATA,
  USER_AUTHORABLE_SKILLS,
  USER_SKILL_ADAPTATION_MAX_BYTES,
} from "./skill";

const AUTHORABLE = [OFFER_ARCHITECT_SKILL, MONEY_MODEL_DESIGNER_SKILL, LEAD_ENGINE_SKILL];

describe("user-authored skill contract", () => {
  it("keeps the v0 authorable set exact, gated, and exhaustively labelled", () => {
    expect(USER_AUTHORABLE_SKILLS).toEqual(AUTHORABLE);
    expect(USER_AUTHORABLE_SKILLS.every((name) => GATED_SKILLS.includes(name))).toBe(true);
    expect(Object.keys(USER_AUTHORABLE_SKILL_METADATA).sort()).toEqual([...AUTHORABLE].sort());

    for (const name of AUTHORABLE) {
      expect(isUserAuthorableSkill(name)).toBe(true);
      expect(USER_AUTHORABLE_SKILL_METADATA[name].label.trim()).not.toBe("");
      expect(USER_AUTHORABLE_SKILL_METADATA[name].description.trim()).not.toBe("");
    }

    expect(isUserAuthorableSkill(COCKPIT_AGENT_SKILL)).toBe(false);
    expect(isUserAuthorableSkill("not-a-registry-skill")).toBe(false);
  });

  it("composes one deterministic adaptation section without changing the base", () => {
    const base = "# Offer architect\n\nKeep the core contract.";
    const first = composeUserSkillBody(base, "  Prefer annual contracts.  ");
    const second = composeUserSkillBody(base, "Prefer usage-based pricing.");

    expect(first).toBe(
      `${base}\n\n## Tenant-authored business adaptation\n\nPrefer annual contracts.`,
    );
    expect(first.match(/Tenant-authored business adaptation/g)).toHaveLength(1);
    expect(second).not.toContain("Prefer annual contracts.");
    expect(second.startsWith(base)).toBe(true);
  });

  it("refuses blank and over-cap UTF-8 adaptations at the byte boundary", () => {
    expect(() => composeUserSkillBody("base", " \n\t ")).toThrow("USER_SKILL_ADAPTATION_REQUIRED");

    const twoByteCharacter = "é";
    const atCap = twoByteCharacter.repeat(USER_SKILL_ADAPTATION_MAX_BYTES / 2);
    const overCap = `${atCap}${twoByteCharacter}`;

    expect(new TextEncoder().encode(atCap)).toHaveLength(USER_SKILL_ADAPTATION_MAX_BYTES);
    expect(composeUserSkillBody("base", atCap)).toContain(atCap);
    expect(() => composeUserSkillBody("base", overCap)).toThrow("USER_SKILL_ADAPTATION_TOO_LARGE");
  });
});
