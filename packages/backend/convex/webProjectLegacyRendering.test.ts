import { materializeWebRecipeWithProvenance, WEB_DESIGN_RENDERER_VERSION } from "@pikar/core";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

describe("legacy recipe artifact compatibility", () => {
  test.each([
    "web-design-renderer-v1",
    "web-design-renderer-v2",
    "web-design-renderer-v3",
    "web-design-renderer-v4",
    "web-design-renderer-v5",
    "web-design-renderer-v6",
    "web-design-renderer-v7",
    "web-design-renderer-v15",
  ])("editing %s keeps prior public bytes and origin intact", async (rendererVersion) => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const materialized = materializeWebRecipeWithProvenance("business-site", {
      brandName: "Legacy Studio",
      headline: "Original legacy offer",
    });
    const { artDirection: _direction, ...oldProfile } = materialized.designProfile;
    const legacyProfile =
      rendererVersion === "web-design-renderer-v4"
        ? { ...oldProfile, artDirection: "studio" as const }
        : oldProfile;
    const legacyHtml = "<!doctype html><title>Legacy</title><p>Exact prior publication bytes</p>";
    const byteLength = new TextEncoder().encode(legacyHtml).byteLength;
    const ids = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("webProjects", {
        tenantId: String(userId),
        kind: "site",
        slug: "legacy",
        title: "Legacy Studio",
        publicHost: "legacy.example",
        domainMode: "platform_path",
        hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
        draftVersion: 1,
        approvedVersion: 1,
        approvedContentHash: "legacy-hash",
        publishedVersion: 1,
        publishedContentHash: "legacy-hash",
        revision: 3,
        createdAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("webProjectVersions", {
        tenantId: String(userId),
        projectId,
        version: 1,
        document: materialized.document,
        contentHash: "legacy-hash",
        rendererVersion,
        artifactHtml: legacyHtml,
        artifactByteLength: byteLength,
        artifacts: [{ pageSlug: "home", html: legacyHtml, byteLength }],
        sourceRefs: ["legacy-source-ref"],
        createdBy: String(userId),
        createdAt: 1,
        recipeRef: {
          name: "web-recipe-business-site",
          version: 1,
          skillId: "legacy-skill-ref",
          bodyHash: "legacy-body-hash",
          definitionHash: "legacy-definition-hash",
          inputHash: "legacy-input-hash",
          rendererVersion,
          designProfile: legacyProfile,
        },
      });
      return { projectId, versionId };
    });
    const before = await t.run((ctx) => ctx.db.get(ids.versionId));
    const resolveArgs = { host: "legacy.example", slug: "legacy", page: "home" };
    expect(await t.query(internal.webRuntime.resolvePage, resolveArgs)).toMatchObject({
      state: "published",
      html: legacyHtml,
      version: 1,
    });
    const user = t.withIdentity({ subject: `${userId}|session` });
    const revised = await user.mutation(api.webProjects.saveDraft, {
      projectId: ids.projectId,
      expectedRevision: 3,
      document: { ...materialized.document, title: "Revised private draft" },
    });
    const next = await user.query(api.webProjects.getVersion, {
      projectId: ids.projectId,
      version: revised.version,
    });
    expect(next?.rendererVersion).toBe(WEB_DESIGN_RENDERER_VERSION);
    expect(next?.recipeRef).toEqual(before?.recipeRef);
    expect(next?.recipeRef?.designProfile.artDirection).toBe(
      rendererVersion === "web-design-renderer-v4" ? "studio" : undefined,
    );
    expect(next?.artifactHtml).toContain(
      `data-art-direction="${rendererVersion === "web-design-renderer-v4" ? "studio" : "editorial"}"`,
    );
    expect(await t.run((ctx) => ctx.db.get(ids.versionId))).toEqual(before);
    expect(await t.query(internal.webRuntime.resolvePage, resolveArgs)).toMatchObject({
      state: "published",
      html: legacyHtml,
      version: 1,
    });
  });
});
