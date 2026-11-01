import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const document = (text: string) => ({
  kind: "site" as const,
  title: "Studio",
  brand: { name: "Studio" },
  navigation: [],
  pages: [{ slug: "home", title: "Home", nodes: [{ kind: "text" as const, text }] }],
});

describe("recovered web project lifecycle", () => {
  beforeEach(() => vi.stubEnv("CONVEX_SITE_URL", "https://runtime.example"));
  afterEach(() => vi.unstubAllEnvs());

  test("unconfigured or invalid hosting permits a private draft but refuses publication", async () => {
    for (const config of [
      "",
      "http://public.example",
      "https://user:secret@runtime.example",
      "https://runtime.example/wrong",
    ]) {
      vi.stubEnv("CONVEX_SITE_URL", config);
      const t = convexTest(schema, modules);
      t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
      const userId = await t.run((ctx) => ctx.db.insert("users", {}));
      const user = t.withIdentity({ subject: `${userId}|session` });
      const created = await user.mutation(api.webProjects.createDraft, {
        kind: "site",
        slug: "unconfigured",
        title: "Draft",
        document: document("Private draft"),
      });
      const project = await user.query(api.webProjects.getProject, {
        projectId: created.projectId,
      });
      expect(project?.publicHost).toBe("");
      const approval = await user.mutation(api.webProjects.approveVersion, {
        projectId: created.projectId,
        version: created.version,
        contentHash: created.contentHash,
      });
      expect(
        await user.mutation(api.webProjects.publishVersion, {
          projectId: created.projectId,
          version: created.version,
          contentHash: created.contentHash,
          expectedRevision: approval.revision,
        }),
      ).toMatchObject({ ok: false, code: "RUNTIME_UNAVAILABLE" });
    }
  });

  test("local platform bindings retain the configured port", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3211");
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const user = t.withIdentity({ subject: `${userId}|session` });
    const created = await user.mutation(api.webProjects.createDraft, {
      kind: "site",
      slug: "local",
      title: "Local",
      document: document("Local"),
    });
    expect(
      (await user.query(api.webProjects.getProject, { projectId: created.projectId }))?.publicHost,
    ).toBe("127.0.0.1:3211");
  });

  test("requires exact human approval, keeps published bytes during edits, and stops at erasure", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
    const userId = await t.run((ctx) => ctx.db.insert("users", {}));
    const user = t.withIdentity({ subject: `${userId}|session` });
    const first = await user.mutation(api.webProjects.createDraft, {
      kind: "site",
      slug: "studio",
      title: "Studio",
      document: document("Original"),
    });
    await expect(
      user.mutation(api.webProjects.publishVersion, {
        projectId: first.projectId,
        version: first.version,
        contentHash: first.contentHash,
        expectedRevision: first.revision,
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_APPROVED" });
    const approved = await user.mutation(api.webProjects.approveVersion, {
      projectId: first.projectId,
      version: first.version,
      contentHash: first.contentHash,
    });
    const published = await user.mutation(api.webProjects.publishVersion, {
      projectId: first.projectId,
      version: first.version,
      contentHash: first.contentHash,
      expectedRevision: approved.revision,
    });
    expect(published.ok).toBe(true);
    const project = await user.query(api.webProjects.getProject, { projectId: first.projectId });
    if (!project) throw new Error("project missing");
    const resolveArgs = { host: project.publicHost, slug: "studio", page: "home" };
    const publicBefore = await t.query(internal.webRuntime.resolvePage, resolveArgs);
    const second = await user.mutation(api.webProjects.saveDraft, {
      projectId: first.projectId,
      document: document("Revised"),
      expectedRevision: published.revision,
    });
    expect(await t.query(internal.webRuntime.resolvePage, resolveArgs)).toEqual(publicBefore);
    await expect(
      user.mutation(api.webProjects.saveDraft, {
        projectId: first.projectId,
        document: document("Stale"),
        expectedRevision: published.revision,
      }),
    ).rejects.toThrow(/STALE_REVISION/);
    expect(
      await user.query(api.webProjects.listVersions, { projectId: first.projectId }),
    ).toHaveLength(2);
    await expect(
      user.mutation(api.webProjects.publishVersion, {
        projectId: first.projectId,
        version: second.version,
        contentHash: second.contentHash,
        expectedRevision: second.revision,
      }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_APPROVED" });
    await t.run((ctx) =>
      ctx.db.insert("authRevocations", {
        userId: String(userId),
        state: "deleting",
        expiresAt: Number.MAX_SAFE_INTEGER,
      }),
    );
    expect(await t.query(internal.webRuntime.resolvePage, resolveArgs)).toEqual({
      state: "not_found",
    });
    await expect(
      user.mutation(api.webProjects.saveDraft, {
        projectId: first.projectId,
        document: document("Late"),
        expectedRevision: second.revision,
      }),
    ).rejects.toThrow(/UNAUTHENTICATED|TENANT_ERASURE_IN_PROGRESS/);
    expect(await t.run((ctx) => ctx.db.query("webProjectVersions").collect())).toHaveLength(2);
  });

  test("tenant isolation applies to draft reads and writes", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => ctx.db.insert("users", {}));
    const b = await t.run((ctx) => ctx.db.insert("users", {}));
    const owner = t.withIdentity({ subject: `${a}|session` });
    const other = t.withIdentity({ subject: `${b}|session` });
    const created = await owner.mutation(api.webProjects.createDraft, {
      kind: "site",
      slug: "private",
      title: "Private",
      document: document("Private"),
    });
    expect(
      await other.query(api.webProjects.getProject, { projectId: created.projectId }),
    ).toBeNull();
    await expect(
      other.mutation(api.webProjects.saveDraft, {
        projectId: created.projectId,
        document: document("Foreign"),
        expectedRevision: created.revision,
      }),
    ).rejects.toThrow(/WEB_PROJECT_UNAVAILABLE/);
  });
});
