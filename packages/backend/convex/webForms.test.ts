import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const SOURCE = readFileSync(new URL("./webForms.ts", import.meta.url), "utf8");
const HTTP = readFileSync(new URL("./http.ts", import.meta.url), "utf8");

describe("Phase 48 anonymous form adapter", () => {
  test("resolves the published host/path and never accepts caller tenant or version", () => {
    const submitSurface = SOURCE.slice(
      SOURCE.indexOf("export const submit"),
      SOURCE.indexOf("export const cleanup"),
    );
    expect(SOURCE).toContain("internal.webProjects.resolvePublished");
    expect(submitSurface).toContain("args.host");
    expect(submitSurface).toContain("args.slug");
    expect(submitSurface).not.toContain("tenantId: v.string()");
    expect(submitSurface).not.toContain("version: v.number()");
    expect(submitSurface).toContain("parsed.value");
  });

  test("is idempotent, suppression-aware, rate-limited, and expires coordination state", () => {
    expect(SOURCE).toContain("by_tenant_idempotency");
    expect(SOURCE).toContain('outcome: "duplicate"');
    expect(SOURCE).toContain("isAddressSuppressed");
    expect(SOURCE).toContain("MAX_REQUESTS_PER_BUCKET");
    expect(SOURCE).toContain("IDEMPOTENCY_RETENTION_MS");
    expect(SOURCE).toContain("cleanupExpired");
    const abuseQuery = SOURCE.slice(
      SOURCE.indexOf("const activeAbuse"),
      SOURCE.indexOf("if (activeAbuse.length"),
    );
    expect(abuseQuery).toContain('.gt("abuseWindowExpiresAt", now)');
    expect(abuseQuery).not.toContain(".filter(");
  });

  test("stores only bounded outcomes and raw-request metric aggregates", () => {
    expect(SOURCE).toContain("outcomeRef: String(contact.id)");
    expect(SOURCE).not.toContain("rawPayload");
    expect(SOURCE).not.toContain("userAgent");
    for (const kind of ["page_view", "cta_click", "form_accepted", "form_rejected"]) {
      expect(SOURCE).toContain(`"${kind}"`);
    }
    expect(HTTP).toContain('pathPrefix: "/p/"');
    expect(HTTP).toContain("Idempotency-Key");
    expect(HTTP).toContain("CF-Connecting-IP");
  });

  test("does not schedule outbound work from the public form path", () => {
    expect(SOURCE).not.toContain("send");
    expect(SOURCE).not.toContain("notify");
    expect(HTTP).toContain('method: "POST"');
  });
});

const document = {
  kind: "landing" as const,
  title: "Offer",
  brand: { name: "Acme" },
  navigation: [],
  pages: [
    {
      slug: "home",
      title: "Home",
      nodes: [
        {
          kind: "form" as const,
          id: "contact",
          fields: ["email", "name", "company"] as const,
          consent: "I agree to receive updates from Acme.",
          attribution: { source: "campaign", medium: "web", campaign: "launch" },
        },
      ],
    },
  ],
};

