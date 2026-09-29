import type { WebDocument } from "@pikar/contracts/webRuntime";
import { renderWebDocument } from "@pikar/core/webRuntime";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
const document: WebDocument = {
  kind: "site",
  title: "Acme",
  description: "A safe public site",
  brand: { name: "Acme" },
  navigation: [{ label: "About", path: "/about" }],
  pages: [
    {
      slug: "home",
      title: "Home",
      nodes: [
        { kind: "hero", heading: "Run the next move" },
        {
          kind: "cta",
          id: "book",
          label: "About",
          target: { kind: "local", path: "/about" },
          analytics: true,
        },
        {
          kind: "form",
          id: "contact",
          fields: ["email", "name"],
          consent: "I agree to hear from Acme.",
        },
      ],
    },
    { slug: "about", title: "About", nodes: [{ kind: "text", text: "Exact about page" }] },
  ],
};

async function harness() {
  const t = convexTest(schema, modules);
  const html = renderWebDocument(document, { slug: "acme", page: "home" });
  const about = renderWebDocument(document, { slug: "acme", page: "about" });
  const projectId = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("webProjects", {
      tenantId: "tenant-http",
      kind: "site",
      slug: "acme",
      title: "Acme",
      publicHost: "some.convex.site",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
      draftVersion: 1,
      approvedVersion: 1,
      approvedContentHash: "hash-1",
      publishedVersion: 1,
      publishedContentHash: "hash-1",
      revision: 3,
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("webProjectVersions", {
      tenantId: "tenant-http",
      projectId,
      version: 1,
      document,
      contentHash: "hash-1",
      rendererVersion: "web-runtime-v1",
      artifactHtml: html,
      artifacts: [
        { pageSlug: "home", html, byteLength: new TextEncoder().encode(html).byteLength },
        { pageSlug: "about", html: about, byteLength: new TextEncoder().encode(about).byteLength },
      ],
      artifactByteLength: new TextEncoder().encode(html + about).byteLength,
      createdBy: "user",
      createdAt: 1,
      sourceRefs: [],
    });
    return projectId;
  });
  return { t, html, projectId };
}

describe("Phase 48 public HTTP runtime", () => {
  test("serves exact bytes for GET/HEAD with safe ownership headers and raw-request metrics", async () => {
    const h = await harness();
    const get = await h.t.fetch("/p/acme/home", { method: "GET" });
    expect(get.status).toBe(200);
    expect(await get.text()).toBe(h.html);
    expect(get.headers.get("content-type")).toContain("text/html");
    expect(get.headers.get("cache-control")).toBe("no-store");
    expect(get.headers.get("referrer-policy")).toBe("no-referrer");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(get.headers.get("x-pikar-hosting")).toBe("pikar_platform_path");
    expect(get.headers.get("x-pikar-source")).toBe("tenant_structured_content");
    const head = await h.t.fetch("/p/acme/home", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const metrics = await h.t.run((ctx) => ctx.db.query("webMetrics").collect());
    expect(metrics).toEqual([expect.objectContaining({ kind: "page_view", count: 2 })]);
  });

  test("activates the canonical rendered CTA form before asserting its redirect and metric", async () => {
    const h = await harness();
    const page = await (await h.t.fetch("/p/acme/home")).text();
    const action = /<form method="post" action="([^"]+\/cta\/book)"/.exec(page)?.[1];
    expect(action).toBe("/p/acme/home/cta/book");
    const response = await h.t.fetch(action!, { method: "POST", redirect: "manual" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/about");
    const metrics = await h.t.run((ctx) => ctx.db.query("webMetrics").collect());
    expect(metrics.find((metric) => metric.kind === "cta_click")?.count).toBe(1);
    expect(await h.t.run((ctx) => ctx.db.query("requests").collect())).toEqual([]);
  });

  test("delegates the canonical rendered form and returns safe accepted/duplicate outcomes", async () => {
    const h = await harness();
    const page = await (await h.t.fetch("/p/acme/home")).text();
    const action = /<form method="post" action="([^"]+\/forms\/contact)"/.exec(page)?.[1];
    expect(action).toBe("/p/acme/home/forms/contact");
    const init = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": "form-http-1",
        "X-Forwarded-For": "198.51.100.20",
      },
      body: new URLSearchParams({ email: "lead@example.com", name: "Lead", consent: "on" }),
    };
    expect(await (await h.t.fetch(action!, init)).json()).toEqual({
      ok: true,
      outcome: "accepted",
    });
    expect(await (await h.t.fetch(action!, init)).json()).toEqual({
      ok: true,
      outcome: "duplicate",
    });
  });

  test("rejects an oversized public form before parsing or persisting it", async () => {
    const h = await harness();
    const action = "/p/acme/home/forms/contact";
    const body = new URLSearchParams({
      email: "lead@example.com",
      name: "x".repeat(8192),
      consent: "on",
    });
    const response = await h.t.fetch(action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const declared = await h.t.fetch(action, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": "999999",
      },
      body: new URLSearchParams({ email: "lead@example.com", consent: "on" }),
    });
    expect(declared.status).toBe(413);
    expect(await h.t.run((ctx) => ctx.db.query("webSubmissions").collect())).toEqual([]);
    expect(await h.t.run((ctx) => ctx.db.query("webMetrics").collect())).toEqual([]);
    expect(await h.t.run((ctx) => ctx.db.query("contacts").collect())).toEqual([]);
  });

  test("accepts a bounded multipart form after the stream guard", async () => {
    const h = await harness();
    const form = new FormData();
    form.set("email", "lead@example.com");
    form.set("name", "Lead");
    form.set("consent", "on");
    const response = await h.t.fetch("/p/acme/home/forms/contact", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, outcome: "accepted" });
    expect(await h.t.run((ctx) => ctx.db.query("contacts").collect())).toHaveLength(1);
  });

  test("has no draft fallback and refuses malformed, unpublished, and unsupported routes", async () => {
    const h = await harness();
    await h.t.run(async (ctx) => {
      const project = await ctx.db.get(h.projectId);
      await ctx.db.patch(h.projectId, { draftVersion: 2, revision: (project?.revision ?? 3) + 1 });
    });
    expect(await (await h.t.fetch("/p/acme/home")).text()).toBe(h.html);
    expect((await h.t.fetch("/p/acme/home", { method: "PUT" })).status).toBe(404);
    expect((await h.t.fetch("/p/acme/missing")).status).toBe(404);
    await h.t.run((ctx) =>
      ctx.db.patch(h.projectId, { publishedVersion: undefined, publishedContentHash: undefined }),
    );
    expect((await h.t.fetch("/p/acme/home")).status).toBe(404);
  });

  test("keeps storefront HTTP dark even when a malformed published pointer is seeded", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("webProjects", {
        tenantId: "tenant-storefront-dark",
        kind: "storefront",
        slug: "catalogue",
        title: "Catalogue",
        publicHost: "some.convex.site",
        domainMode: "platform_path",
        hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
        // Deliberately malformed: the published pointer has no corresponding version row.
        publishedVersion: 9,
        publishedContentHash: "sha256:stale",
        revision: 2,
        createdAt: 1,
        updatedAt: 1,
      });
      void projectId;
    });
    expect((await t.fetch("/p/catalogue/home")).status).toBe(404);
  });
});
