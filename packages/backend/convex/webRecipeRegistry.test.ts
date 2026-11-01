import { onlinePresenceSpecialistSkillBody } from "@pikar/contracts/skills/onlinePresenceSpecialist";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

describe("online presence registry recovery", () => {
  test("native seed loads the specialist once while recipe candidates remain dormant", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.skills.seedSkills, {});
    await t.mutation(internal.skills.seedSkills, {});
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    const rows = await t.run((ctx) => ctx.db.query("skills").collect());
    expect(rows.filter((row) => row.name === "online-presence-specialist")).toEqual([
      expect.objectContaining({
        version: 1,
        status: "active",
        body: onlinePresenceSpecialistSkillBody,
      }),
    ]);
    const recipes = rows.filter((row) => row.name.startsWith("web-recipe-"));
    expect(recipes).toHaveLength(3);
    expect(recipes.every((row) => row.status === "candidate" && row.version === 1)).toBe(true);
  });

  test("unknown recipe names and ordinary tenant qualification calls fail closed", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("skills", {
        name: "web-recipe-unknown",
        version: 1,
        body: "untrusted",
        status: "candidate",
        createdAt: 1,
      }),
    );
    await expect(
      t.mutation(internal.skills.activateSkill, {
        name: "web-recipe-unknown",
        version: 1,
      }),
    ).rejects.toThrow(/WEB_RECIPE_NAME_INVALID/);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    const candidate = await t.run((ctx) =>
      ctx.db
        .query("skills")
        .withIndex("by_name_version", (q) =>
          q.eq("name", "web-recipe-business-site").eq("version", 1),
        )
        .unique(),
    );
    if (!candidate) throw new Error("candidate missing");
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    await expect(
      t
        .withIdentity({ subject: `${userId}|session` })
        .mutation(api.skills.beginWebRecipeBrowserQualification, { candidateId: candidate._id }),
    ).rejects.toThrow(/OWNER_REQUIRED/);
  });
});