async function harness(options: { published?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const tenantId = "tenant-web-forms";
  const projectId = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("webProjects", {
      tenantId,
      kind: "landing",
      slug: "offer",
      title: "Offer",
      publicHost: "example.test",
      domainMode: "platform_path",
      hostingDeclaration: { hosting: "pikar_platform_path", source: "tenant_structured_content" },
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
    await ctx.db.insert("webProjectVersions", {
      tenantId,
      projectId,
      version: 1,
      document,
      contentHash: "hash-1",
      rendererVersion: "web-runtime-v1",
      artifactHtml: "<!doctype html>",
      artifacts: [{ pageSlug: "home", html: "<!doctype html>", byteLength: 15 }],
      artifactByteLength: 15,
      createdBy: "user",
      createdAt: 1,
      sourceRefs: [],
    });
    return projectId;
  });
  return { t, tenantId, projectId };
}

const submitArgs = (overrides: Record<string, unknown> = {}) => ({
  host: "example.test",
  slug: "offer",
  page: "home",
  formId: "contact",
  raw: { email: " Lead@Example.com ", name: " Lead ", company: " Acme ", consent: "on" },
  idempotencyKey: "submission-1",
  abuseKey: "198.51.100.10",
  ...overrides,
});

describe("Phase 48 anonymous form integration", () => {
  test("accepts once, preserves server-owned consent provenance, and deduplicates", async () => {
    const h = await harness();
    await expect(h.t.mutation(internal.webForms.submit, submitArgs())).resolves.toEqual({
      ok: true,
      outcome: "accepted",
    });
    await expect(h.t.mutation(internal.webForms.submit, submitArgs())).resolves.toEqual({
      ok: true,
      outcome: "duplicate",
    });
    const rows = await h.t.run(async (ctx) => ({
      contacts: await ctx.db.query("contacts").collect(),
      submissions: await ctx.db.query("webSubmissions").collect(),
      requests: await ctx.db.query("requests").collect(),
      notifications: await ctx.db.query("notifications").collect(),
      metrics: await ctx.db.query("webMetrics").collect(),
    }));
    expect(rows.contacts).toHaveLength(1);
    expect(rows.contacts[0]).toMatchObject({
      tenantId: h.tenantId,
      email: "lead@example.com",
      name: "Lead",
      company: "Acme",
      origin: "inbound",
      consentSource: "inbound-form",
      consentWording: document.pages[0]!.nodes[0]!.consent,
    });
    expect(rows.submissions).toHaveLength(1);
    expect(rows.submissions[0]).toMatchObject({
      attribution: { source: "campaign", medium: "web", campaign: "launch" },
    });
    expect(rows.submissions[0]).not.toHaveProperty("email");
    expect(rows.submissions[0]).not.toHaveProperty("raw");
    expect(rows.requests).toEqual([]);
    expect(rows.notifications).toEqual([]);
    expect(rows.metrics).toEqual([expect.objectContaining({ kind: "form_accepted", count: 1 })]);
  });

  test("refuses missing consent and suppression before any contact write", async () => {
    const missing = await harness();
    await expect(
      missing.t.mutation(internal.webForms.submit, submitArgs({ raw: { email: "a@example.com" } })),
    ).resolves.toEqual({ ok: false, outcome: "consent_required" });
    expect(await missing.t.run((ctx) => ctx.db.query("contacts").collect())).toEqual([]);

    const suppressed = await harness();
    await suppressed.t.run((ctx) =>
      ctx.db.insert("suppressions", {
        tenantId: suppressed.tenantId,
        address: "lead@example.com",
        suppressedAt: Date.now(),
        source: "user-marked",
      }),
    );
    await expect(suppressed.t.mutation(internal.webForms.submit, submitArgs())).resolves.toEqual({
      ok: false,
      outcome: "suppressed",
    });
    expect(await suppressed.t.run((ctx) => ctx.db.query("contacts").collect())).toEqual([]);
  });

  test("rate-limits a hashed abuse bucket and never stores its raw key", async () => {
    const h = await harness();
    for (let index = 0; index < 5; index += 1) {
      await expect(
        h.t.mutation(
          internal.webForms.submit,
          submitArgs({ idempotencyKey: `submission-${index}` }),
        ),
      ).resolves.toMatchObject({ ok: true, outcome: "accepted" });
    }
    await expect(
      h.t.mutation(internal.webForms.submit, submitArgs({ idempotencyKey: "submission-6" })),
    ).resolves.toEqual({ ok: false, outcome: "rate_limited" });
    const submissions = await h.t.run((ctx) => ctx.db.query("webSubmissions").collect());
    expect(submissions).toHaveLength(5);
    expect(JSON.stringify(submissions)).not.toContain("198.51.100.10");
  });

  test("fails closed for an invalid host and an unpublished project", async () => {
    const h = await harness();
    await expect(
      h.t.mutation(internal.webForms.submit, submitArgs({ host: "foreign.test" })),
    ).resolves.toEqual({ ok: false, outcome: "unavailable" });
    const unpublished = await harness({ published: false });
    await expect(unpublished.t.mutation(internal.webForms.submit, submitArgs())).resolves.toEqual({
      ok: false,
      outcome: "unavailable",
    });
  });

  test("retention drains an expiry-ordered bounded page across tenants without deleting live rows", async () => {
    const h = await harness();
    const now = Date.now();
    const secondProjectId = await h.t.run(async (ctx) => {
      const first = await ctx.db.get(h.projectId);
      if (!first) throw new Error("fixture project missing");
      const { _id, _creationTime, ...fields } = first;
      return ctx.db.insert("webProjects", {
        ...fields,
        tenantId: "tenant-web-forms-two",
        slug: "offer-two",
        publicHost: "second.example.test",
      });
    });
    await h.t.run(async (ctx) => {
      for (let i = 0; i < 101; i += 1) {
        const second = i % 2 === 1;
        await ctx.db.insert("webSubmissions", {
          tenantId: second ? "tenant-web-forms-two" : h.tenantId,
          projectId: second ? secondProjectId : h.projectId,
          version: 1,
          formId: "contact",
          idempotencyKeyHash: `expired-${i}`,
          outcome: "accepted",
          createdAt: i,
          expiresAt: i + 1,
          abuseWindowExpiresAt: i + 1,
        });
      }
      await ctx.db.insert("webSubmissions", {
        tenantId: h.tenantId,
        projectId: h.projectId,
        version: 1,
        formId: "contact",
        idempotencyKeyHash: "live",
        outcome: "accepted",
        createdAt: now,
        expiresAt: now + 86_400_000,
        abuseWindowExpiresAt: now + 900_000,
      });
    });

    await expect(h.t.mutation(internal.webForms.cleanupAll, {})).resolves.toEqual({
      deleted: 100,
      hasMore: true,
    });
    const scheduled = await h.t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(5));
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.name).toContain("webForms:cleanupAll");
    let remaining = await h.t.run((ctx) => ctx.db.query("webSubmissions").collect());
    expect(remaining).toHaveLength(2);
    expect(remaining.map((row) => row.idempotencyKeyHash).sort()).toEqual(["expired-100", "live"]);

    await expect(h.t.mutation(internal.webForms.cleanupAll, {})).resolves.toEqual({
      deleted: 1,
      hasMore: false,
    });
    expect(
      await h.t.run((ctx) => ctx.db.system.query("_scheduled_functions").take(5)),
    ).toHaveLength(1);
    remaining = await h.t.run((ctx) => ctx.db.query("webSubmissions").collect());
    expect(remaining.map((row) => row.idempotencyKeyHash)).toEqual(["live"]);

    const cleanupSource = SOURCE.slice(SOURCE.indexOf("export const cleanupAll"));
    expect(cleanupSource).toContain('withIndex("by_expires_at"');
    expect(cleanupSource).toContain(
      "ctx.scheduler.runAfter(1_000, internal.webForms.cleanupAll, {})",
    );
    expect(cleanupSource).not.toContain('query("webProjects")');
    expect(cleanupSource).not.toContain(".collect()");
  });
});
