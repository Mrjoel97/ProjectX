import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const document = {
  kind: "site" as const,
  title: "Acme",
  brand: { name: "Acme" },
  navigation: [],
  pages: [
    { slug: "home", title: "Home", nodes: [{ kind: "text" as const, text: "Home page" }] },
    { slug: "about", title: "About", nodes: [{ kind: "text" as const, text: "About page" }] },
  ],
};

async function seed(
  options: {
    host?: string;
    tenantId?: string;
    published?: boolean;
    domainMode?: "platform_path" | "custom_pending" | "custom_active";
    artifactMismatch?: boolean;
  } = {},
) {
  const t = convexTest(schema, modules);
  const host = options.host ?? "runtime.example";
  const tenantId = options.tenantId ?? "tenant-runtime";
  await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("webProjects", {
      tenantId,
      kind: "site",
      slug: "acme",
      title: "Acme",
      publicHost: host,
      domainMode: options.domainMode ?? "platform_path",
      hostingDeclaration: {
        hosting:
          options.domainMode === "custom_active"
            ? "tenant_custom_domain_verified"
            : options.domainMode === "custom_pending"
              ? "tenant_custom_domain_pending"
              : "pikar_platform_path",
        source: "tenant_structured_content",
      },
      draftVersion: 1,
      approvedVersion: 1,
      approvedContentHash: "hash-1",
      ...(options.published === false
        ? {}
        : { publishedVersion: 1, publishedContentHash: "hash-1" }),
      revision: 3,
      createdAt: 1,
      updatedAt: 1,
    });
    const home = "<!doctype html><title>Home</title><p>exact-home</p>";
    const about = "<!doctype html><title>About</title><p>exact-about</p>";
    await ctx.db.insert("webProjectVersions", {
      tenantId,
      projectId,
      version: 1,
      document,
      contentHash: options.artifactMismatch ? "wrong" : "hash-1",
      rendererVersion: "web-runtime-v1",
      artifactHtml: home,
      artifacts: [
        { pageSlug: "home", html: home, byteLength: new TextEncoder().encode(home).byteLength },
        { pageSlug: "about", html: about, byteLength: new TextEncoder().encode(about).byteLength },
      ],
      artifactByteLength: new TextEncoder().encode(home + about).byteLength,
      createdBy: "user",
      createdAt: 1,
      sourceRefs: [],
    });
  });
  return t;
}

describe("Phase 48 public runtime resolver", () => {
  test("serves only the exact published page artifact and declaration", async () => {
    const t = await seed();
    await expect(
      t.query(internal.webRuntime.resolvePage, {
        host: "RUNTIME.EXAMPLE",
        slug: "acme",
        page: "about",
      }),
    ).resolves.toMatchObject({
      state: "published",
      html: expect.stringContaining("exact-about"),
      version: 1,
      contentHash: "hash-1",
      hostingDeclaration: {
        hosting: "pikar_platform_path",
        source: "tenant_structured_content",
      },
    });
  });

  test("returns closed not-found, invalid-host, unpublished, and render-failed states", async () => {
    const published = await seed();
    await expect(
      published.query(internal.webRuntime.resolvePage, {
        host: "runtime.example",
        slug: "missing",
        page: "home",
      }),
    ).resolves.toEqual({ state: "not_found" });
    await expect(
      published.query(internal.webRuntime.resolvePage, {
        host: "foreign.example",
        slug: "acme",
        page: "home",
      }),
    ).resolves.toEqual({ state: "invalid_host" });
    await expect(
      published.query(internal.webRuntime.resolvePage, {
        host: "runtime.example",
        slug: "acme",
        page: "missing",
      }),
    ).resolves.toEqual({ state: "not_found" });

    const unpublished = await seed({ published: false });
    await expect(
      unpublished.query(internal.webRuntime.resolvePage, {
        host: "runtime.example",
        slug: "acme",
        page: "home",
      }),
    ).resolves.toEqual({ state: "unpublished" });
    const broken = await seed({ artifactMismatch: true });
    await expect(
      broken.query(internal.webRuntime.resolvePage, {
        host: "runtime.example",
        slug: "acme",
        page: "home",
      }),
    ).resolves.toEqual({ state: "render_failed" });
  });

  test("rejects pending custom domains and accepts only verified active bindings", async () => {
    const pending = await seed({ domainMode: "custom_pending" });
    await expect(
      pending.query(internal.webRuntime.resolvePage, {
        host: "runtime.example",
        slug: "acme",
        page: "home",
      }),
    ).resolves.toEqual({ state: "invalid_host" });
    const active = await seed({ domainMode: "custom_active" });
    await expect(
      active.query(internal.webRuntime.resolvePage, {
        host: "runtime.example",
        slug: "acme",
        page: "home",
      }),
    ).resolves.toMatchObject({ state: "published" });
  });

  test("fails closed when a host/path binding is ambiguous across tenants", async () => {
    const t = await seed({ tenantId: "tenant-a" });
    await t.run(async (ctx) => {
      await ctx.db.insert("webProjects", {
        tenantId: "tenant-b",
        kind: "site",
        slug: "acme",
        title: "Collision",
        publicHost: "runtime.example",
        domainMode: "platform_path",
        hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
        revision: 1,
        createdAt: 2,
        updatedAt: 2,
      });
    });
    await expect(
      t.query(internal.webRuntime.resolvePage, {
        host: "runtime.example",
        slug: "acme",
        page: "home",
      }),
    ).resolves.toEqual({ state: "invalid_host" });
  });
});
