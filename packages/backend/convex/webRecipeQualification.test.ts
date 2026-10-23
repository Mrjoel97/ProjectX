import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Required test record missing");
  return value;
}

describe("owner recipe qualification read", () => {
  test("native owner boundary exposes only current closed-family metadata and exact run revisions", async () => {
    const t = convexTest(schema, modules);
    const [ownerId, otherOwnerId, tenantId] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.insert("users", { owner: true }),
        ctx.db.insert("users", { owner: true }),
        ctx.db.insert("users", {}),
      ]),
    );
    const owner = t.withIdentity({ subject: `${ownerId}|owner` });
    const otherOwner = t.withIdentity({ subject: `${otherOwnerId}|other` });
    const tenant = t.withIdentity({ subject: `${tenantId}|tenant` });
    await expect(t.query(api.webRecipes.listQualificationCandidates, {})).rejects.toThrow();
    await expect(tenant.query(api.webRecipes.listQualificationCandidates, {})).rejects.toThrow();
    expect(
      (await owner.query(api.webRecipes.listQualificationCandidates, {})).every(
        (family) => family.candidate === null,
      ),
    ).toBe(true);
    await t.mutation(internal.skills.seedWebRecipeCandidates, {});
    const families = await owner.query(api.webRecipes.listQualificationCandidates, {});
    expect(families.map((family) => family.recipeId).sort()).toEqual([
      "business-site",
      "campaign-landing",
      "storefront-catalogue",
    ]);
    const candidate = required(
      families.find((family) => family.recipeId === "business-site")?.candidate,
    );
    expect(candidate.current).toBe(true);
    expect(candidate.browserReady).toBe(false);
    expect(candidate).not.toHaveProperty("body");
    const start = await owner.mutation(api.skills.beginWebRecipeBrowserQualification, {
      candidateId: candidate.id,
    });
    await owner.mutation(api.skills.advanceWebRecipeBrowserQualification, {
      candidateId: candidate.id,
      runId: start.runId,
      revision: start.revision,
      viewport: "desktop",
    });
    const read = required(
      (await owner.query(api.webRecipes.listQualificationCandidates, {}))[0]?.candidate,
    );
    expect(read.run).toMatchObject({
      runId: start.runId,
      revision: 1,
      ownedByViewer: true,
      route: "/ops",
      lanes: [{ viewport: "desktop", outcomes: ["selected"] }],
      finalizedHash: null,
    });
    expect(JSON.stringify(read)).not.toContain(String(ownerId));
    const otherRead = required(
      (await otherOwner.query(api.webRecipes.listQualificationCandidates, {}))[0]?.candidate,
    );
    expect(otherRead.run?.ownedByViewer).toBe(false);
    await expect(
      otherOwner.mutation(api.skills.advanceWebRecipeBrowserQualification, {
        candidateId: candidate.id,
        runId: start.runId,
        revision: 1,
        viewport: "mobile",
      }),
    ).rejects.toThrow(/REVISION_MISMATCH/);
    await expect(
      owner.mutation(api.skills.finalizeWebRecipeBrowserQualification, {
        candidateId: candidate.id,
        runId: start.runId,
        revision: 1,
      }),
    ).rejects.toThrow(/TRANSCRIPT_INCOMPLETE/);
    await t.run(async (ctx) => {
      const row = await ctx.db.get(candidate.id);
      await ctx.db.patch(candidate.id, { body: `${required(row).body} ` });
    });
    const stale = required(
      (await owner.query(api.webRecipes.listQualificationCandidates, {}))[0]?.candidate,
    );
    expect(stale.current).toBe(false);
    expect(stale.staleRun).toBe(true);
    expect(stale.run).toBeNull();
    await expect(
      owner.mutation(api.skills.beginWebRecipeBrowserQualification, { candidateId: candidate.id }),
    ).rejects.toThrow();
  });
});
